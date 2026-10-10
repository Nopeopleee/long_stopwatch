# 滴歲

**把時間養成一隻會長大的碼表寵物。**

滴歲是一個輕量、可離線使用的 PWA（漸進式網頁應用程式）。按下「開始養」就替小水滴記下出生時間，之後無論關閉網頁、切到背景或重新開機，都能在下次開啟時算出陪伴了多久。

目前支援本機養成、早期的密鑰式雲端綁定，以及新加入的**帳號登入與帳號寵物**。帳號可使用 Google 或 Email／密碼，Email 註冊需驗證信。正式啟用前需部署 D1 第二份 Migration，並設定 Google OAuth Client ID 與寄信服務；登入或取回資料不會默默覆蓋本機舊小滴。

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

未啟用雲端時，正式資料保存在使用者自己的瀏覽器中；啟用後，出生與餵食紀錄會在 Cloudflare D1 留有副本：

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
| `cloud.js` | 早期密鑰式雲端綁定、還原、讀取、餵食與密鑰輪替 |
| `account.js` / `account-ui.js` / `account.css` | 帳號 API 與設定頁登入／註冊／復原 UI |
| `src/auth.js` / `src/account-pets.js` | Email/Google 驗證、Session、安全限制與帳號寵物操作 |
| `share-card.js` | 使用 Canvas 2D 產生分享圖片 |
| `sw.js` | Service Worker 與離線快取策略 |
| `src/worker.js` | Cloudflare Worker API 入口 |
| `migrations/` | Cloudflare D1 SQL migration |
| `icons/`、`mascot.css`、`journey.css` | 角色、圖示與成長視覺素材 |

靜態資源目前使用版本化 URL 與 Service Worker 快取。修改 JS／CSS 等資源時，請同步更新引用版本與 Service Worker 的預快取清單，避免安裝版 PWA 混用新舊檔案。

## Cloudflare Worker / D1（目前後端）

目前 `disui.noppl.cc` 使用 Cloudflare Workers + Static Assets 提供前端，`/api/*` 走 Worker；其他網站資源仍由靜態資產層處理。設定放在 `wrangler.jsonc`：

- `src/worker.js`：提供健康檢查、建立／匯入寵物、Owner Token 驗證、讀取、餵食與密鑰輪替 API。
- `migrations/0001_create_pets.sql`：第一份寵物資料表 migration；已支援建立與匯入、授權讀取及餵食；前端只能由使用者手動啟用雲端綁定。
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


## 帳號系統（Google、Email／密碼）

帳號介面位於正式 HTTPS 網站的「設定 → 滴歲帳號」，可註冊／登入、驗證 Email、重寄驗證信、忘記密碼、Google 登入及 Google 連結。同一帳號目前只有一隻正式寵物；由 Worker 建立的寵物出生時間採伺服器時間，餵食冷卻由 D1 原子更新判定。既有 Owner Token 寵物可手動認領；認領後原密鑰立即失效。登入不自動覆蓋不同的本機寵物。

### 部署前設定（需要 Cloudflare / Google / Resend 管理權限）

1. **套用第二份 Migration**：`npx wrangler d1 migrations apply disui-db --remote`。這會依序套用尚未執行的 `migrations/0002_auth_accounts.sql`；**不要原地修改已套用的 `0001_create_pets.sql`**。
2. **Google 登入**：到 Google Cloud Console 設定 OAuth 同意畫面與「Web application」OAuth Client，將 `https://disui.noppl.cc` 加入 *Authorized JavaScript origins*。本專案採 GIS JavaScript callback，無需新增自訂 OAuth redirect callback URL。將 Client ID 設定在 Cloudflare Worker 的 `GOOGLE_CLIENT_ID` 環境變數。Client Secret **不需要**提供給此 ID Token callback 方案。
3. **Email 驗證／重設密碼**：到 <https://resend.com> 驗證寄件網域與必要 DNS（SPF/DKIM），取得 API Key。將 `RESEND_API_KEY` 與 `EMAIL_FROM`（例如 `滴歲 <noreply@你的已驗證網域>`）設為 Worker Secrets / Environment Variables。缺少這些設定時，Email 註冊會停用，**不會假裝寄信成功**。
4. **避免洩漏**：以上敏感值請在 Cloudflare 後台設定，或從專案目錄使用以下互動指令，**不要提交密鑰到 GitHub**：

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put EMAIL_FROM
```

可另外設定 `APP_ORIGIN=https://disui.noppl.cc`；未設定時 Worker 會使用目前正式網址。請先完成驗證網域再啟用 Email 註冊；可由 `GET /api/auth/config` 確認 `googleClientId` / `emailEnabled`。其中 Client ID 是可公開的識別碼，API 不會回傳 Email 寄件 API Key。

> **重要**：GitHub 推送／Cloudflare Worker 部署 **不會自動執行 D1 Migration**，未套用 0002 前登入 API 無法使用。首次部署或修改 Secrets 後，請檢查 Worker 建置是否重新部署，以及 Resend Domain 是否已通過驗證。

### 註冊失敗排查

如果設定頁的 Email 註冊或 Google 登入失敗，先查看 `https://disui.noppl.cc/api/auth/config`：

- `authSchemaReady: false`：表示 D1 帳號資料表尚未齊全，需執行 `npx wrangler d1 migrations apply disui-db --remote`（包含 `0002_auth_accounts.sql`）。設定頁會停止註冊並提供這項提示。
- `emailEnabled: false`：表示 Worker 未同時設定 `RESEND_API_KEY` 與 `EMAIL_FROM`；這只檢查是否設定，不代表 Resend 寄信一定成功。
- `googleClientId: null`：表示尚未設定 Google Client ID。

如果 `authSchemaReady: true` 且 `emailEnabled: true` 仍無法註冊，請確認 Resend 已驗證寄件網域與 `EMAIL_FROM` 一致，並查看 Cloudflare Worker Logs。若寄信失敗，API 會回傳 `EMAIL_DELIVERY_FAILED`（HTTP 502）；已新增未驗證帳號重新註冊時的重寄機制（寄送間隔至少 60 秒）。**錯誤訊息與 Console/Logs 不應包含 Email 驗證 Token、密碼或 API Key。**

### 帳號 API

| 方法 | 端點 | 功能 |
| --- | --- | --- |
| GET | `/api/auth/config` | Google Client ID / Email 服務是否設定 |
| POST | `/api/auth/register` | 建立待 Email 驗證帳號，寄送 30 分鐘有效驗證連結 |
| POST | `/api/auth/verify` | 驗證 Email，建立登入 Session |
| POST | `/api/auth/resend-verification` | 重寄驗證連結 |
| POST | `/api/auth/login` | Email / 密碼登入 |
| POST | `/api/auth/google` | 以 Google ID Token 登入／註冊 |
| POST | `/api/auth/google/link` | 登入後連結相同 Email 的 Google 帳號 |
| GET | `/api/auth/me` | 取得目前登入使用者 |
| POST | `/api/auth/logout` | 登出目前 Session |
| POST | `/api/auth/forgot-password` | 寄送 20 分鐘有效的密碼重設連結 |
| POST | `/api/auth/reset-password` | 重設密碼，撤銷原有 Sessions |
| GET | `/api/me/pet` | 取得帳號目前的滴歲 |
| POST | `/api/me/pet` | 由伺服器時間建立帳號滴歲 |
| POST | `/api/me/pet/claim` | 以現有 Owner Token 認領原有寵物 |
| POST | `/api/me/pet/feed` | 帳號驗證後伺服器餵食（12 小時冷卻） |
| POST | `/api/me/pet/rename` | 修改帳號寵物名稱 |

所有修改用 API 限制同來源 POST，登入使用 `HttpOnly; Secure; SameSite=Lax` Cookie（只提供給 `/api` 路徑），Session Token 在 D1 僅保存 SHA-256 Hash。密碼使用每帳號獨立 Salt 的 PBKDF2-SHA256；Google ID Token 經 Google JWK RSA 簽章驗證並檢查 `iss`、`aud`、`exp` 等聲明。不會僅因 Email 相同就自動合併 Google 與密碼帳號。

**目前限制**：只有最基本的 D1 請求次數限制；正式公開後仍建議加 Cloudflare WAF / Rate Limiting，並實作密碼變更、停用裝置 Session、完整刪除帳號、額外安全事件通知及跨裝置同步衝突管理。若 Email 寄信服務不可用，註冊與重設流程可能失敗；請勿把它當作已完成 Email 寄送的證據。

### 測試

```bash
node --test tests/*.test.mjs
```

GitHub Actions `.github/workflows/node-tests.yml` 會使用 Node.js 24 檢查 JS 語法及 API 整合測試；測試透過 Node 內建 SQLite 執行正式 Migration，並模擬寄送驗證信和 Google JWK。這不會操作遠端 D1 或寄送真實郵件。

## Roadmap（尚未完成）

以下是規劃優先級，尚未上線的功能不代表已完成或承諾交付時程。目標是先完善帳號、伺服器可信時間與同步，再擴展養成及社交玩法。目前僅有開發者本人使用，**不把既有本機資料向後相容或早期寵物轉正列為正式上線阻礙**。

### P0：帳號完善與完整雲端同步

- **已實作：Google 帳號登入**：Google Identity Services ID Token 由 Worker 驗證簽章、iss/aud/exp；以 sub 識別 Google 使用者，不要求 Google 密碼。正式啟用需另外設定 Client ID。
- **已實作：自行註冊帳號**：Email + 密碼註冊／登入、Email 驗證、重新寄信、忘記／重設密碼、Session、PBKDF2+Salt、基本 rate limit、HttpOnly/Secure/SameSite Cookie 及跨來源請求防護。正式啟用需設定寄信服務。
- **部分完成：多種登入方式**：登入後可連結 Google（同一 Email），不會因 Email 相同就自動合併兩個帳號；仍需安全的解除 Google 綁定、將密碼登入方式加入 Google-only 帳號與多裝置 Session 管理 UI。
- **已實作：帳號擁有的寵物**：由伺服器建立可信出生時間、帳號跨裝置讀取／餵食／更名，以及認領已擁有 Owner Token 的寵物（認領時舊 Token 會失效）。新裝置手動取回，未登入時仍可本機使用；不會自動覆蓋不同的本機小滴。
- **已實作：D1 資料模型**：0002 migration 包含 users、auth_identities、auth_sessions、auth_tokens、pet_owners、auth_rate_limits；不修改已執行的 0001。仍需視功能擴展帳號與寵物的一對多或遷移政策。
- **完整同步**：跨裝置更名、餵食、寵物狀態、復原／切換與解除綁定；處理重複請求、並發寫入、離線操作佇列、時間偏移、資料衝突及錯誤復原。伺服器裁決需要可信時間的事件，本機快照與 JSON 匯出仍保留。
- **帳號安全／救援**：多裝置 Session 撤銷、Owner Token 輪替與過渡、密碼重設、金鑰遺失情境；未經驗證的匿名小滴不得只憑名稱或任意聲稱擁有就進行認領。
- **防濫用與品質保證**：Cloudflare WAF / Rate Limiting，登入、註冊、建立寵物及餵食 API 限制；Migration、API、E2E 測試與部署驗證；新增靜態檔須同步更新 .assetsignore 及 PWA 快取版本。

### P0：上線後的可信時間與公平性

- **建立時即可信**：正式使用者註冊／登入後，由 Worker 以伺服器時間建立寵物出生紀錄；需要公平性的餵食、生命與成就事件也由伺服器裁決，不能只採信瀏覽器傳來的時間戳。
- **排行榜一致規則**：公開排行依可驗證資料計算，不能以修改資料來源標記取代真正的驗證。正式推出排行榜前應防止時間偽造、重送與並發操作。
- **開發期測試資料**：目前唯一使用者的早期小滴並非上線前的相容需求，可在備份後選擇保留作私人展示、一次性匯入，或重新建立。其原始歷史時間沒有可驗證的證據，就不宣稱已獲得伺服器歷史驗證；不需要為它特別實作 legacy/native 轉正系統。
- **分階段整理**：以新增 Migration、備份和測試處理 D1 結構；正式開放外部使用者之後，才將向後相容與資料不可破壞視為強約束。

### P1：Web Push、生命系統與養成互動

- **低頻提醒**：經明確同意後啟用 Web Push，提醒可餵食、飢餓、生病、危急及里程碑；提供通知開關、頻率、安靜時段、取消訂閱及多裝置去重。研究 Cloudflare 排程 + Web Push 與各平台支援差異。
- **完整生命規則**：健康值、生病治療、可能的死亡／復活與假期寬限機制。啟用不可逆事件前先定義明確規則、容錯及服務中斷保護，避免讓長期陪伴因短暫斷線而消失。
- **連續照顧與成就**：連續餵食紀錄、稀有成就、稱號與收藏機制；伺服器可信事件與本機離線事件分別設計統計規則。
- **日夜與情緒**：滴歲根據時間、互動、健康狀態出現睡眠、打哈欠、開心、難過或鬧脾氣等動畫；考慮減少動態效果與低階裝置效能。
- **分支進化**：除既有六個生命階段外，根據長期照顧風格、成就與互動產生不同外觀、性格或進化路線；不覆蓋已取得的里程碑與收藏資料。

### P2：好友、寵物拜訪、群組與排行榜

- **公開展示頁**：可分享寵物公開頁面、成長歷程與成就；使用者可選擇隱私程度，絕不公開 Email、Owner Token 或 Session 等私密資訊。
- **好友與拜訪**：好友邀請、查看朋友寵物、留言或互動足跡；需要隱私控制、封鎖與基本防騷擾限制。
- **群組及活動**：好友群組、期間活動與收藏獎勵，視實際使用情況分階段推出。
- **公平排行榜**：按已驗證的雲端陪伴時間、照顧紀錄、成就等分類比較；未驗證的本機歷史不直接混入可信時間榜單。

### 核心設計原則

1. **正式上線後**不隨意破壞使用者寵物資料；目前開發期只有一位測試使用者，允許在充分備份且明確同意後重新建立或一次性轉換測試寵物，不必讓早期資料限制長期架構。
2. Google 登入與自行註冊並存，避免身分重複、錯誤合併與帳號接管。
3. 正式可信時間從伺服器驗證開始；開發期本機歷史可供私人留念，但不能假裝其歷史時間已通過驗證。一般養成玩法不需要依據 legacy/native 來源區別待遇。
4. 離線優先、資料可匯出及清楚的衝突規則維持為核心設計。
5. 每階段開發都同步更新 README、D1 Migration、測試、部署資源白名單與 Service Worker 快取版本。

## 目前限制

- **早期密鑰寵物與帳號不同**：Owner Token 寵物仍可手動還原；帳號寵物由 Session 授權。只有帳號寵物目前能在伺服器同步改名；舊密鑰模式的名稱變更仍是本機操作。
- **本機時間並非可信來源**：目前以 `Date.now() - startedAt` 計算陪伴時間；開發者工具、JSON 匯入或裝置時間變更都可能影響結果。因此目前的出生時間限制只是產品介面規則，不具備公開競賽的防作弊能力。
- **尚無背景推播**：關閉 App 後不會由伺服器主動提醒餵食或里程碑。
- **照顧系統仍在調整**：已有餵食與健康狀態，但死亡、治療、復活及假期模式尚未實作。

希望先把「自己養一隻滴歲」做好，再慢慢把牠帶到雲端。


### 寵物 API（後端基礎）

除了直接呼叫 API，也可以從正式 HTTPS 網站的設定頁手動綁定並還原雲端寵物。餵食狀態已可以跨裝置刷新，但完整帳號式同步仍在規劃中。

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

有效 Token 才能取得寵物資料；缺少 Token 回傳 401，不匹配回傳 404。目前 **尚未提供帳號、帳號式身分復原及速率限制**（已支援 Token 輪替及憑 ID／密鑰還原），請勿把它視為完整正式帳號系統。公開啟用建立 API 前建議先加 Cloudflare WAF / Rate Limiting 防止惡意大量建立紀錄。


## 手動雲端綁定與餵食 API

正式 HTTPS 網站可在「設定 → 雲端備份」手動將**目前已出生**的本機寵物登錄為 `legacy`，保留既有出生時間與餵食次數；雲端另外記錄伺服器建立時間，**舊時間不適用於可信排行榜**。後端 `POST /api/pets/import` 收到 `{name,startedAt,lastFedAt,feedCount}` 才會寫入資料。綁定成功後請立即點「複製還原資訊」保存寵物 ID 與 64 位十六進位密鑰。密鑰只顯示於建立／輪替回應，D1 僅保存雜湊。

在另一裝置的設定頁使用 ID 與密鑰手動還原；若當前已有寵物會先確認並建立本機快照。雲端餵食透過 `POST /api/pets/:id/feed`，使用 Bearer Token，12 小時冷卻由後端以條件式原子更新判斷；未到時間回傳 HTTP 409。取得紀錄使用 `GET /api/pets/:id`；`POST /api/pets/:id/rotate-token` 會撤銷舊密鑰。解除此裝置綁定**不會刪除 D1 寵物**，也不會自動合併之後的本機餵食。

目前雲端與帳號寵物僅支援線上餵食；離線時會保留本機紀錄，但不會累積離線餵食佇列。雲端讀取失敗不覆蓋本機資料。不同裝置的雲端名稱修改、雙向合併、密鑰遺失找回、跨裝置推播與公開 API 防濫用限流尚未完成；正式開放大量使用者前必須於 Cloudflare 啟用 WAF / Rate Limiting。

**注意：** 舊 JSON 備份不包含雲端還原密鑰。清除網站資料前務必將還原資訊保存在其他安全位置，並另外保留 JSON 備份。
