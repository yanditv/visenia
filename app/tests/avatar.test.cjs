const { test } = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');
const load = require('./load-ts.cjs');
const { VrmAvatarViewer } = load('src/avatar/vrm-loader-spike.ts');
const { VisionService } = load('src/vision/vision-service.ts');

function rig() {
  const v = Object.create(VrmAvatarViewer.prototype);
  const bones = new Map();
  const expressions = {};
  v.currentVrm = {
    humanoid: {
      getNormalizedBoneNode(name) {
        if (!bones.has(name)) bones.set(name, new THREE.Object3D());
        return bones.get(name);
      },
    },
    expressionManager: {
      setValue(name, value) {
        expressions[name] = value;
      },
    },
  };
  return { v, bones, expressions };
}
const point = (x, y, z = 0) => ({ x, y, z, visibility: 1 });
function pose() {
  const p = Array.from({ length: 33 }, () => point(0.5, 0.5));
  p[11] = point(0.7, 0.4);
  p[12] = point(0.3, 0.4);
  p[13] = point(0.8, 0.6);
  p[14] = point(0.2, 0.6);
  p[15] = point(0.8, 0.8);
  p[16] = point(0.2, 0.8);
  return p;
}
function hand(x = 0.2) {
  const h = Array.from({ length: 21 }, () => point(x, 0.8));
  h[1] = point(x - 0.02, 0.77);
  h[2] = point(x - 0.04, 0.75);
  h[3] = point(x - 0.06, 0.73);
  h[4] = point(x - 0.08, 0.71);
  [5, 9, 13, 17].forEach((start, j) => {
    for (let k = 0; k < 4; k++) h[start + k] = point(x + (j - 1.5) * 0.025, 0.74 - k * 0.025);
  });
  return h;
}
test('reposo baja ambos brazos y neutraliza todos los pulgares', () => {
  const { v, bones } = rig();
  for (const side of ['left', 'right'])
    for (const digit of ['Metacarpal', 'Proximal', 'Distal'])
      v.currentVrm.humanoid.getNormalizedBoneNode(side + 'Thumb' + digit).rotation.z = 0.7;
  for (let i = 0; i < 120; i++) v.applyRestingPose(0);
  assert.ok(
    new THREE.Vector3(-1, 0, 0).applyQuaternion(bones.get('rightUpperArm').quaternion).y < -0.8
  );
  assert.ok(
    new THREE.Vector3(1, 0, 0).applyQuaternion(bones.get('leftUpperArm').quaternion).y < -0.8
  );
  assert.ok(bones.get('leftThumbMetacarpal').quaternion.angleTo(new THREE.Quaternion()) < 1e-5);
});
test('poseWorld determina los brazos sin mezclar z de mano y cuerpo', () => {
  const a = rig(),
    b = rig(),
    p = pose(),
    world = pose();
  world[13] = point(0.8, 0.1, -0.5);
  for (let i = 0; i < 60; i++) {
    a.v.applyDirectMirrorKinematics({ pose: p, poseWorld: p });
    b.v.applyDirectMirrorKinematics({ pose: p, poseWorld: world });
  }
  assert.ok(
    a.bones.get('rightUpperArm').quaternion.angleTo(b.bones.get('rightUpperArm').quaternion) > 0.2
  );
  const c = rig(),
    d = rig();
  for (let i = 0; i < 60; i++) {
    c.v.applyDirectMirrorKinematics({ pose: p, rightHand: hand() });
    d.v.applyDirectMirrorKinematics({ pose: p, rightHand: hand().map((q) => ({ ...q, z: 10 })) });
  }
  assert.ok(
    c.bones.get('leftLowerArm').quaternion.angleTo(d.bones.get('leftLowerArm').quaternion) < 1e-5
  );
});
test('override de hueso es exacto en cada cuadro', () => {
  const { v, bones } = rig(),
    target = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.8));
  v.applyDirectMirrorKinematics({
    pose: pose(),
    vrmPoseOverride: { leftUpperArm: target.toArray() },
  });
  assert.ok(bones.get('leftUpperArm').quaternion.angleTo(target) < 1e-5);
});
test('al retirar un override vuelve el solver y al perder tracking se libera la corrección', () => {
  const { v, bones } = rig();
  v.applyDirectMirrorKinematics({
    pose: pose(),
    vrmPoseOverride: { leftUpperArm: [0, 0, 0, 1], head: [0.2, 0, 0, 0.98] },
  });
  v.applyDirectMirrorKinematics({ pose: pose() });
  assert.ok(bones.get('leftUpperArm').quaternion.angleTo(new THREE.Quaternion()) > 0.1);
  v.applyDirectMirrorKinematics({ vrmPoseOverride: { head: [0.2, 0, 0, 0.98] } });
  for (let i = 0; i < 60; i++) v.applyRestingPose(0);
  assert.ok(bones.get('head').quaternion.angleTo(new THREE.Quaternion()) < 1e-5);
});
test('encuadre de cámara incluye manos altas y laterales en panel estrecho', () => {
  const { v } = rig();
  v.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  v.renderer = { setSize() {} };
  for (const aspect of [0.6, 1, 1.8]) {
    v.resize(aspect * 600, 600);
    v.camera.updateMatrixWorld(true);
    for (const p of [
      [-0.95, 1.3, 0],
      [0.95, 1.3, 0],
      [0, 1.95, 0],
    ]) {
      const ndc = new THREE.Vector3(...p).project(v.camera);
      assert.ok(Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1);
    }
  }
});
test('cuadros solo con overrides llegan al solver', () => {
  const { v, bones } = rig();
  v.isAnimating = false;
  v.latestLandmarks = { vrmPoseOverride: { head: [0, 0, 0, 1] } };
  v.clock = { getDelta: () => 0.016, getElapsedTime: () => 1 };
  v.renderer = {
    render() {
      v.isAnimating = false;
    },
  };
  v.currentVrm.update = () => {};
  global.requestAnimationFrame = () => {};
  v.start();
  assert.ok(bones.has('head'));
});
test('la expresión ausente vuelve a neutral', () => {
  const { v, expressions } = rig();
  v.applyDirectMirrorKinematics({ pose: pose(), blendshapes: { jawOpen: 1 } });
  v.applyDirectMirrorKinematics({ pose: pose() });
  assert.equal(expressions.aa, 0);
});
test('la orientación de palma usa profundidad y conserva valores finitos', () => {
  const a = rig(),
    b = rig(),
    h = hand();
  const turned = h.map((p) => ({ ...p, z: (p.x - 0.2) * 2 }));
  for (let i = 0; i < 60; i++) {
    a.v.applyFingerArticulations(h, 'left');
    b.v.applyFingerArticulations(turned, 'left');
  }
  assert.ok(a.bones.get('leftHand').quaternion.angleTo(b.bones.get('leftHand').quaternion) > 0.2);
  b.v.applyFingerArticulations(
    Array.from({ length: 21 }, () => point(0, 0)),
    'left'
  );
  assert.ok(b.bones.get('leftHand').quaternion.toArray().every(Number.isFinite));
});
test('la flexión de falanges responde a sus ángulos 3D', () => {
  const a = rig(),
    b = rig(),
    h = hand(),
    bent = hand();
  bent[7] = { ...bent[6], z: 0.03 };
  bent[8] = { ...bent[6], z: 0.06 };
  for (let i = 0; i < 60; i++) {
    a.v.applyFingerArticulations(h, 'left');
    b.v.applyFingerArticulations(bent, 'left');
  }
  assert.ok(
    a.bones
      .get('leftIndexIntermediate')
      .quaternion.angleTo(b.bones.get('leftIndexIntermediate').quaternion) > 0.2
  );
});
function detector(hands, p = pose()) {
  const v = new VisionService();
  v.isReady = true;
  v.poseLandmarker = { detectForVideo: () => ({ landmarks: [p] }) };
  v.handLandmarker = {
    detectForVideo: () => ({
      landmarks: hands,
      handedness: hands.map(() => [{ categoryName: 'Left', score: 0.55 }]),
    }),
  };
  return v;
}
test('manos cruzadas se asocian a muñecas aunque las etiquetas coincidan', () => {
  const p = pose();
  p[15] = point(0.2, 0.5);
  p[16] = point(0.8, 0.5);
  const left = hand(0.2).map((q) => ({ ...q, y: q.y - 0.3 })),
    right = hand(0.8).map((q) => ({ ...q, y: q.y - 0.3 }));
  const { landmarks: r } = detector([left, right], p).detect(
    { readyState: 2, videoWidth: 640, videoHeight: 480 },
    0
  );
  assert.equal(r.rightHand[0].x, 0.8);
  assert.equal(r.leftHand[0].x, 0.2);
});
test('una mano aislada usa la muñeca de Pose, no una etiqueta ambigua', () => {
  const p = pose();
  p[15] = point(0.8, 0.8);
  p[16] = point(0.2, 0.8);
  const { landmarks: r } = detector([hand(0.8)], p).detect({ readyState: 2 }, 0);
  assert.equal(r.leftHand[0].x, 0.8);
  assert.equal(r.rightHand, undefined);
});
test('encuadre no es válido sin rostro y ambas manos durante un segundo', () => {
  const v = detector([]);
  const r = v.detect({ readyState: 2 }, 2000);
  assert.equal(r.encuadreValido, false);
});
