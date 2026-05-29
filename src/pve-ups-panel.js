/**
 * pve-ups-panel.js
 * Proxmox VE UPS 監控面板
 *
 * 命名空間：PVE.ups.*
 * 元件樹：
 *   PVE.ups.View (card layout)
 *     ├── PVE.ups.EmptyState       ← 無裝置時顯示
 *     └── Ext.tab.Panel            ← 有裝置時顯示
 *           ├── PVE.ups.Overview
 *           ├── PVE.ups.DevicePanel
 *           ├── PVE.ups.History
 *           ├── PVE.ups.BatteryHealth
 *           ├── PVE.ups.ShutdownRules
 *           ├── PVE.ups.Notify
 *           └── PVE.ups.Log
 */

(function () {

// =========================================================================
// 模組輔助函式
// =========================================================================

// 秒數 → "Xh Ym" / "Ym Zs" / "--"
function fmtRuntime(sec) {
    var s = parseInt(sec, 10) || 0;
    if (s <= 0) return '--';
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var r = s % 60;
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm ' + r + 's';
    return r + 's';
}

// 數值帶單位；缺值回傳 '--'
function fmtVal(v, unit) {
    if (v === undefined || v === null || v === '') return '--';
    return unit ? (v + ' ' + unit) : String(v);
}

// UPS status 字串 → 彩色 badge HTML
function renderUpsStatus(statusStr) {
    if (!statusStr) return '<span style="color:#bbb;font-size:13px;">--</span>';
    var MAP = {
        OL:      [gettext('On Line'),         '#4caf50'],
        OB:      [gettext('On Battery'),      '#ff9800'],
        LB:      [gettext('Low Battery'),     '#f44336'],
        CHRG:    [gettext('Charging'),        '#4caf50'],
        DISCHRG: [gettext('Discharging'),     '#ff9800'],
        BOOST:   [gettext('Boosting'),        '#ff9800'],
        TRIM:    [gettext('Trimming'),        '#ff9800'],
        FSD:     [gettext('Forced Shutdown'), '#f44336'],
        RB:      [gettext('Replace Battery'), '#f44336'],
        OVER:    [gettext('Overload'),        '#f44336'],
    };
    return (statusStr.trim().split(/\s+/) || []).map(function (code) {
        var info = MAP[code] || [code, '#9e9e9e'];
        return '<span style="display:inline-block;padding:3px 12px;margin:2px;' +
               'border-radius:12px;background:' + info[1] + ';color:#fff;' +
               'font-size:12px;font-weight:600;">' +
               Ext.String.htmlEncode(info[0]) + '</span>';
    }).join('');
}

// =========================================================================
// PVE.ups.DeviceSelector — 裝置選擇工具列
// 由 Overview、History、BatteryHealth 分頁共用
// =========================================================================
Ext.define('PVE.ups.DeviceSelector', {
    extend: 'Ext.toolbar.Toolbar',
    alias: 'widget.pveUpsDeviceSelector',

    nodename: null,

    initComponent: function () {
        var me = this;

        me._deviceStore = Ext.create('Ext.data.Store', {
            fields: ['name', 'display'],
        });

        me._combo = Ext.create('Ext.form.field.ComboBox', {
            fieldLabel: gettext('Device'),
            labelWidth: 55,
            width: 300,
            store: me._deviceStore,
            valueField: 'name',
            displayField: 'display',
            queryMode: 'local',
            triggerAction: 'all',
            editable: false,
            listeners: {
                change: function (combo, val) {
                    if (val) {
                        me.fireEvent('devicechange', me, val);
                    }
                },
            },
        });

        Ext.apply(me, {
            items: [
                me._combo,
                ' ',
                {
                    xtype: 'button',
                    iconCls: 'fa fa-refresh',
                    tooltip: gettext('Refresh'),
                    handler: function () {
                        me.fireEvent('refresh', me);
                    },
                },
                {
                    xtype: 'button',
                    iconCls: 'fa fa-cog',
                    tooltip: gettext('Device Management'),
                    handler: function () {
                        me.fireEvent('manage', me);
                    },
                },
            ],
        });

        me.callParent();
    },

    getSelectedDevice: function () {
        return this._combo.getValue();
    },

    /** 載入裝置清單並預選第一台（若尚未選取） */
    loadDevices: function (devices) {
        var me = this;
        var current = me.getSelectedDevice();
        var data = Ext.Array.map(devices, function (name) {
            return { name: name, display: name };
        });
        me._deviceStore.removeAll();
        me._deviceStore.add(data);
        if (data.length > 0 && !current) {
            me._combo.setValue(data[0].name);
        }
    },
});

// =========================================================================
// PVE.ups.SetupDialog — 尚未設定裝置時的浮動提示視窗（仿 Ceph install-mask）
// =========================================================================
Ext.define('PVE.ups.SetupDialog', {
    extend: 'Ext.window.Window',
    alias: 'widget.pveUpsSetupDialog',

    width: 260,
    header: false,
    resizable: false,
    draggable: false,
    modal: true,
    shadow: false,
    border: false,
    bodyBorder: false,
    closable: false,
    cls: 'install-mask',
    bodyCls: 'install-mask',
    layout: {
        type: 'vbox',
        align: 'stretch',
        pack: 'center',
    },

    initComponent: function () {
        var me = this;

        me.items = [
            {
                xtype: 'component',
                cls: 'install-mask',
                html: '<div style="text-align:center;padding:20px 16px 8px;">' +
                      '<span class="fa fa-bolt" style="font-size:48px;opacity:0.5;"></span>' +
                      '</div>',
            },
            {
                xtype: 'component',
                cls: 'install-mask',
                html: '<p class="install-mask" style="text-align:center;">' +
                      Ext.String.htmlEncode(gettext('No UPS devices configured')) +
                      '<br>' +
                      Ext.String.htmlEncode(
                          gettext('Click the button below to set up your first UPS')
                      ) +
                      '</p>',
            },
            {
                xtype: 'button',
                text: gettext('Start Setup Wizard'),
                iconCls: 'fa fa-magic',
                margin: '4 16 16 16',
                handler: function () {
                    me.fireEvent('startwizard', me);
                },
            },
        ];

        me.callParent();
    },
});

// =========================================================================
// PVE.ups.SetupWizard — 3 步設定精靈（PVE.window.Wizard）
// =========================================================================
Ext.define('PVE.ups.SetupWizard', {
    extend: 'PVE.window.Wizard',
    alias: 'widget.pveUpsSetupWizard',

    title: gettext('UPS Setup Wizard'),
    nodename: null,

    initComponent: function () {
        var me = this;

        me.items = [
            // ── Step 1: 選擇連線模式 ────────────────────────────────────
            {
                title: gettext('Connection Mode'),
                xtype: 'inputpanel',
                items: [{
                    xtype: 'radiogroup',
                    columns: 1,
                    vertical: true,
                    itemId: 'modeGroup',
                    items: [
                        {
                            boxLabel: '<b>' + gettext('Direct Connection (USB / Serial)') + '</b>' +
                                      '<br><span style="font-weight:normal;color:#666;padding-left:22px;">' +
                                      gettext('UPS is physically connected to this machine') + '</span>',
                            name: 'upsMode',
                            inputValue: 'standalone',
                            checked: true,
                        },
                        {
                            boxLabel: '<b>' + gettext('Remote NUT Server') + '</b>' +
                                      '<br><span style="font-weight:normal;color:#666;padding-left:22px;">' +
                                      gettext('Connect to NUT Server on another machine') + '</span>',
                            name: 'upsMode',
                            inputValue: 'netclient',
                            margin: '14 0 0 0',
                        },
                    ],
                }],
            },

            // ── Step 2: 設定（card layout 根據 Step 1 選擇切換） ────────
            // 注意：兩個 card 的欄位使用不同 name 避免 getValues() 衝突
            {
                title: gettext('Configure'),
                xtype: 'panel',
                layout: 'card',
                border: false,
                validator: function () {
                    var active = this.getLayout().getActiveItem();
                    if (!active) return true;
                    var fields = active.query('[isFormField]');
                    var valid = true;
                    for (var i = 0; i < fields.length; i++) {
                        if (Ext.isFunction(fields[i].validate)) fields[i].validate();
                        if (Ext.isFunction(fields[i].isValid) && !fields[i].isValid()) {
                            valid = false;
                        }
                    }
                    return valid;
                },
                listeners: {
                    activate: function (panel) {
                        var modeGroup = me.down('[itemId=modeGroup]');
                        var vals = modeGroup ? modeGroup.getValue() : {};
                        var mode = (vals && vals.upsMode) || 'standalone';
                        panel.getLayout().setActiveItem(mode === 'netclient' ? 1 : 0);
                        if (mode !== 'netclient') {
                            var combo = me.down('#usbDeviceCombo');
                            if (!combo) return;
                            combo.setEmptyText(gettext('Scanning...'));
                            combo.clearValue();
                            combo.getStore().loadData([]);
                            Proxmox.Utils.API2Request({
                                url: '/nodes/' +
                                     encodeURIComponent(me.nodename) +
                                     '/ups/scan/usb',
                                method: 'GET',
                                success: function (response) {
                                    var devs = ((response.result || {}).data) || [];
                                    var storeData = Ext.Array.map(devs, function (d) {
                                        return {
                                            display: d.vendor && d.desc
                                                ? d.vendor + ' — ' + d.desc
                                                : (d.desc || d.vendor || d.vid + ':' + d.pid),
                                            driver: d.driver,
                                            serial: d.serial || '',
                                            vid: d.vid,
                                            pid: d.pid,
                                        };
                                    });
                                    var store = combo.getStore();
                                    store.removeAll();
                                    store.add(storeData);
                                    combo.setEmptyText(storeData.length > 0
                                        ? gettext('Select detected device...')
                                        : gettext('No USB UPS devices found'));
                                    if (storeData.length === 1) {
                                        combo.setValue(storeData[0].display);
                                        var drv = me.down('[name=upsDriverLocal]');
                                        if (drv) drv.setValue(storeData[0].driver);
                                        var sn = me.down('[name=upsSerialLocal]');
                                        if (sn && storeData[0].serial) sn.setValue(storeData[0].serial);
                                        var vid = me.down('[name=upsVidLocal]');
                                        if (vid && storeData[0].vid) vid.setValue(storeData[0].vid);
                                        var pid = me.down('[name=upsPidLocal]');
                                        if (pid && storeData[0].pid) pid.setValue(storeData[0].pid);
                                    }
                                },
                                failure: function () {
                                    combo.setEmptyText(gettext('Scan unavailable'));
                                },
                            });
                        }
                    },
                },
                items: [
                    // Card 0: 直連（USB / Serial）
                    {
                        xtype: 'inputpanel',
                        itemId: 'standaloneCard',
                        bodyPadding: '10 0 0 0',
                        items: [
                            // USB 裝置自動偵測下拉選單
                            {
                                xtype: 'combobox',
                                itemId: 'usbDeviceCombo',
                                fieldLabel: gettext('USB Device'),
                                labelWidth: 130,
                                emptyText: gettext('Scanning...'),
                                queryMode: 'local',
                                store: {
                                    fields: ['display', 'driver', 'serial', 'vid', 'pid'],
                                    data: [],
                                },
                                displayField: 'display',
                                valueField: 'display',
                                editable: false,
                                forceSelection: false,
                                margin: '0 0 8 0',
                                listeners: {
                                    select: function (combo, record) {
                                        var drv = me.down('[name=upsDriverLocal]');
                                        if (drv) drv.setValue(record.get('driver'));
                                        var sn = me.down('[name=upsSerialLocal]');
                                        if (sn) sn.setValue(record.get('serial') || '');
                                        var vid = me.down('[name=upsVidLocal]');
                                        if (vid) vid.setValue(record.get('vid') || '');
                                        var pid = me.down('[name=upsPidLocal]');
                                        if (pid) pid.setValue(record.get('pid') || '');
                                    },
                                },
                            },
                            // 表單欄位（standalone 專用 name，避免與 netclient 衝突）
                            {
                                xtype: 'textfield',
                                name: 'upsNameLocal',
                                fieldLabel: gettext('Device Name'),
                                labelWidth: 130,
                                value: 'ups',
                                allowBlank: false,
                                regex: /^[a-zA-Z0-9_@.-]+$/,
                                regexText: gettext('Alphanumeric, underscore, hyphen, dot, @'),
                            },
                            {
                                xtype: 'textfield',
                                name: 'upsSerialLocal',
                                fieldLabel: gettext('Serial Number'),
                                labelWidth: 130,
                                emptyText: gettext('Optional — bind to specific device'),
                                allowBlank: true,
                            },
                            {
                                xtype: 'textfield',
                                name: 'upsVidLocal',
                                fieldLabel: gettext('Vendor ID (VID)'),
                                labelWidth: 130,
                                emptyText: gettext('e.g. 0764'),
                                allowBlank: true,
                                regex: /^[0-9a-fA-F]{0,4}$/,
                                regexText: gettext('Up to 4 hex digits'),
                            },
                            {
                                xtype: 'textfield',
                                name: 'upsPidLocal',
                                fieldLabel: gettext('Product ID (PID)'),
                                labelWidth: 130,
                                emptyText: gettext('e.g. 0601'),
                                allowBlank: true,
                                regex: /^[0-9a-fA-F]{0,4}$/,
                                regexText: gettext('Up to 4 hex digits'),
                            },
                            {
                                xtype: 'combobox',
                                name: 'upsDriverLocal',
                                fieldLabel: gettext('Driver'),
                                labelWidth: 130,
                                value: 'usbhid-ups',
                                store: [
                                    ['usbhid-ups',      'usbhid-ups — CyberPower / APC (USB HID)'],
                                    ['blazer_usb',      'blazer_usb — Megatec / Q1 protocol'],
                                    ['nutdrv_qx',       'nutdrv_qx — Voltronic / Blazer / Q1'],
                                    ['tripplite_usb',   'tripplite_usb — Tripp Lite'],
                                    ['richcomm_usb',    'richcomm_usb — Richcomm Technology'],
                                    ['powercom',        'powercom — PowerCOM BNT series'],
                                ],
                                editable: false,
                            },
                        ],
                    },
                    // Card 1: 遠端 NUT Server
                    {
                        xtype: 'inputpanel',
                        itemId: 'netclientCard',
                        bodyPadding: '10 0 0 0',
                        items: [
                            {
                                xtype: 'textfield',
                                name: 'nutHost',
                                fieldLabel: gettext('NUT Server Address'),
                                labelWidth: 160,
                                allowBlank: false,
                            },
                            {
                                xtype: 'numberfield',
                                name: 'nutPort',
                                fieldLabel: gettext('Port'),
                                labelWidth: 160,
                                value: 3493,
                                minValue: 1,
                                maxValue: 65535,
                            },
                            {
                                xtype: 'textfield',
                                name: 'upsNameRemote',
                                fieldLabel: gettext('UPS Name'),
                                labelWidth: 160,
                                value: 'ups',
                                allowBlank: false,
                            },
                            {
                                xtype: 'textfield',
                                name: 'nutUser',
                                fieldLabel: gettext('Username'),
                                labelWidth: 160,
                                value: 'upsmon',
                            },
                            {
                                xtype: 'textfield',
                                inputType: 'password',
                                name: 'nutPassword',
                                fieldLabel: gettext('Password'),
                                labelWidth: 160,
                            },
                            {
                                xtype: 'button',
                                itemId: 'testConnBtn',
                                text: gettext('Test Connection'),
                                iconCls: 'fa fa-plug',
                                margin: '10 0 0 164',
                                handler: function () {
                                    var btn = this;
                                    var host     = me.down('[name=nutHost]');
                                    var port     = me.down('[name=nutPort]');
                                    var ups      = me.down('[name=upsNameRemote]');
                                    var resultCt = me.down('[itemId=connTestResult]');
                                    if (!host || !host.getValue()) {
                                        Ext.Msg.alert(gettext('Error'),
                                            gettext('Please enter a NUT server address.'));
                                        return;
                                    }
                                    btn.setDisabled(true);
                                    resultCt.update(
                                        '<span class="fa fa-spinner fa-spin" style="margin-right:6px"></span>' +
                                        gettext('Testing...')
                                    );
                                    resultCt.setVisible(true);
                                    Proxmox.Utils.API2Request({
                                        url: '/nodes/' +
                                             encodeURIComponent(me.nodename) +
                                             '/ups/scan/test-connection',
                                        method: 'POST',
                                        params: {
                                            host: host.getValue(),
                                            port: port ? port.getValue() : 3493,
                                            ups:  ups  ? ups.getValue()  : 'ups',
                                        },
                                        success: function (response) {
                                            btn.setDisabled(false);
                                            var d = ((response.result || {}).data) || {};
                                            if (d.success) {
                                                resultCt.update(
                                                    '<span class="fa fa-check-circle" style="color:#21bf73;margin-right:6px"></span>' +
                                                    '<span style="color:#21bf73">' + gettext('Connection successful') + '</span>'
                                                );
                                            } else {
                                                resultCt.update(
                                                    '<span class="fa fa-times-circle" style="color:#e74c3c;margin-right:6px"></span>' +
                                                    '<span style="color:#e74c3c">' + Ext.String.htmlEncode(d.message) + '</span>'
                                                );
                                            }
                                        },
                                        failure: function (response) {
                                            btn.setDisabled(false);
                                            resultCt.update(
                                                '<span class="fa fa-times-circle" style="color:#e74c3c;margin-right:6px"></span>' +
                                                '<span style="color:#e74c3c">' + gettext('Request failed') + '</span>'
                                            );
                                        },
                                    });
                                },
                            },
                            {
                                xtype: 'container',
                                itemId: 'connTestResult',
                                margin: '6 0 0 164',
                                hidden: true,
                                html: '',
                            },
                        ],
                    },
                ],
            },

            // ── Step 3: 確認與套用 ──────────────────────────────────────
            {
                title: gettext('Confirm'),
                layout: 'fit',
                onSubmit: function () {
                    var vals = me.getValues();
                    var mode = vals.upsMode || 'standalone';

                    var params = { mode: mode };
                    if (mode === 'standalone' || mode === 'netserver') {
                        params.name   = vals.upsNameLocal  || 'ups';
                        params.driver = vals.upsDriverLocal || 'usbhid-ups';
                        params.port   = 'auto';
                        if (vals.upsSerialLocal) params.serial    = vals.upsSerialLocal;
                        if (vals.upsVidLocal)    params.vendorid  = vals.upsVidLocal;
                        if (vals.upsPidLocal)    params.productid = vals.upsPidLocal;
                    } else {
                        params.name     = vals.upsNameRemote || 'ups';
                        params.nuthost  = vals.nutHost;
                        params.nutport  = parseInt(vals.nutPort, 10) || 3493;
                        params.username = vals.nutUser     || 'upsmon';
                        params.password = vals.nutPassword || '';
                    }

                    me.setLoading(true);
                    Proxmox.Utils.API2Request({
                        url: '/nodes/' +
                             encodeURIComponent(me.nodename) +
                             '/ups/config/devices',
                        method: 'POST',
                        params: params,
                        success: function () {
                            me.setLoading(false);
                            me.fireEvent('applied', me);
                            me.close();
                        },
                        failure: function (response) {
                            me.setLoading(false);
                            Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                        },
                    });
                },
                items: [{
                    xtype: 'grid',
                    border: false,
                    store: { model: 'KeyValue' },
                    columns: [
                        { header: gettext('Setting'), width: 170, dataIndex: 'key' },
                        { header: gettext('Value'), flex: 1, dataIndex: 'value',
                          renderer: Ext.htmlEncode },
                    ],
                }],
                listeners: {
                    activate: function (panel) {
                        var vals = me.getValues();
                        var mode = vals.upsMode || 'standalone';
                        var data = [
                            { key: gettext('Connection Mode'), value: mode },
                        ];
                        if (mode === 'standalone' || mode === 'netserver') {
                            data.push({ key: gettext('Device Name'),
                                        value: vals.upsNameLocal || 'ups' });
                            if (vals.upsSerialLocal) {
                                data.push({ key: gettext('Serial Number'),
                                            value: vals.upsSerialLocal });
                            }
                            if (vals.upsVidLocal) {
                                data.push({ key: gettext('Vendor ID (VID)'),
                                            value: vals.upsVidLocal });
                            }
                            if (vals.upsPidLocal) {
                                data.push({ key: gettext('Product ID (PID)'),
                                            value: vals.upsPidLocal });
                            }
                            data.push({ key: gettext('Driver'),
                                        value: vals.upsDriverLocal || 'usbhid-ups' });
                        } else {
                            data.push({ key: gettext('NUT Server'),
                                        value: (vals.nutHost || '') + ':' + (vals.nutPort || 3493) });
                            data.push({ key: gettext('UPS Name'),
                                        value: vals.upsNameRemote || 'ups' });
                            if (vals.nutUser) {
                                data.push({ key: gettext('Username'), value: vals.nutUser });
                            }
                        }
                        var store = panel.down('grid').getStore();
                        store.suspendEvents();
                        store.removeAll();
                        store.add(data);
                        store.resumeEvents();
                        store.fireEvent('refresh');
                    },
                },
            },
        ];

        me.callParent();
    },
});

// =========================================================================
// PVE.ups.Overview — 概覽分頁
// =========================================================================
Ext.define('PVE.ups.Overview', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveUpsOverview',

    title: gettext('Overview'),
    iconCls: 'fa fa-tachometer',
    scrollable: 'y',
    bodyStyle: 'scrollbar-gutter: stable;',
    nodename: null,
    upsName: 'ups',

    initComponent: function () {
        var me = this;

        // ── DeviceSelector toolbar ───────────────────────────────────────
        me.dockedItems = [{
            xtype: 'pveUpsDeviceSelector',
            itemId: 'deviceSel',
            dock: 'top',
            nodename: me.nodename,
            listeners: {
                devicechange: function (sel, val) {
                    me.upsName = val;
                    me.loadData();
                },
                refresh: function () {
                    me.loadData();
                },
                manage: function () {
                    me.up('tabpanel').setActiveTab(
                        me.up('tabpanel').down('[itemId=upsDevicePanel]')
                    );
                },
            },
        }];

        // ── 輔助：建立 2 欄 key-value grid 資訊卡 ───────────────────────
        function makeCard(title, gridItemId) {
            return {
                xtype: 'panel',
                title: title,
                flex: 1,
                border: true,
                margin: '0 5 0 0',
                items: [{
                    xtype: 'grid',
                    itemId: gridItemId,
                    hideHeaders: true,
                    border: false,
                    disableSelection: true,
                    viewConfig: { stripeRows: false },
                    store: {
                        type: 'array',
                        fields: ['name', 'value'],
                        data: [],
                    },
                    columns: [
                        { dataIndex: 'name',  flex: 1 },
                        { dataIndex: 'value', flex: 1 },
                    ],
                }],
            };
        }

        me.items = [
            // ── Row 1: 四個儀表板 widget ─────────────────────────────────
            {
                xtype: 'container',
                layout: { type: 'hbox', align: 'stretch' },
                height: 190,
                margin: '8 8 0 8',
                defaults: { margin: '0 4 0 0' },
                items: [
                    // 1a. UPS 狀態 badge
                    {
                        xtype: 'panel',
                        flex: 1,
                        title: gettext('UPS Status'),
                        border: true,
                        bodyStyle: 'text-align:center;',
                        bodyPadding: 12,
                        items: [{
                            xtype: 'component',
                            itemId: 'statusBadge',
                            html: '<div style="padding-top:18px;">' +
                                  '<span style="color:#bbb;font-size:13px;">--</span>' +
                                  '</div>',
                        }],
                    },
                    // 1b. 電池電量 gauge（高 = 好 → loadData 手動套色）
                    {
                        xtype: 'proxmoxGauge',
                        itemId: 'batteryGauge',
                        flex: 1,
                        title: gettext('Battery Charge'),
                        // 設 >1 讓 updateValue 不自動套色；由 loadData 手動處理
                        warningThreshold: 2,
                        criticalThreshold: 2,
                    },
                    // 1c. 剩餘執行時間（大字數值）
                    {
                        xtype: 'panel',
                        flex: 1,
                        title: gettext('Remaining Runtime'),
                        border: true,
                        bodyStyle: 'text-align:center;',
                        bodyPadding: 12,
                        items: [{
                            xtype: 'component',
                            itemId: 'runtimeDisplay',
                            html: '<div style="font-size:32px;font-weight:bold;color:#555;padding-top:12px;">--</div>',
                        }],
                    },
                    // 1d. 負載 gauge
                    {
                        xtype: 'proxmoxGauge',
                        itemId: 'loadGauge',
                        flex: 1,
                        title: gettext('UPS Load'),
                        warningThreshold: 0.6,
                        criticalThreshold: 0.8,
                    },
                ],
            },

            // ── Row 2: 電池狀態 + 輸入電源 ──────────────────────────────
            {
                xtype: 'container',
                layout: { type: 'hbox', align: 'stretch' },
                margin: '8 8 0 8',
                items: [
                    makeCard(gettext('Battery Status'), 'batteryGrid'),
                    makeCard(gettext('Input Power'),    'inputGrid'),
                ],
            },

            // ── Row 3: 輸出 / 負載 + 裝置資訊 ─────────────────────────
            {
                xtype: 'container',
                layout: { type: 'hbox', align: 'stretch' },
                margin: '8 8 0 8',
                items: [
                    makeCard(gettext('Output / Load'), 'outputGrid'),
                    makeCard(gettext('Device Info'),   'deviceGrid'),
                ],
            },

            // ── Row 4: NUT 服務狀態 ──────────────────────────────────────
            {
                xtype: 'panel',
                title: gettext('Service Status'),
                itemId: 'servicePanel',
                margin: '8 8 8 8',
                bodyPadding: 10,
                items: [{
                    xtype: 'container',
                    layout: { type: 'hbox', align: 'middle' },
                    items: [
                        {
                            xtype: 'component',
                            itemId: 'nutServerStatus',
                            width: 220,
                            html: '<b>nut-server</b> &nbsp;' +
                                  '<span class="fa fa-circle" style="color:#ccc;"></span> --',
                        },
                        {
                            xtype: 'button',
                            itemId: 'nutServerRestart',
                            text: gettext('Restart'),
                            iconCls: 'fa fa-refresh',
                            margin: '0 24 0 0',
                            handler: function () { me._restartService('nut-server'); },
                        },
                        {
                            xtype: 'component',
                            itemId: 'nutClientStatus',
                            width: 220,
                            html: '<b>nut-client</b> &nbsp;' +
                                  '<span class="fa fa-circle" style="color:#ccc;"></span> --',
                        },
                        {
                            xtype: 'button',
                            itemId: 'nutClientRestart',
                            text: gettext('Restart'),
                            iconCls: 'fa fa-refresh',
                            handler: function () { me._restartService('nut-client'); },
                        },
                    ],
                }],
            },
        ];

        me.on('activate',      me._startPolling,  me);
        me.on('deactivate',    me._stopPolling,   me);
        me.on('beforedestroy', me._stopPolling,   me);

        me.callParent();
    },

    // 從 NUT data object 更新所有儀表板元素
    loadData: function (data) {
        var me = this;
        if (arguments.length === 0) {
            me._refresh();
            return;
        }
        data = data || {};

        // ── 狀態 badge ──────────────────────────────────────────────────
        var badge = me.down('#statusBadge');
        if (badge) {
            badge.update(
                '<div style="padding:16px 4px;">' +
                renderUpsStatus(data['ups.status']) +
                '</div>'
            );
        }

        // ── 電池 gauge（高 = 好：<20% 紅、20-49% 橘、≥50% 預設色）──────
        var battCharge = parseFloat(data['battery.charge']) || 0;
        var battGauge = me.down('#batteryGauge');
        if (battGauge && battGauge.chart) {
            var frac = battCharge / 100;
            battGauge.updateValue(frac, battCharge.toFixed(0) + '%');
            var battCol = frac < 0.20
                ? battGauge.criticalColor
                : (frac < 0.50 ? battGauge.warningColor : battGauge.defaultColor);
            battGauge.chart.series[0].setColors([battCol, battGauge.backgroundColor]);
        }

        // ── 剩餘執行時間 ─────────────────────────────────────────────────
        var rtDisp = me.down('#runtimeDisplay');
        if (rtDisp) {
            rtDisp.update(
                '<div style="font-size:32px;font-weight:bold;color:#555;padding-top:12px;">' +
                fmtRuntime(data['battery.runtime']) +
                '</div>'
            );
        }

        // ── 負載 gauge ───────────────────────────────────────────────────
        var loadVal = parseFloat(data['ups.load']) || 0;
        var loadGauge = me.down('#loadGauge');
        if (loadGauge) {
            loadGauge.updateValue(loadVal / 100, loadVal.toFixed(0) + '%');
        }

        // ── 資訊卡格 ─────────────────────────────────────────────────────
        me._setGrid('batteryGrid', [
            [gettext('Battery Charge'),        fmtVal(data['battery.charge'], '%')],
            [gettext('Low Battery Threshold'), fmtVal(data['battery.charge.low'], '%')],
            [gettext('Warning Threshold'),     fmtVal(data['battery.charge.warning'], '%')],
            [gettext('Runtime to Empty'),      fmtRuntime(data['battery.runtime'])],
            [gettext('Low Runtime Threshold'), fmtRuntime(data['battery.runtime.low'])],
            [gettext('Design Capacity'),       fmtVal(data['battery.capacity'], '%')],
            [gettext('Battery Type'),          fmtVal(data['battery.type'])],
            [gettext('Battery Date'),          fmtVal(data['battery.date'])],
        ]);

        me._setGrid('inputGrid', [
            [gettext('Input Voltage'),           fmtVal(data['input.voltage'], 'V')],
            [gettext('Nominal Input Voltage'),   fmtVal(data['input.voltage.nominal'], 'V')],
            [gettext('Minimum Input Voltage'),   fmtVal(data['input.voltage.minimum'], 'V')],
            [gettext('Maximum Input Voltage'),   fmtVal(data['input.voltage.maximum'], 'V')],
            [gettext('Low Transfer Threshold'),  fmtVal(data['input.transfer.low'], 'V')],
            [gettext('High Transfer Threshold'), fmtVal(data['input.transfer.high'], 'V')],
            [gettext('Input Frequency'),         fmtVal(data['input.frequency'], 'Hz')],
            [gettext('Nominal Frequency'),       fmtVal(data['input.frequency.nominal'], 'Hz')],
        ]);

        me._setGrid('outputGrid', [
            [gettext('Percent Load'),            fmtVal(data['ups.load'], '%')],
            [gettext('Real Power'),              fmtVal(data['ups.realpower'], 'W')],
            [gettext('Apparent Power'),          fmtVal(data['ups.power'], 'VA')],
            [gettext('Nominal Power'),           fmtVal(data['ups.power.nominal'], 'VA')],
            [gettext('Output Voltage'),          fmtVal(data['output.voltage'], 'V')],
            [gettext('Nominal Output Voltage'),  fmtVal(data['output.voltage.nominal'], 'V')],
            [gettext('Output Frequency'),        fmtVal(data['output.frequency'], 'Hz')],
            [gettext('Beeper Status'),           fmtVal(data['ups.beeper.status'])],
        ]);

        me._setGrid('deviceGrid', [
            [gettext('Manufacturer'),        fmtVal(data['ups.mfr'])],
            [gettext('Model'),               fmtVal(data['ups.model'])],
            [gettext('Serial'),              fmtVal(data['ups.serial'])],
            [gettext('Firmware'),            fmtVal(data['ups.firmware'])],
            [gettext('Device Manufacturer'), fmtVal(data['device.mfr'])],
            [gettext('Device Model'),        fmtVal(data['device.model'])],
            [gettext('Device Serial'),       fmtVal(data['device.serial'])],
            [gettext('Test Result'),         fmtVal(data['ups.test.result'])],
        ]);

        // ── 服務狀態（由 _services 欄位提供，Phase 4 實作） ──────────────
        if (data._services) {
            me._setServiceStatus('nutServerStatus', 'nut-server',
                data._services['nut-server']);
            me._setServiceStatus('nutClientStatus', 'nut-client',
                data._services['nut-client']);
        }
    },

    _setGrid: function (itemId, rows) {
        var grid = this.down('#' + itemId);
        if (!grid) return;
        grid.getStore().loadData(
            rows.map(function (r) { return { name: r[0], value: r[1] }; })
        );
    },

    _setServiceStatus: function (itemId, service, status) {
        var cmp = this.down('#' + itemId);
        if (!cmp) return;
        var running = status === 'active';
        var color = running ? '#4caf50' : '#f44336';
        var label = running ? gettext('Running') : gettext('Stopped');
        cmp.update(
            '<b>' + Ext.String.htmlEncode(service) + '</b> &nbsp;' +
            '<span class="fa fa-circle" style="color:' + color + ';"></span> ' +
            Ext.String.htmlEncode(label)
        );
    },

    _restartService: function (service) {
        var me = this;
        Proxmox.Utils.API2Request({
            url: '/nodes/' +
                 encodeURIComponent(me.nodename) +
                 '/ups/config/service-restart',
            method: 'POST',
            params: { service: service },
            waitMsgTarget: me,
            success: function () {
                me._refresh();
            },
            failure: function (response) {
                Ext.Msg.alert(gettext('Error'), response.htmlStatus);
            },
        });
    },

    _refresh: function () {
        var me = this;
        if (!me.nodename || !me.upsName) return;
        Proxmox.Utils.API2Request({
            url: '/nodes/' + encodeURIComponent(me.nodename) + '/ups',
            method: 'GET',
            params: { ups: me.upsName },
            success: function (response) {
                var data = (response.result || {}).data || {};
                if (!data._no_devices) {
                    me.loadData(data);
                }
            },
            failure: function () { /* silent — 不中斷使用者操作 */ },
        });
    },

    _startPolling: function () {
        var me = this;
        me._stopPolling();
        me._pollingTask = Ext.TaskManager.start({
            run: me._refresh,
            scope: me,
            interval: 5000,
        });
    },

    _stopPolling: function () {
        var me = this;
        if (me._pollingTask) {
            Ext.TaskManager.stop(me._pollingTask);
            me._pollingTask = null;
        }
    },
});

// =========================================================================
// PVE.ups.DeviceEditWindow — 新增 / 編輯 UPS 裝置的浮動視窗
// =========================================================================
Ext.define('PVE.ups.DeviceEditWindow', {
    extend: 'Ext.window.Window',
    alias: 'widget.pveUpsDeviceEditWindow',

    title: gettext('Add UPS Device'),
    width: 520,
    modal: true,
    resizable: false,
    nodename: null,

    // 若傳入 device 物件則為編輯模式
    device: null,

    // 新增模式下用於重複名稱檢查
    existingNames: null,

    initComponent: function () {
        var me = this;

        if (me.device) {
            me.title = gettext('Edit UPS Device');
        }

        // ── USB scan store ────────────────────────────────────────────────
        me._usbStore = Ext.create('Ext.data.Store', {
            fields: ['display', 'driver', 'serial', 'vid', 'pid'],
        });

        me._scanUsb = function () {
            if (!me.nodename) return;
            Proxmox.Utils.API2Request({
                url: '/nodes/' + encodeURIComponent(me.nodename) + '/ups/scan/usb',
                method: 'GET',
                success: function (response) {
                    var list = ((response.result || {}).data) || [];
                    me._usbStore.removeAll();
                    me._usbStore.add(Ext.Array.map(list, function (d) {
                        var label = (d.vendor && d.desc)
                            ? (d.vendor + ' — ' + d.desc)
                            : (d.desc || d.vendor || (d.vid + ':' + d.pid));
                        return { display: label, driver: d.driver, serial: d.serial, vid: d.vid, pid: d.pid };
                    }));
                },
            });
        };

        // ── Mode radio ───────────────────────────────────────────────────
        me._modeRadio = Ext.create('Ext.form.RadioGroup', {
            fieldLabel: gettext('Mode'),
            columns: 3,
            items: [
                { boxLabel: 'Standalone',  name: 'upsMode', inputValue: 'standalone',  checked: true },
                { boxLabel: 'Net Server',  name: 'upsMode', inputValue: 'netserver'  },
                { boxLabel: 'Net Client',  name: 'upsMode', inputValue: 'netclient'  },
            ],
            listeners: {
                change: function (grp, val) {
                    var isClient = (val.upsMode === 'netclient');
                    me._directFields.setVisible(!isClient);
                    me._remoteFields.setVisible(isClient);
                },
            },
        });

        // ── Fields: standalone / netserver ──────────────────────────────
        me._usbCombo = Ext.create('Ext.form.field.ComboBox', {
            fieldLabel: gettext('Detected Devices'),
            store: me._usbStore,
            valueField: 'display',
            displayField: 'display',
            queryMode: 'local',
            editable: false,
            emptyText: gettext('No UPS detected'),
            listeners: {
                select: function (combo, rec) {
                    me._driverField.setValue(rec.get('driver'));
                    if (rec.get('serial')) me._serialField.setValue(rec.get('serial'));
                    if (rec.get('vid'))    me._vidField.setValue(rec.get('vid'));
                    if (rec.get('pid'))    me._pidField.setValue(rec.get('pid'));
                },
            },
        });

        me._nameField = Ext.create('Ext.form.field.Text', {
            fieldLabel: gettext('Device Name'),
            allowBlank: false,
            regex: /^[a-zA-Z0-9_@.-]+$/,
            regexText: gettext('Only alphanumeric, _, @, ., - allowed'),
            value: me.device ? me.device.name : 'ups',
            validator: function (val) {
                if (!me.device) {
                    var taken = me.existingNames || [];
                    if (Ext.Array.contains(taken, val)) {
                        return gettext('Device name already in use');
                    }
                }
                return true;
            },
            listeners: {
                change: function () {
                    var saveBtn = me.down('#saveBtn');
                    if (saveBtn) {
                        saveBtn.setDisabled(!me._nameField.isValid());
                    }
                },
            },
        });

        me._serialField = Ext.create('Ext.form.field.Text', {
            fieldLabel: gettext('Serial Number'),
            emptyText: gettext('Optional — bind to specific device'),
            value: me.device ? (me.device.serial || '') : '',
        });

        me._vidField = Ext.create('Ext.form.field.Text', {
            fieldLabel: gettext('Vendor ID (VID)'),
            emptyText: gettext('e.g. 0764'),
            allowBlank: true,
            regex: /^[0-9a-fA-F]{0,4}$/,
            regexText: gettext('Up to 4 hex digits'),
            value: me.device ? (me.device.vendorid || '') : '',
        });

        me._pidField = Ext.create('Ext.form.field.Text', {
            fieldLabel: gettext('Product ID (PID)'),
            emptyText: gettext('e.g. 0601'),
            allowBlank: true,
            regex: /^[0-9a-fA-F]{0,4}$/,
            regexText: gettext('Up to 4 hex digits'),
            value: me.device ? (me.device.productid || '') : '',
        });

        me._driverField = Ext.create('Ext.form.field.Text', {
            fieldLabel: gettext('Driver'),
            allowBlank: false,
            value: me.device ? (me.device.driver || 'usbhid-ups') : 'usbhid-ups',
        });

        me._portField = Ext.create('Ext.form.field.Text', {
            fieldLabel: gettext('Port'),
            allowBlank: false,
            value: me.device ? (me.device.port || 'auto') : 'auto',
        });

        me._descField = Ext.create('Ext.form.field.Text', {
            fieldLabel: gettext('Description'),
            value: me.device ? (me.device.desc || '') : '',
        });

        me._directFields = Ext.create('Ext.container.Container', {
            defaults: { anchor: '100%' },
            layout: 'anchor',
            items: [me._usbCombo, me._nameField, me._serialField, me._vidField, me._pidField, me._driverField, me._portField, me._descField],
        });

        // ── Fields: netclient ────────────────────────────────────────────
        me._nutHostField = Ext.create('Ext.form.field.Text', {
            fieldLabel: gettext('NUT Server Host'),
            allowBlank: false,
            value: '',
        });

        me._nutPortField = Ext.create('Ext.form.field.Number', {
            fieldLabel: gettext('Port'),
            allowBlank: false,
            value: 3493,
            minValue: 1,
            maxValue: 65535,
        });

        me._remoteUpsField = Ext.create('Ext.form.field.Text', {
            fieldLabel: gettext('UPS Name'),
            allowBlank: false,
            value: 'ups',
        });

        me._remoteUserField = Ext.create('Ext.form.field.Text', {
            fieldLabel: gettext('Username'),
            value: 'upsmon',
        });

        me._remotePassField = Ext.create('Ext.form.field.Text', {
            fieldLabel: gettext('Password'),
            inputType: 'password',
            value: '',
        });

        me._remoteFields = Ext.create('Ext.container.Container', {
            hidden: true,
            defaults: { anchor: '100%' },
            layout: 'anchor',
            items: [me._nutHostField, me._nutPortField, me._remoteUpsField, me._remoteUserField, me._remotePassField],
        });

        me._form = Ext.create('Ext.form.Panel', {
            bodyPadding: 15,
            border: false,
            defaultType: 'textfield',
            defaults: { labelWidth: 150, anchor: '100%' },
            items: [me._modeRadio, me._directFields, me._remoteFields],
        });

        Ext.apply(me, {
            items: [me._form],
            buttons: [
                {
                    text: gettext('Save'),
                    itemId: 'saveBtn',
                    formBind: false,
                    handler: function () {
                        var mode = (me._modeRadio.getValue() || {}).upsMode || 'standalone';
                        var params = { mode: mode };

                        if (mode === 'standalone' || mode === 'netserver') {
                            if (!me._nameField.validate()) return;
                            if (!me._driverField.validate()) return;
                            if (!me._portField.validate()) return;
                            params.name   = me._nameField.getValue();
                            params.driver = me._driverField.getValue();
                            params.port   = me._portField.getValue();
                            params.desc   = me._descField.getValue() || '';
                            var serial = me._serialField.getValue();
                            if (serial) params.serial = serial;
                            var vid = me._vidField.getValue();
                            if (vid) params.vendorid = vid;
                            var pid = me._pidField.getValue();
                            if (pid) params.productid = pid;
                            if (me.device && me.device.name !== params.name) {
                                params.oldname = me.device.name;
                            }
                        } else {
                            if (!me._nutHostField.validate()) return;
                            if (!me._remoteUpsField.validate()) return;
                            params.nuthost  = me._nutHostField.getValue();
                            params.nutport  = me._nutPortField.getValue();
                            params.name     = me._remoteUpsField.getValue();
                            params.username = me._remoteUserField.getValue() || 'upsmon';
                            params.password = me._remotePassField.getValue() || '';
                        }

                        Proxmox.Utils.API2Request({
                            url: '/nodes/' + encodeURIComponent(me.nodename) + '/ups/config/devices',
                            method: 'POST',
                            params: params,
                            waitMsgTarget: me,
                            success: function () {
                                me.fireEvent('saved', me);
                                me.close();
                            },
                            failure: function (response) {
                                var msg = ((response.result || {}).message) || gettext('Unknown error');
                                Ext.Msg.alert(gettext('Error'), msg);
                            },
                        });
                    },
                },
                {
                    text: gettext('Cancel'),
                    handler: function () { me.close(); },
                },
            ],
            listeners: {
                afterrender: function () {
                    me._scanUsb();
                    if (me.device) {
                        var m = me.device.mode || 'standalone';
                        me._modeRadio.setValue({ upsMode: m });
                    }
                },
            },
        });

        me.callParent();
    },
});

// =========================================================================
// PVE.ups.DevicePanel — 裝置管理分頁
// =========================================================================
Ext.define('PVE.ups.DevicePanel', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveUpsDevicePanel',

    title: gettext('Device Management'),
    iconCls: 'fa fa-hdd-o',
    layout: 'border',
    nodename: null,

    initComponent: function () {
        var me = this;

        // ── Device list grid (west) ──────────────────────────────────────
        me._deviceStore = Ext.create('Ext.data.Store', {
            fields: ['name', 'driver', 'port', 'desc', 'serial', 'vendorid', 'productid', 'status', 'mode'],
            data: [],
        });

        me._deviceGrid = Ext.create('Ext.grid.Panel', {
            store: me._deviceStore,
            border: false,
            hideHeaders: false,
            selModel: { mode: 'SINGLE' },
            columns: [
                {
                    header: gettext('Status'),
                    flex: 2,
                    dataIndex: 'status',
                    renderer: function (v) {
                        var color = (v === 'connected') ? '#4caf50' : '#bbb';
                        return '<span style="display:inline-block;width:10px;height:10px;' +
                               'border-radius:50%;background:' + color + ';margin:3px auto;"></span>';
                    },
                },
                {
                    header: gettext('Name'),
                    flex: 8,
                    dataIndex: 'name',
                },
            ],
            tbar: [
                {
                    xtype: 'button',
                    iconCls: 'fa fa-plus',
                    text: gettext('Add'),
                    handler: function () { me._openEditWindow(null); },
                },
            ],
            listeners: {
                selectionchange: function (sel, recs) {
                    if (recs.length > 0) {
                        me._showDevice(recs[0]);
                    } else {
                        me._clearDetail();
                    }
                },
            },
        });

        // ── Detail grid + toolbar (center) ──────────────────────────────
        me._detailStore = Ext.create('Ext.data.Store', {
            model: 'KeyValue',
            data: [],
        });

        me._detailGrid = Ext.create('Ext.grid.Panel', {
            store: me._detailStore,
            border: false,
            hideHeaders: true,
            columns: [
                { dataIndex: 'key',   width: 150, renderer: function (v) {
                    return '<span style="color:#888;">' + Ext.htmlEncode(v) + '</span>';
                }},
                { dataIndex: 'value', flex: 1, renderer: Ext.htmlEncode },
            ],
            tbar: [
                {
                    xtype: 'button',
                    itemId: 'editBtn',
                    iconCls: 'fa fa-pencil',
                    text: gettext('Edit'),
                    disabled: true,
                    handler: function () {
                        var sel = me._deviceGrid.getSelection();
                        if (sel.length > 0) me._openEditWindow(sel[0].getData());
                    },
                },
                {
                    xtype: 'button',
                    itemId: 'deleteBtn',
                    iconCls: 'fa fa-trash-o',
                    text: gettext('Delete'),
                    disabled: true,
                    handler: function () {
                        var sel = me._deviceGrid.getSelection();
                        if (!sel.length) return;
                        var name = sel[0].get('name');
                        Ext.Msg.confirm(gettext('Confirm'), Ext.String.format(
                            gettext("Delete device '{0}'?"), name),
                            function (btn) {
                                if (btn !== 'yes') return;
                                me._deleteDevice(name);
                            }
                        );
                    },
                },
            ],
        });

        Ext.apply(me, {
            items: [
                {
                    region: 'west',
                    width: 300,
                    split: true,
                    border: true,
                    layout: 'fit',
                    title: gettext('Devices'),
                    items: [me._deviceGrid],
                },
                {
                    region: 'center',
                    layout: 'fit',
                    border: true,
                    title: gettext('Device Details'),
                    items: [me._detailGrid],
                },
            ],
            listeners: {
                activate: function () {
                    me._loadDevices();
                },
            },
        });

        me.callParent();
    },

    _loadDevices: function () {
        var me = this;
        if (!me.nodename) return;
        Proxmox.Utils.API2Request({
            url: '/nodes/' + encodeURIComponent(me.nodename) + '/ups/config/devices',
            method: 'GET',
            success: function (response) {
                var list = ((response.result || {}).data) || [];
                me._deviceStore.removeAll();
                me._deviceStore.add(list);
                var names = Ext.Array.map(list, function (d) { return d.name; });
                me.fireEvent('deviceschanged', me, names);
            },
            failure: function () {},
        });
    },

    _showDevice: function (rec) {
        var me = this;
        var data = [
            { key: gettext('Name'),            value: rec.get('name')      || '--' },
            { key: gettext('Mode'),            value: rec.get('mode')      || '--' },
            { key: gettext('Status'),          value: rec.get('status')    || '--' },
            { key: gettext('Driver'),          value: rec.get('driver')    || '--' },
            { key: gettext('Port'),            value: rec.get('port')      || '--' },
            { key: gettext('Serial'),          value: rec.get('serial')    || '--' },
            { key: gettext('Vendor ID (VID)'), value: rec.get('vendorid')  || '--' },
            { key: gettext('Product ID (PID)'),value: rec.get('productid') || '--' },
            { key: gettext('Description'),     value: rec.get('desc')      || '--' },
        ];
        me._detailStore.suspendEvents();
        me._detailStore.removeAll();
        me._detailStore.add(data);
        me._detailStore.resumeEvents();
        me._detailStore.fireEvent('refresh');
        me.down('#editBtn').enable();
        me.down('#deleteBtn').enable();
    },

    _clearDetail: function () {
        var me = this;
        me._detailStore.removeAll();
        me.down('#editBtn').disable();
        me.down('#deleteBtn').disable();
    },

    _openEditWindow: function (deviceData) {
        var me = this;
        var existingNames = [];
        me._deviceStore.each(function (rec) { existingNames.push(rec.get('name')); });
        var win = Ext.create('PVE.ups.DeviceEditWindow', {
            nodename: me.nodename,
            device: deviceData || null,
            existingNames: existingNames,
            listeners: {
                saved: function () {
                    me._loadDevices();
                },
            },
        });
        win.show();
    },

    _deleteDevice: function (name) {
        var me = this;
        Proxmox.Utils.API2Request({
            url: '/nodes/' + encodeURIComponent(me.nodename) + '/ups/config/devices/' +
                 encodeURIComponent(name),
            method: 'DELETE',
            success: function () {
                me._clearDetail();
                me._loadDevices();
            },
            failure: function (response) {
                var msg = ((response.result || {}).message) || gettext('Unknown error');
                Ext.Msg.alert(gettext('Error'), msg);
            },
        });
    },

});

// RRD 資料模型：將 API 回傳的 Unix 秒轉換為 Date 物件供圖表使用
Ext.define('pve-ups-rrd', {
    extend: 'Ext.data.Model',
    fields: [
        { type: 'date', dateFormat: 'timestamp', name: 'time' },
        'battery_charge',
        'runtime',
        'load',
        'input_voltage',
        'realpower',
        'apparent_power',
    ],
});

// =========================================================================
// PVE.ups.History — 歷史記錄分頁
// =========================================================================
Ext.define('PVE.ups.History', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveUpsHistory',

    title: gettext('History'),
    iconCls: 'fa fa-line-chart',
    scrollable: 'y',
    bodyStyle: 'scrollbar-gutter: stable;',
    layout: { type: 'vbox', align: 'stretch' },
    nodename: null,
    upsName: 'ups',

    initComponent: function () {
        var me = this;

        me._rrdStore = Ext.create('Proxmox.data.RRDStore', {
            rrdurl: '/api2/json/nodes/' + me.nodename + '/ups/rrddata',
            model: 'pve-ups-rrd',
            interval: 60000,
            // Override setRRDUrl to inject the ups parameter
            setRRDUrl: function (timeframe, cf) {
                if (!timeframe) timeframe = this.timeframe;
                if (!cf)        cf        = this.cf;
                this.proxy.url = this.rrdurl +
                    '?ups='       + encodeURIComponent(me.upsName) +
                    '&timeframe=' + timeframe +
                    '&cf='        + cf;
            },
        });

        me.dockedItems = [
            {
                xtype: 'pveUpsDeviceSelector',
                itemId: 'deviceSel',
                dock: 'top',
                nodename: me.nodename,
                listeners: {
                    devicechange: function (sel, val) {
                        me.upsName = val;
                        me._rrdStore.stopUpdate();
                        me._rrdStore.setRRDUrl();
                        me._rrdStore.startUpdate();
                    },
                    refresh: function () { me._rrdStore.load(); },
                    manage: function () {
                        me.up('tabpanel').setActiveTab(
                            me.up('tabpanel').down('[itemId=upsDevicePanel]')
                        );
                    },
                },
            },
            {
                xtype: 'toolbar',
                dock: 'top',
                items: ['->', { xtype: 'proxmoxRRDTypeSelector' }],
            },
        ];

        me.items = [
            {
                xtype: 'proxmoxRRDChart',
                title: gettext('Battery Charge (%)'),
                fields: ['battery_charge'],
                fieldTitles: [gettext('Battery Charge')],
                unit: 'percent',
                store: me._rrdStore,
                height: 220,
                margin: '8 8 0 8',
            },
            {
                xtype: 'proxmoxRRDChart',
                title: gettext('UPS Load (%)'),
                fields: ['load'],
                fieldTitles: [gettext('UPS Load')],
                unit: 'percent',
                store: me._rrdStore,
                height: 220,
                margin: '8 8 0 8',
            },
            {
                xtype: 'proxmoxRRDChart',
                title: gettext('Input Voltage (V)'),
                fields: ['input_voltage'],
                fieldTitles: [gettext('Input Voltage')],
                store: me._rrdStore,
                height: 220,
                margin: '8 8 0 8',
            },
            {
                xtype: 'proxmoxRRDChart',
                title: gettext('Power'),
                fields: ['realpower', 'apparent_power'],
                fieldTitles: [gettext('Real Power (W)'), gettext('Apparent Power (VA)')],
                store: me._rrdStore,
                height: 220,
                margin: '8 8 8 8',
            },
        ];

        me.on('activate', function () {
            me._rrdStore.setRRDUrl();
            me._rrdStore.startUpdate();
        });
        me.on('deactivate', function () {
            me._rrdStore.stopUpdate();
        });

        me.callParent();
    },
});

// =========================================================================
// PVE.ups.BatteryHealth — 電池健康分頁
// =========================================================================
Ext.define('PVE.ups.BatteryHealth', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveUpsBatteryHealth',

    title: gettext('Battery Health'),
    iconCls: 'fa fa-heartbeat',
    scrollable: 'y',
    bodyStyle: 'scrollbar-gutter: stable;',
    layout: { type: 'vbox', align: 'stretch' },
    nodename: null,
    upsName: 'ups',

    _pollTask: null,

    _fmtRuntime: function (secs) {
        secs = parseInt(secs, 10);
        if (isNaN(secs)) return gettext('N/A');
        var h = Math.floor(secs / 3600);
        var m = Math.floor((secs % 3600) / 60);
        var s = secs % 60;
        if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
        if (m > 0) return m + 'm ' + s + 's';
        return s + 's';
    },

    _healthColor: function (pct) {
        if (pct >= 80) return '#21bf73';
        if (pct >= 60) return '#ff9800';
        return '#f44336';
    },

    _loadData: function () {
        var me = this;
        if (!me.nodename || !me.upsName) return;
        Proxmox.Utils.API2Request({
            url: '/nodes/' + me.nodename + '/ups/battery',
            params: { ups: me.upsName },
            method: 'GET',
            success: function (response) {
                me._updateUI(response.result.data);
            },
        });
    },

    _updateUI: function (data) {
        var me = this;
        me._updateHealthCard(data);
        me._updateTestCard(data);
        me._historyStore.loadData(data.tests || []);
    },

    _updateHealthCard: function (data) {
        var me = this;
        var health  = data.health;
        var barEl   = me.down('[itemId=healthBar]');
        var estEl   = me.down('[itemId=estLife]');
        var replEl  = me.down('[itemId=replaceBy]');

        var pct   = (health !== null && health !== undefined) ? health : 0;
        var color = (health !== null && health !== undefined) ? me._healthColor(health) : '#aaaaaa';
        var label = (health !== null && health !== undefined) ? health + '%' : gettext('N/A');

        barEl.update(
            '<div style="background:#e0e0e0;border-radius:4px;height:26px;overflow:hidden;margin-bottom:6px">' +
            '<div style="height:100%;width:' + pct + '%;background:' + color +
            ';border-radius:4px;transition:width 0.5s"></div></div>' +
            '<div style="font-size:20px;font-weight:bold;color:' + color + '">' + label + '</div>'
        );

        var estMonths = data.estimated_months;
        estEl.setValue(
            (estMonths !== null && estMonths !== undefined)
                ? Ext.String.format(gettext('~{0} months'), estMonths)
                : gettext('N/A')
        );
        replEl.setValue(data.replace_by || gettext('N/A'));
    },

    _updateTestCard: function (data) {
        var me       = this;
        var tests    = data.tests || [];
        var result   = data.test_result || 'No test initiated';
        var pending  = !!data.test_pending;
        var inProgress = pending || result === 'In progress';

        var lastEl   = me.down('[itemId=lastTestInfo]');
        var statusEl = me.down('[itemId=testStatus]');

        // Last completed test
        var last = tests[0];
        if (last) {
            var ts      = Ext.util.Format.date(new Date(last.timestamp), 'Y-m-d H:i');
            var runtime = (last.runtime !== null && last.runtime !== undefined)
                            ? me._fmtRuntime(last.runtime) : gettext('N/A');
            var res     = last.result || gettext('N/A');
            var icon = 'fa-question-circle';
            if (res.indexOf('Pass') !== -1)    icon = 'fa-check-circle" style="color:#21bf73';
            else if (res.indexOf('Warning') !== -1) icon = 'fa-exclamation-triangle" style="color:#ff9800';
            else if (res.indexOf('Error') !== -1 || res.indexOf('Fail') !== -1)
                                               icon = 'fa-times-circle" style="color:#f44336';
            lastEl.update(
                '<b>' + ts + '</b><br>' +
                gettext('Result') + ': <span class="fa ' + icon + '"></span> ' + Ext.String.htmlEncode(res) + '<br>' +
                gettext('Runtime') + ': ' + runtime
            );
        } else {
            lastEl.update('<span style="opacity:0.5">' + gettext('No tests recorded') + '</span>');
        }

        // Test in progress?
        if (inProgress) {
            statusEl.update(
                '<span class="fa fa-spinner fa-spin"></span> ' + gettext('Test in progress...')
            );
            me._setTestBtnsDisabled(true);
            if (!me._pollTask) {
                me._pollTask = Ext.TaskManager.start({
                    run: function () { me._loadData(); },
                    interval: 30000,
                });
            }
        } else {
            var statusHtml = '';
            if (result && result !== 'No test initiated') {
                statusHtml = Ext.String.htmlEncode(result);
            }
            statusEl.update(statusHtml);
            me._setTestBtnsDisabled(false);
            if (me._pollTask) {
                Ext.TaskManager.stop(me._pollTask);
                me._pollTask = null;
            }
        }
    },

    _setTestBtnsDisabled: function (disabled) {
        var me = this;
        me.down('[itemId=quickTestBtn]').setDisabled(disabled);
        me.down('[itemId=fullTestBtn]').setDisabled(disabled);
    },

    _confirmTest: function (type) {
        var me = this;
        var title, msg;

        if (type === 'quick') {
            title = gettext('Quick Battery Test');
            msg   = '<b>' + gettext('Quick Test (~10–20 seconds)') + '</b><br><br>' +
                    gettext('The UPS will briefly switch to battery power for about 10–20 seconds, then automatically return to utility power.') +
                    '<br><br>' +
                    gettext('Connected loads will not experience any power interruption.') +
                    '<br><br>' +
                    gettext('Do you want to proceed?');
        } else {
            title = gettext('Full Battery Test');
            msg   = '<b>' + gettext('Full Battery Test (10–40 minutes)') + '</b><br><br>' +
                    gettext('The UPS will run entirely on battery power until the low-battery threshold is reached, then switch back to utility power and recharge.') +
                    '<br><br>' +
                    '<span style="color:#ff9800"><b>&#9888; ' + gettext('Warning') + ':</b></span> ' +
                    gettext('If utility power fails during this test, the UPS battery may not have sufficient charge to protect your system.') +
                    '<br><br>' +
                    gettext('Recommended: run during a period of stable utility power with minimal load.') +
                    '<br><br>' +
                    gettext('Do you want to proceed?');
        }

        Ext.Msg.show({
            title:   title,
            msg:     msg,
            buttons: Ext.Msg.OKCANCEL,
            icon:    type === 'quick' ? Ext.Msg.INFO : Ext.Msg.WARNING,
            fn: function (btn) {
                if (btn === 'ok') me._runTest(type);
            },
        });
    },

    _runTest: function (type) {
        var me       = this;
        var statusEl = me.down('[itemId=testStatus]');

        me._setTestBtnsDisabled(true);
        statusEl.update('<span class="fa fa-spinner fa-spin"></span> ' + gettext('Starting test...'));

        Proxmox.Utils.API2Request({
            url: '/nodes/' + me.nodename + '/ups/battery/test',
            params: { ups: me.upsName, type: type },
            method: 'POST',
            success: function () {
                me._loadData();
            },
            failure: function (response) {
                var err = (response.result || {}).message || gettext('Battery test failed');
                statusEl.update('<span style="color:#f44336"><span class="fa fa-times-circle"></span> ' +
                    Ext.String.htmlEncode(err) + '</span>');
                me._setTestBtnsDisabled(false);
            },
        });
    },

    initComponent: function () {
        var me = this;

        me._historyStore = Ext.create('Ext.data.Store', {
            fields: ['timestamp', 'ups', 'runtime', 'result', 'charge_at_test', 'status'],
            data: [],
        });

        me.dockedItems = [{
            xtype: 'pveUpsDeviceSelector',
            itemId: 'deviceSel',
            dock: 'top',
            nodename: me.nodename,
            listeners: {
                devicechange: function (sel, val) {
                    me.upsName = val;
                    me._loadData();
                },
                refresh: function () { me._loadData(); },
                manage: function () {
                    me.up('tabpanel').setActiveTab(
                        me.up('tabpanel').down('[itemId=upsDevicePanel]')
                    );
                },
            },
        }];

        me.items = [
            // ── 上半部：健康度 + 測試卡片 ──────────────────────────────
            {
                xtype: 'panel',
                layout: { type: 'hbox', align: 'stretch' },
                flex: 0,
                height: 230,
                border: false,
                bodyStyle: 'background:transparent',
                items: [
                    // 左：電池健康度
                    {
                        xtype: 'panel',
                        title: gettext('Battery Health'),
                        flex: 1,
                        margin: '8 4 0 8',
                        bodyPadding: 12,
                        items: [
                            {
                                xtype: 'component',
                                itemId: 'healthBar',
                                margin: '0 0 8 0',
                                html: '<div style="background:#e0e0e0;border-radius:4px;height:26px"></div>',
                            },
                            {
                                xtype: 'displayfield',
                                itemId: 'estLife',
                                fieldLabel: gettext('Est. Remaining Life'),
                                value: gettext('N/A'),
                            },
                            {
                                xtype: 'displayfield',
                                itemId: 'replaceBy',
                                fieldLabel: gettext('Recommended Replacement'),
                                value: gettext('N/A'),
                            },
                        ],
                    },
                    // 右：手動電池測試
                    {
                        xtype: 'panel',
                        title: gettext('Manual Battery Test'),
                        flex: 1,
                        margin: '8 8 0 4',
                        bodyPadding: 12,
                        items: [
                            {
                                xtype: 'component',
                                itemId: 'lastTestInfo',
                                margin: '0 0 10 0',
                                html: '<span style="opacity:0.5">' + gettext('No tests recorded') + '</span>',
                            },
                            {
                                xtype: 'container',
                                layout: 'hbox',
                                items: [
                                    {
                                        xtype: 'button',
                                        itemId: 'quickTestBtn',
                                        text: gettext('Quick Test'),
                                        iconCls: 'fa fa-bolt',
                                        margin: '0 6 0 0',
                                        handler: function () { me._confirmTest('quick'); },
                                    },
                                    {
                                        xtype: 'button',
                                        itemId: 'fullTestBtn',
                                        text: gettext('Full Test'),
                                        iconCls: 'fa fa-battery-full',
                                        handler: function () { me._confirmTest('full'); },
                                    },
                                ],
                            },
                            {
                                xtype: 'component',
                                itemId: 'testStatus',
                                margin: '8 0 0 0',
                                html: '',
                            },
                            {
                                xtype: 'component',
                                margin: '8 0 0 0',
                                html: '<div style="opacity:0.55;font-size:11px">' +
                                      gettext('Test takes approx. 10–20 minutes.') + '<br>' +
                                      gettext('Do not close this page during the test.') +
                                      '</div>',
                            },
                        ],
                    },
                ],
            },
            // ── 下半部：測試歷史 ────────────────────────────────────────
            {
                xtype: 'grid',
                flex: 1,
                minHeight: 180,
                margin: '8 8 8 8',
                title: gettext('Test History'),
                store: me._historyStore,
                columns: [
                    {
                        text: gettext('Date'),
                        dataIndex: 'timestamp',
                        width: 155,
                        renderer: function (v) {
                            if (!v) return gettext('N/A');
                            return Ext.util.Format.date(new Date(v), 'Y-m-d H:i');
                        },
                    },
                    {
                        text: gettext('Runtime'),
                        dataIndex: 'runtime',
                        width: 110,
                        renderer: function (v) {
                            return (v !== null && v !== undefined) ? me._fmtRuntime(v) : gettext('N/A');
                        },
                    },
                    {
                        text: gettext('Result'),
                        dataIndex: 'result',
                        flex: 1,
                        renderer: function (v) {
                            if (!v) return gettext('N/A');
                            var icon = 'fa-question-circle';
                            if (v.indexOf('Pass') !== -1)
                                icon = 'fa-check-circle" style="color:#21bf73';
                            else if (v.indexOf('Warning') !== -1)
                                icon = 'fa-exclamation-triangle" style="color:#ff9800';
                            else if (v.indexOf('Error') !== -1 || v.indexOf('Fail') !== -1)
                                icon = 'fa-times-circle" style="color:#f44336';
                            return '<span class="fa ' + icon + '"></span> ' + Ext.String.htmlEncode(v);
                        },
                    },
                    {
                        text: gettext('Trend'),
                        dataIndex: 'runtime',
                        width: 110,
                        renderer: function (v, meta, record) {
                            var idx  = me._historyStore.indexOf(record);
                            var prev = me._historyStore.getAt(idx + 1);
                            if (!prev || !v || !prev.get('runtime')) return '—';
                            var diff = parseInt(v, 10) - parseInt(prev.get('runtime'), 10);
                            if (diff > 0) return '<span style="color:#21bf73">↑ +' + me._fmtRuntime(diff) + '</span>';
                            if (diff < 0) return '<span style="color:#ff9800">↓ −' + me._fmtRuntime(-diff) + '</span>';
                            return '—';
                        },
                    },
                    {
                        text: gettext('Charge at Test'),
                        dataIndex: 'charge_at_test',
                        width: 120,
                        renderer: function (v) {
                            return (v !== null && v !== undefined) ? v + '%' : gettext('N/A');
                        },
                    },
                ],
            },
        ];

        me.callParent();

        me.on('activate', function () { me._loadData(); });
        me.on('deactivate', function () {
            if (me._pollTask) {
                Ext.TaskManager.stop(me._pollTask);
                me._pollTask = null;
            }
        });
        me.on('beforedestroy', function () {
            if (me._pollTask) {
                Ext.TaskManager.stop(me._pollTask);
                me._pollTask = null;
            }
        });
    },
});

// =========================================================================
// =========================================================================
// PVE.ups.ShutdownRuleEditWindow — 新增/編輯關機規則 Dialog
// =========================================================================
Ext.define('PVE.ups.ShutdownRuleEditWindow', {
    extend: 'Ext.window.Window',

    width: 500,
    modal: true,
    resizable: false,
    layout: 'fit',
    nodename: null,
    editRecord: null,

    _loadGuests: function () {
        var me = this;
        var combo = me.down('[name=guestKey]');
        var allGuests = [];
        var pending = 2;

        var done = function () {
            if (--pending > 0) return;
            allGuests.sort(function (a, b) { return a.vmid - b.vmid; });
            combo.getStore().loadData(allGuests);
            if (me.editRecord) {
                combo.setValue(me.editRecord.vmid + ':' + me.editRecord.type);
            }
        };

        var collect = function (list, type) {
            var prefix = type === 'qemu' ? 'VM' : 'CT';
            (list || []).forEach(function (g) {
                allGuests.push({
                    key: g.vmid + ':' + type,
                    vmid: g.vmid,
                    type: type,
                    guestName: g.name || (prefix + ' ' + g.vmid),
                    displayName: prefix + ' ' + g.vmid + (g.name ? ' — ' + g.name : ''),
                });
            });
        };

        Proxmox.Utils.API2Request({
            url: '/nodes/' + me.nodename + '/qemu',
            method: 'GET',
            success: function (r) { collect(r.result.data, 'qemu'); done(); },
            failure: function ()  { done(); },
        });
        Proxmox.Utils.API2Request({
            url: '/nodes/' + me.nodename + '/lxc',
            method: 'GET',
            success: function (r) { collect(r.result.data, 'lxc'); done(); },
            failure: function ()  { done(); },
        });
    },

    _getValues: function () {
        var me = this;
        var combo    = me.down('[name=guestKey]');
        var guestRec = combo.getStore().findRecord('key', combo.getValue());
        return {
            priority: me.down('[name=priority]').getValue(),
            vmid:     guestRec ? guestRec.get('vmid')      : 0,
            type:     guestRec ? guestRec.get('type')      : 'qemu',
            name:     guestRec ? guestRec.get('guestName') : '',
            trigger:  me.down('[name=trigger]').getValue(),
            charge:   me.down('[name=charge]').getValue(),
            runtime:  me.down('[name=runtime_min]').getValue() * 60,
            action:   me.down('[name=action]').getValue(),
            timeout:  me.down('[name=timeout]').getValue(),
        };
    },

    initComponent: function () {
        var me = this;
        me.title = me.editRecord ? gettext('Edit Shutdown Rule') : gettext('Add Shutdown Rule');

        var guestStore = Ext.create('Ext.data.Store', {
            fields: ['key', 'vmid', 'type', 'guestName', 'displayName'],
            data: [],
        });

        me.items = [{
            xtype: 'form',
            bodyPadding: 15,
            border: false,
            labelWidth: 190,
            defaultType: 'combobox',
            defaults: { anchor: '100%', queryMode: 'local', editable: false, triggerAction: 'all' },
            items: [
                {
                    name: 'guestKey',
                    fieldLabel: gettext('VM / CT'),
                    store: guestStore,
                    displayField: 'displayName',
                    valueField: 'key',
                    allowBlank: false,
                    emptyText: gettext('Loading…'),
                },
                {
                    name: 'trigger',
                    fieldLabel: gettext('Trigger Condition'),
                    store: [
                        ['charge',  gettext('Charge below threshold')],
                        ['runtime', gettext('Runtime below threshold')],
                        ['any',     gettext('Either condition')],
                    ],
                    value: 'any',
                },
                {
                    xtype: 'numberfield',
                    name: 'charge',
                    fieldLabel: gettext('Charge Threshold (%)'),
                    value: 20, minValue: 1, maxValue: 99,
                },
                {
                    xtype: 'numberfield',
                    name: 'runtime_min',
                    fieldLabel: gettext('Runtime Threshold (min)'),
                    value: 15, minValue: 1, maxValue: 1440,
                },
                {
                    name: 'action',
                    fieldLabel: gettext('Action'),
                    store: [
                        ['shutdown', gettext('Graceful Shutdown')],
                        ['suspend',  gettext('Suspend to Disk')],
                        ['forceoff', gettext('Force Stop')],
                    ],
                    value: 'shutdown',
                },
                {
                    xtype: 'numberfield',
                    name: 'timeout',
                    fieldLabel: gettext('Shutdown Timeout (sec)'),
                    value: 60, minValue: 10, maxValue: 600,
                },
                {
                    xtype: 'numberfield',
                    name: 'priority',
                    fieldLabel: gettext('Priority'),
                    value: 1, minValue: 1, maxValue: 999,
                },
            ],
        }];

        me.buttons = [
            { text: gettext('Cancel'), handler: function () { me.close(); } },
            {
                text: gettext('Save'),
                handler: function () {
                    if (!me.down('form').isValid()) return;
                    me.fireEvent('saved', me, me._getValues());
                    me.close();
                },
            },
        ];

        me.callParent();

        if (me.editRecord) {
            var r = me.editRecord;
            me.down('[name=trigger]').setValue(r.trigger || 'any');
            me.down('[name=charge]').setValue(r.charge || 20);
            me.down('[name=runtime_min]').setValue(Math.round((r.runtime || 900) / 60));
            me.down('[name=action]').setValue(r.action || 'shutdown');
            me.down('[name=timeout]').setValue(r.timeout || 60);
            me.down('[name=priority]').setValue(r.priority || 1);
        }

        me._loadGuests();
    },
});

// =========================================================================
// PVE.ups.ShutdownRules — 開關機規則分頁
// =========================================================================
Ext.define('PVE.ups.ShutdownRules', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveUpsShutdownRules',

    title: gettext('Shutdown Rules'),
    iconCls: 'fa fa-power-off',
    scrollable: 'y',
    bodyStyle: 'scrollbar-gutter: stable;',
    layout: { type: 'vbox', align: 'stretch' },
    nodename: null,

    _loadData: function () {
        var me = this;
        Proxmox.Utils.API2Request({
            url: '/nodes/' + me.nodename + '/ups/shutdown',
            method: 'GET',
            success: function (response) {
                var data = response.result.data;
                var g    = data.global   || {};
                var rec  = data.recovery || {};

                me.down('[name=charge_threshold]').setValue(g.charge_threshold || 15);
                me.down('[name=runtime_threshold]').setValue(
                    Math.round((g.runtime_threshold || 180) / 60)
                );
                me._rulesStore.loadData(data.rules || []);
                me.down('[name=charge_before_start]').setValue(rec.charge_before_start || 50);
                me.down('[name=interval_seconds]').setValue(rec.interval_seconds || 30);
                me.down('[name=auto_start]').setValue(rec.auto_start !== 0);
            },
        });
    },

    _saveData: function () {
        var me = this;
        var rules = [];
        me._rulesStore.each(function (rec) { rules.push(rec.getData()); });

        Proxmox.Utils.API2Request({
            url: '/nodes/' + me.nodename + '/ups/shutdown',
            method: 'PUT',
            params: {
                charge_threshold:    me.down('[name=charge_threshold]').getValue(),
                runtime_threshold:   me.down('[name=runtime_threshold]').getValue() * 60,
                rules:               JSON.stringify(rules),
                charge_before_start: me.down('[name=charge_before_start]').getValue(),
                interval_seconds:    me.down('[name=interval_seconds]').getValue(),
                auto_start:          me.down('[name=auto_start]').getValue() ? 1 : 0,
            },
            success: function () {
                Ext.toast(gettext('Settings saved.'));
                me._loadData();
            },
            failure: function (response) {
                Ext.Msg.alert(gettext('Error'),
                    ((response.result || {}).message) || gettext('Save failed'));
            },
        });
    },

    _openEditWindow: function (record) {
        var me = this;

        var nextPriority = 1;
        me._rulesStore.each(function (r) {
            if (r.get('priority') >= nextPriority) nextPriority = r.get('priority') + 1;
        });

        var win = Ext.create('PVE.ups.ShutdownRuleEditWindow', {
            nodename:   me.nodename,
            editRecord: record ? record.getData() : null,
        });

        if (!record) {
            win.down('[name=priority]').setValue(nextPriority);
        }

        win.on('saved', function (w, values) {
            if (record) {
                record.set(values);
            } else {
                me._rulesStore.add(values);
            }
            me._rulesStore.sort('priority', 'ASC');
        });

        win.show();
    },

    _fmtTrigger: function (rec) {
        var t = rec.get('trigger');
        var c = rec.get('charge');
        var r = Math.round(rec.get('runtime') / 60);
        if (t === 'charge')  return gettext('Charge') + ' < ' + c + '%';
        if (t === 'runtime') return gettext('Runtime') + ' < ' + r + ' min';
        return gettext('Charge') + ' < ' + c + '% ' + gettext('or') +
               ' ' + gettext('Runtime') + ' < ' + r + ' min';
    },

    initComponent: function () {
        var me = this;

        me._rulesStore = Ext.create('Ext.data.Store', {
            fields: ['priority', 'vmid', 'type', 'name', 'trigger',
                     'charge', 'runtime', 'action', 'timeout'],
            data: [],
            sorters: [{ property: 'priority', direction: 'ASC' }],
        });

        var actionLabels = {
            shutdown: gettext('Shutdown'),
            suspend:  gettext('Suspend'),
            forceoff: gettext('Force Stop'),
        };

        me.items = [
            // ── Row 1：全域條件（左） + 市電恢復策略（右）並排 ──────────
            {
                xtype: 'container',
                layout: { type: 'hbox', align: 'stretch' },
                margin: '8 8 0 8',
                items: [
                    // 左：全域節點關機條件
                    {
                        xtype: 'panel',
                        title: gettext('Global Node Shutdown Condition'),
                        flex: 1,
                        margin: '0 4 0 0',
                        bodyPadding: 12,
                        items: [{
                            xtype: 'form',
                            border: false,
                            labelWidth: 180,
                            items: [
                                {
                                    xtype: 'component',
                                    margin: '0 0 8 0',
                                    html: '<span style="opacity:0.7;font-size:12px">' +
                                          gettext('Shut down this node when battery charge or remaining runtime falls below these thresholds.') +
                                          '</span>',
                                },
                                {
                                    xtype: 'numberfield',
                                    name: 'charge_threshold',
                                    fieldLabel: gettext('Charge Threshold (%)'),
                                    value: 15, minValue: 1, maxValue: 99,
                                    anchor: '100%',
                                },
                                {
                                    xtype: 'numberfield',
                                    name: 'runtime_threshold',
                                    fieldLabel: gettext('Runtime Threshold (min)'),
                                    value: 3, minValue: 1, maxValue: 1440,
                                    anchor: '100%',
                                },
                            ],
                        }],
                    },
                    // 右：市電恢復策略
                    {
                        xtype: 'panel',
                        title: gettext('Recovery Strategy'),
                        flex: 1,
                        margin: '0 0 0 4',
                        bodyPadding: 12,
                        items: [{
                            xtype: 'form',
                            border: false,
                            labelWidth: 180,
                            items: [
                                {
                                    xtype: 'component',
                                    margin: '0 0 8 0',
                                    html: '<span style="opacity:0.7;font-size:12px">' +
                                          gettext('After utility power is restored, automatically restart VMs and CTs in reverse shutdown order.') +
                                          '</span>',
                                },
                                {
                                    xtype: 'numberfield',
                                    name: 'charge_before_start',
                                    fieldLabel: gettext('Charge Before Starting (%)'),
                                    value: 50, minValue: 0, maxValue: 100,
                                    anchor: '100%',
                                },
                                {
                                    xtype: 'numberfield',
                                    name: 'interval_seconds',
                                    fieldLabel: gettext('Interval Between Starts (sec)'),
                                    value: 30, minValue: 0, maxValue: 3600,
                                    anchor: '100%',
                                },
                                {
                                    xtype: 'checkbox',
                                    name: 'auto_start',
                                    fieldLabel: gettext('Auto-start VMs / CTs'),
                                    checked: true,
                                },
                            ],
                        }],
                    },
                ],
            },
            // ── Row 2：VM/CT 關機規則（含提示文字，填滿剩餘高度）──────
            {
                xtype: 'panel',
                title: gettext('VM / CT Shutdown Rules'),
                flex: 1,
                minHeight: 180,
                margin: '8 8 0 8',
                layout: { type: 'vbox', align: 'stretch' },
                tbar: [
                    {
                        xtype: 'button',
                        text: gettext('Add Rule'),
                        iconCls: 'fa fa-plus',
                        handler: function () { me._openEditWindow(null); },
                    },
                    '->',
                    {
                        xtype: 'component',
                        html: '<span class="fa fa-exclamation-triangle" style="color:#ff9800;margin-right:4px"></span>' +
                              '<span style="font-size:12px">' +
                              gettext('Rules only apply to node') + ' <b>' + me.nodename + '</b></span>',
                    },
                ],
                items: [{
                    xtype: 'grid',
                    flex: 1,
                    store: me._rulesStore,
                    columns: [
                        {
                            text: gettext('Priority'),
                            dataIndex: 'priority',
                            width: 70,
                            align: 'center',
                        },
                        {
                            text: gettext('Device'),
                            flex: 1,
                            renderer: function (v, meta, rec) {
                                var prefix = rec.get('type') === 'qemu' ? 'VM' : 'CT';
                                var name   = rec.get('name') || '';
                                return prefix + ' ' + rec.get('vmid') +
                                       (name ? ' — ' + Ext.String.htmlEncode(name) : '');
                            },
                        },
                        {
                            text: gettext('Trigger'),
                            flex: 1,
                            renderer: function (v, meta, rec) {
                                return me._fmtTrigger(rec);
                            },
                        },
                        {
                            text: gettext('Action'),
                            dataIndex: 'action',
                            width: 120,
                            renderer: function (v) {
                                return actionLabels[v] || v;
                            },
                        },
                        {
                            xtype: 'actioncolumn',
                            width: 70,
                            align: 'center',
                            items: [
                                {
                                    iconCls: 'fa fa-pencil',
                                    tooltip: gettext('Edit'),
                                    handler: function (grid, rowIdx) {
                                        me._openEditWindow(me._rulesStore.getAt(rowIdx));
                                    },
                                },
                                {
                                    iconCls: 'fa fa-trash-o',
                                    tooltip: gettext('Delete'),
                                    handler: function (grid, rowIdx) {
                                        me._rulesStore.removeAt(rowIdx);
                                    },
                                },
                            ],
                        },
                    ],
                }],
            },
            // ── Row 3：儲存按鈕 ──────────────────────────────────────────
            {
                xtype: 'container',
                margin: '8 8 8 8',
                layout: { type: 'hbox' },
                items: [{
                    xtype: 'button',
                    text: gettext('Save Settings'),
                    iconCls: 'fa fa-save',
                    handler: function () { me._saveData(); },
                }],
            },
        ];

        me.callParent();
        me.on('activate', function () { me._loadData(); });
    },
});

// =========================================================================
// PVE.ups.NotifyEditWindow — 編輯單一事件通知規則
// =========================================================================
Ext.define('PVE.ups.NotifyEditWindow', {
    extend: 'Ext.window.Window',
    alias: 'widget.pveUpsNotifyEditWindow',

    title: gettext('Edit Notification Rule'),
    modal: true,
    width: 500,
    resizable: false,
    layout: 'fit',

    record: null,
    endpointStore: null,

    initComponent: function () {
        var me = this;
        var rec = me.record;

        var formItems = [
            {
                xtype: 'displayfield',
                fieldLabel: gettext('Event'),
                value: rec.get('label'),
            },
            {
                xtype: 'checkbox',
                name: 'enabled',
                fieldLabel: gettext('Enabled'),
                checked: rec.get('enabled') !== false,
            },
            {
                xtype: 'tagfield',
                name: 'targets',
                fieldLabel: gettext('Targets'),
                anchor: '100%',
                store: me.endpointStore,
                displayField: 'name',
                valueField: 'name',
                value: rec.get('targets') || [],
                queryMode: 'local',
                filterPickList: true,
                triggerAction: 'all',
                emptyText: gettext('No notification targets configured'),
                createNewOnEnter: false,
                createNewOnBlur: false,
            },
        ];

        if (rec.get('hasThreshold')) {
            formItems.push({
                xtype: 'numberfield',
                name: 'threshold',
                fieldLabel: rec.get('event') === 'VOLT_ANOM'
                    ? gettext('Voltage Deviation (%)')
                    : gettext('Load Threshold (%)'),
                anchor: '100%',
                value: rec.get('threshold'),
                minValue: 1,
                maxValue: 100,
            });
        }

        me.items = [{
            xtype: 'form',
            bodyPadding: 15,
            border: false,
            labelWidth: 110,
            items: formItems,
        }];

        me.buttons = [
            {
                text: gettext('Cancel'),
                handler: function () { me.close(); },
            },
            {
                text: gettext('Save'),
                handler: function () {
                    var form = me.down('form');
                    if (!form.isValid()) return;
                    var values = {
                        enabled: form.down('[name=enabled]').getValue(),
                        targets: form.down('[name=targets]').getValue() || [],
                    };
                    if (rec.get('hasThreshold')) {
                        values.threshold = form.down('[name=threshold]').getValue();
                    }
                    me.fireEvent('saved', me, values);
                    me.close();
                },
            },
        ];

        me.callParent();
    },
});

// =========================================================================
// PVE.ups.Notify — 通知分頁
// =========================================================================
Ext.define('PVE.ups.Notify', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveUpsNotify',

    title: gettext('Notifications'),
    iconCls: 'fa fa-bell',
    scrollable: 'y',
    bodyStyle: 'scrollbar-gutter: stable;',
    layout: { type: 'vbox', align: 'stretch' },
    nodename: null,

    _getDefaultRules: function () {
        return [
            { event: 'ONBATT',    label: gettext('On Battery'),        severity: 'warning', enabled: true,  targets: [], hasThreshold: false, threshold: null },
            { event: 'ONLINE',    label: gettext('Power Restored'),     severity: 'info',    enabled: true,  targets: [], hasThreshold: false, threshold: null },
            { event: 'LOWBATT',   label: gettext('Low Battery'),        severity: 'error',   enabled: true,  targets: [], hasThreshold: false, threshold: null },
            { event: 'FSD',       label: gettext('Forced Shutdown'),    severity: 'error',   enabled: true,  targets: [], hasThreshold: false, threshold: null },
            { event: 'COMMBAD',   label: gettext('Communication Lost'), severity: 'warning', enabled: true,  targets: [], hasThreshold: false, threshold: null },
            { event: 'REPLBATT',  label: gettext('Replace Battery'),    severity: 'warning', enabled: true,  targets: [], hasThreshold: false, threshold: null },
            { event: 'OVERLOAD',  label: gettext('Overload'),           severity: 'warning', enabled: false, targets: [], hasThreshold: true,  threshold: 80   },
            { event: 'VOLT_ANOM', label: gettext('Voltage Anomaly'),    severity: 'warning', enabled: false, targets: [], hasThreshold: true,  threshold: 10   },
        ];
    },

    _severityBadge: function (severity) {
        var colors  = { info: '#2196f3', warning: '#ff9800', error: '#f44336' };
        var labels  = {
            info:    gettext('Info'),
            warning: gettext('Warning'),
            error:   gettext('Critical'),
        };
        var color = colors[severity] || '#9e9e9e';
        var label = labels[severity] || severity;
        return '<span style="display:inline-block;padding:2px 8px;border-radius:3px;' +
               'background:' + color + ';color:#fff;font-size:11px">' +
               Ext.String.htmlEncode(label) + '</span>';
    },

    _loadData: function () {
        var me = this;

        Proxmox.Utils.API2Request({
            url: '/cluster/notifications/targets',
            method: 'GET',
            success: function (response) {
                var eps = (response.result.data || []).filter(function (e) { return !e.disable; });
                me._endpointStore.loadData(eps);
            },
            failure: function () { me._endpointStore.loadData([]); },
        });

        Proxmox.Utils.API2Request({
            url: '/nodes/' + me.nodename + '/ups/notify',
            method: 'GET',
            success: function (response) {
                var saved   = response.result.data.rules || [];
                var ruleMap = {};
                saved.forEach(function (r) { ruleMap[r.event] = r; });

                var merged = me._getDefaultRules().map(function (def) {
                    var s = ruleMap[def.event];
                    if (!s) return def;
                    return Object.assign({}, def, {
                        enabled:   s.enabled !== undefined ? !!s.enabled : def.enabled,
                        targets:   s.targets  || [],
                        threshold: s.threshold !== undefined ? s.threshold : def.threshold,
                    });
                });
                me._rulesStore.loadData(merged);
            },
            failure: function () { me._rulesStore.loadData(me._getDefaultRules()); },
        });
    },

    _saveData: function () {
        var me = this;
        var rules = [];
        me._rulesStore.each(function (rec) {
            rules.push({
                event:        rec.get('event'),
                severity:     rec.get('severity'),
                enabled:      rec.get('enabled') ? 1 : 0,
                targets:      rec.get('targets') || [],
                hasThreshold: rec.get('hasThreshold') ? 1 : 0,
                threshold:    rec.get('threshold'),
            });
        });

        Proxmox.Utils.API2Request({
            url: '/nodes/' + me.nodename + '/ups/notify',
            method: 'PUT',
            params: { rules: JSON.stringify(rules) },
            success: function () {
                Ext.toast(gettext('Settings saved.'));
                me._loadData();
            },
            failure: function (response) {
                Ext.Msg.alert(gettext('Error'),
                    ((response.result || {}).message) || gettext('Save failed'));
            },
        });
    },

    _openEditWindow: function (record) {
        var me = this;
        var win = Ext.create('PVE.ups.NotifyEditWindow', {
            record: record,
            endpointStore: me._endpointStore,
        });
        win.on('saved', function (w, values) {
            record.set('enabled',  values.enabled);
            record.set('targets',  values.targets);
            if (record.get('hasThreshold')) {
                record.set('threshold', values.threshold);
            }
        });
        win.show();
    },

    initComponent: function () {
        var me = this;

        me._endpointStore = Ext.create('Ext.data.Store', {
            fields: ['name', 'type', 'comment', 'origin', 'disable'],
            data: [],
        });

        me._rulesStore = Ext.create('Ext.data.Store', {
            fields: [
                'event', 'label', 'severity',
                { name: 'enabled',      type: 'boolean' },
                { name: 'targets',      defaultValue: [] },
                { name: 'hasThreshold', type: 'boolean' },
                { name: 'threshold',    type: 'number'  },
            ],
            data: [],
        });

        me.items = [
            // ── Section 1: PVE 通知目標 ──────────────────────────────────
            {
                xtype: 'panel',
                title: gettext('Notification Targets'),
                iconCls: 'fa fa-paper-plane-o',
                margin: '8 8 0 8',
                items: [{
                    xtype: 'grid',
                    store: me._endpointStore,
                    height: 120,
                    columns: [
                        { text: gettext('Name'),        dataIndex: 'name',    flex: 1 },
                        { text: gettext('Type'),        dataIndex: 'type',    width: 100 },
                        { text: gettext('Description'), dataIndex: 'comment', flex: 2 },
                    ],
                    viewConfig: {
                        emptyText: '<div style="text-align:center;padding:16px;opacity:0.5">' +
                                   gettext('No notification targets configured') + '</div>',
                        deferEmptyText: false,
                    },
                }],
                bbar: [{
                    xtype: 'component',
                    margin: '0 0 0 4',
                    html: '<span class="fa fa-info-circle" style="color:#2196f3;margin-right:4px"></span>' +
                          '<span style="font-size:12px;opacity:0.8">' +
                          gettext('Configured in Datacenter') +
                          ' &rarr; ' + gettext('Notifications') + '</span>',
                }],
            },
            // ── Section 2: 事件通知規則 ──────────────────────────────────
            {
                xtype: 'panel',
                title: gettext('UPS Event Notification Rules'),
                iconCls: 'fa fa-list-ul',
                flex: 1,
                minHeight: 240,
                margin: '8 8 0 8',
                layout: { type: 'vbox', align: 'stretch' },
                items: [{
                    xtype: 'grid',
                    flex: 1,
                    store: me._rulesStore,
                    columns: [
                        {
                            text: gettext('Event'),
                            dataIndex: 'label',
                            flex: 1,
                            minWidth: 140,
                        },
                        {
                            text: gettext('Severity'),
                            dataIndex: 'severity',
                            width: 90,
                            renderer: function (v) { return me._severityBadge(v); },
                        },
                        {
                            xtype: 'checkcolumn',
                            text: gettext('Enabled'),
                            dataIndex: 'enabled',
                            width: 80,
                            stopSelection: false,
                        },
                        {
                            text: gettext('Targets'),
                            dataIndex: 'targets',
                            flex: 2,
                            renderer: function (v) {
                                if (!v || !v.length) {
                                    return '<span style="opacity:0.4">' + gettext('N/A') + '</span>';
                                }
                                return Ext.String.htmlEncode(v.join(', '));
                            },
                        },
                        {
                            text: gettext('Threshold'),
                            dataIndex: 'threshold',
                            width: 90,
                            align: 'center',
                            renderer: function (v, meta, rec) {
                                if (!rec.get('hasThreshold')) return '';
                                return (v !== null && v !== undefined ? v : '—') + '%';
                            },
                        },
                        {
                            xtype: 'actioncolumn',
                            width: 50,
                            align: 'center',
                            items: [{
                                iconCls: 'fa fa-pencil',
                                tooltip: gettext('Edit'),
                                handler: function (grid, rowIdx) {
                                    me._openEditWindow(me._rulesStore.getAt(rowIdx));
                                },
                            }],
                        },
                    ],
                }],
            },
            // ── Section 3: 儲存按鈕 ──────────────────────────────────────
            {
                xtype: 'container',
                margin: '8 8 8 8',
                layout: { type: 'hbox' },
                items: [{
                    xtype: 'button',
                    text: gettext('Save Settings'),
                    iconCls: 'fa fa-save',
                    handler: function () { me._saveData(); },
                }],
            },
        ];

        me.callParent();
        me.on('activate', function () { me._loadData(); });
    },
});

// =========================================================================
// PVE.ups.Log — 記錄分頁
// =========================================================================
Ext.define('PVE.ups.Log', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveUpsLog',

    title: gettext('Logs'),
    iconCls: 'fa fa-list',
    layout: { type: 'fit' },
    bodyStyle: 'scrollbar-gutter: stable;',
    nodename: null,

    // Event badge colours / labels
    _eventMeta: {
        ONBATT:    { color: '#ff9800', icon: 'fa-battery-quarter' },
        ONLINE:    { color: '#4caf50', icon: 'fa-plug'            },
        LOWBATT:   { color: '#f44336', icon: 'fa-battery-empty'   },
        FSD:       { color: '#f44336', icon: 'fa-power-off'       },
        COMMBAD:   { color: '#ff9800', icon: 'fa-chain-broken'    },
        COMMOK:    { color: '#4caf50', icon: 'fa-link'            },
        REPLBATT:  { color: '#ff9800', icon: 'fa-wrench'          },
        OVERLOAD:  { color: '#ff5722', icon: 'fa-exclamation'     },
        SHUTDOWN:  { color: '#f44336', icon: 'fa-power-off'       },
        NOCOMM:    { color: '#ff9800', icon: 'fa-question-circle' },
        VOLT_ANOM: { color: '#ff9800', icon: 'fa-bolt'            },
    },

    _renderEvent: function (event) {
        var me = this;
        var meta = me._eventMeta[event] || { color: '#9e9e9e', icon: 'fa-circle' };
        var label = Ext.String.htmlEncode(event);
        return '<span style="display:inline-flex;align-items:center;gap:5px;">' +
               '<span class="fa ' + meta.icon + '" style="color:' + meta.color + ';width:14px;text-align:center"></span>' +
               '<span style="color:' + meta.color + ';font-weight:500">' + label + '</span>' +
               '</span>';
    },

    _loadData: function () {
        var me = this;
        var grid = me.down('grid');
        if (!grid) { return; }

        grid.setLoading(true);
        Proxmox.Utils.API2Request({
            url: '/nodes/' + me.nodename + '/ups/log',
            method: 'GET',
            params: { limit: 500, start: 0 },
            success: function (response) {
                var result = (response.result || {}).data || {};
                var rows   = result.data  || [];
                var total  = result.total || 0;
                me._store.loadData(rows);
                var status = me.down('#logStatus');
                if (status) {
                    status.setText(total + ' ' + gettext('entries'));
                }
                grid.setLoading(false);
            },
            failure: function () {
                grid.setLoading(false);
            },
        });
    },

    _clearLog: function () {
        var me = this;
        Ext.Msg.confirm(
            gettext('Warning'),
            gettext('Are you sure you want to continue?'),
            function (btn) {
                if (btn !== 'yes') { return; }
                Proxmox.Utils.API2Request({
                    url: '/nodes/' + me.nodename + '/ups/log',
                    method: 'DELETE',
                    success: function () { me._loadData(); },
                    failure: function (response) {
                        Ext.Msg.alert(gettext('Error'),
                            ((response.result || {}).message) || gettext('Unknown error'));
                    },
                });
            }
        );
    },

    initComponent: function () {
        var me = this;

        me._store = Ext.create('Ext.data.Store', {
            fields: ['n', 't', 'ups', 'event'],
            data: [],
        });

        me.items = [{
            xtype: 'grid',
            store: me._store,
            margin: '8 8 8 8',
            emptyText: '<div style="text-align:center;padding:32px;opacity:0.45">' +
                       '<span class="fa fa-list" style="font-size:28px;display:block;margin-bottom:8px"></span>' +
                       gettext('No log entries') + '</div>',
            viewConfig: { deferEmptyText: false, stripeRows: true },
            columns: [
                {
                    text: gettext('Date'),
                    dataIndex: 't',
                    width: 165,
                    renderer: function (v) {
                        return '<span style="font-family:monospace;font-size:12px">' +
                               Ext.String.htmlEncode(v) + '</span>';
                    },
                },
                {
                    text: gettext('UPS'),
                    dataIndex: 'ups',
                    width: 100,
                    renderer: function (v) {
                        return '<span style="font-family:monospace">' +
                               Ext.String.htmlEncode(v) + '</span>';
                    },
                },
                {
                    text: gettext('Event'),
                    dataIndex: 'event',
                    flex: 1,
                    renderer: function (v) { return me._renderEvent(v); },
                },
            ],
            tbar: [
                {
                    xtype: 'button',
                    text: gettext('Refresh'),
                    iconCls: 'fa fa-refresh',
                    handler: function () { me._loadData(); },
                },
                '->',
                {
                    xtype: 'tbtext',
                    itemId: 'logStatus',
                    style: 'opacity:0.6;font-size:12px',
                },
                '-',
                {
                    xtype: 'button',
                    text: gettext('Clear Log'),
                    iconCls: 'fa fa-trash-o',
                    style: 'color:#f44336',
                    handler: function () { me._clearLog(); },
                },
            ],
        }];

        me.callParent();
        me.on('activate', function () { me._loadData(); });
    },
});

// =========================================================================
// PVE.ups.View — 最外層容器（fit layout，TabPanel 永遠可見）
//   無裝置時以 el.mask() + SetupDialog 浮層覆蓋（仿 Ceph 設計）
// =========================================================================
Ext.define('PVE.ups.View', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveUpsView',

    layout: 'fit',
    border: false,
    nodename: null,

    initComponent: function () {
        var me = this;

        me.items = [{
            xtype: 'tabpanel',
            itemId: 'upsTabPanel',
            border: false,
            items: [
                {
                    xtype: 'pveUpsOverview',
                    itemId: 'upsOverview',
                    nodename: me.nodename,
                },
                {
                    xtype: 'pveUpsDevicePanel',
                    itemId: 'upsDevicePanel',
                    nodename: me.nodename,
                },
                {
                    xtype: 'pveUpsHistory',
                    itemId: 'upsHistory',
                    nodename: me.nodename,
                },
                {
                    xtype: 'pveUpsBatteryHealth',
                    itemId: 'upsBatteryHealth',
                    nodename: me.nodename,
                },
                {
                    xtype: 'pveUpsShutdownRules',
                    itemId: 'upsShutdownRules',
                    nodename: me.nodename,
                },
                {
                    xtype: 'pveUpsNotify',
                    itemId: 'upsNotify',
                    nodename: me.nodename,
                },
                {
                    xtype: 'pveUpsLog',
                    itemId: 'upsLog',
                    nodename: me.nodename,
                },
            ],
        }];

        me.callParent();

        // 當 DevicePanel 新增/刪除裝置後，同步更新三個分頁的 DeviceSelector
        var tabPanel = me.down('#upsTabPanel');
        tabPanel.down('#upsDevicePanel').on('deviceschanged', function (panel, names) {
            Ext.Array.each(['upsOverview', 'upsHistory', 'upsBatteryHealth'], function (id) {
                var tab = tabPanel.down('#' + id);
                if (tab) {
                    var sel = tab.down('pveUpsDeviceSelector');
                    if (sel) sel.loadDevices(names);
                }
            });
        });
    },

    afterRender: function () {
        var me = this;
        me.callParent();
        me._checkDevices();
    },

    // 呼叫 API 確認是否有已設定的裝置
    _checkDevices: function () {
        var me = this;

        Proxmox.Utils.API2Request({
            url: '/nodes/' + encodeURIComponent(me.nodename) + '/ups',
            method: 'GET',
            success: function (response) {
                var data = (response.result || {}).data || {};

                if (data._no_devices) {
                    me._showSetupDialog();
                    return;
                }

                me._syncDevices(data);
            },
            failure: function (_response) {
                // NUT 未安裝或無裝置設定 → 顯示設定精靈提示
                me._showSetupDialog();
            },
        });
    },

    // 遮罩容器並彈出 SetupDialog（仿 Ceph install-mask 設計）
    _showSetupDialog: function () {
        var me = this;

        if (me.down('pveUpsSetupDialog')) {
            return; // 已顯示中，避免重複
        }

        me.el.mask();

        var win = Ext.create('PVE.ups.SetupDialog', {});
        me.add(win);
        win.on('close', function () {
            me.el.unmask();
        });
        win.on('startwizard', function () {
            me._startWizard();
        });
        win.show();
    },

    // 同步裝置選單並載入 Overview 資料（有設定裝置時呼叫）
    _syncDevices: function (data) {
        var me = this;

        var devices = [];
        if (Ext.isArray(data._available) && data._available.length > 0) {
            devices = data._available;
        } else if (data._ups_name) {
            devices = [data._ups_name];
        }

        // 同步有 DeviceSelector 的三個分頁
        if (devices.length > 0) {
            var tabPanel = me.down('#upsTabPanel');
            Ext.Array.each(
                ['upsOverview', 'upsHistory', 'upsBatteryHealth'],
                function (itemId) {
                    var tab = tabPanel.down('#' + itemId);
                    if (!tab) return;
                    var sel = tab.down('pveUpsDeviceSelector');
                    if (sel) sel.loadDevices(devices);
                }
            );
        }

        // 傳入 API 資料讓 Overview 直接顯示
        var overview = me.down('pveUpsOverview');
        if (overview) {
            overview.loadData(data);
        }
    },

    // 設定精靈：建立並彈出 PVE.ups.SetupWizard
    _startWizard: function () {
        var me = this;
        var win = Ext.create('PVE.ups.SetupWizard', {
            nodename: me.nodename,
        });
        // 套用成功後關閉 SetupDialog（觸發 unmask）並重新偵測裝置
        win.on('applied', function () {
            var dlg = me.down('pveUpsSetupDialog');
            if (dlg) {
                dlg.close();
            } else {
                me.el.unmask();
            }
            me._checkDevices();
        });
        win.show();
    },
});

// =========================================================================
// 注入到 PVE.node.Config（節點分頁列）
// =========================================================================
function injectUpsTab() {
    if (!window.PVE || !PVE.node || !PVE.node.Config) {
        console.warn('[pve-ups-panel] PVE.node.Config not found; UPS tab not injected.');
        return;
    }
    if (!PVE.panel || !PVE.panel.Config) {
        console.warn('[pve-ups-panel] PVE.panel.Config not found; UPS tab not injected.');
        return;
    }

    // Hook PVE.panel.Config.prototype.insertNodes instead of initComponent.
    //
    // PVE.panel.Config.initComponent calls insertNodes(me.items) and then
    // immediately does root.findChild + menu.setSelection to restore the saved
    // tab. If we add our tab in a monkey-patched initComponent (after calling
    // origInit), the state restoration has already run and missed 'upsView'.
    //
    // By patching insertNodes, our tab is included in the very same call that
    // PVE uses to populate its tree store, so the state restoration finds it
    // on the first try — no second setSelection needed.
    //
    // Guard: hstateid='nodetab' uniquely identifies PVE.node.Config panels.
    // The !savedItems['upsView'] check prevents re-injection on any subsequent
    // insertNodes call (the method is also callable externally).
    var origInsertNodes = PVE.panel.Config.prototype.insertNodes;
    PVE.panel.Config.prototype.insertNodes = function (items) {
        var me = this;
        if (me.hstateid === 'nodetab' && !(me.savedItems && me.savedItems['upsView'])) {
            items = items.concat([{
                xtype: 'pveUpsView',
                title: gettext('UPS'),
                iconCls: 'fa fa-bolt',
                itemId: 'upsView',
                nodename: me.pveSelNode.data.node,
            }]);
        }
        origInsertNodes.call(me, items);
    };
}

if (window.Ext && Ext.isReady) {
    injectUpsTab();
} else {
    Ext.onReady(injectUpsTab);
}

}());
