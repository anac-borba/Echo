# Contrato dos jogos do Echo (2 jogadoras)

Projeto: /home/claude/telinha/web (JS puro, ES modules, sem build, sem libs externas, sem rede).
CSP ESTRITA: nada de `<script>` inline, nada de atributo `style="..."` / `setAttribute('style')` / `innerHTML` com
dados de usuária. Use classes CSS (arquivo próprio) e, quando precisar de valor dinâmico, `elemento.style.prop = x`
(CSSOM é permitido) ou variáveis CSS via `elemento.style.setProperty('--x', v)`. Canvas é livre.

## Arquivos de cada jogo <id>
- `web/js/games/<id>.js` -> `export default { start(ctx) { ...; return { destroy() {...} }; } }`
- `web/css/g-<id>.css` (carregado automaticamente). Prefixe TODAS as classes com `g-<id>-` para não colidir.
  Use as variáveis de tema já existentes: `var(--bg) --bg2 --surface --surface2 --text --muted --line --accent --on-accent --ok --warn --bad --r-sm --r-md --r-lg --shadow` (NÃO existem --accent-2 nem --radius)
  (leia web/css/base.css para ver os nomes certos e as classes `.btn`, `.btn.primary`, `.btn.sm`, `.muted`, `.seg`, `.switch`).
  O jogo deve funcionar em temas claro e escuro, em tela de PC e de celular (>= 360px de largura), com toque e mouse.
- Textos: dicionário local `const L = { pt: {...}, en: {...} }` e `import { getLang } from '../i18n.js'`; função `tr(k, vars)`.
  Sempre pt-BR primeiro, en também.

## ctx (entregue ao start)
```
ctx.root      HTMLElement vazio (classe act-game act-<id>) onde o jogo se desenha (ocupa a área #act-body, rolável)
ctx.seat      0 ou 1 (estável nos dois lados; use seat 0 como "anfitriã" autoritativa quando precisar)
ctx.names     [nomeSeat0, nomeSeat1]; ctx.me / ctx.peer = objetos usuário ({id,username,name,...})
ctx.starter   id de quem abriu; ctx.iStarted boolean
ctx.send(obj) manda JSON ao outro lado (DataChannel confiável e ordenado; mantenha < 60 KB por mensagem; para desenho/imagens use data URL JPEG/PNG pequena ou lista de traços)
ctx.onMsg(fn) fn(obj) para cada mensagem do outro lado; retorna função de cancelar
ctx.end()     encerra a atividade nos dois lados
ctx.toast(txt), ctx.el, ctx.icon  (helpers: `el(tag,{class,text,onClick},...filhos)`; `icon('i-x')`)
```
Não há servidor: o estado vive nos dois navegadores. Ordem das mensagens é garantida. Se uma jogadora sair e voltar,
a atividade reabre do zero (não precisa persistir). Escolha UM lado autoritativo (seat 0) para qualquer coisa
aleatória/compartilhada (dados, palavra secreta, sorteio) e mande o resultado ao outro lado.
`destroy()` deve remover listeners globais (keydown, resize, timers, requestAnimationFrame, AudioContext).
Teclas globais: só reaja a teclado quando o foco não estiver em input/textarea; chame preventDefault apenas para teclas que o jogo usa.
Controles de toque: jogos de ação (tetris) precisam de botões na tela.
Cada jogo começa direto numa tela de jogo (sem lobby complicado); sempre ofereça "Jogar de novo".

## Qualidade
Visual bonito, arrumadinho, no estilo do app (cantos arredondados, cores do tema, sem emoji demais). Sem bugs de sincronização:
teste com dois contextos. Teste mínimo obrigatório: crie `web/dev/test-<id>.cjs`? NÃO. Em vez disso, escreva
`/home/claude/telinha/dev/games-harness.html`-like harness só se precisar; o importante é rodar `node --check` e um teste Playwright
próprio em /tmp que importe o módulo em uma página mínima servida pelo dev server (PORT livre) com um ctx falso ligando
dois ctx em memória (send de um chama onMsg do outro) para validar a lógica e capturar screenshot (leia o screenshot!).
Não edite arquivos fora dos seus jogos (js/games/<id>.js e css/g-<id>.css). Não mexa em activities.js nem call.js.
