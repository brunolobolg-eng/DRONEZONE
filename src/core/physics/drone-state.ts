import { type Quat } from '../math/quat';
import { type Vec3, ZERO } from '../math/vec3';
import { DEFAULT_DRONE_PARAMS, type DroneParams } from './drone-params';

/** Quatro valores, um por motor, na ordem de MOTOR_ORDER. */
export type Quad = readonly [number, number, number, number];

/** Ordem dos motores: 0 frente-direita, 1 frente-esquerda, 2 traseira-direita, 3 traseira-esquerda. */
export const MOTOR_ORDER = ['frontRight', 'frontLeft', 'rearRight', 'rearLeft'] as const;

export type FlightState = 'disarmed' | 'armed' | 'crashed';

/**
 * Estado completo do drone num instante de simulação.
 * É imutável por convenção: cada passo produz um novo estado.
 */
export interface DroneState {
  /** Tempo simulado acumulado, em segundos. */
  readonly time: number;
  /** Posição no mundo, em metros (Y para cima). */
  readonly position: Vec3;
  /** Velocidade no mundo, em m/s. */
  readonly velocity: Vec3;
  /** Orientação do corpo (corpo -> mundo). */
  readonly orientation: Quat;
  /** Velocidade angular no referencial do corpo, em rad/s. */
  readonly angularVelocity: Vec3;
  /** Empuxo real de cada motor após a resposta temporal, em N. */
  readonly motorThrust: Quad;
  /** Energia restante da bateria, em Wh. */
  readonly batteryWh: number;
  /** Integridade estrutural restante. */
  readonly integrity: number;
  readonly flightState: FlightState;
  /** Verdadeiro quando o drone está em contato com o solo ou com um colisor neste passo. */
  readonly inContact: boolean;
}

export const createDroneState = (
  position: Vec3 = { x: 0, y: 0.2, z: 0 },
  params: DroneParams = DEFAULT_DRONE_PARAMS,
  yawRad = 0,
): DroneState => ({
  time: 0,
  position,
  velocity: ZERO,
  orientation: yawQuat(yawRad),
  angularVelocity: ZERO,
  motorThrust: [0, 0, 0, 0],
  batteryWh: params.batteryCapacityWh,
  integrity: params.integrityMax,
  flightState: 'disarmed',
  inContact: true,
});

/** Quaternion de rotação apenas em torno do eixo Y (guinada), com nariz em +X. */
export const yawQuat = (yawRad: number): Quat => {
  const half = yawRad / 2;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
};
