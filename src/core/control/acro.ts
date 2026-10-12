import { expoCurve, clamp } from '../math/scalar';
import { type Vec3, vec3 } from '../math/vec3';
import { type PilotInput } from './pilot-input';

/** Ajustes do modo Acro. Taxas em rad/s no valor máximo com stick totalmente inclinado. */
export interface AcroTuning {
  readonly rollRateMax: number;
  readonly pitchRateMax: number;
  readonly yawRateMax: number;
  /** Curva exponencial: 0 = linear, 1 = muito suave no centro. */
  readonly expo: number;
  /** Multiplicador global de sensibilidade (ajuste do jogador). */
  readonly rateScale: number;
}

export const DEFAULT_ACRO_TUNING: AcroTuning = {
  rollRateMax: 8.7, // ~500 graus/s
  pitchRateMax: 8.7,
  yawRateMax: 5.2, // ~300 graus/s
  expo: 0.3,
  rateScale: 1,
};

/**
 * Converte a entrada do piloto em uma referência de velocidade angular do corpo.
 * O resultado segue a convenção do corpo: x = rolagem, y = guinada (positivo = esquerda),
 * z = arfagem (positivo = nariz para cima). Por isso a guinada à direita sai negativa em y.
 */
export const acroSetpoint = (input: PilotInput, tuning: AcroTuning): Vec3 => {
  const s = clamp(tuning.rateScale, 0, 2);
  const roll = expoCurve(clamp(input.roll, -1, 1), tuning.expo);
  const pitch = expoCurve(clamp(input.pitch, -1, 1), tuning.expo);
  const yaw = expoCurve(clamp(input.yaw, -1, 1), tuning.expo);
  return vec3(
    roll * tuning.rollRateMax * s,
    -yaw * tuning.yawRateMax * s,
    pitch * tuning.pitchRateMax * s,
  );
};
