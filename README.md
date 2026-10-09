# 滴歲

**把時間養成一隻會長大的碼表寵物。**

滴歲是一個輕量、可離線使用的 PWA（漸進式網頁應用程式）。按下「開始養」就替小水滴記下出生時間，之後無論關閉網頁、切到背景或重新開機，都能在下次開啟時算出陪伴了多久。

目前**使用者的寵物資料仍以單一裝置為主**，不需要註冊帳號，也沒有雲端同步。專案已加入 Cloudflare Worker／D1 的連線雛形，但尚未開放寵物 API。

## 目前能做什麼？

- **長期計時**：顯示陪伴天數與 `HH:MM:SS`，不受一般手機碼表的 99 小時上限影響；可以替滴歲改名，但不能從介面修改出生時間。
- **成長與里程碑**：共有 6 個生命階段（新生滴、幼滴、成長滴、成熟滴、老朋友、傳說滴）與 17 個里程碑，從出生後 1 小時一路到 10 年。離線期間達成的新里程碑，回來時也會補上通知。
- **餵食與照顧**：每 12 小時可以有效餵食一次。長時間沒餵食會依序進入有點餓、飢餓、虛弱、生病與危急，角色顏色、光暈與動作也會改變。**目前不會真正死亡**；7 天死亡門檻僅保留在規則中，尚未啟用。
- **分享成就卡**：產生正方形（1080×1080）或限時動態（1080×1920）PNG；支援的裝置可直接呼叫系統分享，不支援時可下載圖片。圖片在裝置本機產生。
- **離線與安裝**：可透過支援的瀏覽器安裝為 PWA；Service Worker 快取必要資源，離線也能查看與照顧滴歲。
- **外觀與操作**：深色、淺色、跟隨系統三種主題，並支援減少動態效果與螢幕閱讀器的必要提示。
- **資料安全**：除了 `localStorage` 主資料，還有 IndexedDB 鏡像副本、最多 10 個本機復原點、JSON 匯出／匯入，以及設定頁的備份健康度資訊。

## 如何使用

1. 開啟網站，按「開始養」替滴歲記下出生時間。
2. 定期回來看看牠、餵食，解鎖新的生命階段與里程碑。
3. 想分享時，使用首頁的「分享」製作成就卡。
4. 到「設定」調整主題，並定期**匯出 JSON 備份到網站以外的地方**。

滴歲不是持續在背景執行的碼表。計時與照顧狀態是重新開啟時，依儲存的時間戳和目前裝置時間計算，所以不需要讓網頁一直開著。

## 資料保存與備份

目前的正式資料保存在使用者自己的瀏覽器中：

| 儲存方式 | 用途 |
| --- | --- |
| `localStorage` | 同步讀寫的主要寵物狀態（`long-stopwatch-v1`） |
| IndexedDB | 非同步鏡像副本，以及最多 10 個本機復原點 |
| JSON 匯出 | 由使用者保存在裝置外或雲端硬碟的**外部備份** |

- 開啟 App 或回到前景時，會檢查主資料與鏡像副本；可以判斷的單邊遺失／損壞會嘗試自動修復，無法安全判定的衝突才會詢問使用者。
- 正常使用期間會建立每日復原點；匯入、重置、還原及資料修復前，也會嘗試保存保護快照。可在「設定 → 資料安全」查看或還原。
- 匯出會記錄最近一次外部備份時間；長時間沒備份時會在首頁低頻提醒。
- JSON 目前使用 **version 2**，包含名稱、出生時間與照顧資料；仍接受舊版 version 1 和舊格式資料。
- 重置需長按 2 秒。匯入舊資料時，缺少的照顧紀錄會從匯入時開始計算，不會讓舊寵物立刻生病。

> **重要：本機復原點不是雲端備份。** 清除瀏覽器網站資料、PWA 資料或解除安裝後，`localStorage`、IndexedDB 與復原點仍可能一起消失。想長期保存滴歲，請定期匯出 JSON，放到其他位置。

### 相容性備註

專案改名為「滴歲」後，保留部分舊版 `dipai-*` localStorage key，避免既有使用者更新後遺失主題或進度。這些 key 是相容性設計，**不應僅為了改名而直接更動**。

照顧測試模式使用獨立的 `disui-care-debug-v1`，不會更改正式的出生時間、餵食次數或備份資料。

## 本機開發與測試

本專案使用 HTML、CSS 與 Vanilla JavaScript，沒有前端建置流程或大型執行階段依賴。Service Worker 需在 HTTPS 或 `localhost` 下運作。

在專案根目錄執行以下其中一種方式：

```bash
python -m http.server 8080
```

或：

```bash
npx serve . -l 8080
```

再開啟 `http://localhost:8080/`。本機與 GitHub Pages 的設定頁仍使用 `settings.html`；Cloudflare Workers 的正式網址使用 `/settings`，舊 `/settings.html` 會轉址至乾淨網址。

### 照顧狀態測試

在網址加上 `?debug=1`，設定頁就會顯示「測試工具」；在 `localhost` 也會自動開啟。可模擬 0、12、24、48、72、96、144 或 192 小時沒餵食，並測試首頁與分享卡的視覺變化。

測試值與真實餵食資料分開保存；測完可以按「恢復真實狀態」。目前即使模擬超過 7 天，仍會停在「危急」，不會真的死亡。

### 主要檔案

| 檔案 | 用途 |
| --- | --- |
| `index.html` / `app.js` | 首頁、長期計時、里程碑與餵食互動 |
| `settings.html` / `settings.js` | 主題、JSON 備份、資料安全與測試工具 |
| `storage.js` | 資料驗證、IndexedDB 鏡像、快照與復原 |
| `share-card.js` | 使用 Canvas 2D 產生分享圖片 |
| `sw.js` | Service Worker 與離線快取策略 |
| `src/worker.js` | Cloudflare Worker API 入口 |
| `migrations/` | Cloudflare D1 SQL migration |
| `icons/`、`mascot.css`、`journey.css` | 角色、圖示與成長視覺素材 |

靜態資源目前使用版本化 URL 與 Service Worker 快取。修改 JS／CSS 等資源時，請同步更新引用版本與 Service Worker 的預快取清單，避免安裝版 PWA 混用新舊檔案。

## Cloudflare Worker / D1（後端雛形）

目前 `disui.noppl.cc` 預計由 Cloudflare Workers + Static Assets 提供前端，`/api/*` 走 Worker；其他網站資源仍由靜態資產層處理。設定放在 `wrangler.jsonc`：

- `src/worker.js`：提供唯讀 `GET /api/health`，以及 `POST /api/pets` 建立原生寵物、`GET /api/pets/:id` 透過 Bearer Owner Token 讀取寵物。其他 `/api/*` 回傳 404。
- `migrations/0001_create_pets.sql`：第一份寵物資料表 migration；已支援建立與授權讀取原生寵物，但尚未有餵食、修改與同步 API；前端不會自動上傳本機寵物資料。
- D1 binding 名稱為 `DB`，對應資料庫 `disui-db`。前端與 Server Worker 程式碼分開，API 不會由 Service Worker 快取。

### 初始化 D1 schema（需要 Cloudflare 授權）

在本機 clone 專案並登入 Cloudflare：

```bash
npx wrangler login
npx wrangler d1 migrations apply disui-db --remote
```

這一步會在**遠端 D1** 建立 `pets` 表及 migration 記錄，不會建立任何寵物紀錄；只將檔案推到 GitHub 並不會自動執行 migration。未來有新的 migration 時也使用相同指令。可先透過 `npx wrangler d1 migrations apply disui-db --local` 在本機測試。

GitHub 的 Worker Builds 繼續使用 `npx wrangler deploy` 部署程式。部署成功後瀏覽 `https://disui.noppl.cc/api/health`，理想結果是：

```json
{"ok":true,"database":"connected","schemaReady":true}
```

如果看到 `schemaReady:false`，表示 Worker 已連上 D1，但尚未套用 migration。API 回傳 503 則先確認 Worker 部署狀態和 D1 binding；這些檢查不會影響目前的本機養成資料。

需要測試 Worker API 時，可使用 `npx wrangler dev`；前面的 `python -m http.server` 與 `npx serve` 只能測試靜態前端，不會啟動 Worker／D1。

## Roadmap（尚未完成）

以下是方向，不代表已經上線或承諾時程。**已完成的功能已整理在上方，不再重複列入待辦。**

1. **Cloudflare 後端與雲端備份**：Workers／D1 基礎設定和健康檢查 API 已加入；仍需實作寵物綁定、持久化資料與跨裝置復原。現有本機滴歲要能保留，不強迫重新出生；同步衝突與離線操作仍需設計。
2. **可信時間與資料規則**：新建立的線上寵物由伺服器產生可信出生時間；從現有本機資料匯入的出生時間不能直接視為排行榜的可信紀錄。後續再把需要公平性的餵食、死亡等事件移交後端判定。
3. **里程碑與照顧通知**：加入經使用者同意的低頻提醒；關閉 PWA 後仍可靠收到通知的部分，預計使用後端搭配 Web Push。
4. **好友、群組與排行榜**：可邀請朋友一起養、比較陪伴時間與稱號；排名需採可信的伺服器時間，並考慮隱私和防濫用。
5. **進階照顧規則**：評估是否啟用真正死亡、如何治療／復活，以及假期或旅行寬限機制。目前只做到危急，不會寫入真正死亡狀態。

## 目前限制

- **尚無帳號與雲端儲存**：在不同瀏覽器、不同裝置間不會自動同步。JSON 匯入／匯出是現有的搬移方式。
- **本機時間並非可信來源**：目前以 `Date.now() - startedAt` 計算陪伴時間；開發者工具、JSON 匯入或裝置時間變更都可能影響結果。因此目前的出生時間限制只是產品介面規則，不具備公開競賽的防作弊能力。
- **尚無背景推播**：關閉 App 後不會由伺服器主動提醒餵食或里程碑。
- **照顧系統仍在調整**：已有餵食與健康狀態，但死亡、治療、復活及假期模式尚未實作。

希望先把「自己養一隻滴歲」做好，再慢慢把牠帶到雲端。


### 寵物 API（後端基礎）

目前只有手動呼叫 API，**前端尚未接入，也沒有跨裝置同步**。

```bash
curl -X POST https://disui.noppl.cc/api/pets \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"我的滴歲"}'
```

成功回傳 HTTP 201：`{"pet":{...},"ownerToken":"<64位十六進位密鑰>"}`。請將 `ownerToken` 保存在安全位置，**只會在建立時回傳一次，伺服器只存 SHA-256 Hash**。Token 遺失目前無法復原；切勿貼在公開網址、Git、分享卡或日誌中。

```bash
curl https://disui.noppl.cc/api/pets/你的寵物UUID \\
  -H 'Authorization: Bearer 你的ownerToken'
```

有效 Token 才能取得寵物資料；缺少 Token 回傳 401，不匹配回傳 404。目前 **尚未提供帳號、Token 輪替、移轉／恢復及速率限制**，請勿把它視為完整正式帳號系統。公開啟用建立 API 前建議先加 Cloudflare WAF / Rate Limiting 防止惡意大量建立紀錄。
