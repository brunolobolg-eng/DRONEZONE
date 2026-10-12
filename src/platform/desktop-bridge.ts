/**
 * API mínima exposta pelo preload do Electron (ver electron/preload.ts).
 * O jogo nunca acessa o Node.js diretamente: só usa estes métodos.
 */
export interface DesktopApi {
  readonly platform: string;
  readonly versions: { readonly node: string; readonly chrome: string; readonly electron: string };
  storage: {
    read(key: string): Promise<string | null>;
    write(key: string, value: string): Promise<void>;
  };
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

declare global {
  interface Window {
    kyivFpv?: DesktopApi;
  }
}

/** Retorna a API do desktop, ou null quando o jogo roda no navegador. */
export const desktopApi = (): DesktopApi | null => {
  if (typeof window === 'undefined') return null;
  const api = window.kyivFpv;
  return api && typeof api.storage?.read === 'function' ? api : null;
};
