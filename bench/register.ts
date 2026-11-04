import { existsSync } from 'node:fs';
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
});
