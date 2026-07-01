#!/bin/bash
# ============================================================================
# wifi-hotspot-status.sh — JSON status output for the GNOME extension
#
# Outputs a JSON object with the current hotspot state.
# Requires root to gather full info (run via pkexec).
# ============================================================================

set -uo pipefail

AP_INTERFACE="ap0"
AP_IP="192.168.12.1"
PID_DIR="/tmp/wifi-hotspot"
HOSTAPD_CONF="/tmp/wifi-hotspot-hostapd.conf"

# ── Defaults ────────────────────────────────────────────────────────────────
RUNNING=false
SSID=""
PASSWORD=""
CHANNEL=""
BAND=""
GATEWAY="$AP_IP"
WIFI_INTERFACE=""
WIFI_SSID=""
CLIENT_COUNT=0
CLIENTS_JSON="[]"
HOSTAPD_RUNNING=false
DNSMASQ_RUNNING=false
INTERNET_OK=false

# ── Check if hotspot is running ─────────────────────────────────────────────
is_running() {
    [[ -d "$PID_DIR" ]] && [[ -f "$PID_DIR/hostapd.pid" || -f "$PID_DIR/dnsmasq.pid" ]]
}

# ── Find WiFi interface ────────────────────────────────────────────────────
find_wifi_interface() {
    iw dev 2>/dev/null | awk '/Interface/{iface=$2} /type managed/{print iface}' | head -1
}

# ── Main ────────────────────────────────────────────────────────────────────

if is_running; then
    RUNNING=true

    # SSID from hostapd config
    if [[ -f "$HOSTAPD_CONF" ]]; then
        SSID=$(grep '^ssid=' "$HOSTAPD_CONF" 2>/dev/null | cut -d= -f2 || echo "")
        PASSWORD=$(grep '^wpa_passphrase=' "$HOSTAPD_CONF" 2>/dev/null | cut -d= -f2 || echo "")
        CHANNEL=$(grep '^channel=' "$HOSTAPD_CONF" 2>/dev/null | cut -d= -f2 || echo "")
        HW_MODE=$(grep '^hw_mode=' "$HOSTAPD_CONF" 2>/dev/null | cut -d= -f2 || echo "")
        if [[ "$HW_MODE" == "g" ]]; then
            BAND="2.4 GHz"
        elif [[ "$HW_MODE" == "a" ]]; then
            BAND="5 GHz"
        fi
    fi

    # WiFi interface info
    WIFI_INTERFACE=$(find_wifi_interface)
    if [[ -n "$WIFI_INTERFACE" ]]; then
        WIFI_SSID=$(iw dev "$WIFI_INTERFACE" info 2>/dev/null | grep -oP 'ssid \K.*' || echo "")
    fi

    # Gateway IP from AP interface
    if ip link show "$AP_INTERFACE" &>/dev/null; then
        GATEWAY=$(ip addr show "$AP_INTERFACE" 2>/dev/null | grep -oP 'inet \K[0-9.]+' || echo "$AP_IP")
    fi

    # Process status
    if [[ -f "$PID_DIR/hostapd.pid" ]] && kill -0 "$(cat "$PID_DIR/hostapd.pid")" 2>/dev/null; then
        HOSTAPD_RUNNING=true
    fi
    if [[ -f "$PID_DIR/dnsmasq.pid" ]] && kill -0 "$(cat "$PID_DIR/dnsmasq.pid")" 2>/dev/null; then
        DNSMASQ_RUNNING=true
    fi

    # Connected clients
    if ip link show "$AP_INTERFACE" &>/dev/null; then
        STATION_DUMP=$(iw dev "$AP_INTERFACE" station dump 2>/dev/null || echo "")
        CLIENT_COUNT=$(echo "$STATION_DUMP" | grep -c "Station" 2>/dev/null || echo "0")
        if [[ "$CLIENT_COUNT" -gt 0 ]]; then
            # Build JSON array of clients
            CLIENTS_JSON="["
            FIRST=true
            while IFS= read -r line; do
                MAC=$(echo "$line" | grep -oP 'Station \K[0-9a-f:]+')
                if [[ -n "$MAC" ]]; then
                    # Get signal for this station
                    SIGNAL=$(echo "$STATION_DUMP" | grep -A 20 "Station $MAC" | grep -oP 'signal:\s+\K-?[0-9]+' | head -1 || echo "")
                    RX=$(echo "$STATION_DUMP" | grep -A 20 "Station $MAC" | grep -oP 'rx bytes:\s+\K[0-9]+' | head -1 || echo "0")
                    TX=$(echo "$STATION_DUMP" | grep -A 20 "Station $MAC" | grep -oP 'tx bytes:\s+\K[0-9]+' | head -1 || echo "0")
                    if [[ "$FIRST" == true ]]; then
                        FIRST=false
                    else
                        CLIENTS_JSON+=","
                    fi
                    CLIENTS_JSON+="{\"mac\":\"$MAC\",\"signal\":\"$SIGNAL\",\"rx\":\"$RX\",\"tx\":\"$TX\"}"
                fi
            done <<< "$(echo "$STATION_DUMP" | grep "Station")"
            CLIENTS_JSON+="]"
        fi
    fi

    # Internet check
    if ping -c 1 -W 2 8.8.8.8 &>/dev/null; then
        INTERNET_OK=true
    fi
fi

# ── Output JSON ─────────────────────────────────────────────────────────────
cat <<EOF
{
  "running": $RUNNING,
  "ssid": "$SSID",
  "password": "$PASSWORD",
  "channel": "$CHANNEL",
  "band": "$BAND",
  "gateway": "$GATEWAY",
  "wifi_interface": "$WIFI_INTERFACE",
  "wifi_ssid": "$WIFI_SSID",
  "client_count": $CLIENT_COUNT,
  "clients": $CLIENTS_JSON,
  "hostapd_running": $HOSTAPD_RUNNING,
  "dnsmasq_running": $DNSMASQ_RUNNING,
  "internet_ok": $INTERNET_OK
}
EOF
