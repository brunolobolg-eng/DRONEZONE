import { DEFAULT_DRONE_PARAMS, GRAVITY, type DroneParams, validateDroneParams } from '../../core/physics/drone-params';
import { type PartCatalog, type PartDef, type PartEffects, type PartSlot, PART_SLOTS } from './catalog';

export type Loadout = Readonly<Record<PartSlot, string>>;

export const DEFAULT_LOADOUT: Loadout = {
  frame: 'frame-scrap',
  motors: 'motors-stock',
  battery: 'battery-1300',
  camera: 'camera-analog',
  stabilizer: 'stabilizer-none',
  mission: 'mission-none',
};

export interface BuiltDrone {
  readonly params: DroneParams;
  readonly cameraQuality: number;
  readonly missionRewardFactor: number;
}

/** Erro de configuração: peça inexistente ou no slot errado. */
export class LoadoutError extends Error {}

const resolveParts = (catalog: PartCatalog, loadout: Loadout): PartDef[] =>
  PART_SLOTS.map((slot) => {
    const id = loadout[slot];
    const part = catalog.get(id);
    if (!part) throw new LoadoutError(`Peça desconhecida: ${id}`);
    if (part.slot !== slot) throw new LoadoutError(`Peça ${id} não pertence ao slot ${slot}`);
    return part;
  });

/**
 * Monta os parâmetros físicos do drone a partir das peças escolhidas.
 * Melhorias mudam o modelo físico (massa, empuxo, resposta, bateria, amortecimento, tolerância a impacto).
 */
export const buildDrone = (catalog: PartCatalog, loadout: Loadout, base: DroneParams = DEFAULT_DRONE_PARAMS): BuiltDrone => {
  const parts = resolveParts(catalog, loadout);
  const sum = (key: keyof PartEffects) => parts.reduce((acc, p) => acc + (p.effects[key] ?? 0), 0);
  const product = (key: keyof PartEffects) => parts.reduce((acc, p) => acc * (p.effects[key] ?? 1), 1);

  const efficiency = base.motor.efficiency * product('efficiencyFactor');
  const params: DroneParams = {
    ...base,
    mass: base.mass + sum('massDelta'),
    integrityMax: base.integrityMax + sum('integrityMax'),
    impactTolerance: base.impactTolerance + sum('impactTolerance'),
    angularDamping: base.angularDamping + sum('angularDampingDelta'),
    batteryCapacityWh: base.batteryCapacityWh * product('capacityFactor'),
    motor: {
      maxThrust: base.motor.maxThrust * product('maxThrustFactor'),
      responseTime: base.motor.responseTime * product('responseFactor'),
      efficiency,
    },
    // Motor mais eficiente gasta menos energia por newton de empuxo.
    powerPerNewton: base.powerPerNewton / efficiency,
  };
  validateDroneParams(params);

  const cameraPart = parts.find((p) => p.slot === 'camera');
  const cameraQuality = cameraPart?.effects.cameraQuality ?? 1;
  return { params, cameraQuality, missionRewardFactor: product('missionRewardFactor') };
};

export interface ComparisonRow {
  readonly label: string;
  readonly before: string;
  readonly after: string;
  /** Verdadeiro se a configuração nova é melhor nesta métrica. */
  readonly improved: boolean | null;
}

export interface SpecSheet {
  readonly massKg: number;
  readonly thrustToWeight: number;
  readonly motorThrustN: number;
  readonly responseMs: number;
  readonly batteryWh: number;
  readonly hoverThrottlePct: number;
  readonly flightMinutes: number;
  readonly integrityMax: number;
  readonly impactTolerance: number;
  readonly cameraQuality: number;
}

/** Ficha técnica calculada a partir dos parâmetros reais. Não é um número fixo de interface. */
export const specSheet = (drone: BuiltDrone): SpecSheet => {
  const { params } = drone;
  const weight = params.mass * GRAVITY;
  const maxTotal = params.motor.maxThrust * 4;
  const hoverPower = weight * params.powerPerNewton;
  return {
    massKg: params.mass,
    thrustToWeight: maxTotal / weight,
    motorThrustN: params.motor.maxThrust,
    responseMs: params.motor.responseTime * 1000,
    batteryWh: params.batteryCapacityWh,
    hoverThrottlePct: (weight / maxTotal) * 100,
    flightMinutes: (params.batteryCapacityWh / hoverPower) * 60,
    integrityMax: params.integrityMax,
    impactTolerance: params.impactTolerance,
    cameraQuality: drone.cameraQuality,
  };
};

/** Compara a configuração atual com uma candidata, métrica por métrica. */
export const compareSpecs = (current: SpecSheet, candidate: SpecSheet): ComparisonRow[] => {
  const row = (
    label: string,
    key: keyof SpecSheet,
    format: (v: number) => string,
    higherIsBetter: boolean | null,
  ): ComparisonRow => {
    const before = current[key];
    const after = candidate[key];
    const diff = after - before;
    const improved = higherIsBetter === null || Math.abs(diff) < 1e-9 ? null : higherIsBetter ? diff > 0 : diff < 0;
    return { label, before: format(before), after: format(after), improved };
  };
  return [
    row('Massa', 'massKg', (v) => `${v.toFixed(2)} kg`, false),
    row('Empuxo / peso', 'thrustToWeight', (v) => `${v.toFixed(2)}:1`, true),
    row('Empuxo por motor', 'motorThrustN', (v) => `${v.toFixed(2)} N`, true),
    row('Resposta do motor', 'responseMs', (v) => `${v.toFixed(0)} ms`, false),
    row('Energia da bateria', 'batteryWh', (v) => `${v.toFixed(1)} Wh`, true),
    row('Tempo de voo estimado', 'flightMinutes', (v) => `${v.toFixed(1)} min`, true),
    row('Integridade máxima', 'integrityMax', (v) => v.toFixed(0), true),
    row('Tolerância a impacto', 'impactTolerance', (v) => `${v.toFixed(1)} m/s`, true),
    row('Qualidade da câmera', 'cameraQuality', (v) => `nível ${v}`, true),
  ];
};

export const loadoutCost = (catalog: PartCatalog, loadout: Loadout): number =>
  resolveParts(catalog, loadout).reduce((acc, p) => acc + p.price, 0);
