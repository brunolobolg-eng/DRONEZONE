import * as THREE from 'three';

/**
 * Paleta e materiais compartilhados. Materiais são reaproveitados pela cor, para que o
 * número de materiais na cena cresça com as cores distintas e não com o número de casas.
 */
export const PALETTE = {
  grass: '#6f8a4e',
  grassFar: '#7d9557',
  soilDisturbed: '#4a3a2a',
  soilRim: '#8c7458',
  asphalt: '#3b3f44',
  roadLine: '#d9d4c7',
  fence: '#8a7560',
  wood: '#5b4330',
  glass: '#2b3a44',
  glassLit: '#7fa3b8',
  trunk: '#5c4632',
  leaves: ['#4f7a3a', '#5d8a43', '#3f6a33'],
  rubble: '#7b6f63',
  fragment: '#a09484',
  garage: '#b9b3a6',
} as const;

export class MaterialCache {
  private readonly standard = new Map<string, THREE.MeshStandardMaterial>();
  private readonly owned: THREE.Material[] = [];

  /** Registra um material criado fora do cache, para ser descartado junto com os demais. */
  track<T extends THREE.Material>(material: T): T {
    this.owned.push(material);
    return material;
  }

  standardFor(color: string, options: { roughness?: number; metalness?: number; vertexColors?: boolean } = {}): THREE.MeshStandardMaterial {
    const key = `${color}|${options.roughness ?? 0.85}|${options.metalness ?? 0}|${options.vertexColors ? 'v' : ''}`;
    let mat = this.standard.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color,
        roughness: options.roughness ?? 0.85,
        metalness: options.metalness ?? 0,
        vertexColors: options.vertexColors ?? false,
      });
      this.standard.set(key, mat);
    }
    return mat;
  }

  get count(): number {
    return this.standard.size;
  }

  dispose(): void {
    for (const m of this.standard.values()) m.dispose();
    for (const m of this.owned) m.dispose();
    this.standard.clear();
    this.owned.length = 0;
  }
}
