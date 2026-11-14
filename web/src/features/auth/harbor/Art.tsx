/**
 * Original hand-drawn artwork for the Harbor design: a Martian harbour where
 * little astronauts stroll the quay, a rocket-boat bobs in the canal and small
 * critters perch on the product shots. Outlines use the `o` class so they
 * follow the theme; fills use the cartoon palette.
 */
import type { CSSProperties, ReactNode } from 'react';

const C = { ink: 'var(--art-ink)', paper: 'var(--art-paper)', mars: '#e8643c', marsSoft: '#f7b79c', sun: '#f6c94e', sea: '#5fa8d3', seaSoft: '#bfe0f1', mint: '#79c39a', mintDeep: '#4f9e74', lilac: '#a993ec', brick: '#d9573b', sand: '#f3d9b8', stone: '#e6dccd' };

/** One astronaut, about 46 units tall, feet at y=0. `carry` puts something in their hands. */
function Astronaut({ suit = '#fff', pack = C.mars, visor = C.sea, carry }: { suit?: string; pack?: string; visor?: string; carry?: 'card' | 'flag' | 'box' | 'none' }) {
  return (
    <g className="hb-astro">
      <g className="hb-leg hb-leg-b"><path className="o" d="M-3 -14 L-4 -2" style={{ stroke: suit, strokeWidth: 5.5 }} /><path className="o-thin" d="M-3 -14 L-4 -2" /><ellipse cx="-4.5" cy="-1.5" rx="4" ry="2.2" className="o-fill" /></g>
      <rect x="-12" y="-36" width="7" height="15" rx="3" fill={pack} className="o" />
      <rect x="-8" y="-38" width="16" height="25" rx="7" fill={suit} className="o" />
      <path d="M-8 -22 h16" className="o-thin" />
      <circle cx="0" cy="-45" r="9.5" fill={suit} className="o" />
      <path d="M-2 -50 q7 -1 8 5 q-1 6 -8 5 q-3 -5 0 -10z" fill={visor} className="o" />
      <path d="M1 -48 q2 0 3 2" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <g className="hb-leg hb-leg-f"><path className="o" d="M3 -14 L4 -2" style={{ stroke: suit, strokeWidth: 5.5 }} /><path className="o-thin" d="M3 -14 L4 -2" /><ellipse cx="5" cy="-1.5" rx="4" ry="2.2" className="o-fill" /></g>
      <path d="M6 -32 q6 4 8 9" className="o" fill="none" />
      {carry === 'card' && <g transform="translate(12 -30) rotate(-8)"><rect width="13" height="11" rx="1.5" fill={C.sun} className="o" /><path d="M3 4h7M3 7h5" className="o-thin" /></g>}
      {carry === 'flag' && <g><path d="M14 -24 V-62" className="o" /><path d="M14 -62 q8 3 14 0 q-2 6 0 11 q-6 3 -14 0z" fill={C.mars} className="o" /></g>}
      {carry === 'box' && <g transform="translate(9 -30)"><rect width="15" height="12" rx="2" fill={C.sand} className="o" /><path d="M0 4h15M7.5 0v4" className="o-thin" /></g>}
    </g>
  );
}

/** A little dog in a bubble helmet. */
function SpaceDog() {
  return (
    <g className="hb-astro">
      <g className="hb-leg hb-leg-b"><path d="M-8 -6 v6 M4 -6 v6" className="o" style={{ strokeWidth: 2.6 }} /></g>
      <path d="M-12 -14 q0 -8 10 -8 h8 q7 0 7 7 v3 q0 6 -7 6 h-12 q-6 0 -6 -8z" fill={C.sand} className="o" />
      <path d="M-12 -14 q-6 -6 -8 -1" className="o hb-tail" fill="none" />
      <circle cx="10" cy="-24" r="10" fill={C.seaSoft} fillOpacity=".45" className="o" />
      <path d="M6 -26 q2 -7 7 -3 q3 3 0 8 q-4 4 -7 -1z" fill={C.sand} className="o-thin" />
      <path d="M7 -29 l-2 -5 l4 2" fill={C.brick} className="o-thin" />
      <circle cx="11" cy="-25" r="1.2" className="o-dot" />
      <g className="hb-leg hb-leg-f"><path d="M-4 -6 v6 M8 -6 v6" className="o" style={{ strokeWidth: 2.6 }} /></g>
    </g>
  );
}

/** Boxy rover pushing a cart of sticky notes. */
function Rover() {
  return (
    <g>
      <rect x="-30" y="-26" width="26" height="16" rx="3" fill={C.sand} className="o" />
      {[C.sun, C.mint, C.lilac].map((c, i) => <rect key={i} x={-28 + i * 8} y={-34 + (i % 2) * 2} width="7" height="9" rx="1" fill={c} className="o-thin" transform={`rotate(${-6 + i * 6} ${-24 + i * 8} -30)`} />)}
      <rect x="-2" y="-30" width="26" height="20" rx="5" fill={C.paper} className="o" />
      <rect x="4" y="-44" width="14" height="12" rx="3" fill={C.paper} className="o" />
      <circle cx="11" cy="-38" r="3.5" fill={C.sea} className="o-thin" />
      <path d="M11 -44 v-8" className="o-thin" /><circle cx="11" cy="-53" r="2" fill={C.mars} className="o-thin hb-blink" />
      <path d="M-4 -18 h-2" className="o" />
      {[-24, -10, 4, 18].map((x) => <g key={x} className="hb-wheel" style={{ transformOrigin: `${x}px -6px` }}><circle cx={x} cy="-6" r="5.5" fill="#fff" className="o" /><path d={`M${x - 3} -6 h6`} className="o-thin" /></g>)}
    </g>
  );
}

/** Street lamp with a soft glow. */
const Lamp = ({ x }: { x: number }) => (
  <g transform={`translate(${x} 0)`}>
    <circle cx="0" cy="-74" r="14" fill={C.sun} opacity=".25" className="hb-glow" />
    <path d="M0 0 V-66 q0 -8 8 -8" className="o" fill="none" />
    <path d="M4 -76 h9 l-2 6 h-5z" fill={C.sun} className="o-thin" />
    <path d="M-4 0 h8" className="o" />
  </g>
);

const Bollard = ({ x }: { x: number }) => (
  <g transform={`translate(${x} 0)`}><rect x="-5" y="-12" width="10" height="12" rx="4" fill={C.stone} className="o-thin" /><path d="M-6 -9 h12" className="o-thin" /></g>
);

/** Dome greenhouse with a little tree inside. */
const Dome = ({ x, r = 34, tree = C.mint }: { x: number; r?: number; tree?: string }) => (
  <g transform={`translate(${x} 0)`}>
    <path d={`M${-r} 0 a${r} ${r} 0 0 1 ${2 * r} 0z`} fill={C.seaSoft} fillOpacity=".55" className="o" />
    <path d={`M${-r * 0.55} ${-r * 0.82} q${r * 0.2} ${-r * 0.18} ${r * 0.45} ${-r * 0.2}`} stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    <path d={`M0 0 v${-r * 0.42}`} className="o-thin" />
    <circle cx="0" cy={-r * 0.6} r={r * 0.32} fill={tree} className="o-thin" />
    <path d={`M${-r} 0 a${r} ${r} 0 0 1 ${2 * r} 0`} fill="none" className="o-thin" strokeDasharray="0 0" />
  </g>
);

/** Brick house with windows and a flat roof. */
const House = ({ x, w = 54, h = 62, color = C.brick, windows = 2 }: { x: number; w?: number; h?: number; color?: string; windows?: number }) => (
  <g transform={`translate(${x} 0)`}>
    <rect x={-w / 2} y={-h} width={w} height={h} rx="3" fill={color} className="o" />
    <path d={`M${-w / 2 - 4} ${-h} h${w + 8}`} className="o" />
    {Array.from({ length: windows }, (_, r) => [0, 1].map((c) => (
      <rect key={`${r}-${c}`} x={-w / 2 + 9 + c * (w / 2 - 4)} y={-h + 12 + r * 22} width={w / 2 - 14} height="12" rx="2" fill={C.sun} className="o-thin hb-window" style={{ '--wd': `${(r * 2 + c) * 0.7}s` } as CSSProperties} />
    )))}
  </g>
);

/** The rocket-boat moored in the canal. */
function RocketBoat() {
  return (
    <g className="hb-bob">
      <path d="M-46 -6 q46 18 92 0 l-6 -12 h-80z" fill="#fff" className="o" />
      <path d="M-40 -12 h80" className="o-thin" />
      <path d="M-4 -18 v-30 q4 -14 8 0 v30z" fill={C.paper} className="o" />
      <circle cx="0" cy="-34" r="3" fill={C.sea} className="o-thin" />
      <path d="M-4 -24 l-8 6 h8 M4 -24 l8 6 h-8" fill={C.mars} className="o-thin" />
      <path d="M6 -52 q14 6 24 2" className="o hb-pennant" fill="none" style={{ stroke: C.mars, strokeWidth: 3 }} />
    </g>
  );
}

/** A drone-bird flapping across the sky. */
const Bird = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}><g className="hb-flap"><path d="M-10 0 q5 -7 10 0 q5 -7 10 0" className="o" fill="none" /></g></g>
);

/** Hero: the long quay with people walking, lamps, domes and the canal. */
export function QuayScene() {
  return (
    <svg className="hb-quay" viewBox="0 0 1440 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <pattern id="hb-stones" width="56" height="22" patternUnits="userSpaceOnUse">
          <path d="M0 21 H56 M28 0 V11 M0 11 H56 M10 11 V22 M44 11 V22" className="o-faint" fill="none" />
        </pattern>
      </defs>
      {/* far mesas */}
      <path d="M0 186 q90 -46 180 -30 t200 -8 q60 -30 130 -10 t180 6 q70 -40 160 -16 t200 0 q80 -30 170 -4 t120 10 V230 H0z" fill={C.marsSoft} opacity=".55" />
      <path d="M0 200 q120 -24 240 -10 t260 -4 t300 6 t320 -10 t320 8 V232 H0z" fill={C.marsSoft} opacity=".8" />
      {/* domes + houses skyline */}
      <g transform="translate(0 232)">
        <Dome x={96} r={30} />
        <House x={170} w={48} h={70} color={C.brick} />
        <House x={226} w={40} h={50} color={C.sun} windows={1} />
        <Dome x={1180} r={40} tree={C.mintDeep} />
        <House x={1262} w={52} h={82} color={C.brick} windows={3} />
        <House x={1320} w={44} h={58} color={C.lilac} />
        <Dome x={1392} r={26} />
      </g>
      {/* canal */}
      <rect x="0" y="232" width="1440" height="20" fill={C.seaSoft} />
      <path className="hb-waves" d="M0 242 q15 -4 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0" fill="none" stroke="#fff" strokeWidth="1.6" opacity=".8" />
      <g transform="translate(1060 244)"><RocketBoat /></g>
      {/* quay */}
      <rect x="0" y="252" width="1440" height="48" fill={C.stone} />
      <rect x="0" y="252" width="1440" height="48" fill="url(#hb-stones)" />
      <path d="M0 252 H1440" className="o" />
      <g transform="translate(0 252)">{[60, 420, 780, 1140].map((x) => <Lamp key={x} x={x} />)}</g>
      <g transform="translate(0 252)">{[240, 600, 960, 1320].map((x) => <Bollard key={x} x={x} />)}</g>
      {/* the crane lifting a card off the boat */}
      <g transform="translate(930 252)">
        <path d="M0 0 V-118 H74" className="o" fill="none" style={{ strokeWidth: 2.6 }} />
        <path d="M0 -96 L22 -118 M0 -74 L44 -118" className="o-thin" />
        <g className="hb-swing"><path d="M70 -118 V-74" className="o-thin" /><g transform="translate(70 -74)"><rect x="-13" y="0" width="26" height="22" rx="2" fill={C.sun} className="o" /><path d="M-7 8h14M-7 14h9" className="o-thin" /></g></g>
      </g>
      {/* birds */}
      <g className="hb-birds"><Bird x={320} y={70} /><Bird x={352} y={84} s={0.7} /><Bird x={1010} y={52} s={0.8} /></g>
      {/* people strolling */}
      <g transform="translate(0 252)">
        <g className="hb-walk" style={{ '--dur': '68s', '--delay': '-6s' } as CSSProperties}><Astronaut carry="card" /></g>
        <g className="hb-walk" style={{ '--dur': '74s', '--delay': '-30s' } as CSSProperties}><g transform="translate(-34 0)"><SpaceDog /></g><Astronaut suit="#fff" pack={C.lilac} visor={C.mint} /></g>
        <g className="hb-walk back" style={{ '--dur': '82s', '--delay': '-18s' } as CSSProperties}><Astronaut pack={C.sun} visor={C.mars} carry="box" /></g>
        <g className="hb-walk back" style={{ '--dur': '96s', '--delay': '-60s' } as CSSProperties}><Rover /></g>
        <g className="hb-walk" style={{ '--dur': '88s', '--delay': '-48s' } as CSSProperties}><Astronaut pack={C.mint} visor={C.lilac} carry="flag" /></g>
        <g transform="translate(520 0)" className="hb-wave-hello"><Astronaut pack={C.brick} carry="none" /></g>
      </g>
    </svg>
  );
}

/** Footer: a watercolour Martian village around the harbour, with a sketched outline layer on top. */
export function Village() {
  return (
    <svg className="hb-village" viewBox="0 0 1440 360" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <filter id="hb-wc" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="10" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feGaussianBlur in="d" stdDeviation="0.8" />
        </filter>
        <filter id="hb-grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="2" /><feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.4  0 0 0 0 0.3  0 0 0 .07 0" /><feComposite in2="SourceGraphic" operator="in" /></filter>
        <linearGradient id="hb-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fde7d6" stopOpacity="0" /><stop offset="1" stopColor="#fcd9c3" stopOpacity=".9" /></linearGradient>
      </defs>
      <rect width="1440" height="360" fill="url(#hb-sky)" />
      <g filter="url(#hb-wc)">
        <circle cx="1210" cy="70" r="26" fill={C.sun} opacity=".75" />
        <circle cx="1262" cy="108" r="11" fill={C.marsSoft} opacity=".8" />
        <path d="M0 210 q140 -90 300 -50 t320 -30 t300 20 t280 -40 t240 30 V300 H0z" fill={C.marsSoft} opacity=".55" />
        <path d="M0 236 q180 -50 360 -26 t380 -12 t360 10 t340 -16 V300 H0z" fill="#ee9b78" opacity=".45" />
        {/* hillside houses */}
        {[[90, 70, 64, C.brick], [150, 50, 46, '#e98a5d'], [206, 64, 80, C.brick], [262, 44, 54, C.sun], [330, 58, 66, '#e98a5d'], [1040, 60, 72, C.brick], [1100, 46, 52, C.sun], [1156, 70, 90, C.brick], [1220, 50, 60, '#e98a5d'], [1290, 64, 70, C.lilac], [1350, 52, 56, C.brick]].map(([x, w, h, c], i) => (
          <rect key={i} x={(x as number) - (w as number) / 2} y={286 - (h as number)} width={w as number} height={h as number} fill={c as string} opacity=".85" />
        ))}
        {[[420, 60], [520, 42], [880, 54], [960, 38]].map(([x, r], i) => <path key={i} d={`M${x - r} 286 a${r} ${r} 0 0 1 ${2 * r} 0z`} fill={C.seaSoft} opacity=".75" />)}
        {[[380, 40], [470, 52], [560, 36], [700, 48], [820, 40], [1000, 44], [1400, 46]].map(([x, h], i) => <ellipse key={i} cx={x} cy={286 - h / 2 - 6} rx="12" ry={h / 2 + 4} fill={i % 2 ? C.mintDeep : C.mint} opacity=".8" />)}
        <rect x="0" y="286" width="1440" height="74" fill={C.sea} opacity=".38" />
        <rect x="0" y="300" width="1440" height="60" fill={C.sea} opacity=".25" />
        {[[180, 30], [1150, 40], [640, 26]].map(([x, w], i) => <rect key={i} x={x} y={296 + i * 8} width={w} height="4" fill={C.brick} opacity=".35" />)}
      </g>
      <rect y="150" width="1440" height="210" filter="url(#hb-grain)" />
      {/* sketch layer */}
      <g className="hb-sketch">
        {[[90, 70, 64], [206, 64, 80], [1156, 70, 90], [1290, 64, 70]].map(([x, w, h], i) => (
          <g key={i}><path d={`M${x - w / 2 + 2} ${286 - h} h${w - 3} M${x - w / 2} ${287 - h} v${h - 2}`} className="o-sketch" />
            {[0, 1].map((r) => <path key={r} d={`M${x - w / 2 + 10} ${300 - h + 4 + r * 24} h10 v10 h-10z M${x + 4} ${300 - h + 4 + r * 24} h10 v10 h-10z`} className="o-sketch" />)}</g>
        ))}
        <path d="M420 286 a60 60 0 0 1 120 0 M880 286 a54 54 0 0 1 108 0" className="o-sketch" />
        <path d="M0 287 C300 284 600 289 900 286 S1300 285 1440 287" className="o-sketch" />
        {/* lighthouse */}
        <g transform="translate(760 286)">
          <path d="M-12 0 l4 -86 h16 l4 86z" fill="#fff" className="o" />
          <path d="M-10 -30 h20 M-9 -58 h18" stroke={C.brick} strokeWidth="6" />
          <rect x="-10" y="-100" width="20" height="14" rx="2" fill={C.sun} className="o" />
          <path d="M-12 -100 q12 -14 24 0z" fill={C.brick} className="o" />
          <path className="hb-beam" d="M10 -94 L140 -120 L140 -70z" fill={C.sun} opacity=".35" />
        </g>
        <g transform="translate(600 318)"><RocketBoat /></g>
        <g className="hb-birds"><Bird x={520} y={120} /><Bird x={548} y={132} s={0.7} /><Bird x={980} y={96} s={0.8} /></g>
      </g>
    </svg>
  );
}

/** Small animals perched on product shots. */
export function Critter({ kind, className = '', style }: { kind: 'cat' | 'bird' | 'snail' | 'alien'; className?: string; style?: CSSProperties }) {
  const art: Record<typeof kind, ReactNode> = {
    cat: (
      <g>
        <path className="o hb-tail" d="M52 54 q22 -4 18 -26 q-2 -10 6 -12" fill="none" style={{ stroke: C.mars, strokeWidth: 5 }} />
        <path className="o-thin hb-tail" d="M52 54 q22 -4 18 -26 q-2 -10 6 -12" fill="none" />
        <path d="M14 60 q-2 -28 22 -30 q24 2 22 30z" fill={C.mars} className="o" />
        <circle cx="34" cy="20" r="17" fill={C.seaSoft} fillOpacity=".5" className="o" />
        <path d="M22 22 q0 -12 12 -12 q12 0 12 12 q0 10 -12 10 q-12 0 -12 -10z" fill={C.mars} className="o-thin" />
        <path d="M24 13 l-1 -8 l7 5 M44 13 l1 -8 l-7 5" fill={C.mars} className="o-thin" />
        <g className="hb-blink-eyes"><circle cx="30" cy="20" r="1.8" className="o-dot" /><circle cx="38" cy="20" r="1.8" className="o-dot" /></g>
        <path d="M32 25 q2 2 4 0" className="o-thin" fill="none" />
        <path d="M27 8 q7 -4 14 0" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
      </g>
    ),
    bird: (
      <g>
        <path d="M18 50 q-4 -26 20 -28 q18 0 20 16 q2 14 -12 16z" fill={C.sun} className="o" />
        <path d="M54 30 l12 4 l-12 4z" fill={C.mars} className="o-thin" />
        <circle cx="46" cy="30" r="2" className="o-dot hb-blink-eyes" />
        <g className="hb-flap-wing"><path d="M28 36 q-10 6 -6 16 q10 -2 14 -10z" fill={C.marsSoft} className="o-thin" /></g>
        <path d="M30 54 v6 M40 54 v6" className="o-thin" />
        <path d="M40 22 v-8" className="o-thin" /><circle cx="40" cy="12" r="2.5" fill={C.sea} className="o-thin hb-blink" />
      </g>
    ),
    snail: (
      <g>
        <path d="M6 58 h52 q6 0 6 -6 q-10 2 -14 -4" fill={C.sand} className="o" />
        <circle cx="32" cy="40" r="17" fill={C.lilac} className="o" />
        <path d="M32 40 m-9 0 a9 9 0 1 0 9 -9 a5 5 0 1 0 5 5" fill="none" className="o-thin" />
        <path d="M54 50 l-2 -14 M60 52 l2 -14" className="o-thin" /><circle cx="52" cy="35" r="2.2" className="o-dot" /><circle cx="62" cy="37" r="2.2" className="o-dot" />
      </g>
    ),
    alien: (
      <g className="hb-hop">
        <path d="M16 60 q-4 -30 18 -32 q22 2 18 32z" fill={C.mint} className="o" />
        <circle cx="34" cy="38" r="7" fill="#fff" className="o-thin" /><circle cx="35" cy="38" r="3" className="o-dot hb-look" />
        <path d="M24 30 l-6 -14 M44 30 l6 -14" className="o-thin" /><circle cx="18" cy="15" r="3" fill={C.sun} className="o-thin" /><circle cx="50" cy="15" r="3" fill={C.mars} className="o-thin" />
        <path d="M28 50 q6 5 12 0" className="o-thin" fill="none" />
      </g>
    ),
  };
  return <svg className={`hb-critter ${className}`} viewBox="0 0 80 64" style={style} aria-hidden="true">{art[kind]}</svg>;
}

/** Hand-drawn marks for annotations. */
export function Doodle({ kind, className = '' }: { kind: 'arrow' | 'curl' | 'star' | 'sparkle' | 'underline' | 'circle'; className?: string }) {
  const d: Record<typeof kind, ReactNode> = {
    arrow: <><path d="M6 10 C 30 4, 58 14, 70 40" /><path d="M58 36 l12 5 l2 -13" /></>,
    curl: <><path d="M4 30 C 20 4, 44 4, 40 20 C 36 34, 18 26, 30 14 C 42 2, 62 10, 74 34" /><path d="M64 32 l10 3 l1 -11" /></>,
    star: <path d="M40 6 l8 20 l22 2 l-17 14 l6 22 l-19 -12 l-19 12 l6 -22 l-17 -14 l22 -2z" />,
    sparkle: <><path d="M40 4 v20 M40 52 v20 M4 38 h20 M56 38 h20" /><path d="M24 22 l6 6 M50 48 l6 6 M56 22 l-6 6 M24 54 l6 -6" /></>,
    underline: <path d="M4 14 C 40 6, 90 4, 156 10 C 120 12, 70 16, 30 22" />,
    circle: <path d="M80 8 C 30 4, 6 20, 10 36 C 14 52, 70 58, 120 50 C 160 44, 156 14, 110 8 C 90 6, 60 8, 46 12" />,
  };
  const vb = kind === 'underline' ? '0 0 160 26' : kind === 'circle' ? '0 0 170 62' : '0 0 80 76';
  return <svg className={`hb-doodle hb-doodle-${kind} ${className}`} viewBox={vb} aria-hidden="true">{d[kind]}</svg>;
}

/** Tiny spot illustrations for the four setup tiles. */
export function Spot({ kind }: { kind: 'rocket' | 'crew' | 'compass' | 'plug' }) {
  const s: Record<typeof kind, ReactNode> = {
    rocket: <g className="hb-float"><path d="M40 10 q14 12 12 34 h-24 q-2 -22 12 -34z" fill="#fff" className="o" /><circle cx="40" cy="28" r="5" fill={C.sea} className="o-thin" /><path d="M28 36 l-8 12 h8 M52 36 l8 12 h-8" fill={C.mars} className="o-thin" /><path d="M34 46 q6 14 12 0" fill={C.sun} className="o-thin hb-flame" /></g>,
    crew: <g>{[[22, C.mars], [40, C.sun], [58, C.lilac]].map(([x, c], i) => <g key={i} transform={`translate(${x} ${56 - (i === 1 ? 6 : 0)})`}><rect x="-8" y="-22" width="16" height="20" rx="7" fill="#fff" className="o" /><circle cx="0" cy="-28" r="8" fill="#fff" className="o" /><path d="M-3 -32 q6 -1 7 4 q-1 5 -7 4z" fill={c as string} className="o-thin" /></g>)}</g>,
    compass: <g className="hb-spin-slow"><circle cx="40" cy="36" r="22" fill="#fff" className="o" /><path d="M40 18 l6 18 l-6 18 l-6 -18z" fill={C.mars} className="o-thin" /><path d="M40 36 l-6 18 l6 0z" fill={C.seaSoft} className="o-thin" /><circle cx="40" cy="36" r="3" fill={C.sun} className="o-thin" /></g>,
    plug: <g><path d="M18 40 h14 q4 -12 16 -12 h6 v24 h-6 q-12 0 -16 -12" fill={C.mint} className="o" /><path d="M54 32 h10 M54 48 h10" className="o" /><path d="M6 40 h12" className="o" /><g className="hb-zap"><path d="M30 16 l-4 8 h6 l-4 8" className="o-thin" fill="none" style={{ stroke: C.sun, strokeWidth: 2.5 }} /></g></g>,
  };
  return <svg className="hb-spot" viewBox="0 0 80 72" aria-hidden="true">{s[kind]}</svg>;
}

/** Brand mark: a little ringed planet on a charcoal tile. */
export function PlanetMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="hb-planet" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="11" fill="var(--hb-tile, #2b2b2b)" />
      <circle cx="20" cy="21" r="9" fill="#e8643c" />
      <path d="M14 18 q3 -3 7 -2" stroke="#f7b79c" strokeWidth="2" fill="none" strokeLinecap="round" />
      <ellipse cx="20" cy="22" rx="15" ry="4.5" fill="none" stroke="#f6c94e" strokeWidth="2.2" transform="rotate(-16 20 22)" />
      <path d="M11.5 18.6 a9 9 0 0 1 17 0" fill="#e8643c" />
      <circle cx="31" cy="9" r="1.6" fill="#faf9f8" />
    </svg>
  );
}
