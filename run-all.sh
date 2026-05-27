#!/usr/bin/env bash
# Uruchamia backend i frontend jednocześnie (jedno polecenie: npm run codespace).
# Backend startuje w tle, frontend na pierwszym planie. Ctrl+C zatrzymuje oba.
set -e
cd "$(dirname "$0")"

# Sprawdź klucz API
if ! grep -q "ANTHROPIC_API_KEY=sk-ant-" .env 2>/dev/null; then
  echo ""
  echo "⚠️  UWAGA: w pliku .env brak poprawnego klucza API (sk-ant-...)."
  echo "    Backend wystartuje, ale analizy będą odrzucane do czasu wklejenia klucza."
  echo ""
fi

echo "▶ Uruchamiam backend (port 3001)…"
node server.js &
BACKEND_PID=$!

cleanup() {
  echo ""
  echo "▶ Zatrzymuję serwery…"
  kill "$BACKEND_PID" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

# Poczekaj aż backend wstanie
sleep 2

echo "▶ Uruchamiam frontend (port 5173)…"
echo "  Po starcie otwórz podgląd portu 5173 (zakładka PORTS w Codespaces)."
echo ""
cd frontend && npm run dev

# Gdyby frontend się zakończył — posprzątaj backend
cleanup
