import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Resolves the "@/..." alias when running project files directly under Node.
 *
 * Next.js understands the alias from jsconfig.json; plain Node does not. Rather
 * than making the library code use relative paths for the benefit of one
 * script, the script teaches Node the alias the app already uses.
 */
const root = process.cwd();

export function resolve(specifier, context, next) {
  if (!specifier.startsWith('@/')) return next(specifier, context);

  const base = path.join(root, specifier.slice(2));
  // Mirror Node's own extension resolution, which the alias bypasses.
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return next(pathToFileURL(candidate).href, context);
    }
  }

  return next(specifier, context);
}
