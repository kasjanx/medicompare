@echo off
REM ====================================================================
REM  MediCompare Pro - skrypt startowy (Windows)
REM  Uruchamia backend + frontend i otwiera aplikacje w przegladarce.
REM ====================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ===========================================
echo    MediCompare Pro - uruchamianie
echo ===========================================

REM -- 1. Sprawdz Node.js --------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo [BLAD] Nie znaleziono Node.js. Zainstaluj z https://nodejs.org ^(wersja 18+^).
  pause
  exit /b 1
)
for /f "tokens=1 delims=." %%a in ('node -v') do set NODEVER=%%a
set NODEVER=%NODEVER:v=%
if %NODEVER% LSS 18 (
  echo [BLAD] Wymagany Node.js 18+.
  node -v
  pause
  exit /b 1
)
echo [OK] Node.js wykryty:
node -v

REM -- 2. Sprawdz plik .env ------------------------------------------
if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo [UWAGA] Utworzono .env z szablonu.
    echo         WKLEJ swoj klucz API do pliku .env i uruchom skrypt ponownie.
  ) else (
    echo [BLAD] Brak pliku .env. Utworz go z linia: ANTHROPIC_API_KEY=sk-ant-...
  )
  pause
  exit /b 1
)

findstr /C:"ANTHROPIC_API_KEY=sk-ant-" .env >nul
if errorlevel 1 (
  echo [BLAD] W pliku .env brak poprawnego klucza ^(musi zaczynac sie od 'sk-ant-'^).
  echo        Edytuj .env i wklej klucz z https://console.anthropic.com
  pause
  exit /b 1
)
echo [OK] Plik .env z kluczem API

REM -- 3. Instalacja zaleznosci (jesli brak) ------------------------
if not exist "node_modules" (
  echo [INFO] Instaluje zaleznosci backendu...
  call npm install
)
if not exist "frontend\node_modules" (
  echo [INFO] Instaluje zaleznosci frontendu...
  pushd frontend
  call npm install
  popd
)
echo [OK] Zaleznosci gotowe

REM -- 4. Uruchom backend w nowym oknie ------------------------------
echo [INFO] Uruchamiam backend (port 3001)...
start "MediCompare - Backend" cmd /k "node server.js"

REM Poczekaj az backend wstanie
timeout /t 3 /nobreak >nul

REM -- 5. Uruchom frontend w nowym oknie -----------------------------
echo [INFO] Uruchamiam frontend (port 5173)...
start "MediCompare - Frontend" cmd /k "cd frontend && npm run dev"

REM -- 6. Otworz przegladarke ----------------------------------------
timeout /t 4 /nobreak >nul
echo [INFO] Otwieram http://localhost:5173
start "" "http://localhost:5173"

echo.
echo ===========================================
echo    Aplikacja dziala:  http://localhost:5173
echo    Backend:           http://localhost:3001
echo.
echo    Serwery dzialaja w osobnych oknach.
echo    Zamknij te okna, aby zatrzymac aplikacje.
echo ===========================================
echo.
pause
