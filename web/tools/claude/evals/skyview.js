// Test only: hover the ship window.__sv.h metres over world window.__sv.from where window.__sv.target stands window.__sv.elev
// degrees up in the sky (and the Sun is as low as possible: night), the camera looking at it.
(() => { const e = window.__expedition; const r = e.runtime; const g = window.__sv || {}; const V = r.origin.constructor;
  const from = e.bodies.find((b) => b.id === g.from); const target = e.bodies.find((b) => b.id === g.target); const sun = e.bodies.find((b) => b.id === 'sun');
  const toT = target.position.clone().sub(from.position).normalize(); const toS = sun.position.clone().sub(from.position).normalize();
  const want = Math.sin((g.elev ?? 35) * Math.PI / 180); let best = null, score = Infinity;
  let sd = g.seed ?? 12345; const rnd = () => { sd = (sd * 1103515245 + 12345) % 2147483648; return sd / 2147483648; };
  for (let i = 0; i < 20000; i++) { const u = new V(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); if (u.lengthSq() > 1 || u.lengthSq() < 0.01) continue; u.normalize();
    const s = Math.abs(u.dot(toT) - want) * 4 + (g.day ? -u.dot(toS) : u.dot(toS)); if (s < score) { score = s; best = u; } }
  const pos = from.position.clone().addScaledVector(best, from.radius + e.groundHeight(from, best) + (g.h ?? 80));
  const look = target.position.clone().sub(pos).normalize();
  r.actions.place(pos, look, 0, best); if (r.hud.ship) r.hud.ship.throttle = 0;
  const ang = 2 * Math.atan(target.radius / target.position.distanceTo(pos)) * 180 / Math.PI;
  return { elev: +(Math.asin(best.dot(toT)) * 180 / Math.PI).toFixed(1), sunElev: +(Math.asin(best.dot(toS)) * 180 / Math.PI).toFixed(1), angularDeg: +ang.toFixed(3), phase: +((1 + toT.dot(toS)) / 2).toFixed(2) };
})()
