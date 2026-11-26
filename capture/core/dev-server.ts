import { existsSync, globSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';

// Capture (cinematic-captures branch only): the dev server's endpoints for the Capture panel.
//   GET  /__capture/shots              the shot files under capture/locations
//   GET  /__capture/file?path=<file>   a project, shot or font file (repository-relative or absolute)
//   POST /__capture/shot?path=<file>   saves a shot file under capture/ (the panel checks and
//                                      formats it; this module stays free of the app's code)
// Only `vite` serving the app (dev and test modes) has them; nothing ships.

const readable = new Set(['.json', '.ttf', '.otf', '.woff', '.woff2']);
const types: Record<string, string> = { '.json': 'application/json', '.ttf': 'font/ttf' };

export function captureEndpoints(): Plugin {
  const root = process.cwd();
  return {
    name: 'cityflows-capture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', (request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const fail = (status: number, message: string) => {
          response.statusCode = status;
          response.end(message);
        };
        if (url.pathname === '/shots') {
          response.setHeader('content-type', 'application/json');
          response.end(
            JSON.stringify(
              globSync('capture/locations/*/*.json', { cwd: root })
                .map((p) => p.replaceAll('\\', '/'))
                .sort(),
            ),
          );
          return;
        }
        const path = url.searchParams.get('path') ?? '';
        const file = resolve(root, path);
        if (url.pathname === '/file' && request.method === 'GET') {
          if (!readable.has(extname(file))) return fail(400, 'Not a project, shot or font file');
          if (!existsSync(file)) return fail(404, `No file at ${path}`);
          response.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
          response.end(readFileSync(file));
          return;
        }
        if (url.pathname === '/shot' && request.method === 'POST') {
          const inside = relative(resolve(root, 'capture'), file);
          if (inside.startsWith('..') || isAbsolute(inside) || extname(file) !== '.json')
            return fail(400, 'Shot files save under capture/');
          let body = '';
          request.on('data', (chunk) => (body += String(chunk)));
          request.on('end', () => {
            try {
              JSON.parse(body);
              writeFileSync(file, body);
              response.end('saved');
            } catch (error) {
              fail(400, error instanceof Error ? error.message : String(error));
            }
          });
          return;
        }
        fail(404, 'Unknown capture endpoint');
      });
    },
  };
}
