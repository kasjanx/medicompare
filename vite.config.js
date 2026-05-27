import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy /api → backend na :3001 (w trybie deweloperskim).
// Dzięki temu frontend może wołać ścieżkę względną i nie ma problemów z CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,            // wymagane do działania w GitHub Codespaces
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
