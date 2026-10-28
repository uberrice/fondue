/* Gerber geometry and ZIP loading. Coordinates are always millimetres. */
const MM_PER_MIL = 0.0254;
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) { crc ^= byte; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ -1) >>> 0;
}
async function readZip(buffer) {
  const data = new Uint8Array(buffer), v = new DataView(buffer), decoder = new TextDecoder();
  if(data.length<22)throw Error('This is not a readable ZIP archive.');
  let end = data.length - 22;
  for (; end >= Math.max(0, data.length - 65557); end--) if (v.getUint32(end, true) === 0x06054b50) break;
  if (end < 0 || v.getUint32(end, true) !== 0x06054b50) throw Error('This is not a readable ZIP archive.');
  if (v.getUint16(end + 4, true) || v.getUint16(end + 6, true)) throw Error('Split ZIP archives are not supported.');
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true), total = 0;
  if (count > 1000) throw Error('This archive has more than 1,000 entries.');
  const files = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > data.length || v.getUint32(at, true) !== 0x02014b50) throw Error('The ZIP directory is damaged or uses ZIP64.');
    const flags = v.getUint16(at + 8, true), method = v.getUint16(at + 10, true), crc = v.getUint32(at + 16, true);
    const size = v.getUint32(at + 24, true), packed = v.getUint32(at + 20, true), offset = v.getUint32(at + 42, true);
    const nl = v.getUint16(at + 28, true), extra = v.getUint16(at + 30, true), comment = v.getUint16(at + 32, true);
    const name = decoder.decode(data.subarray(at + 46, at + 46 + nl)); at += 46 + nl + extra + comment;
    if (name.endsWith('/') || name.startsWith('__MACOSX/')) continue;
    total += size;
    if (size > 64e6 || total > 256e6) throw Error('Archive exceeds the 64 MB per file or 256 MB expanded limit.');
    if (flags & 1) throw Error('Password-protected ZIP archives are not supported.');
    if (offset + 30 > data.length || v.getUint32(offset, true) !== 0x04034b50) throw Error('Damaged ZIP file header.');
    const start = offset + 30 + v.getUint16(offset + 26, true) + v.getUint16(offset + 28, true);
    if (start + packed > data.length) throw Error('Truncated ZIP entry.');
    let bytes = data.slice(start, start + packed);
    if (method === 8) {
      let stream;
      try { stream = new DecompressionStream('deflate-raw'); } catch { throw Error('This browser cannot decompress ZIP files. Please use a current desktop browser.'); }
      const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
      const chunks = []; let length = 0;
      while (true) { const {value, done} = await reader.read(); if (done) break; length += value.length; if (length > size) { await reader.cancel(); throw Error('ZIP entry is larger than its declared size.'); } chunks.push(value); }
      bytes = new Uint8Array(length); let pos = 0; for (const c of chunks) { bytes.set(c, pos); pos += c.length; }
    } else if (method !== 0) throw Error(`Unsupported ZIP compression method ${method}.`);
    if (bytes.length !== size || crc32(bytes) !== crc) throw Error(`Corrupt ZIP entry: ${name}`);
    files.push({name, text: decoder.decode(bytes)});
  }
  return files;
}
function expression(source, vars) {
  const tokens = source.replace(/[xX]/g, '*').match(/\$\d+|(?:\d*\.)?\d+(?:[eE][+-]?\d+)?|[()+*/-]/g) || [];
  let i = 0;
  function atom() { const t = tokens[i++]; if (t === '-') return -atom(); if (t === '+') return atom(); if (t === '(') { const a = sum(); if (tokens[i++] !== ')') throw Error('Invalid aperture expression.'); return a; } return t?.startsWith('$') ? vars[+t.slice(1)] || 0 : Number(t); }
  function product() { let a = atom(); while (tokens[i] === '*' || tokens[i] === '/') { const op = tokens[i++], b = atom(); a = op === '*' ? a * b : a / b; } return a; }
  function sum() { let a = product(); while (tokens[i] === '+' || tokens[i] === '-') { const op = tokens[i++], b = product(); a = op === '+' ? a + b : a - b; } return a; }
  const result = sum(); if (!Number.isFinite(result) || i !== tokens.length) throw Error('Invalid aperture expression.'); return result;
}
function circlePath(x,y,d) { const p = new Path2D(); if (d > 0) { p.moveTo(x+d/2,y); p.arc(x,y,d/2,0,Math.PI*2); } return p; }
function polygonPath(points) { const p = new Path2D(); if (points.length) { p.moveTo(...points[0]); for (const point of points.slice(1)) p.lineTo(...point); p.closePath(); } return p; }
function rotatePoints(points, deg) { const a = deg*Math.PI/180; return points.map(([x,y]) => [x*Math.cos(a)-y*Math.sin(a), x*Math.sin(a)+y*Math.cos(a)]); }
function aperture(name, args, macros, unit, warnings) {
  const parts = [], values = args.map(Number), add = (path, clear=false, points=[]) => parts.push({path,clear,points});
  const [a=0,b=0] = values.map(v=>v*unit);
  let radius = 0;
  if (name === 'C') { add(circlePath(0,0,a)); radius = a/2; }
  else if (name === 'R' || name === 'O') {
    const p = new Path2D(); if (name === 'R') p.rect(-a/2,-b/2,a,b); else { const r = Math.min(a,b)/2; p.roundRect(-a/2,-b/2,a,b,r); }
    add(p, false, [[-a/2,-b/2],[a/2,-b/2],[a/2,b/2],[-a/2,b/2]]); radius = Math.hypot(a,b)/2;
  } else if (name === 'P') {
    const count = Math.round(values[1]), rotation=values[2]||0;
    if (count<3 || count>1000) throw Error('Invalid polygon aperture.');
    const points=rotatePoints(Array.from({length:count},(_,i)=>[a/2*Math.cos(i*2*Math.PI/count),a/2*Math.sin(i*2*Math.PI/count)]),rotation);
    add(polygonPath(points),false,points); radius=a/2;
  } else if (macros[name]) {
    const vars = {}; values.forEach((v,i)=>vars[i+1]=v);
    for (const statement of macros[name]) {
      if (!statement || /^0(?:\s|,|$)/.test(statement)) continue;
      if (statement.startsWith('$')) { const [key,value]=statement.split('='); vars[+key.slice(1)]=expression(value,vars); continue; }
      const m=statement.split(',').map(s=>expression(s,vars)), code=m.shift(); let path, points=[], clear = m[0]===0;
      if (code===1) { const [,d,x,y,rot=0]=m; const center=rotatePoints([[x*unit,y*unit]],rot)[0]; path=circlePath(...center,d*unit); radius=Math.max(radius,Math.hypot(...center)+d*unit/2); }
      else if (code===20 || code===2) {
        const [,w,x1,y1,x2,y2,rot=0]=m, dx=x2-x1,dy=y2-y1,len=Math.hypot(dx,dy),nx=len ? -dy/len*w/2 : w/2,ny=len ? dx/len*w/2 : 0;
        points=rotatePoints([[x1+nx,y1+ny],[x2+nx,y2+ny],[x2-nx,y2-ny],[x1-nx,y1-ny]].map(p=>p.map(v=>v*unit)),rot); path=polygonPath(points);
      } else if (code===21 || code===22) {
        const [,w,h,x,y,rot=0]=m, cx=code===22?x+w/2:x, cy=code===22?y+h/2:y;
        points=rotatePoints([[cx-w/2,cy-h/2],[cx+w/2,cy-h/2],[cx+w/2,cy+h/2],[cx-w/2,cy+h/2]].map(p=>p.map(v=>v*unit)),rot); path=polygonPath(points);
      } else if (code===4) {
        const count=m[1]; for (let k=0;k<=count;k++) points.push([m[2+k*2]*unit,m[3+k*2]*unit]); points=rotatePoints(points,m[4+count*2]||0); path=polygonPath(points);
      } else if (code===5) {
        const [,count,x,y,d,rot]=m; points=rotatePoints(Array.from({length:count},(_,i)=>[(x+d/2*Math.cos(2*Math.PI*i/count))*unit,(y+d/2*Math.sin(2*Math.PI*i/count))*unit]),rot||0); path=polygonPath(points);
      } else if (code===6) {
        const [x,y,outer,thickness,gap,count,crossWidth,crossLength,rot=0]=m;
        const center=rotatePoints([[x*unit,y*unit]],rot)[0];path=new Path2D();clear=false;
        for(let n=0;n<Math.min(count,1000);n++){const ro=(outer/2-n*(thickness+gap))*unit,ri=Math.max(0,ro-thickness*unit);if(ro<=0)break;path.moveTo(center[0]+ro,center[1]);path.arc(...center,ro,0,Math.PI*2);if(ri>0){path.moveTo(center[0]+ri,center[1]);path.arc(...center,ri,0,-Math.PI*2,true);}}
        for(const [w,h]of [[crossLength,crossWidth],[crossWidth,crossLength]]){const rect=rotatePoints([[x-w/2,y-h/2],[x+w/2,y-h/2],[x+w/2,y+h/2],[x-w/2,y+h/2]].map(p=>p.map(v=>v*unit)),rot);path.addPath(polygonPath(rect));}
        radius=Math.max(radius,Math.hypot(...center)+Math.max(outer,crossLength)*unit/2);
      } else if (code===7) {
        const [x,y,outer,inner,gap,rot=0]=m,ro=outer*unit/2,ri=inner*unit/2,h=gap*unit/2,center=rotatePoints([[x*unit,y*unit]],rot)[0];path=new Path2D();clear=false;
        if(ro>Math.SQRT2*h)for(let q=0;q<4;q++){const angle=(rot+q*90)*Math.PI/180,a=Math.asin(h/ro),b=Math.acos(h/ro);path.moveTo(center[0]+ro*Math.cos(a+angle),center[1]+ro*Math.sin(a+angle));path.arc(...center,ro,a+angle,b+angle);
          if(ri>Math.SQRT2*h){const c=Math.acos(h/ri),d=Math.asin(h/ri);path.lineTo(center[0]+ri*Math.cos(c+angle),center[1]+ri*Math.sin(c+angle));path.arc(...center,ri,c+angle,d+angle,true);}else {const corner=rotatePoints([[h,h]],rot+q*90)[0];path.lineTo(center[0]+corner[0],center[1]+corner[1]);}path.closePath();}
        radius=Math.max(radius,Math.hypot(...center)+ro);
      }
      else throw Error(`Unknown aperture macro primitive ${code}.`);
      for (const p of points) radius=Math.max(radius,Math.hypot(...p)); add(path,clear,points);
    }
  } else throw Error(`Unknown aperture ${name}.`);
  const holeIndex=name==='C'?1:name==='P'?3:2;
  if (['C','R','O','P'].includes(name) && values[holeIndex]>0) add(circlePath(0,0,values[holeIndex]*unit),true);
  return {name,parts,radius,width:a,height:b||a};
}
function parseGerber(text) {
  const ops=[], tools={}, macros={}, warnings=new Set();
  let unit=1, format={x:6,y:6,ix:4,iy:4,zero:'L'}, absolute=true, x=0,y=0,tool=null,mode=1,operation=2,clear=false,region=null,contour=null,quadrant='multi';
  let mirrorX=1,mirrorY=1,rotation=0,scale=1,repeat={x:1,y:1,i:0,j:0};
  const bounds=[Infinity,Infinity,-Infinity,-Infinity];
  function bound(px,py,r=0) { bounds[0]=Math.min(bounds[0],px-r); bounds[1]=Math.min(bounds[1],py-r); bounds[2]=Math.max(bounds[2],px+r); bounds[3]=Math.max(bounds[3],py+r); }
  function push(op,points,r=0) { for(let ix=0;ix<repeat.x;ix++) for(let iy=0;iy<repeat.y;iy++) { const dx=ix*repeat.i,dy=iy*repeat.j; const area=[Infinity,Infinity,-Infinity,-Infinity];for(const p of points){area[0]=Math.min(area[0],p[0]-r);area[1]=Math.min(area[1],p[1]-r);area[2]=Math.max(area[2],p[0]+r);area[3]=Math.max(area[3],p[1]+r);}ops.push({...op,dx,dy,clear,bounds:area}); for(const p of points) bound(p[0]+dx,p[1]+dy,r); } if(ops.length>2e6) throw Error('Layer exceeds two million drawing operations.'); }
  function coord(v,axis) { if(v===undefined)return undefined; let s=v; if(!s.includes('.')&&format.zero==='T') { const sign=s.startsWith('-')?'-':''; s=sign+s.replace(/^[+-]/,'').padEnd(format[axis]+format['i'+axis],'0'); } return Number(s)*unit/(s.includes('.')?1:10**format[axis]); }
  function finishRegion() { if(region) { const p=new Path2D(); for(const c of region) p.addPath(c); push({kind:'fill',path:p,evenOdd:true},region.points||[]); region=null; contour=null; } }
  // Tokenize extended blocks independently so aperture macro statements remain grouped.
  const tokens=text.replace(/\r/g,'').match(/%[^%]*%|[^%*]+\*/g)||[];
  for(let token of tokens) {
    token=token.trim(); if(!token)continue;
    if(token.startsWith('%')) {
      const body=token.slice(1,-1).trim();
      if(body.startsWith('AM')) { const statements=body.split('*').map(s=>s.trim()); macros[statements.shift().slice(2)]=statements.filter(Boolean); continue; }
      for(let cmd of body.split('*').map(s=>s.trim()).filter(Boolean)) {
        let m;
        if((m=cmd.match(/^FS([LT])([AI])X(\d)(\d)Y(\d)(\d)/))) { format={zero:m[1],ix:+m[3],x:+m[4],iy:+m[5],y:+m[6]}; absolute=m[2]==='A'; }
        else if(cmd==='MOMM')unit=1; else if(cmd==='MOIN')unit=25.4;
        else if((m=cmd.match(/^ADD(\d+)([^,]+)(?:,(.*))?$/)))tools[m[1]]=aperture(m[2],m[3]?.split('X')||[],macros,unit,warnings);
        else if(cmd==='LPD')clear=false; else if(cmd==='LPC')clear=true;
        else if(/^LM/.test(cmd)) { mirrorX=/X/.test(cmd)?-1:1;mirrorY=/Y/.test(cmd)?-1:1; }
        else if(/^LR/.test(cmd))rotation=+cmd.slice(2); else if(/^LS/.test(cmd))scale=+cmd.slice(2);
        else if(/^SR/.test(cmd)) { if(cmd==='SR')repeat={x:1,y:1,i:0,j:0}; else { const f=Object.fromEntries([...cmd.slice(2).matchAll(/([XYIJ])([+-]?[\d.]+)/g)].map(m=>[m[1],+m[2]])); repeat={x:f.X||1,y:f.Y||1,i:(f.I||0)*unit,j:(f.J||0)*unit}; if(repeat.x*repeat.y>10000)throw Error('Step-repeat exceeds 10,000 copies.'); } }
        else if(/^(TF|TA|TO|TD|IPPOS|IN|LN)/.test(cmd)) {} // Attributes do not change geometry; file polarity is handled at composition.
        else if(cmd==='IPNEG'){}
        else warnings.add(`Unsupported Gerber command: ${cmd.slice(0,45)}`);
      }
      continue;
    }
    let cmd=token.slice(0,-1).replace(/\s/g,''); if(/^G0?4/.test(cmd)||/^M0?[02]$/.test(cmd))continue;
    const gs=[...cmd.matchAll(/G(\d+)/g)].map(m=>+m[1]);
    for(const g of gs) { if(g>=1&&g<=3)mode=g; else if(g===36){finishRegion();region=[];region.points=[];}else if(g===37)finishRegion();else if(g===74)quadrant='single';else if(g===75)quadrant='multi';else if(g===70)unit=25.4;else if(g===71)unit=1;else if(g===90)absolute=true;else if(g===91)absolute=false;else if(g!==54&&g!==55)warnings.add(`Unsupported G${g}`); }
    const ds=[...cmd.matchAll(/D(\d+)/g)].map(m=>+m[1]);
    for(const d of ds)if(d>=10){tool=tools[d];if(!tool)throw Error(`Undefined aperture D${d}.`);}else operation=d;
    const fields=Object.fromEntries([...cmd.matchAll(/([XYIJ])([+-]?(?:\d*\.)?\d+)/g)].map(m=>[m[1],m[2]]));
    if(!Object.keys(fields).length && !ds.some(d=>d===3))continue;
    const px=coord(fields.X,'x'),py=coord(fields.Y,'y'),nx=px===undefined?x:absolute?px:x+px,ny=py===undefined?y:absolute?py:y+py;
    if(![nx,ny].every(Number.isFinite))throw Error('Invalid coordinate.');
    if(operation===2) { if(region){contour=new Path2D();contour.moveTo(nx,ny);region.push(contour);region.points.push([nx,ny]);} }
    else if(operation===3) { if(!tool)throw Error('Flash without aperture.'); push({kind:'flash',tool,x:nx,y:ny,mirrorX,mirrorY,rotation,scale},[[nx,ny]],tool.radius*scale); }
    else if(operation===1) {
      const path=new Path2D();path.moveTo(x,y);let ext=[[x,y],[nx,ny]], arc=null;
      if(mode===1)path.lineTo(nx,ny);
      else {
        const oi=coord(fields.I,'x')||0,oj=coord(fields.J,'y')||0;let cx=x+oi,cy=y+oj;
        if(quadrant==='single') { let best=Infinity; for(const sx of [-1,1])for(const sy of [-1,1]){const a=x+sx*Math.abs(oi),b=y+sy*Math.abs(oj),r=Math.hypot(x-a,y-b),r2=Math.hypot(nx-a,ny-b);let angle=(Math.atan2(ny-b,nx-a)-Math.atan2(y-b,x-a))*(mode===2?-1:1);angle=(angle+Math.PI*2)%(Math.PI*2);const score=Math.abs(r-r2)+(angle>Math.PI/2+1e-4?1e6:0);if(score<best){best=score;cx=a;cy=b;}} }
        const r=Math.hypot(x-cx,y-cy),start=Math.atan2(y-cy,x-cx),end=Math.atan2(ny-cy,nx-cx); if(!r)throw Error('Arc has zero radius.');
        arc=[cx,cy,r,start,Math.abs(nx-x)+Math.abs(ny-y)<1e-9?start+(mode===2?-1:1)*2*Math.PI:end,mode===2];path.arc(...arc);
        ext=[[cx-r,cy-r],[cx+r,cy+r]];
      }
      if(region) { if(!contour){contour=new Path2D();contour.moveTo(x,y);region.push(contour);}if(arc)contour.arc(...arc);else contour.lineTo(nx,ny);region.points.push(...ext); }
      else { if(!tool)throw Error('Draw without aperture.'); if(mode!==1&&tool.name!=='C')warnings.add('Curved strokes with non-circular apertures use a circular stroke approximation.');if(tool.name!=='C'&&tool.name!=='R'&&tool.name!=='O')warnings.add('Swept macro/polygon apertures use a circular stroke approximation.');push({kind:'stroke',path,tool,x,y,nx,ny,mode,arc,scale,rotation,mirrorX,mirrorY},ext,tool.radius*scale); }
    }
    x=nx;y=ny;
  }
  finishRegion(); if(!ops.length)throw Error('No drawable geometry found.');
  return {ops,bounds,warnings:[...warnings],negative:/%TF\.FilePolarity,Negative\*|%IPNEG\*/i.test(text),units:'mm'};
}
function parseDrill(text) {
  const ops=[],tools={},warnings=new Set();let unit=25.4,x=0,y=0,tool=0,format=4,zero='L',route=false,down=false,absolute=true;
  const bounds=[Infinity,Infinity,-Infinity,-Infinity];
  function coord(v){if(v===undefined)return undefined;let s=v;if(!s.includes('.')&&zero==='T'){const sign=s.startsWith('-')?'-':'';s=sign+s.replace(/^[+-]/,'').padEnd(unit===1?6:6,'0');}return Number(s)*unit/(s.includes('.')?1:10**format);}
  function add(nx,ny,slot=false){ const d=tools[tool];if(!d)throw Error(`Undefined drill tool T${tool}.`);const p=new Path2D();if(slot){p.moveTo(x,y);p.lineTo(nx,ny);ops.push({kind:'stroke',path:p,tool:{name:'C',width:d,radius:d/2},x,y,nx,ny,mode:1,clear:false,dx:0,dy:0});}else ops.push({kind:'fill',path:circlePath(nx,ny,d),clear:false,dx:0,dy:0});for(const [px,py] of slot?[[x,y],[nx,ny]]:[[nx,ny]]){bounds[0]=Math.min(bounds[0],px-d/2);bounds[1]=Math.min(bounds[1],py-d/2);bounds[2]=Math.max(bounds[2],px+d/2);bounds[3]=Math.max(bounds[3],py+d/2);}x=nx;y=ny; }
  for(let line of text.split(/\r?\n/)){line=line.trim();let m;if((m=line.match(/FILE_FORMAT=(\d):(\d)/i)))format=+m[2];if(line.startsWith(';')||!line)continue;
    if(/^(METRIC|M71)/.test(line)){unit=1;format=3;}if(/^(INCH|M72)/.test(line)){unit=25.4;format=4;}
    if(/^(METRIC|INCH)/.test(line)){zero=/TZ/.test(line)?'T':'L';const f=line.match(/(0+)\.(0+)/);if(f)format=f[2].length;continue;}
    if((m=line.match(/^T(\d+)C([\d.]+)/))){tools[+m[1]]=+m[2]*unit;continue;}if((m=line.match(/^T(\d+)/)))tool=+m[1];
    if(/G90/.test(line))absolute=true;if(/G91/.test(line))absolute=false;if(/G00/.test(line))route=true;if(/G05/.test(line))route=false;if(/M15/.test(line))down=true;if(/M16|M17/.test(line))down=false;
    if(/G0?[23](?!\d)|^R\d/.test(line))throw Error('Drill arcs and repeat commands are not supported.');
    const chunks=line.split('G85');for(let k=0;k<chunks.length;k++){const f=Object.fromEntries([...chunks[k].matchAll(/([XY])([+-]?[\d.]+)/g)].map(m=>[m[1],coord(m[2])]));if(!Object.keys(f).length)continue;const nx=f.X===undefined?x:absolute?f.X:x+f.X,ny=f.Y===undefined?y:absolute?f.Y:y+f.Y;if(chunks.length>1&&k===0){x=nx;y=ny;}else if(route&&!down){x=nx;y=ny;}else add(nx,ny,k>0||route&&down);}
  }
  if(!ops.length)throw Error('No drill hits found.');return {ops,bounds,warnings:[...warnings],negative:false,units:'mm'};
}
function identify(name,text) {
  const file=(text.match(/%TF\.FileFunction,([^*]+)/i)||[])[1]||'';const base=name.split('/').pop(),s=(file+' '+base).toLowerCase();
  let type='other',side='',level=0;
  if(/copper|cutop|cubottom|cuin|\.g[bt]l$|\.g\d+l?$/.test(s))type='copper';else if(/soldermask|mask|\.g[bt]s$/.test(s))type='mask';else if(/legend|silk|\.g[bt]o$/.test(s))type='silk';else if(/profile|edge.?cuts|outline|\.gko$|\.gm1$/.test(s))type='outline';else if(/\.drl$|\.xln$|\.exc$|\.xnc$|plated|pth/.test(s)||/^M48/m.test(text))type='drill';else if(/paste|\.g[bt]p$/.test(s))type='paste';
  if(/top|\.gt[los p]$/.test(s))side='Top';else if(/bot|\.gb[los p]$/.test(s))side='Bottom';else if(/inr|cuin|inner/.test(s))side='Inner';
  const l=file.match(/Copper,L(\d+)/i);level=l?+l[1]:side==='Top'?1:side==='Bottom'?99:parseInt((s.match(/(?:cuin|inner|\.g)(\d+)/)||[])[1]||'2');
  const colors={copper:['#ff5252','#e8c547','#b58aff','#528cff'],mask:['#5ad196'],silk:['#e8e5d8'],outline:['#f4f7ff'],drill:['#80c8fd'],paste:['#c9a6ed'],other:['#b3bac8']};
  const label=type==='copper'?`${side||'Copper'} copper${level&&side==='Inner'?' · L'+level:''}`:type==='drill'?(/nonplated|npth/i.test(s)?'Non-plated drills':'Plated drills'):type==='outline'?'Board outline':`${side?side+' ':''}${{mask:'solder mask',silk:'silkscreen',paste:'solder paste',other:'Gerber layer'}[type]}`;
  const fixedColor=type==='copper'?(side==='Top'?'#ff5252':side==='Bottom'?'#528cff':null):null;
  const secondaryColor=type==='mask'&&side==='Bottom'?'#38bdb0':type==='silk'&&side==='Bottom'?'#a7bdce':type==='drill'&&/nonplated|npth/i.test(s)?'#ffc078':null;
  const group=type==='copper'?'Copper':type==='drill'?'Drill':'Manufacturing';
  return {type,side,level,label,base,group,fixedColor,color:fixedColor||secondaryColor||colors[type][type==='copper'?Math.min(Math.max(level-1,0),3):0],visible:type!=='mask'&&type!=='paste',opacity:1};
}
