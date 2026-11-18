#!/bin/bash
# Start the development app using this checkout's own environment.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 is required. Install it before continuing." >&2
  exit 1
fi
NODE_VERSION=$(node -v)
case "$NODE_VERSION" in
  v22.*) ;;
  *) echo "Node.js 22 is required. Current: $NODE_VERSION" >&2; exit 1 ;;
esac

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "Created .env from the template. Add your own development credentials, then run this script again."
  else
    echo "Missing .env and .env.example. See docs/SETUP_GUIDE.md." >&2
  fi
  exit 1
fi

if [ ! -d node_modules ]; then
  npm ci
fi

npx prisma generate
echo "Applying migrations to the database configured in this checkout's .env. Use your own development database."
npx prisma migrate deploy
echo "Starting Flowrish at http://localhost:3000"
npm run dev
