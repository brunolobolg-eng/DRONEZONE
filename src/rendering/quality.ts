import { type QualityPreset } from '../gameplay/settings';

export interface QualityConfig {
  readonly label: string;
  /** Teto para a densidade de pixels. Abaixo de 1 reduz a carga de pixels em telas grandes. */
  readonly maxPixelRatio: number;
  readonly antialias: boolean;
  readonly shadowMapSize: number;
  /** Quantidade máxima de fragmentos desenhados ao mesmo tempo. */
  readonly fragmentCapacity: number;
  readonly fogNear: number;
  readonly fogFar: number;
}

export const QUALITY_PRESETS: Record<QualityPreset, QualityConfig> = {
  low: { label: 'Baixa', maxPixelRatio: 0.75, antialias: false, shadowMapSize: 0, fragmentCapacity: 60, fogNear: 90, fogFar: 300 },
  medium: { label: 'Média', maxPixelRatio: 1.25, antialias: true, shadowMapSize: 1024, fragmentCapacity: 120, fogNear: 120, fogFar: 380 },
  high: { label: 'Alta', maxPixelRatio: 2, antialias: true, shadowMapSize: 2048, fragmentCapacity: 160, fogNear: 150, fogFar: 460 },
};

export const pixelRatioFor = (preset: QualityPreset, devicePixelRatio: number): number =>
  Math.min(devicePixelRatio || 1, QUALITY_PRESETS[preset].maxPixelRatio);
