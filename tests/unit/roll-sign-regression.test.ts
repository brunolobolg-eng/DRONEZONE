import { describe, expect, it } from 'vitest';
import { NEUTRAL_INPUT, type PilotInput } from '../../src/core/control/pilot-input';
import { DEFAULT_DRONE_PARAMS, GRAVITY } from '../../src/core/physics/drone-params';
import { createDroneState } from '../../src/core/physics/drone-state';
import { PhysicsWorld } from '../../src/core/physics/physics-world';
import { CALM_WIND } from '../../src/core/physics/wind';
import { computeTelemetry } from '../../src/core/telemetry/telemetry';
import { vec3 } from '../../src/core/math/vec3';

const P = DEFAULT_DRONE_PARAMS;
const FLAT = { heightAt: () => 0 };

/** Roda uma sequência de entradas com quadros de 1/60 s, como o navegador. */
const flyWith = (inputs: { input: PilotInput; seconds: number }[]) => {
  const world = new PhysicsWorld({ ...createDroneState(vec3(0, 50, 0), P), flightState: 'disarmed' }, {
    params: P,
    ground: FLAT,
    wind: CALM_WIND,
    fixedHz: 250,
  });
  world.setInput({ ...NEUTRAL_INPUT, armRequest: true });
  world.advance(1 / 60);
  for (const step of inputs) {
    world.setInput(step.input);
    for (let i = 0; i < Math.round(step.seconds * 60); i++) world.advance(1 / 60);
  }
  return world;
};

describe('sinal da rolagem', () => {
  it('roll positivo com acelerador de hover: asa direita desce (ângulo pequeno)', () => {
    const hover = (P.mass * GRAVITY) / (4 * P.motor.maxThrust);
    const world = flyWith([{ input: { ...NEUTRAL_INPUT, throttle: hover, roll: 1 }, seconds: 0.15 }]);
    expect(computeTelemetry(world.state, P, 0, world.saturated).rollDeg).toBeGreaterThan(0);
  });

  it('a rolagem telemétrica acompanha a volta completa do modo Acro (sem dobrar o ângulo)', () => {
    const hover = (P.mass * GRAVITY) / (4 * P.motor.maxThrust);
    const world = flyWith([{ input: { ...NEUTRAL_INPUT, throttle: hover, roll: 1 }, seconds: 0.7 }]);
    // Com stick cheio, a rolagem passa de 180°. O valor precisa estar em [-180, 180] e coerente com a taxa.
    const roll = computeTelemetry(world.state, P, 0, world.saturated).rollDeg;
    expect(Math.abs(roll)).toBeLessThanOrEqual(180 + 1e-9);
    expect(world.state.angularVelocity.x).toBeGreaterThan(0);
  });

  it('roll positivo com acelerador alto (saturado): mesmo sinal', () => {
    const world = flyWith([{ input: { ...NEUTRAL_INPUT, throttle: 1, roll: 1 }, seconds: 0.7 }]);
    const t = computeTelemetry(world.state, P, 0, world.saturated);
    expect(t.saturated).toBe(true);
    expect(world.state.angularVelocity.x).toBeGreaterThan(0);
  });

  it('roll positivo depois de subir (acelerador 1 por 2 s, depois 0,7 s de rolagem)', () => {
    const world = flyWith([
      { input: { ...NEUTRAL_INPUT, throttle: 1 }, seconds: 2 },
      { input: { ...NEUTRAL_INPUT, throttle: 1, roll: 1 }, seconds: 0.7 },
    ]);
    expect(world.state.angularVelocity.x).toBeGreaterThan(0);
  });
});
