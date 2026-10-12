import * as THREE from 'three';
import { type DirtyRect, Heightfield, MATERIAL_DISTURBED, MATERIAL_RIM } from '../../core/terrain/heightfield';
import { PALETTE } from '../materials';

/**
 * Malha visual do terreno. Lê a grade de alturas do Heightfield e atualiza apenas
 * os vértices de cada cratera. A lógica de deformação fica no Heightfield.
 */
export class TerrainMesh {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly vertices: number;
  private readonly soil = new THREE.Color(PALETTE.grass);
  private readonly disturbed = new THREE.Color(PALETTE.soilDisturbed);
  private readonly rim = new THREE.Color(PALETTE.soilRim);

  constructor(private readonly terrain: Heightfield, material: THREE.Material) {
    const n = terrain.vertices;
    this.vertices = n;
    const count = n * n;
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        this.positions[k * 3] = terrain.worldX(i);
        this.positions[k * 3 + 1] = terrain.vertexHeight(i, j);
        this.positions[k * 3 + 2] = terrain.worldZ(j);
      }
    }

    const cells = n - 1;
    const index = new Uint32Array(cells * cells * 6);
    let p = 0;
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        index[p++] = a;
        index[p++] = c;
        index[p++] = b;
        index[p++] = b;
        index[p++] = c;
        index[p++] = d;
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1));
    for (let k = 0; k < count; k++) this.paintVertex(k, terrain.vertexMaterial(k % n, Math.floor(k / n)));
    this.geometry.computeVertexNormals();
    this.geometry.attributes.color.needsUpdate = true;

    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
  }

  /** Atualiza só os vértices da região alterada. Retorna o número de vértices tocados. */
  applyDirty(rect: DirtyRect): number {
    const n = this.vertices;
    let touched = 0;
    for (let j = rect.minJ; j <= rect.maxJ; j++) {
      for (let i = rect.minI; i <= rect.maxI; i++) {
        const k = j * n + i;
        this.positions[k * 3 + 1] = this.terrain.vertexHeight(i, j);
        this.paintVertex(k, this.terrain.vertexMaterial(i, j));
        touched++;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    // Normais dependem dos vizinhos; recalcular a malha inteira é barato para uma grade deste tamanho.
    this.geometry.computeVertexNormals();
    return touched;
  }

  /** Altura visual de um vértice, para testes de consistência entre visual e lógica. */
  visualHeight(i: number, j: number): number {
    return this.positions[(j * this.vertices + i) * 3 + 1];
  }

  dispose(): void {
    this.geometry.dispose();
  }

  private paintVertex(k: number, material: number): void {
    const c = material === MATERIAL_DISTURBED ? this.disturbed : material === MATERIAL_RIM ? this.rim : this.soil;
    this.colors[k * 3] = c.r;
    this.colors[k * 3 + 1] = c.g;
    this.colors[k * 3 + 2] = c.b;
  }
}
