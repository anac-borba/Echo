# Animações do Echo

Como o Echo se mexe, por quê, e como conferir quadro a quadro com o ffmpeg.
O modelo é o iPhone e o app do Claude: pouca coisa se mexe, e o que se mexe responde a um toque.
Entrar é suave, sair é rápido, e nada pisca nem pula.

Tudo o que é movimento fica em **`web/css/motion.css`**. Uma animação nova entra nesse arquivo,
usando os tokens abaixo. Não crie durações nem curvas soltas nos outros CSS.

---

## 1. Regras

1. **Só `transform` e `opacity`.** A GPU anima essas duas sem recalcular a página.
   `height`, `width`, `top`, `box-shadow`, `filter` e `background` animados fazem o Chrome recalcular
   a página a cada quadro, e foi isso que travou o Chrome antes: a ondinha da pílula mudava de altura
   40 vezes por segundo. Se algo precisa "crescer", use `scale` (medidores usam `scaleX`/`scaleY` com `--v`).
2. **Entrar com mola, sair rápido.** Entradas usam `--spring`/`--ease-out` com `--m-base`/`--m-slow`.
   Saídas usam `--ease-in` com `--m-fast` (cerca de 60% da entrada). Quem fecha algo já decidiu, então não espera.
3. **A opacidade chega antes do movimento.** O esmaecer dura de 90 a 160 ms e o deslocamento continua
   com mola. Assim não fica texto por cima de texto (era o problema do menu "mais" da ligação).
4. **Nada pula.** Toda coisa que aparece tem um estado de partida. Na conferência pelo ffmpeg, nenhum quadro
   pode fazer sozinho mais de 35% da mudança da tela (ver "corte seco" na seção 4).
5. **Uma coisa por vez.** Um toque dispara uma animação principal. Nada de entradas em cascata nem de
   brilhos piscando. Animações infinitas só valem para estado vivo: tocando, falando, digitando, carregando.
6. **Resposta ao toque em até 100 ms.** Botões afundam para `scale(.96)` em `--m-tap` e voltam com mola
   (regra "resposta ao toque" da tapa-de-ux).
7. **Reduzir movimento.** Com a opção do aparelho ligada, nada se desloca e tudo vira um esmaecer curto
   (regra "Movimento sob controle" da tapa-de-ux, WCAG 2.3.3).
8. **Esperar não é animação.** Até 1 s, nada. De 1 a 10 s, esqueleto ou indicador no lugar. Acima de 10 s,
   progresso com números reais (regra de carregamento da tapa-de-ux).
9. **Folha e janela têm saída óbvia:** X, puxar para baixo, tocar fora, Esc. Nunca uma janela por cima de outra.

## 2. Tokens (`motion.css`)

| Token | Valor | Para quê |
|---|---|---|
| `--m-tap` | 90 ms | afundar o botão no toque |
| `--m-fast` | 160 ms | esmaecer, trocar de aba, toda saída |
| `--m-base` | 280 ms | menu, janela, aviso, voltar |
| `--m-slow` | 440 ms | folha que sobe, tela que entra empurrando, mensagem nova |
| `--ease-out` | `cubic-bezier(.32,.72,0,1)` | a curva das folhas do iOS: arranca rápido e assenta devagar |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` | saídas |
| `--spring` | `linear(…)`, amortecimento 0,72, passa 4% do ponto final | coisas pequenas que "brotam" de um botão |
| `--spring-calm` | `linear(…)`, amortecimento crítico, sem passar | coisas grandes (tela de ligação, cartão) |

As molas são `linear()` calculadas pela fórmula de um oscilador amortecido (ver `dev/anim/`).
Navegador sem `linear()` cai em `--ease-out` (`@supports`).

## 3. Catálogo

| Onde | Gatilho | Entrada | Saída |
|---|---|---|---|
| Trocar de aba | toque na barra | esmaece a tela inteira, título junto (160 ms) | — |
| Abrir conversa (celular) | toque na conversa | a conversa empurra da direita (440 ms, `--ease-out`). A tela de antes anda 24% para a esquerda e escurece | — |
| Voltar | botão voltar | a conversa sai por cima para a direita (280 ms) e a lista volta da esquerda | — |
| Abrir ligação | entrar na sala | assenta de `scale(.92)` com mola calma e esmaece | esmaece |
| Folha (anexar, jogos, opções) | toque | sobe com a curva do iOS (440 ms), fundo escurece junto | desce em 160 ms |
| Janela (dialog) | ação | brota de `scale(.94)` com mola e o fundo esmaece junto | — |
| Aviso (toast) | evento | sobe 14 px com mola | desce 6 px e some (160 ms) |
| "Digitando…" | outra pessoa digita | aparece por cima do fim da lista, sem empurrar nada | esmaece com o texto ainda lá |
| Mensagem nova | chega ou é enviada | sobe 14 px de `scale(.96)` com mola. Só as novas: o histórico não anima | — |
| Chamada chegando | toque recebido | o fundo e o cartão esmaecem, o cartão assenta com mola calma | — |
| Anel "tocando" | conversa chamando | um aro cresce e some (transform + opacity), 1,4 s em loop | — |
| Menu "mais" da ligação | toque no ⋯ | o cartão some em 90 ms e o menu brota com mola | o cartão volta |
| Fim da ligação | desligar | aparece na hora (continua o escuro da ligação), conteúdo esmaece e a foto assenta | esmaece em 160 ms |
| Medidores (microfone, envio, barras da voz) | som/progresso | `scaleX`/`scaleY` via `--v`, 80 ms linear | — |

No Safari, a troca de tela usa View Transitions (`ui.js → withTransition`). No Chrome ela fica desligada
(`html.lite`) porque travava e deixava imagem velha na tela. Lá quem anima é `enterAnim()` com
`data-enter`/`data-leave` em `motion.css`.

## 4. Conferir quadro a quadro (ffmpeg)

```
node dev/server.js                                   # servidor de dev em :8813
node dev/anim/record.cjs /tmp/anim                   # grava as cenas (ONLY=cena1,cena2 para algumas)
python3 dev/anim/analyze.py /tmp/anim                # mede e monta as folhas de quadros
```

**Gravação (`record.cjs`).** Playwright grava cada cena num vídeo. Antes do toque, o CDP desacelera todas
as animações e transições em 10x (`Animation.setPlaybackRate`). O vídeo sai a 25 qps, então
**cada quadro do vídeo vale 4 ms da animação real**: dá para ver a curva inteira.

**Análise (`analyze.py`).** Usa três filtros do ffmpeg:

```
# 1) quanto a tela mudou de um quadro para o outro (média da diferença, 0–255)
ffmpeg -i cena.webm -vf "format=gray,tblend=all_mode=difference,signalstats,\
metadata=print:key=lavfi.signalstats.YAVG:file=-" -f null -

# 2) folha de contato: 24 quadros do trecho em movimento, com o tempo real carimbado
ffmpeg -ss <início> -t <duração> -i cena.webm -vf "select='not(mod(n\,N))',scale=200:-1,\
drawtext=text='%{eif\:t*100\:d} ms':…,tile=6x4" -frames:v 1 cena.png
```

O que sai, por cena:

- **duracao_ms**: do primeiro ao último quadro com movimento, em tempo real.
- **cortes_secos**: quadros que fazem sozinhos mais de 35% de toda a mudança. É um corte em vez de animação.
  O valor certo é nenhum.
- **parados_no_meio**: quadros iguais dentro do movimento. Muitos seguidos no começo indicam engasgo.
  No fim de uma mola é normal.
- **folha .png**: os quadros lado a lado, para olhar a curva, a ordem das coisas e sobreposições.

**Armadilha encontrada:** criar um elemento e ligar a classe de entrada no mesmo `requestAnimationFrame`
faz o navegador pular direto para o fim, sem transição. Leia `offsetWidth` antes (ver `ringer.js`).
**Outra:** temporizadores de JS não desaceleram junto. Para saber quando uma animação acabou, use
`el.getAnimations()` e `.finished`, não `setTimeout`.

## 5. Antes e depois (Chrome, iPhone 14 Pro emulado, 20/11/2026)

| Cena | Antes | Depois |
|---|---|---|
| Trocar de aba | título trocava seco, só a lista entrava (308 ms) | tela inteira esmaece junto (280 ms) |
| Abrir conversa | **corte seco** (1 quadro, 99% da mudança) | empurra da direita sobre a tela de antes (560 ms), sem corte |
| Voltar | corte seco | conversa sai por cima (496 ms), sem corte |
| Anexar | sobe (424 ms) | sobe com a curva do iOS e desce rápido (552 ms) |
| Aviso | sobe (280 ms) e **sumia seco** | sobe com mola (228 ms) e sai animado |
| Janela | **fundo escurecia num quadro** (51%) | fundo esmaece junto (272 ms), sem corte |
| Digitando + mensagem | indicador empurrava a lista (animava `height`), mensagem aparecia seca | indicador por cima e mensagem sobe com mola, sem corte |
| Chamada chegando | **tela inteira num quadro** (71%) | esmaece e assenta (704 ms), sem corte |
| Menu da ligação | ~150 ms de texto do menu por cima do texto do cartão | o cartão some em 90 ms e o menu brota (≈50 ms de sobreposição) |
| Fim da ligação | **piscava a conversa** entre a ligação e o "Encerrada" (37%), saída seca | entra na hora sobre o escuro, conteúdo esmaece e sai em 160 ms |
| Em ligação, fora da tela da ligação | 322 recálculos de página em 8 s | 8 em 8 s |

## 6. Revisão de uma tela nova

Use junto com a skill **tapa-de-ux** (`regras/acessibilidade.md`, `botoes-e-acoes.md`, `estados.md`, `navegacao.md`):

- [ ] Só `transform`/`opacity` animados? Nada de `height`/`box-shadow`/`filter` em loop.
- [ ] Durações e curvas são tokens de `motion.css`?
- [ ] Entrada com mola, saída mais curta e sem mola?
- [ ] O esmaecer chega antes do movimento, sem texto por cima de texto?
- [ ] Gravou a cena com `record.cjs` e não deu nenhum corte seco?
- [ ] Botões afundam no toque?
- [ ] Com "Reduzir movimento", só esmaece?
- [ ] Folha e janela têm X, tocar fora e Esc?
- [ ] Carregando: nada até 1 s, esqueleto até 10 s, progresso real depois?
