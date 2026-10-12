import { type Vec3, cross, add, scale, dot } from './vec3';

/**
 * Quaternion (x, y, z, w) que representa a orientação do corpo do drone.
 * Convenção: q rotaciona vetores do referencial do corpo para o do mundo.
 */
export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export const QUAT_IDENTITY: Quat = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

export const multiply = (a: Quat, b: Quat): Quat => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});

export const normalizeQuat = (q: Quat): Quat => {
  const n = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (n < 1e-12) return QUAT_IDENTITY;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
};

export const conjugate = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

/** Quaternion de rotação de `angle` radianos em torno do eixo unitário `axis`. */
export const fromAxisAngle = (axis: Vec3, angle: number): Quat => {
  const half = angle / 2;
  const s = Math.sin(half);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(half) };
};

/** Rotaciona um vetor pelo quaternion: v' = q v q*. */
export const rotate = (q: Quat, v: Vec3): Vec3 => {
  const u: Vec3 = { x: q.x, y: q.y, z: q.z };
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q.w)), cross(u, t));
};

/**
 * Integra a velocidade angular do corpo (rad/s, referencial do corpo) por `dt`.
 * Usa o incremento exato de eixo-ângulo, o que mantém a rotação estável com passos grandes.
 */
export const integrateBodyRate = (q: Quat, omegaBody: Vec3, dt: number): Quat => {
  const speed = Math.sqrt(dot(omegaBody, omegaBody));
  if (speed < 1e-12) return q;
  const axis = scale(omegaBody, 1 / speed);
  return normalizeQuat(multiply(q, fromAxisAngle(axis, speed * dt)));
};

/** Interpolação esférica entre duas orientações, t em [0, 1]. */
export const slerp = (a: Quat, b: Quat, t: number): Quat => {
  let cosHalf = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let target = b;
  if (cosHalf < 0) {
    cosHalf = -cosHalf;
    target = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
  }
  if (cosHalf > 0.9995) {
    return normalizeQuat({
      x: a.x + (target.x - a.x) * t,
      y: a.y + (target.y - a.y) * t,
      z: a.z + (target.z - a.z) * t,
      w: a.w + (target.w - a.w) * t,
    });
  }
  const halfAngle = Math.acos(cosHalf);
  const sinHalf = Math.sin(halfAngle);
  const wa = Math.sin((1 - t) * halfAngle) / sinHalf;
  const wb = Math.sin(t * halfAngle) / sinHalf;
  return {
    x: a.x * wa + target.x * wb,
    y: a.y * wa + target.y * wb,
    z: a.z * wa + target.z * wb,
    w: a.w * wa + target.w * wb,
  };
};
