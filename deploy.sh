#!/bin/bash
set -e

export PATH="/root/.bun/bin:/usr/bin:/usr/local/bin:/bin:/usr/sbin:/sbin:$PATH"

DEPLOY_DIR="/var/www/falcon"
APP_DIR="$DEPLOY_DIR/apps/web"

echo "==> Pulling latest code..."
cd "$DEPLOY_DIR"
git fetch origin master
git reset --hard origin/master

echo "==> Installing dependencies..."
bun install

echo "==> Generating Prisma client..."
cd "$APP_DIR"
node /var/www/falcon/node_modules/.bin/prisma generate

echo "==> Syncing Prisma schema..."
node /var/www/falcon/node_modules/.bin/prisma db push --skip-generate

echo "==> Building..."
cd "$DEPLOY_DIR"
npx turbo run build --filter=web...

echo "==> Restarting PM2..."
cd "$APP_DIR"
pm2 restart ecosystem.config.js --update-env

echo "==> Deploy complete!"
