import { type Vec3, distance } from '../../core/math/vec3';
import {
  type ComponentKind,
  type DamageState,
  type DamageTransition,
  applyDamage,
  createComponent,
  type DamageableComponent,
} from './damage-state';

/**
 * Estrutura destrutível genérica: um conjunto de peças com vida própria e um colisor.
 * Novas construções usam esta interface sem script específico: basta descrever as peças.
 */
export interface Structure {
  readonly id: string;
  /** Colisor físico que representa a estrutura. Desativado quando o estado chega a destruído. */
  readonly colliderId: string;
  readonly components: ReadonlyMap<string, DamageableComponent>;
  readonly state: DamageState;
}

export interface ComponentSpec {
  readonly id: string;
  readonly kind: ComponentKind;
  readonly center: Vec3;
  readonly maxHealth: number;
}

export type StructureEvent =
  | { readonly type: 'component'; readonly structureId: string; readonly transition: DamageTransition }
  | { readonly type: 'structure'; readonly structureId: string; readonly from: DamageState; readonly to: DamageState };

export const createStructure = (id: string, specs: readonly ComponentSpec[]): Structure => {
  const components = new Map<string, DamageableComponent>();
  for (const spec of specs) {
    if (components.has(spec.id)) throw new Error(`Peça duplicada em ${id}: ${spec.id}`);
    components.set(spec.id, createComponent(spec.id, spec.kind, spec.center, spec.maxHealth));
  }
  if (![...components.values()].some((c) => c.kind === 'structural')) {
    throw new Error(`Estrutura ${id} precisa de pelo menos uma peça estrutural`);
  }
  return { id, colliderId: `${id}:body`, components, state: deriveState(components) };
};

/**
 * Estado geral da construção, derivado das peças:
 * - peça estrutural destruída: construção destruída;
 * - peça estrutural grave ou cobertura destruída: grave;
 * - qualquer outra peça danificada: danificada.
 */
export const deriveState = (components: ReadonlyMap<string, DamageableComponent>): DamageState => {
  const list = [...components.values()];
  const structural = list.filter((c) => c.kind === 'structural');
  const roof = list.filter((c) => c.kind === 'roof');
  if (structural.some((c) => c.state === 'destroyed')) return 'destroyed';
  if (structural.some((c) => c.state === 'severe') || roof.some((c) => c.state === 'destroyed')) return 'severe';
  if (list.some((c) => c.state !== 'intact')) return 'damaged';
  return 'intact';
};

/** Fração do dano que atravessa a construção e chega às peças estruturais, em todo impacto. */
export const STRUCTURAL_TRANSMISSION = 0.35;

/**
 * Distribui o dano de um impacto.
 * - Parte fica nas três peças mais próximas do ponto, com peso que cai com a distância.
 * - O restante é transmitido às peças estruturais, dividido igualmente.
 * Assim, impactos repetidos em qualquer fachada acabam enfraquecendo a estrutura.
 */
export const damageStructure = (structure: Structure, point: Vec3, totalDamage: number): { structure: Structure; events: StructureEvent[] } => {
  if (!(totalDamage > 0)) return { structure, events: [] };
  const components = new Map(structure.components);
  const all = [...components.values()];
  const structural = all.filter((c) => c.kind === 'structural');
  const transmitted = totalDamage * STRUCTURAL_TRANSMISSION;
  const local = totalDamage - transmitted;

  const nearest = all
    .map((c) => ({ c, d: distance(c.center, point) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  const weights = nearest.map(({ d }) => 1 / (1 + d));
  const weightSum = weights.reduce((a, b) => a + b, 0);

  const shares = new Map<string, number>();
  nearest.forEach(({ c }, i) => shares.set(c.id, (local * weights[i]) / weightSum));
  for (const c of structural) shares.set(c.id, (shares.get(c.id) ?? 0) + transmitted / structural.length);

  const events: StructureEvent[] = [];
  for (const [id, share] of shares) {
    const current = components.get(id);
    if (!current) continue;
    const { component, transition } = applyDamage(current, share);
    components.set(id, component);
    if (transition) events.push({ type: 'component', structureId: structure.id, transition });
  }

  const from = structure.state;
  const to = deriveState(components);
  if (to !== from) events.push({ type: 'structure', structureId: structure.id, from, to });
  return { structure: { ...structure, components, state: to }, events };
};

/** Casas são descritas pela mesma interface: paredes, janelas, porta, cobertura e estrutura. */
export const specsForHouse = (
  halfWidth: number,
  halfDepth: number,
  height: number,
  windows: readonly Vec3[],
  door: Vec3,
): ComponentSpec[] => [
  { id: 'core', kind: 'structural', center: { x: 0, y: height / 2, z: 0 }, maxHealth: 220 },
  { id: 'facade-front', kind: 'facade', center: { x: halfWidth, y: height / 2, z: 0 }, maxHealth: 90 },
  { id: 'facade-back', kind: 'facade', center: { x: -halfWidth, y: height / 2, z: 0 }, maxHealth: 90 },
  { id: 'facade-left', kind: 'facade', center: { x: 0, y: height / 2, z: -halfDepth }, maxHealth: 90 },
  { id: 'facade-right', kind: 'facade', center: { x: 0, y: height / 2, z: halfDepth }, maxHealth: 90 },
  { id: 'roof', kind: 'roof', center: { x: 0, y: height + 0.8, z: 0 }, maxHealth: 70 },
  { id: 'door', kind: 'door', center: door, maxHealth: 40 },
  ...windows.map((w, i) => ({ id: `window-${i}`, kind: 'window' as const, center: w, maxHealth: 18 })),
];
