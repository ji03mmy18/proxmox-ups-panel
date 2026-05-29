# PVE UPS Panel — 裝置管理、歷史記錄、電池健康

---

## 裝置管理頁（pveUpsDevicePanel）

仿照 PVE 網路設定的左右分割版面：左側裝置清單，右側設定細節。

### 版面結構

```
┌──────────────────┬──────────────────────────────┐
│  ups             │  裝置：ups                    │
│  ● 連線中        │                               │
│                  │  Driver：    usbhid-ups        │
│  ups-rack        │  Port：      auto              │
│  ● 連線中        │  描述：      CP1000PFCLCDa     │
│                  │                               │
│                  │  NUT 模式：  standalone        │
│                  │  監聽位址：  127.0.0.1:3493    │
│                  │                               │
│  [+ 新增裝置]    │  [ 編輯 ]  [ 刪除 ]           │
└──────────────────┴──────────────────────────────┘
```

### 左側：裝置清單

使用 `Ext.grid.Panel`，每列顯示：
- 裝置名稱（粗體）
- 連線狀態（圓點 + 文字）

底部有「新增裝置」按鈕，點擊後開啟新增對話框。

### 右側：裝置細節

選取左側裝置後顯示，使用 `Proxmox.panel.StatusView`：

| 欄位 | 說明 |
|---|---|
| Driver | NUT driver 名稱 |
| Port | 連線路徑（auto / /dev/ttyS0 等） |
| Description | ups.conf 的 desc 欄位 |
| NUT Mode | standalone / netclient / netserver |
| Listen Address | upsd.conf 的 LISTEN 設定 |

### 新增 / 編輯裝置對話框

使用 `Ext.window.Window`（PVE 樣式）：

```
新增 UPS 裝置

  裝置名稱  ：[ ups          ]  *必填
  描述      ：[ CP1000PFCLCDa ]
  連線模式  ：[ 直接連接 ▼   ]

  --- 直接連接選項 ---
  Driver    ：[ usbhid-ups ▼ ]
  Port      ：[ auto         ]

  --- 遠端 NUT Server 選項 ---
  Server    ：[ 192.168.1.10 ]
  Port      ：[ 3493         ]
  帳號      ：[ upsmon       ]
  密碼      ：[ ••••••••     ]

  [ 取消 ]              [ 儲存 ]
```

### NUT 服務管理區塊

頁面底部獨立區塊：

```
NUT 服務管理

  nut-server   ● 執行中   已啟動 3 天 14 小時
  nut-client   ● 執行中   已啟動 3 天 14 小時

  [ 重啟所有服務 ]  [ 匯出設定 ]  [ 匯入設定 ]
```

---

## 歷史記錄頁（pveUpsHistory）

### 版面結構

```
┌─────────────────────────────────────────────────┐
│  裝置：[ ups ▼ ]  時間範圍：[ Day ▼ ]  ↺        │
├─────────────────────────────────────────────────┤
│  電池電量（%）                                   │
│  [RRD 圖表]                                      │
├─────────────────────────────────────────────────┤
│  UPS 負載（%）                                   │
│  [RRD 圖表]                                      │
├─────────────────────────────────────────────────┤
│  輸入電壓（V）                                   │
│  [RRD 圖表]                                      │
├─────────────────────────────────────────────────┤
│  功率（W / VA）                                  │
│  [RRD 圖表]                                      │
└─────────────────────────────────────────────────┘
```

### RRD 整合

**完全復用 PVE 原生元件**，不自行實作圖表：

```javascript
{
    xtype: 'proxmoxRRDChart',
    title: gettext('Battery Charge'),
    pveSelNode: me.pveSelNode,
    fields: ['battery_charge'],
    fieldTitles: [gettext('Battery Charge')],
    url: '/api2/json/nodes/' + nodename + '/ups/rrddata',
}
```

時間範圍選擇器使用 PVE 原生的 `proxmoxTimeSelector`，
支援：Hour / Day / Week / Month / Year。

### RRD 記錄的指標

| DS 名稱 | NUT 來源 | 單位 |
|---|---|---|
| battery_charge | battery.charge | % |
| runtime | battery.runtime | 秒 |
| load | ups.load | % |
| input_voltage | input.voltage | V |
| realpower | ups.realpower | W |
| apparent_power | ups.power | VA |

---

## 電池健康頁（pveUpsBatteryHealth）

### 版面結構

```
┌─────────────────────────────────────────────────┐
│  裝置：[ ups ▼ ]  ↺                             │
├───────────────────┬─────────────────────────────┤
│  電池健康度        │  手動電池測試                │
│                   │                             │
│  目前健康度        │  上次測試                   │
│  ████████░░ 82%   │  2026-05-01 14:30           │
│                   │  結果：Pass                  │
│  預估剩餘壽命      │  測試時剩餘時間：35m 20s     │
│  約 8 個月        │                             │
│                   │  [ 執行電池測試 ]            │
│  建議更換日期      │                             │
│  2027-01          │  測試進行中需約 10-20 分鐘   │
│                   │  請勿在測試期間關閉此頁面     │
└───────────────────┴─────────────────────────────┘
├─────────────────────────────────────────────────┤
│  測試歷史記錄                                    │
│                                                  │
│  日期              剩餘時間   結果    趨勢        │
│  2026-05-01        35m 20s   Pass    ─           │
│  2026-03-15        33m 45s   Pass    ↓ -2m       │
│  2026-01-20        31m 10s   Pass    ↓ -2m       │
│  2025-11-05        29m 50s   Pass    ↓ -1m       │
└─────────────────────────────────────────────────┘
```

### 健康度計算邏輯

```
健康度 % = (最新測試剩餘時間 / 首次記錄剩餘時間) × 100

健康度顯示：
  ≥ 80%  → 良好（綠色）
  60-79% → 注意（橘色）
  < 60%  → 建議更換（紅色）
```

### 電池測試執行

點擊「執行電池測試」後：

1. 呼叫 `/nodes/{node}/ups/test` API
2. 後端寫入 `ups.test = battery` 到 NUT
3. 前端每 30 秒輪詢測試狀態（`ups.test.result`）
4. 測試完成後自動記錄到歷史，刷新頁面資料

測試狀態顯示：

| ups.test.result | 顯示 |
|---|---|
| No test initiated | 尚未測試 |
| In progress | 測試進行中... |
| Done (Pass) | ✓ 通過 |
| Done (Warning) | ⚠ 警告 |
| Done (Error) | ✗ 失敗 |

### 測試記錄儲存

測試結果儲存於 `/etc/pve-ups-panel/battery-tests.json`，
格式：

```json
[
  {
    "timestamp": "2026-05-01T14:30:00",
    "ups": "ups",
    "runtime": 2120,
    "result": "Done (Pass)",
    "charge_at_test": 100
  }
]
```

此檔案宣告為 conffile，升級時不覆蓋。
