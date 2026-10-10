(function () {
  "use strict";
  const client = window.DisuiAccount;
  const toggle = document.getElementById("pushToggle");
  const status = document.getElementById("pushStatus");
  const note = document.getElementById("pushHelp");
  if (!client || !toggle || !status) return;

  let config = null;
  let signedIn = false;
  let subscribed = false;
  let busy = false;
  let lastError = "";
  const supported = () => client.secure() && "serviceWorker" in navigator &&
    "PushManager" in window && "Notification" in window;

  function message(text) { status.textContent = text; }
  function paint() {
    toggle.hidden = false;
    toggle.disabled = busy || !signedIn || !supported() || !config?.available ||
      (Notification.permission === "denied");
    toggle.textContent = subscribed ? "關閉餵食提醒" : "開啟餵食提醒";
    toggle.classList.toggle("primary", !subscribed);
    if (!signedIn) {
      message("登入帳號後就能開啟提醒");
      note.textContent = "提醒會寄送到你開啟通知的裝置，不需要一直打開網頁。";
    } else if (!supported()) {
      message("這台裝置暫時不支援網站通知");
      note.textContent = /iPad|iPhone|iPod/.test(navigator.userAgent)
        ? "iPhone／iPad 請先用 Safari 將滴歲加入主畫面，再從主畫面開啟。"
        : "建議使用支援通知的 Chrome、Edge 或 Firefox。";
    } else if (Notification.permission === "denied") {
      message("這台裝置已關閉通知權限");
      note.textContent = "請到瀏覽器或裝置設定允許滴歲通知，再重新整理頁面。";
    } else if (!config?.available) {
      message("提醒功能暫時無法使用");
      note.textContent = "請稍後再試。";
    } else if (lastError) {
      message(lastError);
      note.textContent = "請確認網路連線後再試一次。";
    } else {
      message(subscribed ? "這台裝置已開啟餵食提醒" : "這台裝置尚未開啟提醒");
      note.textContent = "小滴滿 12 小時可以餵食時提醒一次；餵食後重新計算。每台裝置可以自行開關。";
    }
  }

  async function existingSubscription() {
    if (!supported()) return null;
    const registration = await navigator.serviceWorker.getRegistration("./");
    return registration ? registration.pushManager.getSubscription() : null;
  }
  async function check() {
    if (busy) return;
    lastError = "";
    try {
      const user = await client.me();
      signedIn = !!user.user;
      subscribed = false;
      if (!signedIn) { paint(); return; }
      if (!config) config = await client.pushConfig();
      if (supported() && config.available) {
        const subscription = await existingSubscription();
        if (subscription) {
          subscribed = !!(await client.pushStatus(subscription.endpoint)).subscribed;
        }
      }
    } catch {
      lastError = "暫時無法確認提醒狀態";
    }
    paint();
  }

  function decodeKey(key) {
    const base64 = key.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  }
  function sameKey(subscription, key) {
    if (!subscription?.options?.applicationServerKey) return true;
    const actual = new Uint8Array(subscription.options.applicationServerKey);
    const target = decodeKey(key);
    return actual.length === target.length && actual.every((value, index) => value === target[index]);
  }

  async function turnOn() {
    if (!supported() || !config?.available || !signedIn) return;
    // Call the permission request directly inside the click handler so that
    // Safari/iOS treats it as a user-initiated request.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") { paint(); return; }
    let registration = await navigator.serviceWorker.getRegistration("./");
    if (!registration) registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    if (!registration.active) registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !sameKey(subscription, config.publicKey)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    let fresh = false;
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeKey(config.publicKey)
      });
      fresh = true;
    }
    try {
      const json = subscription.toJSON();
      await client.pushSubscribe({ endpoint: json.endpoint, keys: json.keys });
      subscribed = true;
    } catch (error) {
      // Do not leave a browser subscription enabled without a matching account.
      if (fresh) await subscription.unsubscribe().catch(() => {});
      throw error;
    }
  }
  async function turnOff() {
    const subscription = await existingSubscription();
    if (subscription) {
      await client.pushUnsubscribe(subscription.endpoint);
      await subscription.unsubscribe();
    }
    subscribed = false;
  }

  toggle.addEventListener("click", async () => {
    if (busy || !signedIn) return;
    // Permissions must be requested synchronously in this gesture; turnOn
    // starts with requestPermission before awaiting a network request.
    busy = true;
    lastError = "";
    toggle.disabled = true;
    try {
      if (subscribed) await turnOff();
      else await turnOn();
    } catch (error) {
      lastError = error?.status === 409 ? "這個帳號已達通知裝置數量上限" : "開關通知失敗，請再試一次";
    } finally {
      busy = false;
      paint();
    }
  });

  async function disableOnLogout() {
    if (!supported()) return;
    const subscription = await existingSubscription();
    if (!subscription) return;
    try {
      await client.pushUnsubscribe(subscription.endpoint);
    } finally {
      // Also revoke browser-side subscription if the API is unreachable.
      await subscription.unsubscribe();
      subscribed = false;
      signedIn = false;
      paint();
    }
  }
  window.DisuiPush = { disableOnLogout, refresh: check };
  window.addEventListener("disui:account-changed", check);
  check();
})();
