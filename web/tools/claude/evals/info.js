(() => { const e = window.__expedition; const r = e.runtime; const gl = r.view && r.view.gl; const info = window.__glinfo || null;
  return { body: r.currentBody && r.currentBody.id, gas: r.gas ? { h: Math.round(r.gas.height), deck: r.gas.deck } : null, mode: r.mode, alt: Math.round(r.altitude), info }; })()
