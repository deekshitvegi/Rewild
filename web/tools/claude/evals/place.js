// Test only: put the ship window.__pl.alt metres above world window.__pl.body's surface (negative: below a giant's 1 bar level),
// on its sunlit side (or window.__pl.side: 'night'), looking at the horizon (pitch window.__pl.pitch degrees).
(() => { const e = window.__expedition; const r = e.runtime; const g = window.__pl || {}; const V = r.origin.constructor;
  const b = e.bodies.find((x) => x.id === g.body); if (!b) return { error: 'no body ' + g.body };
  const sun = b.sunDirection ? b.sunDirection.clone() : new V(1, 0, 0);
  let up = g.side === 'night' ? sun.clone().negate() : sun.clone();
  if (g.tilt) up.add(new V(0, g.tilt, 0)).normalize();
  const pos = b.position.clone().addScaledVector(up, b.radius + (g.alt ?? 1000));
  let side = new V(0, 1, 0).cross(up); if (side.lengthSq() < 1e-6) side = new V(1, 0, 0); side.normalize();
  const fwd = new V().crossVectors(up, side).normalize(); const p = (g.pitch ?? 0) * Math.PI / 180;
  const facing = fwd.clone().multiplyScalar(Math.cos(p)).addScaledVector(up, Math.sin(p)).normalize();
  r.actions.place(pos, facing, 0, up); if (r.hud.ship) r.hud.ship.throttle = 0;
  return { body: b.id, alt: g.alt, R: Math.round(b.radius) }; })()
