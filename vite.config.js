import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import advisorHandler from './api/advisor.js';
import macroHandler from './api/macro.js';
import marketHandler from './api/market.js';
import importHandler from './api/import.js';
import forecastHandler from './api/forecast.js';
import assumptionsHandler from './api/assumptions.js';
import signalsHandler from './api/signals.js';

function apiDevServerPlugin() {
  const routes = {
    '/api/advisor': advisorHandler,
    '/api/macro': macroHandler,
    '/api/market': marketHandler,
    '/api/import': importHandler,
    '/api/forecast': forecastHandler,
    '/api/assumptions': assumptionsHandler,
    '/api/signals': signalsHandler,
  };

  return {
    name: 'api-dev-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0];
        const handler = routes[url];
        if (handler) {
          res.status = (code) => {
            res.statusCode = code;
            return res;
          };
          res.json = (data) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
            return res;
          };

          if (req.method === 'POST' || req.method === 'PUT') {
            const chunks = [];
            let bytes = 0;
            for await (const chunk of req) {
              bytes += chunk.length;
              if (bytes > 2_100_000) { res.status(413).json({message:'Request too large'}); return; }
              chunks.push(chunk);
            }
            const raw = Buffer.concat(chunks).toString();
            try {
              req.body = raw ? JSON.parse(raw) : {};
            } catch {
              req.body = {};
            }
          }

          try {
            await handler(req, res);
          } catch (err) {
            console.error(`[api-dev-server] Handler error for ${url}:`, err);
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
            }
          }
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  Object.assign(process.env, env);

  return {
    plugins: [react(), apiDevServerPlugin()],
  };
});
