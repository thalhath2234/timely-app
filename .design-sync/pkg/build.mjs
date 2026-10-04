#!/usr/bin/env node
// Builds the design-sync wrapper package (.design-sync/pkg) into dist/:
//   dist/types/**      .d.ts emitted by tsc for index.ts and everything it reaches
//   dist/index.d.ts    types entry (package.json "types") with @/ aliases rewritten
//   dist/timely.css    compiled Tailwind stylesheet (cfg.cssEntry)
// The JS bundle itself is produced by the converter straight from index.ts.
// Usage (repo root): node .design-sync/pkg/build.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(PKG, '../..');
const WEB = join(ROOT, 'apps/web');
const DIST = join(PKG, 'dist');
const TYPES = join(DIST, 'types');

// Resolve react, @tanstack/react-query, motion... from the web app's install.
const nm = join(PKG, 'node_modules');
if (!existsSync(nm)) symlinkSync(relative(PKG, join(WEB, 'node_modules')), nm);

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// 1. Declarations.
execFileSync(join(WEB, 'node_modules/.bin/tsc'), ['-p', join(PKG, 'tsconfig.json')], { stdio: 'inherit' });

// 2. tsc keeps path aliases verbatim in .d.ts output; ts-morph (the converter)
//    doesn't read tsconfig paths, so rewrite them to relative specifiers.
const aliasTarget = (spec) => {
  if (spec.startsWith('@/')) return join(TYPES, 'apps/web', spec.slice(2));
  if (spec === '@timely/contract') return join(TYPES, 'packages/contract/src/index');
  if (spec.startsWith('@timely/contract/')) return join(TYPES, 'packages/contract/src', spec.slice('@timely/contract/'.length));
  return null;
};
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.d.ts') ? [p] : [];
});
for (const f of walk(TYPES)) {
  const src = readFileSync(f, 'utf8');
  const out = src.replace(/(from\s+|import\(\s*)(["'])([^"']+)\2/g, (m, pre, q, spec) => {
    const t = aliasTarget(spec);
    if (!t) return m;
    let rel = relative(dirname(f), t);
    if (!rel.startsWith('.')) rel = './' + rel;
    return `${pre}${q}${rel}${q}`;
  });
  if (out !== src) writeFileSync(f, out);
}
writeFileSync(join(DIST, 'index.d.ts'), 'export * from "./types/.design-sync/pkg/index";\n');

// 3. Stylesheet.
execFileSync(join(ROOT, '.ds-sync/node_modules/.bin/tailwindcss'),
  ['-i', join(PKG, 'tailwind.css'), '-o', join(DIST, 'timely.css')],
  { cwd: WEB, stdio: 'inherit' });
console.log(`built ${relative(ROOT, DIST)}`);
