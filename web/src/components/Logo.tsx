import { PlanetMark } from '../features/auth/harbor/Art';

/**
 * The WorkMars logo: a little ringed planet on a charcoal tile, then the
 * wordmark in the house sans. `onDark` keeps the word light on dark grounds.
 */
export function Logo({ onDark = false, height = 26 }: { onDark?: boolean; height?: number }) {
  return (
    <span className={`wm-word ${onDark ? 'on-dark' : ''}`} style={{ fontSize: height * 0.66 }} role="img" aria-label="WorkMars">
      <PlanetMark size={height} />
      <span className="wm-word-text" aria-hidden="true">Work<b>Mars</b></span>
    </span>
  );
}

/** The monogram tile on its own: app icon, the guide button and small spaces. */
export function Mark({ size = 28 }: { size?: number }) {
  return <span className="wm-mono" style={{ width: size, height: size }} aria-hidden="true"><PlanetMark size={size} /></span>;
}
