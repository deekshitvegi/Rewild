// node treepack.mjs in.glb out.glb: a Blender tree for the game: leaves alpha-masked and two-sided, pictures to WebP
// (bark 512, leaves 1024 wide), meshes meshopt-compressed like the game's other models.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { textureCompress, prune, dedup, weld, reorder, quantize, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';
const [,, input, output] = process.argv;
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);
for (const mat of doc.getRoot().listMaterials()) {
  if (/leaves/.test(mat.getName())) { mat.setAlphaMode('MASK'); mat.setAlphaCutoff(0.5); mat.setDoubleSided(true); }
  else { mat.setAlphaMode('OPAQUE'); mat.setDoubleSided(false); }
  mat.setMetallicFactor(0);
}
// The twig mark is a second UV map no material reads (maketree2.py): keep attributes through prune, and drop only the
// stray second colour set Blender adds.
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) prim.setAttribute('COLOR_1', null);
await doc.transform(dedup(), weld(), prune({ keepAttributes: true }), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 86 }), reorder({ encoder: MeshoptEncoder }), quantize());
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(output, doc);
const b = getBounds(doc.getRoot().listScenes()[0]);
console.log(JSON.stringify({ out: output.split('/').pop(), kb: Math.round(fs.statSync(output).size / 1024), meshes: doc.getRoot().listMeshes().map((m) => m.getName()), min: b.min.map((v) => +v.toFixed(1)), max: b.max.map((v) => +v.toFixed(1)) }));
