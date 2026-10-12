import { type ButtonName, type ControlName, type ControlsSettings, DEFAULT_BUTTONS, LAYOUT_MODE2, LAYOUT_MODE1, type AxisBinding } from './input/input-mapping';
import {
  DEFAULT_KEY_BINDINGS,
  KEY_ACTIONS,
  MAX_KEYS_PER_ACTION,
  type KeyAction,
  type KeyBindings,
  findBindingConflict,
} from './input/keyboard-axes';
import { clamp } from '../core/math/scalar';

export const SETTINGS_SCHEMA_VERSION = 2;

export type QualityPreset = 'low' | 'medium' | 'high';
export type LayoutProfile = 'mode2' | 'mode1';

export interface GameSettings {
  readonly schemaVersion: number;
  readonly layout: LayoutProfile;
  readonly axes: Readonly<Record<ControlName, AxisBinding>>;
  readonly buttons: Readonly<Record<ButtonName, number>>;
  readonly keys: KeyBindings;
  /** Tempo da rampa de suavização do teclado (ms). 0 desliga. */
  readonly keyboardRampMs: number;
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
  keys: DEFAULT_KEY_BINDINGS,
  keyboardRampMs: 120,
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
const CODE_PATTERN = /^[A-Za-z0-9]{1,20}$/;

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

  const keys = sanitizeKeys(raw.keys, warnings);

  const settings: GameSettings = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    layout,
    axes,
    buttons,
    keys,
    keyboardRampMs: num('keyboardRampMs', d.keyboardRampMs, 0, 400),
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

/**
 * Teclas do jogador. Cada ação usa de 1 a 2 teclas. Ações ausentes ou inválidas voltam ao padrão.
 * Se a mesma tecla aparecer em duas ações, o mapeamento inteiro volta ao padrão, para não deixar o jogo ambíguo.
 */
const sanitizeKeys = (raw: unknown, warnings: string[]): KeyBindings => {
  if (raw === undefined) return DEFAULT_KEY_BINDINGS;
  if (!isRecord(raw)) {
    warnings.push('teclas inválidas: usando padrão');
    return DEFAULT_KEY_BINDINGS;
  }
  const result = { ...DEFAULT_KEY_BINDINGS } as Record<KeyAction, readonly string[]>;
  for (const action of KEY_ACTIONS) {
    const entry = raw[action];
    if (entry === undefined) continue;
    const valid =
      Array.isArray(entry) &&
      entry.length >= 1 &&
      entry.length <= MAX_KEYS_PER_ACTION &&
      entry.every((code) => typeof code === 'string' && CODE_PATTERN.test(code)) &&
      new Set(entry).size === entry.length;
    if (valid) result[action] = entry as string[];
    else warnings.push(`tecla de "${action}" inválida`);
  }
  const conflict = findBindingConflict(result);
  if (conflict) {
    warnings.push(`tecla ${conflict.code} usada em mais de uma ação: teclas voltaram ao padrão`);
    return DEFAULT_KEY_BINDINGS;
  }
  return result;
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
