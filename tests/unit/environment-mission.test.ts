import { describe, expect, it } from 'vitest';
import { AREA_HALF_EXTENT, FLAT_HALF_WIDTH, ROAD_HALF_WIDTH, generateNeighborhood } from '../../src/gameplay/environment/layout';
import { Mission } from '../../src/gameplay/missions/mission';
import { vec3 } from '../../src/core/math/vec3';

describe('bairro fictício', () => {
  const hood = generateNeighborhood(20260);

  it('é determinístico pela semente e muda com outra semente', () => {
    expect(generateNeighborhood(20260)).toEqual(hood);
    expect(generateNeighborhood(99).houses[0].center).not.toEqual(hood.houses[0].center);
  });

  it('casas ficam fora da via e dentro da área jogável', () => {
    for (const h of hood.houses) {
      const minZ = h.center.z - h.depth / 2;
      const maxZ = h.center.z + h.depth / 2;
      const inRoadBand = minZ < ROAD_HALF_WIDTH && maxZ > -ROAD_HALF_WIDTH;
      expect(inRoadBand).toBe(false);
      expect(Math.abs(h.center.x)).toBeLessThan(AREA_HALF_EXTENT);
      expect(Math.abs(h.center.z)).toBeLessThan(AREA_HALF_EXTENT);
    }
  });

  it('casas são de um ou dois pavimentos, com janelas e porta dentro das fachadas', () => {
    for (const h of hood.houses) {
      expect([1, 2]).toContain(h.floors);
      expect(h.height).toBeGreaterThan(3);
      for (const w of h.windows) {
        expect(Math.abs(w.x)).toBeLessThanOrEqual(h.width / 2 + 1e-9);
        expect(Math.abs(w.z)).toBeLessThanOrEqual(h.depth / 2 + 1e-9);
      }
      expect(h.door.x).toBeCloseTo(h.width / 2, 9);
    }
  });

  it('o relevo fica plano dentro da faixa dos lotes, para casas não flutuarem', () => {
    expect(FLAT_HALF_WIDTH).toBeGreaterThanOrEqual(28);
  });

  it('há um colisor para cada casa, com o id usado pela estrutura destrutível', () => {
    const ids = new Set(hood.colliders.map((c) => c.id));
    for (const h of hood.houses) expect(ids.has(`${h.id}:body`)).toBe(true);
  });

  it('o ponto de partida fica acima do solo, sobre a via', () => {
    expect(Math.abs(hood.spawn.z)).toBeLessThan(ROAD_HALF_WIDTH);
    expect(hood.spawn.y).toBeGreaterThan(0);
  });

  it('pontos de controle ficam sobre a via, em ordem crescente de x', () => {
    const xs = hood.checkpoints.map((c) => c.position.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    for (const c of hood.checkpoints) expect(Math.abs(c.position.z)).toBeLessThan(ROAD_HALF_WIDTH);
  });
});

describe('missão', () => {
  const cps = [
    { id: 'a', position: vec3(0, 5, 0), radius: 2 },
    { id: 'b', position: vec3(10, 5, 0), radius: 2 },
  ];

  it('não avança antes de começar', () => {
    const m = new Mission(cps);
    expect(m.update(vec3(0, 5, 0), 1)).toEqual([]);
    expect(m.state).toBe('ready');
  });

  it('passa pelos pontos em ordem e conclui', () => {
    const m = new Mission(cps);
    m.start(0);
    expect(m.update(vec3(10, 5, 0), 1)).toEqual([]); // pulou o primeiro: não conta
    const first = m.update(vec3(0, 5, 0), 2);
    expect(first[0]).toMatchObject({ type: 'checkpoint', index: 0, total: 2 });
    const second = m.update(vec3(10.5, 5, 0), 3);
    expect(second.map((e) => e.type)).toEqual(['checkpoint', 'completed']);
    expect(m.state).toBe('completed');
    expect(m.elapsed(10)).toBe(3);
  });

  it('falha registra o motivo e não permite mais progresso', () => {
    const m = new Mission(cps);
    m.start(0);
    expect(m.fail('crash', 4)).toEqual([{ type: 'failed', reason: 'crash' }]);
    expect(m.update(vec3(0, 5, 0), 5)).toEqual([]);
    expect(m.state).toBe('failed');
  });

  it('reset volta ao início', () => {
    const m = new Mission(cps);
    m.start(0);
    m.update(vec3(0, 5, 0), 1);
    m.reset();
    expect(m.state).toBe('ready');
    expect(m.progress.index).toBe(0);
  });

  it('exige pelo menos um ponto', () => {
    expect(() => new Mission([])).toThrow(RangeError);
  });
});
