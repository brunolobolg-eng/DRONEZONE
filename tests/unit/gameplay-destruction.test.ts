import { describe, expect, it } from 'vitest';
import { applyDamage, createComponent, stateFromHealth, worstState } from '../../src/gameplay/destruction/damage-state';
import { createStructure, damageStructure, specsForHouse } from '../../src/gameplay/destruction/structure';
import { FragmentPool } from '../../src/gameplay/destruction/fragment-pool';
import { craterFromSpeed, structureDamageFromSpeed, DEFAULT_IMPACT_RULES } from '../../src/gameplay/destruction/impact-rules';
import { createRng } from '../../src/core/math/random';
import { vec3 } from '../../src/core/math/vec3';

describe('estados de dano', () => {
  it('faixas de vida definem intacto, danificado, grave e destruído', () => {
    expect(stateFromHealth(100, 100)).toBe('intact');
    expect(stateFromHealth(60, 100)).toBe('damaged');
    expect(stateFromHealth(20, 100)).toBe('severe');
    expect(stateFromHealth(0, 100)).toBe('destroyed');
  });

  it('transições seguem a ordem e registram a mudança', () => {
    let c = createComponent('w', 'window', vec3(), 100);
    const seen: string[] = [];
    for (const dmg of [40, 30, 35]) {
      const r = applyDamage(c, dmg);
      c = r.component;
      if (r.transition) seen.push(`${r.transition.from}->${r.transition.to}`);
    }
    expect(seen).toEqual(['intact->damaged', 'damaged->severe', 'severe->destroyed']);
    expect(c.health).toBe(0);
  });

  it('dano não regride: nada volta a ser intacto e destruído não recebe mais transições', () => {
    const c = createComponent('w', 'window', vec3(), 100);
    const destroyed = applyDamage(c, 500).component;
    const again = applyDamage(destroyed, 10);
    expect(again.transition).toBeNull();
    expect(again.component.state).toBe('destroyed');
    expect(worstState('damaged', 'severe')).toBe('severe');
  });

  it('dano zero ou negativo não faz nada', () => {
    const c = createComponent('w', 'window', vec3(), 100);
    expect(applyDamage(c, 0).component).toBe(c);
    expect(applyDamage(c, -10).transition).toBeNull();
  });

  it('vida máxima inválida é rejeitada', () => {
    expect(() => createComponent('w', 'window', vec3(), 0)).toThrow(RangeError);
  });
});

describe('estrutura de construção', () => {
  const specs = specsForHouse(5, 4, 3, [vec3(5, 1.6, -1), vec3(5, 1.6, 1), vec3(0, 1.6, -4)], vec3(5, 1, 0));

  it('exige uma peça estrutural', () => {
    expect(() => createStructure('x', [{ id: 'w', kind: 'window', center: vec3(), maxHealth: 10 }])).toThrow(/estrutural/);
  });

  it('dano concentrado em um ponto atinge as peças mais próximas', () => {
    const s = createStructure('house-x', specs);
    const impact = vec3(5, 1.6, -1);
    const { structure, events } = damageStructure(s, impact, 30);
    expect(events.some((e) => e.type === 'component')).toBe(true);
    expect(structure.components.get('window-0')!.health).toBeLessThan(18);
    expect(structure.components.get('facade-back')!.health).toBe(90);
  });

  it('estado da construção piora conforme as peças estruturais são destruídas', () => {
    let s = createStructure('house-x', specs);
    const states: string[] = [s.state];
    for (let k = 0; k < 40; k++) {
      const r = damageStructure(s, vec3(0, 1.5, 0), 25);
      s = r.structure;
      if (states[states.length - 1] !== s.state) states.push(s.state);
    }
    expect(states).toEqual(['intact', 'damaged', 'severe', 'destroyed']);
  });

  it('cobertura destruída deixa a construção grave, mesmo com a estrutura inteira', () => {
    let s = createStructure('house-x', specs);
    for (let k = 0; k < 20 && s.components.get('roof')!.state !== 'destroyed'; k++) {
      s = damageStructure(s, vec3(0, 3.8, 0), 20).structure;
    }
    expect(s.components.get('roof')!.state).toBe('destroyed');
    expect(s.state).toBe('severe');
    expect(s.components.get('core')!.state).not.toBe('destroyed');
  });

  it('dano não positivo não altera a estrutura', () => {
    const s = createStructure('house-x', specs);
    expect(damageStructure(s, vec3(), 0).structure).toBe(s);
  });

  it('evento de estrutura só aparece quando o estado geral muda', () => {
    const s = createStructure('house-x', specs);
    const once = damageStructure(s, vec3(0, 1.5, 0), 5);
    expect(once.events.filter((e) => e.type === 'structure')).toHaveLength(0);
  });
});

describe('pool de fragmentos', () => {
  it('nunca passa da capacidade, mesmo com muitos impactos seguidos', () => {
    const pool = new FragmentPool({ capacity: 30, lifetime: 2, despawnDistance: 500, restitution: 0.3 }, createRng(1));
    for (let k = 0; k < 200; k++) {
      pool.spawn(vec3(0, 1, 0), 10, 4);
      expect(pool.activeCount).toBeLessThanOrEqual(30);
    }
    expect(pool.activeCount).toBe(30);
    expect(pool.capacity).toBe(30);
  });

  it('fragmentos expiram pela vida e somem quando ficam longe do drone', () => {
    const pool = new FragmentPool({ capacity: 10, lifetime: 1, despawnDistance: 50, restitution: 0.3 }, createRng(2));
    pool.spawn(vec3(0, 1, 0), 5, 0);
    const ground = () => 0;
    pool.update(0.5, ground, vec3(0, 0, 0), 9.8);
    expect(pool.activeCount).toBeGreaterThan(0);
    pool.update(2, ground, vec3(0, 0, 0), 9.8);
    expect(pool.activeCount).toBe(0);
  });

  it('fragmento que cai encosta no solo e não o atravessa', () => {
    const pool = new FragmentPool({ capacity: 4, lifetime: 10, despawnDistance: 500, restitution: 0.3 }, createRng(3));
    pool.spawn(vec3(0, 5, 0), 1, 0);
    for (let i = 0; i < 1000; i++) pool.update(1 / 100, () => 0, vec3(0, 0, 0), 9.8);
    const f = pool.fragments.find((x) => x.active);
    if (f) expect(f.y).toBeGreaterThanOrEqual(0);
  });

  it('a mesma semente gera os mesmos fragmentos', () => {
    const a = new FragmentPool({ capacity: 8, lifetime: 2, despawnDistance: 100, restitution: 0.3 }, createRng(9));
    const b = new FragmentPool({ capacity: 8, lifetime: 2, despawnDistance: 100, restitution: 0.3 }, createRng(9));
    a.spawn(vec3(1, 2, 3), 4, 3);
    b.spawn(vec3(1, 2, 3), 4, 3);
    expect(a.fragments.map((f) => f.vx)).toEqual(b.fragments.map((f) => f.vx));
  });
});

describe('regras de impacto', () => {
  it('impactos fracos não deformam o solo', () => {
    expect(craterFromSpeed(1)).toBeNull();
  });

  it('cratera cresce com a velocidade, mas é limitada', () => {
    const small = craterFromSpeed(4)!;
    const big = craterFromSpeed(30)!;
    expect(big.radius).toBeGreaterThan(small.radius);
    expect(big.radius).toBeLessThanOrEqual(3.2);
    expect(big.depth).toBeLessThanOrEqual(0.9);
  });

  it('dano à estrutura começa acima do limiar', () => {
    expect(structureDamageFromSpeed(0.5)).toBe(0);
    expect(structureDamageFromSpeed(3)).toBeCloseTo(2 * DEFAULT_IMPACT_RULES.structureDamagePerSpeed, 9);
  });
});
