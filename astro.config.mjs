import { defineConfig } from 'astro/config';

// Fully static output. Dynamic work (billing, downloads) lives in the Worker under /api.
export default defineConfig({
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  server: { port: 4321 },
});
