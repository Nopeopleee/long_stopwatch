import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("Milestone progress is continuous across unlock boundaries", () => {
  const source = read("app.js");
  const match = source.match(/function milestoneProgressPercent\(elapsed, milestones = milestoneDefs\)\{[\s\S]*?\n\}/);
  assert.ok(match, "Expected to test the actual helper used by app.js");
  const progress = new Function("return (" + match[0] + ")")();
  const goals = [{ at: 3600 }, { at: 21600 }, { at: 43200 }, { at: 86400 }];
  const examples = [
    [0, 0], [1800, 12.5], [3600, 25], [21600, 50],
    [43200, 75], [86400, 100], [90000, 100]
  ];
  for (const [elapsed, expected] of examples) {
    assert.ok(Math.abs(progress(elapsed, goals) - expected) < 0.00001,
      `progress(${elapsed}) should be ${expected}%`);
  }
  let last = -1;
  for (let elapsed = 0; elapsed <= 90000; elapsed += 37) {
    const next = progress(elapsed, goals);
    assert.ok(next >= last, `Progress moved backward at ${elapsed} seconds`);
    last = next;
  }
  for (const checkpoint of goals) {
    const before = progress(checkpoint.at - 0.01, goals);
    const after = progress(checkpoint.at, goals);
    assert.ok(after >= before && after - before < 0.01,
      "Milestone unlocking must not animate a full 100-to-0 reset");
  }
});

test("Progress fill has no perpetual shimmer and respects reduced motion", () => {
  const css = read("styles.css");
  const html = read("index.html");
  const app = read("app.js");
  assert.ok(html.includes('id="milestoneProgressTrack"'));
  assert.ok(html.includes('role="progressbar"'));
  assert.ok(app.includes("paintMilestoneProgress(elapsed)"));
  assert.ok(css.includes("@media(prefers-reduced-motion:reduce){.milestone-progress>span{transition:none"));
  assert.ok(!css.includes("animation:shimmer"));
  assert.ok(!css.includes("@keyframes shimmer"));
});

test("Everyday settings prioritize account, theme and backups while advanced tools start closed", () => {
  const html = read("settings.html");
  const script = read("settings.js");
  const sections = [
    'id="accountTitle"', 'id="appearanceTitle"', 'id="dataTitle"', 'id="appTitle"'
  ].map(marker => html.indexOf(marker));
  assert.ok(sections.every(index => index > 0), "Expected everyday settings categories");
  assert.deepEqual(sections, [...sections].sort((a, b) => a - b),
    "Account, theme, backups and app controls should appear in the intended order");
  const advanced = html.indexOf('<details id="advancedSettings"');
  const safety = html.indexOf('id="data-safety"');
  const oldCloud = html.indexOf('id="cloudTitle"');
  const closing = html.indexOf("</details>", advanced);
  assert.ok(advanced > sections.at(-1) && safety > advanced && oldCloud > safety);
  assert.ok(closing > oldCloud);
  assert.ok(!html.slice(advanced, safety).includes(" open"));
  assert.ok(script.includes('hash!=="#data-safety"'));
  assert.ok(script.includes("details.open=true"), "Deep links must expand hidden recovery tools");
  assert.ok(!html.includes("IndexedDB 安全副本"));
  assert.ok(!html.includes("D1 資料"));
  assert.ok(!html.includes("滴歲的主要資料目前只存在這台裝置"));
});

test("Account UI does not leak configuration jargon to end users", () => {
  const script = read("account-ui.js");
  const html = read("settings.html");
  assert.ok(html.includes('id="accountProviderHint"'));
  assert.ok(html.includes('role="status" hidden'));
  assert.ok(!script.includes("Client ID 已設定"));
  assert.ok(!script.includes("AUTH_PASSWORD_PEPPER"));
  assert.ok(!script.includes("npx wrangler"));
  assert.ok(!script.includes("Owner Token"));
  assert.ok(script.includes("friendlyError(error)"));
  assert.ok(script.includes("setFooter(user)"));
});
