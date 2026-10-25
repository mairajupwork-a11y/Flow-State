/**
 * Just enough of Express's Router for the WorkMars route modules to run in
 * the browser demo: use(mw), use(path | paths, mw), use(router), use(prefix, router), get/post/put/patch/delete with
 * :params, and synchronous-next middleware. Mirrors Express 5 error flow.
 */
function compile(path) {
  const keys = [];
  const src = path.replace(/\/:([A-Za-z]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; });
  return { keys, exact: new RegExp(`^${src === '/' ? '' : src}/?$`), prefix: new RegExp(`^${src}(?=/|$)`) };
}

/** Runs one middleware/handler. Resolves true when it called next(), false when it finished. */
function step(fn, req, res) {
  return new Promise((resolve, reject) => {
    let nexted = false;
    const next = (err) => { nexted = true; err ? reject(err) : resolve(true); };
    try {
      const out = fn(req, res, next);
      if (nexted) return;
      if (out && typeof out.then === 'function') out.then(() => !nexted && resolve(false), reject);
      else resolve(false);
    } catch (err) {
      reject(err);
    }
  });
}

export function Router() {
  const stack = [];
  const router = {
    use(a, b) {
      const paths = Array.isArray(a) ? a : typeof a === 'string' ? [a] : null;
      if (paths && typeof b === 'function') stack.push({ mw: b, scope: paths.map(compile) }); // path-scoped middleware
      else if (typeof a === 'string') stack.push({ prefix: compile(a), sub: b });
      else if (typeof a?.handle === 'function') stack.push({ prefix: compile(''), sub: a }); // mounted router
      else stack.push({ mw: a });
      return router;
    },
    async handle(req, res, path) {
      for (const layer of stack) {
        if (layer.mw) {
          if (layer.scope && !layer.scope.some((c) => c.prefix.test(path))) continue;
          if (!(await step(layer.mw, req, res))) return true;
        } else if (layer.sub) {
          const m = path.match(layer.prefix.prefix);
          if (m && (await layer.sub.handle(req, res, path.slice(m[0].length) || '/'))) return true;
        } else if (layer.method === req.method) {
          const m = path.match(layer.route.exact);
          if (!m) continue;
          req.params = Object.fromEntries(layer.route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
          for (const fn of layer.fns) if (!(await step(fn, req, res))) return true;
          return true;
        }
      }
      return false;
    },
  };
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    router[method] = (path, ...fns) => { stack.push({ method: method.toUpperCase(), route: compile(path), fns }); return router; };
  }
  return router;
}

export default { Router };
