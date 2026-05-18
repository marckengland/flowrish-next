@echo off
REM Flowrish CRM — Development Start Script (Windows)
REM Usage: start.bat

echo.
echo 🌱 Flowrish CRM — Starting development environment...
echo.

REM Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo ❌ Node.js is not installed. Please install Node.js 20+.
  exit /b 1
)

for /f "tokens=1 delims=v." %%a in ('node -v') do set NODE_MAJOR=%%a
echo ✓ Node.js found

REM Check if node_modules exists
if not exist "node_modules" (
  echo.
  echo 📦 Installing dependencies...
  call npm install
) else (
  echo ✓ Dependencies installed
)

REM Check .env file
if not exist ".env" (
  if exist ".env.example" (
    echo.
    echo ⚠️  No .env file found. Copying from .env.example...
    copy .env.example .env >nul
    echo    Please edit .env with your actual credentials before continuing.
    echo    See docs\SETUP_GUIDE.md for details.
    exit /b 1
  ) else (
    echo ❌ No .env or .env.example file found.
    exit /b 1
  )
)

echo ✓ Environment file exists

REM Generate Prisma client if needed
if not exist "src\generated\prisma" (
  echo.
  echo 🔧 Generating Prisma client...
  call npx prisma generate
) else (
  echo ✓ Prisma client generated
)

REM Run migrations
echo.
echo 🗄️  Running database migrations...
call npx prisma migrate deploy 2>nul
if %ERRORLEVEL% neq 0 (
  echo ⚠️  Migration failed — check your DATABASE_URL and DIRECT_URL in .env
  echo    Continuing anyway...
)

REM Start dev server
echo.
echo 🚀 Starting Next.js development server...
echo    → http://localhost:3000
echo.
call npm run dev
