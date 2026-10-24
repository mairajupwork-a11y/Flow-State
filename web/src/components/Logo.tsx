import logoLight from '../assets/workmars-logo.webp';
import logoDark from '../assets/workmars-logo-dark.webp';
import mark from '../assets/workmars-mark.webp';

/**
 * The WorkMars wordmark. Both versions are rendered and CSS shows the right
 * one: charcoal letters on light surfaces, cream letters in dark mode or on
 * dark panels (`onDark`). The planet and orange are the same in both.
 */
export function Logo({ onDark = false, height = 26 }: { onDark?: boolean; height?: number }) {
  return (
    <span className={`wm-logo ${onDark ? 'on-dark' : ''}`} style={{ height }}>
      {/* The hidden version is display:none, so screen readers announce the name once. */}
      <img className="wm-logo-light" src={logoLight} alt="WorkMars" height={height} />
      <img className="wm-logo-dark" src={logoDark} alt="WorkMars" height={height} />
    </span>
  );
}

/** The planet on its own: app icon, small spaces and decorative accents. */
export function Mark({ size = 28 }: { size?: number }) {
  return <img className="wm-mark" src={mark} alt="" aria-hidden="true" width={Math.round(size * 1.27)} height={size} />;
}
