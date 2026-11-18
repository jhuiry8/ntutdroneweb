# 北科無人機社 社務管理系統（Android 手機版）

這是專為國立臺北科技大學無人機社 (NTUT Drone Club) 開發的 Android 原生 App，將社團官網與社務系統整合為手機原生體驗。

## 🌟 核心特色

1. **🚀 100% 全螢幕原生體驗**：擺脫瀏覽器網址列與外框，享受全螢幕視野。
2. **🔄 手勢下拉更新 (Pull-to-Refresh)**：隨時手勢往下一拉即可即時取得最新公告、會議與社務資料。
3. **📁 支援檔案選取與上傳**：支援各類表單申請、社員 CSV 名單匯入與器材報修上傳。
4. **🔗 智慧外部跳轉**：點擊 LINE、Instagram、官方信箱時自動調用手機對應之原生 App，無縫切換。
5. **🛸 友善離線提示**：遇到無網路環境時自動切換至專屬離線重試畫面。

---

## 📲 下載與安裝方法

### 方式一：直接下載 APK 安裝檔 (Android)
1. 前往 GitHub 儲存庫的 **Releases** 或 **Actions** 頁面。
2. 下載最新版本的 `NTUT-Drone-Club.apk`（或 `NTUT-Drone-Club-Debug.apk`）。
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

## 🤖 GitHub Actions 自動化編譯 (CI/CD)

本專案已配置 `.github/workflows/android.yml`：
- 每次將程式碼推送到 GitHub，系統會自動在雲端使用 Ubuntu + Android SDK 編譯最新 APK，並可於 Actions 頁面下載 Artifact。
- 當建立並推送標籤（例如 `git tag android-v1.0.0 && git push origin android-v1.0.0`）時，GitHub Actions 會自動建立 GitHub Release 並附上可直接下載的 APK 安裝包。
