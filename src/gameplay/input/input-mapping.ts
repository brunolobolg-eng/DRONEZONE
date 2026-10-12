import { type PilotInput } from '../../core/control/pilot-input';
import { applyDeadzone, clamp, clamp01 } from '../../core/math/scalar';

export type ControlName = 'roll' | 'pitch' | 'yaw' | 'throttle';
export type ButtonName = 'arm' | 'reset' | 'pause' | 'telemetry';

/** Leitura bruta de um gamepad (Gamepad API): eixos em [-1, 1] e botões pressionados. */
export interface GamepadReading {
  readonly axes: readonly number[];
  readonly buttons: readonly boolean[];
}

/** Leitura do teclado já convertida em comandos de -1 a 1 (acelerador usa direção). */
export interface KeyboardReading {
  readonly roll: number;
  readonly pitch: number;
  readonly yaw: number;
  readonly throttleDirection: number;
  readonly buttons: Readonly<Record<ButtonName, boolean>>;
  /** Verdadeiro se alguma tecla mapeada está pressionada agora. */
  readonly active: boolean;
}

/** Índice do eixo e inversão de cada controle. Permite remapear qualquer layout de controle. */
export interface AxisBinding {
  readonly index: number;
  readonly invert: boolean;
}

export interface ControlsSettings {
  readonly axes: Readonly<Record<ControlName, AxisBinding>>;
  readonly buttons: Readonly<Record<ButtonName, number>>;
  readonly deadzone: number;
  readonly expo: number;
  /** Multiplicador de sensibilidade aplicado pelo modo Acro. */
  readonly sensitivity: number;
  /**
   * absolute: acelerador segue o stick (topo = 100%).
   * hold: acelerador mantém a posição e o stick ajusta a velocidade de variação (sticks com mola).
   */
  readonly throttleMode: 'absolute' | 'hold';
  readonly throttleRate: number;
}

/** Layouts comuns em gamepads padrão (mapeamento "standard"). Ajustáveis nas configurações. */
// Convenção dos eixos: stick para cima = -1 no eixo vertical, para a direita = +1 no horizontal.
// Acelerador usa essa convenção direto; "invert" fica disponível para quem quer o contrário.
export const LAYOUT_MODE2: ControlsSettings['axes'] = {
  yaw: { index: 0, invert: false },
  throttle: { index: 1, invert: false },
  roll: { index: 2, invert: false },
  pitch: { index: 3, invert: false },
};

export const LAYOUT_MODE1: ControlsSettings['axes'] = {
  pitch: { index: 1, invert: false },
  yaw: { index: 0, invert: false },
  throttle: { index: 3, invert: false },
  roll: { index: 2, invert: false },
};

/** Botões do gamepad "standard": A, Y, Start e Back. */
export const DEFAULT_BUTTONS: Record<ButtonName, number> = { arm: 0, reset: 3, pause: 9, telemetry: 8 };

/** Converte um stick de rolagem, arfagem ou guinada em comando de -1 a 1. */
export const stickCommand = (raw: number, binding: AxisBinding, deadzone: number): number => {
  const value = binding.invert ? -raw : raw;
  return applyDeadzone(clamp(value, -1, 1), deadzone);
};

/** Velocidade de variação do acelerador (1/s) para um stick com mola. Stick para cima = positivo. */
const throttleRateFromStick = (raw: number, binding: AxisBinding, deadzone: number): number => {
  const value = binding.invert ? -raw : raw;
  // Eixos de gamepad: valor negativo = stick para cima.
  return applyDeadzone(clamp(-value, -1, 1), deadzone);
};

/** Acelerador absoluto: stick para cima = 100%, para baixo = 0%. */
export const absoluteThrottle = (raw: number, binding: AxisBinding): number => {
  const value = binding.invert ? -raw : raw;
  return clamp01((1 - clamp(value, -1, 1)) / 2);
};

/** Integra a posição do acelerador por `direction` (-1..1) durante `dt`. Mantém o valor ao soltar. */
export const integrateThrottle = (current: number, direction: number, rate: number, dt: number): number =>
  clamp01(current + clamp(direction, -1, 1) * rate * dt);

export interface ControlFrame {
  readonly input: PilotInput;
  readonly throttle: number;
  readonly buttons: Readonly<Record<ButtonName, boolean>>;
  /** Verdadeiro se o gamepad ou o teclado trouxe algum comando neste quadro. */
  readonly gamepadConnected: boolean;
  readonly keyboardActive: boolean;
}

export interface ResolveArgs {
  readonly gamepad: GamepadReading | null;
  readonly keyboard: KeyboardReading;
  readonly settings: ControlsSettings;
  readonly previousThrottle: number;
  readonly dt: number;
}

/**
 * Combina gamepad e teclado. Para cada controle, vence a fonte com maior deflexão,
 * então um dos dois sempre pode ser usado sem o outro atrapalhar.
 */
export const resolveControls = (args: ResolveArgs): ControlFrame => {
  const { gamepad, keyboard, settings, previousThrottle, dt } = args;
  const read = (name: 'roll' | 'pitch' | 'yaw'): number => {
    const pad = gamepad ? stickCommand(gamepad.axes[settings.axes[name].index] ?? 0, settings.axes[name], settings.deadzone) : 0;
    const key = keyboard[name];
    return Math.abs(pad) >= Math.abs(key) ? pad : key;
  };

  const padRaw = gamepad ? gamepad.axes[settings.axes.throttle.index] ?? 0 : 0;
  const keyDirection = keyboard.throttleDirection;
  let throttle: number;
  if (settings.throttleMode === 'hold') {
    const padRate = gamepad ? throttleRateFromStick(padRaw, settings.axes.throttle, 0.08) : 0;
    const keyRate = keyDirection;
    throttle = integrateThrottle(previousThrottle, padRate + keyRate, settings.throttleRate, dt);
  } else if (keyDirection !== 0) {
    throttle = integrateThrottle(previousThrottle, keyDirection, settings.throttleRate, dt);
  } else {
    throttle = gamepad ? absoluteThrottle(padRaw, settings.axes.throttle) : previousThrottle;
  }

  const buttons = { ...keyboard.buttons };
  if (gamepad) {
    for (const name of Object.keys(settings.buttons) as ButtonName[]) {
      if (gamepad.buttons[settings.buttons[name]]) buttons[name] = true;
    }
  }

  const roll = read('roll') * settings.sensitivity;
  const pitch = read('pitch') * settings.sensitivity;
  const yaw = read('yaw') * settings.sensitivity;

  return {
    input: {
      roll: clamp(roll, -1, 1),
      pitch: clamp(pitch, -1, 1),
      yaw: clamp(yaw, -1, 1),
      throttle,
      armRequest: false,
    },
    throttle,
    buttons,
    gamepadConnected: gamepad !== null,
    keyboardActive: keyboard.active,
  };
};

/** Detecta pressionamentos novos (borda de subida) de cada botão. */
export class ButtonEdges {
  private previous: Record<ButtonName, boolean> = { arm: false, reset: false, pause: false, telemetry: false };

  /** Retorna os botões que acabaram de ser pressionados neste quadro. */
  update(current: Readonly<Record<ButtonName, boolean>>): ButtonName[] {
    const pressed: ButtonName[] = [];
    for (const name of Object.keys(this.previous) as ButtonName[]) {
      if (current[name] && !this.previous[name]) pressed.push(name);
    }
    this.previous = { ...current };
    return pressed;
  }

  reset(): void {
    this.previous = { arm: false, reset: false, pause: false, telemetry: false };
  }
}
