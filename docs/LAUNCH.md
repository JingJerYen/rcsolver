# 上架前待辦

上架（Google Play / App Store）暫緩，先記下上架前要做的事。2026-10-25 整理。

## 一定要做

- [ ] **AI 辨識的額度與費用**
  - 現況：整站每天 100 次（`DAILY_LIMIT`）、每個 IP 每分鐘 6 次（`RATE_LIMIT_PER_MIN`），兩個都只記在單一 Worker isolate 的記憶體裡，人多時不準。
  - 接上 KV 讓每日上限跨 isolate 計算：`npx wrangler kv namespace create QUOTA`，把 id 填進 `wrangler.toml` 的 `[[kv_namespaces]]`（已有註解範本）。
  - 決定每人每天可用幾次，並想好用完時畫面怎麼說。
  - 決定怎麼付費：自己吸收、收費、廣告，或改用較便宜的模型（`RECOGNIZE_MODEL`，例如 Sonnet；換之前先用真實照片比對辨識率）。
  - 考慮防止有人繞過 App 直接打 `/api/recognize`（例如 Cloudflare Turnstile 或 App 端驗證）。
- [ ] **隱私權政策**
  - 照片會送到 Anthropic 辨識；兩家商店都要隱私權政策網址，還要填資料安全表單。
  - 寫一頁放在網站上（中英文），說明拍的照片送去哪、會不會保存、存檔只在手機上。
- [x] **名稱的商標風險**
  - 「Rubik's」是註冊商標，商店常因此退件或下架；畫面上方已從「Rubik Cube Solver」改成「Cube Solver」（2026-10-25）。
  - 上架時商店名稱、說明文字也不要用 Rubik（可以說「魔術方塊」「speed cube」）。
- [ ] **包成商店 App**
  - Google Play：用 TWA（Trusted Web Activity，可用 Bubblewrap 或 PWABuilder），需要 Digital Asset Links（`/.well-known/assetlinks.json`）。
  - App Store：需要原生外殼（例如 Capacitor），注意審核指南 4.2（只是網頁的 App 會被退）；相機權限要寫用途說明。
  - 商店截圖、說明文字（中英文）、圖示。

## 建議先做

- [ ] **小規模試用**：先把網址給 5–10 個人用一兩週，用不同的方塊（非標準配色、無貼紙）、不同光線，記下辨識失敗率。
- [ ] **錯誤回報與使用統計**：目前沒有，上架後出錯只能靠使用者告知。
- [ ] **語言**
  - 目前只有兩種：裝置第一語言是中文（含簡體 zh-CN）顯示繁體中文，其他所有語言都顯示英文。
  - 簡體中文使用者看到的是繁體；要不要加簡體版？
  - 商店上架的地區若有日文、韓文等，考慮是否加語言（文字都在 `tr()` 裡，加語言要把 `tr` 改成多語版）。
  - 品牌名旁的「魔術方塊」在所有語言都會顯示。
