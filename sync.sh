#!/usr/bin/env bash
# Copy this repo's layout and mods into Herdr's home, or pull live edits back.
#   ./sync.sh install   repo -> ~/.config/herdr-app (Herdr hot-reloads)
#   ./sync.sh pull      ~/.config/herdr-app -> repo (after editing in place)
set -euo pipefail
repo="$(cd "$(dirname "$0")" && pwd)"
home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
mods=(usage-limits pane-agent)
layouts=(alp)
case "${1:-}" in
  install) src="$repo" dst="$home" ;;
  pull)    src="$home" dst="$repo" ;;
  *) echo "usage: $0 install|pull" >&2; exit 2 ;;
esac
mkdir -p "$dst/layouts" "$dst/mods"
for l in "${layouts[@]}"; do cp "$src/layouts/$l.json" "$dst/layouts/$l.json"; done
for m in "${mods[@]}"; do
  rsync -a --delete --exclude gpui-kit.d.ts --exclude '*.bak' --exclude '*.error' "$src/mods/$m/" "$dst/mods/$m/"
done
echo "synced ${layouts[*]} + ${mods[*]}: $src -> $dst"
