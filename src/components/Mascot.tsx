// Светлячок — маскот и логотип Neon (раньше Fizion). Живой: смотрит по сторонам,
// моргает и удивлённо открывает рот. mood:
//  'loop' — вся анимация по кругу (заставка, вход),
//  'look' — только смотрит по сторонам (ожидание),
//  'wow'  — удивлён (нашлось обновление, пришёл подарок),
//  'still' — без анимации (маленькие значки).

export type MascotMood = 'loop' | 'look' | 'wow' | 'still';

export function Mascot({ size = 96, mood = 'loop', bg = '#6D4AFF', spark = '#FFE14D', badge = false }: { size?: number; mood?: MascotMood; bg?: string; spark?: string; badge?: boolean }) {
  return (
    <svg className={`mascot mascot-${mood}`} width={size} height={size} viewBox="0 0 300 300" role="img" aria-label="Светлячок Neon">
      {badge && <rect width="300" height="300" rx="72" fill={bg} />}
      <g className="m-body">
        <path className="m-antenna" d="M150 70 Q150 40 178 28" fill="none" stroke="#FFFFFF" strokeWidth="10" strokeLinecap="round" />
        <circle className="m-glow" cx="184" cy="24" r="22" fill={spark} opacity="0.35" />
        <circle className="m-spark" cx="184" cy="24" r="12" fill={spark} />
        <path d="M60 150 Q60 70 150 70 Q240 70 240 150 V200 Q240 236 210 236 Q196 236 190 256 Q182 236 170 236 H130 Q118 236 110 256 Q104 236 90 236 Q60 236 60 200 Z" fill="#FFFFFF" />
        <g className="m-eyes">
          <ellipse className="m-eye" cx="118" cy="152" rx="17" ry="24" fill={bg} />
          <ellipse className="m-eye" cx="182" cy="152" rx="17" ry="24" fill={bg} />
          <g className="m-pupils">
            <circle cx="124" cy="143" r="5" fill="#FFFFFF" />
            <circle cx="188" cy="143" r="5" fill="#FFFFFF" />
          </g>
        </g>
        <path className="m-smile" d="M132 196 Q150 210 168 196" fill="none" stroke={bg} strokeWidth="8" strokeLinecap="round" />
        <ellipse className="m-mouth" cx="150" cy="203" rx="13" ry="16" fill={bg} />
      </g>
    </svg>
  );
}
