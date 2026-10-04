// The dev server on a throwaway library, and the sample logs. Shared by the UI test and the website screenshots.

import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '..');
export const logs = readdirSync(join(root, 'testdata', 'logs'))
  .filter(f => f.endsWith('.csv'))
  .sort()
  .map(f => join(root, 'testdata', 'logs', f));

/** Starts the server and waits until it answers. `tmp` holds the library and anything else the caller puts there; `stop` deletes it. */
export async function startServer(port) {
  const bin = join(root, 'target', 'release', process.platform === 'win32' ? 'logviewer-dev.exe' : 'logviewer-dev');
  if (!existsSync(bin)) throw new Error('Build the dev server first: cargo build --release -p logviewer-dev');
  if (!existsSync(join(root, 'dist', 'index.html'))) throw new Error('Build the UI first: npm run build');
  const url = 'http://127.0.0.1:' + port + '/';
  // a server left over from an earlier run would answer in place of the one started here, with its old library and old core
  const portInUse = await fetch(url).then(
    () => true,
    () => false,
  );
  if (portInUse) throw new Error('Port ' + port + ' is in use. Stop the process listening on it, then run this again.');
  const tmp = mkdtempSync(join(tmpdir(), 'logviewer-test-'));
  const server = spawn(bin, ['--port', String(port), '--dir', join(tmp, 'library'), '--dist', join(root, 'dist')], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      await (await fetch(url)).text();
      break;
    } catch {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  const stop = () => {
    server.kill();
    rmSync(tmp, { recursive: true, force: true });
  };
  return { url, tmp, stop };
}

/** Resolves once the page has the library from the core. */
export const libraryOpen = page => page.waitForFunction(() => document.getElementById('sub').textContent !== 'Opening the library');

/** Adds the sample logs through the file input and waits for them to be listed. */
export async function importLogs(page) {
  await page.setInputFiles('#file', logs);
  await page.waitForFunction(n => document.querySelectorAll('#logs .log').length === n, logs.length, { timeout: 30000 });
}
