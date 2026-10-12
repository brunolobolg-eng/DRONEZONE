import { describe, expect, it } from 'vitest';
import { FAILSAFE_SECONDS, GameSession } from '../../src/gameplay/game-session';
import { DEFAULT_CATALOG } from '../../src/gameplay/progression/catalog';
import { DEFAULT_LOADOUT } from '../../src/gameplay/progression/loadout';
import { createNewSave, parseSave, serializeSave } from '../../src/gameplay/progression/save-data';
import { type ControlFrame } from '../../src/gameplay/input/input-mapping';
import { NEUTRAL_INPUT } from '../../src/core/control/pilot-input';
import { vec3 } from '../../src/core/math/vec3';
import { START_BALANCE } from '../../src/gameplay/progression/economy';

const frameOf = (over: Partial<ControlFrame> = {}): ControlFrame => ({
  input: NEUTRAL_INPUT,
  throttle: 0,
  buttons: { arm: false, reset: false, pause: false, telemetry: false },
  gamepadConnected: true,
  keyboardActive: false,
  ...over,
});

const newSession = (onSave?: (s: ReturnType<typeof createNewSave>) => void) =>
  new GameSession({ catalog: DEFAULT_CATALOG, save: createNewSave(DEFAULT_CATALOG), seed: 7, fixedHz: 250, onSave });

const armPulse = frameOf({ buttons: { arm: true, reset: false, pause: false, telemetry: false } });

describe('inicialização do jogo', () => {
  it('monta cenário, terreno, missão e drone a partir de uma semente', () => {
    const s = newSession();
    expect(s.neighborhood.houses.length).toBeGreaterThanOrEqual(6);
    expect(s.structureList.length).toBe(s.neighborhood.houses.length);
    expect(s.mission.state).toBe('ready');
    expect(s.world.state.flightState).toBe('disarmed');
    expect(s.world.state.position.y).toBeGreaterThan(0);
  });

  it('o mesmo seed gera o mesmo bairro e o mesmo terreno', () => {
    const a = newSession();
    const b = newSession();
    expect(a.neighborhood.houses.map((h) => h.center)).toEqual(b.neighborhood.houses.map((h) => h.center));
    expect(Array.from(a.terrain.snapshotHeights())).toEqual(Array.from(b.terrain.snapshotHeights()));
  });

  it('a missão começa quando o drone é armado', () => {
    const s = newSession();
    s.frame(armPulse, 1 / 60);
    expect(s.world.state.flightState).toBe('armed');
    expect(s.mission.state).toBe('running');
  });
});

describe('ciclo de voo', () => {
  it('armar, subir e reiniciar pelo botão de borda', () => {
    const s = newSession();
    s.frame(armPulse, 1 / 60);
    // Cada quadro simula no máximo 0,1 s (proteção contra abas suspensas): 5 quadros = 0,5 s de voo.
    for (let i = 0; i < 5; i++) s.frame(frameOf({ throttle: 0.4, input: { ...NEUTRAL_INPUT, throttle: 0.4 } }), 0.1);
    expect(s.world.state.time).toBeGreaterThan(0.4);

    const resetPulse = frameOf({ buttons: { arm: false, reset: true, pause: false, telemetry: false } });
    s.frame(resetPulse, 1 / 60);
    expect(s.world.state.flightState).toBe('disarmed');
    expect(s.mission.state).toBe('ready');
  });

  it('o pedido de armar não se repete a cada passo do quadro', () => {
    const s = newSession();
    s.frame(armPulse, 0.05);
    expect(s.world.state.flightState).toBe('armed');
    s.frame(frameOf(), 0.05);
    expect(s.world.state.flightState).toBe('armed');
  });

  it('failsafe desarma os motores depois de perder o sinal', () => {
    const s = newSession();
    s.frame(armPulse, 1 / 60);
    const steps = Math.ceil(FAILSAFE_SECONDS / (1 / 10));
    for (let i = 0; i < steps; i++) s.frame(frameOf({ gamepadConnected: false, keyboardActive: false }), 1 / 10);
    expect(s.world.state.flightState).toBe('disarmed');
    expect(s.drainEvents().some((e) => e.type === 'failsafe')).toBe(true);
  });
});

describe('impactos, destruição e terreno', () => {
  it('impacto no solo cria cratera e fragmentos', () => {
    const s = newSession();
    s.applyGroundImpact(0, 10, 8);
    const events = s.drainEvents();
    expect(events.some((e) => e.type === 'crater')).toBe(true);
    expect(events.some((e) => e.type === 'fragments')).toBe(true);
    expect(s.terrain.craterRecords.length).toBe(1);
  });

  it('impacto fraco no solo não deixa cratera', () => {
    const s = newSession();
    s.applyGroundImpact(0, 10, 1);
    expect(s.drainEvents().some((e) => e.type === 'crater')).toBe(false);
  });

  it('colisão com uma casa dana a estrutura e registra a transição', () => {
    const s = newSession();
    const house = s.neighborhood.houses[0];
    const wall = s.world.state;
    // Solta o drone de frente para a casa, a alguns metros da fachada, e deixa cair sobre a parede.
    const target = house.center;
    const launch = { ...wall, position: vec3(target.x - house.width / 2 - 1.2, target.y + 2, target.z), velocity: vec3(12, 0, 0), flightState: 'disarmed' as const };
    s.world.reset(launch);
    let transitions = 0;
    for (let i = 0; i < 180; i++) {
      s.frame(frameOf(), 1 / 60);
      for (const e of s.drainEvents()) if (e.type === 'structure') transitions += e.events.length;
    }
    expect(transitions).toBeGreaterThan(0);
    expect(s.structure(house.id)!.state).not.toBe('intact');
  });

  it('estrutura destruída desativa seu colisor, e o drone passa pelo local', () => {
    const s = newSession();
    const house = s.neighborhood.houses[0];
    const colliderId = `${house.id}:body`;
    const point = vec3(house.center.x + house.width / 2, 1.5, house.center.z);

    for (let k = 0; k < 60 && s.structure(house.id)!.state !== 'destroyed'; k++) {
      s.applyStructureImpact(colliderId, point, 20);
    }
    expect(s.structure(house.id)!.state).toBe('destroyed');
    const events = s.drainEvents();
    expect(events.some((e) => e.type === 'collider-off' && e.colliderId === colliderId)).toBe(true);

    // Voo nivelado em hover, começando dentro da área da casa e cruzando-a de oeste a leste.
    // Com o colisor ativo, a casa empurraria o drone para fora logo no início.
    const hover = 0.2171;
    s.world.reset({
      ...s.world.state,
      position: vec3(house.center.x - house.width / 2 + 0.5, 1.5, house.center.z),
      velocity: vec3(16, 0, 0),
      motorThrust: [1.52, 1.52, 1.52, 1.52],
      flightState: 'armed',
    });
    for (let i = 0; i < 60; i++) s.frame(frameOf({ throttle: hover, input: { ...NEUTRAL_INPUT, throttle: hover } }), 1 / 60);
    expect(s.world.state.position.x).toBeGreaterThan(house.center.x + house.width / 2);
    const houseHits = s.drainEvents().filter((e) => e.type === 'impact' && e.impact.colliderId === colliderId);
    expect(houseHits).toHaveLength(0);
    expect(s.world.state.integrity).toBe(s.drone.params.integrityMax);
  });
});

describe('missão e recompensas', () => {
  it('atravessar os pontos em ordem completa a missão e paga a recompensa', () => {
    const s = newSession();
    s.frame(armPulse, 1 / 60);
    const cps = s.neighborhood.checkpoints;
    for (const cp of cps) {
      s.world.reset({ ...s.world.state, position: vec3(cp.position.x, cp.position.y, cp.position.z), flightState: 'armed' });
      s.frame(frameOf({ throttle: 0.22, input: { ...NEUTRAL_INPUT, throttle: 0.22 } }), 1 / 60);
    }
    expect(s.mission.state).toBe('completed');
    expect(s.saveData.balance).toBeGreaterThan(START_BALANCE);
    const rewards = s.drainEvents().filter((e) => e.type === 'reward');
    expect(rewards.length).toBeGreaterThanOrEqual(cps.length);
  });

  it('crash falha a missão', () => {
    const s = newSession();
    s.frame(armPulse, 1 / 60);
    s.world.reset({ ...s.world.state, integrity: 0, flightState: 'crashed' });
    s.frame(frameOf(), 1 / 60);
    expect(s.mission.state).toBe('failed');
    expect(s.drainEvents().some((e) => e.type === 'crash')).toBe(true);
  });
});

describe('economia e equipamento', () => {
  it('comprar e equipar atualiza o save e chama o callback', () => {
    const saved: string[] = [];
    const s = newSession((save) => saved.push(serializeSave(save)));
    expect(s.buy('motors-2207').ok).toBe(true);
    expect(s.equip({ ...DEFAULT_LOADOUT, motors: 'motors-2207' }).ok).toBe(true);
    expect(s.drone.params.motor.maxThrust).toBeGreaterThan(7);
    expect(saved.length).toBe(2);
  });

  it('não equipa peça que não foi comprada', () => {
    const s = newSession();
    const r = s.equip({ ...DEFAULT_LOADOUT, motors: 'motors-2306' });
    expect(r.ok).toBe(false);
  });

  it('não troca peças com o drone armado', () => {
    const s = newSession();
    s.buy('motors-2207');
    s.frame(armPulse, 1 / 60);
    expect(s.equip({ ...DEFAULT_LOADOUT, motors: 'motors-2207' }).ok).toBe(false);
  });

  it('reparo cobra o custo e restaura a integridade', () => {
    const s = newSession();
    s.world.reset({ ...s.world.state, integrity: 60 });
    const before = s.balance;
    const r = s.repair();
    expect(r.ok).toBe(true);
    expect(r.cost).toBeGreaterThan(0);
    expect(s.balance).toBe(before - r.cost);
    expect(s.world.state.integrity).toBe(s.drone.params.integrityMax);
  });

  it('o save salvo pode ser lido de volta sem perda', () => {
    const saved: string[] = [];
    const s = newSession((save) => saved.push(serializeSave(save)));
    s.buy('camera-hd');
    s.equip({ ...DEFAULT_LOADOUT, camera: 'camera-hd' });
    const restored = parseSave(saved[saved.length - 1], DEFAULT_CATALOG);
    expect(restored.recovered).toBe(false);
    expect(restored.save.loadout.camera).toBe('camera-hd');
    expect(restored.save.balance).toBe(s.balance);
  });
});
