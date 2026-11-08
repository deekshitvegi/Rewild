// node optskin.mjs in.glb out.glb [texture size]: a rigged model, kept whole (no simplifying: skinning), textures to WebP.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress, prune, dedup } from '@gltf-transform/functions';
import sharp from 'sharp';
const [,, input, output, size = '1024'] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
for (const mat of doc.getRoot().listMaterials()) { mat.setMetallicRoughnessTexture(null); mat.setOcclusionTexture(null); mat.setMetallicFactor(0); mat.setRoughnessFactor(0.85); }
await doc.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [+size, +size], quality: 82 }));
await io.write(output, doc);
const fs = await import('fs');
console.log(output.split('/').pop(), Math.round(fs.statSync(output).size / 1024), 'kb');
