#!/usr/bin/env bash
# Build the deploy bundle: bundle the Worker, mirror static assets to public/.
set -e
cd "$(dirname "$0")"

npx esbuild worker.js --bundle --format=esm --outfile=dist-worker/worker.js
mkdir -p public/vendor public/data
cp dist-worker/worker.js worker.bundle.js
cp index.html app.js styles.css icon.svg manifest.webmanifest public/
cp vendor/minisearch.min.js public/vendor/
cp data/patients.json public/data/

echo "Build complete: worker.bundle.js + public/"
