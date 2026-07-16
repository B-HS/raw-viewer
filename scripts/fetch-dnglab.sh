#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="0.7.2"
TARGET="${DNGLAB_TARGET:-aarch64-apple-darwin}"
DEST="$REPO_ROOT/src-tauri/binaries/dnglab-$TARGET"

case "$TARGET" in
    aarch64-apple-darwin) ASSET="dnglab-macos-arm64_v${VERSION}.zip" ;;
    *)
        printf 'unsupported DNGLAB_TARGET: %s\n' "$TARGET" >&2
        exit 1
        ;;
esac

if [ -x "$DEST" ] && "$DEST" --version 2>/dev/null | grep -q "$VERSION"; then
    printf 'skip   dnglab %s (%s)\n' "$VERSION" "$TARGET"
    exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -sL --fail --retry 2 -o "$TMP/dnglab.zip" "https://github.com/dnglab/dnglab/releases/download/v${VERSION}/${ASSET}"
unzip -oq "$TMP/dnglab.zip" -d "$TMP"
mkdir -p "$(dirname "$DEST")"
mv "$TMP/dnglab" "$DEST"
chmod +x "$DEST"
printf 'fetched dnglab %s -> %s\n' "$VERSION" "$DEST"
