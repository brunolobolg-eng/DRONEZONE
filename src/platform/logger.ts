import { desktopApi } from './desktop-bridge';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  readonly time: number;
  readonly level: LogLevel;
  readonly message: string;
}

const MAX_ENTRIES = 200;
const MAX_MESSAGE = 2000;

/** Registro em memória com envio ao console e, no desktop, ao arquivo de log do aplicativo. */
export class Logger {
  private readonly entries: LogEntry[] = [];

  log(level: LogLevel, message: string, detail?: unknown): void {
    const text = detail === undefined ? message : `${message} ${describe(detail)}`;
    const trimmed = text.length > MAX_MESSAGE ? text.slice(0, MAX_MESSAGE) : text;
    this.entries.push({ time: Date.now(), level, message: trimmed });
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();

    const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    consoleFn(`[kyiv-fpv] ${trimmed}`);
    try {
      desktopApi()?.log(level, trimmed);
    } catch {
      // Falha ao enviar log nunca deve derrubar o jogo.
    }
  }

  get recent(): readonly LogEntry[] {
    return this.entries;
  }

  /** Captura erros não tratados e promessas rejeitadas, sem interromper o jogo. */
  install(target: Window): void {
    target.addEventListener('error', (event) => {
      this.log('error', 'erro não tratado', event.error ?? event.message);
    });
    target.addEventListener('unhandledrejection', (event) => {
      this.log('error', 'promessa rejeitada sem tratamento', event.reason);
    });
  }
}

const describe = (value: unknown): string => {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const logger = new Logger();
