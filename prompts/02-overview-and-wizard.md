# PVE UPS Panel — 概覽頁與設定精靈

## 概覽頁（pveUpsOverview）

點擊節點樹的「UPS」項目時直接顯示此頁，不需要額外點擊分頁。

### 版面結構

```
┌─────────────────────────────────────────────────┐
│  裝置：[ ups - CP1000PFCLCDa  ▼ ]  ↺  ⚙        │  ← Toolbar
├─────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────┐ │  ← Dashboard Row
│  │  狀態    │ │  電池電量 │ │ 剩餘時間  │ │負載│ │
│  └──────────┘ └──────────┘ └──────────┘ └────┘ │
├─────────────────────────────────────────────────┤
│  ┌───────────────────┐  ┌───────────────────┐   │  ← Card Row 1
│  │    電池狀態        │  │    輸入電源        │   │
│  └───────────────────┘  └───────────────────┘   │
├─────────────────────────────────────────────────┤
│  ┌───────────────────┐  ┌───────────────────┐   │  ← Card Row 2
│  │    輸出 / 負載     │  │    裝置資訊        │   │
│  └───────────────────┘  └───────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## Dashboard Row 四個指標

使用 PVE 原生的 `PVE.form.GaugeWidget` 或等效元件。

### 1. UPS 狀態

不使用圓環，改用狀態 badge，顯示目前 `ups.status` 的解析結果：

| ups.status 值 | 顯示文字 | 嚴重度 |
|---|---|---|
| OL | On Line | ok |
| OB | On Battery | warning |
| LB | Low Battery | critical |
| CHRG | Charging | ok |
| DISCHRG | Discharging | warning |
| BOOST | Boosting | warning |
| TRIM | Trimming | warning |
| FSD | Forced Shutdown | critical |
| RB | Replace Battery | critical |
| OVER | Overload | critical |

多重狀態（例如 `OL CHRG`）以 `/` 分隔顯示。

### 2. 電池電量（battery.charge）
- 使用圓環進度圖
- 顏色：≥50% 綠色、20-49% 橘色、<20% 紅色

### 3. 剩餘時間（battery.runtime）
- 顯示大字數值，格式：`Xh Ym` 或 `Ym Zs`
- 無需圓環，純數字展示即可

### 4. 負載（ups.load）
- 使用圓環進度圖
- 顏色：<60% 綠色、60-79% 橘色、≥80% 紅色

---

## 資訊卡片

使用 `Proxmox.panel.StatusView` 或 `Ext.grid.Panel`（hideHeaders: true）。

### 電池狀態卡片

| 欄位標籤 | NUT 變數 | 格式 |
|---|---|---|
| Battery Charge | battery.charge | `X %` |
| Low Battery Threshold | battery.charge.low | `X %` |
| Warning Threshold | battery.charge.warning | `X %` |
| Runtime to Empty | battery.runtime | `Xh Ym` |
| Low Runtime Threshold | battery.runtime.low | `Xh Ym` |
| Design Capacity | battery.capacity | `X %` |
| Battery Type | battery.type | 字串 |
| Battery Date | battery.date | 字串 |

### 輸入電源卡片

| 欄位標籤 | NUT 變數 | 格式 |
|---|---|---|
| Input Voltage | input.voltage | `X.X V` |
| Nominal Input Voltage | input.voltage.nominal | `X.X V` |
| Minimum Input Voltage | input.voltage.minimum | `X.X V` |
| Maximum Input Voltage | input.voltage.maximum | `X.X V` |
| Low Transfer Threshold | input.transfer.low | `X V` |
| High Transfer Threshold | input.transfer.high | `X V` |
| Input Frequency | input.frequency | `X.X Hz` |
| Nominal Frequency | input.frequency.nominal | `X.X Hz` |

### 輸出 / 負載卡片

| 欄位標籤 | NUT 變數 | 格式 |
|---|---|---|
| Percent Load | ups.load | `X %` |
| Real Power | ups.realpower | `X W` |
| Apparent Power | ups.power | `X VA` |
| Nominal Power | ups.power.nominal | `X VA` |
| Output Voltage | output.voltage | `X.X V` |
| Nominal Output Voltage | output.voltage.nominal | `X.X V` |
| Output Frequency | output.frequency | `X.X Hz` |
| Beeper Status | ups.beeper.status | 字串 |

### 裝置資訊卡片

| 欄位標籤 | NUT 變數 | 格式 |
|---|---|---|
| Manufacturer | ups.mfr | 字串 |
| Model | ups.model | 字串 |
| Serial | ups.serial | 字串 |
| Firmware | ups.firmware | 字串 |
| Device Manufacturer | device.mfr | 字串 |
| Device Model | device.model | 字串 |
| Device Serial | device.serial | 字串 |
| Test Result | ups.test.result | 字串 |

---

## 設定精靈（pveUpsSetupWizard）

### 觸發條件

API 回傳 `_no_devices: true` 時，概覽頁顯示空白狀態，
點擊「開始設定精靈」後，在當前 panel 內切換到精靈畫面。

### 使用 PVE 原生精靈元件

```javascript
Ext.define('PVE.ups.SetupWizard', {
    extend: 'PVE.window.Wizard',  // 使用 PVE 原生 Wizard
    // ...
});
```

### Step 1：選擇連線模式

```
選擇 UPS 連線方式：

  ○ 直接連接（USB / Serial）
    UPS 實體連接到這台機器

  ○ 遠端 NUT Server
    連線到其他機器上的 NUT Server
```

### Step 2a：直接連接設定

```
已偵測到的 USB 裝置：

  ○ VID 0x0764  PID 0x0601  CyberPower Systems
    建議 Driver：usbhid-ups

  ○ VID 0x051D  PID 0x0002  American Power Conversion
    建議 Driver：usbhid-ups

  ○ 找不到我的裝置（手動輸入）

裝置名稱：[ ups        ]   （英數字、底線、連字號）
Driver：  [ usbhid-ups ▼ ]  （根據 VID 自動選取）
```

USB 偵測來源：
- 呼叫 `/nodes/{node}/ups/scan-usb` API
- 後端執行 `lsusb` 並比對已知 VID 清單
- 已知 VID：`0x0764`（CyberPower）、`0x051D`（APC）

### Step 2b：遠端 NUT Server 設定

```
NUT Server 位址：[ 192.168.1.10 ]
Port：           [ 3493         ]
UPS 名稱：       [ ups          ]
帳號：           [ upsmon       ]
密碼：           [ ••••••••     ]

                         [ 測試連線 ]
```

「測試連線」呼叫 `/nodes/{node}/ups/test-connection` API，
成功顯示綠色提示，失敗顯示錯誤原因。

### Step 3：確認與套用

```
設定摘要

  連線模式：直接連接（standalone）
  裝置名稱：ups
  Driver：  usbhid-ups
  裝置路徑：auto

  將會執行：
  ✓ 寫入 /etc/nut/nut.conf
  ✓ 寫入 /etc/nut/ups.conf
  ✓ 寫入 /etc/nut/upsmon.conf
  ✓ 啟動 nut-server、nut-client

[ 上一步 ]                    [ 套用設定 ]
```

套用時顯示進度，完成後自動切換到概覽正常狀態。
失敗時停在此步驟並顯示詳細錯誤訊息。

---

## NUT 服務狀態（概覽頁底部）

在裝置資訊卡片下方顯示服務狀態列：

```
服務狀態
  nut-server   ● 執行中    [重啟]
  nut-client   ● 執行中    [重啟]
```

| 狀態 | 顯示 |
|---|---|
| active (running) | ● 執行中（綠色） |
| inactive / failed | ● 已停止（紅色） |

「重啟」按鈕需要 `Sys.Modify` 權限，無權限時隱藏。
