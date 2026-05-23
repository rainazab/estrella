import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, 'data');

/* fakeApi — dev-only HTTP layer.
   Exposes /api/plan reading data/plan.json on each request, so editing
   the JSON (or swapping it for the Python model's output) is live with no
   restart. Swap for a real backend later by removing this plugin and
   pointing the frontend's API_BASE env var at the new host. */
function fakeApi() {
  return {
    name: 'linewise-fake-api',
    configureServer(server) {
      server.middlewares.use('/api/health', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, dataDir: DATA_DIR }));
      });

      server.middlewares.use('/api/plan', (_req, res) => {
        const file = path.join(DATA_DIR, 'plan.json');
        try {
          const raw = fs.readFileSync(file, 'utf-8');
          /* Re-parse + re-stringify so a malformed file fails loudly here
             rather than silently delivering garbage to the client. */
          const parsed = JSON.parse(raw);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(parsed));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'plan.json read failed', detail: String(err) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), fakeApi()],
});
