#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  MediCompare Pro — skrypt startowy (macOS / Linux)
#  Uruchamia backend + frontend i otwiera aplikację w przeglądarce.
# ════════════════════════════════════════════════════════════════════
set -e
cd "$(dirname "$0")"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
info(){ echo -e "${GREEN}▶${NC} $1"; }
warn(){ echo -e "${YELLOW}⚠${NC}  $1"; }
err(){ echo -e "${RED}✗${NC} $1"; }

echo "═══════════════════════════════════════════"
echo "   MediCompare Pro — uruchamianie"
echo "═══════════════════════════════════════════"

# ── 1. Sprawdź Node.js ─────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  err "Nie znaleziono Node.js. Zainstaluj z https://nodejs.org (wersja 18+)."
  exit 1
fi
NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Wymagany Node.js 18+. Masz: $(node -v)."
  exit 1
fi
info "Node.js $(node -v) — OK"

# ── 2. Sprawdź plik .env ───────────────────────────────────────────
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    warn "Utworzono .env z szablonu. WKLEJ swój klucz API do pliku .env i uruchom skrypt ponownie."
  else
    err "Brak pliku .env. Utwórz go z linią: ANTHROPIC_API_KEY=sk-ant-..."
  fi
  exit 1
fi

if ! grep -q "ANTHROPIC_API_KEY=sk-ant-" .env; then
  err "W pliku .env brak poprawnego klucza (musi zaczynać się od 'sk-ant-')."
  warn "Edytuj .env i wklej klucz z https://console.anthropic.com → Settings → API Keys"
  exit 1
fi
info "Plik .env z kluczem API — OK"

# ── 3. Instalacja zależności (jeśli brak) ──────────────────────────
if [ ! -d node_modules ]; then
  info "Instaluję zależności backendu…"
  npm install
fi
if [ ! -d frontend/node_modules ]; then
  info "Instaluję zależności frontendu…"
  (cd frontend && npm install)
fi
info "Zależności — OK"

# ── 4. Uruchom backend w tle ───────────────────────────────────────
info "Uruchamiam backend (port 3001)…"
node server.js &
BACKEND_PID=$!

# Posprzątaj procesy przy zamknięciu (Ctrl+C)
cleanup(){
  echo ""
  info "Zatrzymuję serwery…"
  kill "$BACKEND_PID" 2>/dev/null || true
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

# Poczekaj aż backend wstanie (healthcheck)
sleep 2
if command -v curl >/dev/null 2>&1; then
  if curl -s http://localhost:3001/api/health >/dev/null 2>&1; then
    info "Backend odpowiada na /api/health — OK"
  else
    warn "Backend jeszcze się uruchamia…"
  fi
fi

# ── 5. Uruchom frontend ────────────────────────────────────────────
info "Uruchamiam frontend (port 5173)…"
(cd frontend && npm run dev) &
FRONTEND_PID=$!

# ── 6. Otwórz przeglądarkę ─────────────────────────────────────────
sleep 4
URL="http://localhost:5173"
info "Otwieram $URL"
if command -v open >/dev/null 2>&1; then open "$URL"          # macOS
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" # Linux
fi

echo ""
echo "═══════════════════════════════════════════"
echo "   Aplikacja działa:  $URL"
echo "   Backend:           http://localhost:3001"
echo "   Naciśnij Ctrl+C, aby zatrzymać oba serwery."
echo "═══════════════════════════════════════════"

# Czekaj na procesy
wait
