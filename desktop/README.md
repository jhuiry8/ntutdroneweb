# 北科無人機社 社務管理系統（桌面版）

![主畫面](docs/screenshot.png)

安裝在電腦上使用的社務管理程式，採正統 Windows 98 / 2000 經典視窗介面（灰色 3D 浮雕按鈕、下凹輸入框、新細明體 9 點點陣字、經典深藍選取列、MMC 漸層標題列、選單列、工具列、左側功能樹、狀態列）。
程式直接連到社團網站的後端（Cloudflare Workers），**資料與網站後台共用**：在桌面版修改的內容，網站上會立即看到，反之亦然。

## 🌟 1.2.0 重點特色與完整功能

### 功能列表

| 功能分類 | 功能名稱 | 可使用的角色 | 說明 |
| :--- | :--- | :--- | :--- |
| **社團通訊** | 聊天室 | 所有人 | 全體聊天室、幹部限定群組、指定成員小組、公告用唯讀頻道；支援訊息編輯與刪除 |
| | 私人訊息 | 所有人 | 與社團成員一對一私訊，具備已讀標記與即時輪詢刷新 |
| | 社團公告 | 所有人（發布限幹部） | 社團重大事項公告，支援置頂、幹部限定、已讀名單統計、連動外部推播 |
| | 系統匣與未讀提示 | 所有人 | 縮小至系統匣背景執行，新訊息氣泡推播提示，功能樹即時顯示紅色未讀計數徽章 |
| **網站管理** | 文章管理 | 社長、一般幹部 | 官網最新消息與部落格發布；完整 Markdown 工具列、即時預覽、本機自動存檔草稿、.md 匯入匯出與全站打包備份 |
| | 獨立頁面管理 | 社長、一般幹部 | 自訂客製化介紹頁面（如 `/page/join` 等），免改後端程式碼即可新增編輯 |
| | 首頁外觀設定 | 社長、一般幹部 | 調整官網首頁 Hero 標題、說明文字、加入社團按鈕連結與引導文字 |
| | 外部推播設定 | 社長 | 選用推播模組：支援 Discord、Slack、Google Chat、Microsoft Teams Webhook 與 LINE 官方帳號廣播（Messaging API） |
| **會議與大會** | 會議與社員大會 | 所有人（幹部可主持） | 定期／臨時社員大會、幹部會議；AI 產生開會通知、現場學號簽到碼、應出席法定人數自動試算、無記名線上投票（章程門檻自動判定）、現場紀錄與 AI 一鍵生成正式會議紀錄並定稿 |
| **AI 工具** | AI 助理 | 所有人 | 聊天式查詢社費、帳目、設備、法規條文與表單進度，並提供快捷操作建議 |
| | 每週社務報告 | 幹部 | 每週一自動統整社務狀態，AI 生成財務、社員動態、器材借用與待辦摘要 |
| | AI 整理名單 | 社長、財務 | 貼上雜亂文字或非結構化名單，AI 自動分析並整理成社員匯入表格 |
| | AI 財務審查 | 社長、財務 | 智慧比對重疊交易、超過 14 天待審核款項、自動推薦預算科目分類 |
| | 舊帳本 CSV 匯入 | 社長、財務 | 相容歷屆 Excel 與 Google 試算表格式，智慧辨識收入、支出與劃撥轉帳 |
| **行政與財務** | 社員名冊 | 社長、財務 | 查詢、篩選、新增、修改、刪除、全選與批次修改身分或社費、匯入 CSV |
| | 社費簽收紀錄 | 社長、財務 | 登錄社費簽收（自動更新社員社費狀態）、刪除紀錄、本學期合計 |
| | 收支帳目 | 社長、財務 | 帳戶摘要、新增收支、社長核准／退回、刪除已退回帳目、預算分類與執行率 |
| | 器材清冊 | 社長、財務、幹部 | 查詢、新增、修改器材（財產編號由伺服器自動產生） |
| **表單作業** | 紙本簽核表單 | 所有人（社員限查個人） | 六種紙本表單：社費支出事前申請單、事後報銷單、設備借據、學生活動申請表、活動報告表、公文。可新增、修改、刪除、列印空白或填寫後表單 |
| | 　└ AI 協助填寫 | 所有人（公文限幹部） | 口語描述借用或報銷事由，AI 自動對應填寫至表單對應欄位 |
| | 　└ AI 白話轉公文 | 幹部以上 | 白話事由一鍵潤飾改寫為合乎學校規範之函、簽、公告格式 |
| **系統與輔助** | 社團法規查詢 | 所有人 | 唯讀瀏覽最新生效之組織章程、各級施行細則與學校法規 |
| | 我的帳號 | 所有人 | 檢視綁定之社員身分、表決權資格、歷年社費紀錄、變更登入密碼 |
| | 內建使用教學 | 所有人 | 隨時按下 **F1 鍵** 或從「說明 → 使用教學」查看全功能操作手冊 |
| | 首次啟動導覽 | 所有人 | 首次安裝登入後自動彈出歡迎精靈，指引快速上手 |

* 每個表格都可以用「檔案 → 匯出 CSV」（Ctrl+E）匯出成 Excel 可開啟的檔案。F5 重新整理。
* **匯出 Word（.docx）**：「檔案 → 匯出 Word」（Ctrl+Shift+E）把目前畫面存成可列印的 Word 文件（新細明體、表頭每頁重複、頁碼頁尾，欄位多時自動橫向）。
  * 一般表格：匯出目前顯示的資料（套用目前的查詢與排序）。
  * 文章／頁面：選取一篇時匯出全文（標題、摘要、內文格式、表格）；編輯器內也有「匯出 Word」。
  * 會議：選取一場時匯出完整會議資料（基本資料、開會通知、各案表決結果、出席名單、會議紀錄、簽名欄）；會議視窗的「會議紀錄」分頁也有按鈕。
  * 社團法規彙編、社課備忘錄、社團公告、社團週報、首頁設定、AI 助理對話、目前的聊天對話紀錄。
  * 不需安裝 Office 外掛，程式內建 .docx 產生器（clubdesk/docx.py，只用 Python 標準函式庫，不增加安裝檔大小）。
* 表單列印會用瀏覽器開啟 A4 版面，再按「列印／另存 PDF」。
* AI 功能使用網站設定的 `GROQ_API_KEY`（或 `GEMINI_API_KEY`），每人每日有使用次數上限；網站沒設定金鑰時按鈕會自動停用。
* 權限與網站後台相同，由伺服器判斷；看不到的功能代表您的帳號角色沒有權限。

## 🌐 介面語言：繁體中文／English

程式有繁體中文與英文兩種介面。登入畫面左下角的「Language / 語言」可以直接切換；登入後也可以從「說明 → Language / 語言」切換（切換會登出並重新開啟登入視窗）。選擇會記在這台電腦上，下次開啟沿用；也可以用環境變數 `CLUBDESK_LANG=en`（或 `zh`）單次指定。

* 介面文字、選單、對話方塊、使用教學與匯出的 Word 文件的標題／表頭都有英文版。
* 資料本身（社員姓名、文章內容、公告與聊天訊息、伺服器回傳的錯誤訊息）維持原文，不會被翻譯。
* 英文版改用 Tahoma 等拉丁字型顯示介面；中文資料仍會用新細明體。
* 英文字串在 `clubdesk/translations_en.py`（中文原文 → 英文）。新增介面文字時照常寫中文，再到這個檔補上英文；`tests/test_i18n.py` 會檢查程式裡每一句中文都有對應的英文。

## 🎨 經典復古介面設計 (Windows 98 / 2000 Authentic Look)

桌面版採用考究的 90 年代末至 2000 年代經典 Windows 視窗美學：
1. **立體 3D 浮雕按鈕**：頂左亮白（`#FFFFFF`）、底右深灰（`#404040`）立體陰影，按下時凹陷反轉。
2. **經典下凹輸入框**：輸入框、文字區、表格採用頂左深灰、底右亮白的 Sunken 凹陷雕刻感。
3. **經典 CJK 點陣字型**：自動載入 Windows 內建新細明體（`mingliu.ttc`）9 點（9pt = 12px 點陣最佳閱讀尺寸），字型筆觸工整清晰。
4. **MMC 風格漸層標題列**：各功能頁面頂部配備微軟管理主控台（MMC）經典深藍漸層標題橫幅（`#000080` 至 `#1084d0`）。
5. **經典控制項與狀態列**：具備下凹面板分區的 QStatusBar、傳統立體捲軸與分頁標籤。

## Windows 7 版（獨立版本）

給無法升級作業系統的舊電腦使用，**另外打包成獨立的安裝檔**（和一般版、Android APK 一起放在同一個 Release），不影響上面的一般版（Windows 10 / 11）：

| | 一般版 | Windows 7 版 |
| :--- | :--- | :--- |
| 系統 | Windows 10 / 11（64 位元） | Windows 7 SP1 以上（64 位元，也能在 8 / 10 / 11 執行） |
| 技術 | Python 3.12 + PySide6（Qt 6） | Python 3.8 + PySide2（Qt 5.15） |
| 安裝檔 | `ClubDesk-Setup-x.y.z.exe` | `ClubDesk-Win7-Setup-x.y.z.exe` |
| 發行 | 每次合併自動發行（`desktop-v*`） | 與一般版、Android APK 放在**同一個 Release**，是獨立的檔案 |
| 自動更新 | 有 | **沒有**（「檢查更新」只會提示去 Releases 下載） |

* Windows 7 需先安裝 SP1 、「通用 C 執行階段」更新（KB2999226）與 KB3063858（舊名 KB2533623）。
* 兩個版本可並存安裝（安裝目錄與解除安裝識別碼不同），資料都在網站上，不受影響。
* **資安提醒**：Windows 7 已停止安全更新，Python 3.8 與 Qt 5.15 也已結束維護。Windows 7 版只建議用在無法升級的電腦，其他電腦請用一般版。
* 與一般版共用同一份程式碼；`clubdesk/qtcompat.py` 在找不到 PySide6 時改載入 PySide2，並補上 Qt 5 與 Qt 6 的差異。新增功能時請避免 Python 3.9 以上才有的語法與函式。
* 打包流程：`.github/workflows/desktop-win7.yml`；本機建置：`pip install -r requirements-win7.txt pyinstaller`（Python 3.8）、`pyinstaller --noconfirm ClubDesk.spec`、`iscc /DWin7 /DAppVersion=x.y.z installer\ClubDesk.iss`。

## 安裝

1. 到 GitHub 儲存庫的 **Releases**，下載最新的 `ClubDesk-Setup-1.2.0.exe`（約 15–20 MB）。
2. 執行安裝程式，依照精靈「下一步」即可。預設只安裝給目前的使用者，**不需要系統管理員權限**；會建立開始功能表捷徑，可選擇建立桌面捷徑。
3. 第一次執行時 Windows 可能顯示「Windows 已保護您的電腦」（程式沒有付費的程式碼簽章），按「其他資訊 → 仍要執行」。
4. 登入畫面輸入：
   * **伺服器網址**：社團網站的網址，例如 `https://ntut.tpe.pp.ua` 或 `https://ntut-drone-web.xxxx.workers.dev`
   * **帳號／密碼**：與網站後台相同
   * **驗證碼**：與網站登入相同的圖片驗證碼

解除安裝：Windows「設定 → 應用程式」或開始功能表的「解除安裝」。

> 若網站設定了 Cloudflare Turnstile（`TURNSTILE_SECRET_KEY`），桌面版無法登入，需改用網站內建的圖片驗證碼。

## 開機自動啟動與自動登入（30 天）

登入畫面勾選 **保持登入 30 天** 後，網站會發一組 30 天有效的登入憑證（一般登入只有 1 天），程式用 Windows DPAPI 加密後存在本機，**不會儲存密碼**。此功能只在 Windows 提供：macOS / Linux 沒有同等的加密保護，因此不會儲存憑證，登入畫面也不會顯示「保持登入」與開機自動啟動選項，每次開啟都需重新登入。之後開啟程式會直接登入，不必再輸入密碼與驗證碼。

* **開機時自動啟動預設為勾選**（可取消，之後會記住你的選擇）；也可使用「工具 → 開機自動啟動」：Windows 登入後自動執行並縮小到系統匣（只寫入目前使用者的 `Run` 登錄項，不需系統管理員）。開機剛連上網路較慢時會自動重試，最久約一分鐘；開機啟動直接進系統匣時不會彈出更新視窗，第一次開回視窗時才會檢查更新。
* **每 30 天重新登入一次**：期限到了、登出、或變更密碼後，憑證失效，下次開啟會回到登入畫面並說明原因。
* 關閉或結束程式（含系統匣「結束」、Windows 關機）**不會**作廢憑證，下次開啟仍可自動登入；只有登出、換使用者、期限到或變更密碼才會失效。
* 公用電腦請不要勾選；按「檔案 → 登出並切換使用者」會立即作廢憑證。

## 自動更新

程式每次開啟登入畫面時，會向網站的 `GET /api/desktop/version` 詢問最新版本。有新版本時會詢問是否更新，按「立即更新」後：

1. 從 GitHub Release 下載新的安裝程式（顯示下載進度）。
2. 核對 SHA-256，與社長發布的不符就刪除，不會執行。
3. 執行安裝程式並關閉舊版，安裝完成即是新版本（社員資料都在網站上，不受影響）。

也可以從「說明 → 檢查更新」手動檢查。社長可把某個版本設為「必要更新」，舊版就必須更新才能使用。

### 發布新版本（自動）

**合併到 `main` 就會自動發布**（只要這次合併有改到 `desktop/`）：

1. GitHub Actions（Desktop App）測試並打包安裝程式，自動決定版本號：
   * 主、次版本取自 `desktop/clubdesk/__init__.py` 的 `__version__`（例如 `1.2`）。
   * 修訂號自動加一：第一次發布 `1.2.0`，之後依序 `1.2.1`、`1.2.2`…
   * 要升大版本時，把 `__version__` 改成例如 `1.3.0` 再合併，就會從 `1.3.0` 開始。
2. 建立標籤 `desktop-vX.Y.Z` 與**單一 GitHub Release**（`.github/workflows/release.yml`），同一個 Release 內附上一般版安裝檔、Windows 7 版安裝檔與 Android APK（各自獨立檔案，附 SHA-256，說明取自 PR 標題）。有改到 `android/` 也會觸發，桌面版版號因此一併遞增。
3. **自動通知網站**：若設定了 GitHub Secret `DESKTOP_RELEASE_TOKEN`，會直接更新網站的
   `/api/desktop/version`，所有社員下次開啟程式就會收到更新通知，社長不用再手動操作。

PR 只會測試與打包，不會發布；Actions 紀錄中會顯示「Merging this pull request would release X」。

#### 一次性設定：自動通知網站

1. 產生一組至少 32 字元的隨機字串，例如在終端機執行 `openssl rand -hex 32`。
2. GitHub 儲存庫 → Settings → Secrets and variables → Actions → New repository secret，
   名稱 `DESKTOP_RELEASE_TOKEN`，值貼上剛才的字串。
3. 之後任何一次合併到 `main`，網站部署流程會自動把同一組字串設定到 Cloudflare Worker。
4. 網站網址不是 `https://ntut.tpe.pp.ua` 時，在同一頁的 Variables 新增 `SITE_URL`。

沒有設定這個 Secret 也沒關係：Release 照樣自動建立，只是要由社長用桌面版
「工具 → 發布桌面版更新 → 從 GitHub 最新 Release 帶入」通知大家。

#### 手動發布（選用）

在 Actions 頁面手動執行 **Release** 流程即可重新發布；要指定版本時，先把 `__version__` 改成該版本再合併。網站只接受 `https://github.com/` 的下載網址；
人工發布只有社長能做，自動通知用的權杖不會把網站上的版本改回較舊的版本。

## 檔案大小

只打包程式用到的 Qt 元件（QtCore、QtGui、QtWidgets、QtSvg），不含 QML、Quick、PDF、網路模組與 20 MB 的軟體 OpenGL，HTTP 使用 Python 內建的 urllib。
安裝程式約 15–20 MB，安裝後約 50 MB；打包流程會檢查安裝程式不得超過 50 MB。

## 開發者：從原始碼執行與測試

需要 Python 3.10 以上（建議 3.12）。Windows 7 版改用 Python 3.8 與 `requirements-win7.txt`，見上方「Windows 7 版」。

```bash
cd desktop
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

（macOS／Linux 的啟用指令為 `source .venv/bin/activate`。）

連到本機測試伺服器：在專案根目錄執行 `npx wrangler dev`，登入畫面的伺服器網址填 `http://127.0.0.1:8787`。

### 執行單元測試

單元測試包含完整的後端 API 模擬測試（`test_api.py`）與版本更新校驗測試（`test_updater.py`）：

```bash
cd desktop
python -m unittest discover -s tests -v
```

若使用 pytest：
```bash
python -m pytest tests/
```

### 離線測試（無螢幕環境 Offscreen）

在無桌面環境（例如 Linux CI/CD 或遠端 SSH）下測試所有 Qt 畫面與對話框：

```powershell
$env:QT_QPA_PLATFORM="offscreen"
python -m unittest discover -s tests -v
```

### 自行打包安裝程式（Windows）

需安裝 [Inno Setup 6](https://jrsoftware.org/isinfo.php)：

```bash
pip install pyinstaller
pyinstaller --noconfirm ClubDesk.spec
iscc /DAppVersion=1.2.0 installer\ClubDesk.iss
```

安裝程式產生在 `desktop/dist/ClubDesk-Setup-1.2.0.exe`。

## 程式結構

```
desktop/
├── main.py                 程式進入點
├── ClubDesk.spec           PyInstaller 打包設定（精簡 Qt 元件）
├── installer/              Inno Setup 安裝精靈腳本與繁體中文語系檔
│   ├── ClubDesk.iss        安裝程式腳本
│   └── ChineseTraditional.isl 繁體中文語系檔
├── clubdesk/
│   ├── api.py              與網站後端溝通（/api/*）、登入與驗證碼、社團通訊與網站管理 API
│   ├── updater.py          檢查、下載、驗證並安裝新版本；社長發布更新
│   ├── formschema.py       六種表單的欄位定義（與 src/forms.js 一致）
│   ├── style.py            經典 Windows 98 / 2000 復古外觀樣式表與新細明體點陣字型加載
│   ├── widgets.py          共用表格、頁面框架、錯誤訊息提示
│   ├── login.py            登入視窗
│   ├── mainwindow.py       主視窗（選單、工具列、功能導覽樹、狀態列、系統匣通知）
│   └── pages/              各功能畫面（通訊、網站、文章、頁面、會議、AI、財務、器材、社員等）
└── tests/
    ├── test_api.py         API 完整單元測試（FakeTransport 涵蓋所有新舊端點）
    └── test_updater.py     版本比對與 GitHub Release 解析單元測試
```

使用 Python + PySide6（Qt）撰寫原生視窗介面，不使用肥大的網頁打包技術。
`installer/ChineseTraditional.isl` 取自 Inno Setup 專案的非官方繁體中文翻譯。
