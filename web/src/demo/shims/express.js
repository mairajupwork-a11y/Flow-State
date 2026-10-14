/**
 * Just enough of Express's Router for the Flowstate route modules to run in
 * the browser demo: use(), use(prefix, router), get/post/patch/delete with
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
      stack.push(typeof a === 'string' ? { prefix: compile(a), sub: b } : { mw: a });
      return router;
    },
    async handle(req, res, path) {
      for (const layer of stack) {
        if (layer.mw) {
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
  for (const method of ['get', 'post', 'patch', 'delete']) {
    router[method] = (path, ...fns) => { stack.push({ method: method.toUpperCase(), route: compile(path), fns }); return router; };
  }
  return router;
}

export default { Router };
