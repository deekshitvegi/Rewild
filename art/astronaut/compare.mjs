// node compare.mjs a.glb b.glb: are the two models' meshes, skins, rigs and pictures identical?
// (Animations are listed, not compared.) Exits 1 on any difference.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const [a, b] = await Promise.all(process.argv.slice(2, 4).map((f) => io.read(f)));
let differences = 0;
const same = (what, x, y) => {
  const ok = x.length === y.length && x.every((v, i) => v === y[i]);
  if (!ok) { differences++; console.log('DIFFERENT', what); }
};
const prims = (d) => d.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
const [pa, pb] = [prims(a), prims(b)];
same('primitive count', [pa.length], [pb.length]);
pa.forEach((p, i) => {
  for (const s of p.listSemantics()) same(`attribute ${s}`, Array.from(p.getAttribute(s).getArray()), Array.from(pb[i].getAttribute(s)?.getArray() ?? []));
  same('indices', Array.from(p.getIndices().getArray()), Array.from(pb[i].getIndices().getArray()));
});
const skins = (d) => d.getRoot().listSkins();
skins(a).forEach((s, i) => {
  same('inverse bind matrices', Array.from(s.getInverseBindMatrices().getArray()), Array.from(skins(b)[i].getInverseBindMatrices().getArray()));
  same('joints', s.listJoints().map((j) => j.getName()), skins(b)[i].listJoints().map((j) => j.getName()));
});
const nodes = (d) => d.getRoot().listNodes().map((n) => [n.getName(), ...n.getTranslation(), ...n.getRotation(), ...n.getScale()].join(','));
same('nodes (rest pose)', nodes(a), nodes(b));
const tex = (d) => d.getRoot().listTextures().map((t) => Array.from(t.getImage()));
tex(a).forEach((t, i) => same(`texture ${i}`, t, tex(b)[i] ?? []));
console.log(differences ? `${differences} differences` : 'mesh, skin, rest pose and pictures identical');
console.log('animations:', b.getRoot().listAnimations().map((x) => x.getName()).join(' '));
process.exit(differences ? 1 : 0);
