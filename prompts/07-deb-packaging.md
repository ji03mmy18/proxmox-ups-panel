# PVE UPS Panel — deb 套件打包

## 套件基本資訊

```
Package:     pve-ups-panel
Version:     1.0.0
Architecture: all
Maintainer:  （你的名字）<email>
Depends:     pve-manager (>= 8.0), nut-client, librrds-perl
Recommends:  nut-server
Description: UPS monitoring and management panel for Proxmox VE
```

---

## 完整目錄結構

```
pve-ups-panel/
├── debian/
│   ├── control
│   ├── changelog
│   ├── compat
│   ├── rules
│   ├── postinst
│   ├── prerm
│   ├── postrm
│   └── conffiles
├── usr/
│   ├── share/
│   │   ├── pve-manager/js/
│   │   │   └── pve-ups-panel.js
│   │   └── pve-i18n/
│   │       ├── pve-ups-lang-zh_TW.js
│   │       ├── pve-ups-lang-zh_CN.js
│   │       └── pve-ups-lang-*.js
│   ├── lib/
│   │   └── pve-ups-panel/
│   │       ├── notify.pl
│   │       └── collect-rrd.pl
│   └── share/perl5/PVE/API2/UPS/
│       ├── UPS.pm
│       ├── Config.pm
│       ├── RRD.pm
│       ├── Health.pm
│       ├── Rules.pm
│       └── Scan.pm
└── etc/
    ├── pve-ups-panel/
    │   └── panel.conf
    └── systemd/system/
        ├── pve-ups-rrd.service
        └── pve-ups-rrd.timer
```

---

## debian/control

```
Source: pve-ups-panel
Section: admin
Priority: optional
Maintainer: Your Name <you@example.com>
Build-Depends: debhelper-compat (= 13)
Standards-Version: 4.6.0

Package: pve-ups-panel
Architecture: all
Depends: ${misc:Depends},
         pve-manager (>= 8.0),
         nut-client,
         librrds-perl
Recommends: nut-server
Description: UPS monitoring and management panel for Proxmox VE
 Adds a UPS tab to the Proxmox VE node view, providing real-time
 monitoring, historical data, battery health tracking, and
 automated shutdown rules via NUT (Network UPS Tools).
```

---

## debian/conffiles

```
/etc/pve-ups-panel/panel.conf
```

---

## debian/postinst

```bash
#!/bin/bash
set -e

PVE_TPL="/usr/share/pve-manager/index.html.tpl"
PVE_NODES_PM="/usr/share/perl5/PVE/API2/Nodes.pm"
SCRIPT_TAG='    <script type="text/javascript" src="/pve2/locale/pve-ups-lang-[% lang %].js"></script>'
UPS_SCRIPT_TAG='    <script type="text/javascript" src="/pve2/js/pve-ups-panel.js"></script>'

case "$1" in
    configure)
        # ── 保護並 patch Nodes.pm ────────────────────────────────────
        if ! dpkg-divert --list "$PVE_NODES_PM" | grep -q "$PVE_NODES_PM"; then
            dpkg-divert --add --rename \
                --divert "${PVE_NODES_PM}.dpkg-orig" "$PVE_NODES_PM"
            cp "${PVE_NODES_PM}.dpkg-orig" "$PVE_NODES_PM"
        fi

        if ! grep -q "PVE::API2::UPS" "$PVE_NODES_PM"; then
            /usr/lib/pve-ups-panel/patch-nodes-pm.py "$PVE_NODES_PM"
        fi

        # ── 保護並 patch index.html.tpl ─────────────────────────────
        if ! dpkg-divert --list "$PVE_TPL" | grep -q "$PVE_TPL"; then
            dpkg-divert --add --rename \
                --divert "${PVE_TPL}.dpkg-orig" "$PVE_TPL"
            cp "${PVE_TPL}.dpkg-orig" "$PVE_TPL"
        fi

        if ! grep -q "pve-ups-lang" "$PVE_TPL"; then
            /usr/lib/pve-ups-panel/patch-index-tpl.py \
                "$PVE_TPL" "$SCRIPT_TAG" "$UPS_SCRIPT_TAG"
        fi

        # ── 建立必要目錄與設定檔 ────────────────────────────────────
        mkdir -p /etc/pve-ups-panel
        mkdir -p /var/log/pve-ups-panel
        mkdir -p /var/lib/rrdcached/db/pve2-ups

        if [ ! -f /etc/pve-ups-panel/panel.conf ]; then
            cp /usr/share/pve-ups-panel/panel.conf.default \
               /etc/pve-ups-panel/panel.conf
        fi

        # ── 啟動 RRD 收集 timer ──────────────────────────────────────
        systemctl daemon-reload
        systemctl enable --now pve-ups-rrd.timer

        # ── 重啟 pveproxy ────────────────────────────────────────────
        systemctl restart pveproxy
        ;;
esac

#DEBHELPER#
exit 0
```

---

## debian/prerm

```bash
#!/bin/bash
set -e

case "$1" in
    remove|purge)
        # 停止 RRD 收集服務
        systemctl stop pve-ups-rrd.timer pve-ups-rrd.service 2>/dev/null || true
        systemctl disable pve-ups-rrd.timer 2>/dev/null || true
        ;;
esac

#DEBHELPER#
exit 0
```

---

## debian/postrm

```bash
#!/bin/bash
set -e

PVE_TPL="/usr/share/pve-manager/index.html.tpl"
PVE_NODES_PM="/usr/share/perl5/PVE/API2/Nodes.pm"

case "$1" in
    remove|purge)
        # ── 還原 Nodes.pm ────────────────────────────────────────────
        if dpkg-divert --list "$PVE_NODES_PM" | grep -q "$PVE_NODES_PM"; then
            dpkg-divert --remove --rename "$PVE_NODES_PM"
        fi

        # ── 還原 index.html.tpl ──────────────────────────────────────
        if dpkg-divert --list "$PVE_TPL" | grep -q "$PVE_TPL"; then
            dpkg-divert --remove --rename "$PVE_TPL"
        fi

        systemctl daemon-reload
        systemctl restart pveproxy 2>/dev/null || true
        ;;

    purge)
        # purge 時才刪除資料
        rm -rf /var/log/pve-ups-panel
        rm -rf /var/lib/rrdcached/db/pve2-ups
        # 注意：/etc/pve-ups-panel/ 由 dpkg 的 conffiles 機制處理
        ;;
esac

#DEBHELPER#
exit 0
```

---

## debian/rules

```makefile
#!/usr/bin/make -f
%:
	dh $@

override_dh_auto_build:
	# 無需編譯，純 Perl + JS

override_dh_auto_test:
	# 執行基本語法檢查
	perl -c usr/share/perl5/PVE/API2/UPS/UPS.pm
	node --check usr/share/pve-manager/js/pve-ups-panel.js
```

---

## 建置指令

```bash
# 在套件根目錄執行
dpkg-buildpackage -us -uc -b

# 產出 .deb 在上層目錄
ls ../pve-ups-panel_*.deb

# 安裝
dpkg -i ../pve-ups-panel_1.0.0_all.deb

# 驗證安裝
pvesh get /nodes/$(hostname)/ups
```

---

## 版本升級注意事項

升級時 `postinst` 需要處理已存在 divert 的情況：
- `dpkg-divert --list` 有結果時，不重複 divert
- patch 前先檢查是否已套用（`grep -q` 判斷），避免重複 patch
- conffile 衝突由 dpkg 自動處理，不需要額外邏輯
