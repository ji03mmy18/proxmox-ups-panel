# PVE UPS Panel — UI 架構與導覽設計

## 節點樹整合

UPS 作為節點樹的子項目，與 Summary、System、Network 等原生分頁同層：

```
Datacenter
└── pve（節點）
    ├── Summary
    ├── Notes
    ├── Shell
    ├── System
    ├── Network
    ├── ...
    └── UPS              ← 注入位置（PVE.node.Config）
        ├── 裝置管理
        ├── 歷史記錄
        ├── 電池健康
        ├── 開關機規則
        ├── 通知
        └── 記錄
```

---

## 注入方式

使用 `Ext.override` 在 `PVE.node.Config` 的 `initComponent` 之後插入：

```javascript
Ext.override(PVE.node.Config, {
    initComponent: function() {
        this.callParent();
        this.add({
            xtype: 'pveUpsView',
            title: gettext('UPS'),
            iconCls: 'fa fa-bolt',
            nodename: this.nodename,
        });
    }
});
```

`pveUpsView` 是最外層的容器元件，內含 TabPanel 管理所有子分頁。

---

## 最外層容器：pveUpsView

```javascript
Ext.define('PVE.ups.View', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveUpsView',

    layout: 'border',

    // 點擊 UPS 節點時：
    // 1. 呼叫 API 確認是否有已設定的裝置
    // 2. 有裝置 → 顯示 TabPanel（含所有子分頁）
    // 3. 無裝置 → 顯示空白狀態頁（含精靈入口）
});
```

---

## 兩種進入狀態

### 狀態 A：尚未設定任何 UPS

完全置中的空白狀態，使用 PVE 原生的空狀態樣式：

```
┌──────────────────────────────────────────────┐
│                                              │
│                   ⚡                          │
│                                              │
│          尚未設定任何 UPS 裝置                │
│                                              │
│      點選下方按鈕開始設定您的第一台 UPS        │
│                                              │
│            [ 開始設定精靈 ]                   │
│                                              │
└──────────────────────────────────────────────┘
```

點擊「開始設定精靈」後，在當前頁面展開精靈（不開 modal window），
精靈完成後自動切換到狀態 B。

### 狀態 B：已有 UPS 裝置（正常狀態）

顯示完整 TabPanel，預設停在概覽分頁：

```
┌──────────────────────────────────────────────┐
│ 概覽 | 裝置管理 | 歷史記錄 | 電池健康 |      │
│ 開關機規則 | 通知 | 記錄                      │
├──────────────────────────────────────────────┤
│  （各分頁內容）                               │
└──────────────────────────────────────────────┘
```

---

## 裝置選單設計

概覽、歷史記錄、電池健康三個分頁頂部共用裝置選單。
選單切換後，當前分頁的所有資料跟著刷新。

```
裝置：[ ups - CP1000PFCLCDa  ▼ ]  ↺  ⚙
                                   │   └─ 跳到裝置管理
                                   └─ 手動重新整理
```

**選單狀態對應：**

| 狀態 | 顯示方式 |
|---|---|
| 正常連線 | `ups - CP1000PFCLCDa` |
| 裝置離線 | `ups - 連線中斷`（警告色） |
| 載入中 | `ups - 載入中...` |
| 多台裝置 | 下拉選單列出所有裝置 |

---

## 子分頁清單與對應元件

| 分頁標題 | xtype | iconCls |
|---|---|---|
| 概覽（UPS 本身） | `pveUpsOverview` | `fa fa-tachometer` |
| 裝置管理 | `pveUpsDevicePanel` | `fa fa-hdd-o` |
| 歷史記錄 | `pveUpsHistory` | `fa fa-line-chart` |
| 電池健康 | `pveUpsBatteryHealth` | `fa fa-heartbeat` |
| 開關機規則 | `pveUpsShutdownRules` | `fa fa-power-off` |
| 通知 | `pveUpsNotify` | `fa fa-bell` |
| 記錄 | `pveUpsLog` | `fa fa-list` |

---

## 共用元件規範

### 載入中狀態
使用 `Ext.LoadMask` 或 PVE 原生的 loading indicator，
不自訂任何 loading 動畫。

### 錯誤狀態
使用 `Proxmox.Utils.showResponse` 顯示 API 錯誤，
保持與 PVE 其他頁面一致的錯誤提示風格。

### 空值處理
所有從 API 取得的欄位，若為 `null`、`undefined` 或空字串，
一律以 `gettext('N/A')` 替代顯示，**不拋出例外**。

### 自動刷新
概覽頁每 **10 秒**自動刷新一次。
其他分頁**不自動刷新**，需使用者手動點擊 ↺ 按鈕。

---

## 注意事項

- **不引入任何外部 CSS 或 JS 檔案**
- **不使用 innerHTML 或自訂 HTML 字串**（全部用 ExtJS 元件）
- 所有文字使用 `gettext()` 包裝（i18n 規範見 `06-i18n.md`）
- 元件命名空間統一使用 `PVE.ups.*`
