// Звук звонка без файлов: короткие гудки через Web Audio.
// Входящий — мелодия из двух нот, исходящий — длинные гудки.

let ctx: AudioContext | null = null;
let timer: number | undefined;

function beep(freqs: number[], length: number) {
  ctx ??= new AudioContext();
  const now = ctx.currentTime;
  freqs.forEach((f, i) => {
    const o = ctx!.createOscillator();
    const g = ctx!.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    const t = now + i * (length / freqs.length);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.02);
    g.gain.linearRampToValueAtTime(0, t + length / freqs.length - 0.02);
    o.connect(g).connect(ctx!.destination);
    o.start(t);
    o.stop(t + length / freqs.length);
  });
}

export function startRing(kind: 'in' | 'out') {
  stopRing();
  const play = () => (kind === 'in' ? beep([880, 660, 880, 660], 0.9) : beep([425], 1));
  try {
    play();
    timer = window.setInterval(play, kind === 'in' ? 2000 : 4000);
  } catch {
    /* звук недоступен — звонок всё равно показывается */
  }
}

export function stopRing() {
  window.clearInterval(timer);
  timer = undefined;
}
