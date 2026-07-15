#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIN_FILE="$REPO_ROOT/src-tauri/lensfun.pin"
DEST_DIR="${LENSFUN_DIR:-$REPO_ROOT/src-tauri/resources/lensfun}"
STAMP_FILE="$DEST_DIR/.vendored"

usage() {
    printf 'usage: %s [--update <version> [--sha256 <hash>]]\n' "$0"
    exit 1
}

MODE="sync"
NEW_VERSION=""
NEW_SHA256=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --update)
            MODE="update"
            NEW_VERSION="${2:?--update requires a version}"
            shift 2
            ;;
        --sha256)
            NEW_SHA256="${2:?--sha256 requires a hash}"
            shift 2
            ;;
        *) usage ;;
    esac
done

# shellcheck disable=SC1090
source "$PIN_FILE"

if [[ "$MODE" == "update" ]]; then
    LENSFUN_VERSION="$NEW_VERSION"
    LENSFUN_SHA256="${NEW_SHA256:-}"
fi

URL="${LENSFUN_URL_TEMPLATE/\{version\}/$LENSFUN_VERSION}"
ARCHIVE_PREFIX="lensfun-${LENSFUN_VERSION#v}"

if [[ "$MODE" == "sync" && -f "$STAMP_FILE" ]] && grep -qx "$LENSFUN_VERSION $LENSFUN_SHA256" "$STAMP_FILE"; then
    printf 'lensfun db up-to-date: %s\n' "$LENSFUN_VERSION"
    exit 0
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

TARBALL="$WORK_DIR/lensfun.tar.gz"
printf 'fetch  %s\n' "$URL"
curl -L --fail --retry 2 -A "raw-viewer-vendor/0.1 (dev)" -o "$TARBALL" "$URL"

ACTUAL_SHA256="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
if [[ -n "${LENSFUN_SHA256:-}" ]]; then
    if [[ "$ACTUAL_SHA256" != "$LENSFUN_SHA256" ]]; then
        printf 'sha256 mismatch: expected %s got %s\n' "$LENSFUN_SHA256" "$ACTUAL_SHA256" >&2
        exit 1
    fi
else
    LENSFUN_SHA256="$ACTUAL_SHA256"
    printf 'pinned new sha256: %s\n' "$LENSFUN_SHA256"
fi

EXTRACT_DIR="$WORK_DIR/extract"
mkdir -p "$EXTRACT_DIR"
tar -xzf "$TARBALL" -C "$EXTRACT_DIR" "$ARCHIVE_PREFIX/data/db"

DB_SRC="$EXTRACT_DIR/$ARCHIVE_PREFIX/data/db"
if [[ ! -d "$DB_SRC" ]]; then
    printf 'unexpected archive layout: %s missing\n' "$DB_SRC" >&2
    exit 1
fi
XML_COUNT="$(find "$DB_SRC" -maxdepth 1 -name '*.xml' | wc -l | tr -d ' ')"
if [[ "$XML_COUNT" -lt 1 ]]; then
    printf 'no xml profiles found in archive\n' >&2
    exit 1
fi

rm -rf "$DEST_DIR"
mkdir -p "$DEST_DIR"
find "$DB_SRC" -maxdepth 1 -name '*.xml' -exec cp {} "$DEST_DIR/" \;

printf '%s %s\n' "$LENSFUN_VERSION" "$LENSFUN_SHA256" > "$STAMP_FILE"

if [[ "$MODE" == "update" ]]; then
    printf 'LENSFUN_VERSION=%s\nLENSFUN_SHA256=%s\nLENSFUN_URL_TEMPLATE=%s\n' "$LENSFUN_VERSION" "$LENSFUN_SHA256" "$LENSFUN_URL_TEMPLATE" > "$PIN_FILE"
    printf 'pin updated: lensfun %s\n' "$LENSFUN_VERSION"
    printf 'next: cd src-tauri && cargo test\n'
fi

printf 'vendored: lensfun %s -> %s (%s xml profiles)\n' "$LENSFUN_VERSION" "$DEST_DIR" "$XML_COUNT"
