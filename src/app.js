const $=id=>document.getElementById(id), canvas=$('canvas'),ctx=canvas.getContext('2d'),viewport=$('viewport');
const state={layers:[],selected:null,order:[],bounds:null,scale:1,fitScale:1,tx:0,ty:0,width:1,height:1,dpr:1,tool:'pan',measurements:[],start:null,pointer:null,space:false,loading:false,revision:0,groups:{Copper:true,Manufacturing:true,Drill:true},solo:false};
let scheduled=false,drag=null,dropDepth=0,scene=null,zooming=false,zoomTimer=null,overview=null,sceneJob=null;
function notify(messages){$('noticetext').replaceChildren();for(const message of messages){const div=document.createElement('div');div.textContent=message;$('noticetext').append(div);}$('notice').hidden=!messages.length;}
function requestDraw(invalidate=false){if(invalidate)state.revision++;if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;draw();});}}
function screen(p){return [p[0]*state.scale+state.tx,-p[1]*state.scale+state.ty];}
function world(p){return [(p[0]-state.tx)/state.scale,-(p[1]-state.ty)/state.scale];}
function local(e){const r=drag?.rect||viewport.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top];}
function fit(){if(!state.bounds)return;clearTimeout(zoomTimer);zooming=false;cancelSceneJob();const [x1,y1,x2,y2]=state.bounds,w=Math.max(x2-x1,.1),h=Math.max(y2-y1,.1);state.scale=Math.max(.001,Math.min((state.width-70)/w,(state.height-90)/h));state.fitScale=state.scale;state.tx=state.width/2-(x1+x2)/2*state.scale;state.ty=state.height/2+(y1+y2)/2*state.scale;requestDraw(true);}
function setTool(tool){state.tool=tool;state.start=null;state.pointer=null;$('pan').classList.toggle('active',tool==='pan');$('measure').classList.toggle('active',tool==='measure');viewport.classList.toggle('measuring',tool==='measure');updateMeasurements();requestDraw();}
function selectLayer(id){state.selected=id;state.order=state.order.filter(n=>n!==id);state.order.push(id);renderLayers();requestDraw();}
function isLayerVisible(layer){return state.groups[layer.group]!==false&&(state.solo?layer.id===state.selected:layer.visible);}
function step(direction){const candidates=state.layers.filter(l=>state.groups[l.group]!==false&&(state.solo||l.visible));if(!candidates.length)return;const index=candidates.findIndex(l=>l.id===state.selected);selectLayer(candidates[index<0?(direction>0?0:candidates.length-1):(index+direction+candidates.length)%candidates.length].id);}
function toggleGroup(group){state.groups[group]=state.groups[group]===false;renderLayers();requestDraw();}
function updateAllOpacity(){const values=state.layers.map(l=>Math.round(l.opacity*100)),uniform=!values.length||values.every(v=>v===values[0]);if(uniform)$('allopacity').value=values[0]??100;$('allopacityvalue').textContent=uniform?`${values[0]??100}%`:'Mixed';}
function renderLayers(){const root=$('layers');root.replaceChildren();$('solo').classList.toggle('active',state.solo);$('solo').setAttribute('aria-pressed',String(state.solo));updateAllOpacity();for(const group of ['Copper','Manufacturing','Drill']){const layers=state.layers.filter(l=>l.group===group);if(!layers.length)continue;const section=document.createElement('section');section.className='layer-group';section.setAttribute('aria-label',group+' layers');const heading=document.createElement('h2');heading.className='layer-group-title';const toggle=document.createElement('button');toggle.className='group-toggle';toggle.textContent=group;toggle.setAttribute('aria-pressed',String(state.groups[group]!==false));toggle.title='Show or hide '+group.toLowerCase()+' layers';toggle.onclick=()=>toggleGroup(group);heading.append(toggle);section.classList.toggle('group-hidden',state.groups[group]===false);const count=document.createElement('span');count.className='count';count.textContent=layers.length;heading.append(count);section.append(heading);root.append(section);for(const layer of layers){const row=document.createElement('div');row.className='layer'+(layer.id===state.selected?' selected':'');row.dataset.layer=layer.id;
  const top=document.createElement('div');top.className='layer-top';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=layer.visible;checkbox.setAttribute('aria-label',`Show ${layer.base}`);checkbox.onchange=()=>{layer.visible=checkbox.checked;requestDraw();};
  const color=document.createElement('input');color.type='color';color.value=layer.color;color.setAttribute('aria-label',`Color of ${layer.base}`);color.disabled=!!layer.fixedColor;color.title=layer.fixedColor?`${layer.label} color is fixed`:'Change layer color';color.oninput=()=>{layer.color=layer.fixedColor||color.value;color.value=layer.color;layer.cache=null;requestDraw();};
  const name=document.createElement('button');name.className='layer-name';name.textContent=layer.label;name.title='Bring '+layer.base+' to front';name.onclick=()=>selectLayer(layer.id);top.append(checkbox,color,name);if(layer.id===state.selected){const front=document.createElement('span');front.className='front';front.textContent='Front';top.append(front);}row.append(top);
  const file=document.createElement('div');file.className='layer-file';file.textContent=layer.base;file.title=layer.name;row.append(file);
  const opacity=document.createElement('div');opacity.className='opacity';const slider=document.createElement('input');slider.type='range';slider.min=0;slider.max=100;slider.value=Math.round(layer.opacity*100);slider.setAttribute('aria-label',`Opacity of ${layer.base}`);const output=document.createElement('output');output.textContent=slider.value+'%';slider.oninput=()=>{layer.opacity=+slider.value/100;output.textContent=slider.value+'%';updateAllOpacity();requestDraw();};layer.opacityInput=slider;layer.opacityOutput=output;opacity.append(slider,output);row.append(opacity);section.append(row);
}}}
function convexHull(points){points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);const low=[],high=[];for(const p of points){while(low.length>1&&cross(low.at(-2),low.at(-1),p)<=0)low.pop();low.push(p);}for(const p of points.toReversed()){while(high.length>1&&cross(high.at(-2),high.at(-1),p)<=0)high.pop();high.push(p);}return low.slice(0,-1).concat(high.slice(0,-1));}
function toolStamp(tool,op,cache,zoom=state.scale*state.dpr){const key=[tool.name,op.rotation,op.scale,op.mirrorX,op.mirrorY].join('/');let map=cache.get(tool);if(!map){map=new Map();cache.set(tool,map);}if(map.has(key))return map.get(key);
  const radius=tool.radius*(op.scale||1),side=Math.max(3,Math.ceil(radius*zoom)*2+6);if(side>8192||side*side>4e6) return null;
  const c=document.createElement('canvas');c.width=c.height=side;const g=c.getContext('2d');g.translate(side/2,side/2);g.scale(zoom*(op.scale||1)*(op.mirrorX||1),-zoom*(op.scale||1)*(op.mirrorY||1));g.rotate((op.rotation||0)*Math.PI/180);g.fillStyle='#fff';for(const part of tool.parts){g.globalCompositeOperation=part.clear?'destination-out':'source-over';g.fill(part.path);}const result={canvas:c,side};if((cache.pixels||0)+side*side<=4e6){map.set(key,result);cache.pixels=(cache.pixels||0)+side*side;}return result;
}
function rasterView(padding=0){const pad=Math.ceil(padding*state.dpr);return {scale:state.scale,dpr:state.dpr,tx:state.tx+pad/state.dpr,ty:state.ty+pad/state.dpr,width:canvas.width+pad*2,height:canvas.height+pad*2};}
function wholeBoardView(s=state.scale){
  const d=state.dpr,pad=4,bounds=[Math.min(...state.layers.map(l=>l.bounds[0])),Math.min(...state.layers.map(l=>l.bounds[1])),Math.max(...state.layers.map(l=>l.bounds[2])),Math.max(...state.layers.map(l=>l.bounds[3]))];
  const left=Math.floor((bounds[0]*s+state.tx)*d)-pad,top=Math.floor((state.ty-bounds[3]*s)*d)-pad,width=Math.ceil((bounds[2]*s+state.tx)*d)-left+pad,height=Math.ceil((state.ty-bounds[1]*s)*d)-top+pad;
  return {scale:s,dpr:d,tx:state.tx-left/d,ty:state.ty-top/d,width,height,wholeBoard:true};
}
function sceneView(){
  const view=wholeBoardView();
  // Bound total full-board raster memory. High zoom uses viewport-sized rasters.
  if(view.width*view.height<=Math.min(4e6,24e6/Math.max(1,state.layers.length))&&Math.max(view.width,view.height)<=8192)return view;
  return rasterView(Math.min(192,state.width/4,state.height/4));
}
function overviewView(){
  const view=wholeBoardView(Math.min(state.scale,state.fitScale)),budget=Math.min(4e6,24e6/Math.max(1,state.layers.length));
  const factor=Math.min(1,Math.sqrt(budget/(view.width*view.height))*.95,8000/Math.max(view.width,view.height));
  return factor===1?view:wholeBoardView(view.scale*factor);
}
function renderOperations(layer){
  if(layer.renderOps)return layer.renderOps;
  const result=[];let batch=null,count=0;
  for(const op of layer.ops){
    if(op.kind==='stroke'&&op.tool.name==='C'){
      const compatible=batch&&count<128&&batch.tool===op.tool&&batch.clear===op.clear&&batch.dx===op.dx&&batch.dy===op.dy&&batch.scale===op.scale;
      if(!compatible){batch={...op,path:new Path2D(),bounds:op.bounds?.slice()};result.push(batch);count=0;}
      batch.path.moveTo(op.x,op.y);if(op.arc)batch.path.arc(...op.arc);else batch.path.lineTo(op.nx,op.ny);count++;
      if(batch.bounds&&op.bounds)for(let k=0;k<4;k++)batch.bounds[k]=(k<2?Math.min:Math.max)(batch.bounds[k],op.bounds[k]);else batch.bounds=null;
    }else {result.push(op);batch=null;}
  }
  layer.renderOps=result;return result;
}
function viewKey(view){return [view.scale,view.dpr,view.tx,view.ty,view.width,view.height].join('/');}
function paintLayer(layer,view=rasterView()){const steps=paintLayerSteps(layer,view);let result;do{result=steps.next();}while(!result.done);return result.value;}
function* paintLayerSteps(layer,view){
  const c=document.createElement('canvas');c.width=view.width;c.height=view.height;const g=c.getContext('2d'),d=view.dpr,s=view.scale,stampZoom=s*d;
  if(layer.stampZoom!==stampZoom){layer.stampZoom=stampZoom;layer.stamps=new Map();}
  const stampCache=layer.stamps,area=[-view.tx/s,(view.ty-view.height/d)/s,(view.width/d-view.tx)/s,view.ty/s];g.setTransform(d*s,0,0,-d*s,d*view.tx,d*view.ty);
  if(layer.negative){g.fillStyle='#fff';if(state.outlinePath)g.fill(state.outlinePath,'evenodd');else {const b=state.bounds;g.fillRect(b[0],b[1],b[2]-b[0],b[3]-b[1]);}}
  let deadline=performance.now()+2,operations=0;
  for(const op of renderOperations(layer)){
    const b=op.bounds,dx=op.dx||0,dy=op.dy||0;
    if(b&&(b[2]+dx<area[0]||b[0]+dx>area[2]||b[3]+dy<area[1]||b[1]+dy>area[3]))continue;
    g.save();g.translate(op.dx||0,op.dy||0);g.globalCompositeOperation=(op.clear!==layer.negative)?'destination-out':'source-over';g.fillStyle=g.strokeStyle='#fff';
    if(op.kind==='flash') { const stamp=toolStamp(op.tool,op,stampCache,s*d);if(stamp){const sx=(op.x+(op.dx||0))*s+view.tx,sy=-(op.y+(op.dy||0))*s+view.ty;g.setTransform(1,0,0,1,0,0);g.drawImage(stamp.canvas,sx*d-stamp.side/2,sy*d-stamp.side/2);}else {
      const scratch=document.createElement('canvas');scratch.width=c.width;scratch.height=c.height;const sg=scratch.getContext('2d');sg.setTransform(d*s,0,0,-d*s,d*view.tx,d*view.ty);sg.translate(op.x+(op.dx||0),op.y+(op.dy||0));sg.scale((op.scale||1)*(op.mirrorX||1),(op.scale||1)*(op.mirrorY||1));sg.rotate((op.rotation||0)*Math.PI/180);sg.fillStyle='#fff';for(const part of op.tool.parts){sg.globalCompositeOperation=part.clear?'destination-out':'source-over';sg.fill(part.path);}g.setTransform(1,0,0,1,0,0);g.drawImage(scratch,0,0);
    }}
    else if(op.kind==='fill')g.fill(op.path,op.evenOdd?'evenodd':'nonzero');
    else {
      const t=op.tool,k=op.scale||1;g.lineWidth=Math.max(t.width*k||t.radius*2*k,1/(s*d));g.lineCap='round';g.lineJoin='round';
      const transform=points=>rotatePoints(points.map(([x,y])=>[x*k*(op.mirrorX||1),y*k*(op.mirrorY||1)]),op.rotation||0);
      if((t.name==='R'||t.name==='O')&&op.mode===1){
        const w=t.width/2,h=t.height/2;
        const shape=t.name==='R'?transform([[-w,-h],[w,-h],[w,h],[-w,h]]):transform(w>=h?[[-w+h,0],[w-h,0]]:[[0,-h+w],[0,h-w]]);
        const points=convexHull(shape.flatMap(([x,y])=>[[x+op.x,y+op.y],[x+op.nx,y+op.ny]]));const path=polygonPath(points);
        if(t.name==='R')g.fill(path);else {g.lineWidth=Math.min(t.width,t.height)*k;g.stroke(path);g.fill(path);}
      }else g.stroke(op.path);
    }
    g.restore();
    if(++operations%4===0&&performance.now()>=deadline){yield;deadline=performance.now()+2;}
  }
  g.setTransform(1,0,0,1,0,0);g.globalCompositeOperation='source-in';g.fillStyle=layer.color;g.fillRect(0,0,c.width,c.height);layer.cache={canvas:c,revision:state.revision,key:viewKey(view),color:layer.color};if(view.wholeBoard)layer.overviewCache=layer.cache;return c;
}
function drawMeasurement(a,b,index,preview=false){const p=screen(a),q=screen(b);ctx.save();ctx.strokeStyle=preview?'#f5d4a0':'#f6c779';ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=1.3;if(preview)ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(...p);ctx.lineTo(...q);ctx.stroke();ctx.setLineDash([]);for(const e of [p,q]){ctx.beginPath();ctx.arc(...e,3,0,2*Math.PI);ctx.fill();ctx.beginPath();ctx.moveTo(e[0]-7,e[1]);ctx.lineTo(e[0]+7,e[1]);ctx.moveTo(e[0],e[1]-7);ctx.lineTo(e[0],e[1]+7);ctx.stroke();}
  const distance=Math.hypot(b[0]-a[0],b[1]-a[1]);const label=`${index}. ${distance.toFixed(3)} mm / ${(distance/MM_PER_MIL).toFixed(2)} mil`;ctx.font='11px ui-monospace, monospace';const w=ctx.measureText(label).width+14,mx=Math.min(Math.max((p[0]+q[0])/2-w/2,5),Math.max(5,state.width-w-5)),my=Math.min(Math.max((p[1]+q[1])/2-27,5),state.height-26);ctx.fillStyle='#111c2dee';ctx.fillRect(mx,my,w,23);ctx.fillStyle='#f4d09b';ctx.fillText(label,mx+7,my+15);ctx.restore();
}
function cancelSceneJob(){if(sceneJob){clearTimeout(sceneJob.timer);sceneJob=null;}}
function* composeScene(layers,signature,view){
  const image=document.createElement('canvas');image.width=view.width;image.height=view.height;const g=image.getContext('2d'),key=viewKey(view),revision=state.revision;
  for(const layer of layers){const cache=view.wholeBoard?layer.overviewCache||layer.cache:layer.cache;const raster=cache?.revision===revision&&cache.key===key&&cache.color===layer.color?cache.canvas:yield* paintLayerSteps(layer,view);g.globalAlpha=layer.opacity;g.drawImage(raster,0,0);yield;}
  return {canvas:image,view,signature,revision,viewportWidth:canvas.width,viewportHeight:canvas.height};
}
function queueScene(layers,signature,view){
  if(sceneJob)return;
  const job={signature,revision:state.revision,steps:composeScene(layers,signature,view),timer:null};sceneJob=job;
  function advance(){
    if(sceneJob!==job)return;
    const deadline=performance.now()+4;let result;
    do{result=job.steps.next();}while(!result.done&&performance.now()<deadline);
    if(result.done){sceneJob=null;scene=result.value;if(scene.view.wholeBoard)overview=scene;requestDraw();}
    else job.timer=setTimeout(advance,0);
  }
  job.timer=setTimeout(advance,0);
}
function blitScene(cached){const v=cached.view,ratio=state.scale/v.scale,d=state.dpr;ctx.drawImage(cached.canvas,d*(state.tx-v.tx*ratio),d*(state.ty-v.ty*ratio),cached.canvas.width*ratio,cached.canvas.height*ratio);}
// Render only small slices of a new scene while navigation continues. A complete
// board image fills newly exposed areas until the detailed scene is ready.
function drawScene(){
  if(!state.layers.length)return;
  const layersById=new Map(state.layers.map(l=>[l.id,l]));
  const layers=state.order.map(id=>layersById.get(id)).filter(l=>l&&isLayerVisible(l)&&l.opacity>0);
  const signature=JSON.stringify(layers.map(l=>[l.id,l.color,l.opacity]));
  const sameScene=scene&&scene.revision===state.revision&&scene.viewportWidth===canvas.width&&scene.viewportHeight===canvas.height&&scene.view.dpr===state.dpr;
  if(sceneJob&&(sceneJob.signature!==signature||sceneJob.revision!==state.revision))cancelSceneJob();
  if(overview&&overview.revision!==state.revision)overview=null;
  if(overview&&overview.signature!==signature){
    // Recompose the low-resolution fallback too, keeping later drags asynchronous
    // after visibility, opacity, ordering or color changes.
    const steps=composeScene(layers,signature,overview.view);let result;do{result=steps.next();}while(!result.done);overview=result.value;
  }
  let reusable=false,covered=false;
  if(sameScene){const v=scene.view,ratio=state.scale/v.scale,x=state.tx-v.tx*ratio,y=state.ty-v.ty*ratio;
    covered=v.wholeBoard||x<=0&&y<=0&&x+v.width/state.dpr*ratio>=state.width&&y+v.height/state.dpr*ratio>=state.height;
    reusable=v.scale===state.scale&&covered;
  }
  const preview=zooming&&sameScene&&scene.signature===signature;
  if(!preview&&(!reusable||scene.signature!==signature)){
    const view=reusable?scene.view:sceneView();
    if(sameScene&&scene.signature===signature&&overview)queueScene(layers,signature,view);
    else {
      cancelSceneJob();const steps=composeScene(layers,signature,view);let result;do{result=steps.next();}while(!result.done);scene=result.value;if(view.wholeBoard)overview=scene;
    }
  }
  if(!overview){
    const steps=composeScene(layers,signature,overviewView());let result;do{result=steps.next();}while(!result.done);overview=result.value;
  }
  if(!covered&&overview&&overview!==scene){
    blitScene(overview);
    const v=scene.view,ratio=state.scale/v.scale,d=state.dpr;
    // Clear the detailed image's rectangle before copying it, so transparent
    // layers do not become more opaque by drawing two images on top of each other.
    ctx.clearRect(d*(state.tx-v.tx*ratio),d*(state.ty-v.ty*ratio),scene.canvas.width*ratio,scene.canvas.height*ratio);
  }
  blitScene(scene);
}
function draw(){if(state.pointer){const w=state.pointer;$('coordinates').textContent=`X ${w[0].toFixed(3)} mm · Y ${w[1].toFixed(3)} mm`;}const d=state.dpr;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);drawScene();ctx.globalAlpha=1;ctx.setTransform(d,0,0,d,0,0);state.measurements.forEach((m,i)=>drawMeasurement(m.a,m.b,i+1));if(state.start&&state.pointer)drawMeasurement(state.start,state.pointer,state.measurements.length+1,true);
  $('zoom').textContent=Math.round(state.scale/state.fitScale*100)+'%';if(state.bounds){const raw=100/state.scale,pow=10**Math.floor(Math.log10(raw)),normalized=raw/pow,value=(normalized>=5?5:normalized>=2?2:1)*pow;$('scaletext').textContent=`${Number(value.toPrecision(4))} mm · ${(value/MM_PER_MIL).toFixed(1)} mil`;$('scaleline').style.width=value*state.scale+'px';}$('status').textContent=state.layers.length?`${state.layers.filter(isLayerVisible).length} / ${state.layers.length} layers visible`:'Ready';}
function updateMeasurements(){const root=$('measurementlist');root.replaceChildren();for(const [i,m]of state.measurements.entries()){const dx=m.b[0]-m.a[0],dy=m.b[1]-m.a[1],dist=Math.hypot(dx,dy),div=document.createElement('div');div.className='measurement';const strong=document.createElement('strong');strong.textContent=`${i+1}. ${dist.toFixed(3)} mm / ${(dist/MM_PER_MIL).toFixed(2)} mil`;div.append(strong,document.createElement('br'),`ΔX ${dx.toFixed(3)} mm / ${(dx/MM_PER_MIL).toFixed(2)} mil`,document.createElement('br'),`ΔY ${dy.toFixed(3)} mm / ${(dy/MM_PER_MIL).toFixed(2)} mil`);root.append(div);}
  $('measurepanel').hidden=state.tool!=='measure'&&!state.measurements.length;$('measurehelp').textContent=state.tool==='measure'?(state.start?'Click the end point. Escape cancels.':'Click the start point, then the end point.'):'Measurements stay anchored while you pan and zoom.';}
function outlinePath(layers){
  const outline=layers.find(l=>l.type==='outline');if(!outline)return null;
  const edges=outline.ops.filter(op=>op.kind==='stroke'),byPoint=new Map(),used=new Set(),p=new Path2D();
  const key=(x,y)=>`${Math.round(x*10000)},${Math.round(y*10000)}`;
  for(const [i,e]of edges.entries())for(const [x,y,reverse]of [[e.x,e.y,false],[e.nx,e.ny,true]]){const k=key(x,y);if(!byPoint.has(k))byPoint.set(k,[]);byPoint.get(k).push({i,reverse});}
  for(let first=0;first<edges.length;first++){
    if(used.has(first))continue;const initial=edges[first];let current={i:first,reverse:false},last=[initial.x,initial.y];p.moveTo(...last);
    while(current){const e=edges[current.i];used.add(current.i);const reverse=current.reverse;
      if(e.arc){const [cx,cy,r,a,b,ccw]=e.arc;p.arc(cx,cy,r,reverse?b:a,reverse?a:b,reverse?!ccw:ccw);}else p.lineTo(reverse?e.x:e.nx,reverse?e.y:e.ny);
      last=reverse?[e.x,e.y]:[e.nx,e.ny];current=byPoint.get(key(...last))?.find(next=>!used.has(next.i));
    }
    if(Math.hypot(last[0]-initial.x,last[1]-initial.y)<.001)p.closePath();
  }
  return edges.length?p:null;
}
async function loadFile(file){if(state.loading)return;state.loading=true;$('busy').hidden=false;$('progress').textContent=file.name;notify([]);try{if(file.size>64e6)throw Error('ZIP exceeds the 64 MB input limit.');const files=await readZip(await file.arrayBuffer()),layers=[],messages=[];
  for(const f of files){const info=identify(f.name,f.text);if(!/\.(gbr|ger|gerber|g[bt][losp]|g\d+l?|gm\d+|gko|drl|xln|exc|xnc|art|pho)$/i.test(f.name)&&!/%FS|%MO|^M48/m.test(f.text)){messages.push(`Skipped ${f.name}`);continue;}$('progress').textContent=`Reading ${info.base}`;await new Promise(resolve=>setTimeout(resolve,0));try{const geometry=info.type==='drill'||/^M48/m.test(f.text)?parseDrill(f.text):parseGerber(f.text);layers.push({...info,...geometry,id:layers.length,name:f.name});for(const warning of geometry.warnings)messages.push(`${info.base}: ${warning}`);}catch(e){messages.push(`${info.base}: ${e.message}`);}}
  if(!layers.length)throw Error('No supported, drawable Gerber or drill layers found. '+messages.join(' '));
  const rank=l=>l.type==='copper'?0:l.type==='outline'?1:l.type==='silk'?2:l.type==='mask'?3:l.type==='drill'?6:5;layers.sort((a,b)=>rank(a)-rank(b)||a.level-b.level||a.base.localeCompare(b.base));
  cancelSceneJob();scene=null;overview=null;clearTimeout(zoomTimer);zooming=false;state.layers=layers;state.groups={Copper:true,Manufacturing:true,Drill:true};state.solo=false;state.order=layers.map(l=>l.id).reverse();state.selected=layers.find(l=>l.visible)?.id??layers[0].id;state.order=state.order.filter(id=>id!==state.selected).concat(state.selected);const profile=layers.find(l=>l.type==='outline');state.bounds=profile?profile.bounds:[Math.min(...layers.map(l=>l.bounds[0])),Math.min(...layers.map(l=>l.bounds[1])),Math.max(...layers.map(l=>l.bounds[2])),Math.max(...layers.map(l=>l.bounds[3]))];state.outlinePath=outlinePath(layers);if(!state.outlinePath&&layers.some(l=>l.negative))messages.push('No closed board outline found. Negative layers use the overall drawing extents.');state.measurements=[];state.start=null;state.pointer=null;
  $('filename').textContent=file.name;$('filemeta').textContent=`${layers.length} layers · ${(file.size/1024).toFixed(0)} KB archive`;$('layercount').textContent=layers.length;$('empty').hidden=true;$('scale').hidden=false;const b=state.bounds;$('boardinfo').textContent=`${(b[2]-b[0]).toFixed(2)} × ${(b[3]-b[1]).toFixed(2)} mm`;renderLayers();updateMeasurements();fit();notify(messages);
 }catch(e){notify([e.message]);}finally{state.loading=false;$('busy').hidden=true;$('file').value='';}}
$('open').onclick=$('browse').onclick=()=>$('file').click();$('file').onchange=e=>{if(e.target.files[0])loadFile(e.target.files[0]);};$('dismiss').onclick=()=>$('notice').hidden=true;
$('allopacity').oninput=()=>{const opacity=+$('allopacity').value/100;state.layers.forEach(l=>{l.opacity=opacity;if(l.opacityInput)l.opacityInput.value=Math.round(opacity*100);if(l.opacityOutput)l.opacityOutput.textContent=Math.round(opacity*100)+'%';});updateAllOpacity();requestDraw();};
$('show').onclick=()=>{state.solo=false;state.groups={Copper:true,Manufacturing:true,Drill:true};state.layers.forEach(l=>l.visible=true);renderLayers();requestDraw();};$('hide').onclick=()=>{state.solo=false;state.layers.forEach(l=>l.visible=false);renderLayers();requestDraw();};$('solo').onclick=()=>{if(state.selected===null)return;state.solo=!state.solo;renderLayers();requestDraw();};$('prev').onclick=()=>step(-1);$('next').onclick=()=>step(1);$('fit').onclick=fit;$('pan').onclick=()=>setTool('pan');$('measure').onclick=()=>setTool('measure');$('clear').onclick=()=>{state.measurements=[];state.start=null;updateMeasurements();requestDraw();};
viewport.addEventListener('wheel',e=>{e.preventDefault();if(!state.bounds)return;const p=local(e),w=world(p),factor=Math.exp(-Math.max(-150,Math.min(150,e.deltaY))*.002);state.scale=Math.max(state.fitScale*.05,Math.min(state.fitScale*500,state.scale*factor));state.tx=p[0]-w[0]*state.scale;state.ty=p[1]+w[1]*state.scale;zooming=true;clearTimeout(zoomTimer);zoomTimer=setTimeout(()=>{zooming=false;requestDraw();},120);requestDraw();},{passive:false});
viewport.addEventListener('pointerdown',e=>{if(e.target!==canvas||!state.bounds||![0,1].includes(e.button))return;e.preventDefault();viewport.setPointerCapture(e.pointerId);const p=local(e);drag={id:e.pointerId,rect:viewport.getBoundingClientRect(),p,last:p,moved:false,pan:state.tool==='pan'||state.space||e.button===1};if(drag.pan)viewport.classList.add('panning');});
viewport.addEventListener('pointermove',e=>{const p=local(e);if(drag&&drag.id===e.pointerId){if(Math.hypot(p[0]-drag.p[0],p[1]-drag.p[1])>3)drag.moved=true;if(drag.pan){state.tx+=p[0]-drag.last[0];state.ty+=p[1]-drag.last[1];requestDraw();}drag.last=p;}state.pointer=world(p);requestDraw();});
viewport.addEventListener('pointerup',e=>{if(!drag||drag.id!==e.pointerId)return;if(!drag.pan&&!drag.moved){const p=world(local(e));if(state.start){state.measurements.push({a:state.start,b:p});state.start=null;}else state.start=p;updateMeasurements();requestDraw();}drag=null;viewport.classList.remove('panning');requestDraw();});viewport.addEventListener('pointercancel',()=>{drag=null;viewport.classList.remove('panning');requestDraw();});
window.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.ctrlKey||e.metaKey||e.altKey)return;if(e.code==='Space'){state.space=true;e.preventDefault();}if(e.key==='Escape'){state.start=null;updateMeasurements();requestDraw();}if(e.key.toLowerCase()==='f')fit();if(e.key.toLowerCase()==='m')setTool(state.tool==='measure'?'pan':'measure');if(e.key==='[')step(-1);if(e.key===']')step(1);});window.addEventListener('keyup',e=>{if(e.code==='Space')state.space=false;});window.addEventListener('blur',()=>{state.space=false;drag=null;viewport.classList.remove('panning');requestDraw();});
window.addEventListener('dragenter',e=>{e.preventDefault();if([...e.dataTransfer.types].includes('Files')){dropDepth++;$('drop').classList.add('shown');}});window.addEventListener('dragleave',e=>{e.preventDefault();if(--dropDepth<=0){dropDepth=0;$('drop').classList.remove('shown');}});window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>{e.preventDefault();dropDepth=0;$('drop').classList.remove('shown');if(e.dataTransfer.files[0])loadFile(e.dataTransfer.files[0]);});
new ResizeObserver(()=>{state.width=viewport.clientWidth;state.height=viewport.clientHeight;state.dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(state.width*state.dpr);canvas.height=Math.round(state.height*state.dpr);if(state.bounds)fit();else requestDraw(true);}).observe(viewport);
