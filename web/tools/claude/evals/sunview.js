// Test only: stand window.__sv.alt metres above world window.__sv.body where the Sun is window.__sv.elev degrees
// above the horizon, and face it (pitch = elev + window.__sv.lift). window.__sv.closer holds the 11 degree view.
(() => { const e = window.__expedition; const r = e.runtime; const g = window.__sv || {}; const V = r.origin.constructor;
  const b = e.bodies.find((x) => x.id === g.body); if (!b) return { error: 'no body ' + g.body };
  const sun = b.sunDirection.clone().normalize();
  let side = new V(0, 1, 0).cross(sun); if (side.lengthSq() < 1e-6) side = new V(1, 0, 0); side.normalize();
  const perp = new V().crossVectors(sun, side).normalize();
  const el = (g.elev ?? 5) * Math.PI / 180;
  // Up at the standing point: the Sun stands `elev` above its horizon.
  const up = sun.clone().multiplyScalar(Math.sin(el)).addScaledVector(perp, Math.cos(el)).normalize();
  const pos = b.position.clone().addScaledVector(up, b.radius + (g.alt ?? 2));
  const level = sun.clone().addScaledVector(up, -sun.dot(up)).normalize();
  const p = ((g.elev ?? 5) + (g.lift ?? 0)) * Math.PI / 180;
  const facing = level.clone().multiplyScalar(Math.cos(p)).addScaledVector(up, Math.sin(p)).normalize();
  r.actions.place(pos, facing, 0, up); if (r.hud.ship) r.hud.ship.throttle = 0;
  e.input.closer = !!g.closer;
  const toSun = e.bodies.find((x) => x.id === 'sun');
  const d = toSun ? toSun.position.distanceTo(pos) : 0;
  return { body: b.id, sunDeg: toSun ? +(2 * Math.atan(toSun.radius / d) * 180 / Math.PI).toFixed(3) : null }; })()
