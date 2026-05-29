# PVE UPS Panel — 後端 API 設計

## 模組結構

```
/usr/share/perl5/PVE/API2/UPS/
├── UPS.pm          ← 主模組，掛載子路徑
├── Config.pm       ← /ups/config、/ups/devices
├── RRD.pm          ← /ups/rrddata
├── Health.pm       ← /ups/health、/ups/test
├── Rules.pm        ← /ups/shutdown-rules、/ups/notify-rules
└── Scan.pm         ← /ups/scan-usb、/ups/test-connection
```

---

## UPS.pm（主模組）

負責掛載所有子路徑，並提供概覽端點：

```perl
package PVE::API2::UPS;

use PVE::API2::UPS::Config;
use PVE::API2::UPS::RRD;
use PVE::API2::UPS::Health;
use PVE::API2::UPS::Rules;
use PVE::API2::UPS::Scan;

# 子路徑掛載
__PACKAGE__->register_method({ subclass => "PVE::API2::UPS::Config",  path => 'config'  });
__PACKAGE__->register_method({ subclass => "PVE::API2::UPS::RRD",    path => 'rrddata' });
__PACKAGE__->register_method({ subclass => "PVE::API2::UPS::Health", path => 'health'  });
__PACKAGE__->register_method({ subclass => "PVE::API2::UPS::Rules",  path => 'rules'   });
__PACKAGE__->register_method({ subclass => "PVE::API2::UPS::Scan",   path => 'scan'    });

# GET /ups?ups=name — 概覽資料
__PACKAGE__->register_method({
    name        => 'status',
    path        => '',
    method      => 'GET',
    description => '取得 UPS 即時狀態',
    protected   => 1,
    proxyto     => 'node',
    permissions => { check => ['perm', '/nodes/{node}', ['Sys.Audit']] },
    parameters  => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            ups  => {
                type     => 'string',
                optional => 1,
                default  => 'ups',
            },
        },
    },
    code => sub {
        my ($param) = @_;
        my $ups_name = $param->{ups} // 'ups';

        # 確認是否有任何裝置設定
        my @devices = _list_devices();
        if (!@devices) {
            return { _no_devices => 1 };
        }

        # 執行 upsc 取得狀態
        my $result = _run_upsc($ups_name);
        $result->{_ups_name}     = $ups_name;
        $result->{_available}    = \@devices;
        return $result;
    },
});
```

---

## Config.pm

### GET /ups/devices — 裝置清單

回傳目前 `/etc/nut/ups.conf` 中所有已設定的裝置。

### POST /ups/devices — 新增裝置

參數：`name`、`driver`、`port`、`desc`、`mode`

寫入 `ups.conf`，同時依 mode 更新 `nut.conf`、`upsmon.conf`。

### PUT /ups/devices/{name} — 修改裝置

### DELETE /ups/devices/{name} — 刪除裝置

### GET /ups/config — 讀取完整 NUT 設定摘要

```json
{
  "mode": "standalone",
  "listen": "127.0.0.1",
  "port": 3493,
  "devices": [
    { "name": "ups", "driver": "usbhid-ups", "port": "auto" }
  ]
}
```

### PUT /ups/config — 寫入設定並重啟服務

**寫入前必須驗證設定檔語法**，失敗不覆蓋現有檔案。
所有寫入操作記錄到 PVE task log。

---

## Scan.pm

### GET /ups/scan-usb — 掃描 USB 裝置

執行 `lsusb`，比對已知 VID 清單，回傳建議 driver：

```perl
my %KNOWN_VID = (
    '0764' => {
        vendor  => 'CyberPower Systems',
        driver  => 'usbhid-ups',
    },
    '051d' => {
        vendor  => 'American Power Conversion',
        driver  => 'usbhid-ups',
    },
);
```

### POST /ups/test-connection — 測試遠端連線

參數：`host`、`port`、`ups`、`username`、`password`

執行 `upsc ups@host:port` 驗證可否連線，
**不寫入任何設定檔**，純測試用。

---

## RRD.pm

### RRD 檔案初始化

```perl
sub ensure_rrd_exists {
    my ($ups_name) = @_;
    my $rrd = "/var/lib/rrdcached/db/pve2-ups/$ups_name";

    return if -f $rrd;

    RRDs::create(
        $rrd,
        '--step', '60',
        'DS:battery_charge:GAUGE:120:0:100',
        'DS:runtime:GAUGE:120:0:65535',
        'DS:load:GAUGE:120:0:100',
        'DS:input_voltage:GAUGE:120:0:300',
        'DS:realpower:GAUGE:120:0:10000',
        'DS:apparent_power:GAUGE:120:0:10000',
        'RRA:AVERAGE:0.5:1:70',
        'RRA:AVERAGE:0.5:30:70',
        'RRA:AVERAGE:0.5:180:70',
        'RRA:AVERAGE:0.5:720:70',
        'RRA:AVERAGE:0.5:10080:70',
        'RRA:MIN:0.5:1:70',
        'RRA:MAX:0.5:1:70',
    );
}
```

### GET /ups/rrddata — 歷史資料

參數：`timeframe`（hour/day/week/month/year）、`cf`（AVERAGE/MAX）

回傳格式與 PVE 現有 rrddata 端點完全一致，
讓前端的 `proxmoxRRDChart` 可以直接使用。

---

## Health.pm

### GET /ups/health — 電池健康資料

讀取 `/etc/pve-ups-panel/battery-tests.json`，
計算健康度趨勢並回傳：

```json
{
  "health_percent": 82,
  "estimated_life_months": 8,
  "suggested_replace": "2027-01",
  "last_test": {
    "timestamp": "2026-05-01T14:30:00",
    "runtime": 2120,
    "result": "Done (Pass)"
  },
  "history": [...]
}
```

### POST /ups/test — 執行電池測試

```perl
# 寫入測試指令
system('upsrw', '-s', 'ups.test=battery', $ups_name);

# 記錄測試開始
_append_test_log({ timestamp => time(), status => 'started' });
```

---

## Rules.pm

### GET/PUT /ups/shutdown-rules
### GET/PUT /ups/notify-rules

讀寫 `/etc/pve-ups-panel/` 下的 JSON 設定檔。

PUT 操作後：
- shutdown-rules：重新產生關機監控腳本
- notify-rules：重新產生 `upsmon.conf` 的 NOTIFYFLAG 區段，重啟 nut-client

---

## 通用規範

### 設定檔寫入策略

```perl
sub write_config_safe {
    my ($file, $content) = @_;

    # 先寫入暫存檔
    my $tmp = "$file.tmp.$$";
    write_file($tmp, $content);

    # 驗證語法（依檔案類型）
    validate_nut_config($tmp, $file) or die "Config validation failed";

    # 原子替換
    rename($tmp, $file) or die "Cannot replace $file: $!";
}
```

### 錯誤回傳格式

所有錯誤使用 `die` 拋出，pveproxy 會自動轉換成：

```json
{ "success": 0, "errors": { "": "error message" } }
```

### 日誌記錄

所有修改操作使用 PVE task worker：

```perl
my $upid = $rpcenv->fork_worker('upsconfig', undef, $authuser, sub {
    PVE::Tools::run_command(['systemctl', 'restart', 'nut-server']);
    print "NUT server restarted\n";
});
return $upid;
```
