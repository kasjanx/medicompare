# MediCompare Pro — Instrukcja uruchomienia

Aplikacja do analizy polis ubezpieczeń zdrowotnych z wykorzystaniem Claude AI.

Architektura: **frontend (React + Vite)** + **backend proxy (Node.js + Express)**. Backend chroni klucz API — nie trafia on nigdy do przeglądarki.

---

## ⚡ Szybki start (zalecane)

Po wykonaniu Kroku 1 i 2 (Node.js + klucz API w `.env`) wystarczy jeden skrypt:

- **Windows:** kliknij dwukrotnie **`start.bat`**
- **macOS / Linux:** w terminalu uruchom **`./start.sh`**

Skrypt sam sprawdzi Node.js, klucz w `.env`, zainstaluje zależności (przy pierwszym uruchomieniu), wystartuje backend i frontend oraz otworzy aplikację w przeglądarce.

Jeśli wolisz uruchamiać ręcznie — zobacz Krok 3–4 poniżej.

---

## Wymagania

- **Node.js w wersji 18 lub nowszej** (zalecane LTS 20.x / 22.x) — https://nodejs.org
- Klucz API Anthropic (Claude)

Sprawdź wersję w terminalu:
```
node -v
npm -v
```

---

## Krok 1 — Klucz API Claude

1. Wejdź na https://console.anthropic.com
2. Zaloguj się → po lewej **API Keys** → **Create Key**
3. Skopiuj klucz (zaczyna się od `sk-ant-api03-...`). Pokazuje się tylko raz.

---

## Krok 2 — Konfiguracja klucza w pliku `.env`

W głównym folderze aplikacji skopiuj plik `.env.example` na `.env`:

**Windows (PowerShell):**
```
copy .env.example .env
```
**macOS / Linux:**
```
cp .env.example .env
```

Otwórz plik `.env` i wklej swój klucz:
```
ANTHROPIC_API_KEY=sk-ant-api03-TwójKluczTutaj
PORT=3001
```
Zapisz plik.

---

## Krok 3 — Instalacja zależności

**Backend (główny folder):**
```
npm install
```

**Frontend (podfolder):**
```
cd frontend
npm install
cd ..
```

---

## Krok 4 — Uruchomienie (tryb deweloperski, 2 terminale)

**Terminal 1 — backend:**
```
node server.js
```
Pojawi się: `✅ Proxy MediCompare działa na http://localhost:3001`
oraz informacja, czy klucz API jest skonfigurowany.

**Terminal 2 — frontend:**
```
cd frontend
npm run dev
```
Pojawi się: `Local: http://localhost:5173/`

Otwórz w przeglądarce: **http://localhost:5173**

> Frontend automatycznie przekierowuje zapytania `/api` do backendu na porcie 3001 (konfiguracja w `frontend/vite.config.js`).

---

## Krok 5 (opcjonalnie) — Tryb produkcyjny (jeden terminal)

Możesz zbudować frontend i serwować całość z backendu na jednym porcie:

```
cd frontend
npm run build
cd ..
node server.js
```

Backend wykryje folder `frontend/dist` i udostępni aplikację pod adresem **http://localhost:3001**

---

## Weryfikacja działania

Sprawdź healthcheck backendu w przeglądarce lub terminalu:
```
http://localhost:3001/api/health
```
Odpowiedź `{"status":"ok","apiKeyConfigured":true,...}` oznacza, że wszystko działa.

---

## Jak używać

1. Kliknij strefę upload lub przeciągnij plik polisy (PDF, DOCX, JPG, PNG, XLSX, CSV)
2. Kliknij **„Analizuj polisę →"**
3. Poczekaj — Claude analizuje dokument
4. Przeglądaj wyniki, filtruj świadczenia, eksportuj do CSV

---

## Rozwiązywanie problemów

| Problem | Przyczyna / rozwiązanie |
|---|---|
| „Nie można połączyć się z serwerem proxy" | Backend nie działa — uruchom `node server.js` w osobnym terminalu |
| Healthcheck pokazuje `apiKeyConfigured: false` | Brak/nieprawidłowy klucz w `.env`. Klucz musi zaczynać się od `sk-ant-`. Zrestartuj backend po zmianie `.env` |
| Błąd 401 z API | Klucz nieprawidłowy lub wygasły — wygeneruj nowy w console.anthropic.com |
| Błąd 429 | Przekroczony limit zapytań — odczekaj chwilę |
| Przekroczono limit czasu (504) | Dokument zbyt duży — spróbuj mniejszego pliku |
| Port 3001/5173 zajęty | Zmień `PORT` w `.env` (backend) lub `server.port` w `vite.config.js` (frontend) |

---

## Struktura projektu

```
medicompare/
├── server.js            ← backend proxy (Express)
├── package.json         ← zależności backendu
├── start.sh             ← skrypt startowy (macOS/Linux)
├── start.bat            ← skrypt startowy (Windows)
├── .env                 ← Twój klucz API (utwórz z .env.example)
├── .env.example         ← szablon konfiguracji
└── frontend/
    ├── index.html
    ├── package.json     ← zależności frontendu
    ├── vite.config.js   ← konfiguracja Vite + proxy /api
    └── src/
        ├── main.jsx
        ├── App.jsx
        └── MediCompare.jsx  ← główny komponent aplikacji
```
