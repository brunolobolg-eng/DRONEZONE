import { type Vec3, vec3 } from '../math/vec3';
import { type DroneParams } from '../physics/drone-params';
import { type DroneState, type FlightState, type Quad } from '../physics/drone-state';
import { type PilotInput } from './pilot-input';
import { type AcroTuning, DEFAULT_ACRO_TUNING, acroSetpoint } from './acro';
import { DEFAULT_RATE_GAINS, type RateGains, RateController } from './rate-controller';
import { mixQuad } from './mixer';

/** Só é possível armar com o acelerador (quase) em zero, por segurança. */
export const ARM_MAX_THROTTLE = 0.05;

export interface ControllerOutput {
  readonly flightState: FlightState;
  readonly demand: Quad;
  readonly setpoint: Vec3;
  readonly saturated: boolean;
}

/**
 * Controlador de voo do modo Acro: entrada -> referências de taxa -> controle de taxa -> mixer.
 * Não há assistência de nível: sem entrada, o drone mantém a atitude atual.
 */
export class FlightController {
  private readonly rates: RateController;

  constructor(
    public tuning: AcroTuning = DEFAULT_ACRO_TUNING,
    gains: RateGains = DEFAULT_RATE_GAINS,
  ) {
    this.rates = new RateController(gains);
  }

  update(state: DroneState, input: PilotInput, params: DroneParams, dt: number): ControllerOutput {
    const flightState = nextFlightState(state, input);
    const zero: Quad = [0, 0, 0, 0];

    if (flightState !== 'armed') {
      this.rates.reset();
      return { flightState, demand: zero, setpoint: vec3(), saturated: false };
    }

    const maxThrust = params.motor.maxThrust * params.motor.efficiency;
    const setpoint = acroSetpoint(input, this.tuning);
    const a = params.armLength * Math.SQRT1_2;
    // Limites grosseiros de torque, usados só para anti-windup do controlador.
    const maxTorque = vec3(2 * a * maxThrust, 4 * params.yawTorqueCoeff * maxThrust, 2 * a * maxThrust);
    const torque = this.rates.update(setpoint, state.angularVelocity, params.inertia, maxTorque, dt);
    const totalThrust = clamp01(input.throttle) * 4 * maxThrust;
    const mix = mixQuad(totalThrust, torque, params, maxThrust);
    return { flightState, demand: mix.demand, setpoint, saturated: mix.saturated };
  }

  reset(): void {
    this.rates.reset();
  }
}

/** Transições de armado: crash bloqueia o armado até reiniciar o voo. */
export const nextFlightState = (state: DroneState, input: PilotInput): FlightState => {
  if (state.flightState === 'crashed') return 'crashed';
  if (!input.armRequest) return state.flightState;
  if (state.flightState === 'armed') return 'disarmed';
  return input.throttle <= ARM_MAX_THROTTLE ? 'armed' : 'disarmed';
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
