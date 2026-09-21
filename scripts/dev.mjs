#!/usr/bin/env node
/**
 * One command for the whole backend: stubs, collector and BFF, with prefixed
 * output and a single Ctrl-C to stop all three. No dependency added for it.
 *
 * Each service runs in its own process group and is stopped by group. Killing
 * only the direct child is not enough: tsx spawns node underneath it, and an
 * orphaned grandchild keeps the port bound — the next start then fails with
 * EADDRINUSE, which is precisely the failure you do not want on demo day.
 */
import { spawn } from 'node:child_process';

const services = [
  ['stubs', 'services/stubs/src/index.ts', '\x1b[35m'],
  ['collector', 'services/collector/src/index.ts', '\x1b[36m'],
  ['bff', 'services/bff/src/index.ts', '\x1b[33m'],
];

const children = services.map(([name, entry, colour]) => {
  const child = spawn('npx', ['tsx', 'watch', entry], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    detached: true,
  });
  const prefix = `${colour}${name.padEnd(9)}\x1b[0m │ `;
  const relay = (stream, out) =>
    stream.on('data', (buf) => buf.toString().split('\n').filter(Boolean).forEach((l) => out.write(prefix + l + '\n')));
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);
  child.on('exit', (code) => code && console.error(`${prefix}exited with ${code}`));
  return child;
});

const stop = () => {
  for (const c of children) {
    try {
      process.kill(-c.pid, 'SIGTERM'); // negative pid: the whole process group
    } catch {
      /* already gone */
    }
  }
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
