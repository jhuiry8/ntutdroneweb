# 北科無人機社 官方網站暨動態管理系統 (NTUT Drone Club Website & CMS)

這是一個專為**國立臺北科技大學無人機社 (NTUT Drone Club)** 量身打造的官方網站與動態內容管理系統（CMS）。系統採用現代感的 **FPV 穿越機科技風**與**極客暗色美學**設計，並建構於高穩定、低延遲的 **Cloudflare Workers + KV** 無伺服器架構之上。

本專案特別結合了 **GitHub Actions 自動化部署 (CI/CD)** 與 **GitHub API 媒體庫整合**，讓您可以**完全在雲端進行網站的管理與發佈，無須在本地電腦執行任何部署指令**！

---

## 🌟 核心特色與架構優勢

1. **🚀 100% 雲端自動化部署 (Zero-Local Deployment)**
   * 結合 **GitHub Actions**，只要將程式碼推送到 GitHub 儲存庫（或在網頁端修改與審核），系統即會自動將安全金鑰動態注入並部署至 Cloudflare Workers，無須在本地端繁瑣安裝或執行 Wrangler 指令。
2. **🌐 雙語語系動態切換 (i18n Support)**
   * 前台頂端導覽列支援「中文 / English」即時切換，並以 Cookie 記憶使用者語言偏好。
   * 後台發佈文章與頁面時，皆可指定專屬語系，實現真正的多語系國際化動態網站。
3. **📁 GitHub 媒體庫整合 (Cloud Image Storage)**
   * 在後台編輯器中直接選取或拖放圖片，系統會透過 Cloudflare Worker 自動將檔案提交（Commit）至本 GitHub 儲存庫的 `public/assets/uploads/` 目錄中。
   * 圖片上傳後直接享有 Cloudflare 全球 CDN 加速，無須任何額外圖床或外部儲存成本！
4. **📝 動態頁面與文章管理 (CMS Dashboard)**
   * **動態部落格**：支援 Markdown 完整語法，編輯時可即時預覽。
   * **獨立頁面生成器**：免改程式碼！可在後台任意建立如 `/page/info`、`/page/join` 等專屬客製化網頁。
5. **✨ 極客風炫酷主視覺**
   * **Telemetry 動態背景**：以 Canvas 繪製遙測格線與互動式連線粒子效果。
   * **3D 互動飛機浮動**：Hero 區塊的無人機視覺圖隨滑鼠移動進行 3D 姿態偏轉。

---

## 🚀 完整部署教學 (完全免本地指令流程)

本網站已經為您設定好自動化部署管線（CI/CD），您只需要完成以下簡單的雲端設定，即可啟用一鍵發佈功能！

### 第一步：在 Cloudflare 準備所需資源
1. 登入 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2. **建立 KV 資料庫**：
   * 前往 **Workers & Pages** -> **KV** -> 點擊 **Create Namespace**。
   * 命名為 **`DRONE_DB`**，點擊 Add 建立。
   * 建立成功後，複製此 KV 的 **ID**（一串英數字元，例如 `abc123e456...`）。
3. **取得 Cloudflare Account ID**：
   * 在 Cloudflare 控制台右下角（或網址列中）找到並複製您的 **Account ID**。
4. **建立 API Token (用於部署授權)**：
   * 點擊右上角個人頭像 -> **My Profile** -> **API Tokens** -> **Create Token**。
   * 選擇 **Edit Cloudflare Workers** 模板（或自訂權限包含 `Workers KV Storage:Edit`, `Workers Routes:Edit`, `Workers Scripts:Edit`）。
   * 建立後，複製並妥善保存這組 **API Token**。

### 第二步：在 GitHub 儲存庫設定環境金鑰 (Repository Secrets)
為了安全起見，我們不把敏感的 ID 與金鑰直接寫入程式碼，而是設定在 GitHub 的安全機密庫中，由 GitHub Actions 自動注入：
1. 進入您的 GitHub 儲存庫 (`jhuiry8/ntutdroneweb`) -> 點擊上方 **Settings (設定)**。
2. 左側選單展開 **Secrets and variables** -> 點擊 **Actions**。
3. 在 **Repository secrets** 區塊，點擊 **New repository secret**，依序新增以下 3 個安全機密變數：

| Secret 名稱 | 填入的內容 | 作用說明 |
| :--- | :--- | :--- |
| **`CLOUDFLARE_ACCOUNT_ID`** | 您在第一步取得的 Cloudflare 帳戶 ID | 授權 Wrangler 部署到您的帳號 |
| **`CLOUDFLARE_API_TOKEN`** | 您在第一步建立的 Cloudflare API Token | 執行自動部署的權限憑證 |
| **`CLOUDFLARE_KV_ID`** | 您在第一步建立的 `DRONE_DB` KV Namespace ID | **安全注入**到 KV 資料庫綁定中 |

> 🎉 **自動化驗證與發佈**：設定完成這 3 個 Secrets 後，只要您在專案有任何 Push 行為（或在 Actions 頁面手動觸發），系統便會開始執行 `.github/workflows/deploy.yml`，自動完成打包、金鑰注入與 Cloudflare Workers 發佈！您可以隨時到 GitHub **Actions** 分頁查看綠色的成功打勾圖示。

### 第三步：在 Cloudflare 後台設定 GitHub 圖片上傳權限
為了讓 CMS 後台能夠把您上傳的圖片儲存回 GitHub 專案中，請在 Cloudflare 後台加上授權變數：
1. **取得 GitHub Token**：
   * 前往 GitHub 右上角頭像 -> **Settings** -> **Developer settings** -> **Personal access tokens** -> **Tokens (classic)**。
   * 點擊 **Generate new token (classic)**，勾選 **`repo`** (完整控制儲存庫) 權限，產生後複製該 Token。
2. **在 Cloudflare Workers 設定變數**：
   * 進入 [Cloudflare 控制台](https://dash.cloudflare.com/) -> **Workers & Pages** -> 點選自動部署建立的 **`ntut-drone-web`** 服務。
   * 點選 **Settings (設定)** -> **Variables and Secrets (變數與機密)**。
   * 在 **Environment Variables / Secrets** 區塊中新增以下兩項：
     * **`GITHUB_TOKEN`** : 點選右側的 **Encrypt (加密/機密)** 按鈕，填入剛才取得的 GitHub Token。
     * **`GITHUB_REPO`** : 填入儲存庫名稱：`jhuiry8/ntutdroneweb` (不需要加密)。
   * 點擊 **Save and Deploy (儲存並部署)** 即可立即生效！

---

## 💻 網站使用與後台操作指南

部署成功後， Cloudflare 會給予您一個專屬網址（例如 `https://ntut-drone-web.您的帳號.workers.dev`，也可以在 Cloudflare 後台綁定自訂網域）。

### 1. 後台登入與密碼安全
* **後台登入網址**：`https://您的網站網址/admin`
* **預設登入帳號**：`admin`
* **預設登入密碼**：`admin123`
* ⚠️ **安全性強烈建議**：首次成功登入後，請立即前往後台右上方的 **「系統設定」** 分頁，將預設密碼修改為您專屬的安全密碼！

### 2. 文章管理 (Blog Posts)
* 在 **「文章管理」** 分頁點擊「新增文章」。
* 輸入**文章標題**與**網址代稱 (Slug)**（例如 `welcome-to-drone-club`，將對應至 `/blog/welcome-to-drone-club`）。
* 選擇**語言類別**（`zh` 為中文，`en` 為英文）。
* 在內容編輯器中使用 Markdown 語法撰寫，可利用右側預覽視窗即時確認效果。

### 3. 圖片上傳與引用 (Image Uploads)
* 在文章或頁面編輯時，點擊下方 **「雲端上傳圖片」** 的雲端圖示或拖放圖片至該區域。
* 系統會立即在後台顯示圖片縮圖，並會提示已將圖片提交至 GitHub。
* 點擊縮圖下方的 **「複製 MD」** 按鈕，即可獲得類似 `![檔名](/assets/uploads/圖片.jpg)` 的語法，直接貼入文章內容中即可！
  > 💡 **同步小撇步**：圖片上傳後會儲存在 GitHub 中，並觸發約 30 秒的 GitHub Actions 自動 CDN 同步。後台會立即以本地暫存縮圖預覽，待同步完成後，前台訪客即可透過超高速 Cloudflare CDN 瀏覽圖片。

### 4. 獨立網頁建立 (Custom Pages)
* 如果您需要為社團迎新、比賽報名或贊助招商建立專屬介紹頁，前往 **「頁面管理」** -> 「新增獨立網頁」。
* 填寫標題與路徑（例如 `join-us`），儲存後即可直接透過 `https://您的網站網址/page/join-us` 分享給所有人，無須修改任何一行程式碼！

---

## ⚠️ 錯誤自查與排除指南 (Troubleshooting)

為了協助您在運營時快速排解任何潛在問題，以下整理了三個常見的驗證檢查點：

1. **Q: 為什麼 GitHub Actions 顯示失敗 (紅叉)？**
   * **檢查原因**：最常見的原因是未設定 `CLOUDFLARE_KV_ID` 等機密變數。
   * **解決方式**：點進 GitHub Actions 的失敗 Log，若看到 `CLOUDFLARE_KV_ID secret is not set...`，請回到 GitHub Settings -> Secrets and variables -> Actions 補齊該金鑰即可。
2. **Q: 為什麼在上傳圖片時跳出「Worker 尚未設定 GITHUB_TOKEN」或「GitHub API 錯誤」？**
   * **檢查原因**：Cloudflare Worker 無法驗證 GitHub 寫入權限。
   * **解決方式**：請回到 Cloudflare 控制台 -> `ntut-drone-web` -> Settings -> Variables and Secrets，確認 `GITHUB_TOKEN` (需有 `repo` 權限) 與 `GITHUB_REPO` (`jhuiry8/ntutdroneweb`) 皆正確輸入並儲存。
3. **Q: 前台或後台讀取資料顯示 500 錯誤？**
   * **檢查原因**：KV 資料庫綁定遺失或名稱不符。
   * **解決方式**：請在 Cloudflare 後台的 Worker 設定確認 **KV Namespace Bindings** 中，`DRONE_DB` 變數名稱有正確指向您在第一步建立的 KV Namespace。

---

## 📄 授權與版權宣告 (Proprietary License)
本網站與動態內容管理系統專案為 **國立臺北科技大學無人機社 (NTUT Drone Club)** 開發與擁有之智慧財產。
採用 **[版權所有 / 須經同意與授權專用協議 (Proprietary License)](LICENSE)**。未經社團官方與版權所有人事前明確之書面授權或同意，嚴禁擅自複製、修改、散佈或將本程式碼部署使用於任何商業與非商業環境。
