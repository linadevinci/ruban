/** Notes as semitone offsets from A4, played as a soft sine pluck. */
const TICK_NOTES = [7, 12];
const FANFARE_NOTES = [0, 4, 7, 12, 16];

function frequency(semitonesFromA4: number): number {
  return 440 * 2 ** (semitonesFromA4 / 12);
}

function pluck(notes: number[]): void {
  // Absent in jsdom, and in any browser without Web Audio: stay silent rather
  // than throw, since this runs from a tick on the checklist.
  const Ctor = globalThis.AudioContext;
  if (!Ctor) return;
  const ctx = new Ctor();
  notes.forEach((note, index) => {
    const at = ctx.currentTime + index * 0.075;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency(note), at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.14, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.36);
  });
}

/** A soft two-note pluck for a single tick. Silent unless sound is on. */
export function playTick(enabled: boolean): void {
  if (!enabled) return;
  pluck(TICK_NOTES);
}

/** The completed-day chime. Silent unless sound is on. */
export function playFanfare(enabled: boolean): void {
  if (!enabled) return;
  pluck(FANFARE_NOTES);
}
