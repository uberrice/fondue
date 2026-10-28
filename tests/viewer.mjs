import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let canvasModule;
try { canvasModule=require('@napi-rs/canvas'); } catch { canvasModule=require('/home/taallens/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'); }
const {createCanvas,Path2D}=canvasModule;
class Element {
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.hidden=false;this.listeners={};this.style={};this.dataset={};this.classList={add(){},remove(){},toggle(){}};this.clientWidth=1100;this.clientHeight=750;}
 append(...children){this.children.push(...children);}replaceChildren(...children){this.children=children;}setAttribute(k,v){this[k]=v;}addEventListener(k,v){this.listeners[k]=v;}getBoundingClientRect(){return {left:0,top:0};}setPointerCapture(){}click(){this.onclick?.();}
}
const elements=new Map();const main=createCanvas(1100,750);main.addEventListener=()=>{};
const document={getElementById(id){if(id==='canvas')return main;if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement(tag){return tag==='canvas'?createCanvas(1,1):new Element(tag);}};
const sandbox={document,Path2D,TextDecoder,DataView,Uint8Array,ArrayBuffer,DecompressionStream,Blob,console,performance,setTimeout,clearTimeout,devicePixelRatio:1,window:new Element(),ResizeObserver:class{constructor(cb){this.cb=cb;}observe(){this.cb();}},requestAnimationFrame:cb=>setTimeout(cb,0)};
vm.createContext(sandbox);
vm.runInContext(await fs.readFile('src/engine.js','utf8')+'\n'+await fs.readFile('src/app.js','utf8'),sandbox);
const run=code=>vm.runInContext(code,sandbox);
async function settleScene(){for(let i=0;i<1000;i++){if(!run('sceneJob'))return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('Background scene did not settle');}
const zip=await fs.readFile('GERBER-ETBoy.zip');sandbox.zipBuffer=zip.buffer.slice(zip.byteOffset,zip.byteOffset+zip.byteLength);
await run("loadFile({name:'GERBER-ETBoy.zip',size:zipBuffer.byteLength,arrayBuffer:async()=>zipBuffer})");
assert.equal(run('state.layers.length'),11,JSON.stringify(run("$('noticetext').children.map(c=>c.textContent)")));
assert.equal(run('state.layers.filter(l=>l.type==="mask"&&l.negative).length'),2);
assert.equal(run('state.layers.filter(l=>l.visible).length'),9);
assert.ok(run('state.layers.every(l=>l.opacity===1)'),'All layers default to 100% opacity');
// Group visibility gates rendering without rewriting child checkbox preferences.
const preferences=run('JSON.stringify(state.layers.map(l=>l.visible))');
run("toggleGroup('Copper')");assert.equal(run("state.layers.filter(l=>l.group==='Copper'&&isLayerVisible(l)).length"),0);assert.equal(run('JSON.stringify(state.layers.map(l=>l.visible))'),preferences);
assert.equal(run("$('layers').children[0].children[0].children[0]['aria-pressed']"),'false');
run("toggleGroup('Copper')");assert.equal(run("state.layers.filter(l=>l.group==='Copper'&&isLayerVisible(l)).length"),4);assert.equal(run('JSON.stringify(state.layers.map(l=>l.visible))'),preferences);
// Solo is a persistent mode. Next/previous must change the layer and preserve preferences.
run("$('solo').click()");const firstSolo=run('state.selected');run("$('next').click()");assert.notEqual(run('state.selected'),firstSolo);assert.equal(run('state.layers.filter(isLayerVisible).length'),1);run("$('prev').click()");assert.equal(run('state.selected'),firstSolo);
// Complete a full cycle, including layers whose individual checkboxes were off.
const visited=new Set();for(let i=0;i<11;i++){visited.add(run('state.selected'));run("$('next').click()");assert.equal(run('state.layers.filter(isLayerVisible).length'),1);}assert.equal(visited.size,11);
run("toggleGroup('Manufacturing')");for(let i=0;i<6;i++){run('step(1)');assert.notEqual(run('state.layers.find(l=>l.id===state.selected).group'),'Manufacturing');}
run("toggleGroup('Manufacturing');$('solo').click()");assert.equal(run('JSON.stringify(state.layers.map(l=>l.visible))'),preferences);
// The all-layer control replaces existing individual values, including hidden layers.
run("state.layers[0].opacity=.2;state.layers[1].opacity=.7;$('allopacity').value=35;$('allopacity').oninput()");assert.ok(run('state.layers.every(l=>l.opacity===.35)'));assert.equal(run("$('allopacityvalue').textContent"),'35%');
run("$('allopacity').value=100;$('allopacity').oninput()");assert.ok(run('state.layers.every(l=>l.opacity===1)'));
console.log('Loaded sample:',run('state.layers.map(l=>[l.base,l.ops.length,l.warnings])'));
run('draw()');await fs.mkdir('tests/artifacts',{recursive:true});await fs.writeFile('tests/artifacts/overlay.png',main.toBuffer('image/png'));
for(const kind of ['copper','mask','drill']){run(`state.layers.forEach(l=>l.visible=l.type==='${kind}');draw()`);await fs.writeFile(`tests/artifacts/${kind}.png`,main.toBuffer('image/png'));}
run('state.layers.forEach(l=>l.visible=true);selectLayer(state.layers.find(l=>l.type==="copper").id)');assert.equal(run('state.order.at(-1)'),run('state.selected'));
run('step(1)');assert.equal(run('state.order.at(-1)'),run('state.selected'));
run("$('hide').click()");assert.equal(run('state.layers.filter(l=>l.visible).length'),0);run("$('solo').click()");assert.equal(run('state.layers.filter(isLayerVisible).length'),1);run("$('show').click()");assert.equal(run('state.layers.filter(l=>l.visible).length'),11);
// Use the actual pointer handlers to place a 25.4 mm line, then zoom/pan.
run("setTool('measure');state.scale=10;state.tx=0;state.ty=400;");
for(const x of [100,354]){sandbox.event={target:main,button:0,pointerId:1,clientX:x,clientY:300,preventDefault(){}};run("viewport.listeners.pointerdown(event);viewport.listeners.pointerup(event)");}
assert.equal(run('state.measurements.length'),1);assert.ok(Math.abs(run('Math.hypot(state.measurements[0].b[0]-state.measurements[0].a[0],state.measurements[0].b[1]-state.measurements[0].a[1])/MM_PER_MIL')-1000)<1e-8);
run('state.scale=20;state.tx=40;state.ty=500;draw()');assert.equal(run('state.measurements[0].a[0]'),10);assert.equal(run('screen(state.measurements[0].a)[0]'),240);
const gerber=body=>'%FSLAX24Y24*%%MOMM*%%ADD10C,1*%D10*'+body+'M02*';sandbox.fixture=gerber('X000000Y000000D03*X100000Y000000D03*');assert.equal(run('parseGerber(fixture).ops.length'),2);
// Layer-local clear polarity must punch holes without changing the canvas below.
sandbox.fixture='%FSLAX24Y24*%%MOMM*%%ADD10C,10*%%ADD11C,4*%D10*X0Y0D03*%LPC*%D11*X0Y0D03*M02*';
run("state.scale=20;state.tx=200;state.ty=200;state.revision++;let testLayer={...parseGerber(fixture),color:'#ffffff'};globalThis.testImage=paintLayer(testLayer)");
const image=sandbox.testImage.getContext('2d');assert.equal(image.getImageData(200,200,1,1).data[3],0);assert.equal(image.getImageData(260,200,1,1).data[3],255);
// Region contours, clockwise arcs, macro rotation, inch drills and invalid input.
sandbox.fixture=gerber('G36*X0Y0D02*X100000Y0D01*X100000Y100000D01*X0Y100000D01*X0Y0D01*G37*');assert.equal(run('parseGerber(fixture).ops[0].kind'),'fill');
run("state.scale=20;state.tx=200;state.ty=400;state.revision++;globalThis.regionImage=paintLayer({...parseGerber(fixture),color:'#ffffff'});");assert.equal(sandbox.regionImage.getContext('2d').getImageData(300,300,1,1).data[3],255,'Region interior must be filled');
sandbox.fixture=gerber('X0Y0D02*G75*G03X100000Y100000I0J100000D01*');assert.equal(run('parseGerber(fixture).ops.length'),1);
sandbox.fixture='M48\nINCH\nT1C0.04\n%\nT1\nX1.0Y2.0\nM30';assert.ok(Math.abs(run('parseDrill(fixture).bounds[0]')-24.892)<1e-8);
await assert.rejects(run('readZip(new ArrayBuffer(30))'));
// Failed reload preserves the current board and reports the failure.
await run("loadFile({name:'invalid.zip',size:1,arrayBuffer:async()=>new ArrayBuffer(1)})");assert.equal(run('state.layers.length'),11);assert.ok(run("$('noticetext').children[0].textContent.includes('not a readable ZIP')"));
// The negative mask must fill the board center, but leave the exterior empty.
run("fit();state.revision++;globalThis.maskImage=paintLayer(state.layers.find(l=>l.type==='mask'));globalThis.maskPoint=screen([(state.bounds[0]+state.bounds[2])/2,(state.bounds[1]+state.bounds[3])/2]);");
assert.ok(sandbox.maskImage.getContext('2d').getImageData(Math.round(sandbox.maskPoint[0]),Math.round(sandbox.maskPoint[1]),1,1).data[3]>0);
assert.equal(sandbox.maskImage.getContext('2d').getImageData(0,0,1,1).data[3],0);
// Color and opacity controls affect actual composited pixels.
run("state.layers.forEach(l=>l.visible=false);globalThis.target=state.layers.find(l=>l.type==='copper');target.visible=true;target.opacity=0;draw()");assert.equal(main.getContext('2d').getImageData(500,350,1,1).data[3],0);
// Macro expression evaluation uses a parser rather than executing source text.
assert.equal(run("expression('($1+2)x3/2',{1:4})"),9);
assert.throws(()=>run("expression('1/0',{})"));
for(const primitive of ['6,0,0,10,1,1,2,0.4,12,0','7,0,0,10,6,1,0']){sandbox.macroSource=primitive;assert.ok(run("aperture('TEST',[],{TEST:[macroSource]},1,new Set()).radius")>=5);}
// Cached navigation must preserve pixels and skip geometry work during ordinary drags.
run("state.measurements=[];$('show').click();$('allopacity').value=100;$('allopacity').oninput();setTool('pan');fit();draw();globalThis.navigationPaints=0;globalThis.navigationPainter=paintLayer;paintLayer=(...args)=>{navigationPaints++;return navigationPainter(...args)}");
sandbox.navigationEvent={target:main,button:0,pointerId:9,clientX:400,clientY:300,preventDefault(){}};
run('viewport.listeners.pointerdown(navigationEvent)');
for(let frame=1;frame<=30;frame++){sandbox.navigationEvent.clientX=400+frame*4;sandbox.navigationEvent.clientY=300+frame;run('viewport.listeners.pointermove(navigationEvent);draw()');}
run('viewport.listeners.pointerup(navigationEvent);draw()');assert.equal(run('navigationPaints'),0,'Panning inside overscan must reuse the composed render');
// Compare the cached scene against a direct, uncached render at its new position.
const cachedPixels=main.getContext('2d').getImageData(0,0,main.width,main.height).data;
run("globalThis.reference=document.createElement('canvas');reference.width=canvas.width;reference.height=canvas.height;globalThis.refContext=reference.getContext('2d');for(const id of state.order){const l=state.layers.find(l=>l.id===id);if(isLayerVisible(l)&&l.opacity>0){refContext.globalAlpha=l.opacity;refContext.drawImage(navigationPainter(l),0,0);}}");
const directPixels=sandbox.reference.getContext('2d').getImageData(0,0,main.width,main.height).data;
let differingPixels=0;for(let i=0;i<cachedPixels.length;i+=4)if(Math.abs(cachedPixels[i+3]-directPixels[i+3])>3||[0,1,2].some(k=>Math.abs(cachedPixels[i+k]*cachedPixels[i+3]/255-directPixels[i+k]*directPixels[i+3]/255)>3))differingPixels++;
assert.ok(differingPixels<main.width*main.height*.002,`Cached pan differs from reference at ${differingPixels} pixels`);
// Crossing the cache boundary refreshes the geometry instead of revealing clipped edges.
run('state.tx+=500;draw()');assert.equal(run('navigationPaints'),0,'A complete-board raster should support unbounded panning');run('state.scale*=4;draw()');await settleScene();run('navigationPaints=0;state.tx+=500;draw()');assert.ok(run('sceneJob'));await settleScene();run('navigationPaints=0');
// A burst of wheel events scales the cached scene, then refreshes detail once it settles.
sandbox.wheelEvent={clientX:550,clientY:350,deltaY:-30,preventDefault(){}};
for(let i=0;i<4;i++)run('viewport.listeners.wheel(wheelEvent);draw()');assert.equal(run('navigationPaints'),0,'Wheel preview must avoid geometry redraws');assert.notEqual(run('scene.view.scale'),run('state.scale'));
await new Promise(resolve=>setTimeout(resolve,170));await settleScene();assert.equal(run('scene.view.scale'),run('state.scale'));assert.equal(run('sceneJob'),null);
// Composition changes reuse sharp layer rasters and immediately update the cached scene.
run('navigationPaints=0');run("$('allopacity').value=25;$('allopacity').oninput();draw()");assert.equal(run('navigationPaints'),0,'Opacity changes should only recompose cached layers');
const changedScene=run('scene');run("toggleGroup('Copper');draw()");assert.notEqual(run('scene'),changedScene);assert.equal(run('navigationPaints'),0);assert.equal(run('overview.signature'),run('scene.signature'));
run("toggleGroup('Copper');state.solo=true;selectLayer(state.layers.find(l=>l.type==='copper').id);draw()");const oldSoloScene=run('scene');run('step(1);draw()');assert.notEqual(run('scene'),oldSoloScene);assert.equal(run('state.layers.filter(isLayerVisible).length'),1);
// A stale background job must not replace a newly selected composition.
run("state.solo=false;$('show').click();draw();state.tx+=600;draw()");assert.ok(run('sceneJob'));
const staleJob=run('sceneJob');run("toggleGroup('Copper');draw()");assert.notEqual(run('sceneJob'),staleJob);await settleScene();assert.equal(run('scene.signature'),run('overview.signature'));
// Fitting the board cancels pending work immediately.
run('state.tx+=600;draw()');assert.ok(run('sceneJob'));run('fit();draw()');assert.equal(run('sceneJob'),null);
// Stroke batching and bounds culling must preserve the unbatched image.
for(const type of ['outline','copper','mask']){
  sandbox.testType=type;run("globalThis.checkedLayer=state.layers.find(l=>l.type===testType);globalThis.optimized=paintLayer(checkedLayer);globalThis.savedRenderOps=checkedLayer.renderOps;checkedLayer.renderOps=checkedLayer.ops.map(op=>({...op,bounds:null}));globalThis.unbatched=paintLayer(checkedLayer);checkedLayer.renderOps=savedRenderOps;");
  const a=sandbox.optimized.getContext('2d').getImageData(0,0,main.width,main.height).data,b=sandbox.unbatched.getContext('2d').getImageData(0,0,main.width,main.height).data;
  let mismatch=0;
  const near=(pixels,x,y)=>{for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(x+dx>=0&&y+dy>=0&&x+dx<main.width&&y+dy<main.height&&pixels[((y+dy)*main.width+x+dx)*4+3]>16)return true;return false;};
  // Batching changes antialiasing where adjacent round caps overlap. Require the
  // same geometry within one physical pixel rather than identical edge alpha.
  for(let i=3;i<a.length;i+=4){const p=(i-3)/4,x=p%main.width,y=Math.floor(p/main.width);if(a[i]>32&&b[i]<16&&!near(b,x,y)||b[i]>32&&a[i]<16&&!near(a,x,y))mismatch++;}
  if(mismatch>=10){await fs.writeFile('tests/artifacts/batched-'+type+'.png',sandbox.optimized.toBuffer('image/png'));await fs.writeFile('tests/artifacts/unbatched-'+type+'.png',sandbox.unbatched.toBuffer('image/png'));}
  assert.ok(mismatch<10,`${type} has ${mismatch} pixels outside the reference geometry`);
}
// Refresh at a different device pixel ratio without changing world coordinates.
run("state.solo=true;selectLayer(state.layers.find(l=>l.type==='copper').id)");
run('state.dpr=2;canvas.width=state.width*2;canvas.height=state.height*2;fit();draw()');assert.equal(run('scene.view.dpr'),2);assert.equal(run('scene.viewportWidth'),2200);
run("state.dpr=1;canvas.width=state.width;canvas.height=state.height;paintLayer=navigationPainter;fit();draw()");
const html=await fs.readFile('gerber-viewer.html','utf8');assert.ok(!/<script[^>]+src=|<link[^>]+href=/i.test(html));
console.log('PASS: example ZIP, polarity, geometry, layer controls, measurement input, transforms and self-contained output.');
if(process.argv.includes('--benchmark')||process.argv.includes('--benchmark-long')){
  run("state.measurements=[];$('show').click();$('allopacity').value=100;$('allopacity').oninput();setTool('pan');fit();draw();globalThis.paintCount=0;globalThis.originalPaintSteps=paintLayerSteps;globalThis.backgroundTimes=[];paintLayerSteps=(...args)=>{paintCount++;return originalPaintSteps(...args)};globalThis.originalCompose=composeScene;composeScene=(...args)=>{const steps=originalCompose(...args);return {next(){const start=performance.now(),result=steps.next();backgroundTimes.push(performance.now()-start);return result},[Symbol.iterator](){return this}}}");
  if(process.argv.includes('--benchmark-long'))run('state.scale*=4;state.tx=state.width/2-state.bounds[2]*state.scale/2;state.ty=state.height/2+state.bounds[3]*state.scale/2;draw();paintCount=0');
  sandbox.event={target:main,button:0,pointerId:5,clientX:500,clientY:350,preventDefault(){}};
  await settleScene();run('viewport.listeners.pointerdown(event)');const times=[];
  for(let frame=1;frame<=40;frame++){sandbox.event.clientX=500+frame*(process.argv.includes('--benchmark-long')?24:3);sandbox.event.clientY=350+frame;const start=performance.now();run('viewport.listeners.pointermove(event);draw()');times.push(performance.now()-start);await new Promise(resolve=>setTimeout(resolve,8));}
  run('viewport.listeners.pointerup(event);draw()');await settleScene();times.sort((a,b)=>a-b);
  console.log(JSON.stringify({frames:times.length,meanMs:times.reduce((a,b)=>a+b)/times.length,medianMs:times[Math.floor(times.length/2)],p95Ms:times[Math.floor(times.length*.95)],maxMs:times.at(-1),layerRepaints:run('paintCount'),maxBackgroundStepMs:run('Math.max(0,...backgroundTimes)')},null,2));
}
