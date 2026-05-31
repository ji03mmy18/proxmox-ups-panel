package PVE::API2::UPS::Battery;

# PVE::API2::UPS::Battery
# 掛載於 /nodes/{node}/ups/battery
# 提供電池健康資料讀取、手動電池測試觸發與歷史記錄管理。

use strict;
use warnings;

use PVE::RESTHandler;
use PVE::JSONSchema qw(get_standard_option);
use JSON;
use POSIX qw(strftime);

use base qw(PVE::RESTHandler);

my $TESTS_FILE  = '/etc/pve-ups-panel/battery-tests.json';
my $TESTS_DIR   = '/etc/pve-ups-panel';
my $UPS_CONF    = '/etc/nut/ups.conf';
my $UPSMON_CONF = '/etc/nut/upsmon.conf';

# ── 輔助函式 ────────────────────────────────────────────────────────────────

# 將純裝置名稱解析成 upsc/upscmd 查詢位址
#   本機裝置 → name（upsc 預設查 localhost）
#   遠端裝置 → name@host 或 name@host:port
sub _resolve_upsc_target {
    my ($name) = @_;
    if (-f $UPS_CONF) {
        open my $fh, '<', $UPS_CONF or goto REMOTE;
        while (<$fh>) { return $name if /^\[$name\]/; }
        close $fh;
    }
    REMOTE:
    if (-f $UPSMON_CONF) {
        open my $fh, '<', $UPSMON_CONF or return $name;
        while (<$fh>) {
            if (/^MONITOR\s+(\S+)\s/) {
                my $target = $1;
                next if $target =~ /\@localhost(?::\d+)?$/;
                my ($dname) = $target =~ /^([^@]+)/;
                return $target if $dname eq $name;
            }
        }
        close $fh;
    }
    return $name;
}

sub _run_upsc {
    my ($ups) = @_;
    my $result = {};
    open(my $fh, '-|', '/bin/upsc', $ups) or return $result;
    while (<$fh>) {
        chomp;
        $result->{$1} = $2 if /^([^:]+):\s*(.*)$/;
    }
    close $fh;
    return $result;
}

sub _read_all_tests {
    return [] unless -f $TESTS_FILE;
    open(my $fh, '<', $TESTS_FILE) or return [];
    my $content;
    { local $/; $content = <$fh>; }
    close $fh;
    return eval { decode_json($content) } // [];
}

sub _write_all_tests {
    my ($all) = @_;
    mkdir $TESTS_DIR, 0750 unless -d $TESTS_DIR;
    open(my $fh, '>', $TESTS_FILE) or die "Cannot write $TESTS_FILE: $!\n";
    print $fh encode_json($all);
    close $fh;
}

sub _tests_for_ups {
    my ($all, $ups) = @_;
    return [grep { ($_->{ups} // '') eq $ups } @$all];
}

# 從 /etc/nut/upsd.users 尋找有 instcmds 權限的使用者
sub _find_nut_admin {
    my $file = '/etc/nut/upsd.users';
    return (undef, undef) unless -f $file;

    open(my $fh, '<', $file) or return (undef, undef);

    my %users;
    my $cur;

    while (<$fh>) {
        chomp;
        s/#.*//;
        s/^\s+|\s+$//g;
        next unless $_;

        if (/^\[([^\]]+)\]/) {
            $cur = $1;
            $users{$cur} = { name => $cur };
        } elsif ($cur && /^password\s*=\s*(.+)$/) {
            $users{$cur}{password} = $1;
        } elsif ($cur && /^instcmds\s*=\s*(.+)$/i) {
            $users{$cur}{instcmds} = $1;
        }
    }
    close $fh;

    for my $u (values %users) {
        if (defined $u->{instcmds} && defined $u->{password}) {
            return ($u->{name}, $u->{password});
        }
    }
    return (undef, undef);
}

# 計算健康度指標
sub _calculate_health {
    my ($tests) = @_;

    my @done = sort { $a->{timestamp} cmp $b->{timestamp} }
               grep { ($_->{status} // '') eq 'completed' && defined $_->{runtime} && $_->{runtime} > 0 }
               @$tests;

    return { health => undef, estimated_months => undef, replace_by => undef }
        unless @done;

    my $first  = $done[0]->{runtime};
    my $latest = $done[-1]->{runtime};

    my $health = int($latest / $first * 100);
    $health = 100 if $health > 100;
    $health = 0   if $health < 0;

    my ($estimated_months, $replace_by);

    if (@done >= 2) {
        my ($fy, $fm) = $done[0]->{timestamp}  =~ /^(\d{4})-(\d{2})/;
        my ($ly, $lm) = $done[-1]->{timestamp} =~ /^(\d{4})-(\d{2})/;
        my $months_elapsed = ($ly - $fy) * 12 + ($lm - $fm);

        if ($months_elapsed > 0) {
            my $decline_pm = ($first - $latest) / $months_elapsed;
            if ($decline_pm > 0) {
                my $threshold = $first * 0.6;
                my $rem       = $latest - $threshold;
                $estimated_months = int($rem / $decline_pm);
                $estimated_months = 0 if $estimated_months < 0;

                my $ry = $ly + int(($lm + $estimated_months - 1) / 12);
                my $rm = (($lm + $estimated_months - 1) % 12) + 1;
                $replace_by = sprintf('%04d-%02d', $ry, $rm);
            }
        }
    }

    return {
        health           => $health,
        estimated_months => $estimated_months,
        replace_by       => $replace_by,
    };
}

# 若有 pending 測試且 upsc 顯示 Done，自動完成記錄
sub _maybe_finalize_pending {
    my ($all, $ups, $upsc_data) = @_;

    my $test_result = $upsc_data->{'ups.test.result'} // '';
    return 0 unless $test_result =~ /^Done/i;

    my $updated = 0;
    for my $t (reverse @$all) {
        next unless ($t->{ups} // '') eq $ups;
        next unless ($t->{status} // '') eq 'pending';

        $t->{status}         = 'completed';
        $t->{result}         = $test_result;
        $t->{runtime}        = $upsc_data->{'battery.runtime'}
                                 ? int($upsc_data->{'battery.runtime'}) : undef;
        $t->{charge_at_test} = $upsc_data->{'battery.charge'}
                                 ? int($upsc_data->{'battery.charge'}) : undef;
        $updated = 1;
        last;
    }

    if ($updated) {
        eval { _write_all_tests($all) };
        warn "Battery: failed to write tests: $@\n" if $@;
    }
    return $updated;
}

# ── GET /nodes/{node}/ups/battery ─────────────────────────────────────────
__PACKAGE__->register_method({
    name        => 'battery',
    path        => '',
    method      => 'GET',
    description => '取得電池健康資料與測試歷史。',
    protected   => 1,
    proxyto     => 'node',
    permissions => { check => ['perm', '/nodes/{node}', ['Sys.Audit']] },
    parameters  => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            ups  => {
                type     => 'string',
                pattern  => '[a-zA-Z0-9_@.-]+',
                default  => 'ups',
                optional => 1,
                description => 'UPS 裝置名稱',
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
        my $ups = $param->{ups} // 'ups';
        $ups =~ s/[^a-zA-Z0-9_.-]//g;
        my $upsc_target = _resolve_upsc_target($ups);

        my $upsc_data   = _run_upsc($upsc_target);
        my $test_result = $upsc_data->{'ups.test.result'} // 'No test initiated';

        my $all   = _read_all_tests();
        my $tests = _tests_for_ups($all, $ups);

        if (_maybe_finalize_pending($all, $ups, $upsc_data)) {
            $tests = _tests_for_ups($all, $ups);
        }

        my $health_info = _calculate_health($tests);

        # 完成的測試，最新在前
        my @visible = sort { $b->{timestamp} cmp $a->{timestamp} }
                      grep { ($_->{status} // '') eq 'completed' }
                      @$tests;

        # 是否有 pending（測試進行中）
        my @pending = grep { ($_->{status} // '') eq 'pending' } @$tests;
        my $has_pending = scalar(@pending) > 0;

        return {
            tests            => \@visible,
            test_result      => $test_result,
            test_pending     => $has_pending ? 1 : 0,
            health           => $health_info->{health},
            estimated_months => $health_info->{estimated_months},
            replace_by       => $health_info->{replace_by},
        };
    },
});

# ── POST /nodes/{node}/ups/battery/test ───────────────────────────────────
__PACKAGE__->register_method({
    name        => 'run_test',
    path        => 'test',
    method      => 'POST',
    description => '觸發電池測試。',
    protected   => 1,
    proxyto     => 'node',
    permissions => { check => ['perm', '/nodes/{node}', ['Sys.PowerMgmt']] },
    parameters  => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            ups  => {
                type     => 'string',
                pattern  => '[a-zA-Z0-9_@.-]+',
                default  => 'ups',
                optional => 1,
                description => 'UPS 裝置名稱',
            },
            type => {
                type        => 'string',
                enum        => ['quick', 'full'],
                default     => 'quick',
                optional    => 1,
                description => '測試類型：quick（快速，10-20秒）或 full（完整，放電至低電量門檻）',
            },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;
        my $ups  = $param->{ups}  // 'ups';
        my $type = $param->{type} // 'quick';
        $ups =~ s/[^a-zA-Z0-9_.-]//g;
        my $upsc_target = _resolve_upsc_target($ups);

        my ($user, $pass) = _find_nut_admin();
        die "No NUT user with instcmds permission found in /etc/nut/upsd.users.\n" .
            "Add a user with 'instcmds = ALL' to enable battery testing.\n"
            unless $user;

        # Resolve available commands from the UPS driver
        my %supported;
        if (open my $lf, '-|', 'upscmd', '-l', $upsc_target) {
            while (<$lf>) { $supported{$1} = 1 if /^(\S+)\s*-/; }
            close $lf;
        }

        my $cmd;
        if ($type eq 'full') {
            # Prefer .deep (CyberPower), fall back to generic .start
            if ($supported{'test.battery.start.deep'}) {
                $cmd = 'test.battery.start.deep';
            } elsif ($supported{'test.battery.start'}) {
                $cmd = 'test.battery.start';
            } else {
                die "This UPS does not support a full battery test " .
                    "(neither 'test.battery.start.deep' nor 'test.battery.start' is available).\n";
            }
        } else {
            $cmd = 'test.battery.start.quick';
            die "This UPS does not support '$cmd'.\n"
                if %supported && !$supported{$cmd};
        }

        open(my $fh, '-|', 'upscmd', '-u', $user, '-p', $pass, $upsc_target, $cmd)
            or die "Cannot run upscmd: $!\n";
        my $out = do { local $/; <$fh> };
        close $fh;
        my $ok = ($? == 0);
        die "Failed to start battery test: $out\n" unless $ok;

        my $upsc_data = _run_upsc($upsc_target);
        my $charge    = $upsc_data->{'battery.charge'};

        my $all   = _read_all_tests();
        # 移除舊的 pending（避免累積）
        @$all = grep { !(($_->{ups} // '') eq $ups && ($_->{status} // '') eq 'pending') } @$all;

        push @$all, {
            timestamp      => strftime('%Y-%m-%dT%H:%M:%S', localtime),
            ups            => $ups,
            runtime        => undef,
            result         => undef,
            charge_at_test => $charge ? int($charge) : undef,
            status         => 'pending',
        };
        _write_all_tests($all);

        return undef;
    },
});

# ── POST /nodes/{node}/ups/battery/stop ───────────────────────────────────
__PACKAGE__->register_method({
    name        => 'stop_test',
    path        => 'stop',
    method      => 'POST',
    description => '中止執行中的電池測試。',
    protected   => 1,
    proxyto     => 'node',
    permissions => { check => ['perm', '/nodes/{node}', ['Sys.PowerMgmt']] },
    parameters  => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            ups  => {
                type     => 'string',
                pattern  => '[a-zA-Z0-9_@.-]+',
                default  => 'ups',
                optional => 1,
                description => 'UPS 裝置名稱',
            },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;
        my $ups = $param->{ups} // 'ups';
        $ups =~ s/[^a-zA-Z0-9_.-]//g;
        my $upsc_target = _resolve_upsc_target($ups);

        my ($user, $pass) = _find_nut_admin();
        die "No NUT user with instcmds permission found in /etc/nut/upsd.users.\n"
            unless $user;

        my %supported;
        if (open my $lf, '-|', 'upscmd', '-l', $upsc_target) {
            while (<$lf>) { $supported{$1} = 1 if /^(\S+)\s*-/; }
            close $lf;
        }
        die "This UPS does not support 'test.battery.stop'.\n"
            if %supported && !$supported{'test.battery.stop'};

        open(my $fh, '-|', 'upscmd', '-u', $user, '-p', $pass, $upsc_target, 'test.battery.stop')
            or die "Cannot run upscmd: $!\n";
        my $out = do { local $/; <$fh> };
        close $fh;
        die "Failed to stop battery test: $out\n" unless ($? == 0);

        # Mark any pending record as aborted
        my $all = _read_all_tests();
        my $updated = 0;
        for my $t (@$all) {
            next unless ($t->{ups} // '') eq $ups;
            next unless ($t->{status} // '') eq 'pending';
            $t->{status} = 'aborted';
            $t->{result} = 'Aborted by user';
            $updated = 1;
        }
        eval { _write_all_tests($all) } if $updated;

        return undef;
    },
});

1;
