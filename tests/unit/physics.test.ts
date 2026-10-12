import { describe, expect, it } from 'vitest';
import { FlightController } from '../../src/core/control/flight-controller';
import { NEUTRAL_INPUT, type PilotInput } from '../../src/core/control/pilot-input';
import { GRAVITY, DEFAULT_DRONE_PARAMS, type DroneParams } from '../../src/core/physics/drone-params';
import { createDroneState, type DroneState } from '../../src/core/physics/drone-state';
import { PhysicsWorld } from '../../src/core/physics/physics-world';
import { stepDrone } from '../../src/core/physics/drone-physics-model';
import { CALM_WIND } from '../../src/core/physics/wind';
import { computeTelemetry } from '../../src/core/telemetry/telemetry';
import { fromAxisAngle, normalizeQuat, rotate } from '../../src/core/math/quat';
import { createRng } from '../../src/core/math/random';
import { vec3 } from '../../src/core/math/vec3';
import { type ColliderEntry } from '../../src/core/physics/collision';

const FLAT_GROUND = { heightAt: () => 0 };
const NO_DRAG: DroneParams = { ...DEFAULT_DRONE_PARAMS, dragLinear: 0, dragQuadratic: 0, angularDamping: 0 };
const HOVER_PER_MOTOR = (DEFAULT_DRONE_PARAMS.mass * GRAVITY) / 4;
const HOVER_THROTTLE = (DEFAULT_DRONE_PARAMS.mass * GRAVITY) / (4 * DEFAULT_DRONE_PARAMS.motor.maxThrust);
const HZ = 250;

const makeWorld = (state: DroneState, params: DroneParams = NO_DRAG, extra: { colliders?: ColliderEntry[]; ground?: { heightAt: (x: number, z: number) => number } } = {}) => {
  const world = new PhysicsWorld(state, { params, ground: extra.ground ?? FLAT_GROUND, wind: CALM_WIND, fixedHz: HZ });
  for (const c of extra.colliders ?? []) world.addCollider(c);
  return world;
};

const hoveringState = (y = 50): DroneState => ({
  ...createDroneState(vec3(0, y, 0), NO_DRAG),
  flightState: 'armed',
  motorThrust: [HOVER_PER_MOTOR, HOVER_PER_MOTOR, HOVER_PER_MOTOR, HOVER_PER_MOTOR],
});

/** Roda `seconds` de simulação com uma entrada constante, em quadros de 1/60 s. */
const run = (world: PhysicsWorld, input: PilotInput, seconds: number) => {
  world.setInput(input);
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) world.advance(1 / 60);
  return world.state;
};

const hoverInput = (extra: Partial<PilotInput> = {}): PilotInput => ({ ...NEUTRAL_INPUT, throttle: HOVER_THROTTLE, ...extra });

describe('gravidade', () => {
  it('queda livre sem motores acelera a g', () => {
    const start: DroneState = createDroneState(vec3(0, 50, 0), NO_DRAG);
    const world = makeWorld(start);
    const after = run(world, NEUTRAL_INPUT, 0.5);
    // Compara com o tempo efetivamente simulado: o resto do acumulador ainda não virou passo.
    expect(after.velocity.y).toBeCloseTo(-GRAVITY * after.time, 6);
    expect(after.position.y).toBeCloseTo(50 - 0.5 * GRAVITY * after.time ** 2, 1);
  });

  it('arrasto opõe-se ao movimento e reduz a velocidade horizontal', () => {
    const start: DroneState = { ...createDroneState(vec3(0, 50, 0), DEFAULT_DRONE_PARAMS), velocity: vec3(10, 0, 0) };
    const world = makeWorld(start, DEFAULT_DRONE_PARAMS);
    const after = run(world, NEUTRAL_INPUT, 1);
    expect(after.velocity.x).toBeLessThan(10);
    expect(after.velocity.x).toBeGreaterThan(0);
  });
});

describe('empuxo', () => {
  it('empuxo igual ao peso mantém altitude e velocidade vertical constantes', () => {
    const world = makeWorld(hoveringState());
    const after = run(world, hoverInput(), 2);
    expect(Math.abs(after.velocity.y)).toBeLessThan(1e-3);
    expect(after.position.y).toBeCloseTo(50, 2);
  });

  it('o motor responde com constante de tempo de primeira ordem', () => {
    const tau = DEFAULT_DRONE_PARAMS.motor.responseTime;
    const demand: [number, number, number, number] = [4, 4, 4, 4];
    const next = stepDrone(
      { ...createDroneState(vec3(0, 50, 0), NO_DRAG), flightState: 'armed' },
      { demand, params: NO_DRAG, wind: CALM_WIND, dt: tau },
    );
    expect(next.motorThrust[0]).toBeCloseTo(4 * (1 - Math.exp(-1)), 6);
  });

  it('motores não passam do empuxo máximo nem ficam negativos', () => {
    const world = makeWorld({ ...hoveringState(), motorThrust: [0, 0, 0, 0] });
    world.setInput({ ...NEUTRAL_INPUT, throttle: 1 });
    for (let i = 0; i < 500; i++) {
      world.advance(1 / HZ);
      for (const f of world.state.motorThrust) {
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(NO_DRAG.motor.maxThrust + 1e-9);
      }
    }
  });

  it('desarmado, os motores desaceleram até zero', () => {
    const world = makeWorld(hoveringState());
    const after = run(world, NEUTRAL_INPUT, 1);
    for (const f of after.motorThrust) expect(f).toBeLessThan(1e-6);
  });
});

describe('controles de atitude (convenções do corpo)', () => {
  // Armar com acelerador zero; depois segurar o acelerador de hover com a entrada testada.
  const armed = (): PhysicsWorld => {
    const world = makeWorld({ ...createDroneState(vec3(0, 50, 0), NO_DRAG), flightState: 'disarmed' });
    world.setInput({ ...NEUTRAL_INPUT, armRequest: true });
    world.advance(1 / HZ);
    world.setInput(NEUTRAL_INPUT);
    return world;
  };

  it('roll positivo inclina a asa direita para baixo e gira em +X', () => {
    const world = armed();
    const after = run(world, hoverInput({ roll: 0.6 }), 0.3);
    expect(after.angularVelocity.x).toBeGreaterThan(0);
    expect(computeTelemetry(after, NO_DRAG, 0, false).rollDeg).toBeGreaterThan(5);
  });

  it('pitch positivo levanta o nariz (taxa positiva em z)', () => {
    const world = armed();
    const after = run(world, hoverInput({ pitch: 0.6 }), 0.3);
    expect(after.angularVelocity.z).toBeGreaterThan(0);
    expect(computeTelemetry(after, NO_DRAG, 0, false).pitchDeg).toBeGreaterThan(5);
  });

  it('yaw à direita faz o rumo aumentar', () => {
    const world = armed();
    const after = run(world, hoverInput({ yaw: 0.6 }), 0.5);
    expect(after.angularVelocity.y).toBeLessThan(0);
    const heading = computeTelemetry(after, NO_DRAG, 0, false).headingDeg;
    expect(heading).toBeGreaterThan(5);
    expect(heading).toBeLessThan(180);
  });

  it('a taxa de pitch segue a referência do modo Acro em regime', () => {
    const world = armed();
    const after = run(world, hoverInput({ pitch: 1 }), 1.2);
    const target = 8.7; // pitchRateMax padrão, expo 0.3 com entrada 1 produz 1
    expect(after.angularVelocity.z).toBeGreaterThan(target * 0.8);
    expect(after.angularVelocity.z).toBeLessThan(target * 1.2);
  });

  it('sem entrada, a taxa angular do modo Acro converge a zero', () => {
    const world = armed();
    run(world, hoverInput({ roll: 0.8 }), 0.2);
    const after = run(world, hoverInput(), 2);
    expect(Math.hypot(after.angularVelocity.x, after.angularVelocity.y, after.angularVelocity.z)).toBeLessThan(0.2);
  });
});

describe('passo fixo e taxas de renderização', () => {
  it('o número de passos depende só do tempo simulado, não do tamanho dos quadros', () => {
    const results = [1 / 20, 1 / 60, 1 / 144].map((frame) => {
      const world = makeWorld(hoveringState());
      world.setInput(hoverInput());
      let steps = 0;
      const total = 2;
      for (let t = 0; t < total - 1e-9; t += frame) steps += world.advance(Math.min(frame, total - t)).steps;
      return { steps, time: world.state.time };
    });
    for (const r of results) expect(Math.abs(r.steps - 2 * HZ)).toBeLessThanOrEqual(1);
    expect(results[0].steps).toBe(results[1].steps);
    expect(results[1].steps).toBe(results[2].steps);
  });

  it('o resultado da simulação não depende do tamanho do quadro (diferença só de quantização de um passo)', () => {
    const simulate = (frame: number) => {
      const world = makeWorld(hoveringState());
      world.setInput(hoverInput({ roll: 0.4, pitch: -0.2 }));
      for (let i = 0; i < Math.round(1 / frame); i++) world.advance(frame);
      return world.state;
    };
    const a = simulate(1 / 30);
    const b = simulate(1 / 120);
    // Os dois podem terminar com um passo de diferença. Esse passo desloca o drone por no máximo v·dt.
    const speed = Math.max(Math.hypot(a.velocity.x, a.velocity.y, a.velocity.z), Math.hypot(b.velocity.x, b.velocity.y, b.velocity.z));
    const tolerance = 1.5 * (1 / HZ) * speed + 1e-9;
    expect(Math.abs(a.time - b.time)).toBeLessThanOrEqual(1 / HZ + 1e-9);
    expect(Math.abs(a.position.x - b.position.x)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(a.position.y - b.position.y)).toBeLessThanOrEqual(tolerance);
  });

  it('funciona nas três frequências de passo testadas', () => {
    for (const hz of [100, 200, 250]) {
      const world = new PhysicsWorld(hoveringState(), { params: NO_DRAG, ground: FLAT_GROUND, wind: CALM_WIND, fixedHz: hz });
      world.setInput(hoverInput());
      const report = world.advance(1);
      // Limitado a 0,1 s por quadro: no máximo 0,1 s de simulação por chamada.
      expect(Math.abs(report.steps - hz * 0.1)).toBeLessThanOrEqual(1);
      expect(world.fixedHz).toBeCloseTo(hz, 9);
    }
  });

  it('pausa longa (aba suspensa) não acumula segundos de simulação', () => {
    const world = makeWorld(hoveringState());
    world.setInput(hoverInput());
    const report = world.advance(30);
    expect(report.steps).toBeLessThanOrEqual(Math.ceil(0.1 * HZ) + 1);
    expect(report.droppedSeconds).toBeGreaterThan(29.8);
    const before = world.state.time;
    world.advance(1 / 60);
    expect(world.state.time - before).toBeLessThan(0.05);
  });

  it('retomar depois de pausa não lança o drone: velocidade continua pequena', () => {
    const world = makeWorld(hoveringState());
    world.setInput(hoverInput());
    world.advance(60);
    expect(Math.abs(world.state.velocity.y)).toBeLessThan(0.05);
    expect(Math.abs(world.state.velocity.x)).toBeLessThan(0.05);
  });

  it('reinicialização de entrada coloca os comandos em neutro', () => {
    const world = makeWorld(hoveringState());
    world.setInput(hoverInput({ roll: 1 }));
    world.neutralizeInput();
    const after = run(world, NEUTRAL_INPUT, 0.2);
    expect(Math.abs(after.angularVelocity.x)).toBeLessThan(1e-6);
  });

  it('interpolação visual fica entre o passo anterior e o atual', () => {
    const world = makeWorld(hoveringState());
    world.setInput(NEUTRAL_INPUT);
    world.advance(1.5 / HZ);
    const pose = world.renderPose();
    // O drone cai: a pose interpolada fica entre o passo atual (mais baixo) e o anterior (mais alto).
    const cur = world.state.position.y;
    const maxStepDrop = Math.abs(world.state.velocity.y) * world.dt;
    expect(pose.position.y).toBeGreaterThanOrEqual(cur - 1e-9);
    expect(pose.position.y).toBeLessThanOrEqual(cur + maxStepDrop + 1e-9);
  });
});

describe('estabilidade numérica', () => {
  it('60 s de entradas aleatórias mantém tudo finito e o quaternion unitário', () => {
    const rng = createRng(2026);
    const world = makeWorld(hoveringState(5), DEFAULT_DRONE_PARAMS, {
      ground: { heightAt: () => 0 },
    });
    world.setInput(NEUTRAL_INPUT);
    for (let i = 0; i < 60 * 60; i++) {
      world.setInput({
        roll: rng.range(-1, 1),
        pitch: rng.range(-1, 1),
        yaw: rng.range(-1, 1),
        throttle: rng.range(0, 0.35),
        armRequest: false,
      });
      world.advance(1 / 60);
      const s = world.state;
      for (const v of [s.position.x, s.position.y, s.position.z, s.velocity.x, s.velocity.y, s.velocity.z]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      const q = s.orientation;
      expect(Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1)).toBeLessThan(1e-9);
      expect(Math.hypot(s.velocity.x, s.velocity.y, s.velocity.z)).toBeLessThan(120);
    }
  });

  it('orientação permanece unitária com velocidade angular alta', () => {
    const q = normalizeQuat(fromAxisAngle(vec3(0, 0, 1), 1));
    const v = rotate(q, vec3(1, 0, 0));
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 9);
  });
});

describe('impactos, colisões e integridade', () => {
  it('queda de 5 m causa dano sem destruir; queda de 10 m destrói a estrutura', () => {
    const fall = (height: number) => {
      const world = makeWorld({ ...createDroneState(vec3(0, height, 0), NO_DRAG), flightState: 'disarmed' });
      for (let i = 0; i < 60 * 10; i++) world.advance(1 / 60);
      return { state: world.state, events: world.drainEvents() };
    };
    const soft = fall(5);
    expect(soft.state.flightState).toBe('disarmed');
    expect(soft.state.integrity).toBeLessThan(DEFAULT_DRONE_PARAMS.integrityMax);
    expect(soft.state.integrity).toBeGreaterThan(0);
    expect(soft.events.some((e) => e.source === 'ground')).toBe(true);

    const hard = fall(10);
    expect(hard.state.flightState).toBe('crashed');
    expect(hard.state.integrity).toBe(0);
  });

  it('colisão com caixa empurra o drone para fora e gera evento de colisor', () => {
    const wall: ColliderEntry = {
      id: 'wall-1',
      enabled: true,
      box: { min: vec3(3, 0, -2), max: vec3(4, 10, 2) },
    };
    const start: DroneState = { ...createDroneState(vec3(0, 8, 0), NO_DRAG), flightState: 'disarmed', velocity: vec3(5, 0, 0) };
    const world = makeWorld(start, NO_DRAG, { colliders: [wall] });
    for (let i = 0; i < 60; i++) world.advance(1 / 60);
    const events = world.drainEvents();
    expect(world.state.position.x).toBeLessThanOrEqual(3 - NO_DRAG.radius + 1e-6);
    expect(events.some((e) => e.source === 'collider' && e.colliderId === 'wall-1')).toBe(true);
  });

  it('colisor desativado (parede destruída) deixa o drone passar', () => {
    const wall: ColliderEntry = { id: 'wall-2', enabled: false, box: { min: vec3(3, 0, -2), max: vec3(4, 10, 2) } };
    const start: DroneState = { ...createDroneState(vec3(0, 8, 0), NO_DRAG), flightState: 'disarmed', velocity: vec3(5, 0, 0) };
    const world = makeWorld(start, NO_DRAG, { colliders: [wall] });
    for (let i = 0; i < 60; i++) world.advance(1 / 60);
    expect(world.state.position.x).toBeGreaterThan(4);
    expect(world.drainEvents()).toHaveLength(0);
  });

  it('impacto com o solo não gera evento para contatos muito leves', () => {
    const start: DroneState = { ...createDroneState(vec3(0, 0.2, 0), NO_DRAG), flightState: 'disarmed' };
    const world = makeWorld(start);
    for (let i = 0; i < 120; i++) world.advance(1 / 60);
    expect(world.drainEvents().filter((e) => e.speed > 2)).toHaveLength(0);
  });
});

describe('energia', () => {
  it('a bateria descarrega conforme a potência do empuxo', () => {
    const world = makeWorld(hoveringState());
    const before = world.state.batteryWh;
    run(world, hoverInput(), 10);
    const used = before - world.state.batteryWh;
    const expectedWh = HOVER_PER_MOTOR * 4 * NO_DRAG.powerPerNewton * 10 / 3600;
    expect(used).toBeGreaterThan(expectedWh * 0.9);
    expect(used).toBeLessThan(expectedWh * 1.1);
  });

  it('a bateria nunca fica negativa', () => {
    const world = makeWorld({ ...hoveringState(), batteryWh: 0.001 });
    run(world, hoverInput(), 5);
    expect(world.state.batteryWh).toBeGreaterThanOrEqual(0);
  });
});

describe('controlador de voo integrado', () => {
  it('controlador reinicia a integral ao desarmar', () => {
    const controller = new FlightController();
    const armedState = hoveringState();
    controller.update(armedState, hoverInput({ roll: 1 }), NO_DRAG, 0.004);
    const out = controller.update({ ...armedState, flightState: 'disarmed' }, NEUTRAL_INPUT, NO_DRAG, 0.004);
    expect(out.demand).toEqual([0, 0, 0, 0]);
  });
});
