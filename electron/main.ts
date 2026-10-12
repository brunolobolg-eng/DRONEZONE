import { app, BrowserWindow, Menu, ipcMain, net, protocol, session } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_HOST, APP_SCHEME, CHANNELS, LOG_LEVELS, MAX_LOG_CHARS, MAX_STORAGE_CHARS, STORAGE_KEYS } from './ipc';

/** Pasta com o build web (gerado por `npm run build:web`). */
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const LOG_LIMIT_BYTES = 1_000_000;

// Renderização por software (SwiftShader), só para máquinas e testes sem GPU.
// Ativada explicitamente por KYIV_FPV_SOFTWARE_GL=1: o padrão continua usando a GPU.
if (process.env.KYIV_FPV_SOFTWARE_GL === '1') {
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
}

// O protocolo app:// é tratado como origem segura e padrão. Assim os módulos ES do Vite funcionam
// sem depender de file:// (que bloqueia módulos por CORS no Chromium).
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const isInside = (parent: string, child: string): boolean => child === parent || child.startsWith(parent + path.sep);

const serveDist = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  if (url.host !== APP_HOST) return new Response('não encontrado', { status: 404 });
  const rel = decodeURIComponent(url.pathname) === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
  const file = path.resolve(DIST_DIR, rel);
  if (!isInside(DIST_DIR, file)) return new Response('proibido', { status: 403 });
  return net.fetch(pathToFileURL(file).toString());
};

const savesDir = (): string => path.join(app.getPath('userData'), 'saves');

/** Escrita atômica: grava em arquivo temporário e troca no lugar. Um corte de energia não deixa arquivo pela metade. */
const writeAtomic = async (target: string, content: string): Promise<void> => {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, target);
};

const registerIpc = (): void => {
  ipcMain.handle(CHANNELS.read, async (_event, key: unknown) => {
    if (typeof key !== 'string' || !STORAGE_KEYS.has(key)) throw new Error('chave de armazenamento não permitida');
    try {
      return await fs.readFile(path.join(savesDir(), `${key}.json`), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  });

  ipcMain.handle(CHANNELS.write, async (_event, key: unknown, value: unknown) => {
    if (typeof key !== 'string' || !STORAGE_KEYS.has(key)) throw new Error('chave de armazenamento não permitida');
    if (typeof value !== 'string' || value.length > MAX_STORAGE_CHARS) throw new Error('valor de armazenamento inválido');
    await writeAtomic(path.join(savesDir(), `${key}.json`), value);
  });

  ipcMain.on(CHANNELS.log, (_event, level: unknown, message: unknown) => {
    if (typeof level !== 'string' || !(LOG_LEVELS as readonly string[]).includes(level)) return;
    if (typeof message !== 'string') return;
    const text = message.slice(0, MAX_LOG_CHARS);
    const line = `${new Date().toISOString()} [${level}] ${text}\n`;
    void appendLog(line);
  });
};

/** Log em arquivo, com limite de tamanho: ao passar do limite, começa um arquivo novo. */
const appendLog = async (line: string): Promise<void> => {
  const dir = path.join(app.getPath('userData'), 'logs');
  const file = path.join(dir, 'app.log');
  try {
    await fs.mkdir(dir, { recursive: true });
    const stat = await fs.stat(file).catch(() => null);
    if (stat && stat.size > LOG_LIMIT_BYTES) await fs.rename(file, `${file}.old`);
    await fs.appendFile(file, line, 'utf8');
  } catch {
    // Falha de log nunca deve derrubar o aplicativo.
  }
};

const createWindow = (): BrowserWindow => {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    title: 'Kyiv FPV (protótipo)',
    backgroundColor: '#0b1020',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
    },
  });

  win.once('ready-to-show', () => win.show());
  // Nenhuma janela nova e nenhuma navegação para fora do aplicativo.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault();
  });

  const devUrl = process.env.KYIV_FPV_DEV_URL;
  if (devUrl && !app.isPackaged) {
    void win.loadURL(devUrl);
  } else {
    void win.loadURL(`${APP_ORIGIN}/index.html`);
  }
  return win;
};

// Uma única instância: abrir de novo traz a janela existente para frente.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    protocol.handle(APP_SCHEME, serveDist);
    Menu.setApplicationMenu(null);

    // Só tela cheia é concedida; câmera, microfone, notificações e geolocalização são negados.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'fullscreen');
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');

    registerIpc();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
