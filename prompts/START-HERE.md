# Claude Code 工作階段啟動指引

## 第一步：閱讀所有規劃文件

請依序閱讀以下檔案，**全部讀完再開始任何實作**：

```
00-project-overview.md    專案總覽、技術棧、設計原則
01-ui-structure.md        UI 架構與導覽設計
02-overview-and-wizard.md 概覽頁與設定精靈
03-device-history-battery.md 裝置管理、歷史記錄、電池健康
04-shutdown-notify-logs.md   開關機規則、通知、記錄
05-backend-api.md         後端 API 設計
06-i18n.md                i18n 國際化實作
07-deb-packaging.md       deb 套件打包
```

---

## 第二步：確認開發環境

```bash
# NUT dummy UPS 是否正常運作
upsc ups@localhost

# PVE Web UI 是否正常
systemctl status pveproxy

# 現有專案檔案
ls ~/pve-ups-panel/

# Node.js 版本
node --version
```

---

## 第三步：確認理解

閱讀完畢後，請告訴我：

1. 整個 UI 分成哪幾個分頁？各自的職責是什麼？
2. 使用者第一次進入 UPS 頁面時會看到什麼？
3. API 路徑的規劃是什麼？
4. 哪些操作需要 `Sys.PowerMgmt` 權限？

確認理解正確後再開始實作。

---

## 第四步：實作順序

**請嚴格依照以下順序進行，每個 Phase 完成後通知我驗證：**

```
Phase 1  UI 架構與分頁框架（不含任何實際資料）
Phase 2  概覽頁（空白狀態 + 設定精靈）
Phase 3  概覽頁（正常狀態，接真實 API 資料）
Phase 4  後端 API 基礎（狀態讀取 + devices 端點）
Phase 5  裝置管理頁
Phase 6  歷史記錄頁（RRD 整合）
Phase 7  電池健康頁
Phase 8  開關機規則頁
Phase 9  通知頁
Phase 10 記錄頁
Phase 11 i18n 完整實作
Phase 12 deb 套件打包
```

---

## 開發規範提醒

- **不引入任何外部 CSS 或 JS 框架**
- **所有 UI 元件使用 PVE/ExtJS 原生**
- **所有字串使用 `gettext()` 包裝**
- **缺值欄位顯示 `gettext('N/A')`**
- **修改系統檔案一律先 `dpkg-divert` 保護**
- 每次修改 Perl 模組後執行：`systemctl restart pveproxy`
- 遇到問題先在 VM 上測試，不要猜測結果

---

## 快照建議

以下時機建議暫停並通知我建立快照：

- Phase 1 完成（UI 框架可顯示）
- Phase 4 完成（API 可正常回應）
- Phase 8 完成（所有主要功能完成）
- Phase 12 完成（deb 可安裝）
