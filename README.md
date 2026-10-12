# DroneZone

Jogo de drones desenvolvido com [Electron](https://www.electronjs.org/).

## Requisitos

- Node.js 18 ou superior
- npm

## Como rodar

```bash
npm install
npm start
```

## Verificação de sintaxe

```bash
npm run check
```

## Estrutura

```
src/
├── main.js        # Processo principal: cria a janela e controla o ciclo de vida do app
├── preload.js     # Ponte segura (contextBridge) entre o renderer e o processo principal
├── renderer.js    # Lógica do jogo rodando na janela (canvas)
├── index.html     # Página carregada pela janela
└── styles.css     # Estilos da página
```

## Segurança

A janela roda com `contextIsolation`, `sandbox` e sem `nodeIntegration`. O renderer não
acessa APIs do Node diretamente: qualquer funcionalidade nova deve ser exposta por
`src/preload.js`, com a menor superfície possível.
