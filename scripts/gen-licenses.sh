#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TAURI_DIR="$REPO_ROOT/src-tauri"
RES_DIR="$TAURI_DIR/resources"
HTML_OUT="$RES_DIR/licenses-rust.html"
NPM_OUT="$RES_DIR/licenses-npm.json"
NPM_FRAGMENT="$(mktemp)"
trap 'rm -f "$NPM_FRAGMENT"' EXIT

mkdir -p "$RES_DIR"

if ! command -v cargo-about >/dev/null 2>&1; then
  echo "[gen-licenses] cargo-about not found; installing..."
  if command -v brew >/dev/null 2>&1; then
    brew install cargo-about
  else
    ABOUT_VER="0.9.1"
    ABOUT_ASSET="cargo-about-${ABOUT_VER}-aarch64-apple-darwin"
    ABOUT_URL="https://github.com/EmbarkStudios/cargo-about/releases/download/${ABOUT_VER}/${ABOUT_ASSET}.tar.gz"
    if command -v curl >/dev/null 2>&1 && curl -fsSL "$ABOUT_URL" -o "$NPM_FRAGMENT.tgz" 2>/dev/null; then
      tar -xzf "$NPM_FRAGMENT.tgz" -C "$RES_DIR" >/dev/null 2>&1 || true
      if [ -f "$RES_DIR/$ABOUT_ASSET/cargo-about" ]; then
        mkdir -p "$HOME/.cargo/bin"
        mv "$RES_DIR/$ABOUT_ASSET/cargo-about" "$HOME/.cargo/bin/cargo-about"
        chmod +x "$HOME/.cargo/bin/cargo-about"
        rm -rf "$RES_DIR/$ABOUT_ASSET" "$NPM_FRAGMENT.tgz"
        export PATH="$HOME/.cargo/bin:$PATH"
      fi
    fi
    command -v cargo-about >/dev/null 2>&1 || cargo install --locked cargo-about
  fi
fi

echo "[gen-licenses] generating Rust license HTML..."
( cd "$TAURI_DIR" && cargo about generate about.hbs -o "$HTML_OUT" )

echo "[gen-licenses] collecting npm/bun dependencies..."
printf '<section class="npm">\n<h2>프론트엔드 (npm/bun)</h2>\n<ul>\n' >"$NPM_FRAGMENT"
{
  printf '['
  first=1
  while IFS= read -r line; do
    case "$line" in
      *"── "*) entry="${line##*── }" ;;
      *) continue ;;
    esac
    version="${entry##*@}"
    name="${entry%@*}"
    [ -z "$name" ] && continue
    [ -z "$version" ] && continue
    if [ "$first" -eq 1 ]; then first=0; else printf ','; fi
    printf '{"name":"%s","version":"%s"}' "$name" "$version"
    printf '<li>%s <span class="ver">%s</span></li>\n' "$name" "$version" >>"$NPM_FRAGMENT"
  done < <(cd "$REPO_ROOT" && bun pm ls 2>/dev/null)
  printf ']\n'
} >"$NPM_OUT"
printf '</ul>\n</section>\n' >>"$NPM_FRAGMENT"

echo "[gen-licenses] injecting npm list into HTML..."
awk -v frag="$NPM_FRAGMENT" '
  /<!--NPM_LIST-->/ { while ((getline l < frag) > 0) print l; next }
  { print }
' "$HTML_OUT" >"$HTML_OUT.tmp"
mv "$HTML_OUT.tmp" "$HTML_OUT"

html_bytes="$(wc -c <"$HTML_OUT" | tr -d ' ')"
license_blocks="$(grep -c '<h3 id=' "$HTML_OUT" || true)"
npm_count="$(grep -c '<li>' "$NPM_FRAGMENT" || true)"

if [ "$html_bytes" -lt 10000 ] || ! grep -q 'Permission is hereby granted' "$HTML_OUT"; then
  echo "[gen-licenses] ERROR: generated HTML looks incomplete ($html_bytes bytes)" >&2
  exit 1
fi

echo "[gen-licenses] done."
echo "  $HTML_OUT  (${html_bytes} bytes, ${license_blocks} Rust license blocks)"
echo "  $NPM_OUT  (${npm_count} npm packages)"
