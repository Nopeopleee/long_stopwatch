(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const client = window.DisuiAccount;
  if (!client) return;
  const guest = $("accountGuest"), signed = $("accountSignedIn"), status = $("accountStatus");
  const email = $("accountEmail"), password = $("accountPassword"), form = $("accountForm");
  const loginMode = $("accountLoginMode"), registerMode = $("accountRegisterMode");
  const submit = $("accountSubmit"), providerHint = $("accountProviderHint");
  const googleLogin = $("accountGoogleLogin"), googleLink = $("accountGoogleLink");
  const linkWrap = $("accountGoogleLinkWrap");
  const petInfo = $("accountPetInfo"), loadBtn = $("accountLoadPet");
  const createBtn = $("accountCreatePet"), claimBtn = $("accountClaimPet");
  const resetDialog = $("accountResetDialog"), resetForm = $("accountResetForm");
  let mode = "login", user = null, accountPet = null, config = null;
  let googleReady = false, pending = false, resetToken = null;

  function setMessage(text) { if (status) status.textContent = text; }
  function setFooter(user) {
    const note = $("settingsFooterNote");
    if (note) note.textContent = user
      ? "小滴的紀錄已連結你的帳號，可以在其他裝置登入後繼續照顧。"
      : "沒有登入時，小滴的紀錄會保存在這台裝置。記得定期下載備份。";
  }
  function friendlyError(error) {
    if (error?.status === 429) return "操作太頻繁了，請稍後再試。";
    if (error?.status >= 500 || !error?.status) return "暫時無法完成操作，請稍後再試。";
    return error?.message || "操作失敗，請再試一次。";
  }
  function setMode(value) {
    mode = value;
    loginMode.classList.toggle("is-active", value === "login");
    registerMode.classList.toggle("is-active", value === "register");
    submit.textContent = value === "login" ? "Email 登入" : "註冊並寄送驗證信";
    password.autocomplete = value === "login" ? "current-password" : "new-password";
  }
  async function protectLocal(reason) {
    const old = loadState();
    if (!old.startedAt) return true;
    if (!confirm(reason + "\n\n會先建立本機復原點，原資料也可先透過設定匯出 JSON。確定繼續？")) return false;
    if (window.DisuiStorage) await DisuiStorage.createSnapshot(old, "before-account-restore", { force: true });
    return true;
  }
  async function adopt(pet) {
    const old = loadState();
    const remoteBirth = pet.origin === "legacy" ? pet.legacyStartedAt : pet.createdAt;
    if (old.startedAt && old.startedAt !== remoteBirth && !await protectLocal("用帳號寵物取代目前這台裝置的小滴？")) return false;
    client.restore(pet);
    localStorage.removeItem("disui-care-debug-v1");
    location.href = "./";
    return true;
  }
  async function refresh() {
    try {
      const profile = await client.me();
      user = profile.user;
      guest.hidden = !!user;
      signed.hidden = !user;
      setFooter(user);
      if (!user) {
        setMessage("尚未登入，仍然可以先照顧這台裝置上的小滴。");
        return;
      }
      setMessage(`已登入：${user.email}`);
      $("accountUserInfo").textContent = user.googleLinked
        ? `${user.email} · 已連結 Google`
        : `${user.email} · 信箱已驗證`;
      linkWrap.hidden = user.googleLinked || !config?.googleClientId;
      const response = await client.pet();
      accountPet = response.pet;
      const local = loadState();
      const matched = accountPet && client.bound(local) && client.binding()?.id === accountPet.id;
      petInfo.textContent = accountPet
        ? matched ? `這台裝置已連接：${accountPet.name}` : `帳號中的滴歲：${accountPet.name}（可取回這台裝置）`
        : "這個帳號尚未建立滴歲。";
      loadBtn.hidden = !accountPet || !!matched;
      createBtn.hidden = !!accountPet;
      claimBtn.hidden = !!accountPet || !window.DisuiCloud?.active(local);
    } catch (error) {
      setMessage("目前無法確認登入狀態，請稍後再試。");
    }
  }
  async function action(task) {
    if (pending) return;
    pending = true;
    submit.disabled = true;
    try { await task(); }
    catch (error) { alert(friendlyError(error)); }
    finally { pending = false; submit.disabled = !config?.emailEnabled; }
  }

  form?.addEventListener("submit", event => {
    event.preventDefault();
    action(async () => {
      if (mode === "register") {
        await client.register(email.value.trim(), password.value);
        alert("若這個 Email 尚未註冊，驗證信已寄出。請開啟信件連結驗證後再登入。");
        password.value = "";
        setMode("login");
      } else {
        await client.login(email.value.trim(), password.value);
        password.value = "";
        await refresh();
      }
    });
  });
  loginMode?.addEventListener("click", () => setMode("login"));
  registerMode?.addEventListener("click", () => setMode("register"));

  $("accountResendBtn")?.addEventListener("click", () => action(async () => {
    const address = email.value.trim() || prompt("請輸入需要重新寄送驗證信的 Email");
    if (!address) return;
    await client.resend(address);
    alert("若帳號尚未完成驗證，會寄送新的驗證信（可能有寄送冷卻時間）。");
  }));
  $("accountForgotBtn")?.addEventListener("click", () => action(async () => {
    const address = email.value.trim() || prompt("請輸入帳號 Email");
    if (!address) return;
    await client.forgot(address);
    alert("若帳號存在且已驗證，將寄送密碼重設連結。");
  }));
  $("accountLogout")?.addEventListener("click", () => action(async () => {
    await client.logout();
    await refresh();
    alert("已登出。這台裝置的本機資料不會被刪除。");
  }));
  loadBtn?.addEventListener("click", () => action(async () => {
    if (!accountPet) return;
    await adopt(accountPet);
  }));
  createBtn?.addEventListener("click", () => action(async () => {
    const local = loadState();
    const initial = local.startedAt ? local.name : "我的滴歲";
    const name = prompt("替帳號的新滴歲取名字（最多 32 字）", initial);
    if (!name) return;
    if (local.startedAt && !await protectLocal("養一隻新的小滴，並在這台裝置切換過去？")) return;
    const data = await client.createPet(name.trim());
    client.restore(data.pet);
    localStorage.removeItem("disui-care-debug-v1");
    location.href = "./";
  }));
  claimBtn?.addEventListener("click", () => action(async () => {
    const local = loadState();
    const binding = window.DisuiCloud?.active(local);
    if (!binding) return;
    if (!confirm("要把以前的小滴帶到這個帳號嗎？完成後，之前的舊版還原碼將不能再使用。")) return;
    const data = await client.claim(binding.id, binding.token);
    client.restore(data.pet);
    localStorage.removeItem("disui-care-debug-v1");
    await refresh();
    alert("滴歲已歸屬你的帳號。");
  }));

  async function loadGoogle() {
    if (!config?.googleClientId || googleReady) return;
    googleReady = true;
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: response => action(async () => {
          await client.google(response.credential, !!user);
          await refresh();
        }),
        auto_select: false
      });
      const options = { theme: "outline", size: "large", text: "signin_with", shape: "pill" };
      google.accounts.id.renderButton(googleLogin, options);
      google.accounts.id.renderButton(googleLink, { ...options, text: "continue_with" });
    } catch {
      googleReady = false;
      providerHint.hidden = false;
      providerHint.textContent = "Google 登入暫時無法使用，可以先用 Email 登入。";
    }
  }

  resetForm?.addEventListener("submit", event => {
    event.preventDefault();
    action(async () => {
      const nextPassword = $("accountNewPassword").value;
      await client.reset(resetToken, nextPassword);
      resetToken = null;
      $("accountNewPassword").value = "";
      resetDialog.close();
      alert("密碼已重設，請使用新密碼登入。");
    });
  });
  $("accountResetCancel")?.addEventListener("click", () => {
    resetDialog.close();
    resetToken = null;
  });

  async function consumeEmailLink() {
    const url = new URL(location.href);
    const verification = url.searchParams.get("verify");
    const reset = url.searchParams.get("reset");
    if (!verification && !reset) return;
    url.searchParams.delete("verify");
    url.searchParams.delete("reset");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    if (verification) {
      try {
        await client.verify(verification);
        alert("Email 驗證成功，已自動登入！");
        await refresh();
      } catch (error) {
        alert(`Email 驗證失敗：${error.message}`);
      }
    } else if (reset) {
      resetToken = reset;
      resetDialog.showModal();
    }
  }
  async function init() {
    // Remove single-use tokens from the address bar before loading any third-party script.
    await consumeEmailLink();
    if (!client.secure()) {
      guest.hidden = false;
      setMessage("請在滴歲的正式網站使用帳號功能。");
      submit.disabled = true;
      return;
    }
    try {
      config = await client.config();
      if (!config.authSchemaReady) {
        guest.hidden = false;
        submit.disabled = true;
        $("accountResendBtn").disabled = true;
        $("accountForgotBtn").disabled = true;
        setMessage("帳號功能暫時無法使用");
        providerHint.hidden = false;
        providerHint.textContent = "目前暫時無法登入或註冊，請稍後再試。";
        return;
      }
      if (!config.emailEnabled) {
        submit.disabled = true;
        $("accountResendBtn").disabled = true;
        $("accountForgotBtn").disabled = true;
      }
      const unavailable = [];
      if (!config.googleClientId) unavailable.push("Google 登入");
      if (!config.emailEnabled) unavailable.push("Email 登入");
      providerHint.hidden = unavailable.length === 0;
      providerHint.textContent = unavailable.length
        ? unavailable.join("、") + "暫時無法使用，請稍後再試。"
        : "";
      await refresh();
      await loadGoogle();
    } catch (error) {
      guest.hidden = false;
      setMessage("帳號服務暫時無法使用，請稍後再試。");
    }
  }
  init();
})();
