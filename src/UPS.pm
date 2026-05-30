package PVE::API2::UPS;

# PVE::API2::UPS — 主模組
# 掛載子路徑並提供 GET /nodes/{node}/ups 概覽端點。

use strict;
use warnings;

use PVE::RESTHandler;
use PVE::JSONSchema qw(get_standard_option);
use PVE::API2::UPS::Config;
use PVE::API2::UPS::Scan;
use PVE::API2::UPS::RRD;
use PVE::API2::UPS::Battery;
use PVE::API2::UPS::Shutdown;
use PVE::API2::UPS::Notify;
use PVE::API2::UPS::Log;

use base qw(PVE::RESTHandler);

my $UPS_CONF    = '/etc/nut/ups.conf';
my $UPSMON_CONF = '/etc/nut/upsmon.conf';

# ── 子路徑掛載 ──────────────────────────────────────────────────────────────
__PACKAGE__->register_method({ subclass => 'PVE::API2::UPS::Config',  path => 'config'  });
__PACKAGE__->register_method({ subclass => 'PVE::API2::UPS::Scan',    path => 'scan'    });
__PACKAGE__->register_method({ subclass => 'PVE::API2::UPS::RRD',     path => 'rrddata' });
__PACKAGE__->register_method({ subclass => 'PVE::API2::UPS::Battery',  path => 'battery'  });
__PACKAGE__->register_method({ subclass => 'PVE::API2::UPS::Shutdown', path => 'shutdown' });
__PACKAGE__->register_method({ subclass => 'PVE::API2::UPS::Notify',   path => 'notify'   });
__PACKAGE__->register_method({ subclass => 'PVE::API2::UPS::Log',      path => 'log'      });

# ── 輔助函式 ────────────────────────────────────────────────────────────────

# 回傳 { 純裝置名稱 => upsc 查詢位址 } 的對應表：
#   本機裝置 → name => name（upsc 預設查 localhost）
#   遠端裝置 → name => "name@host" 或 "name@host:port"（非 3493 時含 port）
sub _device_target_map {
    my %map;

    # 本機裝置：ups.conf section headers
    if (-f $UPS_CONF) {
        open(my $fh, '<', $UPS_CONF) or goto REMOTE;
        while (<$fh>) { $map{$1} = $1 if /^\[([^\]]+)\]/; }
        close $fh;
    }
    REMOTE:

    # 遠端裝置：upsmon.conf 非 localhost MONITOR 行
    if (-f $UPSMON_CONF) {
        open(my $fh, '<', $UPSMON_CONF) or return %map;
        while (<$fh>) {
            if (/^MONITOR\s+(\S+)\s/) {
                my $full_target = $1;
                next if $full_target =~ /\@localhost(?::\d+)?$/;
                my ($name) = $full_target =~ /^([^@]+)/;
                $map{$name} = $full_target unless exists $map{$name};
            }
        }
        close $fh;
    }

    return %map;
}

# 回傳所有已設定裝置的純名稱清單（供 _no_devices 判斷用）
sub _list_configured_devices {
    my %map = _device_target_map();
    return sort keys %map;
}

# 執行 upsc 並回傳 key-value hash
sub _run_upsc {
    my ($ups_name) = @_;
    my $result = {};
    open(my $fh, '-|', '/bin/upsc', $ups_name) or return $result;
    while (<$fh>) {
        chomp;
        $result->{$1} = $2 if /^([^:]+):\s*(.*)$/;
    }
    close $fh;
    return $result;
}

# 查詢 systemd 服務狀態
sub _service_status {
    my ($service) = @_;
    open(my $fh, '-|', 'systemctl', 'is-active', $service) or return 'inactive';
    my $status = <$fh> // '';
    chomp $status;
    close $fh;
    return ($status eq 'active') ? 'active' : 'inactive';
}

# ── GET /nodes/{node}/ups ──────────────────────────────────────────────────
__PACKAGE__->register_method({
    name        => 'status',
    path        => '',
    method      => 'GET',
    description => '取得 UPS 即時狀態。若無裝置設定則回傳 _no_devices: 1。',
    protected   => 1,
    proxyto     => 'node',
    permissions => { check => ['perm', '/nodes/{node}', ['Sys.Audit']] },
    parameters  => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            ups  => {
                type        => 'string',
                pattern     => '[a-zA-Z0-9_.-]+',
                default     => 'ups',
                optional    => 1,
                description => 'UPS 裝置名稱（Device Management 中設定的名稱）',
            },
        },
    },
    returns => {
        type                 => 'object',
        properties           => {},
        additionalProperties => 1,
    },
    code => sub {
        my ($param) = @_;

        my %target_map = _device_target_map();
        my @names = sort keys %target_map;
        return { _no_devices => 1 } unless @names;

        # 接受純裝置名稱；若不在清單中則退回第一台
        my $requested = $param->{ups} // $names[0];
        $requested =~ s/[^a-zA-Z0-9_.-]//g;
        $requested = $names[0] unless $target_map{$requested};

        # 內部解析成 upsc 查詢位址（本機用 name，遠端用 name@host[:port]）
        my $upsc_target = $target_map{$requested};

        my $result = _run_upsc($upsc_target);
        $result->{_ups_name}  = $requested;   # 回傳純名稱，前端用此識別裝置
        $result->{_available} = \@names;       # 純名稱清單，前端直接顯示
        $result->{_services}  = {
            'nut-server'  => _service_status('nut-server'),
            'nut-monitor' => _service_status('nut-monitor'),
        };

        PVE::API2::UPS::RRD::update_rrd($param->{node}, $requested, $result);

        return $result;
    },
});

1;
