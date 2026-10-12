/** Tempo sem entrada, depois de um gamepad em uso ter desconectado, até o desarme automático. */
export const FAILSAFE_SECONDS = 1.5;

export interface FailsafeSignal {
  readonly gamepadConnected: boolean;
  readonly keyboardActive: boolean;
}

/**
 * Failsafe de perda de sinal. Só vale quando um gamepad que estava em uso desconecta
 * e o jogador não assume o controle pelo teclado.
 *
 * Teclado ocioso é entrada neutra válida: nunca dispara o failsafe por si só.
 */
export class SignalFailsafe {
  private hadGamepad = false;
  private idleSeconds = 0;

  /** Retorna 'lost' quando os motores devem ser desarmados. */
  update(signal: FailsafeSignal, dt: number): 'ok' | 'lost' {
    if (signal.gamepadConnected) {
      this.hadGamepad = true;
      this.idleSeconds = 0;
      return 'ok';
    }
    if (signal.keyboardActive || !this.hadGamepad) {
      this.idleSeconds = 0;
      return 'ok';
    }
    this.idleSeconds += Math.max(0, dt);
    return this.idleSeconds >= FAILSAFE_SECONDS ? 'lost' : 'ok';
  }

  get idle(): number {
    return this.idleSeconds;
  }

  reset(): void {
    this.hadGamepad = false;
    this.idleSeconds = 0;
  }
}
