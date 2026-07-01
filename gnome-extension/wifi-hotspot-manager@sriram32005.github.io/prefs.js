/* ============================================================================
 * WiFi Hotspot Manager — Preferences Window
 * ============================================================================ */

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import {ExtensionPreferences, gettext as _} from
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// ── Helper GObject for ComboRow model ────────────────────────────────────────

const BandItem = GObject.registerClass({
    Properties: {
        'value': GObject.ParamSpec.string('value', '', '', GObject.ParamFlags.READWRITE, ''),
        'display': GObject.ParamSpec.string('display', '', '', GObject.ParamFlags.READWRITE, ''),
    },
}, class BandItem extends GObject.Object {
    constructor(value, display) {
        super();
        this._value = value;
        this._display = display;
    }

    get value() { return this._value; }
    get display() { return this._display; }
});

// ── Preferences ──────────────────────────────────────────────────────────────

export default class WifiHotspotPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        // ── Hotspot Defaults ─────────────────────────────────────────────
        const defaultsGroup = new Adw.PreferencesGroup({
            title: _('Hotspot Defaults'),
            description: _('Default values used when creating a new hotspot'),
        });
        page.add(defaultsGroup);

        const ssidRow = new Adw.EntryRow({title: _('Default SSID')});
        settings.bind('default-ssid', ssidRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        defaultsGroup.add(ssidRow);

        const passwordRow = new Adw.PasswordEntryRow({title: _('Default Password')});
        settings.bind('default-password', passwordRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        defaultsGroup.add(passwordRow);

        // Band ComboRow
        const bandRow = new Adw.ComboRow({
            title: _('WiFi Band'),
            subtitle: _('Frequency band for the hotspot'),
        });
        const bandModel = new Gio.ListStore({item_type: BandItem});
        bandModel.append(new BandItem('bg', '2.4 GHz'));
        bandModel.append(new BandItem('a', '5 GHz'));
        bandModel.append(new BandItem('auto', 'Auto'));
        bandRow.set_model(bandModel);
        bandRow.set_expression(new Gtk.PropertyExpression(BandItem, null, 'display'));

        const currentBand = settings.get_string('wifi-band');
        for (let i = 0; i < bandModel.get_n_items(); i++) {
            if (bandModel.get_item(i).value === currentBand) {
                bandRow.set_selected(i);
                break;
            }
        }
        bandRow.connect('notify::selected', () => {
            const item = bandModel.get_item(bandRow.selected);
            if (item) settings.set_string('wifi-band', item.value);
        });
        defaultsGroup.add(bandRow);

        // ── Advanced ─────────────────────────────────────────────────────
        const advancedGroup = new Adw.PreferencesGroup({
            title: _('Advanced'),
            description: _('Network and interface settings'),
        });
        page.add(advancedGroup);

        const ifaceRow = new Adw.EntryRow({
            title: _('WiFi Interface'),
            text: settings.get_string('wifi-interface'),
        });
        ifaceRow.connect('changed', () => settings.set_string('wifi-interface', ifaceRow.text));
        advancedGroup.add(ifaceRow);

        const connRow = new Adw.EntryRow({title: _('Connection Name')});
        settings.bind('connection-name', connRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        advancedGroup.add(connRow);

        const refreshAdj = new Gtk.Adjustment({
            lower: 2, upper: 30, step_increment: 1,
            value: settings.get_int('refresh-interval'),
        });
        const refreshRow = new Adw.SpinRow({
            title: _('Refresh Interval (seconds)'),
            subtitle: _('How often to refresh status when menu is open'),
            adjustment: refreshAdj,
        });
        settings.bind('refresh-interval', refreshAdj, 'value', Gio.SettingsBindFlags.DEFAULT);
        advancedGroup.add(refreshRow);
    }
}
