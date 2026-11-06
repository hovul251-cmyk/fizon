// Готовые плагины, которые можно поставить в один клик и использовать как образец для своих.

export interface Example {
  file: string;
  code: string;
}

export const EXAMPLES: Example[] = [
  {
    file: 'dice.js',
    code: `// @name Кубик
// @version 1.0
// @author Fizion
// @description Команда /roll — бросить кубик. /roll 20 — кубик на 20 граней, /roll 2d6 — два кубика.
// @permissions commands

fizion.command('roll', 'Бросить кубик: /roll, /roll 20, /roll 2d6', (args) => {
  const m = /^(\\d+)?d?(\\d+)?$/i.exec(args.trim()) || [];
  const count = args.includes('d') ? Math.min(10, Math.max(1, parseInt(m[1]) || 1)) : 1;
  const sides = Math.min(1000, Math.max(2, parseInt(args.includes('d') ? m[2] : m[1]) || 6));
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
  const sum = rolls.reduce((a, b) => a + b, 0);
  return count > 1
    ? '🎲 ' + rolls.join(' + ') + ' = ' + sum + ' (' + count + 'd' + sides + ')'
    : '🎲 Выпало ' + sum + ' из ' + sides;
});
`,
  },
  {
    file: 'emotes.js',
    code: `// @name Эмоции
// @version 1.0
// @author Fizion
// @description /shrug, /flip, /unflip, /lenny — добавляют смайлик к сообщению.
// @permissions commands

const faces = {
  shrug: ['Пожать плечами', '¯\\\\_(ツ)_/¯'],
  flip: ['Перевернуть стол', '(╯°□°)╯︵ ┻━┻'],
  unflip: ['Поставить стол обратно', '┬─┬ノ( º _ ºノ)'],
  lenny: ['Ленни', '( ͡° ͜ʖ ͡°)'],
};
for (const [name, [title, face]] of Object.entries(faces)) {
  fizion.command(name, title + ' — можно с текстом: /' + name + ' ну такое', (args) => (args ? args + ' ' : '') + face);
}
`,
  },
  {
    file: 'remind.js',
    code: `// @name Напоминалка
// @version 1.0
// @author Fizion
// @description /remind 15 позвонить маме — напомнит через 15 минут (пока приложение открыто).
// @permissions commands

fizion.command('remind', 'Напомнить: /remind 15 текст', (args) => {
  const m = /^(\\d+)\\s*(.*)$/s.exec(args.trim());
  if (!m) {
    fizion.toast('Напиши так: /remind 15 текст');
    return null;
  }
  const minutes = Math.min(24 * 60, parseInt(m[1]));
  const text = m[2] || 'Ты просил напомнить';
  setTimeout(() => fizion.toast('⏰ ' + text), minutes * 60000);
  fizion.toast('Напомню через ' + minutes + ' мин');
  return null; // в чат ничего не отправляем
});
`,
  },
  {
    file: 'stats.js',
    code: `// @name Статистика сообщений
// @version 1.0
// @author Fizion
// @description Считает, сколько сообщений пришло сегодня и в каких чатах больше всего. Данные хранятся только у тебя.
// @permissions messages:read

const today = () => new Date().toDateString();
let s = fizion.storage.get('stats') || { day: today(), total: 0, mine: 0, chats: {} };

function draw() {
  const top = Object.entries(s.chats).sort((a, b) => b[1] - a[1]).slice(0, 5);
  fizion.panel([
    { type: 'title', text: 'Сегодня' },
    { type: 'stat', label: 'Всего сообщений', value: String(s.total) },
    { type: 'stat', label: 'От тебя', value: String(s.mine) },
    { type: 'title', text: 'Самые активные чаты' },
    ...(top.length ? top.map(([chat, n]) => ({ type: 'stat', label: chat, value: String(n) })) : [{ text: 'Пока тихо' }]),
    { type: 'button', label: 'Сбросить', id: 'reset' },
  ]);
}

fizion.on('message', (m) => {
  if (s.day !== today()) s = { day: today(), total: 0, mine: 0, chats: {} };
  s.total++;
  if (m.mine) s.mine++;
  s.chats[m.chat || 'Чат'] = (s.chats[m.chat || 'Чат'] || 0) + 1;
  fizion.storage.set('stats', s);
  draw();
});

fizion.on('button', (id) => {
  if (id === 'reset') {
    s = { day: today(), total: 0, mine: 0, chats: {} };
    fizion.storage.set('stats', s);
    draw();
  }
});

draw();
`,
  },
  {
    file: 'neon.css',
    code: `/* @name Тема «Неон»
   @version 1.0
   @author Fizion
   @description Тёмно-синий фон, бирюзовый акцент и светящиеся пузыри. */

:root {
  --accent: #22d3ee !important;
  --bg0: #050815;
  --panel: #0a1022;
  --bg1: #0e1630;
  --bg3: #16213f;
  --bubble-in: #111a36;
  --line: #18234a;
}
.msg.mine .bubble {
  background: linear-gradient(135deg, #22d3ee, #6366f1) !important;
  box-shadow: 0 0 18px rgba(34, 211, 238, 0.35);
}
.nav-tab.on {
  box-shadow: 0 0 20px rgba(34, 211, 238, 0.5);
}
`,
  },
  {
    file: 'mint.css',
    code: `/* @name Тема «Мята»
   @version 1.0
   @author Fizion
   @description Светлая и спокойная: мятный акцент и белые панели. Работает со светлой темой в настройках. */

:root[data-theme='light'] {
  --accent: #10b981 !important;
  --bg0: #e6f2ee;
  --bubble-in: #eef6f3;
}
:root[data-theme='light'] .msg.mine .bubble {
  background: #10b981 !important;
}
`,
  },
];
