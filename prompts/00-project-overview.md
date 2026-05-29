# PVE UPS Panel — 專案總覽

## 專案目標

為 Proxmox VE 開發一個 UPS 監控與管理套件，以 deb 安裝包形式發布。
安裝後在 PVE 節點樹中新增「UPS」項目，提供完整的 UPS 管理介面。

---

## 技術棧

| 層級 | 技術 |
|---|---|
| 前端 | ExtJS 6（PVE 原生，不引入任何外部 CSS 或 JS 框架） |
| 後端 | Perl（PVE::API2 模組樹） |
| 資料收集 | NUT（Network UPS Tools）upsc 指令 |
| 歷史資料 | RRDtool（復用 PVE 現有 rrdcached） |
| 通知 | PVE::Notify（PVE 8.1+ 原生通知框架） |
| 打包 | deb（dpkg-buildpackage + debhelper） |

---

## 核心設計原則

1. **完全融入 PVE 原生風格**
   - 只使用 PVE/ExtJS 原生元件
   - 不引入任何自訂 CSS
   - 主題切換、字型、間距全部跟隨 PVE 設定

2. **API 走 PVE 現有 HTTPS**
   - 所有端點掛在 `/api2/extjs/nodes/{node}/ups/`
   - 認證由 pveproxy 統一處理
   - 叢集環境使用 `proxyto => 'node'` 自動轉發

3. **缺值顯示 N/A**
   - 任何 UPS 不支援的欄位一律顯示 N/A
   - 不因缺值造成 UI 錯誤或空白

4. **i18n 完整支援**
   - 所有使用者可見字串使用 `gettext()` 包裝
   - 語系檔放在 `/usr/share/pve-i18n/`
   - 格式與 PVE 現有語系檔完全一致

5. **deb 套件升級安全**
   - 修改系統檔案一律使用 `dpkg-divert` 保護
   - 使用者設定存放於 `/etc/pve-ups-panel/`
   - `postinst` / `prerm` / `postrm` 完整處理所有狀態

---

## 目錄結構（deb 套件）

```
pve-ups-panel/
├── debian/
│   ├── control
│   ├── changelog
│   ├── postinst          ← 安裝後處理
│   ├── prerm             ← 移除前處理
│   ├── postrm            ← 移除後處理
│   └── conffiles         ← 宣告使用者設定檔
├── usr/
│   ├── share/
│   │   ├── pve-manager/js/
│   │   │   └── pve-ups-panel.js        ← 主 UI
│   │   └── pve-i18n/
│   │       ├── pve-ups-lang-zh_TW.js
│   │       ├── pve-ups-lang-zh_CN.js
│   │       └── pve-ups-lang-*.js       ← 其他語系佔位檔
│   ├── lib/
│   │   └── pve-ups-panel/
│   │       ├── notify.pl               ← NUT NOTIFYCMD 腳本
│   │       └── collect-rrd.pl          ← RRD 資料收集腳本
│   └── share/perl5/PVE/API2/
│       └── UPS/
│           ├── UPS.pm                  ← 主 API 模組
│           ├── Config.pm               ← 設定檔讀寫
│           ├── RRD.pm                  ← 歷史資料
│           └── Notify.pm              ← 通知規則
└── etc/
    ├── pve-ups-panel/
    │   └── panel.conf                  ← 套件設定檔（conffile）
    └── systemd/system/
        ├── pve-ups-rrd.service
        └── pve-ups-rrd.timer
```

---

## API 路徑規劃

```
GET  /nodes/{node}/ups                  ← 概覽：即時狀態
GET  /nodes/{node}/ups/rrddata          ← 歷史資料
GET  /nodes/{node}/ups/devices          ← 裝置清單
POST /nodes/{node}/ups/devices          ← 新增裝置
PUT  /nodes/{node}/ups/devices/{name}   ← 修改裝置
DEL  /nodes/{node}/ups/devices/{name}   ← 刪除裝置
GET  /nodes/{node}/ups/config           ← 讀取 NUT 設定
PUT  /nodes/{node}/ups/config           ← 寫入 NUT 設定
GET  /nodes/{node}/ups/health           ← 電池健康資料
GET  /nodes/{node}/ups/events           ← 事件記錄
GET  /nodes/{node}/ups/shutdown-rules   ← 開關機規則
PUT  /nodes/{node}/ups/shutdown-rules   ← 更新開關機規則
GET  /nodes/{node}/ups/notify-rules     ← 通知規則
PUT  /nodes/{node}/ups/notify-rules     ← 更新通知規則
POST /nodes/{node}/ups/test             ← 執行電池測試
```

---

## 權限設計

| 操作 | 所需權限 |
|---|---|
| 讀取 UPS 狀態 | `Sys.Audit` |
| 修改 NUT 設定 | `Sys.Modify` |
| 執行電池測試 | `Sys.Modify` |
| 設定開關機規則 | `Sys.PowerMgmt` |
| 強制關機 | `Sys.PowerMgmt` |

---

## 開發順序

請依照以下順序實作，每個階段完成後通知我進行驗證：

```
Phase 1：UI 架構與分頁框架
Phase 2：概覽頁（含設定精靈）
Phase 3：裝置管理頁
Phase 4：後端 API（狀態讀取 + 設定讀寫）
Phase 5：歷史記錄頁（RRD 整合）
Phase 6：電池健康頁
Phase 7：開關機規則頁
Phase 8：通知頁
Phase 9：記錄頁
Phase 10：i18n 完整實作
Phase 11：deb 套件打包
```

**在開始任何實作之前，請先閱讀本目錄下的所有 prompt 檔案。**
