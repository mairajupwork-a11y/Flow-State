/** Browser stand-in for the parts of node:crypto the route modules use. */
export function randomBytes(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return {
    toString(enc) {
      if (enc === 'hex') return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
      const b64 = btoa(String.fromCharCode(...bytes));
      return enc === 'base64url' ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
    },
  };
}
/** Only Google sign-in uses hashing, and it is switched off in the demo. */
export function createHash() {
  throw new Error('Not available in the demo.');
}
