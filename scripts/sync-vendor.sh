#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIN_FILE="$REPO_ROOT/src-tauri/libraw.pin"
VENDOR_DIR="${VENDOR_DIR:-$REPO_ROOT/src-tauri/vendor/libraw}"
STAMP_FILE="$VENDOR_DIR/.vendored"

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
    LIBRAW_VERSION="$NEW_VERSION"
    LIBRAW_SHA256="${NEW_SHA256:-}"
fi

URL="${LIBRAW_URL_TEMPLATE/\{version\}/$LIBRAW_VERSION}"

if [[ "$MODE" == "sync" && -f "$STAMP_FILE" ]] && grep -qx "$LIBRAW_VERSION $LIBRAW_SHA256" "$STAMP_FILE"; then
    printf 'vendor up-to-date: LibRaw %s\n' "$LIBRAW_VERSION"
    exit 0
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

TARBALL="$WORK_DIR/libraw.tar.gz"
printf 'fetch  %s\n' "$URL"
curl -L --fail --retry 2 -A "raw-viewer-vendor/0.1 (dev)" -o "$TARBALL" "$URL"

ACTUAL_SHA256="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
if [[ -n "${LIBRAW_SHA256:-}" ]]; then
    if [[ "$ACTUAL_SHA256" != "$LIBRAW_SHA256" ]]; then
        printf 'sha256 mismatch: expected %s got %s\n' "$LIBRAW_SHA256" "$ACTUAL_SHA256" >&2
        exit 1
    fi
else
    LIBRAW_SHA256="$ACTUAL_SHA256"
    printf 'pinned new sha256: %s\n' "$LIBRAW_SHA256"
fi

EXTRACT_DIR="$WORK_DIR/libraw"
mkdir -p "$EXTRACT_DIR"
tar -xzf "$TARBALL" --strip-components=1 -C "$EXTRACT_DIR"

if [[ ! -f "$EXTRACT_DIR/libraw/libraw.h" ]]; then
    printf 'unexpected archive layout: libraw/libraw.h missing\n' >&2
    exit 1
fi
if find "$EXTRACT_DIR" -iname '*amaze*' | grep -q .; then
    printf 'GPL demosaic pack detected in archive - aborting (rule R4)\n' >&2
    exit 1
fi
if [[ ! -f "$EXTRACT_DIR/LICENSE.CDDL" ]]; then
    printf 'LICENSE.CDDL missing - cannot honor CDDL election\n' >&2
    exit 1
fi

printf '%s %s\n' "$LIBRAW_VERSION" "$LIBRAW_SHA256" > "$EXTRACT_DIR/.vendored"

if [[ -d "$VENDOR_DIR" ]]; then
    rm -rf "$VENDOR_DIR"
fi
mkdir -p "$(dirname "$VENDOR_DIR")"
mv "$EXTRACT_DIR" "$VENDOR_DIR"

if [[ "$MODE" == "update" ]]; then
    printf 'LIBRAW_VERSION=%s\nLIBRAW_SHA256=%s\nLIBRAW_URL_TEMPLATE=%s\n' "$LIBRAW_VERSION" "$LIBRAW_SHA256" "$LIBRAW_URL_TEMPLATE" > "$PIN_FILE"
    printf 'pin updated: LibRaw %s\n' "$LIBRAW_VERSION"
    printf 'next: cd src-tauri && cargo test && cargo deny check licenses\n'
fi

printf 'vendored: LibRaw %s -> %s\n' "$LIBRAW_VERSION" "$VENDOR_DIR"
