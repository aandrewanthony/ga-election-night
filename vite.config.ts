import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** `npm run dev`: serve the Netlify results function locally. */
function resultsProxy(): Plugin {
  return {
    name: 'ga-results-dev',
    configureServer(server) {
      server.middlewares.use('/.netlify/functions/ga-results', async (req, res) => {
        const { default: handler } = await import('./netlify/functions/ga-results.mjs');
        const r: Response = await handler(new Request('http://localhost' + req.originalUrl));
        res.statusCode = r.status;
        res.setHeader('Content-Type', 'application/json');
        res.end(Buffer.from(await r.arrayBuffer()));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), resultsProxy()],
  // Relative asset paths so the same build runs from file:// inside the desktop app.
  base: './',
  server: { port: 1430, strictPort: true },
  clearScreen: false,
  build: { chunkSizeWarningLimit: 700, target: 'es2020' },
});
