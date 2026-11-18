@echo off
setlocal
cd /d "%~dp0"
if errorlevel 1 exit /b 1

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 is required. Install it before continuing. 1>&2
  exit /b 1
)
for /f "tokens=1 delims=." %%a in ('node -v') do set "NODE_MAJOR=%%a"
if not "%NODE_MAJOR%"=="v22" (
  echo Node.js 22 is required. 1>&2
  exit /b 1
)

if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo Created .env from the template. Add your own development credentials, then run this script again.
  ) else (
    echo Missing .env and .env.example. See docs\SETUP_GUIDE.md. 1>&2
  )
  exit /b 1
)

if not exist "node_modules" (
  call npm ci
  if errorlevel 1 exit /b 1
)

call npx prisma generate
if errorlevel 1 exit /b 1
echo Applying migrations to the database configured in this checkout's .env. Use your own development database.
call npx prisma migrate deploy
if errorlevel 1 exit /b 1
echo Starting Flowrish at http://localhost:3000
call npm run dev
exit /b %ERRORLEVEL%
