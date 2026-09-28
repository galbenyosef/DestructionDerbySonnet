import { defineConfig } from 'vite';

// Where the dev proxy forwards /ws. Overridable so a second stack (the smoke test) can run beside a live one.
const serverPort = process.env.WRECKYARD_SERVER_PORT ?? '8080';

export default defineConfig({
  root: 'src/client',
  publicDir: false,
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
    },
  },
});
