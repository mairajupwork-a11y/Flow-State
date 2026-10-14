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
