import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { getCurrentUserId } from '@/app/session';
import { TabBar } from '@/app/TabBar';
import { getSettings } from '@/db/repos';
// The one import a component takes from '@/db/schema' rather than from
// '@/db/repos'. The plan's "no component imports the schema" rule is about
// raw table access bypassing the repos' updatedAt stamping and outbox push;
// openDatabase touches no table, and the shell is by definition the only
// place that can own opening the database.
import { openDatabase, type OpenResult } from '@/db/schema';
import { Onboarding } from '@/features/onboarding/Onboarding';
import { Today } from '@/features/today/Today';
import '@/app/app.css';

/** Placeholder screens; Plan 3 replaces each one. */
function Soon({ title }: { title: string }) {
  return <h1 className="today__date">{title}</h1>;
}

function Opening() {
  return <div className="app"><p>{'Un instant\u2026'}</p></div>;
}

/**
 * Both failure branches, side by side so they cannot drift into saying the
 * same thing. They must stay distinguishable in the DOM: if 'blocked' and
 * 'unknown' render identical markup, `reason` is decorative and no test can
 * prove the shell reads it.
 *
 * Neither message says the data is lost, because it is not - a blocked store
 * is unreachable from THIS browsing context, and an unknown failure has not
 * touched what is already on disk.
 */
const STORAGE_FAILURE = {
  blocked: {
    testId: 'storage-blocked',
    title: 'Ruban ne peut rien enregistrer ici',
    lines: [
      'Ton navigateur empêche Ruban d\u2019enregistrer quoi que ce soit sur cet appareil. C\u2019est presque toujours la navigation privée\u00a0: ouvre Ruban dans une fenêtre normale.',
      'Rien n\u2019est perdu\u00a0: tes données sont simplement inaccessibles depuis cette fenêtre.',
    ],
  },
  unknown: {
    testId: 'storage-unknown',
    title: 'Impossible d\u2019ouvrir tes données',
    lines: [
      'Quelque chose s\u2019est mal passé à l\u2019ouverture de tes données. Recharge la page pour réessayer.',
      'Tes données sont toujours là, sur cet appareil\u00a0; Ruban n\u2019arrive juste pas à les lire pour le moment.',
    ],
  },
};

function StorageFailure({ reason }: { reason: 'blocked' | 'unknown' }) {
  const copy = STORAGE_FAILURE[reason];
  return (
    <div className="app">
      <div className="storage" data-testid={copy.testId} role="alert">
        <h1 className="storage__title">{copy.title}</h1>
        {copy.lines.map((line) => <p key={line}>{line}</p>)}
      </div>
    </div>
  );
}

export function App() {
  // 'opening' until openDatabase resolves; then the result. Separate from the
  // useLiveQuery state below, which must not be trusted until this is ok.
  //
  // In an effect and never inside the querier: db.open() runs any pending
  // schema upgrade, and an upgrade writes, which Dexie's observability
  // middleware rejects in a liveQuery context (ReadOnlyError). That would fire
  // only on the devices that need the migration - real users, never a fresh
  // test database.
  const [open, setOpen] = useState<OpenResult | 'opening'>('opening');
  useEffect(() => {
    let cancelled = false;
    void openDatabase().then((result) => { if (!cancelled) setOpen(result); });
    return () => { cancelled = true; };
  }, []);

  const state = useLiveQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return { userId: null, hasSettings: false };
    return { userId, hasSettings: (await getSettings(userId)) !== undefined };
  }, []);

  // Three states, not two. While the open is in flight the querier may well
  // have resolved against an implicitly opened database, and on a device that
  // blocks storage it never resolves at all - so the gate decides first.
  if (open === 'opening') return <Opening />;
  if (!open.ok) return <StorageFailure reason={open.reason} />;

  if (!state) return <Opening />;

  if (!state.userId || !state.hasSettings) {
    // useLiveQuery re-runs on the settings write, so no explicit callback is needed.
    return <div className="app"><Onboarding onDone={() => {}} /></div>;
  }

  const userId = state.userId;

  return (
    <BrowserRouter>
      <div className="app">
        <Routes>
          <Route path="/" element={<Today userId={userId} />} />
          <Route path="/poids" element={<Soon title="Poids" />} />
          <Route path="/calories" element={<Soon title="Calories" />} />
          <Route path="/course" element={<Soon title="Course" />} />
          <Route path="/moi" element={<Soon title="Moi" />} />
        </Routes>
      </div>
      <TabBar />
    </BrowserRouter>
  );
}
