import { describe, expect, it } from 'vitest';
import { fromAxisAngle, integrateBodyRate, multiply, normalizeQuat, QUAT_IDENTITY, rotate, slerp } from '../../src/core/math/quat';
import { applyDeadzone, clamp, expoCurve, smoothstep } from '../../src/core/math/scalar';
import { createRng, valueNoise2 } from '../../src/core/math/random';
import { cross, dot, normalize, vec3 } from '../../src/core/math/vec3';

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('vetores', () => {
  it('produto vetorial segue a regra da mão direita', () => {
    const c = cross(vec3(1, 0, 0), vec3(0, 1, 0));
    expect(c).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('normalize não divide por zero', () => {
    expect(normalize(vec3(0, 0, 0))).toEqual({ x: 0, y: 0, z: 0 });
    close(dot(normalize(vec3(3, 4, 0)), normalize(vec3(3, 4, 0))), 1);
  });
});

describe('quaternions', () => {
  it('rotação de 90° em torno de X leva +Y para +Z', () => {
    const q = fromAxisAngle(vec3(1, 0, 0), Math.PI / 2);
    const v = rotate(q, vec3(0, 1, 0));
    close(v.x, 0);
    close(v.y, 0);
    close(v.z, 1);
  });

  it('composição preserva a rotação esperada', () => {
    const qa = fromAxisAngle(vec3(0, 1, 0), Math.PI / 3);
    const qb = fromAxisAngle(vec3(0, 1, 0), Math.PI / 6);
    const combined = multiply(qa, qb);
    const direct = fromAxisAngle(vec3(0, 1, 0), Math.PI / 2);
    const v1 = rotate(combined, vec3(1, 0, 0));
    const v2 = rotate(direct, vec3(1, 0, 0));
    close(v1.x, v2.x);
    close(v1.z, v2.z);
  });

  it('integração de taxa mantém o quaternion unitário em muitos passos', () => {
    let q = QUAT_IDENTITY;
    for (let i = 0; i < 100000; i++) {
      q = integrateBodyRate(q, vec3(7.3, -4.1, 9.9), 1 / 250);
    }
    const n = Math.hypot(q.x, q.y, q.z, q.w);
    close(n, 1, 1e-9);
  });

  it('integração com taxa zero não altera a orientação', () => {
    const q = fromAxisAngle(vec3(0, 0, 1), 0.4);
    expect(integrateBodyRate(q, vec3(0, 0, 0), 0.01)).toBe(q);
  });

  it('slerp retorna as extremidades e um meio-termo unitário', () => {
    const a = QUAT_IDENTITY;
    const b = fromAxisAngle(vec3(0, 1, 0), Math.PI / 2);
    const mid = slerp(a, b, 0.5);
    expect(slerp(a, b, 0)).toEqual(a);
    close(Math.hypot(mid.x, mid.y, mid.z, mid.w), 1, 1e-9);
    close(normalizeQuat(mid).y, Math.sin(Math.PI / 8), 1e-9);
  });
});

describe('escalares e curvas de entrada', () => {
  it('clamp limita nos dois sentidos', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.4, 0, 1)).toBe(0.4);
  });

  it('expo 0 é linear e expo 1 é cúbico', () => {
    expect(expoCurve(0.5, 0)).toBeCloseTo(0.5, 12);
    expect(expoCurve(0.5, 1)).toBeCloseTo(0.125, 12);
  });

  it('zona morta zera o centro e reescalona o restante até ±1', () => {
    expect(applyDeadzone(0.05, 0.1)).toBe(0);
    expect(applyDeadzone(-0.05, 0.1)).toBe(0);
    expect(applyDeadzone(1, 0.1)).toBeCloseTo(1, 12);
    expect(applyDeadzone(0.55, 0.1)).toBeCloseTo(0.5, 12);
    expect(applyDeadzone(-0.55, 0.1)).toBeCloseTo(-0.5, 12);
  });

  it('smoothstep sai de 0 e chega a 1', () => {
    expect(smoothstep(0, 1, 2)).toBe(0);
    expect(smoothstep(3, 1, 2)).toBe(1);
    expect(smoothstep(1.5, 1, 2)).toBeCloseTo(0.5, 12);
  });
});

describe('aleatoriedade determinística', () => {
  it('mesma semente gera a mesma sequência', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('sementes diferentes geram sequências diferentes', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it('ruído de valor fica em [0, 1) e é repetível', () => {
    for (let i = 0; i < 200; i++) {
      const v = valueNoise2(i * 0.37, i * 0.11, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(v).toBe(valueNoise2(i * 0.37, i * 0.11, 5));
    }
  });
});
