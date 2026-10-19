import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Resolve the shared package to its TypeScript source rather than its
      // CommonJS build: Rollup cannot tree-shake named exports out of the CJS
      // `__exportStar` output, and the source also gives the SPA hot reload
      // when a schema changes. The API keeps using the compiled dist.
      '@outreach/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    // Proxying keeps the browser on one origin, so the httpOnly refresh cookie
    // is sent with every request and no token has to live in localStorage.
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
