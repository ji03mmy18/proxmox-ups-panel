package PVE::API2::UPS::RRD;

# PVE::API2::UPS::RRD
# 掛載於 /nodes/{node}/ups/rrddata
# 提供 UPS RRD 歷史資料讀取端點，並匯出 update_rrd() 供 UPS.pm 呼叫。

use strict;
use warnings;

use PVE::RESTHandler;
use PVE::JSONSchema qw(get_standard_option);
use PVE::RRD;
use RRDs;

use base qw(PVE::RESTHandler);

my $RRD_BASE = '/var/lib/rrdcached/db/pve-ups-1.0';

# ── 輔助函式 ────────────────────────────────────────────────────────────────

sub _rrd_path {
    my ($node, $ups) = @_;
    $ups  =~ s/[^a-zA-Z0-9_.-]//g;
    $node =~ s/[^a-zA-Z0-9_.-]//g;
    return "$RRD_BASE/${node}-${ups}";
}

sub _ensure_rrd {
    my ($path) = @_;
    return if -f $path;

    mkdir $RRD_BASE, 0750 unless -d $RRD_BASE;

    my @ds = (
        'DS:battery_charge:GAUGE:120:0:100',
        'DS:runtime:GAUGE:120:0:U',
        'DS:load:GAUGE:120:0:100',
        'DS:input_voltage:GAUGE:120:0:U',
        'DS:realpower:GAUGE:120:0:U',
        'DS:apparent_power:GAUGE:120:0:U',
    );

    # RRA 與 PVE9 pve-node 格式一致，讓 PVE::RRD::create_rrd_data 可直接讀取
    my @rra = (
        'RRA:AVERAGE:0.5:1:60',
        'RRA:AVERAGE:0.5:1:1440',
        'RRA:AVERAGE:0.5:30:336',
        'RRA:AVERAGE:0.5:30:1440',
        'RRA:AVERAGE:0.5:360:1440',
        'RRA:AVERAGE:0.5:10080:570',
        'RRA:MAX:0.5:1:60',
        'RRA:MAX:0.5:1:1440',
        'RRA:MAX:0.5:30:336',
        'RRA:MAX:0.5:30:1440',
        'RRA:MAX:0.5:360:1440',
        'RRA:MAX:0.5:10080:570',
    );

    RRDs::create($path, '--step', 60, @ds, @rra);
    my $err = RRDs::error;
    die "RRD create error: $err\n" if $err;
}

# update_rrd — 由 UPS.pm 的 GET /ups 端點呼叫
sub update_rrd {
    my ($node, $ups, $data) = @_;

    eval {
        my $path = _rrd_path($node, $ups);
        _ensure_rrd($path);

        my $bc = $data->{'battery.charge'}  // 'U';
        my $rt = $data->{'battery.runtime'} // 'U';
        my $ld = $data->{'ups.load'}        // 'U';
        my $iv = $data->{'input.voltage'}   // 'U';
        my $rp = $data->{'ups.realpower'}   // 'U';
        my $ap = $data->{'ups.power'}       // 'U';

        my $val = "N:${bc}:${rt}:${ld}:${iv}:${rp}:${ap}";

        my $socket = '/var/run/rrdcached.sock';
        if (-S $socket) {
            RRDs::update($path, '--daemon', "unix:$socket", $val);
        } else {
            RRDs::update($path, $val);
        }
        my $err = RRDs::error;
        warn "RRD update error: $err\n" if $err;
    };
    warn "RRD update failed: $@\n" if $@;
}

# ── GET /nodes/{node}/ups/rrddata ──────────────────────────────────────────
__PACKAGE__->register_method({
    name        => 'rrddata',
    path        => '',
    method      => 'GET',
    description => '取得 UPS RRD 歷史資料。',
    protected   => 1,
    proxyto     => 'node',
    permissions => { check => ['perm', '/nodes/{node}', ['Sys.Audit']] },
    parameters  => {
        additionalProperties => 0,
        properties => {
            node      => get_standard_option('pve-node'),
            ups       => {
                type     => 'string',
                pattern  => '[a-zA-Z0-9_@.-]+',
                default  => 'ups',
                optional => 1,
                description => 'UPS 裝置名稱',
            },
            timeframe => {
                type => 'string',
                enum => ['hour', 'day', 'week', 'month', 'year'],
                description => '時間範圍',
            },
            cf => {
                type        => 'string',
                enum        => ['AVERAGE', 'MAX'],
                optional    => 1,
                default     => 'AVERAGE',
                description => '合併函式',
            },
        },
    },
    returns => {
        type  => 'array',
        items => { type => 'object', properties => {}, additionalProperties => 1 },
    },
    code => sub {
        my ($param) = @_;
        my $node      = $param->{node};
        my $ups       = $param->{ups} // 'ups';
        my $timeframe = $param->{timeframe};
        my $cf        = $param->{cf} // 'AVERAGE';

        $ups  =~ s/[^a-zA-Z0-9_.-]//g;
        $node =~ s/[^a-zA-Z0-9_.-]//g;

        my $rrdname = "pve-ups-1.0/${node}-${ups}";
        return [] unless -f "/var/lib/rrdcached/db/$rrdname";

        return PVE::RRD::create_rrd_data($rrdname, $timeframe, $cf);
    },
});

1;
