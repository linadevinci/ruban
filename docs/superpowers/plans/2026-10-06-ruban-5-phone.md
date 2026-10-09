# Ruban Plan 5 — Phone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ruban a real phone app: installable, fully usable offline, and able to tell you at 20h on a Wednesday that there is no dinner tonight.

**Architecture:** A service worker precaches the app shell so launching never touches the network, and carries the `push` and `notificationclick` handlers. Reminders are *not* scheduled in the browser — an hourly GitHub Actions workflow pokes `/api/cron/reminders`, which works out whose local hour has arrived, claims each send in `sent_reminders` before dispatching it, and so cannot double-send however often it is polled.

**Tech Stack:** `vite-plugin-pwa` with the `injectManifest` strategy (we need our own service worker for push), Workbox routing/precaching, `web-push` with VAPID, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-06-coquette-tracker-design.md` — §9.

**Depends on:** Plans 1–4 complete.

## Global Constraints

Plan 1's Global Constraints apply in full. Added here:

- **Hourly polling, not a scheduled time.** GitHub Actions crons are UTC-only with no DST awareness, so a fixed time silently shifts by an hour on **25 October 2026**. The endpoint does the timezone thinking.
- **At-most-once delivery.** `sent_reminders` is claimed *before* the push is sent, unique on `(userId, date, kind)`.
- **Push is an enhancement, never a dependency.** Every feature works with notifications refused or unavailable.
- **iOS requires the PWA be installed to the home screen** before `Notification.requestPermission` can succeed. The app detects standalone mode and walks the user through installing *first*, rather than asking for a permission that cannot be granted.
- **The subscription request must originate in a user gesture.** Never on page load.
- **`/api/*` is never cached.** A stale sync response is worse than no response.

---

## File Structure

| File | Responsibility |
|---|---|
| `public/logo.svg` | Source artwork for every icon. |
| `vite.config.ts` | `vite-plugin-pwa` config and the web manifest. |
| `src/sw.ts` | Service worker: precache, SPA navigation fallback, `push`, `notificationclick`. |
| `src/pwa/install.ts` | Standalone detection and platform-specific install guidance. Pure. |
| `src/pwa/push.ts` | Permission request, subscribe, POST the subscription. |
| `src/features/account/Notifications.tsx` | The install-then-enable flow, inside "Moi". |
| `api/push/subscribe.ts` | Store or refresh a subscription. |
| `api/_lib/dispatch.ts` | `dueReminders()` — which reminders are due in this hour. Pure, tested. |
| `api/cron/reminders.ts` | Claim, render and send. |
| `.github/workflows/reminders.yml` | The hourly poke. |

---

### Task 1: Icons and the web manifest

**Files:**
- Create: `public/logo.svg`
- Modify: `vite.config.ts`, `index.html`

`vite-plugin-pwa` 2.x declares `vite ^8`, `workbox-build ^7.4.1`, `workbox-window ^7.4.1` and `@vite-pwa/assets-generator` as peers — verified compatible with this project's Vite 8, and the two workbox peers are why they are installed explicitly below.

```bash
npm install -D vite-plugin-pwa @vite-pwa/assets-generator
npm install workbox-precaching workbox-routing workbox-strategies
npm install -D workbox-build workbox-window
```

**Interfaces:**
- Produces: `/manifest.webmanifest`, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`, `favicon.ico`.

- [ ] **Step 1: Write the source artwork**

`public/logo.svg` — the bow on the blush ground, so the home-screen icon is the same motif as a ticked box:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#F7E3E6"/>
  <g transform="translate(256 256) scale(14) translate(-12 -12)" fill="#A64264">
    <path d="M12 12c-1.6-2.6-4-4.2-6.2-3.6C3.9 8.9 3 10.4 3 12s.9 3.1 2.8 3.6C8 16.2 10.4 14.6 12 12z"/>
    <path d="M12 12c1.6-2.6 4-4.2 6.2-3.6C20.1 8.9 21 10.4 21 12s-.9 3.1-2.8 3.6C16 16.2 13.6 14.6 12 12z"/>
    <circle cx="12" cy="12" r="1.9"/>
    <path d="M11 13.4 8.6 20.4l3.4-2.3 3.4 2.3L13 13.4z"/>
  </g>
</svg>
```

- [ ] **Step 2: Generate the icon set**

```bash
npx pwa-assets-generator --preset minimal-2023 public/logo.svg
```

Expected: PNGs written into `public/`. Confirm `public/pwa-512x512.png` exists before continuing.

- [ ] **Step 3: Configure the plugin**

In `vite.config.ts`, add the import and the plugin:

```ts
import { VitePWA } from 'vite-plugin-pwa';
```

```ts
plugins: [
  react(),
  VitePWA({
    strategies: 'injectManifest',
    srcDir: 'src',
    filename: 'sw.ts',
    registerType: 'autoUpdate',
    injectManifest: {
      globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
    },
    manifest: {
      name: 'Ruban',
      short_name: 'Ruban',
      description: 'Ta checklist, ton poids, tes sorties.',
      lang: 'fr',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#F7E3E6',
      theme_color: '#F7E3E6',
      icons: [
        { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    devOptions: { enabled: false, type: 'module' },
  }),
],
```

In `index.html` `<head>`, add:

```html
<link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png">
<meta name="theme-color" content="#F7E3E6">
```

Note the theme colour is the light ground in both themes. A theme-aware browser chrome needs two `<meta name="theme-color" media="...">` tags; add the dark one only if the status bar looks wrong on the real device, because getting it wrong is more visible than leaving it.

- [ ] **Step 4: Verify the manifest builds**

Run: `npm run build && ls -la dist/manifest.webmanifest dist/pwa-512x512.png`
Expected: both exist.

- [ ] **Step 5: Commit**

```bash
git add public vite.config.ts index.html package.json package-lock.json
git commit -m "feat: add PWA manifest and the bow icon set"
```

---

### Task 2: The service worker

**Files:**
- Create: `src/sw.ts`
- Modify: `src/main.tsx` (register)

**Interfaces:**
- Produces: a service worker that precaches the shell, serves SPA navigations from cache, never caches `/api/*`, and handles `push` and `notificationclick`.

**Do not add `"WebWorker"` to `compilerOptions.lib`.** It would have to go in `tsconfig.app.json` (the root tsconfig has no `compilerOptions`), and loading `DOM` and `WebWorker` together produces conflicting global declarations. The `/// <reference lib="webworker" />` at the top of `sw.ts`, plus its local `declare const self`, scopes the worker types to that one file — which is why the file is written that way.

- [ ] **Step 1: Write the worker**

```ts
/// <reference lib="webworker" />
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);

// Every in-app route is served by the cached shell, so launching never needs
// the network. /api is excluded or a stale sync response could be replayed.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), {
  denylist: [/^\/api\//],
}));

registerRoute(({ url }) => url.pathname.startsWith('/api/'), new NetworkOnly());

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload: PushPayload;
  try {
    payload = event.data.json() as PushPayload;
  } catch {
    payload = { title: 'Ruban', body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      // A tag collapses a repeat of the same reminder instead of stacking it.
      tag: payload.tag ?? 'ruban',
      data: { url: payload.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | null)?.url ?? '/';

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
```

- [ ] **Step 2: Register it**

In `src/main.tsx`, add after the imports:

```ts
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });
```

If TypeScript does not know `virtual:pwa-register`, **append** `"vite-plugin-pwa/client"` to `compilerOptions.types` in `tsconfig.app.json` — append, never replace: the array already holds `"vite/client"`, and dropping it breaks every `import.meta.env` reference.

- [ ] **Step 3: Verify offline launch**

```bash
npm run build && npx vite preview
```

Open the preview URL, load it once, then in DevTools → Network set "Offline" and reload. Expected: the app launches and the Today screen renders from IndexedDB. If you get the browser's offline page, the navigation route is not registered.

- [ ] **Step 4: Confirm /api is not cached**

Still offline, tap "Synchroniser". Expected: it fails quietly and the pending count stays — it must not return a cached success.

- [ ] **Step 5: Commit**

```bash
git add src/sw.ts src/main.tsx tsconfig.json
git commit -m "feat: add the service worker with offline shell and push handlers"
```

---

### Task 3: Install detection

**Files:**
- Create: `src/pwa/install.ts`
- Test: `src/pwa/install.test.ts`

**Interfaces:**
- Produces:
  - `isStandalone(): boolean`
  - `detectPlatform(userAgent: string): 'ios' | 'android' | 'desktop'`
  - `installSteps(platform): string[]` — French, device-specific
  - `pushSupported(): boolean`
  - `canEnablePush(platform, standalone, supported): { ok: true } | { ok: false; reason: 'install-first' | 'unsupported' }`

`canEnablePush` is pure and carries the one rule that is easy to get wrong: on iOS, push is impossible until the app is on the home screen, so the UI must say "install first" rather than offer a button that fails.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { canEnablePush, detectPlatform, installSteps } from '@/pwa/install';

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

describe('detectPlatform', () => {
  it('recognises iOS, Android and desktop', () => {
    expect(detectPlatform(IOS)).toBe('ios');
    expect(detectPlatform(ANDROID)).toBe('android');
    expect(detectPlatform(DESKTOP)).toBe('desktop');
  });

  it('treats an iPad reporting as Macintosh with touch as iOS', () => {
    expect(detectPlatform('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)')).toBe('ios');
  });
});

describe('installSteps', () => {
  it('gives iOS the Partager → sur l’écran d’accueil route', () => {
    const steps = installSteps('ios');
    expect(steps.length).toBeGreaterThan(1);
    expect(steps.join(' ')).toMatch(/Partager/);
    expect(steps.join(' ')).toMatch(/écran d’accueil/);
  });

  it('gives Android its own route', () => {
    expect(installSteps('android').join(' ')).toMatch(/Installer/);
  });

  it('never returns an empty list', () => {
    for (const p of ['ios', 'android', 'desktop'] as const) {
      expect(installSteps(p).length).toBeGreaterThan(0);
    }
  });
});

describe('canEnablePush', () => {
  it('refuses on iOS until the app is installed', () => {
    expect(canEnablePush('ios', false, true)).toEqual({ ok: false, reason: 'install-first' });
    expect(canEnablePush('ios', true, true)).toEqual({ ok: true });
  });

  it('allows Android in the browser', () => {
    expect(canEnablePush('android', false, true)).toEqual({ ok: true });
  });

  it('refuses when the browser has no push at all', () => {
    expect(canEnablePush('android', true, false)).toEqual({ ok: false, reason: 'unsupported' });
    expect(canEnablePush('ios', true, false)).toEqual({ ok: false, reason: 'unsupported' });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- pwa/install`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export type Platform = 'ios' | 'android' | 'desktop';

export function isStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS Safari's own flag, which predates the media query.
  return (window.navigator as { standalone?: boolean }).standalone === true;
}

export function detectPlatform(userAgent: string): Platform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'desktop';
}

export function installSteps(platform: Platform): string[] {
  if (platform === 'ios') {
    return [
      'Ouvre Ruban dans Safari.',
      'Touche le bouton Partager, en bas de l’écran.',
      'Choisis « Sur l’écran d’accueil ».',
      'Ouvre Ruban depuis l’icône, pas depuis Safari.',
    ];
  }
  if (platform === 'android') {
    return [
      'Ouvre le menu de Chrome, en haut à droite.',
      'Choisis « Installer l’application ».',
      'Ouvre Ruban depuis l’icône.',
    ];
  }
  return [
    'Dans la barre d’adresse, clique sur l’icône d’installation.',
    'Confirme l’installation.',
  ];
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/**
 * On iOS, web push only works once the PWA is on the home screen. Asking for
 * permission before that fails silently, so the UI must send the user to
 * install first instead of offering a button that cannot work.
 */
export function canEnablePush(
  platform: Platform,
  standalone: boolean,
  supported: boolean,
): { ok: true } | { ok: false; reason: 'install-first' | 'unsupported' } {
  if (!supported) return { ok: false, reason: 'unsupported' };
  if (platform === 'ios' && !standalone) return { ok: false, reason: 'install-first' };
  return { ok: true };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- pwa/install`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/pwa/install.ts src/pwa/install.test.ts
git commit -m "feat: add install detection and platform-specific guidance"
```

---

### Task 4: Push subscription

**Files:**
- Create: `src/pwa/push.ts`, `api/push/subscribe.ts`
- Test: `src/pwa/push.test.ts`

```bash
npm install web-push
npm install -D @types/web-push
```

**Interfaces:**
- Produces:
  - `urlBase64ToUint8Array(base64: string): Uint8Array` — pure, tested
  - `enablePush(vapidPublicKey: string): Promise<'granted' | 'denied' | 'unsupported'>`
  - `POST /api/push/subscribe`

Generate the key pair once and store it in Vercel:

```bash
npx web-push generate-vapid-keys
```

Add `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` to Vercel's environment variables, and `VITE_VAPID_PUBLIC_KEY` (the public one again, so the client bundle can read it).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { urlBase64ToUint8Array } from '@/pwa/push';

describe('urlBase64ToUint8Array', () => {
  it('decodes a URL-safe base64 key to bytes', () => {
    // "Hello" in standard base64 is SGVsbG8=
    expect([...urlBase64ToUint8Array('SGVsbG8')]).toEqual([72, 101, 108, 108, 111]);
  });

  it('translates - and _ back to + and /', () => {
    const bytes = urlBase64ToUint8Array('-_8');
    expect([...bytes]).toEqual([251, 255]);
  });

  it('pads a string whose length is not a multiple of four', () => {
    expect(() => urlBase64ToUint8Array('SGVsbG8gd29ybGQ')).not.toThrow();
  });

  it('produces the 65 bytes a VAPID P-256 key decodes to', () => {
    const key = 'B'.repeat(87); // 87 base64url chars → 65 bytes
    expect(urlBase64ToUint8Array(key).length).toBe(65);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- pwa/push`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the client half**

`src/pwa/push.ts`:

```ts
import { pushSupported } from '@/pwa/install';

/** The Push API wants raw bytes, and VAPID keys arrive as URL-safe base64. */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalised);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Must be called from a user gesture. */
export async function enablePush(
  vapidPublicKey: string,
): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!pushSupported() || !vapidPublicKey) return 'unsupported';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      userAgent: navigator.userAgent,
    }),
  });
  if (!response.ok) throw new Error(`subscribe failed: ${response.status}`);
  return 'granted';
}
```

- [ ] **Step 4: Implement the server half**

`api/push/subscribe.ts`:

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { pushSubscriptions, reminders } from '../../db/schema';
import { requireUser } from '../_lib/session';

/** Spec §9: the Wednesday/Sunday dinner reminder, the evening nudge, the Sunday bilan. */
const DEFAULT_REMINDERS = [
  { kind: 'no_dinner', daysOfWeek: [3, 7], localTime: '18:00' },
  { kind: 'day_incomplete', daysOfWeek: [1, 2, 3, 4, 5, 6, 7], localTime: '20:00' },
  { kind: 'weekly_review', daysOfWeek: [7], localTime: '19:00' },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const userId = await requireUser(req, res);
  if (!userId) return undefined;

  const { subscription, userAgent } = req.body ?? {};
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string') {
    return res.status(400).json({ error: 'bad_subscription' });
  }

  const db = getDb();

  // The endpoint is the identity: re-subscribing the same browser refreshes
  // its keys rather than accumulating dead rows.
  await db.insert(pushSubscriptions)
    .values({
      id: crypto.randomUUID(), userId, endpoint, p256dh, auth,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh, auth },
    });

  // Seed the default schedule the first time this user subscribes.
  const existing = await db.select({ id: reminders.id }).from(reminders)
    .where(eq(reminders.userId, userId)).limit(1);
  if (existing.length === 0) {
    await db.insert(reminders).values(DEFAULT_REMINDERS.map((r) => ({
      id: crypto.randomUUID(),
      userId,
      kind: r.kind,
      daysOfWeek: r.daysOfWeek,
      localTime: r.localTime,
      enabled: true,
      updatedAt: new Date().toISOString(),
    })));
  }

  return res.status(201).json({ ok: true });
}
```

- [ ] **Step 5: Run the tests and commit**

Run: `npm test -- pwa/push && npx tsc -b`
Expected: PASS, no type errors.

```bash
git add src/pwa/push.ts src/pwa/push.test.ts api/push package.json package-lock.json
git commit -m "feat: add push subscription with default reminder schedule"
```

---

### Task 5: Which reminders are due

**Files:**
- Create: `api/_lib/dispatch.ts`
- Test: `api/_lib/dispatch.test.ts`

**Interfaces:**
- Produces:
  - `export interface UserTz { userId: string; timezone: string }`
  - `export interface ReminderRow { userId: string; kind: string; daysOfWeek: number[]; localTime: string; enabled: boolean }`
  - `export interface DueReminder { userId: string; kind: string; date: string }`
  - `localParts(timezone: string, now: Date): { date: string; hour: number; weekday: number }`
  - `dueReminders(now: Date, users: UserTz[], rows: ReminderRow[]): DueReminder[]`

This is the heart of the plan and the only part with real logic, so it is pure and tested hard. The DST case is not optional: an hourly poll on a 25-hour day must fire each reminder exactly once.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { dueReminders, localParts, type ReminderRow, type UserTz } from './dispatch';

const users: UserTz[] = [
  { userId: 'paris', timezone: 'Europe/Paris' },
  { userId: 'tokyo', timezone: 'Asia/Tokyo' },
];

const noDinner: ReminderRow = {
  userId: 'paris', kind: 'no_dinner', daysOfWeek: [3, 7], localTime: '18:00', enabled: true,
};

describe('localParts', () => {
  it('reports the local date, hour and ISO weekday', () => {
    // 2026-10-07 is a Wednesday. 16:30 UTC is 18:30 in Paris (UTC+2).
    expect(localParts('Europe/Paris', new Date('2026-10-07T16:30:00Z'))).toEqual({
      date: '2026-10-07', hour: 18, weekday: 3,
    });
  });

  it('rolls over the date in a zone ahead of UTC', () => {
    expect(localParts('Asia/Tokyo', new Date('2026-10-07T16:30:00Z'))).toEqual({
      date: '2026-10-08', hour: 1, weekday: 4,
    });
  });

  it('reads the hour correctly on both sides of the 25 October 2026 change', () => {
    // Before: Paris is UTC+2. After: UTC+1.
    expect(localParts('Europe/Paris', new Date('2026-10-25T00:30:00Z')).hour).toBe(2);
    expect(localParts('Europe/Paris', new Date('2026-10-25T17:00:00Z')).hour).toBe(18);
  });
});

describe('dueReminders', () => {
  it('fires in the matching local hour', () => {
    expect(dueReminders(new Date('2026-10-07T16:30:00Z'), users, [noDinner]))
      .toEqual([{ userId: 'paris', kind: 'no_dinner', date: '2026-10-07' }]);
  });

  it('does not fire in the hour before or after', () => {
    expect(dueReminders(new Date('2026-10-07T15:30:00Z'), users, [noDinner])).toEqual([]);
    expect(dueReminders(new Date('2026-10-07T17:30:00Z'), users, [noDinner])).toEqual([]);
  });

  it('does not fire on a weekday the reminder does not list', () => {
    // Thursday 8 October, 18:00 Paris.
    expect(dueReminders(new Date('2026-10-08T16:30:00Z'), users, [noDinner])).toEqual([]);
  });

  it('fires on Sunday, the other no-dinner evening', () => {
    // Sunday 11 October, 18:30 Paris.
    expect(dueReminders(new Date('2026-10-11T16:30:00Z'), users, [noDinner]))
      .toEqual([{ userId: 'paris', kind: 'no_dinner', date: '2026-10-11' }]);
  });

  it('ignores a disabled reminder', () => {
    const off = { ...noDinner, enabled: false };
    expect(dueReminders(new Date('2026-10-07T16:30:00Z'), users, [off])).toEqual([]);
  });

  it('ignores a reminder whose user has no timezone on record', () => {
    const orphan = { ...noDinner, userId: 'nobody' };
    expect(dueReminders(new Date('2026-10-07T16:30:00Z'), users, [orphan])).toEqual([]);
  });

  it('uses each user own zone, so one poll serves both', () => {
    const tokyo: ReminderRow = { ...noDinner, userId: 'tokyo' };
    // 09:30 UTC is 18:30 in Tokyo on Wednesday 7 October, and 11:30 in Paris.
    expect(dueReminders(new Date('2026-10-07T09:30:00Z'), users, [noDinner, tokyo]))
      .toEqual([{ userId: 'tokyo', kind: 'no_dinner', date: '2026-10-07' }]);
  });

  it('fires each reminder once across the whole 25-hour DST day', () => {
    const daily: ReminderRow = {
      userId: 'paris', kind: 'day_incomplete',
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7], localTime: '20:00', enabled: true,
    };
    // Poll every UTC hour across 25 October 2026 and count the local 20:00 hits.
    let hits = 0;
    for (let h = 0; h < 48; h += 1) {
      const now = new Date(Date.UTC(2026, 9, 25, h));
      const due = dueReminders(now, users, [daily]);
      if (due.some((d) => d.date === '2026-10-25')) hits += 1;
    }
    expect(hits).toBe(1);
  });

  it('returns several reminders when they share an hour', () => {
    const also: ReminderRow = { ...noDinner, kind: 'weekly_review' };
    const due = dueReminders(new Date('2026-10-11T16:30:00Z'), users, [noDinner, also]);
    expect(due.map((d) => d.kind).sort()).toEqual(['no_dinner', 'weekly_review']);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- dispatch`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export interface UserTz {
  userId: string;
  timezone: string;
}

export interface ReminderRow {
  userId: string;
  kind: string;
  daysOfWeek: number[];
  /** "HH:MM" in the user's own zone. Only the hour is used. */
  localTime: string;
  enabled: boolean;
}

export interface DueReminder {
  userId: string;
  kind: string;
  date: string;
}

/**
 * The local date, hour and ISO weekday in a given zone. This is the only
 * timezone-aware function on the server, which is why DST cannot leak further.
 */
export function localParts(
  timezone: string,
  now: Date,
): { date: string; hour: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false,
    weekday: 'short',
  });

  const parts = new Map(formatter.formatToParts(now).map((p) => [p.type, p.value]));
  const date = `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`;
  // "24" appears in some ICU builds for midnight.
  const hour = Number(parts.get('hour')) % 24;

  const WEEKDAYS: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  const weekday = WEEKDAYS[parts.get('weekday') ?? 'Mon'] ?? 1;

  return { date, hour, weekday };
}

/**
 * Which reminders fall in the current local hour, for every user in their own
 * zone. Called hourly; `sent_reminders` is what makes repeated polls safe.
 */
export function dueReminders(
  now: Date,
  users: UserTz[],
  rows: ReminderRow[],
): DueReminder[] {
  const zones = new Map(users.map((u) => [u.userId, u.timezone]));
  const due: DueReminder[] = [];

  for (const row of rows) {
    if (!row.enabled) continue;
    const timezone = zones.get(row.userId);
    if (!timezone) continue;

    const { date, hour, weekday } = localParts(timezone, now);
    if (!row.daysOfWeek.includes(weekday)) continue;

    const targetHour = Number(row.localTime.split(':')[0]);
    if (Number.isNaN(targetHour) || targetHour !== hour) continue;

    due.push({ userId: row.userId, kind: row.kind, date });
  }

  return due;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- dispatch`
Expected: PASS, 12 tests — including the DST day firing exactly once.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/dispatch.ts api/_lib/dispatch.test.ts
git commit -m "feat: add timezone-aware reminder due calculation"
```

---

### Task 6: The dispatcher endpoint

**Files:**
- Create: `api/cron/reminders.ts`

**Interfaces:**
- Produces: `POST /api/cron/reminders`, guarded by the `x-cron-secret` header.

**Claim before send.** Each `(userId, date, kind)` is inserted into `sent_reminders` with `onConflictDoNothing()` first; the push goes out only if that insert actually claimed the row. An hourly poll — or two overlapping ones — therefore cannot double-send. A send that fails after claiming is dropped rather than retried: at-most-once is the right trade for a reminder, since a duplicate "pas de dîner ce soir" an hour later is worse than a missed one.

- [ ] **Step 1: Implement**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { and, eq, inArray } from 'drizzle-orm';
import webpush from 'web-push';
import { getDb } from '../../db/client';
import {
  pushSubscriptions, reminders, sentReminders, settings,
} from '../../db/schema';
import { dueReminders, type ReminderRow, type UserTz } from '../_lib/dispatch';

interface Message {
  title: string;
  body: string;
  url: string;
  tag: string;
}

function message(kind: string): Message | null {
  switch (kind) {
    case 'no_dinner':
      return {
        title: 'Pas de dîner ce soir',
        body: 'C’est un de tes deux soirs. Tu gères.',
        url: '/',
        tag: 'no_dinner',
      };
    case 'day_incomplete':
      return {
        title: 'Il te reste des cases',
        body: 'Deux minutes et ta journée est validée.',
        url: '/',
        tag: 'day_incomplete',
      };
    case 'weekly_review':
      return {
        title: 'Bilan de la semaine',
        body: 'Regarde ce que tu as fait cette semaine.',
        url: '/poids',
        tag: 'weekly_review',
      };
    default:
      return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers['x-cron-secret'] !== secret) {
    return res.status(401).json({ error: 'not_authorised' });
  }

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return res.status(500).json({ error: 'vapid_not_configured' });
  webpush.setVapidDetails('mailto:ruban@localhost', publicKey, privateKey);

  const db = getDb();
  const now = new Date();

  const users: UserTz[] = (
    await db.select({ userId: settings.userId, timezone: settings.timezone }).from(settings)
  ).map((row) => ({ userId: row.userId, timezone: row.timezone }));

  const rows = (await db.select().from(reminders)).map((row): ReminderRow => ({
    userId: row.userId,
    kind: row.kind,
    daysOfWeek: (row.daysOfWeek as number[]) ?? [],
    localTime: row.localTime,
    enabled: row.enabled,
  }));

  const due = dueReminders(now, users, rows);
  let sent = 0;
  let skipped = 0;

  for (const item of due) {
    const payload = message(item.kind);
    if (!payload) continue;

    // Claim first. If this inserts nothing, someone already sent it.
    const claimed = await db.insert(sentReminders)
      .values({ userId: item.userId, date: item.date, kind: item.kind })
      .onConflictDoNothing()
      .returning({ kind: sentReminders.kind });

    if (claimed.length === 0) {
      skipped += 1;
      continue;
    }

    const subs = await db.select().from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, item.userId));

    const dead: string[] = [];
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
        sent += 1;
      } catch (error) {
        // 404/410 mean the browser threw the subscription away.
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(sub.endpoint);
      }
    }
    if (dead.length > 0) {
      await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, dead));
    }
  }

  return res.status(200).json({ at: now.toISOString(), due: due.length, sent, skipped });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Verify the guard rejects an unsigned call**

After deploying in Task 7:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<your-app>.vercel.app/api/cron/reminders
```

Expected: `401`.

- [ ] **Step 4: Commit**

```bash
git add api/cron
git commit -m "feat: add the idempotent reminder dispatcher"
```

---

### Task 7: The hourly workflow

**Files:**
- Create: `.github/workflows/reminders.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: reminders

on:
  schedule:
    # Hourly, on the hour. UTC — the endpoint converts to each user's zone,
    # which is why DST on 25 October 2026 needs no change here.
    - cron: '0 * * * *'
  workflow_dispatch:

jobs:
  poke:
    runs-on: ubuntu-latest
    timeout-minutes: 2
    steps:
      - name: Poke the dispatcher
        run: |
          code=$(curl -sS -o /tmp/body -w '%{http_code}' \
            -X POST "${{ secrets.RUBAN_URL }}/api/cron/reminders" \
            -H "x-cron-secret: ${{ secrets.CRON_SECRET }}")
          cat /tmp/body
          echo
          if [ "$code" != "200" ]; then
            echo "dispatcher returned $code"
            exit 1
          fi
```

- [ ] **Step 2: Create the repository and its secrets**

```bash
gh repo create ruban --private --source=. --remote=origin --push
gh secret set RUBAN_URL --body "https://<your-app>.vercel.app"
gh secret set CRON_SECRET --body "<the same value as in Vercel>"
```

A private repo uses roughly 700 of the 2,000 free Actions minutes a month at this cadence. A public repo has no minute limit — but the repo would then be readable, so keep it private unless you want the code public.

- [ ] **Step 3: Run it by hand before trusting the schedule**

```bash
gh workflow run reminders
gh run watch
```

Expected: exit 0, and a JSON body like `{"at":"…","due":0,"sent":0,"skipped":0}`. `due: 0` is correct outside a reminder hour.

- [ ] **Step 4: Force a real send**

Temporarily set one reminder's `local_time` in Neon to the hour it is now in your timezone, then:

```bash
gh workflow run reminders && gh run watch
```

Expected: `sent` is at least 1, and the notification arrives on your phone. Run it again immediately — `skipped` must be 1 and `sent` 0, proving the claim works. Then restore the original `local_time`.

- [ ] **Step 5: Commit**

```bash
git add .github
git commit -m "ci: poke the reminder dispatcher hourly"
```

---

### Task 8: The notifications panel

**Files:**
- Create: `src/features/account/Notifications.tsx`
- Modify: `src/features/settings/Settings.tsx`

**Interfaces:**
- Produces: `<Notifications />` — install guidance when push cannot be enabled yet, an enable button when it can, confirmation when it is on.

- [ ] **Step 1: Implement**

```tsx
import { useState } from 'react';
import { canEnablePush, detectPlatform, installSteps, isStandalone, pushSupported } from '@/pwa/install';
import { enablePush } from '@/pwa/push';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '';

export function Notifications() {
  const platform = detectPlatform(navigator.userAgent);
  const standalone = isStandalone();
  const gate = canEnablePush(platform, standalone, pushSupported());

  const [state, setState] = useState<'idle' | 'busy' | 'granted' | 'denied' | 'error'>(
    () => (typeof Notification !== 'undefined' && Notification.permission === 'granted'
      ? 'granted' : 'idle'),
  );

  if (state === 'granted') {
    return (
      <Card>
        <span className="label">Rappels</span>
        <p style={{ margin: '6px 0 0', color: 'var(--ink-soft)' }}>
          C’est activé. Tu recevras un rappel le mercredi et le dimanche soir,
          une relance si ta journée n’est pas validée, et le bilan du dimanche.
        </p>
      </Card>
    );
  }

  if (!gate.ok) {
    return (
      <Card>
        <span className="label">Rappels</span>
        {gate.reason === 'unsupported' ? (
          <p style={{ margin: '6px 0 0', color: 'var(--ink-soft)' }}>
            Ce navigateur ne gère pas les notifications. Tout le reste fonctionne.
          </p>
        ) : (
          <>
            <p style={{ margin: '6px 0 10px', color: 'var(--ink-soft)' }}>
              Sur iPhone, les rappels ne marchent qu’une fois Ruban installé sur
              ton écran d’accueil. Trois étapes&nbsp;:
            </p>
            <ol style={{ margin: 0, paddingLeft: '1.2em', color: 'var(--ink-soft)' }}>
              {installSteps(platform).map((step) => <li key={step}>{step}</li>)}
            </ol>
          </>
        )}
      </Card>
    );
  }

  return (
    <Card>
      <span className="label">Rappels</span>
      <p style={{ margin: '6px 0 10px', color: 'var(--ink-soft)' }}>
        Un rappel le mercredi et le dimanche soir, une relance si ta journée
        n’est pas validée, et le bilan du dimanche.
      </p>
      <Button
        disabled={state === 'busy'}
        onClick={async () => {
          setState('busy');
          try {
            const result = await enablePush(VAPID_PUBLIC_KEY);
            setState(result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'error');
          } catch {
            setState('error');
          }
        }}
      >
        Activer les rappels
      </Button>
      {state === 'denied' && (
        <p style={{ margin: '10px 0 0', color: 'var(--cerise)' }}>
          Les notifications sont bloquées. Autorise-les dans les réglages de ton
          navigateur, puis réessaie.
        </p>
      )}
      {state === 'error' && (
        <p style={{ margin: '10px 0 0', color: 'var(--cerise)' }}>
          Ça n’a pas marché. Vérifie que tu as un compte et une connexion, puis réessaie.
        </p>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Mount it**

In `src/features/settings/Settings.tsx`, add `import { Notifications } from '@/features/account/Notifications';` and render `<Notifications />` directly after `<Account />`.

- [ ] **Step 3: Run the full suite**

Run: `npm test && npx tsc -b && npm run build`
Expected: all PASS, clean build.

- [ ] **Step 4: Commit**

```bash
git add src/features/account/Notifications.tsx src/features/settings/Settings.tsx
git commit -m "feat: add the install-then-enable notifications flow"
```

---

### Task 9: Verify on the real phone

Not a code task. iOS web push is the highest-risk item in the whole project (spec §12) and cannot be verified any other way.

- [ ] **Step 1: Deploy and reinstall**

```bash
npx vercel --prod
```

Delete any previous home-screen icon first — an old service worker is the most common cause of "it works on my laptop".

- [ ] **Step 2: Walk the flow as a new user would**

1. Open in Safari (iOS) or Chrome (Android). The notifications card should show install instructions on iOS, not a dead button.
2. Install to the home screen. Open from the icon.
3. In "Moi": create an account, note the recovery code, enable reminders.
4. Confirm a row appeared in `push_subscriptions` and three in `reminders`.

- [ ] **Step 3: Confirm offline behaviour from the installed app**

Airplane mode on. Force-quit and relaunch from the icon. Expected: the app opens and the Today screen renders. Tick a full day; the bow shower fires. Airplane mode off; confirm the pending count drains.

- [ ] **Step 4: Confirm a real notification arrives**

Use the forced-send procedure from Task 7, Step 4. Expected: the notification appears on the lock screen, tapping it opens Ruban at the Today screen, and a second immediate run reports `skipped: 1`.

- [ ] **Step 5: Record the outcome**

```bash
cat > docs/superpowers/notes/plan-5-device.md
```

Write down the device, the OS version, what worked, and anything that did not. If iOS push failed, record the exact behaviour — that note is the starting point for the fix, and the app remains fully usable without it.

```bash
git add docs/superpowers/notes/plan-5-device.md
git commit -m "docs: record on-device PWA and push verification"
```

---

## Plan 5 Done When

- `npm test`, `npx tsc -b` and `npm run build` are all clean.
- The installed app launches and works with no network.
- `/api/*` is never served from cache: a sync attempt while offline fails rather than returning stale data.
- `/api/cron/reminders` returns 401 without the secret header.
- Two consecutive dispatcher runs in the same local hour send once and skip once.
- A real notification has arrived on the real phone, tapped through to the Today screen — or the failure is written down in `docs/superpowers/notes/plan-5-device.md` with the device and OS version.
- The DST test in `api/_lib/dispatch.test.ts` passes: across 48 hourly polls on 25 October 2026, each reminder fires exactly once.
