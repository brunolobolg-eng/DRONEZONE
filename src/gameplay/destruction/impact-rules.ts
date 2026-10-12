import { clamp } from '../../core/math/scalar';

/**
 * Regras de jogo para eventos de impacto. São valores fictícios, calibrados só para
 * a jogabilidade: não representam nenhum dado real de armamento ou efeito físico de guerra.
 */
export interface ImpactRules {
  /** Dano à estrutura de uma construção por m/s de velocidade acima do limiar. */
  readonly structureDamagePerSpeed: number;
  readonly structureThresholdSpeed: number;
  /** Velocidade mínima para o solo ser deformado. */
  readonly craterMinSpeed: number;
  /** Número de fragmentos gerados por impacto. */
  readonly fragmentsPerImpact: (speed: number) => number;
}

export const DEFAULT_IMPACT_RULES: ImpactRules = {
  structureDamagePerSpeed: 10,
  structureThresholdSpeed: 1,
  craterMinSpeed: 3,
  fragmentsPerImpact: (speed) => clamp(Math.round(speed * 2), 0, 24),
};

export interface CraterSpec {
  readonly radius: number;
  readonly depth: number;
}

/** Tamanho da cratera pela velocidade do impacto. Limitado para manter o terreno jogável. */
export const craterFromSpeed = (speed: number, rules: ImpactRules = DEFAULT_IMPACT_RULES): CraterSpec | null => {
  if (speed < rules.craterMinSpeed) return null;
  return {
    radius: clamp(0.8 + speed * 0.12, 1, 3.2),
    depth: clamp(0.08 + speed * 0.035, 0.1, 0.9),
  };
};

export const structureDamageFromSpeed = (speed: number, rules: ImpactRules = DEFAULT_IMPACT_RULES): number =>
  Math.max(0, speed - rules.structureThresholdSpeed) * rules.structureDamagePerSpeed;
