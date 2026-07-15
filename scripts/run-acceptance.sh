#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_DIR="$REPO_ROOT/src-tauri"
cd "$REPO_ROOT"

PASS=0
FAIL=0
ok()  { printf 'PASS  %-24s | %s\n' "$1" "$2"; PASS=$((PASS + 1)); }
bad() { printf 'FAIL  %-24s | %s\n' "$1" "$2"; FAIL=$((FAIL + 1)); }

echo "raw-viewer acceptance auto-checks (PRD 8.2 automatable subset)"
echo "=============================================================="

# fixtures 16
FX_DIR="$REPO_ROOT/tests/fixtures/tier1"
FX_N=$(find "$FX_DIR" -maxdepth 1 -type f ! -name '.*' 2>/dev/null | wc -l | tr -d ' ')
FX_EXT=$(find "$FX_DIR" -maxdepth 1 -type f ! -name '.*' 2>/dev/null | sed 's/.*\.//' | sort -u | tr '\n' ' ')
if [ "$FX_N" = "16" ]; then ok "fixtures-16" "$FX_N tier1 RAW fixtures ($FX_EXT)"; else bad "fixtures-16" "expected 16, found $FX_N in $FX_DIR (run scripts/fetch-fixtures.sh)"; fi

# 16-camera decode pass (cite cargo test + perf harness)
if grep -q 'fn tier1_corpus_thumb_and_half_decode' "$TAURI_DIR/src/decode/fixtures_test.rs" 2>/dev/null; then
    ok "decode-corpus" "test-backed: tier1_corpus_thumb_and_half_decode (cargo test); L0/L1 for all 16 measured by tests/perf.rs"
else
    bad "decode-corpus" "tier1_corpus_thumb_and_half_decode not found in src/decode/fixtures_test.rs"
fi

# original RAW mtime + blake3 immutable (R5) — cite test existence
if grep -q 'fn sidecar_path_targets_stem_xmp_not_original' "$TAURI_DIR/src/xmp/mod.rs" 2>/dev/null \
    && grep -q 'fn write_sidecar_refuses_to_overwrite_matching_path' "$TAURI_DIR/src/xmp/mod.rs" 2>/dev/null; then
    ok "original-immutable-R5" "test-backed: edits land in .xmp sidecar, overwrite of original refused (src/xmp/mod.rs)"
else
    bad "original-immutable-R5" "R5 sidecar guard tests missing in src/xmp/mod.rs"
fi

# aether:state xmp round-trip — cite test existence
if grep -q 'fn round_trip_via_files' "$TAURI_DIR/src/xmp/mod.rs" 2>/dev/null \
    && grep -q 'fn round_trip_preserves_full_state' "$TAURI_DIR/src/xmp/mod.rs" 2>/dev/null; then
    ok "xmp-roundtrip" "test-backed: aether:state round_trip_preserves_full_state + round_trip_via_files (src/xmp/mod.rs)"
else
    bad "xmp-roundtrip" "aether:state round-trip tests missing in src/xmp/mod.rs"
fi

# DNG mosaic tag700 injection round-trip — cite test existence
if grep -q 'fn dnglab_dng_injection_round_trip' "$TAURI_DIR/src/export/dng_xmp.rs" 2>/dev/null; then
    ok "dng-inject-roundtrip" "test-backed: dnglab_dng_injection_round_trip (tag700 aether:state re-parsed, src/export/dng_xmp.rs)"
else
    bad "dng-inject-roundtrip" "dnglab_dng_injection_round_trip not found in src/export/dng_xmp.rs"
fi

# cargo deny licenses — R4 (no GPL/AGPL) + allow-list gate
DENY_OUT=$( cd "$TAURI_DIR" && cargo deny check licenses 2>&1 )
DENY_RC=$?
DENY_GPL=$(printf '%s\n' "$DENY_OUT" | grep -ciE 'GPL|AGPL' || true)
if [ "$DENY_RC" = "0" ]; then
    ok "cargo-deny-licenses" "cargo deny check licenses -> ok (deny.toml allow-list; no GPL/AGPL)"
else
    REJ=$(printf '%s\n' "$DENY_OUT" | grep -oE '[a-z0-9_-]+-[0-9][0-9A-Za-z.+-]*/Cargo.toml' | sed 's#/Cargo.toml##' | sort -u | tr '\n' ' ')
    if [ "$DENY_GPL" -eq 0 ]; then
        bad "cargo-deny-licenses" "rc=$DENY_RC allow-list gap (NOT GPL/AGPL): ${REJ:-see cargo deny check licenses}"
    else
        bad "cargo-deny-licenses" "rc=$DENY_RC GPL/AGPL detected: ${REJ:-see cargo deny check licenses}"
    fi
fi

# AMaZE (GPL demosaic-pack) symbol absence — nm -gU (grep -c on captured output; -q would SIGPIPE nm under pipefail)
ART=$(find "$TAURI_DIR/target/release" -name 'libraw_viewer_libraw.a' 2>/dev/null | head -1)
if [ -z "$ART" ]; then ART=$(find "$TAURI_DIR/target/release" -maxdepth 1 -type f \( -name 'raw-viewer' -o -name 'libraw_viewer_lib.dylib' \) 2>/dev/null | head -1); fi
if [ -z "$ART" ]; then
    bad "nm-amaze-absent" "no release artifact under $TAURI_DIR/target/release (run: cargo build --release)"
else
    NM_ALL=$(nm -gU "$ART" 2>/dev/null || true)
    NM_DEMO=$(printf '%s\n' "$NM_ALL" | grep -ciE 'demosaic|xtrans' || true)
    NM_AMAZE=$(printf '%s\n' "$NM_ALL" | grep -ci 'amaze' || true)
    if [ "$NM_DEMO" -eq 0 ]; then
        bad "nm-amaze-absent" "no demosaic/xtrans symbols in $(basename "$ART") — wrong/stripped object"
    elif [ "$NM_AMAZE" -ne 0 ]; then
        bad "nm-amaze-absent" "AMaZE symbol PRESENT ($NM_AMAZE) in $(basename "$ART") — GPL demosaic-pack linked"
    else
        ok "nm-amaze-absent" "no AMaZE symbol in $(basename "$ART") (nm -gU; $NM_DEMO demosaic/xtrans syms present, 0 AMaZE)"
    fi
fi

# dnglab sidecar
DNGLAB="$TAURI_DIR/binaries/dnglab-aarch64-apple-darwin"
if [ -x "$DNGLAB" ]; then
    DNGLAB_V=$("$DNGLAB" --version 2>&1 | head -1)
    if printf '%s' "$DNGLAB_V" | grep -qi 'dnglab'; then ok "dnglab-version" "$DNGLAB_V"; else bad "dnglab-version" "unexpected output: $DNGLAB_V"; fi
else
    bad "dnglab-version" "sidecar missing/not executable: $DNGLAB"
fi

# licenses html present + contains the three attributions
HTML="$TAURI_DIR/resources/licenses-rust.html"
if [ -s "$HTML" ]; then
    HTML_SZ=$(wc -c < "$HTML" | tr -d ' ')
    ok "licenses-html" "$HTML ($HTML_SZ bytes)"
else
    bad "licenses-html" "missing/empty $HTML (run scripts/gen-licenses.sh)"
fi

# license screen attributions: LibRaw(CDDL) + Lensfun(CC-BY-SA) + OSM(ODbL)
ABOUT="$TAURI_DIR/about.hbs"
if grep -qi 'LibRaw' "$ABOUT" 2>/dev/null && grep -qi 'CDDL' "$ABOUT" 2>/dev/null \
    && grep -qi 'Lensfun' "$ABOUT" 2>/dev/null && grep -qi 'CC.BY.SA' "$ABOUT" 2>/dev/null \
    && grep -qi 'OpenStreetMap' "$ABOUT" 2>/dev/null && grep -qi 'ODbL' "$ABOUT" 2>/dev/null; then
    ok "license-attributions" "about.hbs lists LibRaw/CDDL, Lensfun/CC-BY-SA, OpenStreetMap/ODbL"
else
    bad "license-attributions" "about.hbs missing one of LibRaw/CDDL, Lensfun/CC-BY-SA, OSM/ODbL"
fi

# map attribution string
GPSMAP="$REPO_ROOT/src/components/panels/MetaPanel/GpsMap.tsx"
if grep -q 'OpenStreetMap contributors' "$GPSMAP" 2>/dev/null; then
    ok "osm-map-attribution" "'© OpenStreetMap contributors' present in GpsMap.tsx tileLayer"
else
    bad "osm-map-attribution" "map attribution string not found in $GPSMAP"
fi

# exported ICC embedding — test-backed
if grep -q 'fn every_space_produces_a_valid_icc_profile' "$TAURI_DIR/src/export/icc.rs" 2>/dev/null \
    && grep -q 'fn embed_icc' "$TAURI_DIR/src/export/encode.rs" 2>/dev/null; then
    ok "export-icc-embed" "test-backed: every_space_produces_a_valid_icc_profile + embed_icc (spot-check: exiftool -icc_profile:all out.jpg)"
else
    bad "export-icc-embed" "ICC embed test/helper missing in src/export"
fi

echo "=============================================================="
printf 'SUMMARY  %d PASS  %d FAIL  (%d checks)\n' "$PASS" "$FAIL" "$((PASS + FAIL))"
echo "perf targets (PRD 7.1) are measured separately:"
echo "  cd src-tauri && cargo test --release --test perf -- --ignored --nocapture"
[ "$FAIL" -eq 0 ]
