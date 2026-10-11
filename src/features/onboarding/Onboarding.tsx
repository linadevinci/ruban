import { useState } from 'react';
import { ensureLocalUser } from '@/app/session';
import { saveSettings } from '@/db/repos';
import { diffDays, isValidTimeZone, todayIn } from '@/domain/calendar';
import { impliedWeeklyRate } from '@/domain/trajectory';
import { Button } from '@/ui/Button';
import { kg } from '@/ui/format';
import '@/features/onboarding/Onboarding.css';

/** Accepts "62,3" as well as "62.3". */
function parseDecimal(raw: string): number | null {
  const value = Number(raw.trim().replace(',', '.'));
  return raw.trim() !== '' && Number.isFinite(value) ? value : null;
}

interface NumberFieldProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  inputMode?: 'decimal' | 'numeric';
}

function Field({ label, value, onChange, inputMode = 'decimal' }: NumberFieldProps) {
  const id = `onb-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <label className="onb__field" htmlFor={id}>
      <span className="label">{label}</span>
      <input
        id={id}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // An unusable stored zone would make todayIn throw on every later render.
  const timezone = isValidTimeZone(detected) ? detected : 'UTC';
  const [startWeight, setStartWeight] = useState('');
  const [targetWeight, setTargetWeight] = useState('');
  const [goalDate, setGoalDate] = useState('2026-11-12');
  const [dailyCalorieTarget, setDaily] = useState('1500');
  const [noDinnerAllowance, setNoDinner] = useState('900');
  const [calorieFloor, setFloor] = useState('1200');
  const [stepTarget, setSteps] = useState('8000');
  const [waterTarget, setWater] = useState('6');
  const [runSessionsTarget, setRuns] = useState('5');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = parseDecimal(startWeight);
  const target = parseDecimal(targetWeight);
  const startDate = todayIn(timezone);

  // Guarded on goalDate too: parseIsoDate throws on a malformed date, so an
  // emptied date field would otherwise blank the screen during render.
  const rate = start !== null && target !== null && goalDate !== ''
    ? impliedWeeklyRate({ startDate, startWeight: start, targetWeight: target, goalDate })
    : null;

  async function submit() {
    if (busy) return;
    if (start === null || start <= 0 || target === null || target <= 0) {
      setError('Il me faut ton poids de départ et ton objectif.');
      return;
    }
    if (goalDate === '' || diffDays(startDate, goalDate) <= 0) {
      setError('Il me faut une date objectif, après aujourd\u2019hui.');
      return;
    }
    // The six target fields are plain text inputs, and inputMode does nothing on
    // a desktop keyboard. Number('') is 0 and Number('abc') is NaN, either of
    // which would be written into the one settings row every screen reads.
    const daily = parseDecimal(dailyCalorieTarget);
    const noDinner = parseDecimal(noDinnerAllowance);
    const floor = parseDecimal(calorieFloor);
    const steps = parseDecimal(stepTarget);
    const water = parseDecimal(waterTarget);
    const runs = parseDecimal(runSessionsTarget);
    if (
      daily === null || noDinner === null || floor === null
      || steps === null || water === null || runs === null
      || daily <= 0 || noDinner <= 0 || floor <= 0
      || steps <= 0 || water <= 0 || runs <= 0
    ) {
      setError('Un de tes objectifs n\u2019est pas un nombre valide.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const userId = await ensureLocalUser();
      await saveSettings({
        userId,
        timezone,
        startDate,
        startWeight: start,
        targetWeight: target,
        goalDate,
        weighInCadence: 'daily',
        dailyCalorieTarget: daily,
        noDinnerAllowance: noDinner,
        calorieFloor: floor,
        stepTarget: steps,
        waterTarget: water,
        runSessionsTarget: runs,
        soundEnabled: false,
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="onb">
      <div>
        <h1>On commence&nbsp;?</h1>
        <p className="onb__intro">
          Tout reste modifiable plus tard, dans les réglages.
        </p>
      </div>

      <div className="onb__grid">
        <Field label="Poids de départ" value={startWeight} onChange={setStartWeight} />
        <Field label="Objectif" value={targetWeight} onChange={setTargetWeight} />
      </div>

      <label className="onb__field" htmlFor="onb-goal-date">
        <span className="label">Date objectif</span>
        <input
          id="onb-goal-date"
          type="date"
          value={goalDate}
          onChange={(event) => setGoalDate(event.target.value)}
        />
      </label>

      {rate !== null && (
        <p className="onb__rate">
          Ça fait {kg(Math.abs(rate))} kg par semaine.
        </p>
      )}

      <div className="onb__grid">
        <Field label="Cible calories" value={dailyCalorieTarget} onChange={setDaily} inputMode="numeric" />
        <Field label="Sans dîner" value={noDinnerAllowance} onChange={setNoDinner} inputMode="numeric" />
        <Field label="Seuil minimum" value={calorieFloor} onChange={setFloor} inputMode="numeric" />
        <Field label="Objectif de pas" value={stepTarget} onChange={setSteps} inputMode="numeric" />
        <Field label="Verres d'eau" value={waterTarget} onChange={setWater} inputMode="numeric" />
        <Field label="Sorties par semaine" value={runSessionsTarget} onChange={setRuns} inputMode="numeric" />
      </div>

      {error && <p className="onb__err" role="alert">{error}</p>}

      <Button onClick={submit} disabled={busy}>Commencer</Button>
    </div>
  );
}
