import { type PartCatalog, PART_SLOTS, type PartSlot } from './catalog';
import { DEFAULT_LOADOUT, type Loadout } from './loadout';
import { MAX_BALANCE, START_BALANCE } from './economy';

/** Versão do formato salvo. Ao mudar o formato, incremente e adicione uma migração em parseSave. */
export const SAVE_SCHEMA_VERSION = 1;

export interface SaveData {
  readonly schemaVersion: number;
  readonly balance: number;
  readonly owned: readonly string[];
  readonly loadout: Loadout;
}

export interface SaveLoadResult {
  readonly save: SaveData;
  readonly warnings: readonly string[];
  /** Verdadeiro se o conteúdo salvo estava ausente ou corrompido e foi substituído. */
  readonly recovered: boolean;
}

/** Partida nova: saldo inicial, peças gratuitas e configuração padrão. */
export const createNewSave = (catalog: PartCatalog): SaveData => ({
  schemaVersion: SAVE_SCHEMA_VERSION,
  balance: START_BALANCE,
  owned: catalog.parts.filter((p) => p.price === 0).map((p) => p.id),
  loadout: DEFAULT_LOADOUT,
});

export const serializeSave = (save: SaveData): string => JSON.stringify(save, null, 2);

/**
 * Lê um salvamento de origem não confiável. Qualquer problema vira aviso, e o campo
 * inválido volta ao padrão. Peças que não existem mais no catálogo são descartadas.
 */
export const parseSave = (raw: string | null | undefined, catalog: PartCatalog): SaveLoadResult => {
  const fresh = (warnings: string[], recovered: boolean): SaveLoadResult => ({
    save: createNewSave(catalog),
    warnings,
    recovered,
  });

  if (raw === null || raw === undefined || raw.trim() === '') return fresh([], false);

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return fresh(['salvamento corrompido (JSON inválido)'], true);
  }
  if (!isRecord(data)) return fresh(['salvamento com formato inesperado'], true);
  if (data.schemaVersion !== SAVE_SCHEMA_VERSION) {
    return fresh([`versão de salvamento não suportada: ${String(data.schemaVersion)}`], true);
  }

  const warnings: string[] = [];
  const defaults = createNewSave(catalog);

  let balance = defaults.balance;
  if (typeof data.balance === 'number' && Number.isFinite(data.balance) && data.balance >= 0 && data.balance <= MAX_BALANCE) {
    balance = Math.floor(data.balance);
  } else if (data.balance !== undefined) {
    warnings.push('saldo inválido: usando valor inicial');
  }

  const owned: string[] = [];
  if (Array.isArray(data.owned)) {
    for (const id of data.owned) {
      if (typeof id === 'string' && catalog.get(id) && !owned.includes(id)) owned.push(id);
      else warnings.push(`peça ignorada: ${String(id)}`);
    }
  }
  for (const id of defaults.owned) if (!owned.includes(id)) owned.push(id);

  const loadout = { ...DEFAULT_LOADOUT } as Record<PartSlot, string>;
  if (isRecord(data.loadout)) {
    for (const slot of PART_SLOTS) {
      const id = data.loadout[slot];
      const part = typeof id === 'string' ? catalog.get(id) : undefined;
      if (part && part.slot === slot && owned.includes(id as string)) loadout[slot] = id as string;
      else if (id !== undefined) warnings.push(`peça ${String(id)} inválida no slot ${slot}`);
    }
  }

  return {
    save: { schemaVersion: SAVE_SCHEMA_VERSION, balance, owned, loadout },
    warnings,
    recovered: false,
  };
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
