// node decode.mjs <astronaut.glb> <out.glb>: the model with its meshopt compression undone, so the
// retarget (and Blender) can read it. Prints its nodes and clips.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
const [,, input, output] = process.argv;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);
for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === 'EXT_meshopt_compression') ext.dispose();
const root = doc.getRoot();
for (const n of root.listNodes()) console.log('node', n.getName(), 'kids', n.listChildren().map((c) => c.getName()).join(','));
for (const a of root.listAnimations()) console.log('clip', a.getName(), JSON.stringify(a.getExtras()));
if (output) await io.write(output, doc);
