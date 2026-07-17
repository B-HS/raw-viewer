#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${RAW_VIEWER_BIN:-$REPO_ROOT/src-tauri/target/debug/raw-viewer}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ ! -x "$BIN" ]; then
    printf 'binary not found: %s (cargo build first)\n' "$BIN" >&2
    exit 1
fi

python3 - "$WORK/e2e.png" << 'EOF'
import sys
import zlib
from struct import pack

def chunk(tag, data):
    return pack('>I', len(data)) + tag + data + pack('>I', zlib.crc32(tag + data))

width, height = 40, 30
raw = b''.join(b'\x00' + bytes((120, 60, 200)) * width for _ in range(height))
payload = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
open(sys.argv[1], 'wb').write(payload)
EOF

sips -s format jpeg "$WORK/e2e.png" --out "$WORK/e2e.jpg" > /dev/null
FORMATS="e2e.png e2e.jpg"
if sips -s format heic "$WORK/e2e.png" --out "$WORK/e2e.heic" > /dev/null 2>&1; then
    FORMATS="$FORMATS e2e.heic"
fi
if sips -s format avif "$WORK/e2e.png" --out "$WORK/e2e.avif" > /dev/null 2>&1; then
    FORMATS="$FORMATS e2e.avif"
fi

STATUS=0
for file in $FORMATS; do
    for level in l0 l1 l2; do
        out="$WORK/out-$file-$level.bin"
        if ! "$BIN" __decode "$WORK/$file" "$level" "$out"; then
            printf 'FAIL decode %s %s (exit)\n' "$file" "$level" >&2
            STATUS=1
            continue
        fi
        if [ ! -s "$out" ]; then
            printf 'FAIL decode %s %s (empty body)\n' "$file" "$level" >&2
            STATUS=1
            continue
        fi
        width=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['width'])" "$WORK/out-$file-$level.json")
        if [ "$width" -le 0 ]; then
            printf 'FAIL decode %s %s (width %s)\n' "$file" "$level" "$width" >&2
            STATUS=1
            continue
        fi
        printf 'OK %s %s (width %s)\n' "$file" "$level" "$width"
    done
done
exit "$STATUS"
