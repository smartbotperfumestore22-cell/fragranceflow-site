import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // second page: the private store dashboard (/dashboard/?t=…)
  build: { rollupOptions: { input: { main: "index.html", dashboard: "dashboard/index.html", admin: "admin/index.html" } } },
  server: { open: true },
});
