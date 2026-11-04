import { Injectable, signal } from '@angular/core';

const SEEN_KEY = 'wfo.onboarded';

function seenBefore(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** The first-visit tour: opens once per browser, and on demand from the rail. */
@Injectable({ providedIn: 'root' })
export class OnboardingService {
  readonly open = signal(false);
  readonly seen = signal(seenBefore());

  start(): void {
    this.open.set(true);
  }

  /** Closing the tour by any route (finish, skip, Esc) counts as seen. */
  close(): void {
    this.open.set(false);
    this.seen.set(true);
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* storage unavailable (private mode): the tour may show again next visit */
    }
  }
}
