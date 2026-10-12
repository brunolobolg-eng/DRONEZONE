import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng } from '../../core/math/random';
import { type DamageState } from '../../gameplay/destruction/damage-state';
import { type FragmentPool } from '../../gameplay/destruction/fragment-pool';
import { type Structure } from '../../gameplay/destruction/structure';
import { type HouseSpec, type Neighborhood, ROAD_HALF_WIDTH, AREA_HALF_EXTENT } from '../../gameplay/environment/layout';
import { MaterialCache, PALETTE } from '../materials';

/** Janelas e portas são instanciadas numa única malha por tipo, para manter poucas chamadas de desenho. */
const WINDOWS_PER_HOUSE_MAX = 16;
const RUBBLE_PER_HOUSE = 14;
const ROOF_OVERHANG = 0.35;

interface HouseVisual {
  readonly spec: HouseSpec;
  readonly structure: Structure;
  readonly group: THREE.Group;
  readonly body: THREE.Mesh;
  readonly roof: THREE.Mesh;
  readonly door: THREE.Mesh;
  readonly windowIndices: number[];
  readonly rubbleStart: number;
  readonly bodyMaterial: THREE.MeshStandardMaterial;
  appliedState: DamageState | null;
}

export interface CityVisualsOptions {
  readonly neighborhood: Neighborhood;
  readonly structures: ReadonlyMap<string, Structure>;
  readonly fragments: FragmentPool;
  readonly materials: MaterialCache;
  readonly fragmentCapacity: number;
  readonly shadows: boolean;
}

/**
 * Visual do bairro: casas, garagens, cercas, árvores, vias e os elementos destrutíveis.
 * Construído uma vez. Depois, apenas troca visibilidade e cor conforme o estado de dano.
 */
export class CityVisuals {
  readonly group = new THREE.Group();
  private readonly houses = new Map<string, HouseVisual>();
  private readonly windowMesh: THREE.InstancedMesh;
  private readonly rubbleMesh: THREE.InstancedMesh;
  private readonly fragmentMesh: THREE.InstancedMesh;
  private readonly windowKeys: string[] = [];
  private readonly windowState: DamageState[] = [];
  /** Matriz original de cada janela, para restaurar sem depender do estado atual da malha. */
  private readonly windowMatrices: THREE.Matrix4[] = [];
  /** Matriz de cada pedaço de escombro, indexada como o InstancedMesh de escombros. */
  private readonly rubbleMatrices: THREE.Matrix4[] = [];
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly dummy = new THREE.Object3D();

  constructor(private readonly options: CityVisualsOptions) {
    const { neighborhood, materials, shadows } = options;
    this.group.name = 'city';
    this.group.add(buildRoad());

    // Janelas: uma malha instanciada para todo o bairro.
    const windowCount = neighborhood.houses.reduce((s, h) => s + h.windows.length, 0);
    const windowGeometry = new THREE.BoxGeometry(0.06, 1.0, 0.8);
    this.windowMesh = new THREE.InstancedMesh(
      windowGeometry,
      materials.standardFor(PALETTE.glass, { roughness: 0.2 }),
      Math.max(1, windowCount),
    );
    this.windowMesh.name = 'windows';
    this.windowMesh.castShadow = false;
    this.group.add(this.windowMesh);

    // Escombros: pilhas simples por casa, mostradas só quando a casa é destruída.
    this.rubbleMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      materials.standardFor(PALETTE.rubble, { roughness: 1 }),
      neighborhood.houses.length * RUBBLE_PER_HOUSE,
    );
    this.rubbleMesh.name = 'rubble';
    this.rubbleMesh.castShadow = shadows;
    this.rubbleMesh.receiveShadow = true;
    this.group.add(this.rubbleMesh);

    this.fragmentMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.15, 0.15, 0.15),
      materials.standardFor(PALETTE.fragment, { roughness: 0.9 }),
      options.fragmentCapacity,
    );
    this.fragmentMesh.name = 'fragments';
    this.fragmentMesh.count = options.fragmentCapacity;
    this.fragmentMesh.frustumCulled = false;
    this.group.add(this.fragmentMesh);
    this.hideAllFragments();

    this.buildHouses();
    this.buildGarages();
    this.buildFences();
    this.buildTrees();
    this.buildRubble();
    this.buildDashes();
  }

  get houseIds(): readonly string[] {
    return [...this.houses.keys()];
  }

  /** Estado visual aplicado a uma casa, para testes e depuração. */
  appliedStateOf(houseId: string): DamageState | null {
    return this.houses.get(houseId)?.appliedState ?? null;
  }

  /** Bounding box aproximada do bairro, em metros. */
  get extent(): number {
    return AREA_HALF_EXTENT * 2;
  }

  /** Sincroniza a aparência com o estado de dano de cada construção. Barato: só altera o que mudou. */
  sync(structures: ReadonlyMap<string, Structure>): void {
    for (const [id, house] of this.houses) {
      const structure = structures.get(id) ?? house.structure;
      if (house.appliedState === structure.state) continue;
      this.applyHouseState(house, structure);
    }
    this.syncWindows(structures);
  }

  /** Atualiza as instâncias dos fragmentos a partir da física simples do pool. */
  syncFragments(pool: FragmentPool): void {
    const list = pool.fragments;
    for (let i = 0; i < this.options.fragmentCapacity; i++) {
      const f = list[i];
      if (!f || !f.active) {
        this.fragmentMesh.setMatrixAt(i, this.hidden);
        continue;
      }
      this.dummy.position.set(f.x, f.y, f.z);
      this.dummy.rotation.set(f.life * 3, f.life * 2, 0);
      this.dummy.scale.setScalar(f.size);
      this.dummy.updateMatrix();
      this.fragmentMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.fragmentMesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh || obj instanceof THREE.Mesh) obj.geometry.dispose();
    });
  }

  private buildHouses(): void {
    const { neighborhood, structures, materials, shadows } = this.options;
    const roofMaterialBase = { roughness: 0.9 };
    let windowIndex = 0;
    let rubbleIndex = 0;

    for (const spec of neighborhood.houses) {
      const structure = structures.get(spec.id);
      if (!structure) throw new Error(`Estrutura ausente para ${spec.id}`);
      const group = new THREE.Group();
      group.name = spec.id;
      group.position.set(spec.center.x, spec.center.y, spec.center.z);

      // Material próprio por casa: o escurecimento por dano não pode afetar casas de cor igual.
      const bodyMaterial = new THREE.MeshStandardMaterial({ color: spec.wallColor, roughness: 0.92 });
      materials.track(bodyMaterial);
      const body = new THREE.Mesh(new THREE.BoxGeometry(spec.width, spec.height, spec.depth), bodyMaterial);
      body.position.y = spec.height / 2;
      body.castShadow = shadows;
      body.receiveShadow = true;
      group.add(body);

      const roof = new THREE.Mesh(buildRoof(spec), materials.standardFor(spec.roofColor, roofMaterialBase));
      roof.position.y = spec.height;
      roof.castShadow = shadows;
      group.add(roof);

      const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.0, 1.0), materials.standardFor(PALETTE.wood, { roughness: 0.7 }));
      door.position.set(spec.door.x + 0.03, 1.0, spec.door.z);
      group.add(door);

      const windowIndices: number[] = [];
      for (let w = 0; w < spec.windows.length && w < WINDOWS_PER_HOUSE_MAX; w++) {
        const local = spec.windows[w];
        const facingX = Math.abs(local.x) > Math.abs(local.z);
        const offset = 0.02;
        this.dummy.position.set(
          spec.center.x + local.x + (facingX ? Math.sign(local.x) * offset : 0),
          spec.center.y + local.y,
          spec.center.z + local.z + (facingX ? 0 : Math.sign(local.z) * offset),
        );
        this.dummy.rotation.set(0, facingX ? 0 : Math.PI / 2, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.windowMesh.setMatrixAt(windowIndex, this.dummy.matrix);
        this.windowMatrices[windowIndex] = this.dummy.matrix.clone();
        windowIndices.push(windowIndex);
        this.windowKeys[windowIndex] = `${spec.id}/window-${w}`;
        this.windowState[windowIndex] = 'intact';
        windowIndex++;
      }

      this.group.add(group);
      this.houses.set(spec.id, {
        spec,
        structure,
        group,
        body,
        roof,
        door,
        windowIndices,
        rubbleStart: rubbleIndex,
        bodyMaterial,
        appliedState: null,
      });
      rubbleIndex += RUBBLE_PER_HOUSE;
    }
    this.windowMesh.instanceMatrix.needsUpdate = true;
  }

  private buildGarages(): void {
    const { neighborhood, materials, shadows } = this.options;
    for (const g of neighborhood.garages) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(g.width, g.height, g.depth), materials.standardFor(g.color, { roughness: 0.95 }));
      mesh.position.set(g.center.x, g.height / 2, g.center.z);
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(g.width + 0.3, 0.2, g.depth + 0.3), materials.standardFor('#5d5f63', { roughness: 0.9 }));
      slab.position.set(g.center.x, g.height + 0.1, g.center.z);
      slab.castShadow = shadows;
      this.group.add(slab);
    }
  }

  private buildFences(): void {
    const geometries: THREE.BufferGeometry[] = [];
    for (const f of this.options.neighborhood.fences) {
      const dx = f.to.x - f.from.x;
      const dz = f.to.z - f.from.z;
      const len = Math.hypot(dx, dz);
      const geo = new THREE.BoxGeometry(len, f.height, 0.1);
      geo.rotateY(-Math.atan2(dz, dx));
      geo.translate((f.from.x + f.to.x) / 2, f.height / 2, (f.from.z + f.to.z) / 2);
      geometries.push(geo);
    }
    if (geometries.length === 0) return;
    const merged = mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();
    if (!merged) throw new Error('Falha ao mesclar cercas');
    const mesh = new THREE.Mesh(merged, this.options.materials.standardFor(PALETTE.fence, { roughness: 0.9 }));
    mesh.name = 'fences';
    mesh.castShadow = this.options.shadows;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private buildTrees(): void {
    const trees = this.options.neighborhood.trees;
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.18, 0.25, 1, 6),
      this.options.materials.standardFor(PALETTE.trunk, { roughness: 1 }),
      trees.length,
    );
    const canopies = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 1),
      this.options.materials.standardFor(PALETTE.leaves[0], { roughness: 0.8 }),
      trees.length,
    );
    const rng = createRng(77);
    trees.forEach((t, i) => {
      this.dummy.position.set(t.x, t.trunkHeight / 2, t.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, t.trunkHeight, 1);
      this.dummy.updateMatrix();
      trunks.setMatrixAt(i, this.dummy.matrix);

      this.dummy.position.set(t.x, t.trunkHeight + t.canopyRadius * 0.6, t.z);
      this.dummy.scale.setScalar(t.canopyRadius);
      this.dummy.updateMatrix();
      canopies.setMatrixAt(i, this.dummy.matrix);
      canopies.setColorAt(i, new THREE.Color(rng.pick(PALETTE.leaves)));
    });
    trunks.castShadow = this.options.shadows;
    canopies.castShadow = this.options.shadows;
    if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
    trunks.name = 'tree-trunks';
    canopies.name = 'tree-canopies';
    this.group.add(trunks, canopies);
  }

  private buildRubble(): void {
    const rng = createRng(11);
    for (const spec of this.options.neighborhood.houses) {
      const house = this.houses.get(spec.id);
      const start = house?.rubbleStart ?? 0;
      for (let k = 0; k < RUBBLE_PER_HOUSE; k++) {
        const s = 0.6 + rng.next() * 1.2;
        this.dummy.position.set(
          spec.center.x + rng.range(-spec.width / 2, spec.width / 2),
          s * 0.25,
          spec.center.z + rng.range(-spec.depth / 2, spec.depth / 2),
        );
        this.dummy.rotation.set(rng.range(0, 1), rng.range(0, 3), rng.range(0, 1));
        this.dummy.scale.set(s, s * 0.5, s * 0.8);
        this.dummy.updateMatrix();
        this.rubbleMatrices[start + k] = this.dummy.matrix.clone();
        this.rubbleMesh.setMatrixAt(start + k, this.hidden);
      }
    }
    this.rubbleMesh.instanceMatrix.needsUpdate = true;
  }

  private buildDashes(): void {
    const count = Math.floor((AREA_HALF_EXTENT * 2) / 8);
    const dashes = new THREE.InstancedMesh(
      new THREE.BoxGeometry(2.2, 0.02, 0.12),
      this.options.materials.standardFor(PALETTE.roadLine, { roughness: 0.6 }),
      count,
    );
    for (let i = 0; i < count; i++) {
      this.dummy.position.set(-AREA_HALF_EXTENT + 4 + i * 8, 0.05, 0);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      dashes.setMatrixAt(i, this.dummy.matrix);
    }
    dashes.name = 'road-dashes';
    this.group.add(dashes);
  }

  private applyHouseState(house: HouseVisual, structure: Structure): void {
    const state = structure.state;
    house.appliedState = state;
    const destroyed = state === 'destroyed';
    house.group.visible = !destroyed;
    house.roof.visible = state !== 'severe' && !destroyed;
    house.door.visible = !destroyed && structure.components.get('door')?.state !== 'destroyed';

    const tint = state === 'intact' ? 1 : state === 'damaged' ? 0.82 : 0.6;
    const base = new THREE.Color(house.spec.wallColor);
    house.bodyMaterial.color.copy(base).multiplyScalar(tint);

    // Escombros da casa destruída aparecem no mesmo lugar, com a mesma semente visual.
    this.setRubbleVisible(house, destroyed);
    this.rubbleMesh.instanceMatrix.needsUpdate = true;
  }

  private setRubbleVisible(house: HouseVisual, visible: boolean): void {
    for (let k = 0; k < RUBBLE_PER_HOUSE; k++) {
      const i = house.rubbleStart + k;
      this.rubbleMesh.setMatrixAt(i, visible ? this.rubbleMatrices[i] : this.hidden);
    }
  }

  /** Janela some quando a própria peça é destruída, ou quando a casa inteira é destruída. */
  private syncWindows(structures: ReadonlyMap<string, Structure>): void {
    let dirty = false;
    for (let i = 0; i < this.windowKeys.length; i++) {
      const key = this.windowKeys[i];
      if (!key) continue;
      const [houseId, componentId] = key.split('/');
      const structure = structures.get(houseId);
      const state: DamageState =
        structure?.state === 'destroyed' ? 'destroyed' : structure?.components.get(componentId)?.state ?? 'intact';
      if (state === this.windowState[i]) continue;
      this.windowState[i] = state;
      this.windowMesh.setMatrixAt(i, state === 'destroyed' ? this.hidden : this.windowMatrices[i]);
      dirty = true;
    }
    if (dirty) this.windowMesh.instanceMatrix.needsUpdate = true;
  }

  private hideAllFragments(): void {
    for (let i = 0; i < this.options.fragmentCapacity; i++) this.fragmentMesh.setMatrixAt(i, this.hidden);
    this.fragmentMesh.instanceMatrix.needsUpdate = true;
  }
}

/** Via asfaltada no eixo X, com 8 m de largura. */
const buildRoad = (): THREE.Mesh => {
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(AREA_HALF_EXTENT * 2, ROAD_HALF_WIDTH * 2),
    new THREE.MeshStandardMaterial({ color: PALETTE.asphalt, roughness: 0.95 }),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.03;
  road.receiveShadow = true;
  road.name = 'road';
  return road;
};

/** Telhado conforme o tipo: duas águas, quatro águas ou laje plana. Sempre com beiral. */
const buildRoof = (spec: HouseSpec): THREE.BufferGeometry => {
  if (spec.roof === 'flat') {
    const g = new THREE.BoxGeometry(spec.width + 0.2, 0.3, spec.depth + 0.2);
    g.translate(0, 0.15, 0);
    return g;
  }
  if (spec.roof === 'hip') {
    const g = new THREE.ConeGeometry(1, 1, 4, 1);
    g.rotateY(Math.PI / 4);
    const hx = spec.width / 2 + ROOF_OVERHANG;
    const hz = spec.depth / 2 + ROOF_OVERHANG;
    g.scale(hx / Math.SQRT1_2, 2.0, hz / Math.SQRT1_2);
    g.translate(0, 1.0, 0);
    return g;
  }
  return gableRoof(spec.width, spec.depth, 2.4);
};

/** Telhado de duas águas com cumeeira no eixo X, feito de triângulos com normais planas. */
const gableRoof = (width: number, depth: number, ridge: number): THREE.BufferGeometry => {
  const x0 = -width / 2 - ROOF_OVERHANG;
  const x1 = width / 2 + ROOF_OVERHANG;
  const z0 = -depth / 2 - ROOF_OVERHANG;
  const z1 = depth / 2 + ROOF_OVERHANG;
  const v = (x: number, y: number, z: number): number[] => [x, y, z];
  const tris: number[][] = [
    // Água de z negativo.
    v(x0, 0, z0), v(x1, 0, z0), v(x1, ridge, 0),
    v(x0, 0, z0), v(x1, ridge, 0), v(x0, ridge, 0),
    // Água de z positivo.
    v(x0, 0, z1), v(x1, ridge, 0), v(x1, 0, z1),
    v(x0, 0, z1), v(x0, ridge, 0), v(x1, ridge, 0),
    // Empenas.
    v(x0, 0, z0), v(x0, ridge, 0), v(x0, 0, z1),
    v(x1, 0, z0), v(x1, 0, z1), v(x1, ridge, 0),
  ];
  const positions = new Float32Array(tris.flat());
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
};
