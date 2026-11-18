# 北科無人機社 社務管理系統（桌面版）

![主畫面](docs/screenshot.png)

安裝在電腦上使用的社務管理程式，採傳統 Windows 視窗介面（選單列、工具列、左側功能樹、表格、狀態列）。
程式直接連到社團網站的後端（Cloudflare Workers），**資料與網站後台共用**：在桌面版修改的內容，網站上會立即看到，反之亦然。

## 功能

| 功能 | 可使用的角色 | 說明 |
| :--- | :--- | :--- |
| 社員名冊 | 社長、財務 | 查詢、篩選、新增、修改、刪除、全選與批次修改身分或社費、匯入 CSV |
| 社費簽收紀錄 | 社長、財務 | 登錄社費簽收（自動更新社員社費狀態）、刪除紀錄、本學期合計 |
| 收支帳目 | 社長、財務 | 帳戶摘要、新增收支、社長核准／退回、刪除已退回帳目、預算分類與執行率 |
| 器材清冊 | 社長、財務、幹部 | 查詢、新增、修改器材（財產編號由伺服器自動產生） |
| 社團法規查詢 | 所有人 | 唯讀瀏覽目前生效的章程與細則 |
| 我的帳號 | 所有人 | 帳號資料、綁定的社員資料、社費繳費紀錄、變更密碼 |

每個表格都可以用「檔案 → 匯出 CSV」（Ctrl+E）匯出成 Excel 可開啟的檔案。F5 重新整理，Ctrl+1～Ctrl+6 切換畫面。

權限與網站後台相同，由伺服器判斷；看不到的功能代表您的帳號角色沒有權限。

## 一般使用者：下載與執行

1. 到 GitHub 儲存庫的 **Actions** → **Desktop App (Windows build)**，打開最新一次成功（綠色勾勾）的執行紀錄。
2. 在頁面下方 **Artifacts** 下載 `ClubDesk-windows`，解壓縮得到 `ClubDesk.exe`。
3. 直接執行 `ClubDesk.exe`（不需安裝 Python）。第一次執行時 Windows 可能顯示「Windows 已保護您的電腦」，按「其他資訊 → 仍要執行」。
4. 登入畫面輸入：
   * **伺服器網址**：社團網站的網址，例如 `https://ntut-drone-web.xxxx.workers.dev`
   * **帳號／密碼**：與網站後台相同
   * **驗證碼**：與網站登入相同的圖片驗證碼（每張只能用一次，輸入錯誤會自動換一張）

伺服器網址與帳號會記在這台電腦上，下次不用重打。

> 若網站設定了 Cloudflare Turnstile（`TURNSTILE_SECRET_KEY`），桌面版無法登入，需改用網站內建的圖片驗證碼。

## 開發者：從原始碼執行

需要 Python 3.10 以上。

```bash
cd desktop
python -m venv .venv
.venv\Scripts\activate          # macOS / Linux：source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

連到本機測試伺服器：在專案根目錄執行 `npx wrangler dev`，登入畫面的伺服器網址填 `http://127.0.0.1:8787`。

執行測試（不需要伺服器）：

```bash
cd desktop
python -m unittest discover -s tests
```

自行打包成單一執行檔：

```bash
pip install pyinstaller
pyinstaller --noconfirm --onefile --windowed --name ClubDesk main.py
```

產生的程式在 `desktop/dist/`。

## 程式結構

```
desktop/
├── main.py                 程式進入點
├── clubdesk/
│   ├── api.py              與網站後端溝通（/api/*）、登入與驗證碼
│   ├── style.py            傳統視窗外觀（灰色立體按鈕、深藍選取色、新細明體）
│   ├── widgets.py          共用表格、頁面框架、錯誤訊息
│   ├── login.py            登入視窗
│   ├── mainwindow.py       主視窗（選單、工具列、功能樹、狀態列）
│   └── pages/              各功能畫面
└── tests/                  單元測試
```

使用 Python + PySide6（Qt）撰寫原生視窗介面，不使用網頁技術。
