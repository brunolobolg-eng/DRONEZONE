/**
 * Gerador pseudoaleatório determinístico (mulberry32). Mesma semente, mesma sequência,
 * em qualquer plataforma. Usado para cenário, deformações e testes reproduzíveis.
 */
export interface Rng {
  /** Número em [0, 1). */
  next(): number;
  /** Número em [min, max). */
  range(min: number, max: number): number;
  /** Inteiro em [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Elemento escolhido uniformemente. */
  pick<T>(items: readonly T[]): T;
}

export const createRng = (seed: number): Rng => {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
  };
};

/** Hash de inteiro para ruído sem estado: mesma entrada, mesma saída. */
export const hash2 = (ix: number, iz: number, seed: number): number => {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

/** Ruído de valor 2D suave, em [0, 1). */
export const valueNoise2 = (x: number, z: number, seed: number): number => {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sz;
};
