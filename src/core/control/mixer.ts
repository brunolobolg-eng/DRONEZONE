import { clamp } from '../math/scalar';
import { type Vec3 } from '../math/vec3';
import { type Quad } from '../physics/drone-state';
import { type DroneParams } from '../physics/drone-params';

export interface MixResult {
  /** Empuxo de cada motor, em N, já limitado ao máximo do motor. */
  readonly demand: Quad;
  /** Verdadeiro quando o pedido não coube nos motores e a autoridade de atitude foi reduzida. */
  readonly saturated: boolean;
}

/**
 * Mistura do quadricóptero em X: converte empuxo total e torques desejados em empuxo por motor.
 *
 * Ordem dos motores: 0 frente-direita, 1 frente-esquerda, 2 traseira-direita, 3 traseira-esquerda.
 * A atitude tem prioridade sobre o empuxo coletivo. Quando algum motor sai dos limites,
 * a parte de atitude é reduzida e o coletivo é ajustado para caber.
 */
export const mixQuad = (totalThrust: number, torque: Vec3, params: DroneParams, maxThrust: number): MixResult => {
  const a = params.armLength * Math.SQRT1_2;
  const d1 = -torque.x / a; // rolagem
  const d2 = torque.z / a; // arfagem
  const d3 = torque.y / params.yawTorqueCoeff; // guinada

  // Parte de atitude por motor (coeficientes derivados de r x F e do torque de reação).
  let att: [number, number, number, number] = [
    (d1 + d2 - d3) / 4,
    (-d1 + d2 + d3) / 4,
    (d1 - d2 + d3) / 4,
    (-d1 - d2 - d3) / 4,
  ];

  // Se a atitude sozinha não cabe na faixa [0, maxThrust], reduz proporcionalmente.
  const attMin = Math.min(...att);
  const attMax = Math.max(...att);
  const span = attMax - attMin;
  if (span > maxThrust) {
    const k = maxThrust / span;
    att = [att[0] * k, att[1] * k, att[2] * k, att[3] * k];
  }
  const scaledMin = Math.min(...att);
  const scaledMax = Math.max(...att);

  // Coletivo: a faixa de valores possíveis é não vazia pelo passo anterior.
  const collectiveRequest = totalThrust / 4;
  const collective = clamp(collectiveRequest, -scaledMin, maxThrust - scaledMax);
  const demand: Quad = [
    clamp(collective + att[0], 0, maxThrust),
    clamp(collective + att[1], 0, maxThrust),
    clamp(collective + att[2], 0, maxThrust),
    clamp(collective + att[3], 0, maxThrust),
  ];

  const saturated = span > maxThrust || collective !== collectiveRequest;
  return { demand, saturated };
};
