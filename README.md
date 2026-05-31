# proxmox-ups-panel

![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)
![Proxmox VE](https://img.shields.io/badge/Proxmox%20VE-7.0%2B-orange.svg)
![NUT](https://img.shields.io/badge/NUT-2.7%2B-green.svg)

**Languages:** English | [繁體中文](docs/README.zh-TW.md)

UPS management panel for Proxmox VE — integrates NUT monitoring, RRD history, battery health, automated VM/CT shutdown, and notifications directly into the node interface.

## Features

Seven built-in tabs added to the Proxmox VE node page:

| Tab | Description |
|-----|-------------|
| **Overview** | Live dashboard with battery charge, load and runtime gauges; full device detail cards; NUT setup wizard for first-time configuration |
| **Device Management** | Add, edit and delete NUT device entries; start, stop and restart NUT services; displays installed package version |
| **History** | RRD trend charts for battery charge, load percentage, input/output voltage and estimated runtime |
| **Battery Health** | Health assessment with replacement estimate; quick and full battery test with real-time status polling |
| **Shutdown Rules** | Priority-ordered VM/CT shutdown on UPS events; per-guest charge and runtime thresholds; configurable recovery strategy with automatic guest restart after power returns |
| **Notifications** | Route UPS events to PVE notification targets; per-event rules with Handlebars email templates |
| **Logs** | UPS event log viewer with timestamp, device name and event type; clear log function |

Additional capabilities:

- **Automated shutdown executor** — `pve-ups-shutdown` daemon polls UPS status every 30 seconds; shuts down VMs/CTs in configurable priority order as per-guest thresholds are crossed; shuts down the node when global thresholds are reached
- **Automated recovery** — after power returns, waits for battery to reach a configurable charge level then restarts guests in reverse priority order
- **Remote UPS support** — UI uses plain device names throughout; backend resolves each name to its upsc target (`name@host[:port]`) internally
- **NUT 2.8+ compatibility** — NOTIFYCMD uses a single-path wrapper (`pve-ups-notifycmd`) compatible with NUT 2.8's `execvp()` invocation model
- **i18n** — strings translated into 31 languages (zh\_TW, zh\_CN, de, fr, es, it, ja, ko, ru, pt\_BR and more)
- **USB UPS udev rules** — vendor catch-all permissions for CyberPower, APC, Eaton, Tripp Lite, Powercom, Belkin and Phoenixtec
- **Persistent RRD collector** — epoch-aligned sampling daemon (no timer noise in journal)
- **Clean packaging** — single `.deb` with `dpkg-divert` lifecycle management; no manual file editing required

## Requirements

- Proxmox VE 7.0 or later
- `nut-client` (required — provides `upsc`)
- `nut-server` (recommended — for local USB UPS connections)
- `python3`, `libjson-perl`, `librrds-perl` (installed automatically as dependencies)

## Installation

### From GitHub Releases

Download the latest `.deb` from the [Releases](../../releases) page and install:

```bash
apt install ./pve-ups-panel_<version>_all.deb
```

### Build from Source

```bash
# Install build dependencies
apt install dpkg-dev fakeroot debhelper

# Clone and build
git clone https://github.com/ji03mmy18/proxmox-ups-panel.git
cd proxmox-ups-panel
make deb

# Install
apt install ./pve-ups-panel_<version>_all.deb
```

After installation, refresh the Proxmox VE web UI. The **UPS** tab will appear in the node page.

## First-time Setup

1. Open the Proxmox VE web UI and navigate to a node
2. Click the **UPS** tab
3. Follow the setup wizard to configure your NUT connection (standalone, netclient or netserver mode)
4. The Overview dashboard will load automatically once a device is configured

## Shutdown Rules

The Shutdown Rules tab lets you define:

- **Per-guest rules** — VMID, priority (execution order), individual charge/runtime thresholds, graceful shutdown timeout, and action (`shutdown` or `stop`)
- **Global thresholds** — fallback charge % and runtime (seconds) for node-level shutdown
- **Recovery strategy** — minimum battery charge required before restarting guests; interval between guest starts; enable/disable auto-restart

When a power outage is detected:

1. `pve-ups-notify` starts `pve-ups-shutdown monitor` in the background
2. The monitor daemon polls `upsc` every 30 seconds
3. Guests whose thresholds are already exceeded on the first poll are shut down immediately, in priority order (sequential — order is preserved)
4. The node shuts down when global thresholds are reached
5. On power return, `pve-ups-shutdown recover` waits for sufficient charge then restarts guests in reverse priority order

> **Tip:** Ensure the sum of all guest shutdown timeouts fits within the time the battery takes to drop from your lowest per-guest threshold to the global node-shutdown threshold.

## Uninstallation

```bash
dpkg -r pve-ups-panel
```

This restores the original `Nodes.pm` and `index.html.tpl` via `dpkg-divert` and removes all installed files.

## Building from Source

```bash
make deb      # build .deb package
make install  # build and install immediately
make clean    # remove build artifacts
```

The version is read automatically from `debian/changelog`.

## Project Structure

```
src/
├── pve-ups-panel.js        # Frontend — ExtJS UI
├── UPS.pm                  # Backend — API root module
├── UPS/                    # Backend — sub-modules
│   ├── Config.pm           #   NUT ups.conf / upsmon.conf CRUD + version endpoint
│   ├── Scan.pm             #   USB device detection
│   ├── RRD.pm              #   RRD read/write
│   ├── Battery.pm          #   Battery health and tests
│   ├── Shutdown.pm         #   VM/CT shutdown rules storage
│   ├── Notify.pm           #   Notification routing
│   └── Log.pm              #   Event log
├── pve-ups-rrd-collect     # RRD collector daemon (systemd service)
├── pve-ups-notify          # NUT NOTIFYCMD hook — logs events, sends PVE notifications,
│                           #   triggers pve-ups-shutdown on ONBATT/ONLINE
├── pve-ups-notifycmd       # Single-path NOTIFYCMD wrapper (NUT 2.8+ execvp compatibility)
├── pve-ups-shutdown        # Shutdown/recovery executor daemon
│                           #   monitor: polls upsc, shuts down guests and node on threshold
│                           #   recover: waits for charge, restarts guests in reverse order
│                           #   cancel:  stops monitor, clears state
├── templates/              # Handlebars email templates
└── locale/                 # i18n files (31 languages) + generator

debian/
├── control                 # Package metadata and dependencies
├── changelog               # Version history
├── postinst                # Post-install: patch Nodes.pm, udev reload, pveproxy restart
├── prerm                   # Pre-remove: restore originals, stop service
├── pve-ups-panel.install   # File installation map
├── pve-ups-panel-rrdcollect.service  # Persistent RRD collector service
└── 69-pve-ups-panel.rules  # USB UPS udev rules
```

## Runtime State Files

`pve-ups-shutdown` uses the following files under `/var/run/pve-ups-panel/`:

| File | Purpose |
|------|---------|
| `shutdown-monitor.pid` | PID of the running monitor daemon |
| `shutdown-done` | Sentinel — node shutdown has been initiated |
| `guests-shut` | `vmid:type` pairs of guests shut down in this event |

All state files are cleared automatically on recovery.

## License

[GNU Affero General Public License v3.0](LICENSE)

This project is a derivative work of Proxmox VE, which is licensed under AGPL-3.0.
