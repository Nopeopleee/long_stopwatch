# 滴派

專門拿來「養碼表」的超輕量 PWA。

## 功能

- 不需要背景常駐，只保存 `startedAt` 時間戳。
- 關閉 App、重開手機後仍可正確顯示。
- 可以手動設定出生時間。
- 可安裝到 Android 主畫面。
- Service Worker 離線可用。
- 長按 2 秒才會重置，避免手滑。
- JSON 匯出 / 匯入備份。
- 1 / 7 / 30 / 100 / 365 / 1000 天里程碑。

## 本機測試

Service Worker 需要 HTTPS 或 localhost。

```bash
npx serve .
```

或：

```bash
python -m http.server 8080
```

然後開 `http://localhost:8080`。

## 計時原理

```js
Date.now() - startedAt
```

所以它不是真的讓一個 timer 在背景跑幾年。

> 注意：清除瀏覽器網站資料 / PWA 儲存空間仍會刪掉 localStorage，所以養很久時建議偶爾匯出備份。
