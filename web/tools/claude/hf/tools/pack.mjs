// node pack.mjs <in-dir> <out-dir>: each .glb, meshopt decoded (the preview host allows no WebAssembly),
// written as one base64 string in <name>.glb.b64.json. Prints sizes.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'fs';
import path from 'path';
const [,, input, output] = process.argv;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
fs.mkdirSync(output, { recursive: true });
for (const file of fs.readdirSync(input).filter((f) => f.endsWith('.glb')).sort()) {
  const doc = await io.read(path.join(input, file));
  for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === 'EXT_meshopt_compression') ext.dispose();
  const bytes = await io.writeBinary(doc);
  fs.writeFileSync(path.join(output, `${file}.b64.json`), JSON.stringify(Buffer.from(bytes).toString('base64')));
  console.log(file, fs.statSync(path.join(input, file)).size, '->', fs.statSync(path.join(output, `${file}.b64.json`)).size);
}
