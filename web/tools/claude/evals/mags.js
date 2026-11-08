(() => { const e = window.__expedition; const r = e.runtime; const sun = e.bodies.find((b) => b.id === 'sun'); const AU = 68000000; const eye = r.camera; const out = {};
  const H = { education: -0.61, experience: -4.38, skills: -1.6, research: -9.4, beyond: -9.4, freelance: -7.11, certifications: -7.0, moon: 0.28 };
  for (const id of Object.keys(H)) { const b = e.bodies.find((x) => x.id === id); const tb = b.position.clone().sub(eye); const ts = sun.position.clone().sub(b.position); const ph = ts.angleTo(tb.clone().negate());
    const lit = ((Math.PI - ph) * Math.cos(ph) + Math.sin(ph)) / Math.PI; out[id] = +(H[id] + 5 * Math.log10(ts.length() / AU * tb.length() / AU) - 2.5 * Math.log10(Math.max(lit, 1e-4))).toFixed(2); }
  return out; })()
