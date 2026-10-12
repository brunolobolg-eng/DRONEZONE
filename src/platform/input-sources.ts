import { type GamepadReading, type KeyboardReading } from '../gameplay/input/input-mapping';
import { BUTTON_KEYS, KEY_BINDINGS, keyboardAxes } from '../gameplay/input/keyboard-axes';
import { logger } from './logger';

/** Teclas do jogo: o navegador não deve rolar a página nem trocar o foco com elas. */
const CAPTURED_KEYS = new Set<string>([...Object.values(KEY_BINDINGS), 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const BUTTON_CODES = new Set<string>(Object.values(BUTTON_KEYS));

/**
 * Lê a Gamepad API. Qualquer controle conectado serve; o primeiro vira o ativo.
 * Conexão e desconexão são avisadas pelo callback.
 */
export class GamepadSource {
  private activeIndex: number | null = null;
  private activeId = '';
  private readonly onConnection: (connected: boolean, id: string) => void;
  private readonly connectListener = (e: GamepadEvent): void => {
    if (this.activeIndex === null) {
      this.activeIndex = e.gamepad.index;
      this.activeId = e.gamepad.id;
    }
    logger.log('info', `gamepad conectado: ${e.gamepad.id}`);
    this.onConnection(true, e.gamepad.id);
  };
  private readonly disconnectListener = (e: GamepadEvent): void => {
    if (e.gamepad.index === this.activeIndex) {
      this.activeIndex = null;
      this.activeId = '';
    }
    logger.log('warn', `gamepad desconectado: ${e.gamepad.id}`);
    this.onConnection(false, e.gamepad.id);
  };

  constructor(target: Window, onConnection: (connected: boolean, id: string) => void) {
    this.onConnection = onConnection;
    target.addEventListener('gamepadconnected', this.connectListener);
    target.addEventListener('gamepaddisconnected', this.disconnectListener);
  }

  get connected(): boolean {
    return this.activeIndex !== null;
  }

  get id(): string {
    return this.activeId;
  }

  /** Leitura atual do controle ativo, ou null se não há controle. */
  read(): GamepadReading | null {
    if (this.activeIndex === null || typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
    const pad = navigator.getGamepads()[this.activeIndex];
    if (!pad || !pad.connected) return null;
    return {
      axes: Array.from(pad.axes),
      buttons: pad.buttons.map((b) => b.pressed),
    };
  }

  dispose(target: Window): void {
    target.removeEventListener('gamepadconnected', this.connectListener);
    target.removeEventListener('gamepaddisconnected', this.disconnectListener);
  }
}

/**
 * Teclado com teclas pressionadas. Ao perder o foco, limpa tudo para não travar comandos.
 * Botões são "travados" (latch): um toque curto entre dois quadros não se perde.
 */
export class KeyboardSource {
  private readonly pressed = new Set<string>();
  private readonly latched = new Set<string>();
  private readonly onDown = (e: KeyboardEvent): void => {
    if (CAPTURED_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.pressed.add(e.code);
    if (BUTTON_CODES.has(e.code)) this.latched.add(e.code);
  };
  private readonly onUp = (e: KeyboardEvent): void => {
    this.pressed.delete(e.code);
  };
  private readonly onBlur = (): void => this.clear();

  constructor(private readonly target: Window) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  clear(): void {
    this.pressed.clear();
    this.latched.clear();
  }

  read(): KeyboardReading {
    const axes = keyboardAxes(this.pressed);
    const buttons = {
      arm: axes.buttons.arm || this.latched.has(BUTTON_KEYS.arm),
      reset: axes.buttons.reset || this.latched.has(BUTTON_KEYS.reset),
      pause: axes.buttons.pause || this.latched.has(BUTTON_KEYS.pause),
      telemetry: axes.buttons.telemetry || this.latched.has(BUTTON_KEYS.telemetry),
    };
    this.latched.clear();
    return {
      roll: axes.roll,
      pitch: axes.pitch,
      yaw: axes.yaw,
      throttleDirection: axes.throttleDirection,
      buttons,
      active: axes.active,
    };
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.pressed.clear();
  }
}
