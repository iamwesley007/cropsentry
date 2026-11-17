import { defineConfig } from "vite";

export default defineConfig({
  // Static build, hostable anywhere (Firebase Hosting, Netlify, any static host).
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  server: {
    port: 5173,
    // On-device inference via the Chrome Prompt API requires a secure context;
    // localhost qualifies. For LAN testing use a tunnel with HTTPS.
    host: "localhost",
  },
});
