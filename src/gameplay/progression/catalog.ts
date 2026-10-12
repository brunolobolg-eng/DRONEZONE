import partsData from '../../data/parts.json';

export const PART_SLOTS = ['frame', 'motors', 'battery', 'camera', 'stabilizer', 'mission'] as const;
export type PartSlot = (typeof PART_SLOTS)[number];

/**
 * Efeitos de uma peça. Os deltas são somados; os fatores são multiplicados.
 * Todos alteram parâmetros do modelo físico (ver buildParams em loadout.ts).
 */
export interface PartEffects {
  readonly massDelta?: number;
  readonly integrityMax?: number;
  readonly impactTolerance?: number;
  readonly maxThrustFactor?: number;
  readonly responseFactor?: number;
  readonly efficiencyFactor?: number;
  readonly capacityFactor?: number;
  readonly angularDampingDelta?: number;
  readonly cameraQuality?: number;
  readonly missionRewardFactor?: number;
}

export interface PartDef {
  readonly id: string;
  readonly slot: PartSlot;
  readonly name: string;
  readonly price: number;
  readonly effects: PartEffects;
}

export interface PartCatalog {
  readonly parts: readonly PartDef[];
  get(id: string): PartDef | undefined;
  inSlot(slot: PartSlot): readonly PartDef[];
}

const EFFECT_KEYS: readonly (keyof PartEffects)[] = [
  'massDelta',
  'integrityMax',
  'impactTolerance',
  'maxThrustFactor',
  'responseFactor',
  'efficiencyFactor',
  'capacityFactor',
  'angularDampingDelta',
  'cameraQuality',
  'missionRewardFactor',
];

/** Valida os dados de peças. Lança erro se o arquivo de dados estiver incorreto. */
export const createCatalog = (data: unknown): PartCatalog => {
  if (!isRecord(data) || data.schemaVersion !== 1 || !Array.isArray(data.parts)) {
    throw new Error('Catálogo de peças inválido ou com versão não suportada');
  }
  const seen = new Set<string>();
  const parts: PartDef[] = data.parts.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`Peça ${index} inválida`);
    const id = raw.id;
    if (typeof id !== 'string' || id.length === 0) throw new Error(`Peça ${index} sem id`);
    if (seen.has(id)) throw new Error(`Id de peça duplicado: ${id}`);
    seen.add(id);
    if (typeof raw.slot !== 'string' || !(PART_SLOTS as readonly string[]).includes(raw.slot)) {
      throw new Error(`Peça ${id} com slot inválido`);
    }
    if (typeof raw.price !== 'number' || !Number.isFinite(raw.price) || raw.price < 0) {
      throw new Error(`Peça ${id} com preço inválido`);
    }
    const effects: Partial<Record<keyof PartEffects, number>> = {};
    if (!isRecord(raw.effects)) throw new Error(`Peça ${id} sem efeitos`);
    for (const [key, value] of Object.entries(raw.effects)) {
      if (!(EFFECT_KEYS as readonly string[]).includes(key)) throw new Error(`Peça ${id}: efeito desconhecido ${key}`);
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Peça ${id}: valor inválido em ${key}`);
      effects[key as keyof PartEffects] = value;
    }
    return { id, slot: raw.slot as PartSlot, name: String(raw.name ?? id), price: raw.price, effects };
  });

  const byId = new Map(parts.map((p) => [p.id, p]));
  return {
    parts,
    get: (id) => byId.get(id),
    inSlot: (slot) => parts.filter((p) => p.slot === slot),
  };
};

export const DEFAULT_CATALOG: PartCatalog = createCatalog(partsData);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
