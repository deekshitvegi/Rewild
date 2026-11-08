import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f); const root = doc.getRoot();
  const tris = root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices() ? p.getIndices().getCount() / 3 : 0), 0), 0);
  console.log(f.split('/').pop(), 'tris', tris, 'skins', root.listSkins().length, 'joints', root.listSkins()[0]?.listJoints().slice(0, 8).map((j) => j.getName()).join(','),
    'anims', root.listAnimations().map((a) => `${a.getName()}(${a.listChannels().length})`).join(' '), 'textures', root.listTextures().map((t) => t.getSize()?.join('x')).join(' '));
}
