import { contextBridge, ipcRenderer } from 'electron';

/**
 * Ponte mínima entre o jogo e o processo principal. O renderer recebe só estas funções:
 * nada de Node.js, nada de ipcRenderer genérico, nenhum canal arbitrário.
 *
 * Os nomes dos canais são repetidos aqui de propósito: o preload roda em modo sandbox,
 * que não permite require de arquivos locais. tests/unit/electron-contract.test.ts
 * garante que estes valores continuam iguais aos de ipc.ts.
 */
const CHANNELS = {
  read: 'storage:read',
  write: 'storage:write',
  log: 'log:write',
} as const;

contextBridge.exposeInMainWorld('kyivFpv', {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  storage: {
    read: (key: string): Promise<string | null> => ipcRenderer.invoke(CHANNELS.read, key),
    write: (key: string, value: string): Promise<void> => ipcRenderer.invoke(CHANNELS.write, key, value),
  },
  log: (level: 'info' | 'warn' | 'error', message: string): void => {
    ipcRenderer.send(CHANNELS.log, level, message);
  },
});
