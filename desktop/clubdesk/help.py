"""使用教學: the built-in manual (Help → 使用教學, F1) and the first-run welcome guide."""

from __future__ import annotations

from PySide6.QtCore import QSettings, Qt
from PySide6.QtWidgets import (QCheckBox, QDialog, QHBoxLayout, QLabel, QListWidget, QListWidgetItem,
                               QPushButton, QSplitter, QTextBrowser, QVBoxLayout)

from . import __version__
from .icons import app_pixmap, icon

CSS = """<style>
body { font-family: 'PMingLiU', 'MingLiU', serif; font-size: 10pt; line-height: 150%; }
h2 { color: #0A246A; font-size: 14pt; border-bottom: 1px solid #A6CAF0; }
h3 { color: #0A246A; font-size: 11pt; margin-top: 12px; }
td, th { border: 1px solid #A0A0A0; padding: 3px 6px; } th { background: #D4D0C8; }
.tip { background: #FFFFE1; border: 1px solid #C0C0A0; padding: 4px; }
kbd { background: #F2F1EC; border: 1px solid #A0A0A0; padding: 0 3px; }
</style>"""

# (topic icon, title, HTML body). Order = reading order for a new user.
TOPICS = [
    ("tutorial", "快速入門", """
<h2>快速入門：五分鐘學會社務管理系統</h2>
<p>本程式直接連到社團網站（預設 <b>https://ntut.tpe.pp.ua</b>），資料與網站後台<b>共用</b>：在這裡修改，網站立刻看得到；在網站修改，按 <kbd>F5</kbd> 這裡也會更新。</p>
<h3>第一步：登入</h3>
<ol><li>伺服器網址保持預設即可（社團網站）。</li>
<li>輸入與網站後台相同的帳號、密碼。</li>
<li>輸入圖片中的 5 碼驗證碼（不分大小寫，看不清楚按「換一張」）。</li></ol>
<h3>第二步：認識畫面</h3>
<table><tr><th>位置</th><th>用途</th></tr>
<tr><td>左側「功能選單」</td><td>依類別列出您有權限的功能，點一下切換。括號內的數字是未讀訊息。</td></tr>
<tr><td>上方工具列</td><td>重新整理、匯出 CSV、訊息中心、開啟網站、使用教學、登出。</td></tr>
<tr><td>下方狀態列</td><td>目前操作結果、未讀訊息與公告數、登入者與伺服器。</td></tr></table>
<h3>第三步：常用工作</h3>
<ul><li>看公告、跟社員聊天：<b>社團通訊 → 社團公告／聊天室與私訊</b></li>
<li>改社團網站：<b>網站管理 → 文章管理／頁面管理／首頁設定</b></li>
<li>填申請單、報銷單：<b>文書作業 → 表單作業</b></li>
<li>開會、簽到、投票：<b>社務管理 → 會議與社員大會</b></li>
<li>問問題：<b>AI 工具 → AI 社務助理</b></li></ul>
<p class="tip">💡 看不到某個功能代表您的帳號角色沒有權限，請洽社長調整。每個畫面都可按 <kbd>F1</kbd> 回到本教學。</p>
"""),
    ("about", "畫面與快速鍵", """
<h2>畫面與快速鍵</h2>
<table><tr><th>按鍵</th><th>功能</th></tr>
<tr><td><kbd>F1</kbd></td><td>開啟使用教學</td></tr>
<tr><td><kbd>F5</kbd></td><td>重新從伺服器讀取目前畫面</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>E</kbd></td><td>把目前表格匯出成 Excel 可開啟的 CSV</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd></td><td>把目前畫面匯出成 Word（.docx）文件</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>1</kbd> ～ <kbd>9</kbd></td><td>切換到「檢視」選單中的第 1～9 個畫面</td></tr>
<tr><td><kbd>Ctrl</kbd>+<kbd>M</kbd></td><td>開啟訊息中心（聊天室與私訊）</td></tr>
<tr><td>文章編輯器 <kbd>Ctrl</kbd>+<kbd>B</kbd>／<kbd>I</kbd>／<kbd>K</kbd></td><td>粗體／斜體／插入連結</td></tr>
<tr><td>聊天 <kbd>Enter</kbd>／<kbd>Shift</kbd>+<kbd>Enter</kbd></td><td>送出／換行</td></tr></table>
<h3>表格操作</h3>
<ul><li>點欄位標題可排序，再點一次反向排序。</li><li>拖曳欄位邊界可調整寬度。</li><li>雙擊一列等於按「修改」或「開啟」。</li></ul>
<h3>匯出 Word（.docx）</h3>
<p>工具列的「匯出 Word」或 <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> 會把目前畫面存成可直接列印、繳交學校的 Word 文件：</p>
<ul><li>表格（社員、帳目、器材…）：匯出目前顯示的資料，欄位多時自動橫向。</li>
<li>文章或頁面：先選取一篇，匯出完整內文。</li>
<li>會議：先選取一場，匯出完整會議資料、表決結果、出席名單與會議紀錄（附簽名欄）。</li>
<li>法規查詢會匯出整本法規彙編；聊天室匯出目前的對話紀錄。</li></ul>
<h3>系統匣通知</h3>
<p>程式開著時，每 30 秒會檢查新訊息與公告；有新的會在螢幕右下角跳出通知，點通知即可前往查看。</p>
"""),
    ("messages", "社團通訊（聊天、私訊、公告）", """
<h2>社團通訊</h2>
<h3>聊天室</h3>
<p>預設有「全體社員聊天室」、「幹部聊天室」、「飛行揪團」。幹部可以按「建立聊天室」新增，並設定：</p>
<ul><li><b>誰可以看到</b>：全體社員、幹部限定，或勾選指定成員。</li>
<li><b>只有幹部可以發言</b>：適合做公告頻道。</li>
<li><b>封存</b>：停止使用但保留紀錄（社長或建立者可設定）。</li></ul>
<p>訊息可以編輯或刪除自己發的；社長可以刪除任何訊息。網址會自動變成可點的連結。</p>
<h3>私人訊息</h3>
<p>按「寫私訊給...」選擇對象。私訊只有雙方看得到，社長也看不到。</p>
<h3>社團公告</h3>
<p>幹部可發布公告（可置頂、可設幹部限定）。社員登入時會收到通知，點開即標為已讀；幹部可以看到已讀人數與名單。</p>
<h3>外部推播（選用模組，社長設定）</h3>
<p>在「社團公告 → 外部推播設定」或「工具 → 外部推播設定」，可把給全體社員的公告（以及網站新文章）同步發到 Discord、Slack、Google Chat、Microsoft Teams 或 LINE 官方帳號。預設關閉，不設定也完全不影響其他功能。幹部限定公告與聊天內容永遠不會外流。</p>
<p class="tip">💡 Discord 取得 Webhook：頻道「編輯頻道 → 整合 → Webhook → 新 Webhook → 複製網址」，貼到設定中並按「發送測試訊息」。</p>
"""),
    ("site", "網站管理（文章、頁面、首頁）", """
<h2>編輯社團對外網站</h2>
<p>需要社長或幹部權限（財務可以檢視）。存檔後網站<b>立即生效</b>。</p>
<h3>文章管理（最新消息、活動紀錄）</h3>
<ol><li>按「新增」開啟編輯器，填寫標題、語言、摘要。</li>
<li>「網址代稱」是網址的最後一段，例如 <code>fpv-setup-guide</code> 會變成 /blog/fpv-setup-guide；可按「自動產生」。</li>
<li>內文用 Markdown 撰寫，工具列可插入粗體、標題、清單、連結、圖片、表格、YouTube 影片；右邊是與網站完全相同的即時預覽。</li>
<li>按「儲存」或「儲存並在網站開啟」。</li></ol>
<h3>好用的額外功能</h3>
<ul><li><b>自動保存草稿</b>：每 20 秒存在本機，當機或斷線也不會遺失，下次開啟會詢問是否還原。</li>
<li><b>AI 寫作助理</b>：輸入重點按「依重點草擬」，或對現有內容「潤飾」、「產生摘要」、「翻譯成另一語言」（翻譯會另存新文章）。</li>
<li><b>匯入／匯出 .md</b>：可以用 Word 以外的編輯器寫好再匯入，也能匯出備份。</li>
<li><b>全部備份成 .md</b>：一次把所有文章存到資料夾，建議學期末交接時做一次。</li>
<li><b>字數與閱讀時間</b>：編輯器右下角即時顯示。</li></ul>
<h3>頁面管理</h3>
<p>固定頁面（例如「關於我們」、「加入方式」），網址為 /page/代稱，操作方式與文章相同。</p>
<h3>首頁設定</h3>
<p>依分頁修改首頁主視覺、關於我們、四大特色、頁尾連結與 IG 動態卡片。<b>留空的欄位會顯示網站預設文字</b>（灰色提示字）。可「匯出設定檔」備份、「匯入設定檔」還原，或「全部恢復預設」。</p>
"""),
    ("members", "社員與社費", """
<h2>社員名冊與社費簽收</h2>
<p>社長、財務可使用。</p>
<ul><li><b>查詢</b>：輸入關鍵字，或用篩選找「未繳社費」、「具表決權」等。</li>
<li><b>批次修改</b>：用 Ctrl／Shift 多選或按「全選」，一次修改身分或社費狀態。</li>
<li><b>匯入 CSV</b>：第一列為欄位名稱（姓名、學號、Email、電話、職務…）。</li>
<li><b>AI 整理名單</b>：直接貼上 Google 表單、聊天紀錄等亂格式名單，AI 整理成表格，確認後才匯入。</li></ul>
<h3>社費簽收紀錄</h3>
<p>登錄社費收款後，社員的社費狀態會自動更新。社員可以在「我的帳號」看到自己的繳費紀錄。</p>
"""),
    ("meetings", "會議與社員大會", """
<h2>會議與社員大會</h2>
<h3>幹部：召開會議</h3>
<ol><li>按「召開新會議」，或從「用範本建立」選期初／期末社員大會。</li>
<li>設定日期、地點、議程與表決門檻（依章程自動帶入）。</li>
<li>開啟會議 →「開會通知」分頁按「AI 產生開會通知」，再「發布成社團公告」或「發布成網站文章」。</li>
<li>按「公告會議」→ 當天按「開始開會」。開放學號簽到的會議會自動產生簽到碼，現場公布。</li>
<li>「議程與表決」分頁：選議案 →「開始線上投票」→「結束投票並計票」，系統依門檻判定是否通過；也可「登錄現場票數」。</li>
<li>每案的討論重點記在「本案紀錄」，散會後到「會議紀錄」按「AI 產生會議紀錄」，確認後「定稿」並列印。</li></ol>
<h3>社員：簽到與投票</h3>
<p>在會議「簽到」分頁輸入現場簽到碼按「簽到」；投票開放時在「議程與表決」按同意／反對／棄權。<b>投票是無記名的</b>，系統只記錄誰投過，不記錄投了什麼。</p>
<p class="tip">💡 沒有帳號的社員可用「複製學號簽到連結」給他們，用手機以學號＋姓名簽到投票。</p>
"""),
    ("forms", "表單作業", """
<h2>表單作業</h2>
<p>六種紙本表單：社費支出事前申請單、事後報銷單、設備借據、學生活動申請表、活動報告表、公文。</p>
<ol><li>按「新增」選表單種類並填寫；可按「AI 協助填寫」用口語描述讓 AI 整理欄位。</li>
<li>公文可用「AI 白話轉公文」把白話內容改寫成正式用語。</li>
<li>按「列印」會用瀏覽器開啟 A4 版面，可列印或另存 PDF。</li></ol>
<p>社員只看得到自己填的表單；幹部可以看到全部。</p>
"""),
    ("finance", "收支與器材", """
<h2>收支帳目</h2>
<ul><li>財務「新增收支」後為<b>待審核</b>，社長「核准」才計入餘額；「退回」需填原因。</li>
<li><b>預算執行</b>分頁可編輯預算分類並看執行率。</li>
<li><b>AI 帳目檢查</b>：找出可能重複、送審太久的帳目，並建議預算分類，勾選後套用。</li>
<li><b>匯入舊帳本 CSV</b>：欄位為 日期、事宜、收入、支出、現金餘額、郵局餘額。</li></ul>
<h2>器材清冊</h2>
<p>新增器材時財產編號由伺服器自動產生；可記錄狀態、存放位置與保管人。</p>
"""),
    ("ai", "AI 工具", """
<h2>AI 工具</h2>
<p>需要社長在網站設定 GROQ_API_KEY 或 GEMINI_API_KEY。每人每日有使用次數上限（預設 30 次）。</p>
<h3>AI 社務助理</h3>
<p>用聊天的方式問社團的事，例如「誰還沒繳社費？」「無人機電池有幾顆？」「章程第十條怎麼說？」。助理只會查您有權限看的資料。它建議的動作（例如開一篇文章草稿、送出一筆帳目）要您按下連結才會執行。</p>
<h3>社團週報</h3>
<p>每週一早上自動統計社費、帳目、器材、會議與待辦事項；社長或財務可按「立即產生週報」。</p>
<h3>其他 AI 功能</h3>
<p>文章 AI 寫作、AI 整理名單、AI 帳目檢查、AI 開會通知與會議紀錄、表單 AI 填寫。</p>
"""),
    ("users", "帳號、權限與設定", """
<h2>帳號與權限（社長）</h2>
<table><tr><th>角色</th><th>可以做的事</th></tr>
<tr><td>社長</td><td>全部功能，含帳號管理、審核帳目、發布桌面版更新、外部推播設定</td></tr>
<tr><td>財務</td><td>社員名冊、社費、收支帳目、器材；可檢視網站內容</td></tr>
<tr><td>幹部</td><td>編輯網站、器材、會議、社課備忘錄、發布公告、建立聊天室</td></tr>
<tr><td>社員</td><td>表單、會議簽到投票、聊天與私訊、公告、AI 助理、我的帳號</td></tr></table>
<ul><li>「新增帳號」時可直接綁定社員名冊中的人，綁定後才能簽到投票、看自己的繳費紀錄。</li>
<li>停用帳號會立即登出對方；重設密碼後對方需用新密碼登入。</li>
<li>「開放社員角色登入」關閉時，社員開會改用學號＋姓名簽到連結。</li></ul>
<h3>我的帳號</h3>
<p>查看綁定資料與繳費紀錄，或變更密碼（變更後所有電腦都要重新登入）。</p>
"""),
    ("update", "更新與常見問題", """
<h2>自動更新</h2>
<p>每次開啟程式會檢查新版本，有新版會詢問是否更新；下載後會核對 SHA-256 才安裝。也可以從「說明 → 檢查更新」手動檢查。</p>
<h2>常見問題</h2>
<h3>登入時說驗證碼錯誤？</h3><p>驗證碼五分鐘內有效且只能用一次，請按「換一張」重新輸入。</p>
<h3>出現「登入已逾時」？</h3><p>網站登入有效期限到了，程式會帶您重新登入，資料不會遺失（文章草稿也會自動保存）。</p>
<h3>看不到某個功能？</h3><p>代表您的角色沒有權限，請洽社長。</p>
<h3>AI 按鈕不能按？</h3><p>網站尚未設定 AI 金鑰，或今日次數已用完。</p>
<h3>Windows 顯示「已保護您的電腦」？</h3><p>本程式沒有付費的程式碼簽章，按「其他資訊 → 仍要執行」即可。</p>
<h3>要換伺服器？</h3><p>「檔案 → 登出並切換使用者」後，在登入畫面修改伺服器網址。</p>
"""),
]


class HelpWindow(QDialog):
    """Non-modal manual window: topic list on the left, text on the right."""

    _instance = None

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("使用教學 - 北科無人機社 社務管理系統")
        self.setWindowIcon(icon("tutorial"))
        self.setWindowFlag(Qt.WindowMaximizeButtonHint, True)
        self.setWindowFlag(Qt.WindowContextHelpButtonHint, False)
        self.resize(900, 620)
        self.topics = QListWidget()
        for name, title, _ in TOPICS:
            QListWidgetItem(icon(name), title, self.topics)
        self.text = QTextBrowser()
        self.text.setOpenExternalLinks(True)
        self.topics.currentRowChanged.connect(lambda row: self.text.setHtml(CSS + TOPICS[row][2]) if 0 <= row < len(TOPICS) else None)
        splitter = QSplitter(Qt.Horizontal)
        splitter.addWidget(self.topics)
        splitter.addWidget(self.text)
        splitter.setSizes([210, 690])
        previous = QPushButton("上一篇")
        previous.clicked.connect(lambda: self.topics.setCurrentRow(max(0, self.topics.currentRow() - 1)))
        following = QPushButton("下一篇")
        following.clicked.connect(lambda: self.topics.setCurrentRow(min(len(TOPICS) - 1, self.topics.currentRow() + 1)))
        close = QPushButton("關閉")
        close.clicked.connect(self.close)
        row = QHBoxLayout()
        row.addWidget(QLabel(f"版本 {__version__}"))
        row.addStretch(1)
        for button in (previous, following, close):
            row.addWidget(button)
        layout = QVBoxLayout(self)
        layout.addWidget(splitter, 1)
        layout.addLayout(row)
        self.topics.setCurrentRow(0)

    @classmethod
    def open(cls, parent, topic: str = "") -> "HelpWindow":
        if cls._instance is None or not cls._instance.isVisible():
            cls._instance = HelpWindow(parent)
        window = cls._instance
        if topic:
            for index, (_, title, _) in enumerate(TOPICS):
                if title.startswith(topic):
                    window.topics.setCurrentRow(index)
        window.show()
        window.raise_()
        window.activateWindow()
        return window


WELCOME = f"""{CSS}
<h2>歡迎使用 社務管理系統 {__version__}</h2>
<p>這個版本新增了：</p>
<ul>
<li>🌐 <b>編輯社團網站</b>：文章、頁面、首頁設定，內建即時預覽、自動保存草稿與 AI 寫作。</li>
<li>💬 <b>社團通訊</b>：聊天室、私人訊息、公告，新訊息會在右下角通知；社長可選擇開啟 Discord／LINE 等外部推播。</li>
<li>🗳 <b>會議與社員大會</b>：開會通知、簽到、無記名投票、AI 會議紀錄。</li>
<li>✨ <b>AI 工具</b>：AI 社務助理、社團週報、AI 帳目檢查、AI 整理名單。</li>
<li>🎨 全新圖示與<b>使用教學</b>（隨時按 F1 開啟）。</li>
</ul>
<p>第一次使用？建議先看「快速入門」，五分鐘就能上手。</p>"""


class WelcomeDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("歡迎")
        self.setWindowFlag(Qt.WindowContextHelpButtonHint, False)
        logo = QLabel()
        logo.setPixmap(app_pixmap(64))
        logo.setAlignment(Qt.AlignTop)
        text = QTextBrowser()
        text.setHtml(WELCOME)
        text.setFrameShape(QTextBrowser.NoFrame)
        text.setStyleSheet("background: transparent;")
        self.again = QCheckBox("下次不再顯示")
        self.again.setChecked(True)
        tutorial = QPushButton(icon("tutorial"), "開啟使用教學")
        tutorial.clicked.connect(lambda: (HelpWindow.open(parent), self.accept()))
        start = QPushButton(icon("check"), "開始使用")
        start.setDefault(True)
        start.clicked.connect(self.accept)
        top = QHBoxLayout()
        top.addWidget(logo)
        top.addWidget(text, 1)
        bottom = QHBoxLayout()
        bottom.addWidget(self.again)
        bottom.addStretch(1)
        bottom.addWidget(tutorial)
        bottom.addWidget(start)
        layout = QVBoxLayout(self)
        layout.addLayout(top, 1)
        layout.addLayout(bottom)
        self.resize(560, 400)

    def done(self, result: int) -> None:  # noqa: D401 - Qt override
        if self.again.isChecked():
            QSettings().setValue("welcome/version", __version__)
        super().done(result)

    @staticmethod
    def maybe_show(parent) -> None:
        if QSettings().value("welcome/version", "", str) != __version__:
            WelcomeDialog(parent).exec()
