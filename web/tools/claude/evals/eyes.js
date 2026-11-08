(() => { const e = window.__expedition; const r = e.runtime; const t = window.__three; const out = { nightEyes: r.nightEyes, daylight: r.daylight, atmo: r.atmosphere, cur: r.currentBody && r.currentBody.id, alt: Math.round(r.altitude) };
  t.scene.traverse((o) => { const m = o.material; if (m && m.uniforms && m.uniforms.uEyes && m.uniforms.uGlobe) { out['eyes_' + (m.uniforms.uRadius ? Math.round(m.uniforms.uRadius.value) : '?')] = [m.uniforms.uEyes.value, m.uniforms.uGlobeReady.value, o.visible]; } });
  return out; })()
