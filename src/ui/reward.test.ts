import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playFanfare, playTick } from '@/ui/reward';

// Counts constructions of AudioContext. The disabled path must not build one at
// all, and asserting the functions returned undefined would prove nothing: they
// return undefined whether or not a sound was played.
const constructed = vi.fn();
const started: number[] = [];
const stopped: number[] = [];
const frequencies: number[] = [];
const gainSets: number[] = [];
const gainRamps: number[] = [];
const routed: string[] = [];

// jsdom has no Web Audio implementation, so the whole graph is stubbed and the
// calls that actually make the sound are recorded.
class FakeOscillator {
  type = '';
  frequency = {
    value: 0,
    setValueAtTime: (value: number) => { frequencies.push(value); },
  };
  connect = (target: { tag?: string }) => { routed.push(`osc->${target.tag ?? '?'}`); };
  start = (when: number) => { started.push(when); };
  stop = (when: number) => { stopped.push(when); };
}

class FakeGain {
  tag = 'gain';
  gain = {
    value: 0,
    setValueAtTime: (value: number) => { gainSets.push(value); },
    exponentialRampToValueAtTime: (value: number) => { gainRamps.push(value); },
  };
  connect = (target: { tag?: string }) => { routed.push(`gain->${target.tag ?? '?'}`); };
}

class FakeAudioContext {
  currentTime = 0;
  destination = { tag: 'destination' };
  constructor() { constructed(); }
  createOscillator() { return new FakeOscillator(); }
  createGain() { return new FakeGain(); }
  close() {}
}

beforeEach(() => {
  constructed.mockClear();
  started.length = 0;
  stopped.length = 0;
  frequencies.length = 0;
  gainSets.length = 0;
  gainRamps.length = 0;
  routed.length = 0;
  vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('playTick', () => {
  it('constructs no AudioContext when sound is disabled', () => {
    playTick(false);
    expect(constructed).not.toHaveBeenCalled();
    expect(started).toHaveLength(0);
  });

  it('plays two notes through one context when enabled', () => {
    playTick(true);
    expect(constructed).toHaveBeenCalledTimes(1);
    expect(started).toEqual([0, 0.075]);
    expect(stopped).toHaveLength(2);
  });

  it('plays the two pluck pitches', () => {
    playTick(true);
    expect(frequencies.map(Math.round)).toEqual([659, 880]);
  });

  it('gives every note a rise-and-fall envelope', () => {
    playTick(true);
    expect(gainSets).toEqual([0.0001, 0.0001]);
    expect(gainRamps).toEqual([0.14, 0.0001, 0.14, 0.0001]);
  });

  it('routes each oscillator through its gain to the destination', () => {
    playTick(true);
    expect(routed).toEqual([
      'osc->gain', 'gain->destination',
      'osc->gain', 'gain->destination',
    ]);
  });

  it('stays silent instead of throwing when the browser has no Web Audio', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(() => { playTick(true); }).not.toThrow();
    expect(started).toHaveLength(0);
  });
});

describe('playFanfare', () => {
  it('constructs no AudioContext when sound is disabled', () => {
    playFanfare(false);
    expect(constructed).not.toHaveBeenCalled();
    expect(started).toHaveLength(0);
  });

  it('plays more notes than a tick', () => {
    playFanfare(true);
    expect(started.length).toBeGreaterThan(2);
    expect(started).toHaveLength(5);
  });

  it('staggers the notes rather than stacking them on one beat', () => {
    playFanfare(true);
    expect(new Set(started).size).toBe(5);
  });

  it('plays the chime as an arpeggio', () => {
    playFanfare(true);
    expect(frequencies.map(Math.round)).toEqual([440, 554, 659, 880, 1109]);
  });
});
