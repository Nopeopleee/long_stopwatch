(function () {
  "use strict";
  const KEY = "disui-account-pet-v1";
  const ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const secure = () => location.protocol === "https:" && !location.hostname.endsWith(".github.io");
  async function request(path, data, method = "POST") {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: data === undefined ? {} : { "Content-Type": "application/json" },
      ...(data === undefined ? {} : { body: JSON.stringify(data) })
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(value.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.response = value;
      throw error;
    }
    return value;
  }
  function binding() {
    try {
      const item = JSON.parse(localStorage.getItem(KEY) || "null");
      return item && ID.test(item.id) && Number.isSafeInteger(item.startedAt) ? item : null;
    } catch { return null; }
  }
  function startedAt(pet) { return pet.origin === "legacy" ? pet.legacyStartedAt : pet.createdAt; }
  function attach(pet) {
    const born = startedAt(pet);
    if (!Number.isSafeInteger(born) || born <= 0) throw new Error("雲端出生時間不正確");
    localStorage.setItem(KEY, JSON.stringify({ id: pet.id, startedAt: born }));
  }
  function bound(state) {
    const b = binding();
    return !!b && !!state?.startedAt && b.startedAt === state.startedAt;
  }
  function detach() { localStorage.removeItem(KEY); }
  function toLocal(pet) {
    if (window.DisuiCloud?.asLocal) return DisuiCloud.asLocal(pet);
    const born = startedAt(pet);
    return { name: pet.name, startedAt: born,
      care: { activatedAt: born, lastFedAt: pet.lastFedAt, feedCount: pet.feedCount, diedAt: pet.diedAt } };
  }
  function mergePet(state, pet) {
    if (state.startedAt !== startedAt(pet)) throw new Error("出生時間不一致，不覆蓋本機資料");
    return { ...state, name: pet.name, care: {
      ...state.care, lastFedAt: pet.lastFedAt, feedCount: pet.feedCount, diedAt: pet.diedAt
    } };
  }
  function restore(pet, { save = true } = {}) {
    const state = toLocal(pet);
    if (save) {
      if (window.DisuiStorage) DisuiStorage.saveState(state);
      else localStorage.setItem("long-stopwatch-v1", JSON.stringify(state));
    }
    attach(pet);
    window.DisuiCloud?.disconnect();
    return state;
  }
  window.DisuiAccount = {
    secure, binding, bound, detach, attach, toLocal, restore, mergePet,
    config: () => request("/api/auth/config", undefined, "GET"),
    me: () => request("/api/auth/me", undefined, "GET"),
    register: (email, password) => request("/api/auth/register", { email, password }),
    login: (email, password) => request("/api/auth/login", { email, password }),
    verify: token => request("/api/auth/verify", { token }),
    resend: email => request("/api/auth/resend-verification", { email }),
    forgot: email => request("/api/auth/forgot-password", { email }),
    reset: (token, password) => request("/api/auth/reset-password", { token, password }),
    google: (credential, link = false) => request(link ? "/api/auth/google/link" : "/api/auth/google", { credential }),
    logout: async () => {
      // Revocation is best effort; browser unsubscribes even if the network fails.
      await window.DisuiPush?.disableOnLogout?.().catch(() => {});
      const result = await request("/api/auth/logout", {}); detach(); return result;
    },
    pushConfig: () => request("/api/push/config", undefined, "GET"),
    pushStatus: endpoint => request("/api/push/status", { endpoint }),
    pushSubscribe: subscription => request("/api/push/subscribe", subscription),
    pushUnsubscribe: endpoint => request("/api/push/unsubscribe", { endpoint }),
    pet: () => request("/api/me/pet", undefined, "GET"),
    createPet: name => request("/api/me/pet", { name }),
    claim: (id, ownerToken) => request("/api/me/pet/claim", { id, ownerToken }),
    feed: () => request("/api/me/pet/feed", {}),
    rename: name => request("/api/me/pet/rename", { name })
  };
})();
