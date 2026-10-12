import { describe, expect, it } from 'vitest';
import { acroSetpoint, DEFAULT_ACRO_TUNING } from '../../src/core/control/acro';
import { nextFlightState, ARM_MAX_THROTTLE } from '../../src/core/control/flight-controller';
import { mixQuad } from '../../src/core/control/mixer';
import { type PilotInput, NEUTRAL_INPUT } from '../../src/core/control/pilot-input';
import { RateController, DEFAULT_RATE_GAINS } from '../../src/core/control/rate-controller';
import { createRng } from '../../src/core/math/random';
import { vec3 } from '../../src/core/math/vec3';
import { computeActuation } from '../../src/core/physics/drone-physics-model';
import { DEFAULT_DRONE_PARAMS, validateDroneParams } from '../../src/core/physics/drone-params';
import { createDroneState } from '../../src/core/physics/drone-state';
import { motorOffsets } from '../../src/core/physics/motor-model';

const P = DEFAULT_DRONE_PARAMS;
const MAX = P.motor.maxThrust * P.motor.efficiency;

describe('modo Acro: entrada -> taxa', () => {
  it('stick cheio em roll gera a taxa máxima de rolagem, com o sinal certo', () => {
    const s = acroSetpoint({ ...NEUTRAL_INPUT, roll: 1 }, { ...DEFAULT_ACRO_TUNING, expo: 0 });
    expect(s.x).toBeCloseTo(DEFAULT_ACRO_TUNING.rollRateMax, 12);
    expect(s.y).toBeCloseTo(0, 12);
    expect(s.z).toBeCloseTo(0, 12);
  });

  it('pitch positivo (nariz para cima) vira taxa positiva em z; yaw à direita vira negativa em y', () => {
    const t = { ...DEFAULT_ACRO_TUNING, expo: 0 };
    expect(acroSetpoint({ ...NEUTRAL_INPUT, pitch: 1 }, t).z).toBeCloseTo(t.pitchRateMax, 12);
    expect(acroSetpoint({ ...NEUTRAL_INPUT, yaw: 1 }, t).y).toBeCloseTo(-t.yawRateMax, 12);
  });

  it('sensibilidade global escala todas as taxas e entradas fora de [-1, 1] são limitadas', () => {
    const t = { ...DEFAULT_ACRO_TUNING, expo: 0, rateScale: 0.5 };
    expect(acroSetpoint({ ...NEUTRAL_INPUT, roll: 1 }, t).x).toBeCloseTo(DEFAULT_ACRO_TUNING.rollRateMax * 0.5, 12);
    expect(acroSetpoint({ ...NEUTRAL_INPUT, roll: 9 }, t).x).toBeCloseTo(DEFAULT_ACRO_TUNING.rollRateMax * 0.5, 12);
  });
});

describe('controle de taxa', () => {
  it('torque é proporcional à inércia e ao erro (ganho P)', () => {
    const rc = new RateController({ kp: 10, ki: 0, integralLimit: 0 });
    const big = vec3(1e9, 1e9, 1e9);
    const tq = rc.update(vec3(2, 0, 0), vec3(0, 0, 0), vec3(0.5, 0.5, 0.5), big, 0.001);
    expect(tq.x).toBeCloseTo(0.5 * 10 * 2, 9);
  });

  it('torque é limitado pelo máximo do eixo', () => {
    const rc = new RateController(DEFAULT_RATE_GAINS);
    const tq = rc.update(vec3(100, 0, 0), vec3(0, 0, 0), vec3(1, 1, 1), vec3(0.3, 0.3, 0.3), 0.001);
    expect(tq.x).toBe(0.3);
  });

  it('integral é limitado (anti-windup) e reset zera o acúmulo', () => {
    const rc = new RateController({ kp: 0, ki: 1, integralLimit: 0.5 });
    const inertia = vec3(1, 1, 1);
    const big = vec3(1e9, 1e9, 1e9);
    for (let i = 0; i < 10000; i++) rc.update(vec3(10, 0, 0), vec3(0, 0, 0), inertia, big, 0.01);
    const saturated = rc.update(vec3(10, 0, 0), vec3(0, 0, 0), inertia, big, 0.01);
    expect(saturated.x).toBeCloseTo(0.5, 9);
    rc.reset();
    expect(rc.update(vec3(0, 0, 0), vec3(0, 0, 0), inertia, big, 0.01).x).toBe(0);
  });
});

describe('mixer em X', () => {
  const hover = (P.mass * 9.80665) / 4;

  it('empuxo coletivo sem torque distribui igualmente entre os motores', () => {
    const r = mixQuad(4 * hover, vec3(0, 0, 0), P, MAX);
    for (const f of r.demand) expect(f).toBeCloseTo(hover, 9);
    expect(r.saturated).toBe(false);
  });

  it('o mixer reproduz exatamente o empuxo e os torques pedidos (quando não há saturação)', () => {
    const rng = createRng(3);
    for (let i = 0; i < 200; i++) {
      const total = rng.range(1, 4 * MAX * 0.6);
      const tq = vec3(rng.range(-0.05, 0.05), rng.range(-0.005, 0.005), rng.range(-0.05, 0.05));
      const r = mixQuad(total, tq, P, MAX);
      if (r.saturated) continue;
      const act = computeActuation(r.demand, P);
      expect(act.totalThrust).toBeCloseTo(total, 9);
      expect(act.torque.x).toBeCloseTo(tq.x, 9);
      expect(act.torque.y).toBeCloseTo(tq.y, 9);
      expect(act.torque.z).toBeCloseTo(tq.z, 9);
    }
  });

  it('limita cada motor entre 0 e o máximo, e marca saturação', () => {
    const r = mixQuad(4 * MAX, vec3(0.5, 0, 0), P, MAX);
    for (const f of r.demand) {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(MAX);
    }
    expect(r.saturated).toBe(true);
  });

  it('torque de rolagem para a direita aumenta motores da esquerda', () => {
    const r = mixQuad(4 * hover, vec3(0.01, 0, 0), P, MAX);
    const [frontRight, frontLeft, rearRight, rearLeft] = r.demand;
    expect(frontLeft + rearLeft).toBeGreaterThan(frontRight + rearRight);
  });

  it('a geometria X coloca os motores nas diagonais, com sentidos alternados', () => {
    const offs = motorOffsets(P.armLength);
    expect(offs.reduce((s, o) => s + o.spin, 0)).toBe(0);
    for (const o of offs) expect(Math.hypot(o.x, o.z)).toBeCloseTo(P.armLength, 12);
  });
});

describe('estado de armado', () => {
  const state = (flightState: 'disarmed' | 'armed' | 'crashed') => ({ ...createDroneState(), flightState });
  const pulse = (throttle: number): PilotInput => ({ ...NEUTRAL_INPUT, throttle, armRequest: true });

  it('arma apenas com acelerador baixo', () => {
    expect(nextFlightState(state('disarmed'), pulse(0))).toBe('armed');
    expect(nextFlightState(state('disarmed'), pulse(ARM_MAX_THROTTLE + 0.1))).toBe('disarmed');
  });

  it('desarma com um novo pulso e nunca arma depois de um crash', () => {
    expect(nextFlightState(state('armed'), pulse(0.5))).toBe('disarmed');
    expect(nextFlightState(state('crashed'), pulse(0))).toBe('crashed');
  });
});

describe('parâmetros', () => {
  it('parâmetros padrão são válidos e valores absurdos são rejeitados', () => {
    expect(() => validateDroneParams(P)).not.toThrow();
    expect(() => validateDroneParams({ ...P, mass: 0 })).toThrow(RangeError);
    expect(() => validateDroneParams({ ...P, dragLinear: -1 })).toThrow(RangeError);
  });
});

describe('atuação', () => {
  it('empuxo de hover não gera torque com motores iguais', () => {
    const hover = (P.mass * 9.80665) / 4;
    const act = computeActuation([hover, hover, hover, hover], P);
    expect(act.torque.x).toBeCloseTo(0, 12);
    expect(act.torque.y).toBeCloseTo(0, 12);
    expect(act.torque.z).toBeCloseTo(0, 12);
  });
});
