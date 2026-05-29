package PVE::API2::UPS::Scan;

# PVE::API2::UPS::Scan
# 掛載於 /nodes/{node}/ups/scan
# 提供 USB 掃描與遠端連線測試端點。

use strict;
use warnings;

use PVE::RESTHandler;
use PVE::JSONSchema qw(get_standard_option);

use base qw(PVE::RESTHandler);

# 讀取 sysfs 單一文字檔，去除尾端空白，檔案不存在回傳 ''
sub _read_sysfs {
    my ($path) = @_;
    open(my $fh, '<', $path) or return '';
    local $/;
    my $val = <$fh> // '';
    close $fh;
    $val =~ s/\s+\z//;
    return $val;
}

# 已知 UPS 廠商 VID → driver 對應表
my %KNOWN_VID = (
    '0764' => { vendor => 'CyberPower Systems',                  driver => 'usbhid-ups'      },
    '051d' => { vendor => 'American Power Conversion (APC)',     driver => 'usbhid-ups'      },
    '03f0' => { vendor => 'Hewlett-Packard (UPS)',               driver => 'usbhid-ups'      },
    '06da' => { vendor => 'Phoenixtec / Powercom',              driver => 'usbhid-ups'      },
    '04b4' => { vendor => 'Cypress (Tripp Lite)',               driver => 'tripplite_usb'   },
    '09ae' => { vendor => 'Tripp Lite',                          driver => 'tripplite_usb'   },
    '050d' => { vendor => 'Belkin',                              driver => 'belkin_usb'      },
    '0665' => { vendor => 'Powercom',                            driver => 'powercom'        },
    '0f03' => { vendor => 'Powercom / KIN series',              driver => 'powercom'        },
    '1cb0' => { vendor => 'Dynamix / PowerWalker',              driver => 'usbhid-ups'      },
    '0592' => { vendor => 'Mustek / PowerMust',                 driver => 'blazer_usb'      },
    '06c4' => { vendor => 'Liebert / Eaton',                    driver => 'usbhid-ups'      },
    '0d9f' => { vendor => 'Powercom (alternate VID)',           driver => 'usbhid-ups'      },
);

# ── GET /ups/scan/usb ──────────────────────────────────────────────────────
__PACKAGE__->register_method({
    name        => 'scan_usb',
    path        => 'usb',
    method      => 'GET',
    description => '掃描 sysfs 尋找已知 UPS 裝置，回傳 Product 字串與 SerialNumber。',
    protected   => 1,
    proxyto     => 'node',
    permissions => { check => ['perm', '/nodes/{node}', ['Sys.Audit']] },
    parameters  => {
        additionalProperties => 0,
        properties => { node => get_standard_option('pve-node') },
    },
    returns => {
        type  => 'array',
        items => {
            type => 'object',
            properties => {
                vid     => { type => 'string', description => 'USB Vendor ID'              },
                pid     => { type => 'string', description => 'USB Product ID'             },
                vendor  => { type => 'string', description => '廠商名稱（內建對應表）'     },
                driver  => { type => 'string', description => '建議 NUT driver'            },
                product => { type => 'string', description => 'USB Product 字串描述符'     },
                serial  => { type => 'string', description => 'USB SerialNumber 字串描述符'},
                desc    => { type => 'string', description => '顯示用名稱'                 },
            },
            additionalProperties => 0,
        },
    },
    code => sub {
        my @devices;
        for my $dev_path (sort glob '/sys/bus/usb/devices/*') {
            next unless -f "$dev_path/idVendor";
            my $vid = lc _read_sysfs("$dev_path/idVendor");
            my $pid = lc _read_sysfs("$dev_path/idProduct");
            my $info = $KNOWN_VID{$vid} or next;

            my $product = _read_sysfs("$dev_path/product");
            my $serial  = _read_sysfs("$dev_path/serial");
            my $desc    = $product || $info->{vendor};

            push @devices, {
                vid     => $vid,
                pid     => $pid,
                vendor  => $info->{vendor},
                driver  => $info->{driver},
                product => $product,
                serial  => $serial,
                desc    => $desc,
            };
        }
        return \@devices;
    },
});

# ── POST /ups/scan/test-connection ─────────────────────────────────────────
__PACKAGE__->register_method({
    name        => 'test_connection',
    path        => 'test-connection',
    method      => 'POST',
    description => '測試與遠端 NUT Server 的連線（不寫入任何設定）。',
    protected   => 1,
    proxyto     => 'node',
    permissions => { check => ['perm', '/nodes/{node}', ['Sys.Audit']] },
    parameters  => {
        additionalProperties => 0,
        properties => {
            node     => get_standard_option('pve-node'),
            host     => { type => 'string',  description => 'NUT Server 主機名稱或 IP'  },
            port     => { type => 'integer', optional => 1, default => 3493,
                          minimum => 1, maximum => 65535 },
            ups      => { type => 'string',  optional => 1, default => 'ups',
                          pattern => '[a-zA-Z0-9_@.-]+' },
            username => { type => 'string',  optional => 1 },
            password => { type => 'string',  optional => 1 },
        },
    },
    returns => {
        type => 'object',
        properties => {
            success => { type => 'integer', description => '1 = 成功，0 = 失敗' },
            message => { type => 'string',  description => '結果訊息' },
        },
        additionalProperties => 0,
    },
    code => sub {
        my ($param) = @_;

        my $host = $param->{host};
        my $port = $param->{port} // 3493;
        my $ups  = $param->{ups}  // 'ups';

        # 清理輸入（防止 shell injection）
        $host =~ s/[^a-zA-Z0-9._:-]//g;
        $ups  =~ s/[^a-zA-Z0-9_@.-]//g;

        die "Invalid host\n" unless $host;

        my $target  = "$ups\@$host:$port";
        my $success = 0;
        my $message = '';

        eval {
            my @lines;
            open(my $fh, '-|', '/bin/upsc', $target)
                or die "Cannot run upsc: $!\n";
            @lines = <$fh>;
            close $fh;

            if ($? == 0 && @lines) {
                $success = 1;
                $message = "Connected to $target — " . scalar(@lines) . " variable(s) returned.";
            } else {
                $message = "No data from $target (exit " . ($? >> 8) . ").";
            }
        };
        if ($@) {
            $message = $@;
            chomp $message;
        }

        return { success => $success, message => $message };
    },
});

1;
