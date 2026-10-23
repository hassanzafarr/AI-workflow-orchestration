import { Injectable, signal } from '@angular/core';

function read(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) - keep in memory only */
  }
}

/** Per-browser operator identity and API token. */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  readonly actor = signal(read('wfo.actor', 'operator'));
  readonly token = signal(read('wfo.token', ''));
  readonly settingsOpen = signal(false);

  save(actor: string, token: string): void {
    this.actor.set(actor.trim() || 'operator');
    this.token.set(token.trim());
    write('wfo.actor', this.actor());
    write('wfo.token', this.token());
  }
}
