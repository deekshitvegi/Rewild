// Test only: face the nearest Jupiter floater from window.__fl.back metres away (needs the ship already in the water clouds).
(() => { const e = window.__expedition; const r = e.runtime; const t = window.__three; const V = r.origin.constructor; let mesh = null;
  t.scene.traverse((o) => { if (o.isInstancedMesh && o.material && o.material.uniforms && o.material.uniforms.uGlow) mesh = o; });
  if (!mesh || mesh.count === 0) return { error: 'no floaters', count: mesh ? mesh.count : -1 };
  const m = new t.camera.matrix.constructor(); const p = new V(); let best = null, bd = Infinity;
  for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, m); p.setFromMatrixPosition(m).add(r.origin); const d = p.distanceTo(r.camera); if (d < bd) { bd = d; best = p.clone(); } }
  const jup = e.bodies.find((b) => b.id === 'research'); const up = best.clone().sub(jup.position).normalize();
  const side = new V(0, 1, 0).cross(up).normalize(); const pos = best.clone().addScaledVector(side, (window.__fl && window.__fl.back) || 700).addScaledVector(up, (window.__fl && window.__fl.up) || 60);
  r.actions.place(pos, best.clone().sub(pos).normalize(), 0, up); if (r.hud.ship) r.hud.ship.throttle = 0;
  return { count: mesh.count, nearest: Math.round(bd) }; })()
