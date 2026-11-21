import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// The API key sits in localStorage, so the built page is locked down: it can run only its own
// scripts and can talk only to the Anthropic API. (Not applied in dev, where Vite needs inline
// scripts and a websocket.) Inline styles are allowed because KaTeX and the tree layout use them.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data:",
  "connect-src https://api.anthropic.com",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const csp = (): Plugin => ({
  name: "feynman-csp",
  apply: "build",
  transformIndexHtml: (html) =>
    html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

export default defineConfig({
  // Relative asset paths, so the build works from any folder on a static host.
  base: "./",
  plugins: [react(), csp()],
  build: { outDir: "dist" },
});
