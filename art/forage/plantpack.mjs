// node plantpack.mjs in.glb out.glb: a forage plant from makeplant.py for the game: its one material alpha-masked and
// two-sided (leaves are cut out of the atlas; stems and fruit are opaque in it), the atlas to WebP, meshes
// meshopt-compressed like the game's other models. The 'Kind' UV map (TEXCOORD_1) and the colours are kept.
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
  mat.setAlphaMode('MASK'); mat.setAlphaCutoff(0.5); mat.setDoubleSided(true); mat.setMetallicFactor(0);
}
await doc.transform(dedup(), weld(), prune({ keepAttributes: true }), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 90 }), reorder({ encoder: MeshoptEncoder }), quantize());
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(output, doc);
const b = getBounds(doc.getRoot().listScenes()[0]);
console.log(JSON.stringify({ out: output.split('/').pop(), kb: Math.round(fs.statSync(output).size / 1024), meshes: doc.getRoot().listMeshes().map((m) => m.getName()), min: b.min.map((v) => +v.toFixed(2)), max: b.max.map((v) => +v.toFixed(2)) }));
