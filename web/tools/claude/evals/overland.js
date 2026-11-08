// Test only: hover window.__ol.alt above Earth's landing zone (Dallas), looking down at window.__ol.pitch degrees.
(() => { const e = window.__expedition; const r = e.runtime; const g = window.__ol || {}; const V = r.origin.constructor;
  const b = e.bodies.find((x) => x.id === 'projects'); const dir = e.landingZoneDirection(b).clone().normalize();
  const pos = b.position.clone().addScaledVector(dir, b.radius + (g.alt ?? 20000));
  let side = new V(0, 1, 0).cross(dir); if (side.lengthSq() < 1e-6) side = new V(1, 0, 0); side.normalize();
  const fwd = new V().crossVectors(dir, side).normalize(); const p = (g.pitch ?? -60) * Math.PI / 180;
  const facing = fwd.clone().multiplyScalar(Math.cos(p)).addScaledVector(dir, Math.sin(p)).normalize();
  r.actions.place(pos, facing, 0, dir); if (r.hud.ship) r.hud.ship.throttle = 0;
  return { alt: g.alt }; })()
