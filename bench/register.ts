import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

// The browser source uses bundler-style extensionless imports. Keep Node's native
// type stripping and resolve only those local imports, without a TS runtime dependency.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL && !/\.(ts|js|json)$/.test(specifier)) {
      for (const suffix of ['.ts', '/index.ts']) {
        const url = new URL(specifier + suffix, context.parentURL);
        if (existsSync(url)) return nextResolve(url.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
  // TASK-198: src/project/manifest.ts imports `version` from package.json as the bundler allows;
  // Node gives JSON a default export only, so a JSON module also exports its top-level keys.
  load(url, context, nextLoad) {
    // Packages' own JSON stays as Node loads it: Playwright `require`s its package.json (TASK-216).
    if (!url.startsWith('file:') || !url.endsWith('.json') || url.includes('/node_modules/'))
      return nextLoad(url, context);
    const value = JSON.parse(readFileSync(new URL(url), 'utf8')) as Record<string, unknown>;
    const keys = Object.keys(value);
    const source = [
      `const value = ${JSON.stringify(value)};`,
      ...keys.map((key, i) => `const v${i} = value[${JSON.stringify(key)}];`),
      `export { value as default, ${keys.map((key, i) => `v${i} as ${JSON.stringify(key)}`).join(', ')} };`,
    ].join('');
    return { format: 'module', source, shortCircuit: true };
  },
});
