const { contextBridge } = require('electron');

// Ponte mínima entre o processo de renderização e o principal.
// Novas APIs devem ser expostas aqui, nunca dando acesso direto ao Node no renderer.
contextBridge.exposeInMainWorld('dronezone', {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
});
