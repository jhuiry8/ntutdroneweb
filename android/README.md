# 北科無人機社 社務管理系統（Android 手機版）

這是專為國立臺北科技大學無人機社 (NTUT Drone Club) 開發的 Android 原生 App，將社團官網與社務系統整合為手機原生體驗。

## 🌟 核心架構特色 (100% Native Material Design - 拒絕網頁瀏覽器包殼)

1. **📱 真正原生手機介面**：完全不使用 WebView 網頁瀏覽器！採用 Android 原生 Material Design 元件（`BottomNavigationView`、`RecyclerView`、`CardView`、`MaterialToolbar`）。
2. **🌐 原生 RESTful API 連線**：直接透過原生 `ApiClient` 呼叫後端 `/api/*` 服務，資料以原生 JSON 傳輸與解析，告別網頁載入延遲與白畫面。
3. **🔄 原生下拉更新 (SwipeRefreshLayout)**：首頁、最新公告、設備清單與會議簽到皆支援原生流暢下拉更新。
4. **🛸 完整功能模組**：
   - 🏠 **首頁動態 (Home)**：社團特色、最新公告摘要、線上借用表單與簽到入口、社群跳轉。
   - 📢 **社內公告 (News)**：讀取 `/api/announcements`，需登入社員帳號。
   - 🛸 **設備清單 (Equipment)**：讀取 `/api/equipment`，伺服器僅開放幹部查看；借用一律開啟官網的線上借用表單（需驗證碼與完整借用明細）。
   - 🗳️ **會議簽到 (Meetings)**：讀取 `/api/meetings`，會議「開會中」時以登入帳號簽到（需要時輸入主席公布的簽到碼）。沒有帳號的社員請用主席提供的 `/meeting/<id>` 網頁簽到。
   - 👤 **社員中心 (Profile)**：帳號＋密碼＋圖形驗證碼登入；登出時會一併註銷伺服器上的 Session。
5. **⚠️ 錯誤一律如實顯示**：網路中斷、未登入或權限不足時直接顯示原因，不會用範例資料冒充，也不會把失敗的送出顯示為成功。
6. **ℹ️ 限制**：若伺服器設定了 Cloudflare Turnstile（`TURNSTILE_SECRET_KEY`），App 無法完成 Turnstile 驗證，請改用網頁版登入。


---

## 📲 下載與安裝方法

### 方式一：直接下載 APK 安裝檔 (Android)
1. 前往 GitHub 儲存庫的 **Releases** 或 **Actions** 頁面。
2. 下載最新版本的 `NTUT-Drone-Club.apk`（Releases 中的正式簽章版本，可直接覆蓋更新）。Actions Artifact 中的 `NTUT-Drone-Club-Debug.apk` 僅供測試，每次建置簽章都不同，無法覆蓋安裝。
3. 在手機點擊安裝。若系統提示「未知的應用程式」，點擊「設定」並勾選「允許來自此來源的應用程式」即可完成安裝。

### 方式二：純網頁 PWA 加入主畫面 (蘋果 iOS 與 Android 皆適用)
- **蘋果 iPhone / iPad**：
  1. 使用 Safari 開啟社團官網。
  2. 點擊畫面底部的「分享」按鈕。
  3. 選擇「加入主畫面 (Add to Home Screen)」，按右上角「新增」。
- **安卓 Android**：
  1. 使用 Chrome 開啟社團官網。
  2. 點擊橫幅「安裝應用程式」或右上角選單「新增至主螢幕」。

---

## 🛠️ 開發與編譯教學 (給開發者)

### 需求環境
- JDK 17
- Android SDK (API 34)

### 使用命令列編譯 APK

```bash
cd android
```

**Windows**：
```cmd
gradlew.bat assembleDebug
```

**macOS / Linux**：
```bash
chmod +x gradlew
./gradlew assembleDebug
```

編譯完成的 APK 檔案會位在：
`android/app/build/outputs/apk/debug/app-debug.apk`

### 使用 Android Studio 開啟
1. 開啟 Android Studio。
2. 點擊 **Open** 並選取 `android/` 目錄。
3. 等待 Gradle Sync 完成後，點擊綠色 **Run** 按鈕即可在實體機或模擬器上執行。

---

## 🤖 GitHub Actions 全自動建置與發佈 (CI/CD)

`.github/workflows/android.yml` 會自動處理：
- **Pull Request**：自動編譯 Debug APK，確認改動能成功建置。
- **合併到 `main`（且有改到 `android/`）**：自動編譯、用社團金鑰簽署、版本號自動遞增（`1.0.<建置編號>`）、自動打標籤 `android-v1.0.x` 並發佈 GitHub Release。社員到 Releases 下載最新版即可覆蓋更新。
- 也可以在 Actions 頁面手動按 **Run workflow** 重新建置發佈。

### 🔑 唯一需要手動的一次性設定：簽署金鑰

儲存庫是公開的，簽署金鑰不能放在程式碼裡（否則任何人都能簽出冒充的更新版），必須存在 GitHub Secrets。**沒設定時只會產生測試用 Debug APK，不會發佈 Release。**

1. 在自己的電腦產生金鑰（請妥善備份，遺失後就無法再發佈可覆蓋更新的版本）：
   ```bash
   keytool -genkeypair -v -keystore ntut-drone-release.jks -alias ntutdrone -keyalg RSA -keysize 4096 -validity 10000
   ```
2. 轉成 Base64：
   ```bash
   base64 -w0 ntut-drone-release.jks > keystore.b64
   ```
3. 到 GitHub 儲存庫 **Settings → Secrets and variables → Actions** 新增：
   - `ANDROID_KEYSTORE_BASE64`：`keystore.b64` 的內容
   - `ANDROID_KEYSTORE_PASSWORD`：金鑰庫密碼
   - `ANDROID_KEY_ALIAS`：`ntutdrone`
   - `ANDROID_KEY_PASSWORD`：金鑰密碼
