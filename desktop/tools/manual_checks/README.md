# 手動 UI 檢查腳本

這些腳本會啟動模擬伺服器、以 offscreen 模式開啟桌面版頁面並截圖，用來人工檢查畫面。
它們不是單元測試（執行完會直接結束程式），所以放在 `tests/` 以外，避免
`python -m unittest discover -s tests` 匯入它們後提早結束、讓測試結果看起來像通過。

從 `desktop/` 資料夾執行，例如：

```bash
QT_QPA_PLATFORM=offscreen python -m tools.manual_checks.check_posts_page
```
