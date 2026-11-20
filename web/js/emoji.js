// Emojis do Echo (lista própria, sem biblioteca externa). Cada categoria é uma string separada por espaço.
export const EMOJI_CATS = [
  { id: 'smile', icon: '😊', pt: 'Carinhas', en: 'Smileys', list: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 🫠 😉 😊 😇 🥰 😍 🤩 😘 😗 ☺️ 😚 😙 🥲 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🫢 🫣 🤫 🤔 🫡 🤐 🤨 😐 😑 😶 🫥 😏 😒 🙄 😬 😮‍💨 🤥 🫨 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 😵‍💫 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 🫤 😟 🙁 ☹️ 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👺 👻 👽 👾 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾 🙈 🙉 🙊' },
  { id: 'love', icon: '💖', pt: 'Amor e gestos', en: 'Love & hands', list: '💌 💘 💝 💖 💗 💓 💞 💕 💟 ❣️ 💔 ❤️‍🔥 ❤️‍🩹 ❤️ 🩷 🧡 💛 💚 💙 🩵 💜 🤎 🖤 🩶 🤍 💋 💯 💢 💥 💫 💦 💨 🕳️ 💬 💭 💤 👋 🤚 🖐️ ✋ 🖖 🫱 🫲 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 🫵 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 💅 🤳 💪 🫂 👀 👁️ 👅 👄 🫦 💏 💑 👩‍❤️‍👩 👩‍❤️‍💋‍👩' },
  { id: 'nature', icon: '🐱', pt: 'Bichos e natureza', en: 'Animals & nature', list: '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐻‍❄️ 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐴 🦄 🐝 🪲 🐛 🦋 🐌 🐞 🐜 🪰 🦗 🕷️ 🐢 🐍 🦎 🐙 🦑 🦐 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🦭 🐊 🦓 🦒 🐘 🦛 🐪 🦘 🐕 🐩 🐈 🐈‍⬛ 🪶 🐇 🦝 🦔 🌵 🎄 🌲 🌳 🌴 🌱 🌿 ☘️ 🍀 🍃 🍂 🍁 🍄 🌾 💐 🌷 🌹 🥀 🌺 🌸 🌼 🌻 🌞 🌝 🌛 🌜 🌚 🌕 🌙 🌎 🪐 ⭐ 🌟 ✨ ⚡ 🔥 🌈 ☀️ ⛅ ☁️ 🌧️ ⛈️ ❄️ ☃️ 💧 🌊' },
  { id: 'food', icon: '🍓', pt: 'Comidas', en: 'Food', list: '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🍆 🥔 🥕 🌽 🌶️ 🥒 🥬 🥦 🧄 🧅 🥐 🥯 🍞 🥖 🧀 🥚 🍳 🥞 🧇 🥓 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍘 🍥 🥠 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 🍼 ☕ 🍵 🧃 🥤 🧋 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉 🍾 🧊' },
  { id: 'fun', icon: '🎮', pt: 'Atividades', en: 'Activities', list: '⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🥅 ⛳ 🪁 🏹 🎣 🥊 🥋 🛹 🛼 ⛸️ 🎿 🏂 🏋️ 🤸 🧘 🏆 🥇 🥈 🥉 🏅 🎖️ 🎫 🎟️ 🎪 🤹 🎭 🩰 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🪕 🎻 🎲 ♟️ 🎯 🎳 🎮 🕹️ 🎰 🧩 🧸 🪅 🪩 🪄 🎁 🎀 🎊 🎉 🎈 🎏 🎐 🏮 🧧' },
  { id: 'things', icon: '✈️', pt: 'Viagem e coisas', en: 'Travel & objects', list: '🚗 🚕 🚙 🚌 🏎️ 🚓 🚑 🚒 🛵 🏍️ 🚲 🛴 🚨 🚃 🚄 🚅 ✈️ 🛫 🛬 🚀 🛸 🚁 ⛵ 🚤 🛳️ ⚓ 🗺️ 🗽 🗼 🏰 🏯 🎡 🎢 🎠 ⛲ 🏖️ 🏝️ 🏜️ 🌋 ⛰️ 🏔️ 🗻 🏕️ 🏠 🏡 🏢 🏥 🏫 💒 ⛪ 🕌 ⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 💽 💾 💿 📀 📷 📸 📹 🎥 📞 ☎️ 📺 📻 🎙️ ⏰ ⌛ 🔋 🔌 💡 🔦 🕯️ 💸 💵 💰 💳 💎 🔧 🔨 🛠️ 🔑 🗝️ 🔒 🔓 🛏️ 🛋️ 🪑 🚪 🧸 🎁 ✉️ 📦 📝 📚 📖 🔖 📎 ✂️ 📌 📍 🖊️ ✏️ 🔍 🧪 💊 🩹 🧴 🧽 🧼 🪥 🛁 🚿 👑 💍 👓 🕶️ 👗 👠 👟 🧢 🎒 👜 💄' },
  { id: 'symbols', icon: '🔣', pt: 'Símbolos', en: 'Symbols', list: '✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ➗ ✖️ ♾️ ‼️ ⁉️ ❓ ❔ ❕ ❗ 〰️ ➰ ➿ 🔴 🟠 🟡 🟢 🔵 🟣 🟤 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 ⬛ ⬜ 🔶 🔷 🔸 🔹 🔺 🔻 💠 🔘 🔳 🔲 🆗 🆒 🆕 🆓 🆙 🆘 🔝 🔜 🔛 🔚 🔙 ⏩ ⏪ ⏫ ⏬ ▶️ ⏸️ ⏹️ ⏺️ ⏭️ ⏮️ 🔀 🔁 🔂 🔄 🔃 🎵 🎶 ™️ ©️ ®️ 🔅 🔆 📶 🛜 📳 📴 🔇 🔈 🔉 🔊 🔔 🔕 📣 📢 ♀️ ♂️ ⚧️ 🏳️‍🌈 🏳️‍⚧️ 🏴‍☠️ 🇧🇷 🇵🇹 🇯🇵 🇺🇸' },
];
// Algumas palavras para a busca (português e inglês). O resto acha pelo próprio emoji.
const WORDS = {
  '😂': 'rindo chorando risada kkk lol', '🤣': 'rolando de rir kkkk', '😭': 'chorando choro triste cry', '🥰': 'apaixonada amor coracoes love',
  '😍': 'olhos de coracao apaixonada', '😘': 'beijo kiss', '😊': 'feliz sorriso fofa happy', '🥺': 'pidao carente please', '😡': 'brava raiva angry',
  '😴': 'sono dormindo sleep', '🤔': 'pensando hmm think', '😎': 'oculos legal cool', '🙄': 'revirando olhos', '😱': 'grito susto medo',
  '🥳': 'festa aniversario party', '😳': 'vergonha corada', '🤭': 'risadinha ops', '🤗': 'abraco hug', '😏': 'safada maliciosa', '🙃': 'ironia',
  '❤️': 'coracao amor vermelho heart love', '🩷': 'coracao rosa pink', '💜': 'coracao lilas roxo purple', '💖': 'coracao brilhando', '💕': 'dois coracoes',
  '💔': 'coracao partido', '💋': 'beijo boca batom', '👍': 'joinha ok like', '👎': 'nao dislike', '👏': 'palmas aplausos', '🙏': 'por favor obrigada reza',
  '🫶': 'maos coracao amor', '🤝': 'acordo aperto', '💪': 'forca braco', '👀': 'olhos olhando', '🔥': 'fogo quente top', '✨': 'brilho magia',
  '🎉': 'festa confete parabens', '🎂': 'bolo aniversario', '🐱': 'gato gatinho cat', '🐈': 'gato cat', '🐶': 'cachorro dog', '🌸': 'flor rosa sakura',
  '🌹': 'rosa flor', '🍕': 'pizza', '🍫': 'chocolate', '☕': 'cafe coffee', '🍿': 'pipoca filme', '🎬': 'filme cinema', '🎮': 'jogo game videogame',
  '🎧': 'fone musica', '🎵': 'musica nota', '💤': 'sono zzz', '💯': 'cem perfeito', '✅': 'certo feito check', '❌': 'errado x nao',
  '🇧🇷': 'brasil bandeira', '💀': 'morri caveira', '🤡': 'palhaco', '🫠': 'derretendo', '🥹': 'emocionada segurando lagrima', '😮‍💨': 'suspiro alivio',
  '🌙': 'lua noite', '☀️': 'sol dia', '🌈': 'arco iris', '💐': 'buque flores', '🍓': 'morango', '🧋': 'bubble tea cha', '🍷': 'vinho', '🍺': 'cerveja',
};
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function searchEmoji(q) {
  const n = norm(q.trim());
  if (!n) return [];
  const out = [];
  for (const [e, w] of Object.entries(WORDS)) if (norm(w).includes(n)) out.push(e);
  for (const c of EMOJI_CATS) if (norm(c.pt).includes(n) || norm(c.en).includes(n)) out.push(...c.list.split(' ').slice(0, 24));
  return [...new Set(out)].slice(0, 80);
}
export const QUICK = ['❤️', '😂', '😍', '😮', '😢', '👍'];
