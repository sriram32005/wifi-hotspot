/* ============================================================================
 * WiFi Hotspot Manager — GNOME Shell Extension
 *
 * Uses NetworkManager (nmcli) to manage hotspots — no root required.
 * ============================================================================ */

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// ── Utility: Run a command asynchronously and return stdout ──────────────────
function execCommandAsync(argv) {
    return new Promise((resolve, reject) => {
        try {
            const proc = new Gio.Subprocess({
                argv,
                flags: Gio.SubprocessFlags.STDOUT_PIPE |
                       Gio.SubprocessFlags.STDERR_PIPE,
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (_proc, res) => {
                try {
                    const [, stdout, stderr] = _proc.communicate_utf8_finish(res);
                    resolve({
                        stdout: stdout || '',
                        stderr: stderr || '',
                        exitStatus: _proc.get_exit_status(),
                    });
                } catch (e) {
                    reject(e);
                }
            });
        } catch (e) {
            reject(e);
        }
    });
}

// ── HotspotIndicator ────────────────────────────────────────────────────────

const HotspotIndicator = GObject.registerClass(
class HotspotIndicator extends PanelMenu.Button {

    _init(extensionObj) {
        super._init(0.0, 'WiFi Hotspot Manager');
        this._ext = extensionObj;
        this._settings = extensionObj.getSettings();
        this._refreshTimeoutId = 0;
        this._passwordVisible = false;
        this._isBusy = false;

        this._status = {
            running: false,
            ssid: '',
            password: '',
            band: '',
            channel: '',
            device: '',
            gateway: '',
            clientCount: 0,
            clients: [],
            connName: '',
        };

        // Panel icon
        this._icon = new St.Icon({
            icon_name: 'network-wireless-hotspot-symbolic',
            style_class: 'system-status-icon hotspot-icon-inactive',
        });
        this.add_child(this._icon);

        this._buildMenu();

        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen) {
                this._refreshStatus();
                this._startAutoRefresh();
            } else {
                this._stopAutoRefresh();
            }
        });

        // Initial check
        this._refreshStatus();
    }

    // ── Menu Construction ────────────────────────────────────────────────

    _buildMenu() {
        this.menu.box.add_style_class_name('hotspot-menu');

        // 1. Status Header
        this._statusItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._statusBox = new St.BoxLayout({style_class: 'hotspot-status-header', x_expand: true});
        this._statusDot = new St.Widget({
            style_class: 'hotspot-status-dot hotspot-status-dot-inactive',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._statusLabel = new St.Label({
            text: 'Hotspot: Checking…',
            style_class: 'hotspot-status-text',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._statusBox.add_child(this._statusDot);
        this._statusBox.add_child(this._statusLabel);
        this._statusItem.add_child(this._statusBox);
        this.menu.addMenuItem(this._statusItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 2. Info Section
        this._infoSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._infoSection);

        this._ssidRow = this._createInfoRow('SSID', '—', true);
        this._infoSection.addMenuItem(this._ssidRow.item);

        this._passwordRow = this._createPasswordRow();
        this._infoSection.addMenuItem(this._passwordRow.item);

        this._bandRow = this._createInfoRow('Band', '—');
        this._infoSection.addMenuItem(this._bandRow.item);

        this._deviceRow = this._createInfoRow('Interface', '—');
        this._infoSection.addMenuItem(this._deviceRow.item);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 3. Connected Devices
        this._devicesSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._devicesSection);

        this._devicesHeaderItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._devicesHeaderBox = new St.BoxLayout({style_class: 'hotspot-devices-header', x_expand: true});
        this._devicesHeaderBox.add_child(new St.Icon({
            icon_name: 'computer-symbolic', icon_size: 16,
            style_class: 'hotspot-device-icon', y_align: Clutter.ActorAlign.CENTER,
        }));
        this._devicesTitle = new St.Label({
            text: 'Connected Devices', style_class: 'hotspot-devices-title',
            y_align: Clutter.ActorAlign.CENTER, x_expand: true,
        });
        this._devicesCountBadge = new St.Label({
            text: '0', style_class: 'hotspot-devices-count',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._devicesHeaderBox.add_child(this._devicesTitle);
        this._devicesHeaderBox.add_child(this._devicesCountBadge);
        this._devicesHeaderItem.add_child(this._devicesHeaderBox);
        this._devicesSection.addMenuItem(this._devicesHeaderItem);

        this._devicesListSection = new PopupMenu.PopupMenuSection();
        this._devicesSection.addMenuItem(this._devicesListSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 4. Settings Section
        this._settingsSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._settingsSection);

        const settingsTitleItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        settingsTitleItem.add_child(new St.Label({text: 'Settings', style_class: 'hotspot-settings-title'}));
        this._settingsSection.addMenuItem(settingsTitleItem);

        this._ssidEntryRow = this._createEntryRow('SSID', this._settings.get_string('default-ssid'));
        this._settingsSection.addMenuItem(this._ssidEntryRow.item);

        this._passwordEntryRow = this._createEntryRow('Password', this._settings.get_string('default-password'));
        this._settingsSection.addMenuItem(this._passwordEntryRow.item);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 5. Action Buttons
        this._actionsItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._actionsBox = new St.BoxLayout({style_class: 'hotspot-actions', vertical: true, x_expand: true});

        this._toggleBtn = new St.Button({
            label: 'Start Hotspot', style_class: 'hotspot-btn-start',
            x_expand: true, can_focus: true,
        });
        this._toggleBtn.connect('clicked', () => this._onToggleClicked());
        this._actionsBox.add_child(this._toggleBtn);

        this._refreshBtn = new St.Button({can_focus: true, x_expand: true, style_class: 'hotspot-btn-refresh'});
        const refreshBtnBox = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER, spacing: 6});
        refreshBtnBox.add_child(new St.Icon({icon_name: 'view-refresh-symbolic', icon_size: 14}));
        refreshBtnBox.add_child(new St.Label({text: 'Refresh Status'}));
        this._refreshBtn.set_child(refreshBtnBox);
        this._refreshBtn.connect('clicked', () => this._refreshStatus());
        this._actionsBox.add_child(this._refreshBtn);

        this._actionsItem.add_child(this._actionsBox);
        this.menu.addMenuItem(this._actionsItem);
    }

    // ── Info Row ─────────────────────────────────────────────────────────

    _createInfoRow(labelText, valueText, copyable = false) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const box = new St.BoxLayout({style_class: 'hotspot-info-row', x_expand: true});
        const label = new St.Label({
            text: labelText, style_class: 'hotspot-info-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const value = new St.Label({
            text: valueText, style_class: 'hotspot-info-value-highlight',
            y_align: Clutter.ActorAlign.CENTER, x_expand: true,
        });
        box.add_child(label);
        box.add_child(value);

        if (copyable) {
            const copyBtn = new St.Button({
                style_class: 'hotspot-copy-btn', can_focus: true,
                child: new St.Icon({icon_name: 'edit-copy-symbolic', icon_size: 14}),
            });
            copyBtn.connect('clicked', () => {
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, value.text);
                copyBtn.child.icon_name = 'object-select-symbolic';
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                    if (copyBtn.child) copyBtn.child.icon_name = 'edit-copy-symbolic';
                    return GLib.SOURCE_REMOVE;
                });
            });
            box.add_child(copyBtn);
        }

        item.add_child(box);
        return {item, label, value};
    }

    // ── Password Row ─────────────────────────────────────────────────────

    _createPasswordRow() {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const box = new St.BoxLayout({style_class: 'hotspot-info-row', x_expand: true});
        const label = new St.Label({
            text: 'Password', style_class: 'hotspot-info-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const value = new St.Label({
            text: '••••••••', style_class: 'hotspot-password-value',
            y_align: Clutter.ActorAlign.CENTER, x_expand: true,
        });

        const toggleBtn = new St.Button({
            style_class: 'hotspot-password-toggle', can_focus: true,
            child: new St.Icon({icon_name: 'view-reveal-symbolic', icon_size: 14}),
        });
        toggleBtn.connect('clicked', () => {
            this._passwordVisible = !this._passwordVisible;
            if (this._passwordVisible) {
                value.text = this._status.password || '—';
                toggleBtn.child.icon_name = 'view-conceal-symbolic';
            } else {
                value.text = '••••••••';
                toggleBtn.child.icon_name = 'view-reveal-symbolic';
            }
        });

        const copyBtn = new St.Button({
            style_class: 'hotspot-copy-btn', can_focus: true,
            child: new St.Icon({icon_name: 'edit-copy-symbolic', icon_size: 14}),
        });
        copyBtn.connect('clicked', () => {
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, this._status.password || '');
            copyBtn.child.icon_name = 'object-select-symbolic';
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                if (copyBtn.child) copyBtn.child.icon_name = 'edit-copy-symbolic';
                return GLib.SOURCE_REMOVE;
            });
        });

        box.add_child(label);
        box.add_child(value);
        box.add_child(toggleBtn);
        box.add_child(copyBtn);
        item.add_child(box);
        return {item, label, value, toggleBtn};
    }

    // ── Entry Row ────────────────────────────────────────────────────────

    _createEntryRow(labelText, defaultValue) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const box = new St.BoxLayout({style_class: 'hotspot-entry-row', x_expand: true});
        const label = new St.Label({
            text: labelText, style_class: 'hotspot-entry-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const entry = new St.Entry({
            text: defaultValue, hint_text: `Enter ${labelText}…`,
            style_class: 'hotspot-entry', can_focus: true, x_expand: true,
        });
        box.add_child(label);
        box.add_child(entry);
        item.add_child(box);
        return {item, label, entry};
    }

    // ── Detect WiFi interface ────────────────────────────────────────────

    async _detectWifiInterface() {
        const iface = this._settings.get_string('wifi-interface');
        if (iface) return iface;

        try {
            const r = await execCommandAsync([
                'nmcli', '-t', '-f', 'DEVICE,TYPE,STATE', 'device',
            ]);
            if (r.exitStatus === 0) {
                for (const line of r.stdout.trim().split('\n')) {
                    const [dev, type, state] = line.split(':');
                    if (type === 'wifi' && (state === 'connected' || state === 'disconnected'))
                        return dev;
                }
            }
        } catch (_e) { /* fall through */ }
        return 'wlan0';
    }

    // ── Status Refresh ───────────────────────────────────────────────────

    async _refreshStatus() {
        const connName = this._settings.get_string('connection-name');

        try {
            // Check if the hotspot connection is active
            const activeResult = await execCommandAsync([
                'nmcli', '-t', '-f', 'NAME,TYPE,DEVICE', 'connection', 'show', '--active',
            ]);

            let hotspotActive = false;
            let hotspotDevice = '';

            if (activeResult.exitStatus === 0) {
                for (const line of activeResult.stdout.trim().split('\n')) {
                    const parts = line.split(':');
                    if (parts[0] === connName && parts[1] === '802-11-wireless') {
                        hotspotActive = true;
                        hotspotDevice = parts[2] || '';
                        break;
                    }
                }
            }

            if (hotspotActive) {
                // Get connection details
                const detailResult = await execCommandAsync([
                    'nmcli', '-t', '-f',
                    '802-11-wireless.ssid,802-11-wireless.band,802-11-wireless.channel,802-11-wireless-security.psk,IP4.ADDRESS',
                    'connection', 'show', connName,
                ]);

                let ssid = '', band = '', channel = '', password = '', gateway = '';

                if (detailResult.exitStatus === 0) {
                    for (const line of detailResult.stdout.trim().split('\n')) {
                        const idx = line.indexOf(':');
                        if (idx === -1) continue;
                        const key = line.substring(0, idx);
                        const val = line.substring(idx + 1);
                        if (key === '802-11-wireless.ssid') ssid = val;
                        else if (key === '802-11-wireless.band') band = val === 'a' ? '5 GHz' : val === 'bg' ? '2.4 GHz' : val || 'Auto';
                        else if (key === '802-11-wireless.channel') channel = val;
                        else if (key === '802-11-wireless-security.psk') password = val;
                        else if (key.startsWith('IP4.ADDRESS')) gateway = val.split('/')[0] || '';
                    }
                }

                // Get connected clients via iw (does not need root for station dump on own interface)
                let clients = [];
                if (hotspotDevice) {
                    try {
                        const stationResult = await execCommandAsync([
                            'iw', 'dev', hotspotDevice, 'station', 'dump',
                        ]);
                        if (stationResult.exitStatus === 0 && stationResult.stdout.trim()) {
                            const stationLines = stationResult.stdout.trim().split('\n');
                            let currentMac = '';
                            let currentSignal = '';
                            for (const sl of stationLines) {
                                const macMatch = sl.match(/Station\s+([0-9a-f:]+)/i);
                                if (macMatch) {
                                    if (currentMac) clients.push({mac: currentMac, signal: currentSignal});
                                    currentMac = macMatch[1];
                                    currentSignal = '';
                                }
                                const sigMatch = sl.match(/signal:\s*(-?\d+)/);
                                if (sigMatch) currentSignal = sigMatch[1];
                            }
                            if (currentMac) clients.push({mac: currentMac, signal: currentSignal});
                        }
                    } catch (_e) { /* iw may not be available */ }
                }

                this._status = {
                    running: true, ssid, password, band, channel,
                    device: hotspotDevice, gateway,
                    clientCount: clients.length, clients, connName,
                };
            } else {
                this._status.running = false;
                this._status.clientCount = 0;
                this._status.clients = [];
            }
        } catch (e) {
            console.error(`[WiFi Hotspot] Status error: ${e.message}`);
            this._status.running = false;
        }

        this._updateUI();
    }

    // ── UI Update ────────────────────────────────────────────────────────

    _updateUI() {
        const s = this._status;

        // Panel icon style
        if (s.running) {
            this._icon.remove_style_class_name('hotspot-icon-inactive');
            this._icon.add_style_class_name('hotspot-icon-active');
        } else {
            this._icon.remove_style_class_name('hotspot-icon-active');
            this._icon.add_style_class_name('hotspot-icon-inactive');
        }

        // Status header
        if (s.running) {
            this._statusDot.remove_style_class_name('hotspot-status-dot-inactive');
            this._statusDot.add_style_class_name('hotspot-status-dot-active');
            this._statusLabel.text = 'Hotspot: Active';
            this._statusLabel.remove_style_class_name('hotspot-status-text-inactive');
            this._statusLabel.add_style_class_name('hotspot-status-text-active');
        } else {
            this._statusDot.remove_style_class_name('hotspot-status-dot-active');
            this._statusDot.add_style_class_name('hotspot-status-dot-inactive');
            this._statusLabel.text = 'Hotspot: Inactive';
            this._statusLabel.remove_style_class_name('hotspot-status-text-active');
            this._statusLabel.add_style_class_name('hotspot-status-text-inactive');
        }

        // Info section
        if (s.running) {
            this._ssidRow.value.text = s.ssid || '—';
            this._passwordRow.value.text = this._passwordVisible ? (s.password || '—') : '••••••••';
            this._bandRow.value.text = s.channel ? `${s.band} / Ch ${s.channel}` : s.band || '—';
            this._deviceRow.value.text = s.device || '—';
            this._infoSection.actor.show();
        } else {
            this._infoSection.actor.hide();
        }

        // Connected devices
        if (s.running) {
            this._devicesCountBadge.text = String(s.clientCount);
            this._devicesListSection.removeAll();

            if (s.clientCount > 0) {
                for (const client of s.clients) {
                    const di = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
                    const db = new St.BoxLayout({style_class: 'hotspot-device-row', x_expand: true});
                    db.add_child(new St.Icon({
                        icon_name: 'computer-symbolic', icon_size: 14,
                        style_class: 'hotspot-device-icon', y_align: Clutter.ActorAlign.CENTER,
                    }));
                    db.add_child(new St.Label({
                        text: client.mac, style_class: 'hotspot-device-mac',
                        y_align: Clutter.ActorAlign.CENTER, x_expand: true,
                    }));
                    if (client.signal) {
                        db.add_child(new St.Label({
                            text: `${client.signal} dBm`, style_class: 'hotspot-device-mac',
                            y_align: Clutter.ActorAlign.CENTER,
                        }));
                    }
                    di.add_child(db);
                    this._devicesListSection.addMenuItem(di);
                }
            } else {
                const ndi = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
                ndi.add_child(new St.Label({text: 'No devices connected', style_class: 'hotspot-no-devices'}));
                this._devicesListSection.addMenuItem(ndi);
            }
            this._devicesSection.actor.show();
        } else {
            this._devicesListSection.removeAll();
            this._devicesCountBadge.text = '0';
            this._devicesSection.actor.hide();
        }

        // Fill entries from running hotspot
        if (s.running && s.ssid) this._ssidEntryRow.entry.text = s.ssid;
        if (s.running && s.password) this._passwordEntryRow.entry.text = s.password;

        // Toggle button
        if (this._isBusy) {
            this._toggleBtn.label = 'Please wait…';
            this._toggleBtn.reactive = false;
            this._toggleBtn.style_class = 'hotspot-btn-refresh';
        } else if (s.running) {
            this._toggleBtn.label = '⏹  Stop Hotspot';
            this._toggleBtn.style_class = 'hotspot-btn-stop';
            this._toggleBtn.reactive = true;
        } else {
            this._toggleBtn.label = '▶  Start Hotspot';
            this._toggleBtn.style_class = 'hotspot-btn-start';
            this._toggleBtn.reactive = true;
        }
    }

    // ── Toggle Start/Stop ────────────────────────────────────────────────

    async _onToggleClicked() {
        if (this._isBusy) return;
        this._isBusy = true;
        this._updateUI();

        try {
            if (this._status.running) {
                // Stop
                const connName = this._settings.get_string('connection-name');
                await execCommandAsync(['nmcli', 'connection', 'down', connName]);
            } else {
                // Start
                const ssid = this._ssidEntryRow.entry.text.trim() || this._settings.get_string('default-ssid');
                const password = this._passwordEntryRow.entry.text.trim() || this._settings.get_string('default-password');

                if (password.length < 8) {
                    Main.notify('WiFi Hotspot', 'Password must be at least 8 characters');
                    this._isBusy = false;
                    this._updateUI();
                    return;
                }

                const iface = await this._detectWifiInterface();
                const band = this._settings.get_string('wifi-band');
                const connName = this._settings.get_string('connection-name');

                const args = [
                    'nmcli', 'device', 'wifi', 'hotspot',
                    'ifname', iface,
                    'con-name', connName,
                    'ssid', ssid,
                    'password', password,
                ];
                if (band && band !== 'auto') args.push('band', band);

                const result = await execCommandAsync(args);
                if (result.exitStatus !== 0) {
                    const errMsg = result.stderr.trim() || result.stdout.trim() || 'Unknown error';
                    Main.notify('WiFi Hotspot', `Failed to start: ${errMsg}`);
                }
            }

            // Wait for NM to settle
            await new Promise(resolve => {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                    resolve();
                    return GLib.SOURCE_REMOVE;
                });
            });

            await this._refreshStatus();
        } catch (e) {
            console.error(`[WiFi Hotspot] Toggle error: ${e.message}`);
            Main.notify('WiFi Hotspot', `Error: ${e.message}`);
        } finally {
            this._isBusy = false;
            this._updateUI();
        }
    }

    // ── Auto-Refresh ─────────────────────────────────────────────────────

    _startAutoRefresh() {
        this._stopAutoRefresh();
        const interval = this._settings.get_int('refresh-interval');
        this._refreshTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, interval,
            () => { this._refreshStatus(); return GLib.SOURCE_CONTINUE; }
        );
    }

    _stopAutoRefresh() {
        if (this._refreshTimeoutId > 0) {
            GLib.Source.remove(this._refreshTimeoutId);
            this._refreshTimeoutId = 0;
        }
    }

    destroy() {
        this._stopAutoRefresh();
        super.destroy();
    }
});

// ── Extension Entry Point ────────────────────────────────────────────────────

export default class WifiHotspotExtension extends Extension {
    enable() {
        this._indicator = new HotspotIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
