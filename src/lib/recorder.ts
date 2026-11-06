// Запись голосового сообщения с микрофона: Opus в WebM, как в Telegram Desktop.

export interface Recording {
  stop(): Promise<File | null>;
  cancel(): void;
  startedAt: number;
}

export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  const rec = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: 48_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start(250);
  const startedAt = Date.now();
  const release = () => stream.getTracks().forEach((t) => t.stop());
  return {
    startedAt,
    stop: () =>
      new Promise((resolve) => {
        rec.onstop = () => {
          release();
          // слишком короткое нажатие — не отправляем
          if (Date.now() - startedAt < 700 || !chunks.length) return resolve(null);
          resolve(new File(chunks, `Голосовое ${new Date().toLocaleTimeString('ru-RU')}.webm`, { type: 'audio/webm' }));
        };
        rec.stop();
      }),
    cancel: () => {
      rec.onstop = release;
      rec.stop();
    },
  };
}
