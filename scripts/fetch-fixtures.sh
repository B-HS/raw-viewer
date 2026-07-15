#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="$REPO_ROOT/tests/fixtures/tier1"
BASE_URL="https://raw.pixls.us/getfile.php"
USER_AGENT="raw-viewer-fixtures/0.1 (dev)"

FIXTURES=(
"canon-eos-r5.cr3|4694/nice/Canon%20-%20EOS%20R5%20-%203:2.CR3"
"canon-eos-5d-mark-iii.cr2|771/nice/Canon%20-%20EOS%205D%20Mark%20III.CR2"
"canon-eos-r7.cr3|5633/nice/Canon%20-%20EOS%20R7%20-%203:2.CR3"
"sony-a7r-iv.arw|3480/nice/Sony%20-%20ILCE-7RM4%20-%2014bit%2014bit%20compressed%20%283:2%29.ARW"
"sony-a1.arw|4465/nice/Sony%20-%20ILCE-1%20-%2014bit%2014bit%20compressed%20%283:2%29.ARW"
"nikon-z8.nef|6616/nice/Nikon%20-%20Z%208%20-%208bit%208bit%20compressed%20%283:2%29.NEF"
"nikon-d850.nef|1835/nice/Nikon%20-%20D850%20-%2012bit%2012bit%20compressed%20%28Lossless%29%20%283:2%29.NEF"
"fujifilm-x-t5.raf|6123/nice/Fujifilm%20-%20X-T5%20-%2014bit%2014bit%20compressed%20%283:2%29.RAF"
"fujifilm-gfx-100.raf|3775/nice/Fujifilm%20-%20GFX%20100%20-%2014bit%2014bit%20compressed%20%284:3%29.RAF"
"panasonic-s5.rw2|4096/nice/Panasonic%20-%20DC-S5%20-%203:2.RW2"
"om-system-om-1.orf|5283/nice/OM%20System%20-%20OM-1%20-%2016bit%20%284:3%29.ORF"
"leica-q2.dng|3204/nice/Leica%20-%20Q2%20-%2014bit%2014bit%20uncompressed%20%283:2%29.DNG"
"apple-iphone-12-pro.dng|4264/nice/Apple%20-%20iPhone%2012%20Pro%20-%208bit%20%284:3%29.DNG"
"pentax-k-3-mark-iii.pef|4677/nice/Pentax%20-%20K-3%20Mark%20III%20-%2014bit%20%283:2%29.PEF"
"leica-m-monochrom.dng|974/nice/Leica%20-%20M%20Monochrom%20-%2016bit%20%283:2%29.DNG"
"sigma-sd-quattro.x3f|6756/nice/Sigma%20-%20sd%20Quattro%20-%203:2.X3F"
)

mkdir -p "$DEST_DIR"

for entry in "${FIXTURES[@]}"; do
    filename="${entry%%|*}"
    url_path="${entry#*|}"
    dest="$DEST_DIR/$filename"
    if [[ -f "$dest" ]]; then
        printf 'skip   %s\n' "$filename"
        continue
    fi
    printf 'fetch  %s\n' "$filename"
    tmp="$dest.part"
    curl -L --fail --retry 2 -A "$USER_AGENT" -o "$tmp" "$BASE_URL/$url_path"
    mv "$tmp" "$dest"
done

printf 'done: %s\n' "$DEST_DIR"
