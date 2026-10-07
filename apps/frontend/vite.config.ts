import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        // Inside Docker the API is reached by service name, not localhost.
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
