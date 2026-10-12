import { smoothstep } from '../math/scalar';
import { valueNoise2 } from '../math/random';

/**
 * Terreno como grade de alturas. Esta classe guarda apenas dados: não conhece Three.js.
 * A malha visual lê as alturas e as regiões alteradas (DirtyRect) e atualiza só o necessário.
 *
 * Índices de material por vértice: 0 = solo original, 1 = solo revolvido, 2 = borda exposta.
 */
export const MATERIAL_SOIL = 0;
export const MATERIAL_DISTURBED = 1;
export const MATERIAL_RIM = 2;

export interface HeightfieldOptions {
  /** Número de células por lado. A grade tem size + 1 vértices por lado. */
  readonly cells: number;
  /** Tamanho de cada célula, em metros. */
  readonly cellSize: number;
  /** Canto mínimo da área (x, z), em metros. */
  readonly origin: { readonly x: number; readonly z: number };
  /** Altura de referência do solo, em metros. */
  readonly baseHeight: number;
  /** Amplitude máxima do relevo ondulado (fora das vias), em metros. */
  readonly roughness: number;
  readonly seed: number;
  /** Profundidade máxima acumulada das crateras abaixo da altura base, em metros. */
  readonly maxCraterDepth: number;
  /** Quantidade máxima de registros de cratera guardados (as células continuam alteradas). */
  readonly maxCraterRecords: number;
  /** Faixa central (|z| <= flatHalfWidth) fica plana, reservada para vias. */
  readonly flatHalfWidth: number;
}

export interface Crater {
  readonly x: number;
  readonly z: number;
  /** Raio médio da cratera, em metros. A borda real varia com o ângulo. */
  readonly radius: number;
  /** Profundidade no centro, em metros. Limitada por maxCraterDepth. */
  readonly depth: number;
}

/** Retângulo de vértices alterados, inclusivo, em índices da grade. */
export interface DirtyRect {
  readonly minI: number;
  readonly minJ: number;
  readonly maxI: number;
  readonly maxJ: number;
}

export class Heightfield {
  readonly vertices: number;
  private readonly options: HeightfieldOptions;
  private readonly base: Float32Array;
  private readonly heights: Float32Array;
  private readonly materials: Uint8Array;
  private readonly craters: Crater[] = [];

  constructor(options: HeightfieldOptions) {
    if (options.cells < 2) throw new RangeError('cells precisa ser >= 2');
    if (options.cellSize <= 0) throw new RangeError('cellSize precisa ser positivo');
    this.options = options;
    this.vertices = options.cells + 1;
    const count = this.vertices * this.vertices;
    this.base = new Float32Array(count);
    this.heights = new Float32Array(count);
    this.materials = new Uint8Array(count);
    this.generateBase();
    this.heights.set(this.base);
  }

  /** Coordenadas do mundo de um vértice da grade. */
  worldX(i: number): number {
    return this.options.origin.x + i * this.options.cellSize;
  }

  worldZ(j: number): number {
    return this.options.origin.z + j * this.options.cellSize;
  }

  get cellSize(): number {
    return this.options.cellSize;
  }

  get extent(): number {
    return this.options.cells * this.options.cellSize;
  }

  get origin(): { readonly x: number; readonly z: number } {
    return this.options.origin;
  }

  /** Altura do terreno em (x, z), interpolada bilinearmente. Fora da área, usa a borda. */
  heightAt(x: number, z: number): number {
    const gx = clampIndex((x - this.options.origin.x) / this.options.cellSize, this.options.cells);
    const gz = clampIndex((z - this.options.origin.z) / this.options.cellSize, this.options.cells);
    const i0 = Math.floor(gx);
    const j0 = Math.floor(gz);
    const i1 = Math.min(i0 + 1, this.options.cells);
    const j1 = Math.min(j0 + 1, this.options.cells);
    const fx = gx - i0;
    const fz = gz - j0;
    const h00 = this.heights[this.index(i0, j0)];
    const h10 = this.heights[this.index(i1, j0)];
    const h01 = this.heights[this.index(i0, j1)];
    const h11 = this.heights[this.index(i1, j1)];
    const top = h00 + (h10 - h00) * fx;
    const bottom = h01 + (h11 - h01) * fx;
    return top + (bottom - top) * fz;
  }

  /** Altura de um vértice da grade. */
  vertexHeight(i: number, j: number): number {
    return this.heights[this.index(i, j)];
  }

  vertexMaterial(i: number, j: number): number {
    return this.materials[this.index(i, j)];
  }

  /** Copia de todas as alturas, na ordem de índice (j * vertices + i). Útil para a malha visual. */
  snapshotHeights(): Float32Array {
    return this.heights.slice();
  }

  get craterRecords(): readonly Crater[] {
    return this.craters;
  }

  /**
   * Aplica uma cratera. Retorna a região de vértices alterados para atualização visual,
   * ou null se a cratera não atinge nenhum vértice.
   */
  applyCrater(crater: Crater): DirtyRect | null {
    const { cells, cellSize, maxCraterDepth } = this.options;
    const reach = crater.radius * 1.4;
    const minI = Math.max(0, Math.floor((crater.x - reach - this.options.origin.x) / cellSize));
    const maxI = Math.min(cells, Math.ceil((crater.x + reach - this.options.origin.x) / cellSize));
    const minJ = Math.max(0, Math.floor((crater.z - reach - this.options.origin.z) / cellSize));
    const maxJ = Math.min(cells, Math.ceil((crater.z + reach - this.options.origin.z) / cellSize));
    if (minI > maxI || minJ > maxJ) return null;

    const depth = Math.min(crater.depth, maxCraterDepth);
    let touched = false;
    for (let j = minJ; j <= maxJ; j++) {
      for (let i = minI; i <= maxI; i++) {
        const dx = this.worldX(i) - crater.x;
        const dz = this.worldZ(j) - crater.z;
        const angle = Math.atan2(dz, dx);
        const edgeNoise = valueNoise2(Math.cos(angle) * 2 + 10, Math.sin(angle) * 2 + 10, this.options.seed + 99);
        const localRadius = crater.radius * (0.75 + 0.5 * edgeNoise);
        const rho = Math.hypot(dx, dz) / localRadius;
        if (rho >= 1.35) continue;

        const k = this.index(i, j);
        const bowl = rho < 1 ? -depth * (1 - rho * rho) : 0;
        const rim = depth * 0.18 * Math.exp(-(((rho - 1) / 0.2) ** 2));
        const floor = this.base[k] - maxCraterDepth;
        this.heights[k] = Math.max(floor, this.heights[k] + bowl + rim);

        if (rho < 1) this.materials[k] = MATERIAL_DISTURBED;
        else if (this.materials[k] === MATERIAL_SOIL) this.materials[k] = MATERIAL_RIM;
        touched = true;
      }
    }

    if (!touched) return null;
    this.craters.push(crater);
    if (this.craters.length > this.options.maxCraterRecords) this.craters.shift();
    return { minI, minJ, maxI, maxJ };
  }

  /** Restaura o terreno original e remove todas as crateras. */
  reset(): void {
    this.heights.set(this.base);
    this.materials.fill(MATERIAL_SOIL);
    this.craters.length = 0;
  }

  private index(i: number, j: number): number {
    return j * this.vertices + i;
  }

  private generateBase(): void {
    const { origin, cellSize, baseHeight, roughness, seed, flatHalfWidth } = this.options;
    for (let j = 0; j < this.vertices; j++) {
      for (let i = 0; i < this.vertices; i++) {
        const x = origin.x + i * cellSize;
        const z = origin.z + j * cellSize;
        // Vias e lotes ficam planos: o relevo cresce só longe da faixa central.
        const openness = smoothstep(Math.abs(z), flatHalfWidth, flatHalfWidth + 12);
        const noise = valueNoise2(x * 0.04, z * 0.04, seed) - 0.5;
        this.base[this.index(i, j)] = baseHeight + noise * 2 * roughness * openness;
      }
    }
  }
}

const clampIndex = (value: number, cells: number): number => (value < 0 ? 0 : value > cells ? cells : value);
