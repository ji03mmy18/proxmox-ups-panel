package PVE::API2::UPS::Shutdown;

# PVE::API2::UPS::Shutdown
# 掛載於 /nodes/{node}/ups/shutdown
# 提供 VM/CT 關機規則與市電恢復策略的讀寫端點。

use strict;
use warnings;

use PVE::RESTHandler;
use PVE::JSONSchema qw(get_standard_option);
use JSON;

use base qw(PVE::RESTHandler);

my $CONFIG_FILE = '/etc/pve-ups-panel/shutdown-rules.json';
my $CONFIG_DIR  = '/etc/pve-ups-panel';

my $DEFAULT = {
    global => {
        charge_threshold  => 15,
        runtime_threshold => 180,
    },
    rules    => [],
    recovery => {
        charge_before_start => 50,
        interval_seconds    => 30,
        auto_start          => 1,
    },
};

# ── 輔助函式 ────────────────────────────────────────────────────────────────

sub _read_config {
    return $DEFAULT unless -f $CONFIG_FILE;
    open(my $fh, '<', $CONFIG_FILE) or return $DEFAULT;
    my $content;
    { local $/; $content = <$fh>; }
    close $fh;
    return eval { decode_json($content) } // $DEFAULT;
}

sub _write_config {
    my ($cfg) = @_;
    mkdir $CONFIG_DIR, 0750 unless -d $CONFIG_DIR;
    open(my $fh, '>', $CONFIG_FILE) or die "Cannot write $CONFIG_FILE: $!\n";
    print $fh encode_json($cfg);
    close $fh;
}

# ── GET /nodes/{node}/ups/shutdown ─────────────────────────────────────────
__PACKAGE__->register_method({
    name        => 'get_config',
    path        => '',
    method      => 'GET',
    description => '取得 VM/CT 關機規則與市電恢復設定。',
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
    code => sub { return _read_config(); },
});

# ── PUT /nodes/{node}/ups/shutdown ─────────────────────────────────────────
__PACKAGE__->register_method({
    name        => 'set_config',
    path        => '',
    method      => 'PUT',
    description => '儲存 VM/CT 關機規則與市電恢復設定。',
    protected   => 1,
    proxyto     => 'node',
    permissions => { check => ['perm', '/nodes/{node}', ['Sys.Modify']] },
    parameters  => {
        additionalProperties => 0,
        properties => {
            node => get_standard_option('pve-node'),
            charge_threshold => {
                type     => 'integer',
                minimum  => 1,
                maximum  => 99,
                optional => 1,
                description => '節點關機電量門檻（%）',
            },
            runtime_threshold => {
                type     => 'integer',
                minimum  => 60,
                maximum  => 86400,
                optional => 1,
                description => '節點關機剩餘時間門檻（秒）',
            },
            rules => {
                type     => 'string',
                optional => 1,
                description => 'VM/CT 關機規則 JSON 陣列',
            },
            charge_before_start => {
                type     => 'integer',
                minimum  => 0,
                maximum  => 100,
                optional => 1,
                description => '恢復啟動前最低充電量（%）',
            },
            interval_seconds => {
                type     => 'integer',
                minimum  => 0,
                maximum  => 3600,
                optional => 1,
                description => '恢復啟動間隔（秒）',
            },
            auto_start => {
                type     => 'boolean',
                optional => 1,
                description => '市電恢復後自動啟動 VM/CT',
            },
        },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        my $cfg = _read_config();

        if (defined $param->{charge_threshold}) {
            $cfg->{global}{charge_threshold} = int($param->{charge_threshold});
        }
        if (defined $param->{runtime_threshold}) {
            $cfg->{global}{runtime_threshold} = int($param->{runtime_threshold});
        }

        if (defined $param->{rules}) {
            my $rules = eval { decode_json($param->{rules}) };
            die "Invalid rules JSON: $@\n" if $@;
            die "Rules must be an array\n" unless ref($rules) eq 'ARRAY';

            for my $r (@$rules) {
                die "Rule missing vmid\n"     unless defined $r->{vmid};
                die "Rule missing priority\n" unless defined $r->{priority};
                $r->{vmid}     = int($r->{vmid});
                $r->{priority} = int($r->{priority});
                $r->{charge}   = int($r->{charge}  // 20);
                $r->{runtime}  = int($r->{runtime} // 300);
                $r->{timeout}  = int($r->{timeout} // 60);
                $r->{trigger}  //= 'any';
                $r->{action}   //= 'shutdown';
            }
            $cfg->{rules} = [sort { $a->{priority} <=> $b->{priority} } @$rules];
        }

        if (defined $param->{charge_before_start}) {
            $cfg->{recovery}{charge_before_start} = int($param->{charge_before_start});
        }
        if (defined $param->{interval_seconds}) {
            $cfg->{recovery}{interval_seconds} = int($param->{interval_seconds});
        }
        if (defined $param->{auto_start}) {
            $cfg->{recovery}{auto_start} = $param->{auto_start} ? 1 : 0;
        }

        _write_config($cfg);
        return undef;
    },
});

1;
