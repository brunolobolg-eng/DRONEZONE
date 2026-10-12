import { clamp } from '../math/scalar';
import { type DroneParams } from './drone-params';
import { type Quad } from './drone-state';

export interface MotorOffset {
  /** Posição no plano horizontal do corpo: x para frente, z para a direita. */
  readonly x: number;
  readonly z: number;
  /** +1 ou -1: sentido de rotação da hélice em torno do eixo Y do corpo. */
  readonly spin: 1 | -1;
}

/**
 * Configuração em X. Os motores ficam nas diagonais, a distância `armLength` do centro.
 * Sentidos alternados, para que os torques de reação se cancelem em equilíbrio.
 */
export const motorOffsets = (armLength: number): readonly MotorOffset[] => {
  const a = armLength * Math.SQRT1_2;
  return [
    { x: a, z: a, spin: 1 },
    { x: a, z: -a, spin: -1 },
    { x: -a, z: a, spin: -1 },
    { x: -a, z: -a, spin: 1 },
  ];
};

/** Fração do empuxo máximo disponível com a bateria atual (queda de tensão sob carga). */
export const batteryPowerFactor = (batteryWh: number, capacityWh: number): number => {
  const fraction = clamp(batteryWh / capacityWh, 0, 1);
  return 0.55 + 0.45 * fraction;
};

/** Empuxo máximo efetivo de um motor, considerando eficiência e bateria. */
export const effectiveMaxThrust = (p: DroneParams, batteryWh: number): number =>
  p.motor.maxThrust * p.motor.efficiency * batteryPowerFactor(batteryWh, p.batteryCapacityWh);

/**
 * Resposta de primeira ordem: cada motor tende ao comando com constante de tempo `responseTime`.
 * O passo é exato (1 - e^(-dt/τ)), portanto estável para qualquer dt positivo.
 * Os valores ficam limitados entre 0 e o empuxo máximo efetivo.
 */
export const stepMotorThrust = (
  current: Quad,
  demand: Quad,
  maxThrust: number,
  responseTime: number,
  dt: number,
): Quad => {
  const blend = 1 - Math.exp(-dt / responseTime);
  const next = current.map((value, i) => {
    const target = clamp(demand[i], 0, maxThrust);
    return clamp(value + (target - value) * blend, 0, maxThrust);
  });
  return [next[0], next[1], next[2], next[3]];
};
