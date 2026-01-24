@echo off
chcp 65001 >nul

if exist "node_modules" (
    echo [OK] node_modules found, starting...
    call npm run dev
) else (
    echo [..] Checking environment...
    
    node --version >nul 2>&1
    if errorlevel 1 (
        echo [ERR] Node.js not found!
        pause
        exit /b 1
    )
    echo [OK] Node.js found
    
    echo [..] Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERR] Install failed
        pause
        exit /b 1
    )
    
    echo [OK] Starting dev server...
    call npm run dev
)
pause
