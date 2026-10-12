# Controles de voo

## Modo Acro

O único modo nesta versão. Os comandos de roll, pitch e yaw são **referências de velocidade angular**, não ângulos. Sem entrada, o drone mantém a atitude atual: não há nivelamento automático. Estabilização é um modo futuro, que reutilizará o mesmo núcleo.

Fluxo: entrada do piloto → referência de taxa (`acroSetpoint`) → controlador de taxa (`RateController`) → mixer (`mixQuad`) → motores.

### Curva de resposta

Para cada eixo, com entrada `x` em [-1, 1] e expo `e` em [0, 1]:

`saída = (1 - e)·x + e·x³`

Com `e = 0`, a resposta é linear. Com `e = 1`, é suave no centro.

### Taxas máximas (padrão)

| Eixo | Taxa máxima |
|---|---|
| Rolagem | 8,7 rad/s (~500 °/s) |
| Arfagem | 8,7 rad/s (~500 °/s) |
| Guinada | 5,2 rad/s (~300 °/s) |

A sensibilidade global multiplica todas as taxas, entre 0,25 e 2.

## Entrada

### Zona morta

`zona morta` remove o ruído perto do centro e reescalona o resto para continuar indo de 0 a ±1:

`saída = sinal(x) · (|x| - dz) / (1 - dz)`, e zero se `|x| ≤ dz`.

Padrão: 0,06. Limite: 0,3.

### Inversão

Cada eixo pode ser invertido em `axes[eixo].invert`. A inversão é aplicada antes da zona morta.

### Acelerador

- **Absoluto** (padrão): o stick define a potência. Stick para cima = 100%. Solto em cima, a potência fica onde estiver se for teclado.
- **Com mola**: o stick define a *velocidade de variação*. Solto, o acelerador mantém a posição. Útil com sticks de mola (a maioria dos gamepads).

Com teclado, o acelerador é sempre integrado: Shift sobe, Ctrl desce, e a posição é mantida ao soltar.

### Layouts

| Layout | Stick esquerdo | Stick direito |
|---|---|---|
| Modo 2 (padrão) | guinada e acelerador | rolagem e arfagem |
| Modo 1 | arfagem e guinada | acelerador e rolagem |

Os índices de eixo e os botões podem ser alterados. Os valores padrão seguem o mapeamento "standard" da Gamepad API. **Não foram testados com controles reais** (ver `TEST_PLAN.md`).

### Gamepad e teclado

Se os dois estão ativos, cada controle usa a fonte com **maior deflexão**. Assim, um deles nunca anula o outro.

| Ação | Gamepad (padrão) | Teclado |
|---|---|---|
| Rolagem | eixo direito, horizontal | A / D |
| Arfagem | eixo direito, vertical | W (nariz para baixo) / S (nariz para cima) |
| Guinada | eixo esquerdo, horizontal | Q (esquerda) / E (direita) |
| Acelerador | eixo esquerdo, vertical | Shift (sobe) / Ctrl (desce) |
| Armar / desarmar | botão A (0) | Espaço |
| Reiniciar voo | botão Y (3) | Backspace |
| Pausar | Start (9) | Esc |
| Telemetria | Back (8) | Tab |

Os botões são registrados por borda de subida (`ButtonEdges`): um pressionamento gera um evento, mesmo que o botão continue apertado. O teclado usa "trava" de botões: um toque curto entre dois quadros não se perde.

### Armar

- Só arma com acelerador em no máximo 5%. Isso evita motores girando sem querer.
- Desarma com um novo pulso do botão.
- Após um crash, não arma até reiniciar o voo.

### Failsafe de sinal

Quando um gamepad em uso desconecta, e o jogador não usa o teclado, o drone é desarmado após **1,5 s sem nenhuma entrada**.

Teclado ocioso **não** dispara o failsafe: sem tecla pressionada, a entrada é neutra. Antes desta regra estar correta, o failsafe disparava para qualquer jogador com teclado, logo após armar. Testes em `tests/unit/failsafe.test.ts`.

### Pausa e foco

- Esc alterna pausa. Pausado, a simulação para e o menu abre.
- Perder o foco da janela (blur ou aba oculta) pausa o jogo. Ao voltar, o jogador retoma manualmente.
- A entrada não é processada em pausa. Ao retomar, nenhuma tecla "fantasma" continua ativa.

## Telemetria

Mostrada no HUD: velocidade, altitude (sobre o solo), pitch, roll, rumo, bateria, integridade, estado, saldo e equipamento.

O painel de depuração (Tab ou configuração) mostra o que o núcleo produz: taxa de passos, tempo de simulação por quadro, FPS de renderização, empuxo de cada motor, potência, taxas angulares, saturação do mixer e construções. Ele é independente do HUD.

### Rolagem

Calculada com `atan2`, no intervalo de -180° a 180°. Com `asin`, o valor dobraria acima de 90° (no modo Acro o drone pode girar além disso, e o valor ficaria errado). Corrigido e coberto por teste.
