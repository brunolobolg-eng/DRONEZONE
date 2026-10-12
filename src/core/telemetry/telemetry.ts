import { rotate } from '../math/quat';
import { clamp, radToDeg } from '../math/scalar';
import { type Vec3, vec3 } from '../math/vec3';
import { type DroneParams } from '../physics/drone-params';
import { type DroneState, type FlightState } from '../physics/drone-state';
import { computeActuation } from '../physics/drone-physics-model';

/** Valores derivados do estado, para HUD e depuração. Sem nenhuma dependência de renderização. */
export interface DroneTelemetry {
  readonly simTime: number;
  readonly altitudeAgl: number;
  readonly groundHeight: number;
  readonly speedMs: number;
  readonly speedKmh: number;
  readonly verticalSpeedMs: number;
  /** Positivo = nariz para cima. */
  readonly pitchDeg: number;
  /** Positivo = asa direita para baixo. Faixa de -180° a 180°. */
  readonly rollDeg: number;
  /** 0 a 360. 0 = +X do mundo, 90 = +Z. */
  readonly headingDeg: number;
  /** Taxas angulares em graus/s: roll (x), pitch (z) e yaw à direita (-y). */
  readonly rateDegPerSec: { readonly roll: number; readonly pitch: number; readonly yaw: number };
  readonly batteryPct: number;
  readonly batteryVoltage: number;
  readonly integrityPct: number;
  readonly flightState: FlightState;
  /** Empuxo de cada motor como fração do máximo nominal, em [0, 1]. */
  readonly motorFraction: readonly [number, number, number, number];
  readonly totalThrustN: number;
  readonly powerW: number;
  readonly saturated: boolean;
}

export const computeTelemetry = (
  state: DroneState,
  params: DroneParams,
  groundHeight: number,
  saturated: boolean,
): DroneTelemetry => {
  const forward = rotate(state.orientation, vec3(1, 0, 0));
  const right = rotate(state.orientation, vec3(0, 0, 1));
  const v = state.velocity;
  const speedMs = Math.hypot(v.x, v.y, v.z);
  const { totalThrust } = computeActuation(state.motorThrust, params);
  const nominal = params.motor.maxThrust;
  const w: Vec3 = state.angularVelocity;
  const batteryFraction = clamp(state.batteryWh / params.batteryCapacityWh, 0, 1);

  return {
    simTime: state.time,
    altitudeAgl: state.position.y - groundHeight,
    groundHeight,
    speedMs,
    speedKmh: speedMs * 3.6,
    verticalSpeedMs: v.y,
    pitchDeg: radToDeg(Math.asin(clamp(forward.y, -1, 1))),
    // atan2 cobre a volta completa: no modo Acro o drone pode girar além de 90° sem estabilizar.
    rollDeg: radToDeg(Math.atan2(-right.y, right.z)),
    headingDeg: normalizeDeg(radToDeg(Math.atan2(forward.z, forward.x))),
    rateDegPerSec: {
      roll: radToDeg(w.x),
      pitch: radToDeg(w.z),
      yaw: radToDeg(-w.y),
    },
    batteryPct: batteryFraction * 100,
    // Pack 4S simplificado: 13,2 V descarregado, 16,8 V cheio (sem queda sob carga).
    batteryVoltage: 13.2 + 3.6 * batteryFraction,
    integrityPct: clamp((state.integrity / params.integrityMax) * 100, 0, 100),
    flightState: state.flightState,
    motorFraction: [
      clamp(state.motorThrust[0] / nominal, 0, 1),
      clamp(state.motorThrust[1] / nominal, 0, 1),
      clamp(state.motorThrust[2] / nominal, 0, 1),
      clamp(state.motorThrust[3] / nominal, 0, 1),
    ],
    totalThrustN: totalThrust,
    powerW: totalThrust * params.powerPerNewton,
    saturated,
  };
};

const normalizeDeg = (deg: number): number => ((deg % 360) + 360) % 360;
