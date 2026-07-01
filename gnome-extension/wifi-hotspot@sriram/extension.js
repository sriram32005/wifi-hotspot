/* ============================================================================
 * WiFi Hotspot Manager — GNOME Shell Extension
 *
 * Provides a top-bar indicator to control wifi-hotspot.sh:
 *   - View hotspot status, SSID, password, channel, connected devices
 *   - Start/stop hotspot with one click
 *   - Edit SSID & password from the menu
 *   - Auto-refreshes status while menu is open
 *
 * Requires: wifi-hotspot.sh and wifi-hotspot-status.sh in /usr/local/bin
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

// ── Paths ────────────────────────────────────────────────────────────────────
const HOTSPOT_SCRIPT = '/usr/local/bin/wifi-hotspot.sh';
const STATUS_SCRIPT = '/usr/local/bin/wifi-hotspot-status.sh';

// ── Utility: Run a command asynchronously and return stdout ──────────────────
function execCommandAsync(argv) {
    return new Promise((resolve, reject) => {
        try {
            const proc = new Gio.Subprocess({
                argv: argv,
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            proc.init(null);

            proc.communicate_utf8_async(null, null, (proc, res) => {
                try {
                    const [, stdout, stderr] = proc.communicate_utf8_finish(res);
                    const exitStatus = proc.get_exit_status();
                    resolve({stdout: stdout || '', stderr: stderr || '', exitStatus});
                } catch (e) {
                    reject(e);
                }
            });
        } catch (e) {
            reject(e);
        }
    });
}

// ── HotspotIndicator: The panel button + popup menu ─────────────────────────

const HotspotIndicator = GObject.registerClass(
class HotspotIndicator extends PanelMenu.Button {

    _init(extensionObj) {
        super._init(0.0, 'WiFi Hotspot Manager');
        this._extensionObj = extensionObj;
        this._refreshTimeoutId = 0;
        this._passwordVisible = false;
        this._isRunning = false;
        this._isBusy = false;

        // Current status data
        this._status = {
            running: false,
            ssid: '',
            password: '',
            channel: '',
            band: '',
            gateway: '',
            wifiInterface: '',
            wifiSsid: '',
            clientCount: 0,
            clients: [],
            hostapdRunning: false,
            dnsmasqRunning: false,
            internetOk: false,
        };

        // ── Panel icon ──────────────────────────────────────────────────────
        this._icon = new St.Icon({
            icon_name: 'network-wireless-hotspot-symbolic',
            style_class: 'system-status-icon hotspot-icon-inactive',
        });
        this.add_child(this._icon);

        // ── Build menu ──────────────────────────────────────────────────────
        this._buildMenu();

        // ── Connect menu open/close for auto-refresh ────────────────────────
        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen) {
                this._refreshStatus();
                this._startAutoRefresh();
            } else {
                this._stopAutoRefresh();
            }
        });

        // Initial status check
        this._refreshStatus();
    }

    // ── Menu Construction ────────────────────────────────────────────────────

    _buildMenu() {
        // Add custom style class to menu
        this.menu.box.add_style_class_name('hotspot-menu');

        // ── 1. Status Header ────────────────────────────────────────────────
        this._statusItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        this._statusBox = new St.BoxLayout({
            style_class: 'hotspot-status-header',
            vertical: false,
            x_expand: true,
        });
        this._statusDot = new St.Widget({
            style_class: 'hotspot-status-dot hotspot-status-dot-inactive',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._statusLabel = new St.Label({
            text: 'Hotspot: Checking...',
            style_class: 'hotspot-status-text',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._statusBox.add_child(this._statusDot);
        this._statusBox.add_child(this._statusLabel);
        this._statusItem.add_child(this._statusBox);
        this.menu.addMenuItem(this._statusItem);

        // ── Separator ───────────────────────────────────────────────────────
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── 2. Info Section ─────────────────────────────────────────────────
        this._infoSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._infoSection);

        // SSID row
        this._ssidRow = this._createInfoRow('SSID', '', true);
        this._infoSection.addMenuItem(this._ssidRow.item);

        // Password row (with show/hide + copy)
        this._passwordRow = this._createPasswordRow();
        this._infoSection.addMenuItem(this._passwordRow.item);

        // Channel row
        this._channelRow = this._createInfoRow('Channel', '');
        this._infoSection.addMenuItem(this._channelRow.item);

        // Gateway row
        this._gatewayRow = this._createInfoRow('Gateway', '');
        this._infoSection.addMenuItem(this._gatewayRow.item);

        // Internet via row
        this._internetRow = this._createInfoRow('Internet', '');
        this._infoSection.addMenuItem(this._internetRow.item);

        // ── Separator ───────────────────────────────────────────────────────
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── 3. Connected Devices ────────────────────────────────────────────
        this._devicesSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._devicesSection);

        // Devices header
        this._devicesHeaderItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        this._devicesHeaderBox = new St.BoxLayout({
            style_class: 'hotspot-devices-header',
            vertical: false,
            x_expand: true,
        });
        this._devicesIcon = new St.Icon({
            icon_name: 'computer-symbolic',
            icon_size: 16,
            style_class: 'hotspot-device-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._devicesTitle = new St.Label({
            text: 'Connected Devices',
            style_class: 'hotspot-devices-title',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        this._devicesCountBadge = new St.Label({
            text: '0',
            style_class: 'hotspot-devices-count',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._devicesHeaderBox.add_child(this._devicesIcon);
        this._devicesHeaderBox.add_child(this._devicesTitle);
        this._devicesHeaderBox.add_child(this._devicesCountBadge);
        this._devicesHeaderItem.add_child(this._devicesHeaderBox);
        this._devicesSection.addMenuItem(this._devicesHeaderItem);

        // Devices list container
        this._devicesListSection = new PopupMenu.PopupMenuSection();
        this._devicesSection.addMenuItem(this._devicesListSection);

        // ── Separator ───────────────────────────────────────────────────────
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── 4. Settings Section (SSID & Password entry) ─────────────────────
        this._settingsSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._settingsSection);

        // Settings title
        const settingsTitleItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        const settingsTitle = new St.Label({
            text: 'Settings',
            style_class: 'hotspot-settings-title',
        });
        settingsTitleItem.add_child(settingsTitle);
        this._settingsSection.addMenuItem(settingsTitleItem);

        // SSID entry
        this._ssidEntryRow = this._createEntryRow('SSID', 'MyHotspot');
        this._settingsSection.addMenuItem(this._ssidEntryRow.item);

        // Password entry
        this._passwordEntryRow = this._createEntryRow('Password', 'hotspot123');
        this._settingsSection.addMenuItem(this._passwordEntryRow.item);

        // ── Separator ───────────────────────────────────────────────────────
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── 5. Action Buttons ───────────────────────────────────────────────
        this._actionsItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        this._actionsBox = new St.BoxLayout({
            style_class: 'hotspot-actions',
            vertical: true,
            x_expand: true,
        });

        // Start/Stop button
        this._toggleBtn = new St.Button({
            label: 'Start Hotspot',
            style_class: 'hotspot-btn-start',
            x_expand: true,
            can_focus: true,
        });
        this._toggleBtn.connect('clicked', () => this._onToggleClicked());
        this._actionsBox.add_child(this._toggleBtn);

        // Refresh button
        this._refreshBtn = new St.Button({
            can_focus: true,
            x_expand: true,
            style_class: 'hotspot-btn-refresh',
        });
        const refreshBtnBox = new St.BoxLayout({
            x_align: Clutter.ActorAlign.CENTER,
            spacing: 6,
        });
        refreshBtnBox.add_child(new St.Icon({
            icon_name: 'view-refresh-symbolic',
            icon_size: 14,
        }));
        refreshBtnBox.add_child(new St.Label({text: 'Refresh Status'}));
        this._refreshBtn.set_child(refreshBtnBox);
        this._refreshBtn.connect('clicked', () => this._refreshStatus());
        this._actionsBox.add_child(this._refreshBtn);

        this._actionsItem.add_child(this._actionsBox);
        this.menu.addMenuItem(this._actionsItem);
    }

    // ── Info Row Helper ──────────────────────────────────────────────────────

    _createInfoRow(labelText, valueText, copyable = false) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        const box = new St.BoxLayout({
            style_class: 'hotspot-info-row',
            vertical: false,
            x_expand: true,
        });
        const label = new St.Label({
            text: labelText,
            style_class: 'hotspot-info-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const value = new St.Label({
            text: valueText,
            style_class: 'hotspot-info-value-highlight',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        box.add_child(label);
        box.add_child(value);

        if (copyable) {
            const copyBtn = new St.Button({
                style_class: 'hotspot-copy-btn',
                can_focus: true,
                child: new St.Icon({
                    icon_name: 'edit-copy-symbolic',
                    icon_size: 14,
                }),
            });
            copyBtn.connect('clicked', () => {
                const clipboard = St.Clipboard.get_default();
                clipboard.set_text(St.ClipboardType.CLIPBOARD, value.text);
                // Brief visual feedback
                copyBtn.child.icon_name = 'object-select-symbolic';
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                    if (copyBtn.child)
                        copyBtn.child.icon_name = 'edit-copy-symbolic';
                    return GLib.SOURCE_REMOVE;
                });
            });
            box.add_child(copyBtn);
        }

        item.add_child(box);
        return {item, label, value};
    }

    // ── Password Row Helper ──────────────────────────────────────────────────

    _createPasswordRow() {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        const box = new St.BoxLayout({
            style_class: 'hotspot-info-row',
            vertical: false,
            x_expand: true,
        });
        const label = new St.Label({
            text: 'Password',
            style_class: 'hotspot-info-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const value = new St.Label({
            text: '••••••••',
            style_class: 'hotspot-password-value',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });

        // Show/hide toggle
        const toggleBtn = new St.Button({
            style_class: 'hotspot-password-toggle',
            can_focus: true,
            child: new St.Icon({
                icon_name: 'view-reveal-symbolic',
                icon_size: 14,
            }),
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

        // Copy button
        const copyBtn = new St.Button({
            style_class: 'hotspot-copy-btn',
            can_focus: true,
            child: new St.Icon({
                icon_name: 'edit-copy-symbolic',
                icon_size: 14,
            }),
        });
        copyBtn.connect('clicked', () => {
            const clipboard = St.Clipboard.get_default();
            clipboard.set_text(St.ClipboardType.CLIPBOARD, this._status.password || '');
            copyBtn.child.icon_name = 'object-select-symbolic';
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                if (copyBtn.child)
                    copyBtn.child.icon_name = 'edit-copy-symbolic';
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

    // ── Entry Row Helper ─────────────────────────────────────────────────────

    _createEntryRow(labelText, defaultValue) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        const box = new St.BoxLayout({
            style_class: 'hotspot-entry-row',
            vertical: false,
            x_expand: true,
        });
        const label = new St.Label({
            text: labelText,
            style_class: 'hotspot-entry-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const entry = new St.Entry({
            text: defaultValue,
            hint_text: `Enter ${labelText}...`,
            style_class: 'hotspot-entry',
            can_focus: true,
            x_expand: true,
        });
        box.add_child(label);
        box.add_child(entry);
        item.add_child(box);
        return {item, label, entry};
    }

    // ── Status Refresh ───────────────────────────────────────────────────────

    async _refreshStatus() {
        try {
            const result = await execCommandAsync([
                'pkexec', STATUS_SCRIPT,
            ]);

            if (result.exitStatus === 0 && result.stdout.trim()) {
                const data = JSON.parse(result.stdout.trim());
                this._status = {
                    running: data.running || false,
                    ssid: data.ssid || '',
                    password: data.password || '',
                    channel: data.channel || '',
                    band: data.band || '',
                    gateway: data.gateway || '',
                    wifiInterface: data.wifi_interface || '',
                    wifiSsid: data.wifi_ssid || '',
                    clientCount: data.client_count || 0,
                    clients: data.clients || [],
                    hostapdRunning: data.hostapd_running || false,
                    dnsmasqRunning: data.dnsmasq_running || false,
                    internetOk: data.internet_ok || false,
                };
            } else {
                this._status.running = false;
            }
        } catch (e) {
            log(`[WiFi Hotspot] Status check error: ${e.message}`);
            this._status.running = false;
        }

        this._updateUI();
    }

    // ── UI Update ────────────────────────────────────────────────────────────

    _updateUI() {
        const s = this._status;

        // Panel icon
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

        // Info section — show/hide based on running state
        if (s.running) {
            this._ssidRow.value.text = s.ssid || '—';
            if (this._passwordVisible)
                this._passwordRow.value.text = s.password || '—';
            else
                this._passwordRow.value.text = '••••••••';

            this._channelRow.value.text = s.channel && s.band
                ? `${s.channel} (${s.band})`
                : s.channel || '—';
            this._gatewayRow.value.text = s.gateway || '—';
            this._internetRow.value.text = s.wifiSsid
                ? `via ${s.wifiInterface} → ${s.wifiSsid}`
                : '—';

            this._infoSection.actor.show();
        } else {
            this._infoSection.actor.hide();
        }

        // Connected devices
        if (s.running) {
            this._devicesCountBadge.text = String(s.clientCount);

            // Clear old device list
            this._devicesListSection.removeAll();

            if (s.clientCount > 0 && s.clients.length > 0) {
                for (const client of s.clients) {
                    const deviceItem = new PopupMenu.PopupBaseMenuItem({
                        reactive: false,
                        can_focus: false,
                    });
                    const deviceBox = new St.BoxLayout({
                        style_class: 'hotspot-device-row',
                        vertical: false,
                        x_expand: true,
                    });
                    deviceBox.add_child(new St.Icon({
                        icon_name: 'computer-symbolic',
                        icon_size: 14,
                        style_class: 'hotspot-device-icon',
                        y_align: Clutter.ActorAlign.CENTER,
                    }));
                    deviceBox.add_child(new St.Label({
                        text: client.mac || client,
                        style_class: 'hotspot-device-mac',
                        y_align: Clutter.ActorAlign.CENTER,
                        x_expand: true,
                    }));
                    if (client.signal) {
                        deviceBox.add_child(new St.Label({
                            text: `${client.signal} dBm`,
                            style_class: 'hotspot-device-mac',
                            y_align: Clutter.ActorAlign.CENTER,
                        }));
                    }
                    deviceItem.add_child(deviceBox);
                    this._devicesListSection.addMenuItem(deviceItem);
                }
            } else {
                const noDevicesItem = new PopupMenu.PopupBaseMenuItem({
                    reactive: false,
                    can_focus: false,
                });
                noDevicesItem.add_child(new St.Label({
                    text: 'No devices connected',
                    style_class: 'hotspot-no-devices',
                }));
                this._devicesListSection.addMenuItem(noDevicesItem);
            }

            this._devicesSection.actor.show();
        } else {
            this._devicesListSection.removeAll();
            this._devicesCountBadge.text = '0';
            this._devicesSection.actor.hide();
        }

        // Settings — update entry defaults from status if hotspot is running
        if (s.running && s.ssid) {
            this._ssidEntryRow.entry.text = s.ssid;
        }
        if (s.running && s.password) {
            this._passwordEntryRow.entry.text = s.password;
        }

        // Toggle button
        if (this._isBusy) {
            this._toggleBtn.label = 'Please wait...';
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

    // ── Toggle Start/Stop ────────────────────────────────────────────────────

    async _onToggleClicked() {
        if (this._isBusy) return;

        this._isBusy = true;
        this._updateUI();

        try {
            if (this._status.running) {
                // Stop hotspot
                await execCommandAsync([
                    'pkexec', HOTSPOT_SCRIPT, 'stop',
                ]);
            } else {
                // Start hotspot with custom SSID/password
                const ssid = this._ssidEntryRow.entry.text.trim() || 'MyHotspot';
                const password = this._passwordEntryRow.entry.text.trim() || 'hotspot123';

                if (password.length < 8) {
                    Main.notify('WiFi Hotspot', 'Password must be at least 8 characters');
                    this._isBusy = false;
                    this._updateUI();
                    return;
                }

                await execCommandAsync([
                    'pkexec', HOTSPOT_SCRIPT, 'start', ssid, password,
                ]);
            }

            // Wait a moment for processes to settle
            await new Promise(resolve => {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                    resolve();
                    return GLib.SOURCE_REMOVE;
                });
            });

            await this._refreshStatus();
        } catch (e) {
            log(`[WiFi Hotspot] Toggle error: ${e.message}`);
            Main.notify('WiFi Hotspot', `Error: ${e.message}`);
        } finally {
            this._isBusy = false;
            this._updateUI();
        }
    }

    // ── Auto-Refresh Timer ───────────────────────────────────────────────────

    _startAutoRefresh() {
        this._stopAutoRefresh();
        this._refreshTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            5,
            () => {
                this._refreshStatus();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _stopAutoRefresh() {
        if (this._refreshTimeoutId > 0) {
            GLib.Source.remove(this._refreshTimeoutId);
            this._refreshTimeoutId = 0;
        }
    }

    // ── Cleanup ──────────────────────────────────────────────────────────────

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
