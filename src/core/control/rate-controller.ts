import { clamp } from '../math/scalar';
import { type Vec3, vec3 } from '../math/vec3';

export interface RateGains {
  /** Ganho proporcional sobre o erro de velocidade angular, em 1/s. */
  readonly kp: number;
  /** Ganho integral sobre o erro acumulado, em 1/s². */
  readonly ki: number;
  /** Limite do termo integral (rad/s), anti-windup. */
  readonly integralLimit: number;
}

export const DEFAULT_RATE_GAINS: RateGains = { kp: 18, ki: 4, integralLimit: 2 };

/**
 * Controlador de taxa por eixo. Converte o erro de velocidade angular em torque:
 *   torque = I_eixo * (kp * erro + ki * integral(erro))
 * Multiplicar pela inércia faz o ganho valer igual para inércias diferentes.
 */
export class RateController {
  private integral: Vec3 = vec3(0, 0, 0);

  constructor(private readonly gains: RateGains = DEFAULT_RATE_GAINS) {}

  update(
    setpoint: Vec3,
    measured: Vec3,
    inertia: Vec3,
    maxTorque: Vec3,
    dt: number,
  ): Vec3 {
    const error = vec3(setpoint.x - measured.x, setpoint.y - measured.y, setpoint.z - measured.z);
    const lim = this.gains.integralLimit;
    this.integral = vec3(
      clamp(this.integral.x + error.x * dt, -lim, lim),
      clamp(this.integral.y + error.y * dt, -lim, lim),
      clamp(this.integral.z + error.z * dt, -lim, lim),
    );
    return vec3(
      axisTorque(error.x, this.integral.x, inertia.x, maxTorque.x, this.gains),
      axisTorque(error.y, this.integral.y, inertia.y, maxTorque.y, this.gains),
      axisTorque(error.z, this.integral.z, inertia.z, maxTorque.z, this.gains),
    );
  }

  reset(): void {
    this.integral = vec3(0, 0, 0);
  }
}

const axisTorque = (error: number, integral: number, inertia: number, maxTorque: number, g: RateGains): number =>
  clamp(inertia * (g.kp * error + g.ki * integral), -maxTorque, maxTorque);
