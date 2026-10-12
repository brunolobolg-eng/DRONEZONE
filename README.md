# Kyiv FPV (protótipo)

Simulador de voo FPV em primeira pessoa, com física própria de quadricóptero, bairro suburbano fictício inspirado na região de Kyiv, construções destrutíveis e terreno deformável. Roda no navegador (WebGL 2) e como aplicativo Windows com Electron.

> Nome provisório. Protótipo: não é um produto final. A física não foi validada com dados de voo reais.

## Requisitos

- Node.js 20.19+ ou 22.12+ (exigido pelo Vite 8)
- npm
- Navegador com WebGL 2, ou Electron (para o aplicativo desktop)
- Controle compatível com a Gamepad API (opcional: o teclado funciona)

## Instalação

```bash
npm install
```

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento web (http://localhost:5173) |
| `npm run build:web` | verificação de tipos e build de produção em `dist/` |
| `npm run preview` | serve o build de `dist/` localmente |
| `npm run build:electron` | compila o processo principal e o preload em `dist-electron/` |
| `npm start` | build web + build Electron + abre o aplicativo |
| `npm run dev:electron` | abre o Electron apontando para o servidor de desenvolvimento (rode `npm run dev` antes) |
| `npm run dist:dir` | pacote desktop sem instalador, em `release/` |
| `npm run dist:win` | instalador Windows (NSIS) em `release/`. Veja a observação abaixo |
| `npm test` | testes unitários e de integração (Vitest) |
| `npm run typecheck` | verificação de tipos dos projetos web e Electron |
| `npm run check` | `typecheck` + `test` |

**Windows**: `npm run dist:win` precisa de Wine quando executado em Linux. Nesta versão, o build Linux conseguiu gerar o pacote, mas a etapa final do instalador falhou sem Wine. Para gerar o instalador, rode no Windows. Veja `docs/TEST_PLAN.md`.

**Renderização por software**: em máquinas sem GPU, o Electron pode não oferecer WebGL 2. Para testes, defina `KYIV_FPV_SOFTWARE_GL=1` antes de iniciar.

## Como jogar

1. Abra o jogo. Você começa no ponto de partida, na via, com o drone desarmado.
2. **Espaço** arma o drone (só com o acelerador em zero). Suba com **Shift**.
3. Atravesse os quatro pontos de controle em ordem para concluir a missão.
4. **Esc** pausa e abre o menu: oficina (peças, comparação e reparo), configurações e telemetria.

Controles completos e layouts de gamepad: `docs/FLIGHT_CONTROLS.md`.

## Estrutura

```
src/
├── core/          simulação física, controle, mixer, terreno (sem DOM, sem Three.js)
├── gameplay/      input, progressão, economia, destruição, missão, sessão
├── rendering/     Three.js: cena, drone, câmera FPV, cidade, terreno
├── ui/            HUD, menus, telemetria de depuração
├── audio/         áudio sintetizado (sem arquivos)
├── platform/      navegador e Electron: armazenamento, logs, gamepad, teclado
└── app/           laço principal e inicialização
electron/          processo principal e preload do Electron
tests/             unitários e integração
docs/              arquitetura, física, controles, destruição, desempenho, testes
```

Dados versionados: `src/data/parts.json` (catálogo de peças, com `schemaVersion`).

## Documentação

- `docs/ARCHITECTURE.md`: camadas, fluxo de um quadro e modelo de segurança do Electron
- `docs/PHYSICS_MODEL.md`: referencial, unidades, convenções de sinal, motores, mixer, integração
- `docs/FLIGHT_CONTROLS.md`: modo Acro, entrada, layouts, failsafe
- `docs/DESTRUCTION_SYSTEM.md`: estados de dano, construções, terreno, fragmentos
- `docs/PERFORMANCE.md`: números medidos, decisões e pendências
- `docs/TEST_PLAN.md`: testes automatizados, verificações manuais e o que não foi testado

## Limitações conhecidas

- Física própria e simplificada, **não validada** contra voo real.
- Controles de gamepad com mapeamento padrão, **não testados** com hardware físico.
- Destruição por estados e peças predefinidas. Escombros são blocos simples.
- Terreno: a colisão usa a grade diretamente, sem recalcular a malha por setor.
- Instalador Windows não gerado neste ambiente (falta Wine).
- Sem assets baixados: sons e modelos são procedurais.
