#!/usr/bin/env node
/**
 * Enforces the monorepo's one dependency rule where TypeScript project references
 * cannot: apps/mobile sits outside the reference graph (Expo owns its build), so
 * nothing else would stop it importing server code. Tests are exempt — an
 * integration test is allowed to see the whole system; the product is not.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RULES = [
  { from: 'apps', forbid: [/from ['"](\.\.\/)+services\//, /from ['"]@sklum\/(bff|collector|stubs)['"]/] },
  { from: 'services', forbid: [/from ['"](\.\.\/)+apps\//, /from ['"]@sklum\/mobile['"]/] },
  { from: 'packages', forbid: [/from ['"](\.\.\/)+(apps|services|tools)\//, /from ['"]@sklum\/(?!events)/] },
];
const SKIP = new Set(['node_modules', 'ios', 'android', 'dist', '.expo']);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield path;
  }
}

const violations = [];
for (const rule of RULES) {
  for (const file of files(rule.from)) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of rule.forbid) {
      const hit = source.match(pattern);
      if (hit) violations.push(`${relative('.', file)}: ${hit[0]}`);
    }
  }
}

if (violations.length) {
  console.error('Dependency boundary violations:\n  ' + violations.join('\n  '));
  process.exit(1);
}
console.log('Dependency boundaries hold.');
