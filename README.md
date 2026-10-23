# rcsolver

手機網頁版魔術方塊求解器（2x2～7x7）：引導拍攝六面 → Claude 辨色 → 核對修正 → 瀏覽器求解 → 3D 動畫引導。

目前進度：**3×3 完整流程可用**（拍攝引導 → 辨色 → 核對修正 → min2phase 求解 → 3D 動畫逐步引導）。規劃與待辦見 [docs/PLAN.md](docs/PLAN.md)。

## 本機執行

```bash
npm install
cp .env.example .env        # 填 RCSOLVER_ANTHROPIC_KEY；留空就是 MOCK 模式
npm run dev                 # http://localhost:3000
npm test
```

手機要開相機必須走 https（或 localhost），所以用手機實測最簡單的方式就是部署上去。

## 部署到 Cloudflare（設定一次，之後推 main 就自動部署）

1. 到 Cloudflare dashboard → Workers & Pages → Create → 選「Import a repository」，連結 GitHub 的 `rcsolver`，分支選 `main`。
   建置設定保持預設（deploy command 是 `npx wrangler deploy`，前端會在部署時自動打包）。
2. 建好後到這個 Worker 的 Settings → Variables and Secrets，新增 Secret `RCSOLVER_ANTHROPIC_KEY`，貼上專用金鑰。
3. 網址是 `https://rcsolver.<你的帳號>.workers.dev`，已經是 https，手機直接開就能用相機。
   之後每次推到 main，Cloudflare 會自己重新部署；dashboard 的 Logs 看得到每次辨識的 token 用量。

不想連 GitHub 也可以手動：`npx wrangler login`、`npx wrangler secret put RCSOLVER_ANTHROPIC_KEY`、`npm run cf:deploy`。

每日額度（`DAILY_LIMIT`）預設每個 Worker isolate 各算一份，只是粗略的保險；要全站精確共用，建一個 KV namespace 綁到 `QUOTA`（`wrangler.toml` 有範例）。模型、effort、限流都在 `wrangler.toml` 的 `[vars]` 改，改完推上去就生效。

也能跑在任何 Node 主機（Render、Fly）：`npm run build && npm start`，記得設 `TRUST_PROXY=1`。

## 端點

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/health` | 模式、模型、今日用量 |
| POST | `/api/recognize` | `{ size, faces: { U,R,F,D,L,B: { mediaType, data(base64) } } }` → 每面 N 列顏色字母、每格信心 0–9、顏色數量警告、token 用量 |

照片只在記憶體中轉交給模型，不落地、不記 log。

## 拍攝順序與展開圖方向

前 → 右 → 後 → 左（每次整顆向左轉 90°，上面不動）→ 回到前面後向下翻 90° 拍上面 → 向上翻 180° 拍底面。這樣每張側面照的上方都是 U，上面照的上方是 B，底面照的上方是 F，正好是標準展開圖的方向，不需要旋轉圖片。
