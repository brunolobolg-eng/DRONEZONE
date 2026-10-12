import { createRng } from '../../core/math/random';
import { type Vec3, vec3 } from '../../core/math/vec3';
import { type Aabb } from '../../core/physics/collision';

/**
 * Bairro fictício inspirado em subúrbios residenciais da região de Kyiv: casas de um ou dois
 * andares, telhados inclinados, cercas, garagens e uma via asfaltada. Não reproduz nenhum
 * local real. Gerado de forma determinística a partir da semente.
 *
 * Convenções: x e z no plano do solo, y para cima, metros. A via principal corre no eixo X.
 */

export const ROAD_HALF_WIDTH = 4;
export const AREA_HALF_EXTENT = 80;
export const FLAT_HALF_WIDTH = 30;
const FLOOR_HEIGHT = 3;

export type RoofKind = 'gable' | 'hip' | 'flat';
export type FacadeKind = 'plaster' | 'brick' | 'concrete';

export interface HouseSpec {
  readonly id: string;
  readonly center: Vec3;
  readonly width: number;
  readonly depth: number;
  readonly floors: 1 | 2;
  readonly height: number;
  readonly roof: RoofKind;
  readonly facade: FacadeKind;
  readonly wallColor: string;
  readonly roofColor: string;
  /** Posições locais (relativas ao centro da casa) das janelas e da porta. */
  readonly windows: readonly Vec3[];
  readonly door: Vec3;
}

export interface GarageSpec {
  readonly id: string;
  readonly center: Vec3;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly color: string;
}

export interface FenceSpec {
  readonly id: string;
  readonly from: { readonly x: number; readonly z: number };
  readonly to: { readonly x: number; readonly z: number };
  readonly height: number;
}

export interface TreeSpec {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly trunkHeight: number;
  readonly canopyRadius: number;
}

export interface Checkpoint {
  readonly id: string;
  readonly position: Vec3;
  readonly radius: number;
}

export interface StaticCollider {
  readonly id: string;
  readonly box: Aabb;
}

export interface Neighborhood {
  readonly seed: number;
  readonly houses: readonly HouseSpec[];
  readonly garages: readonly GarageSpec[];
  readonly fences: readonly FenceSpec[];
  readonly trees: readonly TreeSpec[];
  readonly checkpoints: readonly Checkpoint[];
  readonly spawn: Vec3;
  /** Colisores estáticos. As casas aparecem aqui com o id do colisor destrutível (`<id>:body`). */
  readonly colliders: readonly StaticCollider[];
}

const WALL_COLORS = ['#e7dcc4', '#d9b77a', '#a4553b', '#c9c2b3', '#e2d1b0'] as const;
const ROOF_COLORS = ['#6b4b3a', '#4a4f57', '#8c5a3c'] as const;
/** Colunas e linhas de lotes à esquerda e à direita da via. */
const LOT_COLUMNS = [-45, -15, 15, 45] as const;
const LOT_HALF_WIDTH = 12;
const LOT_NEAR = ROAD_HALF_WIDTH;
const LOT_DEPTH = 24;

export const generateNeighborhood = (seed = 20260): Neighborhood => {
  const rng = createRng(seed);
  const houses: HouseSpec[] = [];
  const garages: GarageSpec[] = [];
  const fences: FenceSpec[] = [];
  const trees: TreeSpec[] = [];
  const colliders: StaticCollider[] = [];

  let lot = 0;
  for (const side of [1, -1] as const) {
    for (const xc of LOT_COLUMNS) {
      lot++;
      const zNear = side * LOT_NEAR;
      const zFar = side * (LOT_NEAR + LOT_DEPTH);
      const zCenter = (zNear + zFar) / 2;
      const hasGarage = rng.next() < 0.5;

      // Casa: começa a 3 m da via, encostada no lado esquerdo do lote.
      const width = rng.range(9, 11);
      const depth = rng.range(7, 9);
      const floors: 1 | 2 = rng.next() < 0.45 ? 2 : 1;
      const height = floors * FLOOR_HEIGHT + 0.2;
      const hx = xc - LOT_HALF_WIDTH + 1 + width / 2;
      const hz = zNear + side * (3 + depth / 2);
      const roof = rng.pick<RoofKind>(['gable', 'gable', 'hip', 'flat']);
      const facade = rng.pick<FacadeKind>(['plaster', 'brick', 'concrete']);
      const windows: Vec3[] = [];
      for (let f = 0; f < floors; f++) {
        const y = 1.6 + f * FLOOR_HEIGHT;
        windows.push(vec3(width / 2, y, -depth / 4), vec3(width / 2, y, depth / 4));
        windows.push(vec3(-width / 2, y, -depth / 4), vec3(-width / 2, y, depth / 4));
        windows.push(vec3(0, y, -depth / 2), vec3(0, y, depth / 2));
      }
      const id = `house-${lot}`;
      const house: HouseSpec = {
        id,
        center: vec3(hx, 0, hz),
        width,
        depth,
        floors,
        height,
        roof,
        facade,
        wallColor: rng.pick(WALL_COLORS),
        roofColor: rng.pick(ROOF_COLORS),
        windows,
        door: vec3(width / 2, 1.1, 0),
      };
      houses.push(house);
      colliders.push({ id: `${id}:body`, box: boxAround(house.center, width / 2, depth / 2, height) });

      if (hasGarage) {
        const gw = 5.5;
        const gd = 6;
        const gh = 2.8;
        const gx = xc + LOT_HALF_WIDTH - gw / 2;
        const gz = zFar - side * (gd / 2 + 2);
        const gid = `garage-${lot}`;
        garages.push({ id: gid, center: vec3(gx, 0, gz), width: gw, depth: gd, height: gh, color: '#b9b3a6' });
        colliders.push({ id: `${gid}:body`, box: boxAround(vec3(gx, 0, gz), gw / 2, gd / 2, gh) });
      }

      // Cerca da frente (com portão) e cercas laterais.
      const fenceZ = zNear + side * 0.5;
      const gateHalf = 1.8;
      fences.push(
        { id: `fence-${lot}-front-a`, from: { x: xc - LOT_HALF_WIDTH, z: fenceZ }, to: { x: xc - gateHalf, z: fenceZ }, height: 1.2 },
        { id: `fence-${lot}-front-b`, from: { x: xc + gateHalf, z: fenceZ }, to: { x: xc + LOT_HALF_WIDTH, z: fenceZ }, height: 1.2 },
        { id: `fence-${lot}-left`, from: { x: xc - LOT_HALF_WIDTH, z: fenceZ }, to: { x: xc - LOT_HALF_WIDTH, z: zFar }, height: 1.4 },
        { id: `fence-${lot}-right`, from: { x: xc + LOT_HALF_WIDTH, z: fenceZ }, to: { x: xc + LOT_HALF_WIDTH, z: zFar }, height: 1.4 },
      );
      for (const f of fences.slice(-4)) colliders.push({ id: f.id, box: segmentBox(f.from, f.to, f.height) });

      // Duas árvores no quintal de trás.
      for (let t = 0; t < 2; t++) {
        // Árvores ficam longe da garagem (lado direito do lote).
        const tx = xc + rng.range(-9, 1);
        const tz = zCenter + side * rng.range(4, 8);
        const tree: TreeSpec = {
          id: `tree-${lot}-${t}`,
          x: tx,
          z: tz,
          trunkHeight: rng.range(3, 5),
          canopyRadius: rng.range(1.8, 2.6),
        };
        trees.push(tree);
        colliders.push({ id: tree.id, box: boxAround(vec3(tx, 0, tz), 0.3, 0.3, tree.trunkHeight) });
      }
    }
  }

  // Árvores ao longo da via e na transição para o campo.
  for (const [i, x] of [-72, -40, 2, 38, 70].entries()) {
    const z = i % 2 === 0 ? ROAD_HALF_WIDTH + 1.5 : -ROAD_HALF_WIDTH - 1.5;
    const tree: TreeSpec = { id: `roadside-${i}`, x, z, trunkHeight: rng.range(3.5, 5.5), canopyRadius: rng.range(2, 3) };
    trees.push(tree);
    colliders.push({ id: tree.id, box: boxAround(vec3(x, 0, z), 0.3, 0.3, tree.trunkHeight) });
  }

  const checkpoints: Checkpoint[] = [
    { id: 'cp-1', position: vec3(-48, 6, 0), radius: 3 },
    { id: 'cp-2', position: vec3(-18, 7, 0), radius: 3 },
    { id: 'cp-3', position: vec3(12, 6.5, 0), radius: 3 },
    { id: 'cp-4', position: vec3(42, 7.5, 0), radius: 3 },
  ];

  return {
    seed,
    houses,
    garages,
    fences,
    trees,
    checkpoints,
    spawn: vec3(-68, 0.6, 0),
    colliders,
  };
};

/** Caixa apoiada no solo, com meia largura em x e z e altura total `height`. */
const boxAround = (center: Vec3, hx: number, hz: number, height: number): Aabb => ({
  min: vec3(center.x - hx, center.y, center.z - hz),
  max: vec3(center.x + hx, center.y + height, center.z + hz),
});

/** Caixa que envolve um segmento de cerca, com espessura de 0,15 m. */
const segmentBox = (a: { x: number; z: number }, b: { x: number; z: number }, height: number): Aabb => ({
  min: vec3(Math.min(a.x, b.x) - 0.075, 0, Math.min(a.z, b.z) - 0.075),
  max: vec3(Math.max(a.x, b.x) + 0.075, height, Math.max(a.z, b.z) + 0.075),
});
