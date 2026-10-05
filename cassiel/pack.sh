#!/bin/sh
# Builds Paint for Cassiel: only what it uses at run time, minified, into build/paint/
# and build/paint.capp (a zip the Setup wizard installs). The sources stay as they are
# (this is a fork of jspaint; the trimming happens here).
#   cassiel/pack.sh            → build/paint.capp
#   cassiel/pack.sh --install  → also installs it in the dev desktop (cassiel-dev)
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build/paint"
ESBUILD="${ESBUILD:-$HOME/apps/cassiel/node_modules/.bin/esbuild}"
rm -rf "$OUT" && mkdir -p "$OUT"
cd "$ROOT"

copy() { for f in "$@"; do mkdir -p "$OUT/$(dirname "$f")" && cp -R "$f" "$OUT/$f"; done; }

copy manifest.json index.html LICENSE.txt
copy src styles/normalize.css styles/layout.css styles/print.css styles/themes/modern.css styles/themes/cielo.css
copy lib/jquery-3.4.1.min.js lib/pako-2.0.3.min.js lib/UPNG.js lib/UTIF.js lib/bmp.js lib/anypalette-0.6.0.js \
  lib/FileSaver.js lib/font-detective.js lib/libtess.min.js lib/imagetracer_v1.2.5.js \
  lib/os-gui/access-keys.js
copy images/modern/options-transparency.svg \
  images/modern/options-transparency.png images/cursors images/icons/jspaint.svg images/icons/32x32.png \
  images/text-tools.png images/text-tools-mask.png images/options-magnification.svg images/options-magnification.png \
  images/options-airbrush-size.png images/transforms images/classic/tools.png images/classic/tools.svg

# Type declarations are for the editor only.
rm -f "$OUT"/src/*.d.ts

# Every module import must point at a file that is in the package (a missing one stops
# Paint from starting). Dynamic imports of what Cassiel never runs (Discord) are fine.
python3 - "$OUT" <<'PY'
import glob, os, re, sys
out = sys.argv[1]
missing = []
for f in glob.glob(f"{out}/src/*.js"):
    for m in re.finditer(r'(?:from|import)\s*"(\./[^"]+\.js)"', open(f).read()):
        if not os.path.exists(os.path.join(os.path.dirname(f), m.group(1))):
            missing.append(f"{os.path.basename(f)} imports {m.group(1)}")
if missing:
    sys.exit("Missing modules:\n  " + "\n  ".join(missing))
PY

# index.html: no comments or blank lines.
python3 - "$OUT/index.html" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
s = re.sub(r'<!--.*?-->', '', s, flags=re.S)
s = re.sub(r'\n\s*\n', '\n', s)
open(p, 'w').write(s)
PY

# The modules as two bundles instead of ~25 files (one request each, in a chain of
# imports): what runs before app-state.js, which must stay a classic script (its
# let/const are globals the modules read), and app.js after it. Code splitting keeps
# each module once, shared between the two. The integration script reaches functions.js
# and image-manipulation.js through window.paintModules.
python3 - "$OUT" <<'PY'
import os, re, sys
out = sys.argv[1]
page = os.path.join(out, "index.html")
html = open(page).read()
tags = re.findall(r'[ \t]*<script (?:type="module"|defer) src="src/([^"]+)"></script>\n', html)
modules = [m for m in tags if m not in ("app-state.js", "app.js")]
start = "".join(f'import "./{m}";\n' for m in modules)
start += 'import * as functions from "./functions.js";\nimport * as imageManipulation from "./image-manipulation.js";\n'
start += 'window.paintModules = { "functions.js": functions, "image-manipulation.js": imageManipulation };\n'
open(os.path.join(out, "src", "paint-start.js"), "w").write(start)
first = True
def swap(m):
    global first
    name = m.group(1)
    if name == "app-state.js":
        return m.group(0)
    if name == "app.js":
        return '\t<script type="module" src="bundle/app.js"></script>\n'
    if first:
        first = False
        return '\t<script type="module" src="bundle/paint-start.js"></script>\n'
    return ""
html = re.sub(r'[ \t]*<script (?:type="module"|defer) src="src/([^"]+)"></script>\n', swap, html)
open(page, "w").write(html)
PY
"$ESBUILD" "$OUT/src/paint-start.js" "$OUT/src/app.js" --bundle --splitting --format=esm --minify --log-level=error \
  --outdir="$OUT/bundle" --entry-names='[name]' --chunk-names='chunk-[hash]'
# Only the classic scripts stay in src/.
find "$OUT/src" -name '*.js' ! -name 'cassiel-integration.js' ! -name 'error-handling-basic.js' ! -name 'app-localization.js' ! -name 'app-state.js' -delete

# Vector art without editor metadata (Inkscape's), losslessly.
find "$OUT" -type f -name '*.svg' -size +8k | while read -r f; do npx --yes svgo@3 --quiet --multipass "$f" -o "$f"; done

# Minify scripts and styles in place (per file: modules keep their imports).
[ "${MINIFY:-1}" = 1 ] && find "$OUT" -type f -name '*.js' ! -name '*.min.js' ! -path "$OUT/bundle/*" | while read -r f; do "$ESBUILD" "$f" --minify --log-level=error --outfile="$f" --allow-overwrite; done
[ "${MINIFY:-1}" = 1 ] && find "$OUT" -type f -name '*.css' | while read -r f; do "$ESBUILD" "$f" --minify --log-level=error --outfile="$f" --allow-overwrite; done

(cd "$OUT" && rm -f "$ROOT/build/paint.capp" && zip -qr -9 -X "$ROOT/build/paint.capp" . -x '.*')
du -sh "$OUT" "$ROOT/build/paint.capp"
if [ "${1:-}" = "--install" ]; then
  ID="$(sed -n 's/.*"id": *"\([^"]*\)".*/\1/p' manifest.json | head -1)"
  docker exec cassiel-dev sh -c "rm -rf /data/apps/$ID && mkdir -p /data/apps"
  docker cp "$OUT" "cassiel-dev:/data/apps/$ID"
  echo "Installed $ID; reload the desktop."
fi
