// The one place the UI talks to the Rust core.
// Inside the Tauri shell the commands go over IPC. In a browser they go to the dev server at /api/<command>.
// Both end in the same `Session::dispatch`, so the UI behaves the same in either.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { DynoOut, LogMeta, Overview, Settings, Vehicle } from './types';

export const inTauri = '__TAURI_INTERNALS__' in window;

const ua = navigator.userAgent;
/** iPhone, iPad (which reports itself as a Mac with a touch screen) or Android. */
export const isMobile = /iPhone|iPad|iPod|Android/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

const fail = (e: unknown): never => {
  throw new Error(typeof e === 'string' ? e : e instanceof Error ? e.message : String(e));
};

async function call<T>(cmd: string, args: object = {}): Promise<T> {
  if (inTauri) return invoke<T>('call', { cmd, args }).catch(fail);
  const r = await fetch('/api/' + cmd, { method: 'POST', body: JSON.stringify(args) });
  if (!r.ok) throw new Error((await r.text()) || 'The core returned ' + r.status);
  return r.json();
}

async function callBytes(cmd: string, args: object = {}): Promise<ArrayBuffer> {
  if (inTauri) return invoke<ArrayBuffer>('call_bytes', { cmd, args }).catch(fail);
  const r = await fetch('/api/' + cmd, { method: 'POST', body: JSON.stringify(args) });
  if (!r.ok) throw new Error((await r.text()) || 'The core returned ' + r.status);
  return r.arrayBuffer();
}

export const api = {
  logs: () => call<LogMeta[]>('logs'),
  /** time base then every changing channel in channel order, little-endian f32 */
  logData: (key: string) => callBytes('log_data', { key }),
  loadText: (name: string, text: string) => call<{ key: string }>('load_text', { name, text }),
  removeLog: (key: string) => call<null>('remove_log', { key }),
  /** import every NSP .csv in a folder that is not in the library yet (desktop) */
  scanDir: (path: string) => call<{ added: string[]; errors: string[] }>('scan_dir', { path }),
  overview: () => call<Overview>('overview'),
  dyno: (vehicle: Vehicle, runs: (string | null)[]) => call<DynoOut>('dyno', { vehicle, runs }),
  getSettings: () => call<Settings | null>('get_settings'),
  setSettings: (value: Settings) => call<null>('set_settings', { value }),
};

/** Native folder picker. Desktop shell only. */
export async function pickFolder(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const r = await open({ directory: true, multiple: false, title: 'Folder to watch for NSP logs' });
  return typeof r === 'string' ? r : null;
}

/** The shell imported logs on its own: a file opened with the app, AirDrop, or the share sheet. */
export function onLogsChanged(fn: (msg: string) => void): void {
  if (inTauri) void listen<string>('logs-changed', e => fn(e.payload || ''));
}
