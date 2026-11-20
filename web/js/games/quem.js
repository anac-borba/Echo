'use strict';
// Quem sou eu? Cada uma escolhe o personagem da OUTRA (em segredo).
// Você vê o personagem dela "na testa"; o seu fica escondido. Na sua vez: faça uma pergunta de sim/não
// (escrita ou por voz na ligação) ou tente adivinhar. Errou o chute, passa a vez.
import { el } from '../util.js';
import { hosted, makeTr, seats, endBox, waitingPeer, norm, kt } from './kit.js';

const tr = makeTr({
  pt: { write: 'Escolha quem {name} vai ser', writeHint: 'Uma pessoa, personagem, animal… {name} não vai ver.', ph: 'Ex.: Shrek, Anitta, um pinguim', ok: 'Escolher',
    waitWrite: 'Esperando {name} escolher o seu…', chosen: 'Você escolheu', mine: 'Você', hidden: '???', theirs: '{name} é',
    ask: 'Perguntar', askPh: 'Pergunta de sim ou não (ou fale na ligação)', voice: 'Perguntei por voz', guess: 'Chutar', guessPh: 'Eu sou…',
    yes: 'Sim', no: 'Não', maybe: 'Não sei', answerQ: '{name} perguntou:', answerVoice: '{name} fez uma pergunta por voz', waitAns: 'Esperando {name} responder…',
    guessQ: '{name} chutou: {g}. Acertou?', right: 'Acertou', wrong: 'Errou', wrongLog: 'Chutou {g}: errou', waitConfirm: 'Esperando {name} conferir o chute…',
    win: 'Você descobriu!', lose: '{name} descobriu primeiro', was: 'Você era {a} · {name} era {b}', questions: '{n} perguntas', qv: '(por voz)', yourTurn: 'Sua vez: pergunte ou chute', theirTurn: 'Vez de {name}' },
  en: { write: 'Choose who {name} will be', writeHint: 'A person, character, animal… {name} won’t see it.', ph: 'E.g. Shrek, Beyoncé, a penguin', ok: 'Choose',
    waitWrite: 'Waiting for {name} to choose yours…', chosen: 'You chose', mine: 'You', hidden: '???', theirs: '{name} is',
    ask: 'Ask', askPh: 'Yes/no question (or say it on the call)', voice: 'I asked out loud', guess: 'Guess', guessPh: 'I am…',
    yes: 'Yes', no: 'No', maybe: "Don't know", answerQ: '{name} asked:', answerVoice: '{name} asked out loud', waitAns: 'Waiting for {name} to answer…',
    guessQ: '{name} guessed: {g}. Right?', right: 'Right', wrong: 'Wrong', wrongLog: 'Guessed {g}: wrong', waitConfirm: 'Waiting for {name} to check…',
    win: 'You figured it out!', lose: '{name} figured it out first', was: 'You were {a} · {name} was {b}', questions: '{n} questions', qv: '(out loud)', yourTurn: 'Your turn: ask or guess', theirTurn: "{name}'s turn" },
});
const clean = (s) => String(s || '').replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);

export default {
  start(ctx) {
    const me = ctx.seat, other = 1 - me;
    const peer = ctx.names[other];
    let apiRef = null;
    // partes fixas (os campos de texto não são recriados para não perder o foco)
    const top = el('div', { class: 'qs-top' });
    const status = el('div', { class: 'gk-turn' });
    const cards = el('div', { class: 'qs-cards' });
    const writeIn = el('input', { class: 'qs-in', type: 'text', maxlength: '60', placeholder: tr('ph'), autocomplete: 'off', enterkeyhint: 'done' });
    const writeForm = el('form', { class: 'qs-form qs-write' }, el('h3', { text: tr('write', { name: peer }) }), el('p', { class: 'gk-hint', text: tr('writeHint', { name: peer }) }),
      el('div', { class: 'gk-row' }, writeIn, el('button', { class: 'btn primary', type: 'submit', text: tr('ok') })));
    const askIn = el('input', { class: 'qs-in', type: 'text', maxlength: '120', placeholder: tr('askPh'), autocomplete: 'off', enterkeyhint: 'send' });
    const guessIn = el('input', { class: 'qs-in', type: 'text', maxlength: '60', placeholder: tr('guessPh'), autocomplete: 'off', enterkeyhint: 'send' });
    const askForm = el('form', { class: 'qs-form' }, el('div', { class: 'gk-row' }, askIn, el('button', { class: 'btn primary', type: 'submit', text: tr('ask') })),
      el('button', { class: 'qs-voice', type: 'button', text: tr('voice'), onClick: () => apiRef.send({ k: 'ask', q: '' }) }));
    const guessForm = el('form', { class: 'qs-form' }, el('div', { class: 'gk-row' }, guessIn, el('button', { class: 'btn', type: 'submit', text: tr('guess') })));
    const answerBox = el('div', { class: 'qs-answer' });
    const log = el('div', { class: 'qs-log' });
    const ov = el('div');
    const root = el('div', { class: 'gk qs' }, top, status, writeForm, cards, answerBox, askForm, guessForm, log, ov);
    ctx.root.replaceChildren(root);
    writeForm.addEventListener('submit', (e) => { e.preventDefault(); const v = clean(writeIn.value); if (v) { apiRef.send({ k: 'set', c: v }); writeIn.blur(); } });
    askForm.addEventListener('submit', (e) => { e.preventDefault(); const v = clean(askIn.value); if (v) { apiRef.send({ k: 'ask', q: v }); askIn.value = ''; } });
    guessForm.addEventListener('submit', (e) => { e.preventDefault(); const v = clean(guessIn.value); if (v) { apiRef.send({ k: 'guess', g: v }); guessIn.value = ''; } });

    const h = hosted(ctx, {
      init(prev) {
        const starter = prev ? 1 - prev.starter : 0;
        // chars[x] = personagem que X precisa descobrir (escrito pela outra)
        return { ph: 'write', chars: ['', ''], turn: starter, starter, q: null, pg: null, log: [], nq: [0, 0], over: false, winner: null, score: prev ? prev.score : [0, 0] };
      },
      act(S, seat, a, api) {
        if (S.over) return false;
        const o = 1 - seat;
        if (a.k === 'set' && S.ph === 'write') { const c = clean(a.c); if (!c) return false; S.chars[o] = c; if (S.chars[0] && S.chars[1]) S.ph = 'play'; return; }
        if (S.ph !== 'play') return false;
        if (a.k === 'ask' && S.turn === seat && !S.q && !S.pg) { S.q = { by: seat, text: clean(a.q).slice(0, 120) }; S.nq[seat]++; return; }
        if (a.k === 'answer' && S.q && S.q.by === o && ['y', 'n', 'm'].includes(a.v)) { S.log.push({ by: o, q: S.q.text, a: a.v }); S.q = null; S.turn = o === 0 ? 1 : 0; return; }
        if (a.k === 'guess' && S.turn === seat && !S.q && !S.pg) {
          const g = clean(a.g); if (!g) return false;
          if (norm(g) === norm(S.chars[seat])) { win(S, seat, api); return; }
          S.pg = { by: seat, g }; return;
        }
        if (a.k === 'confirm' && S.pg && S.pg.by === o) {
          if (a.ok) { win(S, o, api); return; }
          S.log.push({ by: o, g: S.pg.g }); S.pg = null; S.turn = seat; return;
        }
        return false;
      },
      view(S, s) {
        const o = 1 - s;
        return { ph: S.ph, wrote: [!!S.chars[1], !!S.chars[0]], theirChar: S.ph === 'play' || S.over ? S.chars[o] : '', iWrote: S.chars[o], myChar: S.over ? S.chars[s] : '',
          turn: S.turn, q: S.q, pg: S.pg, log: S.log, nq: S.nq, over: S.over, winner: S.winner, score: S.score };
      },
      render(v, api) { apiRef = api; paint(v, api); },
    });
    function win(S, seat, api) { S.over = true; S.winner = seat; S.score[seat]++; S.pg = null; S.q = null; api.result(seat); }

    function paint(v, api) {
      top.replaceChildren(seats(ctx, v, { turn: v.ph === 'play' && !v.over ? v.turn : null, score: v.score, sub: [tr('questions', { n: v.nq[0] }), tr('questions', { n: v.nq[1] })] }));
      const iWroteDone = v.wrote[me];      // eu já escrevi o personagem dela?
      writeForm.hidden = v.ph !== 'write' || iWroteDone;
      // cartas "na testa"
      if (v.ph === 'write') {
        cards.replaceChildren(iWroteDone ? el('div', { class: 'qs-card theirs' }, el('small', { text: tr('chosen') }), el('b', { text: v.iWrote })) : '');
        status.textContent = !v._here && api.host ? '' : iWroteDone ? tr('waitWrite', { name: peer }) : '';
        if (!v._here && api.host) status.replaceChildren(waitingPeer(ctx));
      } else {
        cards.replaceChildren(
          el('div', { class: 'qs-card mine' + (v.over ? ' open' : '') }, el('small', { text: tr('mine') }), el('b', { text: v.over ? v.myChar : tr('hidden') })),
          el('div', { class: 'qs-card theirs' }, el('small', { text: tr('theirs', { name: peer }) }), el('b', { text: v.theirChar })));
        status.className = 'gk-turn' + (v.turn === me && !v.over ? ' mine' : '');
        status.textContent = v.over ? '' : v.turn === me ? tr('yourTurn') : tr('theirTurn', { name: peer });
      }
      // responder / conferir
      answerBox.replaceChildren();
      if (!v.over && v.q) {
        if (v.q.by === other) answerBox.append(el('div', { class: 'qs-qcard' }, el('small', { text: v.q.text ? tr('answerQ', { name: peer }) : tr('answerVoice', { name: peer }) }), v.q.text ? el('b', { text: v.q.text }) : null,
          el('div', { class: 'gk-row' }, ...[['y', 'yes'], ['n', 'no'], ['m', 'maybe']].map(([k, l]) => el('button', { class: 'qs-ab ' + k, type: 'button', text: tr(l), onClick: () => api.send({ k: 'answer', v: k }) })))));
        else answerBox.append(el('div', { class: 'gk-wait' }, el('span', { class: 'gk-dots' }, el('i'), el('i'), el('i')), el('span', { text: tr('waitAns', { name: peer }) })));
      }
      if (!v.over && v.pg) {
        if (v.pg.by === other) answerBox.append(el('div', { class: 'qs-qcard' }, el('b', { text: tr('guessQ', { name: peer, g: v.pg.g }) }),
          el('div', { class: 'gk-row' }, el('button', { class: 'qs-ab y', type: 'button', text: tr('right'), onClick: () => api.send({ k: 'confirm', ok: true }) }),
            el('button', { class: 'qs-ab n', type: 'button', text: tr('wrong'), onClick: () => api.send({ k: 'confirm', ok: false }) }))));
        else answerBox.append(el('div', { class: 'gk-wait' }, el('span', { text: tr('waitConfirm', { name: peer }) })));
      }
      const canAct = v.ph === 'play' && !v.over && v.turn === me && !v.q && !v.pg;
      askForm.hidden = guessForm.hidden = !canAct;
      // histórico (mais recente em cima)
      const ans = { y: tr('yes'), n: tr('no'), m: tr('maybe') };
      log.replaceChildren(...v.log.slice().reverse().map((x) => el('div', { class: 'qs-l ' + (x.by === me ? 'me' : 'op') + (x.a ? ' a-' + x.a : ' wrong') },
        el('small', { text: x.by === me ? kt('you') : peer }),
        el('span', { text: x.g ? tr('wrongLog', { g: x.g }) : (x.q || tr('qv')) }),
        x.a ? el('b', { text: ans[x.a] }) : null)));
      ov.replaceChildren(v.over ? endBox(ctx, v, api, { title: v.winner === me ? tr('win') : tr('lose', { name: peer }), detail: tr('was', { a: v.myChar, name: peer, b: v.theirChar }), tone: v.winner === me ? 'win' : '' }) : '');
    }
    return { destroy() { h.destroy(); } };
  },
};
