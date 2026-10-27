/* Web Worker: runs the v3 protocol for one game off the main thread. */
importScripts('model.js');
self.onmessage = (ev) => {
  const { id, game, ratings, opts } = ev.data;
  try {
    const t0 = performance.now();
    const o = self.NHLModel.runGame(game, ratings, opts);
    o.ms = performance.now() - t0;
    self.postMessage({ id, ok: true, result: o });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.stack || e) });
  }
};
