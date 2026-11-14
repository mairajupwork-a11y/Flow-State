import logoDark from '../assets/brand/logo.webp';
import logoLight from '../assets/brand/logo-light.webp';
import markImg from '../assets/brand/mark.webp';

/**
 * The WorkMars logo: the WORK / MARS wordmark with Mars and its orbit. `onDark` switches to
 * the cream-lettered version for dark backgrounds. `height` is the logo's height in pixels.
 */
export function Logo({ onDark = false, height = 26 }: { onDark?: boolean; height?: number }) {
  const h = Math.round(height * 1.7);
  // Both versions are rendered; CSS shows the right one for the background (and for dark theme).
  return (
    <span className={`wm-logo ${onDark ? 'dark-bg' : ''}`} role="img" aria-label="WorkMars" style={{ height: h }}>
      <img className="for-light" src={logoDark} alt="" height={h} draggable={false} />
      <img className="for-dark" src={logoLight} alt="" height={h} draggable={false} />
    </span>
  );
}

/** The planet-and-orbit mark on its own, for small square spaces. */
export function Mark({ size = 28 }: { size?: number }) {
  return <img className="wm-mark-img" src={markImg} alt="" aria-hidden="true" width={size} height={size} style={{ width: size, height: size }} draggable={false} />;
}
