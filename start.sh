#!/bin/bash

# Flowrish CRM — Development Start Script
# Usage: ./start.sh

set -e

echo "🌱 Flowrish CRM — Starting development environment..."
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js is not installed. Please install Node.js 20+."
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "❌ Node.js 20+ required. Current: $(node -v)"
  exit 1
fi

echo "✓ Node.js $(node -v)"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
  echo ""
  echo "📦 Installing dependencies..."
  npm install
else
  echo "✓ Dependencies installed"
fi

# Check .env file
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    echo ""
    echo "⚠️  No .env file found. Copying from .env.example..."
    cp .env.example .env
    echo "   Please edit .env with your actual credentials before continuing."
    echo "   See docs/SETUP_GUIDE.md for details."
    exit 1
  else
    echo "❌ No .env or .env.example file found."
    exit 1
  fi
fi

echo "✓ Environment file exists"

# Generate Prisma client if needed
if [ ! -d "src/generated/prisma" ]; then
  echo ""
  echo "🔧 Generating Prisma client..."
  npx prisma generate
else
  echo "✓ Prisma client generated"
fi

# Run migrations
echo ""
echo "🗄️  Running database migrations..."
npx prisma migrate deploy 2>/dev/null || {
  echo "⚠️  Migration failed — check your DATABASE_URL and DIRECT_URL in .env"
  echo "   Continuing anyway (database might already be up to date)..."
}

# Start dev server
echo ""
echo "🚀 Starting Next.js development server..."
echo "   → http://localhost:3000"
echo ""
npm run dev
