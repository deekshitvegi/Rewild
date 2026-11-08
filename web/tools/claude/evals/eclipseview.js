// Test only: put the ship window.__ev.share of the way down the Moon's umbra (behind it, away from the
// Sun), window.__ev.off Moon radii off the axis, facing the Sun; window.__ev.closer holds the 11 degree view.
(() => { const e = window.__expedition; const r = e.runtime; const g = window.__ev || {}; const V = r.origin.constructor;
  const moon = e.bodies.find((b) => b.id === (g.body || 'moon')); const sun = e.bodies.find((b) => b.kind === 'star');
  const axis = moon.position.clone().sub(sun.position).normalize();
  const L = moon.radius * moon.position.distanceTo(sun.position) / (sun.radius - moon.radius);
  const pos = moon.position.clone().addScaledVector(axis, L * (g.share ?? 0.9));
  let side = new V(0, 1, 0).cross(axis); if (side.lengthSq() < 1e-6) side = new V(1, 0, 0); side.normalize();
  pos.addScaledVector(side, (g.off ?? 0) * moon.radius);
  const up = new V().crossVectors(side, axis).normalize();
  r.actions.place(pos, axis.clone().negate(), 0, up); if (r.hud.ship) r.hud.ship.throttle = 0;
  e.input.closer = !!g.closer;
  return { L: Math.round(L) }; })()
