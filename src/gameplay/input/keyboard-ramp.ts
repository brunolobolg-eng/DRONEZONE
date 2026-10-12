import { type KeyboardReading } from './input-mapping';

/**
 * Teclas são binárias (0 ou ±1). Sem suavização, o drone reage a um toque como se fosse
 * uma deflexão total de stick. A rampa leva o eixo até o alvo em `riseSeconds` ao afastar-se
 * do centro e em `fallSeconds` ao voltar, o que deixa o controle mais fino.
 */
export const rampToward = (current: number, target: number, dt: number, riseSeconds: number, fallSeconds: number): number => {
  if (current === target) return target;
  // Afastar-se do centro usa a subida. Voltar ao centro ou inverter o sentido usa a descida.
  const moveAway = current === 0 || (target !== 0 && Math.sign(target) === Math.sign(current) && Math.abs(target) > Math.abs(current));
  const duration = moveAway ? riseSeconds : fallSeconds;
  if (duration <= 0) return target;
  const step = Math.max(0, dt) / duration;
  if (target > current) return Math.min(target, current + step);
  return Math.max(target, current - step);
};

/** Estado da suavização dos eixos do teclado. O acelerador não passa por rampa: já é uma integral. */
export class KeyboardRamp {
  private roll = 0;
  private pitch = 0;
  private yaw = 0;

  /** Aplica a rampa às leituras do teclado. `rampMs = 0` desliga a suavização. */
  update(reading: KeyboardReading, dt: number, rampMs: number): KeyboardReading {
    const rise = Math.max(0, rampMs) / 1000;
    const fall = rise * 0.7;
    this.roll = rampToward(this.roll, reading.roll, dt, rise, fall);
    this.pitch = rampToward(this.pitch, reading.pitch, dt, rise, fall);
    this.yaw = rampToward(this.yaw, reading.yaw, dt, rise, fall);
    return { ...reading, roll: this.roll, pitch: this.pitch, yaw: this.yaw };
  }

  reset(): void {
    this.roll = 0;
    this.pitch = 0;
    this.yaw = 0;
  }
}
