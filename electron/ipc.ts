/**
 * Contrato entre o processo principal e o renderer. Compartilhado pelo main e pelo preload.
 * Qualquer canal ou chave fora daqui é recusado pelo processo principal.
 */
export const APP_SCHEME = 'app';
export const APP_HOST = 'kyiv-fpv';

export const CHANNELS = {
  read: 'storage:read',
  write: 'storage:write',
  log: 'log:write',
} as const;

/** Chaves de armazenamento permitidas (arquivos em userData/saves). */
export const STORAGE_KEYS: ReadonlySet<string> = new Set(['save', 'settings']);

export const LOG_LEVELS = ['info', 'warn', 'error'] as const;

export const MAX_STORAGE_CHARS = 1_000_000;
export const MAX_LOG_CHARS = 2000;
