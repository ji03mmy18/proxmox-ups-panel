# proxmox-ups-panel

![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)
![Proxmox VE](https://img.shields.io/badge/Proxmox%20VE-7.0%2B-orange.svg)
![NUT](https://img.shields.io/badge/NUT-Network%20UPS%20Tools-green.svg)

UPS management panel for Proxmox VE — integrates NUT monitoring, RRD history, battery health, shutdown rules and notifications directly into the node interface.

## Features

Seven built-in tabs added to the Proxmox VE node page:

| Tab | Description |
|-----|-------------|
| **Overview** | Live dashboard with battery charge, load and runtime gauges; full device detail cards; NUT setup wizard for first-time configuration |
| **Device Management** | Add, edit and delete NUT device entries; start, stop and restart NUT services |
| **History** | RRD trend charts for battery charge, load percentage, input/output voltage and estimated runtime |
| **Battery Health** | Health assessment with replacement estimate; quick and full battery test with real-time status polling |
| **Shutdown Rules** | Ordered VM and CT shutdown on UPS events via `qm`/`pct` integration; configurable recovery strategy |
| **Notifications** | Route UPS events to PVE notification targets; per-event rules with Handlebars email templates |
| **Logs** | UPS event log viewer with timestamp, device name and event type; clear log function |

Additional capabilities:

- **i18n** — 212 strings translated into 31 languages (zh\_TW, zh\_CN, de, fr, es, it, ja, ko, ru, pt\_BR and more)
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
├── pve-ups-panel.js        # Frontend — ExtJS UI (3200+ lines)
├── UPS.pm                  # Backend — API root module
├── UPS/                    # Backend — sub-modules
│   ├── Config.pm           #   NUT ups.conf CRUD
│   ├── Scan.pm             #   USB device detection
│   ├── RRD.pm              #   RRD read/write
│   ├── Battery.pm          #   Battery health and tests
│   ├── Shutdown.pm         #   VM/CT shutdown rules
│   ├── Notify.pm           #   Notification routing
│   └── Log.pm              #   Event log
├── pve-ups-rrd-collect     # RRD collector daemon
├── pve-ups-notify          # NUT callout hook
├── templates/              # Handlebars email templates
└── locale/                 # i18n files (31 languages) + generator

debian/
├── control                 # Package metadata and dependencies
├── changelog               # Version history
├── postinst                # Post-install: patch, udev reload, pveproxy restart
├── prerm                   # Pre-remove: restore originals, stop service
├── pve-ups-panel.install   # File installation map
├── pve-ups-panel-rrdcollect.service  # Persistent RRD collector service
└── 69-pve-ups-panel.rules  # USB UPS udev rules
```

## License

[GNU Affero General Public License v3.0](LICENSE)

This project is a derivative work of Proxmox VE, which is licensed under AGPL-3.0.
