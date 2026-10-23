# rcsolver

手機網頁版魔術方塊求解器（2x2～7x7）：引導拍攝六面 → Claude 辨色 → 核對修正 → 瀏覽器求解 → 3D 動畫引導。

目前進度：**里程碑 0，辨色準確率實驗頁**。規劃與待辦見 [docs/PLAN.md](docs/PLAN.md)。

## 本機執行

```bash
npm install
cp .env.example .env        # 填 RCSOLVER_ANTHROPIC_KEY；留空就是 MOCK 模式
npm run dev                 # http://localhost:3000
npm test
```

手機要開相機必須走 https（或 localhost）。要在手機上試本機伺服器，用 `npx wrangler dev --local --ip 0.0.0.0` 搭配 Cloudflare Tunnel，或直接部署。

## 部署到 Cloudflare Workers

```bash
npx wrangler login
npx wrangler secret put RCSOLVER_ANTHROPIC_KEY
npm run cf:deploy
```

靜態檔由 Workers Static Assets 直接供應，只有 `/api/*` 進 Worker。每日額度預設每個 isolate 各算一份；要全站共用，建一個 KV namespace 綁到 `QUOTA`（見 `wrangler.toml`）。

也能跑在任何 Node 主機（Render、Fly）：`npm run build && npm start`，記得設 `TRUST_PROXY=1`。

## 端點

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/health` | 模式、模型、今日用量 |
| POST | `/api/recognize` | `{ size, faces: { U,R,F,D,L,B: { mediaType, data(base64) } } }` → 每面 N 列顏色字母、每格信心 0–9、顏色數量警告、token 用量 |

照片只在記憶體中轉交給模型，不落地、不記 log。

## 拍攝順序與展開圖方向

前 → 右 → 後 → 左（每次整顆向左轉 90°，上面不動）→ 回到前面後向下翻 90° 拍上面 → 向上翻 180° 拍底面。這樣每張側面照的上方都是 U，上面照的上方是 B，底面照的上方是 F，正好是標準展開圖的方向，不需要旋轉圖片。
