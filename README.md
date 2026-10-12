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

Para o instalador Windows, veja a seção [Gerar o instalador Windows](#gerar-o-instalador-windows).

**Renderização por software**: em máquinas sem GPU, o Electron pode não oferecer WebGL 2. Para testes, defina `KYIV_FPV_SOFTWARE_GL=1` antes de iniciar.

## Como jogar

O teclado é o controle principal. Você começa no ponto de partida, na via, com o drone desarmado.

| Tecla | Ação |
|---|---|
| **A / D** (ou ← / →) | rolar |
| **W / S** (ou ↑ / ↓) | nariz para baixo / para cima |
| **Q / E** | guinar |
| **R / F** (ou Shift / Ctrl esq.) | acelerador: sobe / desce |
| **X** | cortar o acelerador |
| **Espaço** | armar / desarmar (só com o acelerador em zero) |
| **Backspace** | reiniciar o voo |
| **Esc** | pausar e abrir o menu (oficina, configurações, telemetria) |
| **Tab** | telemetria de depuração |

Teclas podem ser trocadas em **Configurações > Teclado**: clique em "Alterar" e pressione a nova tecla. A dica na parte de baixo da tela mostra as teclas atuais.

Ponto de controle: atravesse os quatro anéis, em ordem, para concluir a missão. Gamepad também funciona (ver `docs/FLIGHT_CONTROLS.md`).

## Gerar o instalador Windows

### Opção 1: GitHub Actions (não precisa de Windows)

O repositório tem o workflow `.github/workflows/windows-installer.yml`, que roda num Windows real.

1. Envie o código para o GitHub (o branch que você quer gerar).
2. Abra a aba **Actions** > **Instalador Windows** > **Run workflow** e escolha o branch.
3. Quando terminar (cerca de 5 a 10 minutos), abra a execução e baixe o artefato **kyiv-fpv-instalador-windows**. Ele contém `Kyiv FPV Setup 0.1.0.exe` e `instalar.bat`. Extraia o `.zip` e execute o `instalar.bat`: ele abre o instalador. Os dois arquivos precisam estar na mesma pasta.

Para gerar um instalador de uma versão marcada, crie uma tag (`git tag v0.1.0 && git push origin v0.1.0`). O workflow também roda nas tags `v*`.

### Opção 2: num computador Windows

Pré-requisitos: Node.js 22 LTS e Git.

```powershell
git clone <url-do-repositório>
cd DRONEZONE
git checkout claude/gallant-hopper-6gp88y
npm ci
npm run check
npm run dist:win
```

O instalador fica em `release\Kyiv FPV Setup 0.1.0.exe`.

### Observações

- **Aviso do Windows**: sem certificado de assinatura de código, o SmartScreen mostra "editor desconhecido". Escolha "Mais informações" > "Executar assim mesmo". Remover esse aviso exige um certificado de assinatura, que é pago.
- **Ícone e metadados**: são aplicados ao `.exe` só quando o build roda em Windows (a edição usa `rcedit`, nativo do Windows).
- **Linux**: `npm run dist:win` não gera o instalador aqui, porque o NSIS depende de Wine funcional neste ambiente. Use `npm run dist:dir` para uma pasta pronta para testes.
- **Antes de distribuir**: troque `appId` e o nome do autor em `electron-builder.js` e `package.json`.

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
- Teclado testado no navegador (Chromium) e no Electron; o instalador Windows ainda precisa ser executado num Windows real.
- Destruição por estados e peças predefinidas. Escombros são blocos simples.
- Terreno: a colisão usa a grade diretamente, sem recalcular a malha por setor.
- Instalador Windows: gerado pelo GitHub Actions ou num Windows; não foi possível gerá-lo neste Linux (ver seção acima).
- Sem assets baixados: sons e modelos são procedurais.
