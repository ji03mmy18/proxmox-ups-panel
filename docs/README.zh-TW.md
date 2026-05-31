# proxmox-ups-panel

![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)
![Proxmox VE](https://img.shields.io/badge/Proxmox%20VE-7.0%2B-orange.svg)
![NUT](https://img.shields.io/badge/NUT-2.7%2B-green.svg)

Proxmox VE 的 UPS 管理面板 — 將 NUT 監控、RRD 歷史記錄、電池健康度、自動 VM/CT 關機與通知功能直接整合至節點介面。

## 功能概覽

在 Proxmox VE 節點頁面新增七個內建分頁：

| 分頁 | 說明 |
|------|------|
| **Overview（概覽）** | 即時儀表板，顯示電池電量、負載與剩餘時間量表；完整裝置資訊卡；首次設定 NUT 連線的安裝精靈 |
| **Device Management（裝置管理）** | 新增、編輯、刪除 NUT 裝置設定；啟動、停止、重啟 NUT 服務；顯示目前已安裝的套件版本 |
| **History（歷史記錄）** | RRD 趨勢圖，涵蓋電池電量、負載百分比、輸入/輸出電壓與預估剩餘時間 |
| **Battery Health（電池健康）** | 健康度評估與更換預測；支援快速測試與完整測試，並即時輪詢測試狀態 |
| **Shutdown Rules（開關機規則）** | 依優先順序自動關閉 VM/CT；每台設備可設定個別的電量與剩餘時間門檻；市電恢復後自動重啟策略 |
| **Notifications（通知）** | 將 UPS 事件路由至 PVE 通知目標；按事件設定規則；支援 Handlebars 電子郵件範本 |
| **Logs（日誌）** | UPS 事件日誌檢視器，顯示時間戳記、裝置名稱與事件類型；支援清除日誌 |

其他功能：

- **自動關機執行器** — `pve-ups-shutdown` 每 30 秒 poll 一次 UPS 狀態；在各設備門檻達到時依優先順序依序關閉 VM/CT；觸達全域門檻時關閉節點
- **自動恢復策略** — 市電恢復後等待電池充電至設定門檻，再依反向優先順序重新啟動 VM/CT
- **遠端 UPS 支援** — 介面全程使用純裝置名稱；後端自動將名稱解析為對應的 upsc 目標（`name@host[:port]`）
- **相容 NUT 2.8+** — NOTIFYCMD 採用單一路徑的 wrapper 腳本（`pve-ups-notifycmd`），相容 NUT 2.8 改用 `execvp()` 的呼叫方式
- **多語言（i18n）** — 支援 31 種語言（zh\_TW、zh\_CN、de、fr、es、it、ja、ko、ru、pt\_BR 等）
- **USB UPS udev 規則** — 涵蓋 CyberPower、APC、Eaton、Tripp Lite、Powercom、Belkin、Phoenixtec 的廠商規則
- **持續運行的 RRD 收集器** — epoch 對齊的採樣 daemon（不產生 journal 計時器雜訊）
- **乾淨的套件管理** — 單一 `.deb` 搭配 `dpkg-divert` 生命週期管理，安裝與移除均不需手動編輯設定檔

## 系統需求

- Proxmox VE 7.0 或更新版本
- `nut-client`（必要 — 提供 `upsc`）
- `nut-server`（建議安裝 — 用於本機 USB UPS 連線）
- `python3`、`libjson-perl`、`librrds-perl`（安裝時自動作為相依套件安裝）

## 安裝方式

### 從 GitHub Releases 安裝

從 [Releases](../../releases) 頁面下載最新的 `.deb` 後執行：

```bash
apt install ./pve-ups-panel_<版本>_all.deb
```

### 從原始碼建置

```bash
# 安裝建置相依套件
apt install dpkg-dev fakeroot debhelper

# 複製並建置
git clone https://github.com/ji03mmy18/proxmox-ups-panel.git
cd proxmox-ups-panel
make deb

# 安裝
apt install ./pve-ups-panel_<版本>_all.deb
```

安裝完成後重新整理 Proxmox VE 網頁介面，節點頁面即會出現 **UPS** 分頁。

## 初次設定

1. 開啟 Proxmox VE 網頁介面，進入節點頁面
2. 點選 **UPS** 分頁
3. 依照安裝精靈設定 NUT 連線方式（standalone、netclient 或 netserver）
4. 裝置設定完成後，Overview 儀表板將自動載入

## 開關機規則

在 Shutdown Rules 分頁可設定：

- **每台設備規則** — VMID、優先度（執行順序）、個別電量/剩餘時間門檻、優雅關機逾時時間、動作類型（`shutdown` 優雅關機 或 `stop` 強制停止）
- **全域門檻** — 節點關機的電量百分比與剩餘時間（秒）備用門檻
- **恢復策略** — 重啟 VM/CT 前所需的最低電池電量；每台啟動間隔時間；是否啟用自動重啟

停電事件的執行流程：

1. `pve-ups-notify` 在背景啟動 `pve-ups-shutdown monitor`
2. Monitor daemon 每 30 秒 poll 一次 `upsc`
3. 第一輪 poll 時已超過門檻的 VM/CT 立即依優先順序依序關機（循序執行，確保順序正確）
4. 觸達全域門檻時關閉節點
5. 市電恢復後，`pve-ups-shutdown recover` 等待電量達到設定門檻，再依反向優先順序重啟 VM/CT

> **建議：** 所有設備關機逾時時間的總和，應小於電量從最低設備門檻降至全域節點關機門檻所需的時間，以確保關機序列能在節點斷電前完整跑完。

## 移除

```bash
dpkg -r pve-ups-panel
```

此指令會透過 `dpkg-divert` 還原原始的 `Nodes.pm` 與 `index.html.tpl`，並移除所有已安裝的檔案。

## 從原始碼建置

```bash
make deb      # 建置 .deb 套件
make install  # 建置並立即安裝
make clean    # 清除建置產物
```

版本號自動從 `debian/changelog` 讀取。

## 專案結構

```
src/
├── pve-ups-panel.js        # 前端 — ExtJS UI
├── UPS.pm                  # 後端 — API 根模組
├── UPS/                    # 後端 — 子模組
│   ├── Config.pm           #   NUT ups.conf / upsmon.conf CRUD + 版本端點
│   ├── Scan.pm             #   USB 裝置偵測
│   ├── RRD.pm              #   RRD 讀寫
│   ├── Battery.pm          #   電池健康度與測試
│   ├── Shutdown.pm         #   VM/CT 開關機規則儲存
│   ├── Notify.pm           #   通知路由
│   └── Log.pm              #   事件日誌
├── pve-ups-rrd-collect     # RRD 收集器 daemon（systemd 服務）
├── pve-ups-notify          # NUT NOTIFYCMD hook — 記錄事件、發送 PVE 通知、
│                           #   於 ONBATT/ONLINE 時觸發 pve-ups-shutdown
├── pve-ups-notifycmd       # 單一路徑 NOTIFYCMD wrapper（相容 NUT 2.8+ execvp）
├── pve-ups-shutdown        # 關機/恢復執行器 daemon
│                           #   monitor：poll upsc，依門檻關閉 VM/CT 與節點
│                           #   recover：等待電量，依反向順序重啟 VM/CT
│                           #   cancel：停止 monitor，清除狀態檔
├── templates/              # Handlebars 電子郵件範本
└── locale/                 # 多語言檔案（31 種語言）+ 產生器

debian/
├── control                 # 套件元資料與相依性
├── changelog               # 版本歷史
├── postinst                # 安裝後：修補 Nodes.pm、重新載入 udev、重啟 pveproxy
├── prerm                   # 移除前：還原原始檔案、停止服務
├── pve-ups-panel.install   # 檔案安裝對應表
├── pve-ups-panel-rrdcollect.service  # 持續運行的 RRD 收集器服務
└── 69-pve-ups-panel.rules  # USB UPS udev 規則
```

## 執行期狀態檔

`pve-ups-shutdown` 在 `/var/run/pve-ups-panel/` 下使用以下狀態檔：

| 檔案 | 用途 |
|------|------|
| `shutdown-monitor.pid` | 執行中的 monitor daemon PID |
| `shutdown-done` | 旗標 — 節點關機已下令 |
| `guests-shut` | 本次事件中已關閉的 VM/CT（格式：`vmid:type`） |

所有狀態檔在市電恢復後自動清除。

## 授權條款

[GNU Affero General Public License v3.0](../LICENSE)

本專案為 Proxmox VE 的衍生作品，Proxmox VE 採用 AGPL-3.0 授權。
