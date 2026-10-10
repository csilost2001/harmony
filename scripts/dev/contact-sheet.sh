#!/usr/bin/env bash
# contact-sheet <dir> — ui-shots の出力を 6 枚ずつのまとめ画像にする (目視確認用)
set -euo pipefail
dir="$1"; cd "$dir"
files=(dashboard screen-flow screen-list screen-design screen-items table-list table-edit er process-flow-list process-flow-edit sequence-list view-list view-definition-list page-layout-list page-layout-edit gadget-list generic-definition conventions extensions tech-stack)
exist=(); for f in "${files[@]}"; do [ -f "$f.png" ] && exist+=("$f.png"); done
i=0; n=1
while [ $i -lt ${#exist[@]} ]; do
  montage "${exist[@]:$i:6}" -tile 2x3 -geometry 960x600+4+4 "_sheet-$n.png"
  i=$((i+6)); n=$((n+1))
done
ls _sheet-*.png
