// node tris.mjs a.glb ...: triangles per mesh and texture sizes.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'fs';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const parts = doc.getRoot().listMeshes().map((m) => `${m.getName()}:${m.listPrimitives().reduce((s, p) => s + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0)}`);
  const tex = doc.getRoot().listTextures().map((t) => `${(t.getSize() || []).join('x')}:${Math.round(t.getImage().byteLength / 1024)}k`);
  console.log(f.split('/').pop(), Math.round(fs.statSync(f).size / 1024) + 'k', parts.join(' '), tex.join(' '));
}
