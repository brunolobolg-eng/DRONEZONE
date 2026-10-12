import { type ButtonName, type ControlName, type ControlsSettings, DEFAULT_BUTTONS, LAYOUT_MODE2, LAYOUT_MODE1, type AxisBinding } from './input/input-mapping';
import { clamp } from '../core/math/scalar';

export const SETTINGS_SCHEMA_VERSION = 1;

export type QualityPreset = 'low' | 'medium' | 'high';
export type LayoutProfile = 'mode2' | 'mode1';

export interface GameSettings {
  readonly schemaVersion: number;
  readonly layout: LayoutProfile;
  readonly axes: Readonly<Record<ControlName, AxisBinding>>;
  readonly buttons: Readonly<Record<ButtonName, number>>;
  readonly deadzone: number;
  readonly expo: number;
  readonly sensitivity: number;
  readonly throttleMode: 'absolute' | 'hold';
  readonly throttleRate: number;
  readonly quality: QualityPreset;
  readonly fov: number;
  readonly cameraEffects: boolean;
  /** Intensidade da vibração visual (0 desliga), em [0, 1]. */
  readonly vibration: number;
  readonly telemetryVisible: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  layout: 'mode2',
  axes: LAYOUT_MODE2,
  buttons: DEFAULT_BUTTONS,
  deadzone: 0.06,
  expo: 0.3,
  sensitivity: 1,
  throttleMode: 'absolute',
  throttleRate: 0.8,
  quality: 'medium',
  fov: 85,
  cameraEffects: true,
  vibration: 0.5,
  telemetryVisible: false,
};

export interface SettingsLoadResult {
  readonly settings: GameSettings;
  readonly warnings: readonly string[];
}

const QUALITIES: readonly QualityPreset[] = ['low', 'medium', 'high'];
const CONTROL_NAMES: readonly ControlName[] = ['roll', 'pitch', 'yaw', 'throttle'];
const BUTTON_NAMES: readonly ButtonName[] = ['arm', 'reset', 'pause', 'telemetry'];

/**
 * Lê configurações de uma fonte não confiável (arquivo, armazenamento do navegador).
 * Valores inválidos voltam ao padrão e geram um aviso. Campos desconhecidos são ignorados.
 */
export const sanitizeSettings = (raw: unknown): SettingsLoadResult => {
  const warnings: string[] = [];
  if (!isRecord(raw)) {
    return { settings: DEFAULT_SETTINGS, warnings: raw === undefined || raw === null ? [] : ['configurações inválidas: usando padrão'] };
  }
  const d = DEFAULT_SETTINGS;
  const num = (key: string, fallback: number, min: number, max: number): number => {
    const v = raw[key];
    if (v === undefined) return fallback;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      warnings.push(`${key} inválido`);
      return fallback;
    }
    return clamp(v, min, max);
  };
  const oneOf = <T extends string>(key: string, options: readonly T[], fallback: T): T => {
    const v = raw[key];
    if (v === undefined) return fallback;
    if (typeof v === 'string' && (options as readonly string[]).includes(v)) return v as T;
    warnings.push(`${key} inválido`);
    return fallback;
  };
  const bool = (key: string, fallback: boolean): boolean => {
    const v = raw[key];
    if (v === undefined) return fallback;
    if (typeof v === 'boolean') return v;
    warnings.push(`${key} inválido`);
    return fallback;
  };

  const layout = oneOf<LayoutProfile>('layout', ['mode2', 'mode1'], d.layout);
  const baseAxes = layout === 'mode1' ? LAYOUT_MODE1 : LAYOUT_MODE2;
  const axes = { ...baseAxes };
  if (isRecord(raw.axes)) {
    for (const name of CONTROL_NAMES) {
      const entry = raw.axes[name];
      if (isRecord(entry) && Number.isInteger(entry.index) && (entry.index as number) >= 0 && (entry.index as number) <= 15) {
        axes[name] = { index: entry.index as number, invert: entry.invert === true };
      } else if (entry !== undefined) {
        warnings.push(`eixo ${name} inválido`);
      }
    }
  }
  const buttons = { ...DEFAULT_BUTTONS };
  if (isRecord(raw.buttons)) {
    for (const name of BUTTON_NAMES) {
      const v = raw.buttons[name];
      if (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 31) buttons[name] = v as number;
      else if (v !== undefined) warnings.push(`botão ${name} inválido`);
    }
  }

  const settings: GameSettings = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    layout,
    axes,
    buttons,
    deadzone: num('deadzone', d.deadzone, 0, 0.3),
    expo: num('expo', d.expo, 0, 1),
    sensitivity: num('sensitivity', d.sensitivity, 0.25, 2),
    throttleMode: oneOf<'absolute' | 'hold'>('throttleMode', ['absolute', 'hold'], d.throttleMode),
    throttleRate: num('throttleRate', d.throttleRate, 0.1, 2),
    quality: oneOf<QualityPreset>('quality', QUALITIES, d.quality),
    fov: num('fov', d.fov, 50, 110),
    cameraEffects: bool('cameraEffects', d.cameraEffects),
    vibration: num('vibration', d.vibration, 0, 1),
    telemetryVisible: bool('telemetryVisible', d.telemetryVisible),
  };
  return { settings, warnings };
};

/** Converte as configurações de controle para o formato usado pelo mapeamento de entradas. */
export const toControlsSettings = (s: GameSettings): ControlsSettings => ({
  axes: s.axes,
  buttons: s.buttons,
  deadzone: s.deadzone,
  expo: s.expo,
  sensitivity: s.sensitivity,
  throttleMode: s.throttleMode,
  throttleRate: s.throttleRate,
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
