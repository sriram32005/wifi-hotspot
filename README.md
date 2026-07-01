# 📡 WiFi Hotspot Manager

> **Run a WiFi hotspot and stay connected to the internet — simultaneously — from your GNOME top bar.**

A WiFi hotspot manager for Linux with both a **CLI tool** and a **GNOME Shell extension**. Create a hotspot from your laptop's WiFi connection with one click, view connected devices, edit settings — all without opening a terminal.

Designed for the **Intel AX201** (`iwlwifi`), but works with any card supporting concurrent `managed` + `AP` interfaces.

---

## ✨ Features

### GNOME Shell Extension (GUI)
- **Top bar hotspot icon** — instantly see if your hotspot is active (green) or inactive (grey)
- **One-click start/stop** — start or stop the hotspot right from the dropdown menu
- **Live status** — view SSID, password, channel, band, gateway, and connected WiFi network
- **Password management** — show/hide password with toggle, copy to clipboard
- **Connected devices** — real-time count and list with MAC addresses and signal strength
- **Editable settings** — change SSID and password from the menu before starting
- **Auto-refresh** — status updates every 5 seconds while the menu is open
- **Seamless auth** — passwordless operation via Polkit for `wheel` group users

### CLI Tool
- **Simultaneous WiFi + Hotspot** — share your laptop's WiFi without an ethernet cable
- **Auto-channel matching** — locks the hotspot to your WiFi's channel (required by Intel AX201 firmware)
- **NetworkManager-safe** — automatically prevents NM from interfering with the AP interface
- **Robust cleanup** — multi-step interface teardown with retries
- **NAT + DHCP** — full internet sharing with automatic IP assignment
- **WPA2 security** — password-protected with WPA2-PSK/CCMP

---

## 📋 Prerequisites

### Hardware

Your wireless card must support **concurrent `managed` + `AP` mode**:

```bash
iw phy phy0 info | grep -A 6 "valid interface combinations"
```

Look for:
```
* #{ managed } <= 1, #{ AP, P2P-client, P2P-GO } <= 1
```

### Tested Hardware

| Card | Driver | Concurrent AP | Same Channel Required |
|------|--------|:-------------:|:---------------------:|
| Intel AX201 | `iwlwifi` | ✅ | Yes |
| Intel AX200 | `iwlwifi` | ✅ | Yes |
| Intel AC 9560 | `iwlwifi` | ✅ | Yes |

### Software Requirements

| Requirement | Purpose |
|-------------|---------|
| **GNOME Shell 45+** | Required for the extension (tested up to GNOME 50) |
| `hostapd` | Runs the access point daemon |
| `dnsmasq` | DHCP and DNS for connected clients |
| `iw` | Wireless interface management |
| `iptables` | NAT for internet sharing |
| `iproute2` | Interface/address management (`ip` command) |
| `polkit` | Passwordless privilege escalation |

**Install dependencies:**

```bash
# Fedora
sudo dnf install hostapd dnsmasq iw iptables iproute polkit

# Ubuntu/Debian
sudo apt install hostapd dnsmasq iw iptables iproute2 policykit-1

# Arch
sudo pacman -S hostapd dnsmasq iw iptables iproute2 polkit
```

---

## 🚀 Installation

### One-Command Install

```bash
git clone https://github.com/sriram32005/wifi-hotspot.git
cd wifi-hotspot
chmod +x install.sh
./install.sh
```

The installer will:
1. ✅ Install `wifi-hotspot.sh` and `wifi-hotspot-status.sh` to `/usr/local/bin/`
2. ✅ Install Polkit policy and rules (passwordless for `wheel` group)
3. ✅ Install the GNOME Shell extension to `~/.local/share/gnome-shell/extensions/`
4. ✅ Enable the extension

### Activate the Extension

After installation, restart GNOME Shell:
- **Wayland:** Log out and log back in
- **X11:** Press `Alt+F2`, type `r`, press Enter

The **📡 hotspot icon** will appear in your top bar!

> [!TIP]
> You can also manage the extension from the **GNOME Extensions** app or via CLI:
> ```bash
> gnome-extensions enable wifi-hotspot@sriram
> gnome-extensions disable wifi-hotspot@sriram
> ```

---

## 🖥️ Usage

### GNOME Extension (Recommended)

1. **Click the hotspot icon** (📡) in the top bar
2. **View status** — see if the hotspot is active, SSID, password, connected devices
3. **Edit settings** — change SSID and password in the Settings section
4. **Click "Start Hotspot"** — the hotspot starts with your settings
5. **Click "Stop Hotspot"** — clean shutdown

**Menu sections:**
| Section | Description |
|---------|-------------|
| Status Header | Active/Inactive with colored indicator |
| Info | SSID, password (show/hide + copy), channel, gateway, internet source |
| Connected Devices | Count badge + device list with MAC addresses and signal |
| Settings | Editable SSID and password fields |
| Actions | Start/Stop toggle + Refresh button |

### CLI Tool

The CLI tool is also available for terminal use or scripting:

```bash
# Connect to WiFi first
nmcli device wifi connect "YourNetwork" password "YourPassword"

# Start with defaults (SSID: MyHotspot, Password: hotspot123)
sudo wifi-hotspot.sh start

# Start with custom SSID and password
sudo wifi-hotspot.sh start "MyHotspot" "SuperSecure123"

# Check status
sudo wifi-hotspot.sh status

# Stop
sudo wifi-hotspot.sh stop
```

---

## ⚙️ Configuration

### Default Settings

Edit the defaults at the top of `wifi-hotspot.sh`:

```bash
DEFAULT_SSID="MyHotspot"          # Hotspot name
DEFAULT_PASSWORD="hotspot123"     # WPA2 password (min 8 chars)
AP_INTERFACE="ap0"                # Virtual AP interface name
AP_IP="192.168.12.1"              # Gateway IP
AP_DHCP_START="192.168.12.50"     # DHCP range start
AP_DHCP_END="192.168.12.150"      # DHCP range end
DNS_SERVERS="8.8.8.8,8.8.4.4"    # DNS for clients
```

> [!TIP]
> When using the GNOME extension, you can override the SSID and password directly from the menu without editing the script.

---

## 🏗️ How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Your Laptop                          │
│                                                          │
│  ┌──────────────┐                                        │
│  │ GNOME Shell  │ ← Extension (top bar icon + menu)      │
│  │  Extension   │                                        │
│  └──────┬───────┘                                        │
│         │ pkexec (polkit)                                 │
│         ▼                                                │
│  ┌──────────────┐                                        │
│  │ wifi-hotspot │ ← CLI script (manages everything)      │
│  │    .sh       │                                        │
│  └──────┬───────┘                                        │
│         │                                                │
│  ┌──────┴──────────────────────────────────┐             │
│  │                                         │             │
│  ▼                                         ▼             │
│  ┌─────────────────┐    ┌─────────────────┐              │
│  │   wlp0s20f3     │    │      ap0         │             │
│  │   (managed)     │    │      (AP)        │             │
│  │  Connected to   │NAT │  Hotspot SSID    │             │
│  │  home WiFi      │◄──►│  192.168.12.1    │             │
│  └────────┬────────┘    └────────┬─────────┘             │
│           │                      │                       │
└───────────┼──────────────────────┼───────────────────────┘
            │                      │
            ▼                      ▼
     ┌──────────────┐     ┌──────────────────┐
     │  WiFi Router │     │  Client Devices   │
     │  (Internet)  │     │  (Phone, Tablet)  │
     └──────────────┘     └──────────────────┘
```

### Extension → Script Communication

1. **Status checks:** Extension runs `pkexec wifi-hotspot-status.sh` which outputs JSON
2. **Start/Stop:** Extension runs `pkexec wifi-hotspot.sh start|stop` via `Gio.Subprocess`
3. **Auth:** Polkit rules grant passwordless access to `wheel` group users
4. **Auto-refresh:** `GLib.timeout_add_seconds` polls every 5 seconds while menu is open

---

## 📂 File Structure

```
wifi-hotspot/
├── wifi-hotspot.sh              # Main CLI script
├── wifi-hotspot-status.sh       # JSON status helper for the extension
├── install.sh                   # Automated installer
├── uninstall.sh                 # Clean uninstaller
├── README.md                    # This file
├── LICENSE                      # MIT License
├── gnome-extension/
│   └── wifi-hotspot@sriram/
│       ├── metadata.json        # Extension metadata
│       ├── extension.js         # Extension logic
│       └── stylesheet.css       # Extension styling
└── polkit/
    ├── com.github.sriram.wifi-hotspot.policy   # Polkit action definitions
    └── 10-wifi-hotspot.rules                    # Polkit rules (wheel → passwordless)
```

### Installed Files

| File | Location | Purpose |
|------|----------|---------|
| `wifi-hotspot.sh` | `/usr/local/bin/` | Main script |
| `wifi-hotspot-status.sh` | `/usr/local/bin/` | Status JSON helper |
| Polkit policy | `/usr/share/polkit-1/actions/` | Action definitions |
| Polkit rules | `/etc/polkit-1/rules.d/` | Passwordless auth |
| Extension | `~/.local/share/gnome-shell/extensions/wifi-hotspot@sriram/` | GNOME extension |
| NM config | `/etc/NetworkManager/conf.d/99-wifi-hotspot-unmanaged.conf` | Created at runtime |

---

## 🔧 Troubleshooting

### Extension not showing in top bar

```bash
# Check if extension is installed
gnome-extensions list | grep wifi-hotspot

# Check if enabled
gnome-extensions info wifi-hotspot@sriram

# Check for errors
journalctl -f -o cat /usr/bin/gnome-shell 2>/dev/null | grep -i hotspot
```

### "Device or resource busy" error

```bash
# Stop any running hotspot
sudo wifi-hotspot.sh stop

# Manual cleanup if needed
sudo nmcli device set ap0 managed no
sudo ip link set ap0 down
sudo ip link delete ap0

# Restart
sudo wifi-hotspot.sh start
```

### Polkit authentication dialog appears

If you're getting a password prompt instead of seamless operation:

```bash
# Verify you're in the wheel group
groups | grep wheel

# Check Polkit rules are installed
ls -la /etc/polkit-1/rules.d/10-wifi-hotspot.rules
cat /usr/share/polkit-1/actions/com.github.sriram.wifi-hotspot.policy

# Re-run installer if needed
./install.sh
```

### hostapd fails to start

```bash
# Check the log
cat /tmp/wifi-hotspot-hostapd.log

# Ensure WiFi is connected first
nmcli device wifi connect "YourNetwork" password "YourPassword"

# Kill stale processes
sudo pkill hostapd
sudo wifi-hotspot.sh start
```

### Connected devices can't access internet

```bash
# Verify IP forwarding
cat /proc/sys/net/ipv4/ip_forward   # Should output: 1

# Verify NAT rules
sudo iptables -t nat -L POSTROUTING -v   # Should show MASQUERADE
```

---

## 🗑️ Uninstallation

```bash
chmod +x uninstall.sh
./uninstall.sh
```

This removes:
- Scripts from `/usr/local/bin/`
- GNOME extension
- Polkit policy and rules
- NetworkManager configuration
- All temp files

---

## ⚠️ Limitations

- **Single channel only** — hotspot must be on the same channel as your WiFi (Intel firmware constraint)
- **Reboot clears hotspot** — does not persist across reboots (by design)
- **One hotspot at a time** — only one AP interface can be active
- **5 GHz depends on router** — if your router uses 5 GHz, the hotspot will too
- **Performance** — sharing a single radio reduces throughput vs dedicated hardware
- **GNOME Shell only** — extension requires GNOME Shell 45+ (no KDE/XFCE support)

---

## 🔒 Security Notes

- Default password `hotspot123` is **not secure** — always use a strong password
- The hotspot uses **WPA2-PSK** with CCMP cipher
- Polkit rules grant passwordless root access **only** to `wifi-hotspot.sh` and `wifi-hotspot-status.sh`
- Only users in the `wheel` group get passwordless access
- Connected clients can see each other on the `192.168.12.x` subnet

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📜 License

This project is open source and available under the [MIT License](LICENSE).

---

<p align="center">
  <b>Made with ❤️ for Linux WiFi sharing</b><br>
  <i>Now with a proper GUI — because not everything needs a terminal.</i>
</p>
