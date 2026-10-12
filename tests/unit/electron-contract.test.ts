import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * O preload repete os nomes dos canais porque roda em modo sandbox (sem require local).
 * Este teste garante que a cópia continua igual à fonte única em electron/ipc.ts.
 */
const root = resolve(__dirname, '..', '..');
const ipcSource = readFileSync(resolve(root, 'electron/ipc.ts'), 'utf8');
const preloadSource = readFileSync(resolve(root, 'electron/preload.ts'), 'utf8');

const channelsIn = (source: string): Record<string, string> => {
  const block = source.match(/CHANNELS\s*=\s*\{([\s\S]*?)\}/);
  if (!block) throw new Error('bloco CHANNELS não encontrado');
  const out: Record<string, string> = {};
  for (const m of block[1].matchAll(/(\w+):\s*'([^']+)'/g)) out[m[1]] = m[2];
  return out;
};

describe('contrato Electron', () => {
  it('canais do preload são idênticos aos de ipc.ts', () => {
    expect(channelsIn(preloadSource)).toEqual(channelsIn(ipcSource));
  });

  it('preload não expõe ipcRenderer genérico nem Node diretamente', () => {
    expect(preloadSource).not.toMatch(/exposeInMainWorld\(\s*'[^']+',\s*ipcRenderer\s*\)/);
    expect(preloadSource).not.toMatch(/require\(\s*'fs'\s*\)/);
    expect(preloadSource).not.toMatch(/require\(\s*'node:fs'\s*\)/);
  });

  it('o processo principal só aceita chaves de armazenamento da lista permitida', () => {
    const mainSource = readFileSync(resolve(root, 'electron/main.ts'), 'utf8');
    expect(mainSource).toMatch(/STORAGE_KEYS\.has\(key\)/);
    expect(mainSource).toMatch(/isInside\(DIST_DIR, file\)/);
  });
});
