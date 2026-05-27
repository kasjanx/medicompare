/**
 * MediCompare Pro — Backend Proxy
 * ---------------------------------
 * Serwer pośredniczący (proxy) między aplikacją frontendową a API Anthropic.
 * Klucz API nigdy nie trafia do przeglądarki — jest dołączany wyłącznie tutaj.
 *
 * Endpointy:
 *   GET  /api/health     → status serwera i informacja czy klucz API jest ustawiony
 *   POST /api/claude     → proxy do https://api.anthropic.com/v1/messages
 *   (opcjonalnie) serwuje zbudowany frontend z katalogu /frontend/dist
 */

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const app = express();

// ── Konfiguracja ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const API_KEY = process.env.ANTHROPIC_API_KEY;
const REQUEST_TIMEOUT_MS = 120000; // 120 s — analiza dużych polis bywa długa

// ── Walidacja klucza API przy starcie ────────────────────────────────────────
const KEY_OK = typeof API_KEY === "string" && API_KEY.startsWith("sk-ant-");
if (!KEY_OK) {
  console.warn("\n⚠️  UWAGA: Brak poprawnego klucza ANTHROPIC_API_KEY w pliku .env");
  console.warn("    Serwer wystartuje, ale żądania do Claude będą odrzucane.");
  console.warn("    Ustaw klucz w pliku .env:  ANTHROPIC_API_KEY=sk-ant-api03-...\n");
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "50mb" })); // duże dokumenty/base64

// Proste logowanie żądań
app.use((req, _res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.path}`);
  next();
});

// ── Healthcheck ───────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    apiKeyConfigured: KEY_OK,
    timestamp: new Date().toISOString(),
  });
});

// ── Proxy do Claude ─────────────────────────────────────────────────────────
app.post("/api/claude", async (req, res) => {
  // 1. Sprawdź klucz
  if (!KEY_OK) {
    return res.status(500).json({
      error: {
        type: "configuration_error",
        message:
          "Brak poprawnego klucza API na serwerze. Ustaw ANTHROPIC_API_KEY w pliku .env i zrestartuj serwer.",
      },
    });
  }

  // 2. Walidacja ciała żądania
  const body = req.body;
  if (!body || typeof body !== "object" || !Array.isArray(body.messages)) {
    return res.status(400).json({
      error: {
        type: "invalid_request",
        message: "Nieprawidłowe ciało żądania — wymagane pole 'messages' (tablica).",
      },
    });
  }

  // 3. Timeout via AbortController
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // Przekaż odpowiedź (również błędy z Anthropic) bez modyfikacji
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    clearTimeout(timeout);

    if (err.name === "AbortError") {
      console.error("Żądanie przekroczyło limit czasu.");
      return res.status(504).json({
        error: {
          type: "timeout",
          message: `Przekroczono limit czasu (${REQUEST_TIMEOUT_MS / 1000}s). Spróbuj z mniejszym dokumentem.`,
        },
      });
    }

    console.error("Błąd proxy:", err.message);
    return res.status(502).json({
      error: {
        type: "proxy_error",
        message: "Błąd komunikacji z API Claude: " + err.message,
      },
    });
  }
});

// ── Opcjonalne serwowanie zbudowanego frontendu ──────────────────────────────
// Jeśli istnieje folder frontend/dist (po `npm run build`), serwer udostępni
// aplikację na tym samym porcie — wtedy wystarczy jeden terminal.
const DIST_DIR = path.join(__dirname, "frontend", "dist");
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get("*", (_req, res) => res.sendFile(path.join(DIST_DIR, "index.html")));
  console.log("ℹ️  Wykryto zbudowany frontend — będzie serwowany z /");
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log("\n══════════════════════════════════════════════════");
  console.log(`  ✅ Proxy MediCompare działa na http://localhost:${PORT}`);
  console.log(`  • Healthcheck:  http://localhost:${PORT}/api/health`);
  console.log(`  • Klucz API:    ${KEY_OK ? "skonfigurowany ✓" : "BRAK ✗"}`);
  console.log("══════════════════════════════════════════════════\n");
});
