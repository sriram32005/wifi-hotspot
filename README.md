# 📡 WiFi + Hotspot Manager

> **Run a WiFi hotspot and stay connected to the internet — simultaneously — on a single wireless card.**

A lightweight Bash script that turns your Linux laptop into a WiFi access point while keeping your existing WiFi connection alive. Designed specifically for the **Intel AX201** (`iwlwifi`) wireless card, but works with any card that supports concurrent `managed` + `AP` interface combinations.

---

## ✨ Features

- **Simultaneous WiFi + Hotspot** — Share your laptop's WiFi connection without an ethernet cable
- **Auto-channel matching** — Automatically detects your WiFi channel and locks the hotspot to the same channel (required by Intel AX201 firmware)
- **NetworkManager-safe** — Automatically configures NetworkManager to leave the AP interface alone, preventing "Device or resource busy" errors
- **Robust cleanup** — Multi-step interface teardown with retries ensures no stale interfaces are left behind
- **NAT with iptables** — Full internet sharing via IP masquerading
- **DHCP server** — Built-in DHCP via `dnsmasq` for automatic IP assignment to connected devices
- **WPA2 security** — Password-protected hotspot with WPA2-PSK/CCMP encryption
- **Status dashboard** — View connected clients, signal strength, and connectivity at a glance
- **Clean start/stop** — One command to start, one to stop, full cleanup guaranteed

---

## 📋 Prerequisites

### Hardware

Your wireless card must support **concurrent `managed` + `AP` mode**. You can verify this with:

```bash
iw phy phy0 info | grep -A 6 "valid interface combinations"
```

Look for a line like:

```
* #{ managed } <= 1, #{ AP, P2P-client, P2P-GO } <= 1
```

This confirms your card can run a client connection and an access point at the same time.

> [!IMPORTANT]
> The Intel AX201 requires **both interfaces to operate on the same channel** (`#channels <= 1` in the AP combo). The script handles this automatically by reading your current WiFi channel and configuring the hotspot to match.

### Tested Hardware

| Card | Driver | Concurrent AP | Same Channel Required |
|------|--------|:-------------:|:---------------------:|
| Intel AX201 | `iwlwifi` | ✅ | Yes |
| Intel AX200 | `iwlwifi` | ✅ | Yes |
| Intel AC 9560 | `iwlwifi` | ✅ | Yes |

### Software Dependencies

| Package | Purpose |
|---------|---------|
| `hostapd` | Runs the access point (802.11 AP daemon) |
| `dnsmasq` | Provides DHCP and DNS for connected clients |
| `iw` | Creates and manages wireless interfaces |
| `iptables` | Sets up NAT for internet sharing |
| `iproute2` | The `ip` command for interface/address management |

**Install on Fedora:**

```bash
sudo dnf install hostapd dnsmasq iw iptables iproute
```

**Install on Ubuntu/Debian:**

```bash
sudo apt install hostapd dnsmasq iw iptables iproute2
```

**Install on Arch:**

```bash
sudo pacman -S hostapd dnsmasq iw iptables iproute2
```

---

## 🚀 Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/sriram32005/wifi-hotspot.git
cd wifihotspot
chmod +x wifi-hotspot.sh
```

### 2. Connect to a WiFi network first

Make sure your laptop is connected to a WiFi network before starting the hotspot:

```bash
nmcli device wifi connect "YourNetwork" password "YourPassword"
```

### 3. Start the hotspot

```bash
# With default SSID ("MyHotspot") and password ("hotspot123")
sudo ./wifi-hotspot.sh start

# With custom SSID and password
sudo ./wifi-hotspot.sh start "MyHotspot" "SuperSecure123"
```

### 4. Stop the hotspot

```bash
sudo ./wifi-hotspot.sh stop
```

### 5. Check status

```bash
sudo ./wifi-hotspot.sh status
```

---

## 📖 Usage

```
Usage: sudo ./wifi-hotspot.sh {start|stop|status} [SSID] [PASSWORD]

  start [SSID] [PASSWORD]  Start hotspot (default: MyHotspot / hotspot123)
  stop                     Stop hotspot and clean up
  status                   Show current hotspot status

  Examples:
    sudo ./wifi-hotspot.sh start
    sudo ./wifi-hotspot.sh start MyNetwork SecurePass123
    sudo ./wifi-hotspot.sh stop
    sudo ./wifi-hotspot.sh status
```

### Sample Output — `start`

```
╔══════════════════════════════════════════════════════╗
║          WiFi + Hotspot Manager (Intel AX201)        ║
╚══════════════════════════════════════════════════════╝

[✓] WiFi interface: wlp0s20f3
[✓] Connected to: MyHomeNetwork
[✓] Current channel: 4
[✓] Band: 2.4 GHz

[→] Creating AP interface ap0 on channel 4...
[→] Configuring NetworkManager to ignore ap0...
[✓] AP interface ap0 is up with IP 192.168.12.1
[→] Configuring hostapd...
[→] Configuring dnsmasq...
[→] Enabling IP forwarding...
[→] Setting up NAT (iptables)...
[→] Starting dnsmasq...
[✓] dnsmasq started (PID: 12345)
[→] Starting hostapd...
[✓] hostapd started (PID: 12346)

[✓] WiFi still connected to: MyHomeNetwork ✓

╔══════════════════════════════════════════════════════╗
║              Hotspot is ACTIVE!                      ║
╠══════════════════════════════════════════════════════╣
║  SSID:      MyHotspot
║  Password:  hotspot123
║  Channel:   4
║  Gateway:   192.168.12.1
║  Internet:  via wlp0s20f3 → MyHomeNetwork
╠══════════════════════════════════════════════════════╣
║  Stop with: sudo ./wifi-hotspot.sh stop
╚══════════════════════════════════════════════════════╝
```

### Sample Output — `status`

```
╔══════════════════════════════════════════════════════╗
║          WiFi + Hotspot Manager (Intel AX201)        ║
╚══════════════════════════════════════════════════════╝

[✓] Hotspot is ACTIVE

  WiFi Client:
    Interface: wlp0s20f3
    SSID:      MyHomeNetwork
    Channel:   4

  Hotspot (AP):
    Interface: ap0
    IP:        192.168.12.1
    SSID:      MyHotspot

  Processes:
    hostapd: running (PID: 12345)
    dnsmasq: running (PID: 12346)

  Connected Clients:
    Count: 2

  Internet:
    Connectivity: OK
```

---

## ⚙️ Configuration

All configuration is done via variables at the top of the script. Edit these to customize your setup:

```bash
# ── Network Identity ─────────────────────────────────
DEFAULT_SSID="MyHotspot"          # Hotspot name
DEFAULT_PASSWORD="hotspot123"         # WPA2 password (min 8 chars)

# ── AP Interface ─────────────────────────────────────
AP_INTERFACE="ap0"                    # Virtual AP interface name
AP_IP="192.168.12.1"                  # Gateway IP for the hotspot
AP_SUBNET="192.168.12.0/24"          # Subnet for hotspot clients

# ── DHCP ─────────────────────────────────────────────
AP_DHCP_START="192.168.12.50"         # First IP to assign
AP_DHCP_END="192.168.12.150"          # Last IP to assign
AP_DHCP_LEASE="12h"                   # DHCP lease duration

# ── DNS ──────────────────────────────────────────────
DNS_SERVERS="8.8.8.8,8.8.4.4"        # DNS servers for clients
```

> [!TIP]
> If you have another local network on `192.168.12.x`, change `AP_IP` and the DHCP range to a different subnet like `192.168.50.x` to avoid conflicts.

---

## 🏗️ How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Your Laptop                          │
│                                                          │
│  ┌─────────────────┐         ┌─────────────────┐        │
│  │   wlp0s20f3     │         │      ap0         │        │
│  │   (managed)     │         │      (AP)        │        │
│  │                 │         │                  │        │
│  │  Connected to   │  NAT    │  Hotspot SSID    │        │
│  │  home WiFi      │◄───────►│  192.168.12.1    │        │
│  │                 │iptables │                  │        │
│  └────────┬────────┘         └────────┬─────────┘        │
│           │                           │                  │
└───────────┼───────────────────────────┼──────────────────┘
            │                           │
            ▼                           ▼
     ┌──────────────┐          ┌──────────────────┐
     │  WiFi Router │          │  Client Devices   │
     │  (Internet)  │          │  (Phone, Tablet)  │
     └──────────────┘          └──────────────────┘
```

### Step-by-Step Startup Process

1. **Detect WiFi interface** — Finds the active `managed` mode interface (e.g., `wlp0s20f3`)
2. **Read current channel** — Gets the channel your WiFi client is on (e.g., channel 4)
3. **Configure NetworkManager** — Creates a drop-in config (`/etc/NetworkManager/conf.d/99-wifi-hotspot-unmanaged.conf`) telling NM to never touch `ap0`
4. **Clean stale interfaces** — If `ap0` exists from a previous run, robustly removes it (NM unmanage → bring down → flush → delete with retries)
5. **Create AP interface** — Adds a virtual `__ap` type interface on the same physical radio
6. **Set MAC address** — Assigns a unique MAC (base MAC + 1) to avoid conflicts
7. **Assign IP** — Gives `ap0` the gateway IP (`192.168.12.1/24`)
8. **Configure hostapd** — Generates config for the access point daemon (same channel, WPA2)
9. **Configure dnsmasq** — Generates config for DHCP server
10. **Enable IP forwarding** — Sets `net.ipv4.ip_forward=1`
11. **Setup NAT** — Adds iptables MASQUERADE rules to share internet
12. **Start services** — Launches `dnsmasq` (DHCP) and `hostapd` (AP)
13. **Verify connection** — Confirms the WiFi client connection survived

### Key Constraint: Same Channel

The Intel AX201 firmware only supports **one channel at a time** when running concurrent `managed` + `AP` interfaces. This means:

- The hotspot **must** operate on the same channel as your WiFi connection
- If your WiFi router is on channel 4, the hotspot will also be on channel 4
- Changing your WiFi network may require restarting the hotspot

This is a hardware/firmware limitation, not a software one.

---

## 🔧 Troubleshooting

### "Device or resource busy" (RTNETLINK error)

**Cause:** A stale `ap0` interface exists from a previous run, or NetworkManager has grabbed it.

**Fix:**

```bash
# Stop any running hotspot first
sudo ./wifi-hotspot.sh stop

# If that doesn't work, manually clean up:
sudo nmcli device set ap0 managed no
sudo ip link set ap0 down
sudo ip link delete ap0

# Then start again
sudo ./wifi-hotspot.sh start
```

### hostapd fails to start

**Cause:** Usually a channel mismatch or another process is using the interface.

**Debug:**

```bash
# Check the hostapd log
cat /tmp/wifi-hotspot-hostapd.log

# Common fixes:
# 1. Make sure you're connected to WiFi first
# 2. Kill any other hostapd instances
sudo pkill hostapd
```

### WiFi disconnects when starting hotspot

**Cause:** The AP was created on a different channel than the client.

**Fix:** This shouldn't happen with this script (it auto-matches channels), but if it does:

```bash
# Reconnect to WiFi
nmcli device connect wlp0s20f3

# Restart the hotspot
sudo ./wifi-hotspot.sh stop
sudo ./wifi-hotspot.sh start
```

### Connected devices can't access the internet

**Cause:** IP forwarding or NAT rules are not active.

**Check:**

```bash
# Verify IP forwarding
cat /proc/sys/net/ipv4/ip_forward
# Should output: 1

# Verify NAT rules
sudo iptables -t nat -L POSTROUTING -v
# Should show a MASQUERADE rule for your WiFi interface
```

### dnsmasq fails: "address already in use"

**Cause:** Another dnsmasq or DNS service is already bound to the interface.

**Fix:**

```bash
# Find and kill conflicting dnsmasq
sudo pkill -f "dnsmasq.*ap0"

# Check if systemd-resolved is conflicting
sudo systemctl stop systemd-resolved

# Retry
sudo ./wifi-hotspot.sh start
```

---

## 📂 File Structure

```
wifihotspot/
├── wifi-hotspot.sh          # Main script
└── README.md                # This file

# Runtime files (auto-generated, cleaned on stop):
/tmp/wifi-hotspot-hostapd.conf       # hostapd configuration
/tmp/wifi-hotspot-dnsmasq.conf       # dnsmasq configuration
/tmp/wifi-hotspot-hostapd.log        # hostapd log
/tmp/wifi-hotspot-dnsmasq.log        # dnsmasq log
/tmp/wifi-hotspot/                   # PID directory
├── hostapd.pid                      # hostapd process ID
├── dnsmasq.pid                      # dnsmasq process ID
└── wifi_iface                       # Saved WiFi interface name

# Persistent config (created once):
/etc/NetworkManager/conf.d/99-wifi-hotspot-unmanaged.conf
```

---

## 🔒 Security Notes

- The default password `hotspot123` is **not secure**. Always use a strong password in production:
  ```bash
  sudo ./wifi-hotspot.sh start "MyHotspot" "$(openssl rand -base64 12)"
  ```
- The hotspot uses **WPA2-PSK** with CCMP cipher — this is reasonably secure for personal use
- Connected clients can see each other on the `192.168.12.x` subnet
- The script requires **root access** (`sudo`) because it manipulates network interfaces, iptables, and system services

---

## ⚠️ Limitations

- **Single channel only** — The hotspot must be on the same channel as your WiFi connection (Intel AX201 firmware constraint)
- **Reboot clears the hotspot** — The hotspot does not persist across reboots (by design, for safety)
- **One hotspot at a time** — Only one AP interface can be active
- **No 5 GHz guarantee** — If your WiFi router uses 5 GHz, the hotspot will also be 5 GHz (some older client devices may not support it)
- **Performance** — Sharing a single radio between client and AP modes will reduce throughput compared to dedicated hardware

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
  <i>Because Windows' Mobile Hotspot shouldn't be the only option.</i>
</p>
