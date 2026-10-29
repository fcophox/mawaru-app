#!/bin/bash
# Creates ~/Applications/Mawaru.app: a launcher that serves this checkout's build (tools/serve.mjs)
# and opens it in its own window (Chrome app window, or the default browser).
# It points at this folder, so keep the repo where it is.
#   npm run app
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"      # apps opened from Finder don't get the shell's PATH
APP="$HOME/Applications/Mawaru.app"

cd "$ROOT"
"$NODE" node_modules/vite/bin/vite.js build

rm -rf "$APP"
mkdir -p "$HOME/Applications" "$HOME/Library/Logs"
# macOS refuses unsigned bundles whose executable is a shell script, so the bundle is an
# AppleScript applet (a real, ad-hoc signed binary) that runs the launcher below
osacompile -o "$APP" -e 'do shell script quoted form of (POSIX path of (path to resource "launch.sh"))'

cat > "$APP/Contents/Resources/launch.sh" <<EOF
#!/bin/bash
ROOT="$ROOT"
NODE="$NODE"
LOG="\$HOME/Library/Logs/Mawaru.log"
if [ ! -d "\$ROOT" ] || [ ! -x "\$NODE" ]; then
  osascript -e 'display alert "Mawaru" message "No encuentro el proyecto en '"\$ROOT"' o Node en '"\$NODE"'. ¿Está montado el disco? Si moviste el repo, vuelve a ejecutar npm run app."'
  exit 1
fi
cd "\$ROOT"
# rebuild when the sources changed since the last build
if [ ! -f dist/index.html ] || [ -n "\$(find src index.html -newer dist/index.html -print -quit)" ]; then
  "\$NODE" node_modules/vite/bin/vite.js build >>"\$LOG" 2>&1
fi
nohup "\$NODE" tools/serve.mjs --open >>"\$LOG" 2>&1 &
EOF
chmod +x "$APP/Contents/Resources/launch.sh"
# the extra resource changes the bundle: sign it again (ad hoc)
codesign --force --deep -s - "$APP" 2>/dev/null

echo "Listo: $APP (ábrela desde Launchpad, Spotlight o arrástrala al Dock)"
