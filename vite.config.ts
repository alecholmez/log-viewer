import { defineConfig } from 'vite';

// `npm run dev` serves the UI on 1420. In a browser, /api goes to the Rust dev server (`npm run core`).
// Inside the Tauri shell the UI calls the core directly and the proxy is unused.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    proxy: { '/api': 'http://127.0.0.1:1430' },
    watch: { ignored: ['**/src-tauri/**', '**/target/**', '**/crates/**'] },
  },
  build: { target: ['es2022', 'safari15'], chunkSizeWarningLimit: 900 },
});
