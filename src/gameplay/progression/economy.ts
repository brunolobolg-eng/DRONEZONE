import { type PartCatalog } from './catalog';

/** Saldo inicial e valores de jogo em créditos fictícios. Não há compra com dinheiro real. */
export const START_BALANCE = 1500;
export const REPAIR_COST_PER_POINT = 6;
export const CHECKPOINT_REWARD = 40;
export const MISSION_COMPLETE_REWARD = 250;
export const MAX_BALANCE = 1_000_000_000;

export interface EconomyState {
  readonly balance: number;
  readonly owned: readonly string[];
}

export type PurchaseResult =
  | { readonly ok: true; readonly state: EconomyState }
  | { readonly ok: false; readonly reason: 'unknown-part' | 'already-owned' | 'insufficient-funds' };

export const purchasePart = (state: EconomyState, catalog: PartCatalog, partId: string): PurchaseResult => {
  const part = catalog.get(partId);
  if (!part) return { ok: false, reason: 'unknown-part' };
  if (state.owned.includes(partId)) return { ok: false, reason: 'already-owned' };
  if (state.balance < part.price) return { ok: false, reason: 'insufficient-funds' };
  return {
    ok: true,
    state: { balance: state.balance - part.price, owned: [...state.owned, partId] },
  };
};

/** Custo de reparo proporcional à integridade perdida, arredondado para cima. */
export const repairCost = (integrityLost: number): number =>
  Math.ceil(Math.max(0, integrityLost) * REPAIR_COST_PER_POINT);

export type RepairResult = { readonly ok: true; readonly balance: number; readonly cost: number } | { readonly ok: false; readonly cost: number };

export const repairDrone = (balance: number, integrityLost: number): RepairResult => {
  const cost = repairCost(integrityLost);
  if (cost === 0) return { ok: true, balance, cost: 0 };
  if (balance < cost) return { ok: false, cost };
  return { ok: true, balance: balance - cost, cost };
};

export const missionReward = (base: number, factor: number): number => Math.round(base * Math.max(0, factor));
