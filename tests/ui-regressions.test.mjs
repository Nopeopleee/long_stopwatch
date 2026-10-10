import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("Each milestone has its own progress bar from zero to 100%", () => {
  const source = read("app.js");
  const match = source.match(/function milestoneProgressPercent\\(elapsed, milestones = milestoneDefs\\)\\{[\\s\\S]*?\\n\\}/);
  assert.ok(match, "Test the same progress helper used in the actual app");
  const progress = new Function("return (" + match[0] + ")")();
  const goals = [{ at: 3600 }, { at: 21600 }, { at: 43200 }, { at: 86400 }];
  const examples = [
    [0, 0], [1800, 50], [3600, 0], [12600, 50],
    [21600, 0], [32400, 50], [43200, 0],
    [64800, 50], [86400, 100], [90000, 100]
  ];
  for (const [elapsed, expected] of examples) {
    assert.ok(Math.abs(progress(elapsed, goals) - expected) < 0.00001,
      `progress(${elapsed}) should be ${expected}% toward the next milestone`);
  }
  for (let stage = 0; stage < goals.length; stage++) {
    const start = stage ? goals[stage - 1].at : 0;
    const end = goals[stage].at;
    let last = -1;
    for (let n = 0; n < 100; n++) {
      const value = progress(start + n / 100 * (end - start), goals);
      assert.ok(value >= last, "Progress must increase within each milestone");
      last = value;
    }
    assert.ok(progress(end - 0.01, goals) > 99.9, "Progress should finish before unlocking");
    if (stage + 1 < goals.length) {
      assert.equal(progress(end, goals), 0, "Next milestone should restart from zero");
    }
  }
  assert.ok(source.includes('classList.add("is-milestone-reset")'),
    "The intentional progress reset must not animate backwards");
  assert.ok(source.includes('前往「${next.label}」'),
    "Accessible label should refer to the next milestone, not the entire journey");
});

test("The shimmer traverses the full track, even when its fill is short", () => {
  const css = read("styles.css");
  const html = read("index.html");
  const app = read("app.js");
  assert.ok(html.includes('id="milestoneProgressTrack"'));
  assert.ok(html.includes('role="progressbar"'));
  assert.ok(app.includes("paintMilestoneProgress(elapsed)"));
  assert.ok(css.includes(".milestone-progress::after{"), "Shimmer must be on the outer track");
  assert.ok(!css.includes(".milestone-progress>span::after"), "Shimmer must not be constrained to the filled span");
  assert.ok(css.includes("left:-40%;width:40%"), "Start the highlight outside the track");
  assert.ok(css.includes("translateX(350%)"), "Travel from -40% to +100% of the track");
  assert.ok(css.includes("@keyframes milestoneShine"), "Keep the original gliding highlight");
  assert.ok(css.includes(".milestone-progress>span.is-milestone-reset{transition:none}"));
  assert.ok(css.includes("@media(prefers-reduced-motion:reduce){.milestone-progress>span{transition:none}.milestone-progress::after{animation:none;display:none}}"));
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
