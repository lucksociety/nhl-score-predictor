/* Web Worker: runs v4-independent (or v3) for one game off the main thread. */
importScripts('model.js');
self.onmessage = (ev) => {
  const { id, game, ratings, opts, v4, grid } = ev.data;
  try {
    const t0 = performance.now(), M = self.NHLModel;
    if (grid) { self.postMessage({ id, ok: true, result: Object.assign(M.runGrid(grid), { ms: performance.now() - t0 }) }); return; }
    const o = v4 ? M.runGameV4(v4, Object.assign({}, opts, { gq: v4.gqOverride })) : M.runGame(game, ratings, opts);
    o.ms = performance.now() - t0;
    self.postMessage({ id, ok: true, result: o });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.stack || e) });
  }
};
