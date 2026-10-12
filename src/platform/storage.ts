import { desktopApi } from './desktop-bridge';
import { logger } from './logger';

/** Armazenamento chave-valor assíncrono. Nunca lança: falhas viram aviso e valor nulo. */
export interface KeyValueStorage {
  readonly kind: 'desktop' | 'local' | 'memory';
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<boolean>;
}

export const SAVE_KEY = 'save';
export const SETTINGS_KEY = 'settings';
const WEB_PREFIX = 'kyiv-fpv:';
const MAX_VALUE_LENGTH = 1_000_000;

class MemoryStorage implements KeyValueStorage {
  readonly kind = 'memory' as const;
  private readonly data = new Map<string, string>();

  async read(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async write(key: string, value: string): Promise<boolean> {
    if (value.length > MAX_VALUE_LENGTH) return false;
    this.data.set(key, value);
    return true;
  }
}

class LocalStorageKv implements KeyValueStorage {
  readonly kind = 'local' as const;

  constructor(private readonly store: Storage) {}

  async read(key: string): Promise<string | null> {
    try {
      return this.store.getItem(WEB_PREFIX + key);
    } catch (error) {
      logger.log('warn', 'localStorage indisponível para leitura', error);
      return null;
    }
  }

  async write(key: string, value: string): Promise<boolean> {
    if (value.length > MAX_VALUE_LENGTH) return false;
    try {
      this.store.setItem(WEB_PREFIX + key, value);
      return true;
    } catch (error) {
      logger.log('warn', 'não foi possível gravar localmente (cota ou modo privado)', error);
      return false;
    }
  }
}

class DesktopKv implements KeyValueStorage {
  readonly kind = 'desktop' as const;

  constructor(private readonly api: NonNullable<ReturnType<typeof desktopApi>>) {}

  async read(key: string): Promise<string | null> {
    try {
      return await this.api.storage.read(key);
    } catch (error) {
      logger.log('error', 'falha ao ler arquivo de salvamento', error);
      return null;
    }
  }

  async write(key: string, value: string): Promise<boolean> {
    if (value.length > MAX_VALUE_LENGTH) return false;
    try {
      await this.api.storage.write(key, value);
      return true;
    } catch (error) {
      logger.log('error', 'falha ao gravar arquivo de salvamento', error);
      return false;
    }
  }
}

/** Escolhe o melhor armazenamento disponível: arquivo no desktop, localStorage no navegador, memória como último recurso. */
export const createStorage = (): KeyValueStorage => {
  const api = desktopApi();
  if (api) return new DesktopKv(api);
  try {
    const probe = '__kyiv-fpv-probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return new LocalStorageKv(window.localStorage);
  } catch {
    logger.log('warn', 'localStorage bloqueado: o progresso ficará só nesta sessão');
    return new MemoryStorage();
  }
};
