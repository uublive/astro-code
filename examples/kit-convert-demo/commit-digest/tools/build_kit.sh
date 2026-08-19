#!/usr/bin/env bash
# build_kit.sh — build THIS kit's src/ into dist/kit.zip with SHA-256 integrity.
#
# Standalone adaptation of AstroKit's build_kit.sh for a single-kit repository:
# the kit root is the parent of tools/, and instead of updating a registry
# kits.json it refreshes registry-entry.json (the ready-to-paste entry for a
# future registry). Zipping uses tools/_zip_src.py (stdlib python3) so builds
# are reproducible and need no `zip` binary.
#
# Usage: ./tools/build_kit.sh
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()   { echo -e "${CYAN}[build]${NC} $*"; }
ok()    { echo -e "${GREEN}[build]${NC} $*"; }
warn()  { echo -e "${RED}[build]${NC} warning: $*" >&2; }
err()   { echo -e "${RED}[build]${NC} $*" >&2; }

TOOLS_DIR="$(cd "$(dirname "$0")" && pwd)"
KIT_ROOT="$(cd "$TOOLS_DIR/.." && pwd)"
SRC_DIR="$KIT_ROOT/src"
DIST_DIR="$KIT_ROOT/dist"
KIT_JSON="$KIT_ROOT/kit.json"
REGISTRY_ENTRY="$KIT_ROOT/registry-entry.json"
ZIP_PATH="$DIST_DIR/kit.zip"

# ── Pre-flight validation ──
KIT_ID="$(jq -r '.name // empty' "$KIT_JSON" 2>/dev/null || true)"
log "Validating kit: ${BOLD}${KIT_ID:-<unknown>}${NC}"

[[ -d "$SRC_DIR" ]] || { err "Source directory not found: $SRC_DIR"; exit 1; }
[[ -f "$KIT_JSON" ]] || { err "Kit manifest not found: $KIT_JSON"; exit 1; }
[[ -f "$SRC_DIR/CLAUDE.md" ]] || {
  err "CLAUDE.md not found in $SRC_DIR — every kit must include CLAUDE.md"
  exit 1
}

python3 "$TOOLS_DIR/validate_manifest.py" "$KIT_JSON" || {
  err "kit.json failed schema validation (see errors above)"
  exit 1
}

# Standalone repo: the directory name SHOULD match the kit id (the registry
# requires it on import), but it isn't fatal here.
DIR_NAME="$(basename "$KIT_ROOT")"
[[ "$KIT_ID" == "$DIR_NAME" ]] || \
  warn "kit.json 'name' ('$KIT_ID') differs from directory name ('$DIR_NAME') — align them before registering"

ok "Pre-flight checks passed"

# ── Build zip (root-relative paths, reproducible) ──
log "Building zip..."
mkdir -p "$DIST_DIR"
rm -f "$ZIP_PATH"
FILE_COUNT="$(python3 "$TOOLS_DIR/_zip_src.py" "$SRC_DIR" "$ZIP_PATH")"
[[ -s "$ZIP_PATH" ]] || { err "Zip file is empty or was not created: $ZIP_PATH"; exit 1; }
ok "Zip built ($FILE_COUNT files, root-relative, CLAUDE.md present)"

# ── Compute SHA-256 ──
log "Computing SHA-256..."
if command -v sha256sum >/dev/null 2>&1; then
  SHA256="$(sha256sum "$ZIP_PATH" | awk '{print $1}')"
else
  SHA256="$(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')"
fi
log "SHA-256: $SHA256"

# ── Generate contents[] from src/ ──
log "Generating contents list..."
CONTENTS_JSON="$(cd "$SRC_DIR" && find . -type f ! -name ".DS_Store" ! -name "*.pyc" ! -name ".env" ! -name "*.env" ! -path "./__pycache__/*" | sed 's|^\./||' | sort | jq -R . | jq -s .)"

# ── Update kit.json with sha256 and contents[] ──
log "Updating kit.json..."
VERSION="$(jq -r '.version' "$KIT_JSON")"
jq --arg sha "$SHA256" --argjson contents "$CONTENTS_JSON" \
  '.sha256 = $sha | .contents = $contents' \
  "$KIT_JSON" > "$KIT_JSON.tmp" && mv "$KIT_JSON.tmp" "$KIT_JSON"

# ── Refresh registry-entry.json (future kits.json entry) ──
if [[ -f "$REGISTRY_ENTRY" ]]; then
  log "Updating registry-entry.json..."
  jq --arg sha "$SHA256" --arg ver "$VERSION" \
    '.sha256 = $sha | .version = $ver' \
    "$REGISTRY_ENTRY" > "$REGISTRY_ENTRY.tmp" && mv "$REGISTRY_ENTRY.tmp" "$REGISTRY_ENTRY"
fi

# ── Summary ──
ZIP_SIZE="$(wc -c < "$ZIP_PATH" | tr -d ' ')"

ok "Build complete!"
echo ""
echo -e "  ${BOLD}Kit:${NC}      ${KIT_ID}"
echo -e "  ${BOLD}Zip:${NC}      $ZIP_PATH"
echo -e "  ${BOLD}Size:${NC}     $ZIP_SIZE bytes"
echo -e "  ${BOLD}Files:${NC}    $FILE_COUNT"
echo -e "  ${BOLD}SHA-256:${NC}  $SHA256"
echo ""
echo -e "  ${CYAN}Note:${NC} dist/ may be excluded by a global .gitignore."
echo -e "  ${CYAN}To commit:${NC} git add -f $ZIP_PATH && git add $KIT_JSON $REGISTRY_ENTRY"
