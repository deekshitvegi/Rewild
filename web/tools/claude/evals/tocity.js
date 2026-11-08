// Test only: hover window.__tc.alt above Earth's landing zone, back window.__tc.back metres, facing bearing
// window.__tc.bearing (radians right of the opening heading), pitched window.__tc.pitch degrees.
(() => { const e = window.__expedition; const r = e.runtime; const g = window.__tc || {}; const V = r.origin.constructor;
  const b = e.bodies.find((x) => x.id === 'projects'); const zone = e.landingZoneDirection(b).clone().normalize();
  const heading = e.openingHeading(b).clone(); const side = new V().crossVectors(heading, zone).normalize();
  const a = g.bearing ?? 0.7; const dir = heading.clone().multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a)).normalize();
  const spot = zone.clone().multiplyScalar(b.radius).addScaledVector(dir, -(g.back ?? 0)).normalize();
  const pos = b.position.clone().addScaledVector(spot, b.radius + e.groundHeight(b, spot) + (g.alt ?? 120));
  const p = (g.pitch ?? -10) * Math.PI / 180;
  const facing = dir.clone().multiplyScalar(Math.cos(p)).addScaledVector(spot, Math.sin(p)).normalize();
  r.actions.place(pos, facing, 0, spot); if (r.hud.ship) r.hud.ship.throttle = 0;
  return { ok: true }; })()
