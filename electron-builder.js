/**
 * Configuração do electron-builder (empacotamento e instalador).
 *
 * Gerar o instalador Windows:
 *   - Em Windows: `npm run dist:win` (gera release/Kyiv FPV Setup <versão>.exe)
 *   - Em Linux: `npm run dist:win` também funciona, mas a edição do .exe (ícone e metadados) exige Wine.
 *     Por isso ela só fica ligada quando o build roda em Windows.
 */
const runningOnWindows = process.platform === 'win32';

module.exports = {
  appId: 'com.example.kyivfpv',
  productName: 'Kyiv FPV',
  directories: { output: 'release' },
  files: ['dist/**/*', 'dist-electron/**/*', 'package.json'],
  asar: true,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    signAndEditExecutable: runningOnWindows,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Kyiv FPV',
    uninstallDisplayName: 'Kyiv FPV',
  },
};
