import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// fileURLToPath gives a real path on every OS (URL.pathname yields "/C:/..." on Windows).
const demo = (p: string) => fileURLToPath(new URL(`./src/demo/${p}`, import.meta.url));

/**
 * `vite build --mode demo` bundles the real server routes into the browser.
 * This plugin swaps the few Node-only modules they touch for browser shims.
 */
function browserBackend(): Plugin {
  const serverAuth = fileURLToPath(new URL('../server/src/auth.js', import.meta.url));
  const swaps: Record<string, string> = {
    express: demo('shims/express.js'),
    'node:crypto': demo('shims/crypto.js'),
    'node:sqlite': demo('shims/node.js'),
    'node:fs': demo('shims/node.js'),
    'node:path': demo('shims/node.js'),
  };
  return {
    name: 'flowstate-browser-backend',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (swaps[source]) return swaps[source];
      if (importer && source.endsWith('/auth.js') && importer.replace(/\\/g, '/').includes('/server/src/')) {
        const r = await this.resolve(source, importer, { skipSelf: true });
        if (r && r.id.replace(/\\/g, '/') === serverAuth.replace(/\\/g, '/')) return demo('auth.js');
      }
      return null;
    },
  };
}

/** Normal builds talk to the real API, so the demo backend is replaced by a stub. */
function stubDemoBackend(): Plugin {
  return {
    name: 'flowstate-stub-demo-backend',
    enforce: 'pre',
    resolveId: (source) => (source.endsWith('/demo/backend.js') ? demo('stub.js') : null),
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), mode === 'demo' ? browserBackend() : stubDemoBackend()],
  base: mode === 'demo' ? './' : '/',
  server: {
    // Listen on 127.0.0.1 explicitly: on Windows, Node may otherwise bind only
    // to IPv6 (::1), which some browsers and extensions don't reach.
    host: '127.0.0.1',
    port: 5173,
    // Fail loudly instead of silently moving to 5174 when an old copy is still running.
    strictPort: true,
    // 127.0.0.1 avoids Windows resolving localhost to IPv6 first.
    proxy: { '/api': { target: 'http://127.0.0.1:4000', changeOrigin: false } },
  },
  build: {
    target: 'es2022',
    outDir: mode === 'demo' ? 'dist-demo' : 'dist',
    sourcemap: mode !== 'demo',
    rollupOptions: {
      output: {
        manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], data: ['@tanstack/react-query'], dnd: ['@dnd-kit/core', '@dnd-kit/sortable'] },
      },
    },
  },
}));
