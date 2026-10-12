import '../ui/styles.css';
import { DEFAULT_CATALOG } from '../gameplay/progression/catalog';
import { parseSave } from '../gameplay/progression/save-data';
import { sanitizeSettings, DEFAULT_SETTINGS, type GameSettings } from '../gameplay/settings';
import { detectCapabilities, unsupportedMessage } from '../platform/capabilities';
import { logger } from '../platform/logger';
import { SAVE_KEY, SETTINGS_KEY, createStorage, type KeyValueStorage } from '../platform/storage';
import { desktopApi } from '../platform/desktop-bridge';
import { el } from '../ui/dom';
import { Game } from './game';

/** Lê as configurações salvas. JSON corrompido vira aviso e configuração padrão. */
const loadSettings = async (storage: KeyValueStorage): Promise<GameSettings> => {
  const raw = await storage.read(SETTINGS_KEY);
  if (raw === null) return DEFAULT_SETTINGS;
  try {
    const { settings, warnings } = sanitizeSettings(JSON.parse(raw));
    for (const w of warnings) logger.log('warn', `configuração salva: ${w}`);
    return settings;
  } catch (error) {
    logger.log('warn', 'configurações salvas corrompidas: usando padrão', error);
    return DEFAULT_SETTINGS;
  }
};

const showFatal = (message: string): void => {
  const box = document.getElementById('fatal');
  if (!box) return;
  box.replaceChildren(el('h1', {}, ['Kyiv FPV']), el('p', {}, [message]));
  box.hidden = false;
  document.getElementById('game')?.setAttribute('hidden', '');
};

const boot = async (): Promise<void> => {
  logger.install(window);
  const caps = detectCapabilities();
  const problem = unsupportedMessage(caps);
  if (problem) {
    logger.log('error', 'requisito não atendido', problem);
    showFatal(problem);
    return;
  }

  const canvas = document.getElementById('game');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Elemento #game ausente no HTML');
  const storage = createStorage();
  const settings = await loadSettings(storage);

  const saveRaw = await storage.read(SAVE_KEY);
  const loaded = parseSave(saveRaw, DEFAULT_CATALOG);
  for (const w of loaded.warnings) logger.log('warn', `salvamento: ${w}`);
  const save = loaded.save;

  const game = new Game({
    canvas,
    storage,
    catalog: DEFAULT_CATALOG,
    save,
    settings,
    hudRoot: requireEl('hud'),
    telemetryRoot: requireEl('telemetry'),
    menuRoot: requireEl('menu-root'),
  });
  game.start();

  const mode = desktopApi() ? 'Electron' : 'navegador';
  logger.log('info', `Kyiv FPV iniciado no ${mode} (armazenamento: ${storage.kind})`);
};

const requireEl = (id: string): HTMLElement => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Elemento #${id} ausente no HTML`);
  return node;
};

boot().catch((error: unknown) => {
  logger.log('error', 'falha ao iniciar o jogo', error);
  showFatal('Não foi possível iniciar o jogo. Veja o console para detalhes.');
});
