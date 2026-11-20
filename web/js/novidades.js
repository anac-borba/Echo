'use strict';
// Novidades do Echo: o que mudou em cada versão, com um clipe curto das telas novas (em img/novidades/).
// Para uma versão nova: acrescente um item no começo da lista. Clipes: mp4 curtos (gravados com dev/novidades.cjs).
// mude junto com VERSION no sw.js: aparece em Configurações › Atualizações para saber qual versão está aberta
export const SITE_VERSION = '2026-11-20-16';
export const NOVIDADES = [
  {
    date: '2026-11-20',
    items: [
      { t: 'Menu do morceguinho', d: 'Toque no morcego: seu perfil, o status com um toque (Online, Ausente, Ocupado, Invisível), amigos, convite e Configurações.' },
      { t: 'Configurações num lugar só', d: 'Supressão de ruído e volume do microfone direto na primeira tela, busca de ajustes e as contas para trocar.' },
      { t: 'Matutando…', d: 'Quando algo está carregando, o morceguinho fica pensando.' },
      { t: 'Início sem barra de abas', d: 'No celular, o morceguinho no canto abre o Perfil e as Configurações, e o controle abre os Jogos. Quem importa fica fixado no topo em fotos grandes, com o anel verde quando está online.' },
      { t: 'Ligação no celular, do jeito do FaceTime', d: 'Fundo calmo, com a foto, o nome e o tempo no meio. Áudio, Mudo e Desligar ficam sempre à mão; arraste a barra para cima e o resto aparece em lista, como no FaceTime.', clip: '/img/novidades/ligacao.mp4' },
      { t: 'Adicionar amigo mais bonito', d: 'O botão do Início ganhou a cor do morceguinho e um + redondo.' },
      { t: 'Fim da ligação sem susto', d: 'Desligou: a tela continua com a cor da ligação e mostra quanto tempo vocês conversaram, com atalhos para mandar mensagem ou ligar de novo.', clip: '/img/novidades/encerrada.mp4' },
      { t: 'Configurações que deslizam', d: 'A folha sobe ao abrir e cada página entra empurrando a anterior, como no iPhone.', clip: '/img/novidades/config.mp4' },
      { t: 'Sua voz chegando sempre', d: 'Corrigido: às vezes o iPhone pedia para o outro lado mandar o microfone no volume zero. Agora toda ligação começa com o volume normal.' },
      { t: 'Touch ID no app do Mac', d: 'Ative em Configurações › Conta e entre com o dedo. A chave fica no Keychain do seu Mac.' },
      { t: 'Avisos no app para computador', d: 'Mensagens e ligações aparecem como aviso do sistema, e o número de não lidas fica no ícone.' },
      { t: 'Procurar atualização sem recarregar à toa', d: 'Se já estiver na versão mais nova, o Echo só avisa. Se tiver novidade, instala e volta para cá.' },
    ],
  },
];
