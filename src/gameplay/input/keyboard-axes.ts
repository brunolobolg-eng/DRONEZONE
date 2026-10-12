import { type ButtonName } from './input-mapping';

/**
 * Teclado como alternativa para desenvolvimento e testes.
 *   A / D      rolagem esquerda / direita
 *   S / W      nariz para cima / para baixo
 *   Q / E      guinada esquerda / direita
 *   Shift / Ctrl  acelerador para cima / para baixo (mantém a posição ao soltar)
 *   Espaço     armar / desarmar
 *   Backspace  reiniciar o voo
 *   Escape     pausar
 *   Tab        alternar telemetria
 */
export const KEY_BINDINGS = {
  rollLeft: 'KeyA',
  rollRight: 'KeyD',
  pitchUp: 'KeyS',
  pitchDown: 'KeyW',
  yawLeft: 'KeyQ',
  yawRight: 'KeyE',
  throttleUp: 'ShiftLeft',
  throttleDown: 'ControlLeft',
  arm: 'Space',
  reset: 'Backspace',
  pause: 'Escape',
  telemetry: 'Tab',
} as const;

export const BUTTON_KEYS: Record<ButtonName, string> = {
  arm: KEY_BINDINGS.arm,
  reset: KEY_BINDINGS.reset,
  pause: KEY_BINDINGS.pause,
  telemetry: KEY_BINDINGS.telemetry,
};

export interface KeyboardAxes {
  readonly roll: number;
  readonly pitch: number;
  readonly yaw: number;
  readonly throttleDirection: number;
  readonly buttons: Readonly<Record<ButtonName, boolean>>;
  readonly active: boolean;
}

/** Converte o conjunto de teclas pressionadas em eixos de -1 a 1. Pura e testável. */
export const keyboardAxes = (pressed: ReadonlySet<string>): KeyboardAxes => {
  const has = (code: string) => pressed.has(code);
  const axis = (negative: string, positive: string) => (has(positive) ? 1 : 0) - (has(negative) ? 1 : 0);
  const roll = axis(KEY_BINDINGS.rollLeft, KEY_BINDINGS.rollRight);
  const pitch = axis(KEY_BINDINGS.pitchDown, KEY_BINDINGS.pitchUp);
  const yaw = axis(KEY_BINDINGS.yawLeft, KEY_BINDINGS.yawRight);
  const throttleDirection = axis(KEY_BINDINGS.throttleDown, KEY_BINDINGS.throttleUp);
  const buttons = {
    arm: has(BUTTON_KEYS.arm),
    reset: has(BUTTON_KEYS.reset),
    pause: has(BUTTON_KEYS.pause),
    telemetry: has(BUTTON_KEYS.telemetry),
  };
  const active = roll !== 0 || pitch !== 0 || yaw !== 0 || throttleDirection !== 0 || Object.values(buttons).some(Boolean);
  return { roll, pitch, yaw, throttleDirection, buttons, active };
};
