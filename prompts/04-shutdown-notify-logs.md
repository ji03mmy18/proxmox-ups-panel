# PVE UPS Panel — 開關機規則、通知、記錄

---

## 開關機規則頁（pveUpsShutdownRules）

### 版面結構

```
┌─────────────────────────────────────────────────┐
│  ⚠ 以下規則僅套用於節點 pve1                    │
├─────────────────────────────────────────────────┤
│  全域節點關機條件                                │
│                                                  │
│  當電量低於 [ 15 ] % 或剩餘時間低於 [ 3 ] 分鐘  │
│  → 關閉節點                                      │
├─────────────────────────────────────────────────┤
│  VM / CT 關機規則                                │
│                                                  │
│  優先級  裝置              觸發條件   動作   操作 │
│    1    VM 105 test-srv   < 20 min   關機  ✎ ✕  │
│    2    CT 201 download   < 15 min   關機  ✎ ✕  │
│    3    VM 100 prod-db    <  5 min   休眠  ✎ ✕  │
│                                                  │
│  [+ 新增規則]                                    │
├─────────────────────────────────────────────────┤
│  市電恢復策略                                    │
│                                                  │
│  充電至 [ 50 ] % 後，依相反順序自動啟動 VM/CT    │
│  每台之間等待 [ 30 ] 秒                          │
└─────────────────────────────────────────────────┘
```

### 新增 / 編輯規則對話框

```
新增關機規則

  選擇裝置：
  ┌─────────────────────────────┐
  │ ○ VM 100  prod-db           │
  │ ○ VM 103  media-server      │
  │ ○ VM 105  test-server  ← 勾 │
  │ ○ CT 201  download-box      │
  └─────────────────────────────┘
  （從 PVE API 拉取，不手動輸入 VMID）

  觸發條件：
    ○ 電量低於  [ 20 ] %
    ○ 剩餘時間低於  [ 15 ] 分鐘
    ● 任一條件達到（電量 < [20]% 或時間 < [15] 分鐘）

  執行動作：
    ● 正常關機（Graceful Shutdown）
    ○ 休眠（Suspend to Disk）
    ○ 強制停止（Force Stop）

  關機逾時：[ 60 ] 秒（超過後自動強制停止）

  優先級：[ 1 ]（數字越小越先執行）

  [ 取消 ]                    [ 儲存 ]
```

### VM/CT 清單來源

```javascript
// 從 PVE API 取得當前節點所有 VM 和 CT
Proxmox.Utils.API2Request({
    url: '/api2/extjs/nodes/' + nodename + '/qemu',
    // 合併 CT 清單
});
Proxmox.Utils.API2Request({
    url: '/api2/extjs/nodes/' + nodename + '/lxc',
});
```

### 規則儲存格式

儲存於 `/etc/pve-ups-panel/shutdown-rules.json`：

```json
{
  "global": {
    "charge_threshold": 15,
    "runtime_threshold": 180
  },
  "rules": [
    {
      "priority": 1,
      "vmid": 105,
      "type": "qemu",
      "name": "test-server",
      "trigger": "any",
      "charge": 20,
      "runtime": 1200,
      "action": "shutdown",
      "timeout": 60
    }
  ],
  "recovery": {
    "charge_before_start": 50,
    "interval_seconds": 30,
    "auto_start": true
  }
}
```

---

## 通知頁（pveUpsNotify）

### 版面結構

```
┌─────────────────────────────────────────────────┐
│  通知目標（來自 Datacenter → Notifications）      │
│                                                  │
│  smtp-email     SMTP     ● 已設定                │
│  webhook-slack  Webhook  ● 已設定                │
│                                                  │
│  前往 Datacenter 設定更多通知目標 →              │
├─────────────────────────────────────────────────┤
│  UPS 事件通知規則                                │
│                                                  │
│  事件              嚴重度   啟用  通知目標        │
│  市電中斷           警告    ✓    smtp + slack    │
│  市電恢復           資訊    ✓    slack           │
│  電量過低           嚴重    ✓    smtp + slack    │
│  強制關機           嚴重    ✓    smtp + slack    │
│  通訊中斷           警告    ✓    slack           │
│  需更換電池         警告    ✓    smtp            │
│  負載過高           警告    ✓    slack           │
│    門檻：[ 80 ] %                                │
│  電壓異常           警告    ✓    slack           │
│    門檻：額定值 ± [ 10 ] %                       │
│                                                  │
│                            [ 儲存規則 ]          │
└─────────────────────────────────────────────────┘
```

### 通知目標清單來源

呼叫 PVE 現有 API 取得已設定的 Notification Endpoints：

```javascript
Proxmox.Utils.API2Request({
    url: '/api2/extjs/cluster/notifications/endpoints',
});
```

### 通知規則儲存格式

儲存於 `/etc/pve-ups-panel/notify-rules.json`：

```json
{
  "rules": [
    {
      "event": "ONBATT",
      "severity": "warning",
      "enabled": true,
      "targets": ["smtp-email", "webhook-slack"]
    },
    {
      "event": "LOWBATT",
      "severity": "error",
      "enabled": true,
      "targets": ["smtp-email", "webhook-slack"]
    },
    {
      "event": "OVERLOAD",
      "severity": "warning",
      "enabled": true,
      "targets": ["webhook-slack"],
      "threshold": 80
    }
  ]
}
```

### NUT NOTIFYCMD 整合

通知規則儲存後，後端自動更新 `/etc/nut/upsmon.conf` 的
`NOTIFYFLAG` 設定，並重啟 `nut-client`。

---

## 記錄頁（pveUpsLog）

### 版面結構

```
┌─────────────────────────────────────────────────┐
│  [ 事件記錄 ]  [ 操作記錄 ]       ↺  [ 清除 ]   │
├─────────────────────────────────────────────────┤
│  時間                裝置  事件          詳細    │
│  2026-05-27 03:14   ups   市電中斷      電量100% │
│  2026-05-27 03:42   ups   市電恢復      停電28分 │
│  2026-05-26 14:30   ups   電池測試完成  Pass     │
└─────────────────────────────────────────────────┘
```

### 事件記錄

來源：`/var/log/pve-ups-panel/events.log`
由 `notify.pl` 在每次 NUT 事件時寫入。

格式：
```
2026-05-27T03:14:22 ups ONBATT charge=100 runtime=2100
2026-05-27T03:42:15 ups ONLINE outage_duration=1673
```

### 操作記錄（稽核）

來源：PVE task log（`/var/log/pve/tasks/`）
所有透過 UI 執行的操作（修改設定、執行測試、重啟服務）
都要寫入 PVE task log：

```perl
my $upid = $rpcenv->fork_worker(
    'upscfg',      # task type
    undef,
    $authuser,
    sub {
        # 實際操作
        print "Applying NUT configuration...\n";
    }
);
```

這樣操作記錄就會自動出現在 PVE 原生的 task log 中，
不需要額外的 UI，與其他 PVE 操作記錄完全整合。

### 清除按鈕

只清除 `/var/log/pve-ups-panel/events.log`，
不清除 PVE task log（task log 由 PVE 自行管理）。
需要 `Sys.Modify` 權限才能清除。
