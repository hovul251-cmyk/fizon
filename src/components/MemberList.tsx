import type { Server } from '../types';
import { Avatar, openCard, presenceLabel, usePerson } from './common';

function Member({ userId, roleColor }: { userId: string; roleColor?: string }) {
  const p = usePerson(userId);
  if (!p) return null;
  const off = p.presence === 'offline';
  const sub = p.id === 'me' ? p.status : p.activity || (p.presence === 'dnd' ? presenceLabel.dnd : '');
  return (
    <button type="button" className={`member ${off ? 'off' : ''}`} onClick={(e) => openCard(userId, e)}>
      <Avatar person={p} size={32} />
      <span className="member-text">
        <span className="strong ellipsis" style={p.id === 'me' || !roleColor ? p.nameStyle : { color: roleColor }}>
          {p.name}
        </span>
        {sub && !off && <span className="muted small ellipsis">{sub}</span>}
      </span>
    </button>
  );
}

export function MemberList({ server, presenceOf }: { server: Server; presenceOf: (id: string) => string }) {
  const online = server.members.filter((m) => presenceOf(m.userId) !== 'offline');
  const offline = server.members.filter((m) => presenceOf(m.userId) === 'offline');
  const groups = server.roles
    .map((r) => ({ role: r, list: online.filter((m) => m.roleId === r.id) }))
    .filter((g) => g.list.length);
  return (
    <aside className="members" aria-label="Участники">
      {groups.map(({ role, list }) => (
        <div key={role.id}>
          <div className="cat">
            {role.key === 'everyone' ? 'В СЕТИ' : role.name.toUpperCase()} — {list.length}
          </div>
          {list.map((m) => (
            <Member key={m.userId} userId={m.userId} roleColor={role.key === 'everyone' ? undefined : role.color} />
          ))}
        </div>
      ))}
      {offline.length > 0 && (
        <div>
          <div className="cat">НЕ В СЕТИ — {offline.length}</div>
          {offline.map((m) => (
            <Member key={m.userId} userId={m.userId} />
          ))}
        </div>
      )}
    </aside>
  );
}
