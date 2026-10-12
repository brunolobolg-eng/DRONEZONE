import { valueNoise2 } from '../math/random';
import { type Vec3, vec3 } from '../math/vec3';

/**
 * Campo de vento determinístico. A velocidade do ar é `base` mais rajadas senoidais
 * e turbulência de ruído. Mesma semente e mesmo tempo, mesmo vento.
 */
export interface WindField {
  /** Vento médio no mundo, em m/s. */
  readonly base: Vec3;
  /** Amplitude das rajadas ao longo da direção do vento médio, em m/s. */
  readonly gustAmplitude: number;
  /** Período das rajadas, em segundos. */
  readonly gustPeriod: number;
  /** Amplitude da turbulência espacial, em m/s. */
  readonly turbulence: number;
  readonly seed: number;
}

export const CALM_WIND: WindField = {
  base: vec3(0, 0, 0),
  gustAmplitude: 0,
  gustPeriod: 10,
  turbulence: 0,
  seed: 1,
};

export const windAt = (wind: WindField, position: Vec3, time: number): Vec3 => {
  const gust = wind.gustAmplitude * Math.sin((2 * Math.PI * time) / wind.gustPeriod);
  const speed = Math.hypot(wind.base.x, wind.base.z);
  const dirX = speed > 1e-9 ? wind.base.x / speed : 0;
  const dirZ = speed > 1e-9 ? wind.base.z / speed : 0;
  const n1 = valueNoise2(position.x * 0.05 + time * 0.1, position.z * 0.05, wind.seed) - 0.5;
  const n2 = valueNoise2(position.z * 0.05 - time * 0.1, position.x * 0.05, wind.seed + 17) - 0.5;
  return vec3(
    wind.base.x + dirX * gust + n1 * 2 * wind.turbulence,
    wind.base.y + n2 * wind.turbulence * 0.5,
    wind.base.z + dirZ * gust + n2 * 2 * wind.turbulence,
  );
};
