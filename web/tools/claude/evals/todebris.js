// Test only: put the ship window.__db.back metres from the dead satellite, moving with it, looking at it.
(() => { const e = window.__expedition; const r = e.runtime; const L = window.__lab; const V = r.origin.constructor;
  const off = new V(), vel = new V(); L.story.debrisOffset(r.motion.seconds, off, vel);
  const earth = e.bodies.find((b) => b.id === 'projects'); const c = L.motion.universeDirection(r.motion, off, new V()).add(earth.position);
  const up = c.clone().sub(earth.position).normalize(); const v = L.motion.universeDirection(r.motion, vel, new V());
  const side = v.clone().normalize().cross(up).normalize(); const pos = c.clone().addScaledVector(side, (window.__db && window.__db.back) || 120).addScaledVector(up, 20);
  r.actions.place(pos, c.clone().sub(pos).normalize(), 0, up); if (r.hud.ship) { r.hud.ship.throttle = 0; r.hud.ship.velocity.copy(v); }
  return { alt: Math.round(c.distanceTo(earth.position) - earth.radius), speed: +v.length().toFixed(1) }; })()
