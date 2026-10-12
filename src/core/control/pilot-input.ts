/**
 * Entrada do piloto, já normalizada pela camada de gameplay.
 * Convenções (ver docs/FLIGHT_CONTROLS.md):
 *  - roll:     -1..1, positivo = rolar para a direita
 *  - pitch:    -1..1, positivo = nariz para cima
 *  - yaw:      -1..1, positivo = guinar para a direita
 *  - throttle:  0..1, solicitação de potência dos motores
 */
export interface PilotInput {
  readonly roll: number;
  readonly pitch: number;
  readonly yaw: number;
  readonly throttle: number;
  /** Pulso de um quadro: alterna armado/desarmado. */
  readonly armRequest: boolean;
}

export const NEUTRAL_INPUT: PilotInput = Object.freeze({
  roll: 0,
  pitch: 0,
  yaw: 0,
  throttle: 0,
  armRequest: false,
});
