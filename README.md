# 北科無人機社 官方網站暨動態管理系統 (NTUT Drone Club Website & CMS)

這是一個專為**國立臺北科技大學無人機社**量身打造的官方網站，採用現代感十足的 FPV 穿越機科技風設計，並結合 **Cloudflare Workers** 路由與 **Cloudflare KV** 資料庫，建置出一個輕量、反應極快且具備安全後台（CMS）的動態網站。

您可以利用後台隨時發佈社團最新文章、動態建立新的獨立頁面，並直接將圖片上傳提交（Commit）至 GitHub 儲存庫作為永久媒體庫。

---

## 🌟 核心特色
1. **動態部落格文章**：後台支援 Markdown 語法，隨時撰寫及編輯，前台自動渲染。
2. **獨立網頁生成器**：免改程式碼！可在後台任意新增如 `/page/info` 這樣的客製化網頁。
3. **GitHub 媒體庫整合**：後台可直接拖放上傳圖片，自動透過 GitHub API 提交到專案中，回傳網址供文章引用，零外部儲存成本。
4. **極客風炫酷主視覺**：
   * **Telemetry 背景**：Canvas 動態繪製的遙測格線與互動連線粒子效果。
   * **3D 滑鼠動態無人機**：Hero 區塊的無人機圖片會隨滑鼠移動進行 3D 姿態偏轉。
   * **響應式設計**：完美支援手機、平板、桌機瀏覽。

---

## 📁 專案目錄結構
```
ntut/
├── src/
│   ├── worker.js       # Cloudflare Worker 路由、API 與 GitHub 整合邏輯
│   └── templates.js    # 動態 HTML 模板 (前台與 CMS 後台面版)
├── public/             # 靜態資源 (由 Cloudflare Workers Assets 自動託管)
│   ├── style.css       # 網站樣式表 (FPV 暗色主題)
│   ├── main.js         # 前端動態腳本 (粒子、Parallax、計數器)
│   └── assets/
│       ├── images/     # 內建視覺圖片 (fpv_drone_hero.jpg)
│       └── uploads/    # 上傳的圖片會提交至此 (含 .gitkeep)
├── wrangler.toml       # Cloudflare Workers 與 KV 設定檔
├── package.json        # 專案相依性套件與腳本
├── LICENSE             # MIT 授權條款
└── README.md           # 本說明文件
```

---

## 💻 本地開發與測試

1. **安裝環境與套件**：
   確保您的電腦已安裝 [Node.js](https://nodejs.org/) (建議 v18 以上)。在專案目錄下執行：
   ```bash
   npm install
   ```

2. **啟動本機開發伺服器**：
   ```bash
   npm run dev
   ```
   Wrangler 將會啟動一個本機 Worker 模擬環境，您可以在瀏覽器開啟提供的本機網址（預設為 `http://localhost:8787`）進行功能測試與後台操作。

---

## 🚀 部署至 Cloudflare Workers

### 第一步：在 Cloudflare 建立 KV 資料庫
1. 登入 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2. 前往 **Workers & Pages** -> **KV**。
3. 點擊 **Create Namespace**，命名為 `DRONE_DB`。
4. 複製該 KV 的 **ID**。
5. 打開專案中的 `wrangler.toml`，將其替換至 `id` 欄位：
   ```toml
   [[kv_namespaces]]
   binding = "DRONE_DB"
   id = "這裡貼上您的 KV 空間 ID"
   ```

### 第二步：設定 GitHub 權限金鑰 (用於圖片上傳)
為了讓後台能代表您將圖片提交到 GitHub：
1. 進入您的 **GitHub Settings** -> **Developer settings** -> **Personal access tokens** -> **Tokens (classic)**。
2. 點擊 **Generate new token (classic)**，勾選 **`repo`** 權限以允許提交檔案。
3. 產生後複製該 Token。
4. 在您的本端專案終端機執行以下指令，將其安全地存入 Cloudflare Worker 的 Secrets 中：
   ```bash
   npx wrangler secret put GITHUB_TOKEN
   # 當提示時，貼上剛才複製的 GitHub Token
   
   npx wrangler secret put GITHUB_REPO
   # 當提示時，輸入您的儲存庫路徑，例如：jhuiry8/ntutdroneweb
   ```

### 第三步：一鍵部署發佈
執行部署指令：
```bash
npm run deploy
```
終端機將會顯示部署成功，並給予您一條專屬的網頁網址！

---

## 🔑 後台登入說明
* **後台路徑**：`https://您的網址/admin`
* **預設密碼**：`admin123`
* **密碼修改**：成功登入後，請立即前往 **系統設定** 分頁修改為您自訂的密碼以確保安全。

---

## 📄 授權條款
本專案採用 **MIT License** 授權。詳見 [LICENSE](LICENSE) 檔案。
