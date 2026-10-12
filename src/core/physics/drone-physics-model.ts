import { integrateBodyRate, rotate } from '../math/quat';
import { type Vec3, add, cross, dot, length, scale, vec3 } from '../math/vec3';
import { GRAVITY, type DroneParams } from './drone-params';
import { type DroneState, type Quad } from './drone-state';
import { effectiveMaxThrust, motorOffsets, stepMotorThrust } from './motor-model';
import { type WindField, windAt } from './wind';

export interface PhysicsStepInput {
  /** Comando de empuxo de cada motor, em N, vindo do mixer. */
  readonly demand: Quad;
  readonly params: DroneParams;
  readonly wind: WindField;
  readonly dt: number;
}

/** Torque de corpo e força de empuxo resultantes do estado dos motores. Usado também em testes. */
export interface Actuation {
  /** Empuxo total ao longo do eixo Y do corpo, em N. */
  readonly totalThrust: number;
  /** Torque no corpo: x = rolagem, y = guinada, z = arfagem. Em N·m. */
  readonly torque: Vec3;
}

export const computeActuation = (thrust: Quad, params: DroneParams): Actuation => {
  const offsets = motorOffsets(params.armLength);
  let totalThrust = 0;
  let tx = 0;
  let ty = 0;
  let tz = 0;
  for (let i = 0; i < 4; i++) {
    const f = thrust[i];
    const o = offsets[i];
    totalThrust += f;
    // Empuxo no ponto (x, 0, z) com direção +Y: torque = r x F.
    tx += -o.z * f;
    tz += o.x * f;
    // Torque de reação da hélice, oposto ao sentido de rotação.
    ty += -o.spin * params.yawTorqueCoeff * f;
  }
  return { totalThrust, torque: vec3(tx, ty, tz) };
};

/**
 * Um passo de integração do corpo rígido. Ordem semi-implícita:
 * motores -> torques -> velocidade angular -> forças -> velocidade linear -> posição -> orientação.
 * Colisões são resolvidas depois, pelo PhysicsWorld.
 */
export const stepDrone = (state: DroneState, input: PhysicsStepInput): DroneState => {
  const { demand, params, wind, dt } = input;
  const armed = state.flightState === 'armed';

  // 1. Motores com resposta de primeira ordem e limite de potência.
  const maxThrust = effectiveMaxThrust(params, state.batteryWh);
  const effectiveDemand: Quad = armed ? demand : [0, 0, 0, 0];
  const thrust = stepMotorThrust(
    state.motorThrust,
    effectiveDemand,
    maxThrust,
    params.motor.responseTime,
    dt,
  );

  // 2. Torques e velocidade angular (Euler semi-implícito com termo giroscópico).
  const { totalThrust, torque } = computeActuation(thrust, params);
  const w = state.angularVelocity;
  const { x: ix, y: iy, z: iz } = params.inertia;
  const Iw = vec3(ix * w.x, iy * w.y, iz * w.z);
  const gyro = cross(w, Iw);
  const net = vec3(
    torque.x - params.angularDamping * w.x - gyro.x,
    torque.y - params.angularDamping * w.y - gyro.y,
    torque.z - params.angularDamping * w.z - gyro.z,
  );
  const angularVelocity = vec3(w.x + (net.x / ix) * dt, w.y + (net.y / iy) * dt, w.z + (net.z / iz) * dt);

  // 3. Forças: empuxo (direção do corpo), gravidade e arrasto relativo ao ar.
  const thrustWorld = rotate(state.orientation, vec3(0, totalThrust, 0));
  const airVelocity = windAt(wind, state.position, state.time);
  const relative = add(state.velocity, scale(airVelocity, -1));
  const speed = length(relative);
  const drag = scale(add(scale(relative, params.dragLinear), scale(relative, params.dragQuadratic * speed)), -1);
  const gravity = vec3(0, -params.mass * GRAVITY, 0);
  const force = add(add(thrustWorld, drag), gravity);

  const velocity = add(state.velocity, scale(force, dt / params.mass));
  const position = add(state.position, scale(velocity, dt));

  // 4. Orientação com o incremento exato de eixo-ângulo.
  const orientation = integrateBodyRate(state.orientation, angularVelocity, dt);

  // 5. Energia: a potência elétrica é proporcional ao empuxo total.
  const powerW = totalThrust * params.powerPerNewton;
  const batteryWh = Math.max(0, state.batteryWh - (powerW * dt) / 3600);

  return {
    time: state.time + dt,
    position,
    velocity,
    orientation,
    angularVelocity,
    motorThrust: thrust,
    batteryWh,
    integrity: state.integrity,
    flightState: state.flightState,
    inContact: false,
  };
};

/** Velocidade do drone na direção do nariz (+X do corpo), em m/s. Útil para telemetria. */
export const forwardSpeed = (state: DroneState): number => dot(rotate(state.orientation, vec3(1, 0, 0)), state.velocity);
