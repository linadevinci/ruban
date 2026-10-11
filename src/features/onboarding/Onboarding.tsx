import { useState } from 'react';
import { ensureLocalUser } from '@/app/session';
import { saveSettings } from '@/db/repos';
import { isValidTimeZone, todayIn } from '@/domain/calendar';
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

  const start = parseDecimal(startWeight);
  const target = parseDecimal(targetWeight);
  const startDate = todayIn(timezone);

  const rate = start !== null && target !== null
    ? impliedWeeklyRate({ startDate, startWeight: start, targetWeight: target, goalDate })
    : null;

  async function submit() {
    if (start === null || target === null) {
      setError('Il me faut ton poids de départ et ton objectif.');
      return;
    }
    const userId = await ensureLocalUser();
    await saveSettings({
      userId,
      timezone,
      startDate,
      startWeight: start,
      targetWeight: target,
      goalDate,
      weighInCadence: 'daily',
      dailyCalorieTarget: Number(dailyCalorieTarget),
      noDinnerAllowance: Number(noDinnerAllowance),
      calorieFloor: Number(calorieFloor),
      stepTarget: Number(stepTarget),
      waterTarget: Number(waterTarget),
      runSessionsTarget: Number(runSessionsTarget),
      soundEnabled: false,
    });
    onDone();
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

      {error && <p className="onb__err">{error}</p>}

      <Button onClick={submit}>Commencer</Button>
    </div>
  );
}
