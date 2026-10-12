import { type Vec3 } from '../../core/math/vec3';

/** Estados de dano. A transição é monotônica: uma peça danificada nunca volta a intacta. */
export type DamageState = 'intact' | 'damaged' | 'severe' | 'destroyed';

export type ComponentKind = 'window' | 'door' | 'roof' | 'facade' | 'structural';

/** Fração de vida restante que define cada estado. */
export const DAMAGE_THRESHOLDS = { damaged: 0.7, severe: 0.3 } as const;

const ORDER: Record<DamageState, number> = { intact: 0, damaged: 1, severe: 2, destroyed: 3 };

export const stateFromHealth = (health: number, maxHealth: number): DamageState => {
  if (health <= 0) return 'destroyed';
  const fraction = health / maxHealth;
  if (fraction <= DAMAGE_THRESHOLDS.severe) return 'severe';
  if (fraction <= DAMAGE_THRESHOLDS.damaged) return 'damaged';
  return 'intact';
};

/** Retorna o estado mais grave entre os dois. Usado para garantir que o dano nunca regride. */
export const worstState = (a: DamageState, b: DamageState): DamageState => (ORDER[a] >= ORDER[b] ? a : b);

export const isWorse = (next: DamageState, current: DamageState): boolean => ORDER[next] > ORDER[current];

export interface DamageableComponent {
  readonly id: string;
  readonly kind: ComponentKind;
  /** Posição local da peça, em metros, relativa à origem da estrutura. */
  readonly center: Vec3;
  readonly maxHealth: number;
  readonly health: number;
  readonly state: DamageState;
}

export interface DamageTransition {
  readonly componentId: string;
  readonly from: DamageState;
  readonly to: DamageState;
}

export const createComponent = (
  id: string,
  kind: ComponentKind,
  center: Vec3,
  maxHealth: number,
): DamageableComponent => {
  if (!(maxHealth > 0)) throw new RangeError(`maxHealth de ${id} precisa ser positivo`);
  return { id, kind, center, maxHealth, health: maxHealth, state: 'intact' };
};

/**
 * Aplica dano a uma peça. Retorna a peça nova e a transição de estado, se houve.
 * Dano não positivo, ou em peça já destruída, não faz nada.
 */
export const applyDamage = (
  component: DamageableComponent,
  amount: number,
): { readonly component: DamageableComponent; readonly transition: DamageTransition | null } => {
  if (!(amount > 0) || component.state === 'destroyed') return { component, transition: null };
  const health = Math.max(0, component.health - amount);
  const next = worstState(component.state, stateFromHealth(health, component.maxHealth));
  const updated: DamageableComponent = { ...component, health, state: next };
  const transition = next === component.state ? null : { componentId: component.id, from: component.state, to: next };
  return { component: updated, transition };
};
