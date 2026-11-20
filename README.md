# Echo

Ligação e cinema em alta qualidade, num site só seu. Chamada de voz, transmissão de tela com áudio e picture-in-picture,
com amigos e servidores. Grátis na Cloudflare (Workers + Durable Objects). Vídeo e áudio vão direto entre os navegadores
(WebRTC, cifrado); o servidor só faz a sinalização.

JS puro (ES modules), sem build e sem bibliotecas externas. Funciona no Chrome, Edge, Safari e Firefox recentes.

## Echo para computador (Mac e Windows)
O app para baixar fica na pasta `desktop/` e os instaladores saem em **Releases**. Veja `desktop/README.md`.

## Publicar na Cloudflare (uma vez)
1. Crie uma conta grátis em cloudflare.com e instale o Node 20 ou mais novo.
2. No terminal: `cd worker && npm install && npx wrangler login && npx wrangler deploy`
3. Abra o endereço `*.workers.dev` que o comando mostrar e crie a sua conta.
4. Quantas contas podem existir: `MAX_ACCOUNTS` em `worker/wrangler.toml` (padrão 2; depois de criadas, o cadastro fecha).
   Para convidar mais gente, aumente o número e rode `npx wrangler deploy` de novo.
5. Recomendado: se a conexão direta falhar em alguma rede, crie um TURN grátis no painel (Realtime > TURN) e rode
   `npx wrangler secret put TURN_KEY_ID` e `npx wrangler secret put TURN_KEY_API_TOKEN`.
6. Opcional: `npx wrangler secret put SIGNUP_CODE` passa a exigir um código para criar conta (aparece um campo na tela de cadastro).
7. Opcional (GIFs no chat): crie uma chave grátis em developers.giphy.com (Create an App → API) e rode `npx wrangler secret put GIPHY_KEY`.
   A busca e as imagens passam pelo próprio Echo; o aparelho de vocês não fala direto com o GIPHY. Sem a chave, o botão de GIF avisa.

### Atualizar o site
Depois de mudar qualquer arquivo da pasta `web/`, **troque o `VERSION` em `web/sw.js`** (por exemplo `echo-2026-11-14-2`)
e rode `npx wrangler deploy`. É essa troca que faz os aparelhos que já instalaram o app baixarem a versão nova.
Sem ela, quem já abriu o Echo pode continuar vendo os arquivos antigos.

O `web/_headers` define a CSP estrita (sem script nem estilo inline, sem scripts externos) e o `sw.js` é servido com `Service-Worker-Allowed: /`.
O Cloudflare lê esse arquivo sozinho.

## Instalar como app (PWA)
- **Chrome, Edge e Android:** em Ajustes > Conta, toque em "Instalar o Echo" (ou use o ícone de instalar na barra de endereço).
- **Mac (Safari):** menu Arquivo > Adicionar ao Dock.
- **iPhone e iPad:** botão Compartilhar > Adicionar à Tela de Início.
- Depois de instalado, o Echo abre em janela própria, sem barra do navegador. O botão some quando o app já está instalado.
- O app guarda só os arquivos do site (para abrir rápido e mostrar a tela de entrada sem internet). Chamadas, login e presença
  sempre usam a rede; nada de conta ou cookie fica no cache.

## Entrar com biometria
Em Ajustes > Conta > "Entrar com biometria", toque em "Adicionar este aparelho". O aparelho guarda uma passkey (WebAuthn):
Face ID no iPhone e iPad, Touch ID no Mac, Windows Hello no Windows, ou a biometria do Android. Na tela de entrada aparece
"Entrar com biometria"; se este aparelho já entrou antes, aparece "Olá, <nome>" com o botão de biometria em destaque
e as opções "Entrar com senha" e "Trocar de conta". Dá para remover cada passkey na mesma tela. A senha continua valendo sempre.
A biometria só aparece em navegadores com suporte e em endereço seguro (HTTPS ou localhost).

## Testar no computador
```
cd dev && PORT=8787 MAX_ACCOUNTS=4 node --no-warnings server.js
```
Abra http://localhost:8787. O banco fica em memória: reiniciar o servidor zera tudo.
- `node dev/api-test.js` testa a API inteira (sobe o próprio servidor).
- `URL=http://localhost:8787/ node dev/e2e.cjs` abre dois navegadores, cria contas, liga e transmite a tela (precisa do Playwright).
- O service worker não registra em `localhost`, para não atrapalhar o desenvolvimento. Para testá-lo, abra `http://localhost:8787/?sw=1`.

## Segurança
Senha com PBKDF2 no navegador e de novo no servidor; cookie HttpOnly e SameSite=Strict; CSP estrita sem scripts externos;
sala com no máximo 2 pessoas; sem câmera.

## Na chamada
- **Transmitir com som:** abra o Echo no **Google Chrome** (no Mac: Chrome 141+ e macOS 14.2+). Na janelinha do Chrome, ligue
  "Compartilhar áudio do sistema". Assim sai o som de qualquer app aberto (Spotify, jogos, Stremio). O Safari só manda imagem.
  Dá para instalar o Echo pelo Chrome como app (menu ⋮ → Transmitir, salvar e compartilhar → Instalar página como app).
- **Assistir juntos:** link do YouTube (sincronizado no mesmo segundo), live da Twitch ou da Kick, vídeo do computador
  (vai transmitido com o som do próprio vídeo, inclusive pelo Safari) ou link direto de vídeo.
- **Efeitos sonoros:** 16 sons sintetizados no próprio navegador (nada baixado de fora), volume próprio, e dá para adicionar sons seus.
- **Chat:** dentro da chamada (botão de balão) e fora dela (Início → conversa). Fotos, vídeos, áudios, arquivos até 100 MB,
  emojis, GIFs, responder, reagir, editar, apagar e visualização única. Ao desligar, fica registrado na conversa quanto tempo
  durou e quem desligou.

## Jogos
Aba **Jogos** (ícone de controle), por categoria: Jogo da velha, Lig 4, Termo, Xadrez, Ludo, Batalha naval, Uno, Stop,
Desenhe e adivinhe, Quem sou eu? e Tetris (solo ou contra alguém), para duas pessoas, dentro ou fora da ligação. Toque no jogo, escolha
a amiga (precisa estar online) e ela recebe o convite no topo da tela. Na ligação, o botão de controle na barra abre os jogos
já com a pessoa da chamada; a voz continua durante a partida e dá para silenciar o microfone pela própria tela do jogo.
- Quem convida é a anfitriã: ela embaralha, guarda as mãos do Uno e manda para cada lado só as próprias cartas.
- As jogadas passam pelo servidor só entre amigas (com limite de volume); nada da partida fica guardado, só o resultado.
- Histórico e placar por pessoa aparecem na aba. Atalhos no computador: Uno (1–9 jogam, espaço compra/passa, U grita UNO),
  Tetris (setas/WASD, espaço, C), Esc sai da partida.
- Os jogos antigos dentro da ligação (desenho, Wordle etc.) continuam desligados em `web/js/flags.js`.
- **Stop:** quem cria a partida escolhe as categorias (liga/desliga, cria e apaga), o número de rodadas e o tempo. A letra sai
  numa roleta; quem preenche tudo primeiro aperta STOP (a outra ganha 3 s); depois cada uma corrige a resposta da outra,
  categoria por categoria (10 pontos resposta única, 5 iguais, 0 inválida). As respostas de quem foi convidada só saem do
  aparelho dela quando a rodada acaba.
- **Tetris solo:** botão "Solo" no cartão do Tetris; o recorde fica guardado no aparelho. P pausa.
- `node --no-warnings dev/games-test.js` testa convites, repasse, limites e histórico.

## Chat
Layout no estilo Telegram/Messenger: hora e tiques (enviada ✓ / lida ✓✓) dentro do balão, mensagens fixadas (segure a
mensagem ou arraste para a direita › Fixar; a barra no topo leva até ela), arrastar para a direita abre as opções, e tocar
na foto ou no nome abre o perfil com as vitórias da pessoa em cada jogo e o placar contra você.

## Notificações
Configurações › Notificações liga o Web Push neste aparelho (mensagens e chamadas). O servidor assina e cifra sozinho
(VAPID + RFC 8291, chaves criadas na primeira vez); só manda quando o Echo não está aberto na frente da tela.
No iPhone precisa do Echo instalado na Tela de Início (iOS 16.4+). Opcional: `PUSH_CONTACT` (ex.: `mailto:voce@exemplo.com`)
como contato nas assinaturas. `node --no-warnings dev/push-test.js` testa inscrição, cifra, assinatura e quando envia.

## Várias contas
Perfil › **Adicionar conta** entra em outra conta sem sair da atual (até 5 abertas no mesmo navegador). A lista aparece no
Perfil (celular) ou no menu da sua foto (computador); toque para trocar. "Sair da conta" sai só da atual e passa para a
próxima aberta. As sessões guardadas ficam em cookies HttpOnly (o JavaScript da página não consegue ler).
- `node --no-warnings dev/accounts-test.js` testa adicionar, trocar e sair.

## Limites conhecidos
- **Microfone sempre perguntando:** o site não consegue liberar sozinho; quem guarda a permissão é o navegador. Em
  Configurações › Voz e vídeo aparece a situação e o caminho para deixar em "Permitir" em cada aparelho. No app instalado
  no iPhone (Tela de Início) o iOS pode perguntar a cada abertura; pelo Safari dá para deixar fixo.
- Nunca foi testado em Cloudflare de verdade, nem em iPhone, Mac ou Windows reais. Os testes automáticos rodaram só no Chromium.
- iPhone e iPad não conseguem transmitir a tela (limite do iOS). O Safari (Mac) não envia som de tela; use o Chrome.
- Som do sistema inclui tudo que toca no computador. O Echo pede ao Chrome para tirar o próprio som (a voz da chamada), mas isso
  não foi testado num Mac real: se a outra pessoa se ouvir de volta, transmita uma aba ou janela.
- No iPhone, a janela flutuante (PiP) só funciona com o Echo aberto no Safari, não no ícone da Tela de Início (limite da Apple).
- Arquivos do chat ficam guardados no Durable Object. No plano grátis da Cloudflare, conte com cerca de 1 GB para tudo
  (a documentação cita 5 GB por conta e 1 GB por objeto no plano grátis). Para vídeos longos, prefira "Assistir juntos" → vídeo do computador, que não guarda nada. Mensagens não são cifradas
  ponta a ponta: ficam no servidor de vocês, acessível só com login.
- "Apertar para falar" só funciona com a aba em foco. No iPhone o microfone pode cortar com o app em segundo plano.
- A biometria foi verificada com um autenticador virtual do Chromium; Face ID, Touch ID e Windows Hello reais não foram testados.
- O botão de instalar depende do navegador: no Safari e no iOS só há o passo a passo, e o Firefox para computador não instala sites.
- O app instalado não funciona sem internet além da tela de entrada: ligar e entrar exigem o servidor.
- 4K a 60 quadros depende do computador e do navegador; use a predefinição "Nitidez" ou "Filme" se travar.
- O nome do Worker em `wrangler.toml` continua `telinha`, para não perder dados de quem já publicou. Mude `name` só se for publicar do zero.
