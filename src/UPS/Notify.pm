package PVE::API2::UPS::Notify;

# PVE::API2::UPS::Notify
# 掛載於 /nodes/{node}/ups/notify
# 讀寫通知規則，並同步更新 upsmon.conf NOTIFYFLAG。

use strict;
use warnings;

use PVE::RESTHandler;
use PVE::JSONSchema qw(get_standard_option);
use JSON;

use base qw(PVE::RESTHandler);

my $CONFIG_FILE = '/etc/pve-ups-panel/notify-rules.json';
my $CONFIG_DIR  = '/etc/pve-ups-panel';
my $UPSMON_CONF = '/etc/nut/upsmon.conf';
my $NOTIFY_CMD  = '/usr/lib/pve-ups-panel/pve-ups-notifycmd';

# NUT 支援 NOTIFYFLAG 的標準事件（OVERLOAD 是驅動層概念，upsmon 不接受）
my %NUT_EVENTS = map { $_ => 1 } qw(
    ONLINE ONBATT LOWBATT FSD COMMOK COMMBAD
    SHUTDOWN REPLBATT NOCOMM NOPARENT
);

my $DEFAULT_RULES = [
    { event => 'ONBATT',    severity => 'warning', enabled => 1, targets => [], hasThreshold => 0, threshold => undef },
    { event => 'ONLINE',    severity => 'info',    enabled => 1, targets => [], hasThreshold => 0, threshold => undef },
    { event => 'LOWBATT',   severity => 'error',   enabled => 1, targets => [], hasThreshold => 0, threshold => undef },
    { event => 'FSD',       severity => 'error',   enabled => 1, targets => [], hasThreshold => 0, threshold => undef },
    { event => 'COMMBAD',   severity => 'warning', enabled => 1, targets => [], hasThreshold => 0, threshold => undef },
    { event => 'COMMOK',    severity => 'info',    enabled => 1, targets => [], hasThreshold => 0, threshold => undef },
    { event => 'REPLBATT',  severity => 'warning', enabled => 1, targets => [], hasThreshold => 0, threshold => undef },
    { event => 'OVERLOAD',  severity => 'warning', enabled => 0, targets => [], hasThreshold => 1, threshold => 80    },
    { event => 'VOLT_ANOM', severity => 'warning', enabled => 0, targets => [], hasThreshold => 1, threshold => 10    },
];

# ── 輔助函式 ────────────────────────────────────────────────────────────────

sub _read_config {
    return $DEFAULT_RULES unless -f $CONFIG_FILE;
    open(my $fh, '<', $CONFIG_FILE) or return $DEFAULT_RULES;
    my $content;
    { local $/; $content = <$fh>; }
    close $fh;
    return eval { decode_json($content) } // $DEFAULT_RULES;
}

sub _write_config {
    my ($rules) = @_;
    mkdir $CONFIG_DIR, 0750 unless -d $CONFIG_DIR;
    open(my $fh, '>', $CONFIG_FILE) or die "Cannot write $CONFIG_FILE: $!\n";
    print $fh encode_json($rules);
    close $fh;
}

# 更新 upsmon.conf 中的 NOTIFYCMD 與 NOTIFYFLAG 行
sub _update_upsmon_conf {
    my ($rules) = @_;
    return unless -f $UPSMON_CONF;

    open(my $fh, '<', $UPSMON_CONF) or return;
    my @lines = <$fh>;
    close $fh;

    # 建立事件 → flag 對應表
    my %flags;
    for my $r (@$rules) {
        my $event = $r->{event} // '';
        next unless $NUT_EVENTS{$event};
        $flags{$event} = $r->{enabled} ? 'SYSLOG+EXEC' : 'SYSLOG';
    }

    my %seen;
    my $has_notifycmd = 0;
    my @new_lines;

    for my $line (@lines) {
        if ($line =~ /^NOTIFYCMD\s/) {
            push @new_lines, "NOTIFYCMD $NOTIFY_CMD\n";
            $has_notifycmd = 1;
        } elsif ($line =~ /^NOTIFYFLAG\s+(\S+)/) {
            my $event = $1;
            if (exists $flags{$event}) {
                push @new_lines, "NOTIFYFLAG $event $flags{$event}\n";
                $seen{$event} = 1;
            } else {
                push @new_lines, $line;
            }
        } else {
            push @new_lines, $line;
        }
    }

    push @new_lines, "\nNOTIFYCMD $NOTIFY_CMD\n" unless $has_notifycmd;

    for my $event (sort keys %flags) {
        next if $seen{$event};
        push @new_lines, "NOTIFYFLAG $event $flags{$event}\n";
    }

    open(my $wfh, '>', $UPSMON_CONF) or die "Cannot write $UPSMON_CONF: $!\n";
    print $wfh @new_lines;
    close $wfh;
}

# ── GET /nodes/{node}/ups/notify ───────────────────────────────────────────
__PACKAGE__->register_method({
    name        => 'get_config',
    path        => '',
    method      => 'GET',
    description => '取得 UPS 通知規則設定。',
    protected   => 1,
    proxyto     => 'node',
    permissions => { check => ['perm', '/nodes/{node}', ['Sys.Audit']] },
    parameters  => {
        additionalProperties => 0,
        properties => { node => get_standard_option('pve-node') },
    },
    returns => {
        type                 => 'object',
        properties           => {},
        additionalProperties => 1,
    },
    code => sub { return { rules => _read_config() }; },
});

# ── PUT /nodes/{node}/ups/notify ───────────────────────────────────────────
__PACKAGE__->register_method({
    name        => 'set_config',
    path        => '',
    method      => 'PUT',
    description => '儲存 UPS 通知規則，並同步更新 upsmon.conf。',
    protected   => 1,
    proxyto     => 'node',
    permissions => { check => ['perm', '/nodes/{node}', ['Sys.Modify']] },
    parameters  => {
        additionalProperties => 0,
        properties => {
            node  => get_standard_option('pve-node'),
            rules => {
                type        => 'string',
                description => '通知規則 JSON 陣列',
            },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $rules = eval { decode_json($param->{rules}) };
        die "Invalid rules JSON: $@\n" if $@;
        die "Rules must be an array\n" unless ref($rules) eq 'ARRAY';

        for my $r (@$rules) {
            die "Rule missing event\n" unless defined $r->{event};
            $r->{enabled}      = $r->{enabled}      ? 1 : 0;
            $r->{hasThreshold} = $r->{hasThreshold}  ? 1 : 0;
            $r->{targets}      = ref($r->{targets}) eq 'ARRAY' ? $r->{targets} : [];
            $r->{threshold}    = defined $r->{threshold} ? int($r->{threshold}) : undef;
        }

        _write_config($rules);

        eval { _update_upsmon_conf($rules) };
        warn "Failed to update upsmon.conf: $@\n" if $@;

        # 若 nut-monitor 正在執行，重啟以套用新的 NOTIFYFLAG
        system('systemctl', 'is-active', '--quiet', 'nut-monitor') == 0
            and system('systemctl', 'restart', 'nut-monitor');

        return undef;
    },
});

1;
