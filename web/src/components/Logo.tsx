/**
 * The WorkMars wordmark: WORK in the display serif stacked over MARS in heavy
 * condensed sans, drawn in the current text colour so it works on Chalk Cream
 * and Paddock Olive alike (`onDark` just switches the colour).
 */
export function Logo({ onDark = false, height = 26 }: { onDark?: boolean; height?: number }) {
  return (
    <span className={`wm-word ${onDark ? 'on-dark' : ''}`} style={{ fontSize: height / 1.72 }} role="img" aria-label="WorkMars">
      <span className="wm-word-top" aria-hidden="true">Work</span>
      <span className="wm-word-bot" aria-hidden="true">Mars</span>
    </span>
  );
}

/** The WM monogram: app icon, the guide button and small spaces. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <span className="wm-mono" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
      <b>W</b><i>M</i>
    </span>
  );
}
