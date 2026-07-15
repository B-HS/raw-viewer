#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIER1_DIR="$REPO_ROOT/tests/fixtures/tier1"
TIER2_DIR="$REPO_ROOT/tests/fixtures/tier2"

shopt -s nullglob
tier1_files=("$TIER1_DIR"/*.*)
if (( ${#tier1_files[@]} == 0 )); then
    printf 'tier1 is empty; run scripts/fetch-fixtures.sh first\n' >&2
    exit 1
fi

mkdir -p "$TIER2_DIR"

base=""
base_size=0
for f in "${tier1_files[@]}"; do
    size=$(wc -c < "$f")
    if [[ -z "$base" || $size -lt $base_size ]]; then
        base="$f"
        base_size=$size
    fi
done
base_ext="${base##*.}"

for pct in 10 50 90; do
    bytes=$(( base_size * pct / 100 ))
    head -c "$bytes" "$base" > "$TIER2_DIR/truncated-${pct}pct.${base_ext}"
done

# SPEC-GAP: filename-variant fixtures are hardlinks (ln -f), not byte copies, to avoid duplicating multi-GB of RAW binaries; content is bit-identical to tier1 so extension/path handling is exercised unchanged.
for f in "${tier1_files[@]}"; do
    name="$(basename "$f")"
    stem="${name%.*}"
    ext="${name##*.}"
    mixed="$(printf '%s' "${ext:0:1}" | tr '[:lower:]' '[:upper:]')${ext:1}"
    ln -f "$f" "$TIER2_DIR/mixedcase-${stem}.${mixed}"
done

ln -f "$base" "$TIER2_DIR/사진 'test' 폴더.${base_ext}"

emoji="$(printf '\xf0\x9f\x93\xb7')"
ln -f "$base" "$TIER2_DIR/aetherlens-${emoji}-camera.${base_ext}"

printf 'done: %s\n' "$TIER2_DIR"
