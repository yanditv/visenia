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
  v.currentVrm = { humanoid: { getNormalizedBoneNode(name) {
    if (!bones.has(name)) bones.set(name, new THREE.Object3D());
    return bones.get(name);
  } }, expressionManager: { setValue(name, value) { expressions[name] = value; } } };
  return { v, bones, expressions };
}
const point = (x, y, z = 0) => ({ x, y, z, visibility: 1 });
function pose() {
  const p = Array.from({ length: 33 }, () => point(.5, .5));
  p[11] = point(.7, .4); p[12] = point(.3, .4);
  p[13] = point(.8, .6); p[14] = point(.2, .6);
  p[15] = point(.8, .8); p[16] = point(.2, .8);
  return p;
}
function hand(x = .2) {
  const h = Array.from({ length: 21 }, () => point(x, .8));
  h[1] = point(x-.02,.77); h[2] = point(x-.04,.75); h[3] = point(x-.06,.73); h[4] = point(x-.08,.71);
  [5,9,13,17].forEach((start,j) => { for(let k=0;k<4;k++) h[start+k] = point(x+(j-1.5)*.025,.74-k*.025); });
  return h;
}
test('reposo baja ambos brazos y neutraliza todos los pulgares', () => {
  const {v,bones} = rig();
  for(const side of ['left','right']) for(const digit of ['Metacarpal','Proximal','Distal']) v.currentVrm.humanoid.getNormalizedBoneNode(side+'Thumb'+digit).rotation.z = .7;
  for(let i=0;i<120;i++) v.applyRestingPose(0);
  assert.ok(new THREE.Vector3(-1,0,0).applyQuaternion(bones.get('rightUpperArm').quaternion).y < -.8);
  assert.ok(new THREE.Vector3(1,0,0).applyQuaternion(bones.get('leftUpperArm').quaternion).y < -.8);
  assert.ok(bones.get('leftThumbMetacarpal').quaternion.angleTo(new THREE.Quaternion()) < 1e-5);
});
test('poseWorld determina los brazos sin mezclar z de mano y cuerpo', () => {
  const a=rig(), b=rig(), p=pose(), world=pose();
  world[13] = point(.8,.1,-.5);
  for(let i=0;i<60;i++) { a.v.applyDirectMirrorKinematics({pose:p,poseWorld:p}); b.v.applyDirectMirrorKinematics({pose:p,poseWorld:world}); }
  assert.ok(a.bones.get('rightUpperArm').quaternion.angleTo(b.bones.get('rightUpperArm').quaternion) > .2);
  const c=rig(), d=rig();
  for(let i=0;i<60;i++){c.v.applyDirectMirrorKinematics({pose:p,rightHand:hand()});d.v.applyDirectMirrorKinematics({pose:p,rightHand:hand().map(q=>({...q,z:10}))});}
  assert.ok(c.bones.get('leftLowerArm').quaternion.angleTo(d.bones.get('leftLowerArm').quaternion)<1e-5);
});
test('override de hueso es exacto en cada cuadro', () => {
  const {v,bones}=rig(), target=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,0,.8));
  v.applyDirectMirrorKinematics({pose:pose(),vrmPoseOverride:{leftUpperArm:target.toArray()}});
  assert.ok(bones.get('leftUpperArm').quaternion.angleTo(target)<1e-5);
});
test('cuadros solo con overrides llegan al solver', () => {
  const {v,bones}=rig(); v.isAnimating=false;v.latestLandmarks={vrmPoseOverride:{head:[0,0,0,1]}};
  v.clock={getDelta:()=>.016,getElapsedTime:()=>1};v.renderer={render(){v.isAnimating=false;}};
  v.currentVrm.update=()=>{}; global.requestAnimationFrame=()=>{};
  v.start(); assert.ok(bones.has('head'));
});
test('la expresión ausente vuelve a neutral', () => {
  const {v,expressions}=rig();v.applyDirectMirrorKinematics({pose:pose(),blendshapes:{jawOpen:1}});
  v.applyDirectMirrorKinematics({pose:pose()});assert.equal(expressions.aa,0);
});
test('la orientación de palma usa profundidad y conserva valores finitos', () => {
  const a=rig(),b=rig(),h=hand();const turned=h.map(p=>({...p,z:(p.x-.2)*2}));
  for(let i=0;i<60;i++){a.v.applyFingerArticulations(h,'left');b.v.applyFingerArticulations(turned,'left');}
  assert.ok(a.bones.get('leftHand').quaternion.angleTo(b.bones.get('leftHand').quaternion)>.2);
  b.v.applyFingerArticulations(Array.from({length:21},()=>point(0,0)),'left');
  assert.ok(b.bones.get('leftHand').quaternion.toArray().every(Number.isFinite));
});
test('la flexión de falanges responde a sus ángulos 3D', () => {
  const a=rig(),b=rig(),h=hand(),bent=hand();bent[7]={...bent[6],z:.03};bent[8]={...bent[6],z:.06};
  for(let i=0;i<60;i++){a.v.applyFingerArticulations(h,'left');b.v.applyFingerArticulations(bent,'left');}
  assert.ok(a.bones.get('leftIndexIntermediate').quaternion.angleTo(b.bones.get('leftIndexIntermediate').quaternion)>.2);
});
function detector(hands, p=pose()) {
  const v=new VisionService();v.isReady=true;
  v.poseLandmarker={detectForVideo:()=>({landmarks:[p]})};
  v.handLandmarker={detectForVideo:()=>({landmarks:hands,handedness:hands.map(()=>[{categoryName:'Left',score:.55}])})};
  return v;
}
test('manos cruzadas se asocian a muñecas aunque las etiquetas coincidan', () => {
  const p=pose();p[15]=point(.2,.5);p[16]=point(.8,.5);
  const left=hand(.2).map(q=>({...q,y:q.y-.3})),right=hand(.8).map(q=>({...q,y:q.y-.3}));
  const {landmarks:r}=detector([left,right],p).detect({readyState:2,videoWidth:640,videoHeight:480},0);
  assert.equal(r.rightHand[0].x,.8);assert.equal(r.leftHand[0].x,.2);
});
test('una mano aislada usa la muñeca de Pose, no una etiqueta ambigua', () => {
  const p=pose();p[15]=point(.8,.8);p[16]=point(.2,.8);
  const {landmarks:r}=detector([hand(.8)],p).detect({readyState:2},0);
  assert.equal(r.leftHand[0].x,.8);assert.equal(r.rightHand,undefined);
});
test('encuadre no es válido sin rostro y ambas manos durante un segundo', () => {
  const v=detector([]);const r=v.detect({readyState:2},2000);assert.equal(r.encuadreValido,false);
});
