# MediCompare Pro — wersja z API (gotowy pakiet Codespaces)

System do analizy i porównywania zakresów ubezpieczeń zdrowotnych z normalizacją
świadczeń wg ICD-9 PL. Ta wersja korzysta z silnika AI przez API i jest
przygotowana do uruchomienia w **GitHub Codespaces jednym kliknięciem**.

---

## 🚀 Uruchomienie w Codespaces (zalecane)

### Krok 1 — Wgraj projekt na GitHub
Utwórz repozytorium i wypchnij ten folder:
```bash
git init
git add .
git commit -m "MediCompare API"
git branch -M main
git remote add origin https://github.com/TWOJA-NAZWA/medicompare-api.git
git push -u origin main
```

> ⚠️ Plik `.env` z kluczem API jest celowo ignorowany przez `.gitignore` —
> nie trafi na GitHub. To prawidłowe i bezpieczne.

### Krok 2 — Otwórz Codespace
W repozytorium kliknij **Code → Codespaces → Create codespace on main**.

Środowisko zbuduje się automatycznie i zainstaluje wszystkie zależności
(konfiguracja w `.devcontainer/`). Zajmuje to 1–2 minuty.

### Krok 3 — Wklej klucz API
Otwórz plik `.env` (utworzony automatycznie) i wpisz swój klucz:
```
ANTHROPIC_API_KEY=sk-ant-api03-TwójKluczTutaj
```
Klucz pobierzesz z https://console.anthropic.com → Settings → API Keys.

### Krok 4 — Uruchom
W terminalu wpisz jedno polecenie:
```bash
npm run codespace
```
To uruchomi backend i frontend razem.

### Krok 5 — Otwórz aplikację
Przejdź do zakładki **PORTS** (na dole) i otwórz podgląd portu **5173**
(ikona globusa / „Open in Browser"). Aplikacja jest gotowa.

---

## Uruchomienie alternatywne (ręczne, dwa terminale)

```bash
# Terminal 1 — backend
node server.js

# Terminal 2 — frontend
cd frontend && npm run dev
```

---

## Jak działa w Codespaces

- **Frontend** (port 5173) komunikuje się z backendem przez ścieżkę względną
  `/api`, którą Vite przekierowuje do backendu na porcie 3001. Dzięki temu
  działa to w Codespaces bez problemów z CORS ani z adresami portów.
- **Backend** (port 3001) przechowuje klucz API i pośredniczy w wywołaniach do
  usługi AI. Klucz nigdy nie trafia do przeglądarki.

---

## Bezpieczeństwo

- **Nigdy nie commituj `.env`** z prawdziwym kluczem. `.gitignore` to blokuje —
  sprawdź `git status` przed pierwszym push (pliku `.env` nie powinno być na liście).
- Dostęp do repozytorium = dostęp do kodu źródłowego. Do testów u klienta przed
  sprzedażą rozważ wersję hybrydową na GitHub Pages (link zamiast kodu).

---

## Struktura

```
.
├── .devcontainer/
│   ├── devcontainer.json   ← konfiguracja środowiska Codespaces
│   ├── setup.sh            ← instalacja zależności (raz)
│   └── welcome.sh          ← komunikat powitalny
├── .vscode/
│   └── tasks.json          ← zadania uruchomieniowe VS Code
├── server.js               ← backend proxy
├── run-all.sh              ← launcher backend + frontend
├── package.json            ← zależności backendu + skrypt "codespace"
├── .env.example            ← szablon konfiguracji
├── .gitignore
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.js      ← proxy /api → :3001, host:true (dla Codespaces)
    └── src/
        ├── main.jsx
        ├── App.jsx
        └── MediCompare.jsx
```
