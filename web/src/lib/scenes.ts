import desert from '../assets/mars-desert.webp';
import hills from '../assets/mars-explorer-hills.webp';

/**
 * Martian landscape photos used as backdrops for banner-style panels
 * (project heroes, the team banner, the sidebar card, landing bands).
 * `focus` is the background-position that keeps each photo's subject in view.
 */
export const SCENES = [
  { src: desert, focus: '50% 36%' }, // rocky desert dunes and distant ridges under a soft sky
  { src: hills, focus: '50% 44%' }, // explorer standing between two rust-coloured hills
] as const;

/** A stable scene per id, so each project keeps the same photo. */
export const sceneFor = (id: number) => SCENES[Math.abs(id - 1) % SCENES.length];

/** CSS custom properties for a `.scene` panel. */
export const sceneStyle = (scene: (typeof SCENES)[number]) => ({ '--scene': `url(${scene.src})`, '--scene-pos': scene.focus });
