import day from '../assets/harbor-scene.svg';
import dusk from '../assets/harbor-dusk.svg';

/**
 * Illustrated Martian-harbour banners used behind banner-style panels
 * (project heroes, the team banner, the sidebar card). `focus` keeps the
 * busy right-hand side of the drawing in view; text sits over the left.
 */
export const SCENES = [
  { src: day, focus: '72% 100%' }, // daytime harbour: domes, brick houses, a crane and strollers on the quay
  { src: dusk, focus: '72% 100%' }, // evening harbour: two moons, stars and a moored rocket-boat
] as const;

/** A stable scene per id, so each project keeps the same drawing. */
export const sceneFor = (id: number) => SCENES[Math.abs(id - 1) % SCENES.length];

/** CSS custom properties for a `.scene` panel. */
export const sceneStyle = (scene: (typeof SCENES)[number]) => ({ '--scene': `url(${scene.src})`, '--scene-pos': scene.focus });
