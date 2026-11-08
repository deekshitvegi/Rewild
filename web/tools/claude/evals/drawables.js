// Test only: the visible drawables in the scene, each with a short description (material, uniforms, vertices).
(() => { const t = window.__three; if (!t) return { error: 'no __three' }; const out = []; let n = 0;
  t.scene.traverseVisible((o) => { if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return; n++;
    const m = Array.isArray(o.material) ? o.material[0] : o.material; const u = m && m.uniforms ? Object.keys(m.uniforms).filter((k) => /^u[A-Z]/.test(k)).slice(0, 6).join(',') : '';
    const g = o.geometry; const v = g ? (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) : 0;
    const inst = o.isInstancedMesh ? o.count : (g && g.instanceCount !== undefined && g.instanceCount !== Infinity ? g.instanceCount : 1);
    let p = o, path = []; for (let i = 0; i < 4 && p; i++) { if (p.name) path.push(p.name); p = p.parent; }
    out.push({ id: o.id, type: o.type, mat: m ? (m.name || m.type) : '', u, v, inst, order: o.renderOrder, transparent: !!(m && m.transparent), side: m ? m.side : 0, path: path.join('<') });
  });
  return { n, list: out };
})()
