import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { createServer, type Plugin } from 'vite';
import { parseShot } from './shot';

// Intro mock (not a product feature): a page for tuning the intro's exposure and camera keys on
// the real app, before bench/intro/render.ts renders them.
//   node --experimental-strip-types --import ./bench/register.ts bench/intro/tuner.ts <project.json> [--shot=<file>]
// Then open the printed URL. Save writes the shot file (bench/intro/shot.json by default).
const [projectPath] = process.argv.slice(2);
const shotPath = resolve(
  process.argv.find((a) => a.startsWith('--shot='))?.slice(7) ?? 'bench/intro/shot.json',
);
if (!projectPath) throw new Error('Expected <project.json>');
const port = 5297;

const endpoints: Plugin = {
  name: 'intro-tuner',
  configureServer(server) {
    server.middlewares.use('/__intro/project', (_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(readFileSync(projectPath));
    });
    // The subtitle's font (fetched once into the cache) and the app's version, for the title.
    server.middlewares.use('/__intro/font', (_request, response) => {
      response.setHeader('content-type', 'font/ttf');
      response.end(
        readFileSync('node_modules/.cache/cityflows/intro/cormorant-garamond-italic-full.ttf'),
      );
    });
    server.middlewares.use('/__intro/version', (_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version));
    });
    server.middlewares.use('/__intro/shot', (request, response) => {
      if (request.method !== 'POST') {
        response.setHeader('content-type', 'application/json');
        response.end(readFileSync(shotPath));
        return;
      }
      let body = '';
      request.on('data', (chunk) => (body += String(chunk)));
      request.on('end', () => {
        try {
          const shot = parseShot(JSON.parse(body));
          writeFileSync(shotPath, `${JSON.stringify(shot, null, 2)}\n`);
          response.end('saved');
        } catch (error) {
          response.statusCode = 400;
          response.end(String(error));
        }
      });
    });
  },
};

const server = await createServer({
  plugins: [endpoints],
  server: { host: 'localhost', port, strictPort: true },
});
await server.listen();
console.info(`Intro tuner: http://localhost:${port}/bench/intro/tuner.html`);
console.info(`Saving to ${shotPath}`);
