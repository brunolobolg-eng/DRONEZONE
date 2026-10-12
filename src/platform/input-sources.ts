import { type GamepadReading, type KeyboardReading } from '../gameplay/input/input-mapping';
import { BUTTON_KEY_ACTIONS, type KeyBindings, boundCodes, keyboardAxes, DEFAULT_KEY_BINDINGS } from '../gameplay/input/keyboard-axes';
import { logger } from './logger';

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
 * Teclado com as teclas pressionadas, segundo o mapeamento atual.
 * Ao perder o foco, limpa tudo para não travar comandos.
 * Botões (armar, reiniciar, pausar, telemetria) são "travados" entre quadros: um toque curto não se perde.
 */
export class KeyboardSource {
  private readonly pressed = new Set<string>();
  private readonly latched = new Set<string>();
  private bindings: KeyBindings = DEFAULT_KEY_BINDINGS;
  private captured = boundCodes(DEFAULT_KEY_BINDINGS);
  private buttonCodes = new Map<string, string>();

  private readonly onDown = (e: KeyboardEvent): void => {
    if (this.captured.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.pressed.add(e.code);
    if (this.buttonCodes.has(e.code)) this.latched.add(e.code);
  };
  private readonly onUp = (e: KeyboardEvent): void => {
    this.pressed.delete(e.code);
  };
  private readonly onBlur = (): void => this.clear();

  constructor(private readonly target: Window) {
    this.setBindings(DEFAULT_KEY_BINDINGS);
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  /** Troca o mapeamento de teclas. Teclas antigas deixam de ser capturadas. */
  setBindings(bindings: KeyBindings): void {
    this.bindings = bindings;
    this.captured = boundCodes(bindings);
    this.buttonCodes = new Map();
    for (const action of BUTTON_KEY_ACTIONS) {
      for (const code of bindings[action]) this.buttonCodes.set(code, action);
    }
    this.clear();
  }

  clear(): void {
    this.pressed.clear();
    this.latched.clear();
  }

  read(): KeyboardReading {
    const axes = keyboardAxes(this.pressed, this.bindings);
    // Botões travados: pressionados desde a última leitura, mesmo que já tenham sido soltos.
    const latchedActions = new Set<string>();
    for (const code of this.latched) {
      const action = this.buttonCodes.get(code);
      if (action) latchedActions.add(action);
    }
    this.latched.clear();
    const buttons = {
      arm: axes.buttons.arm || latchedActions.has('arm'),
      reset: axes.buttons.reset || latchedActions.has('reset'),
      pause: axes.buttons.pause || latchedActions.has('pause'),
      telemetry: axes.buttons.telemetry || latchedActions.has('telemetry'),
    };
    return {
      roll: axes.roll,
      pitch: axes.pitch,
      yaw: axes.yaw,
      throttleDirection: axes.throttleDirection,
      cutThrottle: axes.cutThrottle,
      buttons,
      active: axes.active,
    };
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.pressed.clear();
    this.latched.clear();
  }
}

