// node build.mjs <astronaut.glb> <motions.json> <out.glb> [--keep name,name]
//
// Puts the retargeted motions (retarget.py) into the explorer's model. The mesh, skin, rig and
// pictures are carried over untouched (byte for byte: the meshopt encoding is lossless here);
// only the animations change. A clip of the same name replaces the old one; old clips not named
// in --keep are dropped. Each clip's facts ride along as glTF extras (three.js: clip.userData):
// kind ('cycle' | 'once'), duration, and for cycles speed (m/s) and stride (m) at the model's own
// size, and the phases (0..1) where each foot is down.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import fs from 'fs';

const [,, input, motionsPath, output, ...rest] = process.argv;
const keep = new Set((rest[rest.indexOf('--keep') + 1] && rest.includes('--keep') ? rest[rest.indexOf('--keep') + 1] : '').split(',').filter(Boolean));
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);
const root = doc.getRoot();
const motions = JSON.parse(fs.readFileSync(motionsPath, 'utf8'));
const names = new Set(motions.clips.map((c) => c.name));
for (const anim of root.listAnimations()) {
  if (names.has(anim.getName()) || !keep.has(anim.getName())) {
    for (const s of anim.listSamplers()) { s.getInput()?.dispose(); s.getOutput()?.dispose(); }
    anim.dispose();
  }
}
const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
const buffer = root.listBuffers()[0];

/** Runs of contact (frame flags) as [on, off] phases of the clip. */
const phases = (flags, frames) => {
  const out = [];
  let start = -1;
  for (let i = 0; i <= frames; i++) {
    const down = i < frames && flags[i];
    if (down && start < 0) start = i;
    if (!down && start >= 0) { out.push([+(start / (frames - 1)).toFixed(3), +((i - 1) / (frames - 1)).toFixed(3)]); start = -1; }
  }
  return out;
};

const toShort = (v) => Math.max(-32767, Math.min(32767, Math.round(v * 32767)));
let channels = 0;
for (const clip of motions.clips) {
  const frames = clip.rotations.length;
  const times = new Float32Array(frames).map((_, i) => i / clip.fps);
  const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
  const single = doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0])).setBuffer(buffer);
  const anim = doc.createAnimation(clip.name);
  motions.bones.forEach((bone, b) => {
    const node = nodes.get(bone);
    if (!node) throw new Error(`no node ${bone}`);
    // A bone that never moves in this clip keeps one key.
    let still = true;
    const q0 = clip.rotations[0][b];
    for (let f = 1; f < frames && still; f++) {
      const q = clip.rotations[f][b];
      if (Math.abs(q[0] * q0[0] + q[1] * q0[1] + q[2] * q0[2] + q[3] * q0[3]) < 0.99999) still = false;
    }
    const count = still ? 1 : frames;
    const values = new Int16Array(count * 4);
    for (let f = 0; f < count; f++) for (let c = 0; c < 4; c++) values[f * 4 + c] = toShort(clip.rotations[f][b][c]);
    const output = doc.createAccessor().setType('VEC4').setArray(values).setNormalized(true).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(still ? single : input).setOutput(output).setInterpolation('LINEAR');
    anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('rotation').setSampler(sampler));
    channels++;
  });
  const hips = new Float32Array(frames * 3);
  clip.hips.forEach((p, f) => hips.set(p, f * 3));
  const output = doc.createAccessor().setType('VEC3').setArray(hips).setBuffer(buffer);
  const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
  anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(nodes.get('Hips')).setTargetPath('translation').setSampler(sampler));
  if (!single.listParents().some((p) => p !== root)) single.dispose();
  const extras = { kind: clip.kind, duration: +clip.duration.toFixed(4), source: clip.source };
  if (clip.kind === 'cycle') Object.assign(extras, { speed: +clip.speed.toFixed(4), stride: +clip.stride.toFixed(4) });
  if (clip.contact) extras.feet = [0, 1].map((side) => phases(clip.contact.map((c) => c[side]), frames));
  for (const key of ['rate', 'gravity', 'tags', 'marks']) if (clip[key] !== undefined) extras[key] = clip[key];
  anim.setExtras(extras);
}
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(output, doc);
const size = fs.statSync(output).size;
console.log(output.split('/').pop(), Math.round(size / 1024), 'KB', root.listAnimations().length, 'clips:', root.listAnimations().map((a) => a.getName()).join(' '));
