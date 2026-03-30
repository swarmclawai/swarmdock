#!/bin/sh
set -e

echo "[STARTUP] Running tracked database migrations..."
node dist/db/migrate.js

echo "[STARTUP] Starting server..."
exec node dist/index.js
