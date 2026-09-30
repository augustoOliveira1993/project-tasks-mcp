import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const frontendRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ command }) => ({
  root: frontendRoot,
  base: command === 'serve' ? '/' : '/admin/',
  plugins: [react(), tailwindcss()],
  build: { outDir: resolve(frontendRoot, 'dist'), emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3443',
        changeOrigin: true,
        configure: proxy => {
          // The loopback-only dev proxy is the browser's trusted entry point to the backend.
          proxy.on('proxyReq', proxyRequest => proxyRequest.removeHeader('origin'));
        },
        rewrite: path => path.replace(/^\/api/, '')
      }
    }
  }
}));
