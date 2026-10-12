import { type Vec3, vec3 } from '../math/vec3';

/** Caixa alinhada aos eixos. Usada para construções, cercas e árvores simplificadas. */
export interface Aabb {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface ColliderEntry {
  readonly id: string;
  readonly box: Aabb;
  /** Colisores desativados (ex.: parede destruída) não participam da física. */
  enabled: boolean;
}

export interface Contact {
  /** Normal de contato apontando do obstáculo para o drone. */
  readonly normal: Vec3;
  /** Quanto o drone deve ser empurrado para sair da sobreposição, em metros. */
  readonly penetration: number;
  readonly point: Vec3;
}

/** Contato entre esfera e caixa. Retorna null sem sobreposição. */
export const sphereVsAabb = (center: Vec3, radius: number, box: Aabb): Contact | null => {
  const cx = clampRange(center.x, box.min.x, box.max.x);
  const cy = clampRange(center.y, box.min.y, box.max.y);
  const cz = clampRange(center.z, box.min.z, box.max.z);
  const closest = vec3(cx, cy, cz);
  const dx = center.x - cx;
  const dy = center.y - cy;
  const dz = center.z - cz;
  const distSq = dx * dx + dy * dy + dz * dz;

  if (distSq > 1e-12) {
    if (distSq >= radius * radius) return null;
    const dist = Math.sqrt(distSq);
    return { normal: vec3(dx / dist, dy / dist, dz / dist), penetration: radius - dist, point: closest };
  }

  // Centro dentro da caixa: empurra pela face mais próxima.
  const faces = [
    { axis: 'x' as const, sign: -1, gap: center.x - box.min.x },
    { axis: 'x' as const, sign: 1, gap: box.max.x - center.x },
    { axis: 'y' as const, sign: -1, gap: center.y - box.min.y },
    { axis: 'y' as const, sign: 1, gap: box.max.y - center.y },
    { axis: 'z' as const, sign: -1, gap: center.z - box.min.z },
    { axis: 'z' as const, sign: 1, gap: box.max.z - center.z },
  ];
  const best = faces.reduce((a, b) => (b.gap < a.gap ? b : a));
  const normal = vec3(
    best.axis === 'x' ? best.sign : 0,
    best.axis === 'y' ? best.sign : 0,
    best.axis === 'z' ? best.sign : 0,
  );
  return { normal, penetration: best.gap + radius, point: center };
};

const clampRange = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);
