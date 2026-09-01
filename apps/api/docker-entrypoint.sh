#!/bin/sh
set -e

cd /app

echo "[entrypoint] installing dependencies..."
pnpm install --frozen-lockfile

echo "[entrypoint] running migrations..."
pnpm --filter @navar/db db:migrate

echo "[entrypoint] starting api (tsx watch)..."
exec pnpm --filter @navar/api dev
