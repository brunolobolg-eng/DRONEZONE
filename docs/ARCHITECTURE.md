# Arquitetura

O Kyiv FPV é dividido em quatro camadas. A regra principal: **dependências só apontam para dentro**. O núcleo não conhece Three.js, DOM, Electron nem gameplay.

```
src/
├── core/          Camada A — simulação pura (TypeScript, sem DOM, sem Three.js)
├── gameplay/      Camada C — input, progressão, destruição, missão, sessão
├── rendering/     Camada B — Three.js: cena, câmera FPV, drone, cidade, terreno
├── ui/            Interface DOM (HUD, menus, telemetria de depuração)
├── audio/         Áudio sintetizado (WebAudio), sem arquivos
├── platform/      Camada D — navegador, Electron, armazenamento, logs, gamepad/teclado
└── app/           Montagem: laço principal (game.ts) e inicialização (main.ts)
electron/          Processo principal e preload do Electron (fora do bundle web)
```

## Camadas

| Camada | Pasta | Responsabilidade | Depende de |
|---|---|---|---|
| A — Núcleo | `src/core` | Física, controle, mixer, terreno (dados), telemetria | nada |
| C — Gameplay | `src/gameplay` | Mapeamento de controles, progressão, economia, destruição, missão, sessão | A |
| B — Renderização | `src/rendering`, `src/ui`, `src/audio` | Visual e interface: lêem o estado, nunca o alteram diretamente | A, C |
| D — Plataforma | `src/platform`, `src/app`, `electron/` | Inicialização, armazenamento, logs, tela cheia, Electron | todas |

Verificação prática: `src/core` não importa nada de `three`, `ui`, `platform` ou `gameplay`. Isso é checado por leitura de código, não por lint automático (ponto em aberto, ver `TEST_PLAN.md`).

## Fluxo de um quadro

1. `app/game.ts` mede o tempo real decorrido (limitado a 0,25 s) e lê os controles (`platform/input-sources.ts` → `gameplay/input/input-mapping.ts`).
2. Botões de pausa e telemetria são tratados aqui. Esc funciona mesmo em pausa.
3. Com o jogo ativo, `GameSession.frame()` processa armar/reiniciar, o failsafe de sinal e avança a física em passos fixos (`PhysicsWorld.advance`).
4. Eventos gerados pela física (impactos) viram eventos de sessão: crateras, dano a construções, fragmentos, missão.
5. A renderização lê a pose **interpolada** entre os dois últimos passos e os eventos da sessão. Não altera a simulação.
6. HUD e telemetria são atualizados a cada 100 ms.

## Estado e mutabilidade

- `DroneState` é imutável: cada passo cria um novo objeto. Isso facilita testes e depuração.
- O terreno (`Heightfield`) e os danos das construções são estado mutável, mas controlado pela sessão.
- A sessão é a única dona do progresso (saldo, peças, equipamento). Toda alteração chama `onSave`, que a plataforma persiste.

## Electron: modelo de segurança

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- Preload com API mínima (`window.kyivFpv`): `storage.read/write` e `log`. Nada de `ipcRenderer` genérico.
- Canais e chaves de armazenamento validados no processo principal (`electron/main.ts`). Só `save` e `settings` são aceitos. Valores têm limite de tamanho.
- O jogo é servido pelo protocolo `app://kyiv-fpv`, não por `file://`. Isso evita bloqueio de módulos ES por CORS e mantém o mesmo bundle do navegador.
- Navegação e novas janelas são bloqueadas; permissões são negadas, exceto tela cheia.
- O preload repete os nomes dos canais (modo sandbox não permite `require` local). `tests/unit/electron-contract.test.ts` garante que continuam iguais.

## Web vs. Electron

O mesmo código roda nas duas plataformas. As diferenças ficam restritas a `src/platform`:

| Recurso | Navegador | Electron |
|---|---|---|
| Armazenamento | `localStorage` (ou memória, se bloqueado) | arquivos em `userData/saves` (escrita atômica) |
| Logs | console | console + `userData/logs/app.log` |
| Carregamento | servidor estático (`dist/`) | `app://kyiv-fpv/` servido do `dist/` |
| Gamepad / teclado | iguais | iguais |

## Dependências

Runtime: `three` 0.186. Desenvolvimento: TypeScript 5.9, Vite 8, Vitest 5, Electron 44, electron-builder 26. Nenhum framework de UI.
