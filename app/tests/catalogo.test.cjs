const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');
const { CatalogoPlayerService } = load('src/catalogo/catalogo-service.ts');
const { AnnotationService } = load('src/anotador/annotation-service.ts');
const references = require('../public/data/referencias-v1.json');
function player(t) {
  let now=0; t.mock.method(performance,'now',()=>now);
  const c=new CatalogoPlayerService();
  const ref={...references[0],frames:[0,100,350,900,1000].map((ms,i)=>({frame_idx:i,timestamp_ms:ms,pose:[{x:i,y:0,z:0}]})),segmentacion:{frame_inicio_sena:1,frame_fin_sena:3}};
  c.catalogo=[ref];c.selectSena(ref.id);
  return {c,now:x=>{now=x;}};
}
test('selección y seek respetan los extremos del segmento', t=>{
  const {c}=player(t);assert.equal(c.update(0).frameIndex,1);
  c.seekFrame(-3);assert.equal(c.getCurrentFrameIndex(),1);
  c.seekFrame(50);assert.equal(c.getCurrentFrameIndex(),3);
});
test('reproducción usa timestamps irregulares e interpola', t=>{
  const {c}=player(t);c.play();const out=c.update(125);
  assert.equal(out.frameIndex,1);assert.ok(Math.abs(out.landmarks.pose[0].x-1.5)<1e-9);
  assert.equal(c.update(250).frameIndex,2);
});
test('cambio de velocidad y pausa conservan el tiempo transcurrido', t=>{
  const {c,now}=player(t);c.play();now(100);c.setSpeed(.5);
  c.update(200);assert.ok(Math.abs(c.update(200).landmarks.pose[0].x-1.6)<1e-9);
  now(300);c.pause();const held=c.update(10000).landmarks.pose[0].x;
  assert.ok(Math.abs(held-1.8)<1e-9);
});
test('seek no acumula tiempo anterior y el bucle conserva el sobrante', t=>{
  const {c,now}=player(t);c.play();now(500);c.seekFrame(2);
  assert.equal(c.update(500).frameIndex,2);
  c.seekFrame(1);const out=c.update(1550);assert.equal(out.hasLooped,true);
  assert.equal(out.frameIndex,1);assert.ok(Math.abs(out.landmarks.pose[0].x-1.6)<1e-9);
});
const config={glosa:'prueba',unidadTematica:1,dificultad:'facil',manoDominante:'derecha',anotador:'local',frameInicioSena:1,frameFinSena:3,queiremaForma:'mano_plana',queiremaDesc:'plana',kinemaPalma:[0,0,1],toponemaZona:'pecho',kinesemaTipo:'rectilineo',kinesemaRepeticiones:1,prosoponemaRequerido:false};
test('exportación recorta y rebasa timestamps sin falsear fps',()=>{
  const a=new AnnotationService();const frames=[0,40,80,120,160].map((timestamp_ms,frame_idx)=>({timestamp_ms,frame_idx}));
  const doc=a.buildReferenceDocument({...config,frames});assert.equal(doc.frames.length,3);
  assert.deepEqual(doc.frames.map(f=>f.timestamp_ms),[0,40,80]);assert.equal(doc.metadatos_grabacion.fps,25);
  assert.equal(doc.segmentacion.frame_inicio_sena,0);assert.equal(doc.segmentacion.frame_fin_sena,2);
});
test('captura inferior a 15 fps se rechaza en lugar de acelerar silenciosamente',()=>{
  const a=new AnnotationService();const frames=[0,100,200,300].map((timestamp_ms,frame_idx)=>({timestamp_ms,frame_idx}));
  assert.throws(()=>a.buildReferenceDocument({...config,frames}),/15 fps/);
});
test('catálogo inválido falla con estado descargado',async t=>{
  t.mock.method(global,'fetch',async()=>({ok:true,json:async()=>({frames:[]})}));
  const c=new CatalogoPlayerService();assert.deepEqual(await c.loadCatalog(),[]);assert.equal(c.getIsLoaded(),false);
});
