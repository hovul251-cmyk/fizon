import { useEffect, useState, useSyncExternalStore } from 'react';
import { ONLINE as IS_ONLINE } from '../lib/appwrite';
import * as remote from '../online/remote';
import { useStore } from '../store';

/** Этот чат шифруется (личные — ключи есть у обоих, группа — у всех участников) */
export function useEncrypted(chatId: string) {
  const [on, setOn] = useState(false);
  const e2eState = useSyncExternalStore(IS_ONLINE ? remote.onEncryptionChange : noop, IS_ONLINE ? remote.encryptionState : off);
  const members = useStore((s) => (chatId.startsWith('g:') ? s.groups.find((g) => g.id === chatId.slice(2))?.members.join(',') : ''));
  useEffect(() => {
    setOn(false);
    if (!IS_ONLINE || chatId === 'friends') return;
    let alive = true;
    void remote.willSeal(chatId.startsWith('g:') ? chatId : `dm:${chatId}`).then((v) => alive && setOn(v));
    return () => {
      alive = false;
    };
  }, [chatId, e2eState, members]);
  return on;
}
const noop = () => () => undefined;
const off = () => 'off' as const;
