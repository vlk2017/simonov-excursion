#!/bin/sh
# Пересобирает движок и данные Ордынки из движка Симонова. Запуск из папки ordynka.
set -e
cd "$(dirname "$0")/.."
cp ../js/app.js js/app.js
cp ../js/nav-core.js js/nav-core.js
cp ../index.html index.html
python3 tools/patch_engine.py
python3 tools/patch_html.py
python3 tools/build_points.py
python3 tools/build_docs.py
