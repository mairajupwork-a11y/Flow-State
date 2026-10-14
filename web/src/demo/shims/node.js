// Stubs for server modules that are imported but never used in the browser demo.
export class DatabaseSync { constructor() { throw new Error('Use the browser database adapter.'); } }
export const mkdirSync = () => {};
export const dirname = (p) => String(p).split('/').slice(0, -1).join('/');
export const join = (...p) => p.join('/');
export default {};
