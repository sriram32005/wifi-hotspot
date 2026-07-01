#!/bin/bash
# ============================================================================
# uninstall.sh — Uninstall WiFi Hotspot Manager
# ============================================================================

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info()    { echo -e "${GREEN}[✓]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
log_step()    { echo -e "${BLUE}[→]${NC} $*"; }

# Both old and new UUIDs
NEW_UUID="wifi-hotspot-manager@sriram32005.github.io"
OLD_UUID="wifi-hotspot@sriram"

echo -e "${CYAN}${BOLD}"
echo "╔══════════════════════════════════════════════════════╗"
echo "║       WiFi Hotspot Manager — Uninstaller            ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ── Stop hotspot if running via NM ────────────────────────────────────────
log_step "Stopping hotspot if running..."
nmcli connection down Hotspot 2>/dev/null || true

# Also try the old script method
if [[ -d "/tmp/wifi-hotspot" ]]; then
    sudo /usr/local/bin/wifi-hotspot.sh stop 2>/dev/null || true
fi
log_info "Hotspot stopped"

# ── Disable and remove extensions ─────────────────────────────────────────
for UUID in "$NEW_UUID" "$OLD_UUID"; do
    EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"

    log_step "Removing extension: $UUID"
    gnome-extensions disable "$UUID" 2>/dev/null || true

    # Remove from enabled-extensions
    CURRENT_ENABLED=$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null || echo "[]")
    if echo "$CURRENT_ENABLED" | grep -q "$UUID"; then
        NEW_ENABLED=$(echo "$CURRENT_ENABLED" | python3 -c "
import sys, ast
try:
    exts = ast.literal_eval(sys.stdin.read().strip())
    exts = [e for e in exts if e != '$UUID']
    print(exts)
except: print('[]')
")
        gsettings set org.gnome.shell enabled-extensions "$NEW_ENABLED" 2>/dev/null || true
    fi

    if [[ -d "$EXT_DIR" ]]; then
        rm -rf "$EXT_DIR"
        log_info "Removed: $EXT_DIR"
    else
        log_warn "Not found: $EXT_DIR (already removed?)"
    fi
done

# ── Remove GSettings schema from system ───────────────────────────────────
log_step "Cleaning GSettings..."
dconf reset -f /org/gnome/shell/extensions/wifi-hotspot-manager/ 2>/dev/null || true
log_info "Cleared GSettings keys"

# ── Remove CLI tools ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Remove CLI tools (wifi-hotspot.sh)?${NC}"
read -rp "  Remove CLI tools from /usr/local/bin? (y/N) " remove_cli

if [[ "${remove_cli,,}" == "y" ]]; then
    log_step "Removing scripts (requires sudo)..."
    sudo rm -f /usr/local/bin/wifi-hotspot.sh
    sudo rm -f /usr/local/bin/wifi-hotspot-status.sh
    log_info "Removed CLI scripts"

    log_step "Removing Polkit policy and rules..."
    sudo rm -f /usr/share/polkit-1/actions/com.github.sriram.wifi-hotspot.policy
    sudo rm -f /etc/polkit-1/rules.d/10-wifi-hotspot.rules
    log_info "Removed Polkit files"

    log_step "Removing NetworkManager config..."
    sudo rm -f /etc/NetworkManager/conf.d/99-wifi-hotspot-unmanaged.conf
    sudo nmcli general reload conf 2>/dev/null || true
    log_info "Removed NM config"

    log_step "Cleaning temp files..."
    sudo rm -rf /tmp/wifi-hotspot
    sudo rm -f /tmp/wifi-hotspot-hostapd.conf /tmp/wifi-hotspot-dnsmasq.conf
    sudo rm -f /tmp/wifi-hotspot-hostapd.log /tmp/wifi-hotspot-dnsmasq.log
    log_info "Temp files cleaned"
fi

# ── Done ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║          Uninstall Complete!                         ║${NC}"
echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}${BOLD}║${NC}  ${YELLOW}⟳ Restart GNOME Shell to finish cleanup:${NC}"
echo -e "${GREEN}${BOLD}║${NC}    • ${BOLD}Wayland:${NC} Log out and log back in"
echo -e "${GREEN}${BOLD}║${NC}    • ${BOLD}X11:${NC}    Press Alt+F2, type 'r', press Enter"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
