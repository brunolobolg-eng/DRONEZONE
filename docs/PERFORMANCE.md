# Desempenho

Esta página separa o que foi **medido** do que é **estimativa ou plano**. Números de navegador feitos com renderização por software não representam uma GPU real.

## Medido

Ambiente: Node 22 no container de desenvolvimento, sem GPU. Medição de `GameSession.frame` com um drone em voo de 10 s simulados, em quadros de 1/60 s.

| Frequência do passo | Passos | Tempo total | Por passo | Por quadro de 60 FPS |
|---|---|---|---|---|
| 100 Hz | 1000 | 61,6 ms | 61,7 µs (inclui aquecimento do JIT) | 0,10 ms |
| 200 Hz | 2000 | 40,3 ms | 20,2 µs | 0,07 ms |
| 250 Hz | 2500 | 34,8 ms | 13,9 µs | 0,06 ms |

Terreno: 200 impactos com crateras, 31 ms no total (~0,15 ms por cratera, incluindo a atualização do `DirtyRect`).

Bundle web de produção (`vite build`): `index.js` de 618 KB (162 KB gzip), com o `three` importado como namespace inteiro. Importações nomeadas podem reduzir esse valor; não foi medido.

Leitura: a física e a sessão custam pouco. O gargalo provável de um navegador real é a renderização (draw calls, pixels e sombras), não a simulação.

## Renderização no navegador (sem GPU real)

No Chromium headless com SwiftShader (renderização por software), o jogo roda, o HUD atualiza e os controles respondem. **A taxa de quadros medida assim não é representativa.** Uma medição real exige um computador com GPU.

## Decisões de desempenho implementadas

- **Passo fixo com acumulador**: a física não depende da taxa de quadros. O tempo por quadro é limitado a 0,1 s, então uma queda de FPS ou uma aba suspensa não causam explosão de simulação.
- **Instancing**: janelas, escombros, fragmentos, árvores (tronco e copa) e as faixas da via são `InstancedMesh`.
- **Mesclagem**: cercas viram uma única malha (`mergeGeometries`).
- **Material compartilhado**: materiais são reaproveitados pela cor (`MaterialCache`). Exceção: material por casa, para o escurecimento por dano.
- **Atualização parcial do terreno**: uma cratera reescreve só os vértices do seu retângulo alterado.
- **Pool de fragmentos**: capacidade fixa, sem alocação durante o jogo. Fragmentos são removidos ao expirar ou ao ficar longe do drone.
- **Presets de qualidade**: resolução (`pixelRatio` até 0,75, 1,25 ou 2), sombras (desligadas ou 1024/2048), antialiasing, capacidade de fragmentos e distância da névoa.
- **Sem Web Workers**: a física de um drone a 250 Hz custa menos de 0,1 ms por quadro, e a geração do bairro é feita uma vez. Um worker adicionaria custo de comunicação maior que o ganho. Reavaliar se a física ganhar múltiplos drones ou o terreno crescer.

## Orçamento de referência (plano, não medido)

| Item | Alvo |
|---|---|
| Quadro na tela | 16,6 ms (60 FPS) em GPU integrada moderna, qualidade média |
| Simulação por quadro | < 1 ms |
| Draw calls | ~40 (estimado para o bairro atual) |
| Fragmentos ativos | ≤ capacidade do preset (60 / 120 / 160) |
| Memória de geometria | ainda não medida |

## Pendências

- Medir FPS, draw calls e memória com GPU real (ver `TEST_PLAN.md`).
- Reduzir o bundle com importações nomeadas do Three.js.
- Níveis de detalhe para árvores e casas distantes (não implementados).
- Frustum culling por setor da cidade (o culling por mesh já é feito pelo Three.js).
