export interface PrimitiveState {
  delays: Record<string, { buffer: number[]; index: number; initialized: boolean; lastStep: number }>;
  smooths: Record<string, { value: number; initialized: boolean; lastStep: number }>;
  stepIndex: number;
  committed: boolean;
}

export function createPrimitiveState(): PrimitiveState {
  return { delays: {}, smooths: {}, stepIndex: -1, committed: true };
}

export function beginStep(state: PrimitiveState, stepIndex: number) {
  state.stepIndex = stepIndex;
  state.committed = false;
}

export function commitStep(state: PrimitiveState) {
  state.committed = true;
}

export function makePrimitiveFunctions(state: PrimitiveState, tRef: { t: number; dt: number }) {
  const step = (height: number, stepTime: number) => (tRef.t >= stepTime - 1e-12 ? height : 0);

  const pulse = (volume: number, firstPulse: number, interval: number = 0) => {
    const dt = tRef.dt;
    const t = tRef.t;
    const eps = dt / 1000 + 1e-12;
    const atFirst = t + eps >= firstPulse && t < firstPulse + dt - eps/2;
    if (atFirst) return volume / dt;
    if (interval > 0 && t >= firstPulse) {
      const k = Math.round((t - firstPulse) / interval);
      const tk = firstPulse + k * interval;
      if (Math.abs(tk - firstPulse) > eps && t + eps >= tk && t < tk + dt - eps/2) return volume / dt;
    }
    return 0;
  };

  const ramp = (slope: number, startTime: number, endTime?: number) => {
    const t = tRef.t;
    if (t <= startTime) return 0;
    const end = endTime ?? Number.POSITIVE_INFINITY;
    const effectiveT = Math.min(t, end);
    return slope * (effectiveT - startTime);
  };

  const rand = (min = 0, max = 1) => min + Math.random() * (max - min);

  const smooth = (input: number, averagingTime: number, initial?: number, key = '__smooth_default__') => {
    const k = key;
    if (!state.smooths[k]) {
      state.smooths[k] = { value: initial ?? input, initialized: true, lastStep: -1 };
    }
    const s = state.smooths[k];
    // During trial evaluations within same step, return current projected value without committing
    if (s.lastStep === state.stepIndex) {
      return s.value;
    }
    const at = Math.max(averagingTime, 1e-9);
    const next = s.value + ((input - s.value) / at) * tRef.dt;
    // tentatively advance; commitStep logic not separately stored, but we update once per step index
    s.value = next;
    s.lastStep = state.stepIndex;
    return s.value;
  };

  const delay = (input: number, delayTime: number, initial?: number, key = '__delay_default__') => {
    const dt = tRef.dt;
    const steps = Math.max(1, Math.round(Math.max(delayTime, dt) / dt));
    const initVal = initial ?? input;
    if (!state.delays[key] || state.delays[key].buffer.length !== steps) {
      state.delays[key] = { buffer: new Array(steps).fill(initVal), index: 0, initialized: true, lastStep: -1 };
    }
    const d = state.delays[key];
    const out = d.buffer[d.index];
    if (d.lastStep !== state.stepIndex) {
      d.buffer[d.index] = input;
      d.index = (d.index + 1) % d.buffer.length;
      d.lastStep = state.stepIndex;
    }
    return out;
  };

  const delay1 = (input: number, delayTime: number, initial?: number, key = '__delay1_default__') => smooth(input, delayTime, initial, key);
  const delay3 = (input: number, delayTime: number, initial?: number, key = '__delay3_default__') => {
    const third = Math.max(delayTime / 3, 1e-9);
    const s1 = smooth(input, third, initial, key + '_1');
    const s2 = smooth(s1, third, initial, key + '_2');
    return smooth(s2, third, initial, key + '_3');
  };

  const trend = (input: number, averageTime: number, initialTrend = 0, key = '__trend_default__') => {
    const avg = smooth(input, averageTime, input, key + '_avg');
    const at = Math.max(averageTime, 1e-9);
    const change = (input - avg) / at;
    const safeAvg = Math.abs(avg) < 1e-12 ? 1e-12 : avg;
    return change / safeAvg;
  };

  return {
    step, pulse, ramp, rand, smooth, delay, delay1, delay3, trend,
    STEP: step, PULSE: pulse, RAMP: ramp, SMOOTH: smooth, DELAY: delay, DELAY1: delay1, DELAY3: delay3, TREND: trend,
  };
}
