package PVE::API2::UPS::Log;

# PVE::API2::UPS::Log — event log reader/cleaner
# Log file: /var/log/pve-ups-panel/events.log
# Line format: 2026-05-27T03:14:22 ups ONBATT

use strict;
use warnings;

use PVE::RESTHandler;
use PVE::JSONSchema qw(get_standard_option);

use base qw(PVE::RESTHandler);

my $LOG_FILE = '/var/log/pve-ups-panel/events.log';

# ── GET /nodes/{node}/ups/log ──────────────────────────────────────────────
__PACKAGE__->register_method({
    name        => 'get_log',
    path        => '',
    method      => 'GET',
    description => '讀取 UPS 事件記錄。',
    protected   => 1,
    proxyto     => 'node',
    permissions => { check => ['perm', '/nodes/{node}', ['Sys.Audit']] },
    parameters  => {
        additionalProperties => 0,
        properties => {
            node  => get_standard_option('pve-node'),
            start => {
                type     => 'integer',
                minimum  => 0,
                default  => 0,
                optional => 1,
                description => '起始列偏移（從最新一筆算起）',
            },
            limit => {
                type     => 'integer',
                minimum  => 1,
                maximum  => 1000,
                default  => 200,
                optional => 1,
                description => '回傳筆數上限',
            },
        },
    },
    returns => {
        type       => 'object',
        properties => {
            total => { type => 'integer' },
            data  => {
                type  => 'array',
                items => {
                    type       => 'object',
                    properties => {
                        n     => { type => 'integer' },
                        t     => { type => 'string' },
                        ups   => { type => 'string' },
                        event => { type => 'string' },
                    },
                },
            },
        },
    },
    code => sub {
        my ($param) = @_;

        my $start = $param->{start} // 0;
        my $limit = $param->{limit} // 200;

        unless (-f $LOG_FILE) {
            return { total => 0, data => [] };
        }

        open(my $fh, '<', $LOG_FILE) or return { total => 0, data => [] };
        my @lines = <$fh>;
        close $fh;

        chomp @lines;
        my @parsed;
        my $n = scalar @lines;
        for my $i (0 .. $#lines) {
            my $line = $lines[$i];
            next unless $line =~ /\S/;
            my ($ts, $ups, $event, @rest) = split /\s+/, $line, 4;
            push @parsed, {
                n     => $n - $i,
                t     => $ts // '',
                ups   => $ups // '',
                event => $event // '',
            };
        }

        # newest first
        my @sorted = reverse @parsed;
        my $total  = scalar @sorted;
        my @page   = splice(@sorted, $start, $limit);

        return { total => $total, data => \@page };
    },
});

# ── DELETE /nodes/{node}/ups/log ───────────────────────────────────────────
__PACKAGE__->register_method({
    name        => 'clear_log',
    path        => '',
    method      => 'DELETE',
    description => '清除 UPS 事件記錄。',
    protected   => 1,
    proxyto     => 'node',
    permissions => { check => ['perm', '/nodes/{node}', ['Sys.Modify']] },
    parameters  => {
        additionalProperties => 0,
        properties => { node => get_standard_option('pve-node') },
    },
    returns => { type => 'null' },
    code => sub {
        my ($param) = @_;

        if (-f $LOG_FILE) {
            open(my $fh, '>', $LOG_FILE) or die "Cannot clear log: $!\n";
            close $fh;
        }

        return undef;
    },
});

1;
