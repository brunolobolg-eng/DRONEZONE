/**
 * Vetor 3D imutável. Operações sempre devolvem um novo objeto, o que mantém
 * o núcleo simples de testar. Unidades: metros, segundos, radianos (ver docs/PHYSICS_MODEL.md).
 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const lengthSq = (a: Vec3): number => dot(a, a);

export const length = (a: Vec3): number => Math.sqrt(lengthSq(a));

export const normalize = (a: Vec3): Vec3 => {
  const len = length(a);
  return len > 1e-12 ? scale(a, 1 / len) : ZERO;
};

export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

export const lerpVec = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});
