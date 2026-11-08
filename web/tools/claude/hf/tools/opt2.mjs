// node opt2.mjs in.glb out.glb <triangles> [texture size]: like opt.mjs, but keeps metal/roughness and normal maps
// (for machinery, where the metal is the look); drops occlusion.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, textureCompress, prune, dedup, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
const [,, input, output, tris = '20000', size = '1024'] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const count = () => doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices() ? p.getIndices().getCount() / 3 : p.getAttribute('POSITION').getCount() / 3), 0), 0);
const before = count();
await MeshoptSimplifier.ready;
const ratio = Math.min(1, +tris / before);
await doc.transform(dedup(), weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.002, lockBorder: false }));
for (const mat of doc.getRoot().listMaterials()) { mat.setOcclusionTexture(null); }
await doc.transform(prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [+size, +size], quality: 85 }));
await io.write(output, doc);
const b = getBounds(doc.getRoot().listScenes()[0]);
const fs = await import('fs');
console.log(JSON.stringify({ out: output.split('/').pop(), before, after: count(), kb: Math.round(fs.statSync(output).size / 1024), min: b.min.map((v) => +v.toFixed(2)), max: b.max.map((v) => +v.toFixed(2)) }));
