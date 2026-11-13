#!/bin/sh
# Zips stage/ into <id>.app, the package Ludei's App Catalog installs.
set -e
cd "$(dirname "$0")"
id=$(python3 -c "import json;print(json.load(open('stage/manifest.json'))['id'])")
rm -f "$id.app"
(cd stage && zip -qr9X "../$id.app" .)
ls -l "$id.app"
