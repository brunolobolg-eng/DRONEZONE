export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

export const clamp01 = (value: number): number => clamp(value, 0, 1);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Suavização cúbica entre edge0 e edge1 (0 abaixo, 1 acima). */
export const smoothstep = (value: number, edge0: number, edge1: number): number => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** Curva de resposta: mistura linear (expo = 0) com cúbica (expo = 1). Entrada em [-1, 1]. */
export const expoCurve = (input: number, expo: number): number => {
  const e = clamp01(expo);
  return (1 - e) * input + e * input * input * input;
};

/** Zona morta com reescalonamento, para que a saída continue indo de 0 a ±1. */
export const applyDeadzone = (input: number, deadzone: number): number => {
  const abs = Math.abs(input);
  if (abs <= deadzone) return 0;
  const scaled = (abs - deadzone) / (1 - deadzone);
  return Math.sign(input) * clamp01(scaled);
};

export const degToRad = (deg: number): number => (deg * Math.PI) / 180;

export const radToDeg = (rad: number): number => (rad * 180) / Math.PI;
