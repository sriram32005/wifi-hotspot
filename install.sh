#!/bin/bash
# ============================================================================
# install.sh — Install WiFi Hotspot Manager
#
# Installs both:
#   1. CLI tool (wifi-hotspot.sh) — advanced, concurrent AP, requires root
#   2. GNOME Shell extension — generic, uses NetworkManager, no root needed
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
log_error()   { echo -e "${RED}[✗]${NC} $*"; }
log_step()    { echo -e "${BLUE}[→]${NC} $*"; }

# ── Paths ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_UUID="wifi-hotspot-manager@sriram32005.github.io"
EXTENSION_SRC_DIR="$SCRIPT_DIR/gnome-extension/$EXTENSION_UUID"
EXTENSION_DEST_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"

echo -e "${CYAN}${BOLD}"
echo "╔══════════════════════════════════════════════════════╗"
echo "║       WiFi Hotspot Manager — Installer              ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ── Check GNOME Shell ───────────────────────────────────────────────────────
if ! command -v gnome-shell &>/dev/null; then
    log_error "GNOME Shell not found. This extension requires GNOME Shell."
    exit 1
fi

GNOME_VERSION=$(gnome-shell --version | grep -oP '[0-9]+' | head -1)
log_info "Detected GNOME Shell version: ${BOLD}$GNOME_VERSION${NC}"

if [[ "$GNOME_VERSION" -lt 45 ]]; then
    log_error "GNOME Shell 45 or later required. You have version $GNOME_VERSION."
    exit 1
fi

# ── Check extension source exists ──────────────────────────────────────────
if [[ ! -d "$EXTENSION_SRC_DIR" ]]; then
    log_error "Extension source not found at: $EXTENSION_SRC_DIR"
    exit 1
fi

# ── Install CLI tools (optional, requires sudo) ───────────────────────────
echo ""
echo -e "${BOLD}Install CLI tool (wifi-hotspot.sh)?${NC}"
echo -e "  This is the ${YELLOW}advanced CLI tool${NC} for concurrent AP mode (requires root)."
echo -e "  The GNOME extension works independently without this."
read -rp "  Install CLI tool? (y/N) " install_cli

if [[ "${install_cli,,}" == "y" ]]; then
    log_step "Installing CLI tools to /usr/local/bin (requires sudo)..."

    sudo install -m 755 -o root -g root "$SCRIPT_DIR/wifi-hotspot.sh" /usr/local/bin/wifi-hotspot.sh
    log_info "Installed wifi-hotspot.sh"

    sudo install -m 755 -o root -g root "$SCRIPT_DIR/wifi-hotspot-status.sh" /usr/local/bin/wifi-hotspot-status.sh
    log_info "Installed wifi-hotspot-status.sh"

    # Polkit policy
    log_step "Installing Polkit policy..."
    sudo install -m 644 -o root -g root \
        "$SCRIPT_DIR/polkit/com.github.sriram.wifi-hotspot.policy" \
        /usr/share/polkit-1/actions/com.github.sriram.wifi-hotspot.policy
    log_info "Installed Polkit action policy"

    sudo mkdir -p /etc/polkit-1/rules.d
    sudo install -m 644 -o root -g root \
        "$SCRIPT_DIR/polkit/10-wifi-hotspot.rules" \
        /etc/polkit-1/rules.d/10-wifi-hotspot.rules
    log_info "Installed Polkit rules (wheel group → passwordless)"
fi

# ── Disable + remove old extension if present ─────────────────────────────
OLD_UUID="wifi-hotspot@sriram"
OLD_DIR="$HOME/.local/share/gnome-shell/extensions/$OLD_UUID"
if [[ -d "$OLD_DIR" ]]; then
    log_step "Removing old extension ($OLD_UUID)..."
    gnome-extensions disable "$OLD_UUID" 2>/dev/null || true
    # Remove from enabled-extensions
    CURRENT_ENABLED=$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null || echo "[]")
    NEW_ENABLED=$(echo "$CURRENT_ENABLED" | python3 -c "
import sys, ast
try:
    exts = ast.literal_eval(sys.stdin.read().strip())
    exts = [e for e in exts if e != '$OLD_UUID']
    print(exts)
except: print('[]')
")
    gsettings set org.gnome.shell enabled-extensions "$NEW_ENABLED" 2>/dev/null || true
    rm -rf "$OLD_DIR"
    log_info "Removed old extension"
fi

# ── Install GNOME Extension ──────────────────────────────────────────────
echo ""
log_step "Installing GNOME Shell extension..."

mkdir -p "$EXTENSION_DEST_DIR"
cp -r "$EXTENSION_SRC_DIR/"* "$EXTENSION_DEST_DIR/"

# Compile GSettings schemas
if command -v glib-compile-schemas &>/dev/null; then
    glib-compile-schemas "$EXTENSION_DEST_DIR/schemas/" 2>/dev/null || true
    log_info "Compiled GSettings schemas"
fi

log_info "Extension installed to: ${BOLD}$EXTENSION_DEST_DIR${NC}"

# ── Enable extension via gsettings (robust method) ────────────────────────
echo ""
log_step "Enabling extension..."

# Use gsettings directly — this is more reliable than `gnome-extensions enable`
# because it works even before GNOME Shell has loaded the extension metadata.
CURRENT_ENABLED=$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null || echo "[]")

# Check if already in the list
if echo "$CURRENT_ENABLED" | grep -q "$EXTENSION_UUID"; then
    log_info "Extension already in enabled-extensions list"
else
    # Add to the list using python3 for safe list manipulation
    NEW_ENABLED=$(echo "$CURRENT_ENABLED" | python3 -c "
import sys, ast
try:
    exts = ast.literal_eval(sys.stdin.read().strip())
    if not isinstance(exts, list): exts = []
except: exts = []
exts.append('$EXTENSION_UUID')
print(exts)
")
    gsettings set org.gnome.shell enabled-extensions "$NEW_ENABLED" 2>/dev/null || true
    log_info "Extension added to enabled-extensions list"
fi

# Also remove from disabled-extensions if present
CURRENT_DISABLED=$(gsettings get org.gnome.shell disabled-extensions 2>/dev/null || echo "[]")
if echo "$CURRENT_DISABLED" | grep -q "$EXTENSION_UUID"; then
    NEW_DISABLED=$(echo "$CURRENT_DISABLED" | python3 -c "
import sys, ast
try:
    exts = ast.literal_eval(sys.stdin.read().strip())
    exts = [e for e in exts if e != '$EXTENSION_UUID']
    print(exts)
except: print('[]')
")
    gsettings set org.gnome.shell disabled-extensions "$NEW_DISABLED" 2>/dev/null || true
    log_info "Removed from disabled-extensions list"
fi

# Also try gnome-extensions enable (belt and suspenders)
gnome-extensions enable "$EXTENSION_UUID" 2>/dev/null || true

# ── Done ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║          Installation Complete!                      ║${NC}"
echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}${BOLD}║${NC}  Extension: ${CYAN}${BOLD}$EXTENSION_UUID${NC}"
echo -e "${GREEN}${BOLD}║${NC}  Location:  ${CYAN}${BOLD}$EXTENSION_DEST_DIR${NC}"
echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}${BOLD}║${NC}  ${YELLOW}⟳ Restart GNOME Shell to activate:${NC}"
echo -e "${GREEN}${BOLD}║${NC}    • ${BOLD}Wayland:${NC} Log out and log back in"
echo -e "${GREEN}${BOLD}║${NC}    • ${BOLD}X11:${NC}    Press Alt+F2, type 'r', press Enter"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  After restart, look for the ${CYAN}📡 hotspot icon${NC} in the top bar."
echo -e "  Configure in ${BOLD}Extensions${NC} app → WiFi Hotspot Manager → ⚙ Settings"
echo ""
