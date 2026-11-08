// node proppack.mjs in.glb out.glb [max texture size, default 2048]
// A baked building or prop from source_assets/temples/maketemple.py made ready for the game's prop shader
// (components/expedition/Props.tsx fitModel / createPropMaterial): meshes 'lod0' and 'lod1', one opaque single-sided
// material with a base colour and a normal texture only (no metal, roughness, emissive, occlusion or alpha), no
// vertex colours or other stray attributes; welded, pruned, pictures to WebP, geometry quantized and
// meshopt-compressed like the game's other models. Prints size, triangles per mesh and bounds.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { textureCompress, prune, dedup, weld, reorder, quantize, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';

const [,, input, output, maxArg] = process.argv;
const max = Number(maxArg || 2048);
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);
const root = doc.getRoot();

for (const mat of root.listMaterials()) {
  mat.setAlphaMode('OPAQUE');
  mat.setDoubleSided(false);
  mat.setMetallicFactor(0);
  mat.setRoughnessFactor(1);
  mat.setEmissiveFactor([0, 0, 0]);
  mat.setMetallicRoughnessTexture(null);
  mat.setEmissiveTexture(null);
  mat.setOcclusionTexture(null);
  for (const ext of mat.listExtensions()) ext.dispose();
}
// Only positions, normals and the one UV map: the game overwrites colours, and nothing reads anything else.
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    for (const sem of prim.listSemantics()) {
      if (!['POSITION', 'NORMAL', 'TEXCOORD_0'].includes(sem)) prim.setAttribute(sem, null);
    }
  }
}
await doc.transform(
  dedup(),
  weld(),
  prune({ keepAttributes: false }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [max, max], quality: 90, slots: /^baseColorTexture$/ }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [max, max], quality: 95, slots: /^normalTexture$/ }),
  reorder({ encoder: MeshoptEncoder }),
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14 }),
);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(output, doc);

const tris = (mesh) => mesh.listPrimitives().reduce((n, p) => n + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0);
const nodes = root.listNodes().filter((n) => n.getMesh()).map((n) => ({ node: n.getName(), tris: tris(n.getMesh()) }));
const b = getBounds(root.listScenes()[0]);
const textures = root.listTextures().map((t) => ({ name: t.getName(), mime: t.getMimeType(), size: t.getSize(), kb: Math.round(t.getImage().byteLength / 1024) }));
console.log(JSON.stringify({
  out: output.split('/').pop(), kb: Math.round(fs.statSync(output).size / 1024), inKb: Math.round(fs.statSync(input).size / 1024), nodes,
  textures, min: b.min.map((v) => +v.toFixed(2)), max: b.max.map((v) => +v.toFixed(2)),
}));
