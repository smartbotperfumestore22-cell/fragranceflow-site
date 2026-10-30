import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { catalogPlugin } from "./scripts/catalog-files.mjs";

export default defineConfig({
  plugins: [react(), catalogPlugin()],
  // second page: the private store dashboard (/dashboard/?t=…)
  build: { rollupOptions: { input: { main: "index.html", dashboard: "dashboard/index.html", admin: "admin/index.html", report: "dashboard/report.html", portal: "portal/index.html" } } },
  server: { open: true },
});
