import canyon from '../assets/mars-canyon.webp';
import dunes from '../assets/mars-dunes.webp';

/**
 * Martian landscape photos used as backdrops for banner-style panels
 * (project heroes, the team banner, the sidebar card, landing bands).
 * `focus` is the background-position that keeps each photo's subject in view.
 */
export const SCENES = [
  { src: canyon, focus: '50% 92%' }, // explorer walking beneath a red canyon wall
  { src: dunes, focus: '50% 55%' }, // rocky desert ridges under a hazy sky
] as const;

/** A stable scene per id, so each project keeps the same photo. */
export const sceneFor = (id: number) => SCENES[Math.abs(id - 1) % SCENES.length];

/** CSS custom properties for a `.scene` panel. */
export const sceneStyle = (scene: (typeof SCENES)[number]) => ({ '--scene': `url(${scene.src})`, '--scene-pos': scene.focus });
