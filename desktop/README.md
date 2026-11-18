# 北科無人機社 社務管理系統（桌面版）

![主畫面](docs/screenshot.png)

安裝在電腦上使用的社務管理程式，採 2010 年代的傳統 Windows 視窗介面（選單列、工具列、左側功能樹、表格、狀態列、新細明體 9 點字）。
程式直接連到社團網站的後端（Cloudflare Workers），**資料與網站後台共用**：在桌面版修改的內容，網站上會立即看到，反之亦然。

## 功能

| 功能 | 可使用的角色 | 說明 |
| :--- | :--- | :--- |
| 社員名冊 | 社長、財務 | 查詢、篩選、新增、修改、刪除、全選與批次修改身分或社費、匯入 CSV |
| 社費簽收紀錄 | 社長、財務 | 登錄社費簽收（自動更新社員社費狀態）、刪除紀錄、本學期合計 |
| 表單作業 | 所有人（社員只看得到自己填的） | 六種紙本表單：社費支出事前申請單、事後報銷單、設備借據、學生活動申請表、活動報告表、公文。可新增、修改、刪除、列印、列印空白表單 |
| 　└ AI 協助填寫 | 所有人（公文限幹部） | 用口語描述，AI 整理成表單欄位，確認後再儲存 |
| 　└ AI 白話轉公文 | 幹部以上 | 白話內容改寫成「函／簽／公告」的主旨與說明 |
| 收支帳目 | 社長、財務 | 帳戶摘要、新增收支、社長核准／退回、刪除已退回帳目、預算分類與執行率 |
| 器材清冊 | 社長、財務、幹部 | 查詢、新增、修改器材（財產編號由伺服器自動產生） |
| 選舉管理 | 社長、幹部 | 新增選舉、登錄候選人（選舉公報）、公告；社長開始／結束投票、公布結果；稽核紀錄（IP、裝置、異常提示）與開票結果，可匯出 CSV。選民投票在網站 `/vote` 頁面進行 |
| 社團法規查詢 | 所有人 | 唯讀瀏覽目前生效的章程與細則 |
| 我的帳號 | 所有人 | 帳號資料、綁定的社員資料、社費繳費紀錄、變更密碼 |

* 每個表格都可以用「檔案 → 匯出 CSV」（Ctrl+E）匯出成 Excel 可開啟的檔案。F5 重新整理。
* 表單列印會用瀏覽器開啟 A4 版面，再按「列印／另存 PDF」。
* AI 功能使用網站設定的 `GROQ_API_KEY`（或 `GEMINI_API_KEY`），每人每日有使用次數上限；網站沒設定金鑰時按鈕會停用。
* 權限與網站後台相同，由伺服器判斷；看不到的功能代表您的帳號角色沒有權限。

## 安裝

1. 到 GitHub 儲存庫的 **Releases**，下載最新的 `ClubDesk-Setup-x.y.z.exe`（約 15–20 MB）。
2. 執行安裝程式，依照精靈「下一步」即可。預設只安裝給目前的使用者，**不需要系統管理員權限**；會建立開始功能表捷徑，可選擇建立桌面捷徑。
3. 第一次執行時 Windows 可能顯示「Windows 已保護您的電腦」（程式沒有付費的程式碼簽章），按「其他資訊 → 仍要執行」。
4. 登入畫面輸入：
   * **伺服器網址**：社團網站的網址，例如 `https://ntut-drone-web.xxxx.workers.dev`
   * **帳號／密碼**：與網站後台相同
   * **驗證碼**：與網站登入相同的圖片驗證碼

解除安裝：Windows「設定 → 應用程式」或開始功能表的「解除安裝」。

> 若網站設定了 Cloudflare Turnstile（`TURNSTILE_SECRET_KEY`），桌面版無法登入，需改用網站內建的圖片驗證碼。

## 自動更新

程式每次開啟登入畫面時，會向網站的 `GET /api/desktop/version` 詢問最新版本。有新版本時會詢問是否更新，按「立即更新」後：

1. 從 GitHub Release 下載新的安裝程式（顯示下載進度）。
2. 核對 SHA-256，與社長發布的不符就刪除，不會執行。
3. 執行安裝程式並關閉舊版，安裝完成即是新版本（社員資料都在網站上，不受影響）。

也可以從「說明 → 檢查更新」手動檢查。社長可把某個版本設為「必要更新」，舊版就必須更新才能使用。

### 發布新版本（給維護者）

1. 修改 `desktop/clubdesk/__init__.py` 的 `__version__`，例如 `1.2.0`，合併到 `main`。
2. 在 `main` 上建立並推送標籤 `desktop-v1.2.0`：
   ```bash
   git tag desktop-v1.2.0
   ```
   ```bash
   git push origin desktop-v1.2.0
   ```
3. GitHub Actions（Desktop App）會自動打包安裝程式，並建立 GitHub Release，說明中附上 SHA-256。
4. 社長用桌面版「工具 → 發布桌面版更新」，按「從 GitHub 最新 Release 帶入」，確認後按確定。之後所有社員開啟程式就會收到更新通知。

網站端只接受 `https://github.com/` 的下載網址，且只有社長能發布。

## 檔案大小

只打包程式用到的 Qt 元件（QtCore、QtGui、QtWidgets、QtSvg），不含 QML、Quick、PDF、網路模組與 20 MB 的軟體 OpenGL，HTTP 使用 Python 內建的 urllib。
安裝程式約 15–20 MB，安裝後約 50 MB；打包流程會檢查安裝程式不得超過 50 MB。

## 開發者：從原始碼執行

需要 Python 3.10 以上。

```bash
cd desktop
```
```bash
python -m venv .venv
```
```bash
.venv\Scripts\activate
```
```bash
pip install -r requirements.txt
```
```bash
python main.py
```

（macOS／Linux 的啟用指令為 `source .venv/bin/activate`。）

連到本機測試伺服器：在專案根目錄執行 `npx wrangler dev`，登入畫面的伺服器網址填 `http://127.0.0.1:8787`。

執行測試（不需要伺服器）：

```bash
python -m unittest discover -s tests
```

自行打包（Windows，需安裝 [Inno Setup 6](https://jrsoftware.org/isinfo.php)）：

```bash
pip install pyinstaller
```
```bash
pyinstaller --noconfirm ClubDesk.spec
```
```bash
iscc /DAppVersion=1.1.0 installer\ClubDesk.iss
```

安裝程式產生在 `desktop/dist/`。

## 程式結構

```
desktop/
├── main.py                 程式進入點
├── ClubDesk.spec           PyInstaller 打包設定（只保留需要的 Qt 元件）
├── installer/              Inno Setup 安裝精靈腳本與繁體中文語系檔
├── clubdesk/
│   ├── api.py              與網站後端溝通（/api/*）、登入與驗證碼
│   ├── updater.py          檢查、下載、驗證並安裝新版本；社長發布更新
│   ├── formschema.py       六種表單的欄位定義（與 src/forms.js 一致）
│   ├── style.py            傳統視窗外觀（灰色立體按鈕、深藍選取色、新細明體）
│   ├── widgets.py          共用表格、頁面框架、錯誤訊息
│   ├── login.py            登入視窗
│   ├── mainwindow.py       主視窗（選單、工具列、功能樹、狀態列）
│   └── pages/              各功能畫面
└── tests/                  單元測試
```

使用 Python + PySide6（Qt）撰寫原生視窗介面，不使用網頁技術。
`installer/ChineseTraditional.isl` 取自 Inno Setup 專案的非官方繁體中文翻譯。
