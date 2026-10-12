# Sistema de destruição

A destruição é descrita por **estados de dano** e **peças predefinidas**. Não há fratura dinâmica de malhas. Todos os valores são fictícios e calibrados para a jogabilidade. Não há parâmetros de armamento real.

## Estados de dano

Cada peça tem vida máxima e vida atual. A fração restante define o estado:

| Estado | Fração de vida |
|---|---|
| intacto | acima de 70% |
| danificado | até 70% |
| grave | até 30% |
| destruído | 0 |

A transição é **monotônica**: nada volta a ser intacto. Peça destruída não recebe mais transições. `damage-state.ts`.

## Construções

Cada casa é uma `Structure`: um conjunto de peças com vida e posição local.

| Tipo | Peças | Vida |
|---|---|---|
| estrutural | núcleo | 220 |
| fachada | 4 faces | 90 cada |
| cobertura | telhado | 70 |
| porta | porta | 40 |
| janela | até 16 janelas | 18 cada |

Estado da construção, derivado das peças:

- Peça estrutural destruída → **construção destruída**.
- Peça estrutural grave, ou cobertura destruída → **grave**.
- Qualquer outra peça danificada → **danificada**.

A descrição de uma casa nova é uma lista de `ComponentSpec`. Nenhum script específico é necessário.

### Distribuição de dano

Um impacto de dano `D` é dividido em duas partes:

- **35%** (`STRUCTURAL_TRANSMISSION`) vai a **todas** as peças estruturais, dividido igualmente. Representa a carga que atravessa a construção.
- **65%** fica nas **três peças mais próximas** do ponto de impacto, com peso `1 / (1 + distância)`.

Sem a parte transmitida, impactos nas fachadas nunca chegariam ao núcleo, e a casa nunca seria destruída pelo lado de fora. Isso foi corrigido durante a implementação, com teste.

### Colisor

A construção tem um colisor (`<id>:body`). Ao ser destruída, o colisor é **desativado**: o drone atravessa o local. O evento `collider-off` informa a camada visual.

Telhados não têm colisor. O colisor é a caixa das paredes, até a altura do beiral.

## Impactos

Eventos de impacto (vindos da física) são convertidos por `impact-rules.ts`:

| Evento | Regra |
|---|---|
| Solo, velocidade ≥ 3 m/s | cratera com raio `0,8 + 0,12·v` (limitado a 1–3,2 m) e profundidade `0,08 + 0,035·v` (limitada a 0,1–0,9 m) |
| Colisor de construção | dano de estrutura `10 · (v - 1)` |
| Qualquer impacto acima de 1 m/s | fragmentos: `2·v` (até 24) |

Fragmentos extras são gerados quando a construção é destruída.

## Terreno deformável

- **Dados** (`core/terrain/heightfield.ts`): grade de alturas, materiais por vértice e registros de crateras. Não conhece Three.js.
- **Visual** (`rendering/scene/terrain-mesh.ts`): lê a grade. Cada cratera gera um retângulo alterado (`DirtyRect`), e só esses vértices são reescritos. As normais são recalculadas na malha inteira, que é barata para esta grade.
- **Forma da cratera**: raio variável com o ângulo (ruído de valor), para bordas irregulares. Bowl parabólico no centro e anel elevado na borda.
- **Profundidade limitada**: `maxCraterDepth` (1,2 m). Crateras sobrepostas acumulam até esse limite.
- **Materiais**: solo (0), solo revolvido no centro (1), borda exposta (2). Usados na cor do vértice.
- **Registros**: até 40. Além disso, os mais antigos são descartados, mas as células continuam alteradas.

**Limitação**: a colisão do drone usa a grade diretamente, não a malha. Visual e física são consistentes, mas a malha não é recalculada em partes. Uma grade maior exigiria atualização por setores.

## Fragmentos

`FragmentPool` (pura) tem capacidade fixa. Nenhum objeto é criado depois da construção.

- Capacidade: 60 (baixa), 120 (média), 160 (alta), conforme a qualidade.
- Quando a capacidade acaba, o fragmento **mais antigo** é reciclado. O número de ativos nunca passa do limite (testado com 200 rajadas).
- Vida: 4 s (com variação). Fragmentos são removidos ao expirar ou ao ficar mais de 120 m do drone.
- Física simples: balística, quique no solo com restituição 0,3.

Na visualização, todos os fragmentos são um único `InstancedMesh`.

## Janelas e escombros

- **Janelas**: um único `InstancedMesh` para o bairro inteiro. Janela destruída é ocultada com escala zero. Uma casa destruída oculta todas as suas janelas.
- **Escombros**: 14 pedaços por casa, num `InstancedMesh`. Aparecem quando a casa é destruída, no lugar da casa.
- **Estados visuais**: danificada e grave escurecem a parede (material próprio por casa, para que uma casa não altere as outras). Grave remove o telhado. Destruída mostra os escombros.

**Limitação**: os escombros são blocos simples, não fragmentos das peças.

## Desempenho e limites

- Fragmentos: limitados pela capacidade do pool.
- Objetos físicos: apenas o drone e os colisores estáticos. A destruição não cria corpos físicos.
- Meshes: não há uma malha por janela, nem por fragmento.
- Estado de destruição: persiste durante a sessão. "Reiniciar o voo" não restaura as construções. Uma nova sessão (novo carregamento) começa com o bairro intacto.
