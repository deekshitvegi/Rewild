// Test only: put the ship window.__pl.alt metres above the ground at map point (x east, y north, metres) from the
// landing zone of window.__pl.body, facing azimuth `face` degrees from north, pitched `pitch` degrees (negative: down).
(() => { const e = window.__expedition; const r = e.runtime; const g = window.__pl || {}; const V = r.origin.constructor;
  const b = e.bodies.find((x) => x.id === g.body); if (!b) return { error: 'no body ' + g.body };
  const zone = e.landingZoneDirection(b); const north = e.openingHeading(b).clone(); const east = new V().crossVectors(north, zone).normalize();
  const R = b.radius; const x = g.x ?? 0, y = g.y ?? 0; const d = Math.hypot(x, y); const a = d / R;
  const t = d > 1e-6 ? east.clone().multiplyScalar(x / d).addScaledVector(north, y / d) : east.clone();
  const up = zone.clone().multiplyScalar(Math.cos(a)).addScaledVector(t, Math.sin(a)).normalize();
  const ground = e.groundHeight(b, up);
  const pos = b.position.clone().addScaledVector(up, R + ground + (g.alt ?? 300));
  const rad = Math.PI / 180; const f = north.clone().multiplyScalar(Math.cos((g.face ?? 0) * rad)).addScaledVector(east, Math.sin((g.face ?? 0) * rad));
  f.addScaledVector(up, -f.dot(up)).normalize(); const p = (g.pitch ?? 0) * rad;
  const facing = f.clone().multiplyScalar(Math.cos(p)).addScaledVector(up, Math.sin(p)).normalize();
  r.actions.place(pos, facing, 0, up); if (r.hud.ship) r.hud.ship.throttle = 0;
  return { body: b.id, alt: g.alt, ground: Math.round(ground) }; })()
