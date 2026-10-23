# rcsolver

**▶ 立刻用手機玩：<https://rcsolver.yanglassnake.workers.dev/>**

手機網頁版魔術方塊求解器（2x2～7x7）：引導拍攝六面 → Claude 辨色 → 核對修正 → 瀏覽器求解 → 3D 動畫引導。

<p align="center"><img src="docs/demo.gif" width="300" alt="拍六面 → 辨色 → 3D 動畫一步一步帶你轉"></p>

目前進度：**2×2 到 7×7 完整流程可用**（拍攝引導 → 辨色 → 核對修正 → 求解 → 3D 動畫逐步引導）。求解器都在瀏覽器裡跑：2×2 用 IDA*，3×3 用 min2phase，4×4 到 7×7 用 reduction（中心 → 翼塊配對 → parity → 當 3×3 解），解出來的步驟一律先在內部模型重播確認能復原。步數大約：4×4 120、5×5 280、6×6 480、7×7 750。規劃與待辦見 [docs/PLAN.md](docs/PLAN.md)。

解題畫面有**導覽模式**（按方塊右上角的「?」開啟，預設關閉）：上方的階段籤（中心 → 邊塊 → 特殊修正 → 3×3）顯示目前進度，點一下可跳到那一段；並有一小段文字說明這一段的策略。

大方塊的中心查表（`web/tables/`，全部約 0.8 MB）是離線算好的，頁面在需要時才抓對應尺寸的那幾個檔；抓不到就在瀏覽器裡現算。產生器：`npm run gen:macros`（4×4 翼塊 3-循環公式庫）、`npm run gen:centre-macros 5`（某尺寸的中心公式庫）、`npm run gen:tables`（所有中心查表）。改了中心求解的走法集合後要重跑 `gen:tables`，測試會提醒。

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

## 分享狀態

辨識畫面的複製鈕會複製 Kociemba 格式的 facelet 字串：面的順序 U R F D L B，每面逐列，每格一個字母代表這張貼紙屬於哪一面（3×3 復原狀態是 `UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB`）。奇數階以中心決定面，偶數階以 DBL 角決定。首頁的貼上鈕可以匯入這種字串（也接受 W Y R O G B 顏色字母）直接重現狀態。

解題畫面的儲存鈕把初始狀態、解法和進度存在瀏覽器裡（不限筆數），首頁列出縮圖可以點回去繼續；每筆的分享鈕（解題畫面也有）複製一個短連結 `#z=<token>`：token 是 base64url，內含尺寸、每 3 格一個位元組的貼紙顏色和走到的步數；解法不放進去，因為求解器是確定性的，對方打開會重算出同一段解（匯入的非本程式解法才會一起帶）。舊格式 `#s=<facelets>&m=<解法>&i=<步數>` 仍可開啟。

## 端點

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/health` | 模式、模型、今日用量 |
| POST | `/api/recognize` | `{ size, faces: { U,R,F,D,L,B: { mediaType, data(base64) } } }` → 每面 N 列顏色字母、每格信心 0–9、顏色數量警告、token 用量 |

照片只在記憶體中轉交給模型，不落地、不記 log。

## 拍攝順序與展開圖方向

前 → 右 → 後 → 左（每次整顆向左轉 90°，上面不動）→ 回到前面後向下翻 90° 拍上面 → 向上翻 180° 拍底面。這樣每張側面照的上方都是 U，上面照的上方是 B，底面照的上方是 F，正好是標準展開圖的方向，不需要旋轉圖片。
