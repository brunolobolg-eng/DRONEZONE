/**
 * Parâmetros físicos do quadricóptero. Todas as unidades estão em SI:
 * kg, m, s, N, N·m, rad. Ver docs/PHYSICS_MODEL.md.
 *
 * Progressão (gameplay/progression) altera estes valores; a UI apenas os exibe.
 */
export interface MotorParams {
  /** Empuxo máximo de cada motor, em newtons. */
  maxThrust: number;
  /** Constante de tempo da resposta do motor (lag de primeira ordem), em segundos. */
  responseTime: number;
  /** Fator multiplicador de eficiência do conjunto motor-hélice (1 = referência). */
  efficiency: number;
}

export interface DroneParams {
  /** Massa total, incluindo bateria, em kg. */
  mass: number;
  /** Distância do centro de massa até cada motor, em metros. */
  armLength: number;
  /** Momentos de inércia principais do corpo (kg·m²). */
  inertia: { readonly x: number; readonly y: number; readonly z: number };
  /** Torque de reação por newton de empuxo, em metros (relação de arrasto da hélice). */
  yawTorqueCoeff: number;
  motor: MotorParams;
  /** Arrasto linear do ar, N·s/m. */
  dragLinear: number;
  /** Arrasto quadrático do ar, N·s²/m². */
  dragQuadratic: number;
  /** Amortecimento angular do corpo, N·m·s/rad. Melhorado pela estabilidade. */
  angularDamping: number;
  /** Raio da esfera de colisão do drone, em metros. */
  radius: number;
  /** Potência elétrica aproximada por newton de empuxo total, em W/N. */
  powerPerNewton: number;
  /** Energia útil da bateria, em watt-hora. */
  batteryCapacityWh: number;
  /** Integridade máxima da estrutura (pontos). */
  integrityMax: number;
  /** Velocidade de impacto (m/s) abaixo da qual não há dano. */
  impactTolerance: number;
  /** Pontos de integridade perdidos por m/s acima da tolerância. */
  impactDamagePerSpeed: number;
}

export const GRAVITY = 9.80665;

export const DEFAULT_DRONE_PARAMS: DroneParams = {
  mass: 0.62,
  armLength: 0.11,
  inertia: { x: 0.004, y: 0.0075, z: 0.004 },
  yawTorqueCoeff: 0.016,
  motor: { maxThrust: 7, responseTime: 0.035, efficiency: 1 },
  dragLinear: 0.02,
  dragQuadratic: 0.024,
  angularDamping: 0.0008,
  radius: 0.14,
  powerPerNewton: 26,
  batteryCapacityWh: 22,
  integrityMax: 100,
  impactTolerance: 2.5,
  impactDamagePerSpeed: 12,
};

/** Lança erro se algum parâmetro tornar a simulação inválida. */
export const validateDroneParams = (p: DroneParams): void => {
  const positive: [string, number][] = [
    ['mass', p.mass],
    ['armLength', p.armLength],
    ['inertia.x', p.inertia.x],
    ['inertia.y', p.inertia.y],
    ['inertia.z', p.inertia.z],
    ['motor.maxThrust', p.motor.maxThrust],
    ['motor.responseTime', p.motor.responseTime],
    ['motor.efficiency', p.motor.efficiency],
    ['radius', p.radius],
    ['batteryCapacityWh', p.batteryCapacityWh],
    ['integrityMax', p.integrityMax],
  ];
  for (const [name, value] of positive) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`Parâmetro inválido: ${name} deve ser positivo e finito (recebido ${value})`);
    }
  }
  const nonNegative: [string, number][] = [
    ['yawTorqueCoeff', p.yawTorqueCoeff],
    ['dragLinear', p.dragLinear],
    ['dragQuadratic', p.dragQuadratic],
    ['angularDamping', p.angularDamping],
    ['powerPerNewton', p.powerPerNewton],
    ['impactTolerance', p.impactTolerance],
    ['impactDamagePerSpeed', p.impactDamagePerSpeed],
  ];
  for (const [name, value] of nonNegative) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`Parâmetro inválido: ${name} não pode ser negativo (recebido ${value})`);
    }
  }
};
