const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('three');
const { VRMHumanoid } = require('@pixiv/three-vrm');
const { VrmAvatarViewer } = require('./load-ts.cjs')('src/avatar/vrm-loader-spike.ts');

test('palma frontal conserva su normal en la jerarquía real de visenia.vrm', () => {
  const bytes = fs.readFileSync(path.join(__dirname, '../public/models/visenia.vrm'));
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const nodes = gltf.nodes.map((n) => {
    const node = new THREE.Object3D();
    if (n.translation) node.position.fromArray(n.translation);
    if (n.rotation) node.quaternion.fromArray(n.rotation);
    if (n.scale) node.scale.fromArray(n.scale);
    return node;
  });
  gltf.nodes.forEach((n, i) => (n.children ?? []).forEach((child) => nodes[i].add(nodes[child])));
  nodes.filter((n) => !n.parent).forEach((n) => n.updateMatrixWorld(true));
  const humanoid = new VRMHumanoid(
    Object.fromEntries(
      Object.entries(gltf.extensions.VRMC_vrm.humanoid.humanBones).map(([name, b]) => [
        name,
        { node: nodes[b.node] },
      ])
    )
  );
  const viewer = Object.create(VrmAvatarViewer.prototype);
  viewer.currentVrm = { humanoid };
  const hand = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.7, z: 0 }));
  for (const [start, x] of [
    [5, 0.45],
    [9, 0.5],
    [13, 0.53],
    [17, 0.56],
  ]) {
    for (let j = 0; j < 4; j++) hand[start + j] = { x, y: 0.6 - j * 0.03, z: 0 };
  }
  for (const side of ['left', 'right']) {
    for (let i = 0; i < 120; i++) viewer.applyFingerArticulations(hand, side);
    const world = (name) =>
      humanoid.getNormalizedBoneNode(side + name).getWorldPosition(new THREE.Vector3());
    const wrist = world('Hand');
    const normal = new THREE.Vector3()
      .crossVectors(world('IndexProximal').sub(wrist), world('LittleProximal').sub(wrist))
      .normalize();
    assert.ok(Math.abs(normal.z) > 0.99, `${side}: normal real ${normal.toArray()}`);
  }
});
