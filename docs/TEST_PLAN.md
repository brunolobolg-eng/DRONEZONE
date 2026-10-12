# Plano de testes

## Como rodar

```bash
npm test              # Vitest: unitários e integração (sem navegador)
npm run typecheck     # TypeScript: web e Electron
npm run check         # typecheck + testes
```

## Automatizados (Vitest, 200 testes)

Ambiente `node`. Não há DOM nem WebGL nos testes: a lógica de jogo é testada sem renderização.

| Arquivo | O que cobre |
|---|---|
| `tests/unit/math.test.ts` | vetores, quaternions (rotação, composição, integração de taxa com 100 mil passos, slerp), curvas de entrada, zona morta, ruído determinístico |
| `tests/unit/control.test.ts` | acro (sinais e escala), controlador de taxa (ganho, limite, anti-windup), mixer (reprodução exata do torque, saturação, sentidos), armado, parâmetros inválidos |
| `tests/unit/physics.test.ts` | gravidade, arrasto, empuxo de hover, resposta do motor, limites dos motores, roll/pitch/yaw com sinais, taxa seguindo a referência, passo fixo em 100/200/250 Hz, independência do tamanho do quadro, pausa longa, reinicialização de entrada, interpolação, estabilidade (60 s com entradas aleatórias), impactos, colisões, colisor desativado, bateria |
| `tests/unit/roll-sign-regression.test.ts` | rolagem com acelerador alto e saturado, mesmo sinal da taxa |
| `tests/unit/terrain-telemetry.test.ts` | terreno (faixa plana, determinismo, crateras, rebaixo, anel de borda, limite de profundidade, acúmulo, registros limitados, reset), telemetria (ângulos, km/h, frações de motor, rolagem além de 90°) |
| `tests/unit/keyboard.test.ts` | teclas padrão e alternativas (WASD e setas, R/F, Shift/Ctrl, X), remapeamento e detecção de conflito, rótulos e dica da tela, corte do acelerador, rampa de suavização (subida, descida, 0 ms, sem ultrapassar o alvo), validação das teclas nas configurações |
| `tests/unit/failsafe.test.ts` | failsafe: teclado ocioso não dispara, desconexão do gamepad dispara em 1,5 s, teclado e reconexão cancelam |
| `tests/unit/gameplay-input.test.ts` | gamepad (zona morta, inversão, acelerador absoluto e com mola), resolução combinando gamepad e teclado, remapeamento, sensibilidade, desconexão e reconexão, bordas de botão, teclado, sanitização de configurações |
| `tests/unit/gameplay-progression.test.ts` | catálogo (validação), melhorias alterando a física (motores, bateria, quadro), comparação de fichas, compra e custos, reparo, salvamento (round trip, corrompido, versão futura, peças inválidas, saldo negativo) |
| `tests/unit/gameplay-destruction.test.ts` | estados de dano e monotonicidade, estrutura (distribuição, transmissão ao núcleo, piora em cadeia, cobertura), pool de fragmentos (limite, expiração, colisão com solo, determinismo), regras de impacto |
| `tests/unit/environment-mission.test.ts` | bairro (determinismo, casas fora da via, colisores, ponto de partida, ordem dos pontos), missão (ordem, conclusão, falha, reset) |
| `tests/unit/electron-contract.test.ts` | canais do preload iguais aos de `ipc.ts`; preload sem `ipcRenderer` genérico nem `fs`; validação de chaves no processo principal |
| `tests/integration/keyboard-flight.test.ts` | voo só com teclado pelo mesmo caminho do navegador: armar com Espaço, subir com R, cortar com X, rolar com D/A, seta direita como D, Backspace reinicia, teclado ocioso não desarma |
| `tests/integration/game-session.test.ts` | inicialização do jogo, ciclo de voo (armar, subir, reiniciar), impacto no solo gera cratera, colisão com casa gera dano, casa destruída desativa o colisor e o drone a atravessa, missão completa paga recompensa, crash falha a missão, compra, equipamento, reparo, persistência |

## Verificações manuais executadas

Registradas aqui com o que foi observado. Nada além disso foi testado.

| Verificação | Ambiente | Resultado |
|---|---|---|
| Carregamento no navegador | Chromium headless (SwiftShader), `vite preview` | Jogo inicia, HUD aparece, sem erros no console |
| Voo por teclado no navegador | CDP (Chromium): Espaço (armar), Shift (subir), D (rolar), Esc (pausar e retomar), Backspace (reiniciar) | Todos respondem. Altitude chegou a 25 m. Rolagem coerente com a telemetria |
| Failsafe de sinal | CDP, amostragem de HUD a cada 250 ms | Bug encontrado (desarme imediato ao armar) e corrigido. Verificado após a correção |
| Telemetria de rolagem | CDP, rolagem por 0,7 s | Bug encontrado (valor dobrado acima de 90°) e corrigido |
| Visual da câmera FPV | captura de tela | Hélices bloqueavam a lente; corrigido (tamanho e posição da câmera) |
| Electron: bundle | `electron .` sob Xvfb, renderização por software | Carrega por `app://`, inicia como "desktop" |
| Electron: ponte | CDP no processo do Electron | `window.kyivFpv` presente; Node não exposto ao renderer; gravar/ler funciona; chaves e valores inválidos recusados; arquivo escrito em `userData/saves` |
| Electron: empacotado (Linux) | `electron-builder --dir`, executado sob Xvfb | Pacote com `asar` contém `dist/` e `dist-electron/`; inicia |
| Electron: Windows | `electron-builder --win nsis` neste Linux | Pasta `win-unpacked` gerada. Instalador **não** concluído: falta Wine para a etapa final |

## Não testado (pendências)

- **Gamepad real**: o mapeamento padrão segue a Gamepad API "standard", mas nenhum controle físico foi usado. Testar com pelo menos um controle Xbox e um genérico, e ajustar os índices se necessário.
- **Desempenho com GPU real**: FPS, draw calls e memória (ver `PERFORMANCE.md`).
- **Instalador Windows**: gerar em Windows (ou com Wine instalado), instalar, abrir e verificar o desinstalador.
- **Perda de contexto WebGL**: o código recarrega a página, mas não foi provocado de propósito.
- **Tela cheia** (F11) no navegador e no Electron.
- **Áudio**: o zumbido e o ruído de impacto são sintetizados; não foram ouvidos nesta sessão.
- **Modo sem WebGL 2**: a mensagem de requisito foi exibida pelo caminho real do Electron sem GPU (confirmado no log), mas não foi comparado com um navegador antigo.
- **Física contra dados reais**: nenhuma validação com voo real. Ver `PHYSICS_MODEL.md`.

## Critério de aceite para as próximas fases

Cada alteração em `src/core` deve manter `npm run check` verde. Mudança de comportamento físico exige um teste novo que a descreva. Regressões encontradas em uso real devem ganhar teste antes da correção.
