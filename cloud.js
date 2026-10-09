(function () {
  "use strict";
  const KEY = "disui-cloud-binding-v1";
  const ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const TOKEN = /^[0-9a-f]{64}$/i;
  const API = "/api/pets";

  function supported() {
    return location.protocol === "https:" && !location.hostname.endsWith(".github.io");
  }
  function binding() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || "null");
      return value && ID.test(value.id) && TOKEN.test(value.token) &&
        Number.isSafeInteger(value.startedAt) && value.startedAt > 0 ? value : null;
    } catch { return null; }
  }
  function disconnect() { localStorage.removeItem(KEY); }
  function active(state) {
    const b = binding();
    return b && state && b.startedAt === state.startedAt ? b : null;
  }
  async function api(path, token, options = {}) {
    const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const response = await fetch(API + path, {
      method: options.method || "GET",
      headers,
      cache: "no-store",
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error || `HTTP ${response.status}`);
      err.status = response.status;
      err.response = data;
      throw err;
    }
    return data;
  }
  function asLocal(pet) {
    const startedAt = pet.origin === "legacy" ? pet.legacyStartedAt : pet.createdAt;
    if (!Number.isSafeInteger(startedAt) || startedAt <= 0) throw new Error("雲端資料缺少出生時間");
    return {
      name: pet.name,
      startedAt,
      care: {
        activatedAt: pet.origin === "legacy" ? Math.min(pet.lastFedAt, Date.now()) : pet.createdAt,
        lastFedAt: pet.lastFedAt,
        feedCount: pet.feedCount,
        diedAt: pet.diedAt
      }
    };
  }
  function store(pet, token) {
    const state = asLocal(pet);
    localStorage.setItem(KEY, JSON.stringify({ id: pet.id, token, startedAt: state.startedAt }));
    return state;
  }
  async function connectLocal(state) {
    if (!supported()) throw new Error("請使用正式 HTTPS 網站進行雲端綁定");
    if (binding()) throw new Error("此瀏覽器已有雲端綁定");
    if (!state?.startedAt || !state.care) throw new Error("目前沒有可綁定的滴歲");
    const payload = {
      name: state.name,
      startedAt: state.startedAt,
      lastFedAt: state.care.lastFedAt,
      feedCount: state.care.feedCount
    };
    const data = await api("/import", null, { method: "POST", body: payload });
    store(data.pet, data.ownerToken);
    return data;
  }
  async function restore(id, token) {
    if (!supported()) throw new Error("請使用正式 HTTPS 網站進行雲端還原");
    id = id.trim().toLowerCase();
    token = token.trim().toLowerCase();
    if (!ID.test(id) || !TOKEN.test(token)) throw new Error("ID 或密鑰格式不正確");
    const data = await api("/" + id, token);
    const state = asLocal(data.pet);
    return { data, state, bind: () => store(data.pet, token) };
  }
  async function read(state) {
    const b = active(state);
    if (!b) return null;
    const data = await api("/" + b.id, b.token);
    if (data.pet.id !== b.id || asLocal(data.pet).startedAt !== state.startedAt) {
      throw new Error("雲端與本機出生時間不一致，已停止同步");
    }
    return data.pet;
  }
  async function feed(state) {
    const b = active(state);
    if (!b) throw new Error("未綁定這隻滴歲");
    const data = await api("/" + b.id + "/feed", b.token, { method: "POST" });
    return data.pet;
  }
  async function rotate(state) {
    const b = active(state);
    if (!b) throw new Error("未綁定這隻滴歲");
    const data = await api("/" + b.id + "/rotate-token", b.token, { method: "POST" });
    store({ id: b.id, origin: "legacy", legacyStartedAt: b.startedAt, name: state.name,
      lastFedAt: state.care.lastFedAt, feedCount: state.care.feedCount }, data.ownerToken);
    return data.ownerToken;
  }
  function applyCare(state, pet) {
    return { ...state, care: {
      ...state.care,
      lastFedAt: pet.lastFedAt,
      feedCount: pet.feedCount,
      diedAt: pet.diedAt
    } };
  }
  window.DisuiCloud = { supported, binding, disconnect, active, connectLocal, restore, read, feed, rotate, applyCare };
})();
