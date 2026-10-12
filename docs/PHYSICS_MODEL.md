# Modelo físico

Modelo próprio de quadricóptero em TypeScript puro (`src/core/physics`). É simples, determinístico e testável. **Não há validação contra dados de referência de drones reais**, então o modelo não deve ser descrito como fisicamente realista.

## Referencial e unidades

- **Mundo**: sistema direito, Y para cima. X e Z formam o plano do solo. Mesma convenção do Three.js, então não há conversão na renderização.
- **Corpo**: `x` aponta para frente (nariz), `y` para cima do drone, `z` para a direita. Em orientação identidade, o corpo coincide com o mundo.
- **Orientação**: quaternion `q` que leva vetores do corpo para o mundo (`v_mundo = q ⊗ v_corpo ⊗ q*`).
- **Unidades SI**: metros, segundos, kg, newtons, N·m, rad. Ângulos mostrados na telemetria são em graus.

### Convenções de sinal

| Grandeza | Eixo | Positivo significa |
|---|---|---|
| Rolagem (`roll`) | X | asa direita para baixo |
| Arfagem (`pitch`) | Z | nariz para cima |
| Guinada (`yaw`) | Y | esquerda (anti-horário visto de cima) |

Na entrada do piloto, `yaw` positivo é **direita**. Por isso `acroSetpoint` converte a guinada à direita em taxa negativa no eixo Y. A telemetria mostra `yaw` em °/s com o sinal invertido, para que direita seja positivo.

Rumo (`headingDeg`): 0° é o eixo +X do mundo, 90° é +Z. Guinar à direita aumenta o rumo.

## Motores

Configuração em X, distância `armLength` do centro. Ordem dos índices:

| Índice | Nome | Posição (x, z) | Sentido |
|---|---|---|---|
| 0 | frente-direita | (+a, +a) | +1 |
| 1 | frente-esquerda | (+a, -a) | -1 |
| 2 | traseira-direita | (-a, +a) | -1 |
| 3 | traseira-esquerda | (-a, -a) | +1 |

`a = armLength / √2`. Os sentidos alternados fazem os torques de reação se cancelarem em equilíbrio.

**Resposta do motor**: primeira ordem com constante `responseTime`. O passo é exato: `f += (f_cmd - f) · (1 - e^(-dt/τ))`. Limitado entre 0 e o empuxo máximo efetivo.

**Empuxo máximo efetivo**: `maxThrust · eficiência · fator_bateria`, com `fator_bateria = 0,55 + 0,45 · (energia_restante / capacidade)`. Simula queda de tensão sob carga, de forma simplificada.

## Forças e torques

Para os empuxos `T_i` (N):

- Empuxo total: `T = Σ T_i`, na direção `+Y` do corpo.
- Torque de rolagem: `τ_x = -Σ z_i · T_i`.
- Torque de arfagem: `τ_z = Σ x_i · T_i`.
- Torque de guinada (reação da hélice): `τ_y = -Σ s_i · k_Q · T_i`, com `k_Q = yawTorqueCoeff`.
- Amortecimento angular: `-c · ω`, com `c = angularDamping`.

**Translação**, no mundo:

`F = R·(0, T, 0) + F_arrasto + (0, -m·g, 0)`, com `F_arrasto = -(k_lin · v_rel + k_quad · |v_rel| · v_rel)` e `v_rel = v - v_vento`.

**Rotação**, no corpo, com termo giroscópico:

`ω̇ = I⁻¹ (τ - ω × (I·ω) - c·ω)`, com `I = diag(Ixx, Iyy, Izz)`.

## Integração temporal

- **Passo fixo** de `1/fixedHz` (100, 200 ou 250 Hz). O acumulador de tempo guarda o resto entre quadros.
- **Semi-implícito**: velocidade angular, depois velocidade linear, depois posição, depois orientação.
- **Orientação**: incremento exato de eixo-ângulo, `q ← q ⊗ exp(ω·dt)`, com normalização. Mantém o quaternion unitário mesmo com taxas altas. Testado com 100 mil passos.
- **Limite por quadro**: no máximo 0,1 s de simulação por quadro. O excedente é descartado e contabilizado em `droppedSeconds`. Uma aba suspensa não acumula segundos.
- **Limite de passos por quadro**: 50, como proteção extra.
- **Interpolação visual**: a renderização usa `slerp` (orientação) e lerp (posição) entre os dois últimos passos, com fração `alpha = acumulador / dt`.

## Mixer

`mixQuad(T, τ)` resolve os quatro motores a partir de empuxo total e três torques, com `d1 = -τ_x/a`, `d2 = τ_z/a`, `d3 = τ_y/k_Q`:

- Motor i = `T/4 + att_i`, com `att_FR = (d1 + d2 - d3)/4`, `att_FL = (-d1 + d2 + d3)/4`, `att_BR = (d1 - d2 + d3)/4`, `att_BL = (-d1 - d2 - d3)/4`.
- **Prioridade da atitude**: se a parte de atitude não cabe em `[0, Tmax]`, ela é reduzida proporcionalmente, e o coletivo é limitado para caber. Assim o torque pedido é preservado e o empuxo total cai.
- O resultado `saturated` marca quando isso acontece. A telemetria mostra "Motores no limite".

Testes confirmam que, sem saturação, `computeActuation(mixQuad(T, τ))` reproduz `T` e `τ` com erro menor que 1e-9.

## Controle de taxa

PI por eixo sobre o erro de velocidade angular:

`torque_eixo = I_eixo · (kp · erro + ki · ∫erro)`, limitado ao torque máximo do eixo e com integral limitado (anti-windup).

Ganhos padrão: `kp = 18 s⁻¹`, `ki = 4 s⁻²`, limite do integral 2 rad/s. Multiplicar pela inércia faz o mesmo ganho valer para eixos diferentes. Não há termo derivativo nesta versão.

## Colisões

- **Esfera do drone**, raio `radius`, contra caixas alinhadas (`sphereVsAabb`). Ao sobrepor, o drone é empurrado pela normal, e a velocidade normal é refletida com restituição 0,2 (fator 0,9 na tangencial).
- **Solo**: a altura vem da grade de terreno (interpolação bilinear). Quique com restituição 0,2 e um limiar de repouso de 0,05 m/s. Atrito horizontal exponencial e amortecimento angular enquanto em contato.
- **Eventos**: impactos com velocidade normal ≥ 0,8 m/s geram `ImpactEvent` com ponto, normal, velocidade e dano.

**Limitações conhecidas**: contatos são resolvidos um colisor por vez (sem iteração). O drone não colide com telhados inclinados (o colisor da casa é a caixa das paredes). Não há atrito realista em contato com o solo, só uma aproximação.

## Dano e energia

- **Integridade**: `dano = max(0, v_impacto - impactTolerance) · impactDamagePerSpeed`. Integridade ≤ 0 leva ao estado `crashed`, que bloqueia o armado até reiniciar o voo.
- **Bateria**: potência elétrica `P = T_total · powerPerNewton`, com `powerPerNewton = 26 W/N` na configuração base. Energia restante em Wh.

## Parâmetros padrão (`DEFAULT_DRONE_PARAMS`)

| Parâmetro | Valor | Observação |
|---|---|---|
| massa | 0,62 kg | com bateria |
| braço | 0,11 m | centro até motor |
| inércia (x, y, z) | 0,004; 0,0075; 0,004 kg·m² | valores de ordem de grandeza |
| empuxo máximo por motor | 7 N | empuxo/peso ≈ 4,5:1 |
| resposta do motor | 35 ms | constante de tempo |
| arrasto | 0,02 N·s/m e 0,024 N·s²/m² | |
| raio de colisão | 0,14 m | |
| acelerador de hover | ≈ 0,217 | `mg / (4·Tmax)` |

Os valores são plausíveis para um quadro de 5 polegadas, mas **não foram medidos**. Ajustar exige dados de referência.

## O que o modelo não faz

- Não modela RPM, hélices como disco, efeito solo, ar induzido ou efeito de vórtice.
- Não há ruído de sensor, atraso de comunicação ou falha de motor.
- Não há validação contra voo real. Qualquer afirmação de realismo precisa de dados de referência.
