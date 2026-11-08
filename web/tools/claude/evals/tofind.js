// Test only: put the ship window.__tf.h metres up and window.__tf.back metres back from story find window.__tf.id, looking at it.
(() => { const e = window.__expedition; const r = e.runtime; const L = window.__lab; const g = window.__tf; const V = r.origin.constructor;
  const find = L.story.storyFind(g.id); const body = e.bodies.find((b) => b.id === find.body); const fr = L.story.findFrame(find);
  const c = L.motion.fromStart(r.motion, body, fr.centre, new V());
  const up = c.clone().sub(body.position).normalize();
  const side = fr.north.clone(); const turn = L.motion.orientationOf(r.motion, body); side.applyQuaternion(turn);
  const pos = c.clone().addScaledVector(up, g.h ?? 30).addScaledVector(side, g.back ?? 120);
  const look = c.clone().addScaledVector(up, (g.lookUp ?? 0)).sub(pos).normalize();
  r.actions.place(pos, look, 0, up); if (r.hud.ship) r.hud.ship.throttle = 0;
  return { id: g.id, body: body.id, dist: Math.round(pos.distanceTo(c)) }; })()
