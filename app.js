let files=[],bitmaps=[],resultReady=false;
const $=s=>document.querySelector(s), drop=$('#drop'), input=$('#files'), list=$('#list'), status=$('#status'), stitch=$('#stitch'), dl=$('#download'), canvas=$('#canvas'), empty=$('#empty');
function cvOk(){return !!(window.cv&&cv.Mat)}
function updateCV(){if(cvOk()){window.cvReady=true;$('#cvState').textContent='Bild-Engine bereit';stitch.disabled=files.length<2}else setTimeout(updateCV,300)}
document.addEventListener('cv-ready',updateCV);updateCV();
drop.onclick=()=>input.click(); input.onchange=e=>add([...e.target.files]);
['dragenter','dragover'].forEach(x=>drop.addEventListener(x,e=>{e.preventDefault();drop.classList.add('drag')}));
['dragleave','drop'].forEach(x=>drop.addEventListener(x,e=>{e.preventDefault();drop.classList.remove('drag')}));
drop.addEventListener('drop',e=>add([...e.dataTransfer.files].filter(f=>f.type.startsWith('image/'))));
async function add(fs){files.push(...fs); await load(); render()}
async function load(){bitmaps=await Promise.all(files.map(f=>createImageBitmap(f)))}
function render(){list.innerHTML='';files.forEach((f,i)=>{let d=document.createElement('div');d.className='tile';let u=URL.createObjectURL(f);d.innerHTML='<img src="'+u+'"><small>'+f.name+'</small><button data-i="'+i+'">×</button>';list.appendChild(d)});list.querySelectorAll('button').forEach(b=>b.onclick=async e=>{e.stopPropagation();files.splice(+b.dataset.i,1);await load();render()});stitch.disabled=files.length<2||!cvOk();status.textContent=files.length?files.length+' Screenshots geladen':''}
function matFromBitmap(b,max=1400){let scale=Math.min(1,max/Math.max(b.width,b.height)),w=Math.round(b.width*scale),h=Math.round(b.height*scale),c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(b,0,0,w,h);return {mat:cv.imread(c),scale}}
function gray(m){let g=new cv.Mat();cv.cvtColor(m,g,cv.COLOR_RGBA2GRAY);return g}
function matchPair(A,B,dir,ov){let a=gray(A),b=gray(B),best=null;
 const tries=dir==='auto'?['right','down']:dir==='horizontal'?['right']:['down'];
 for(const t of tries){let vertical=t==='down', strip=Math.max(60,Math.round((vertical?a.rows:a.cols)*Math.min(.65,ov*1.8)));
   let ar=vertical?new cv.Rect(0,a.rows-strip,a.cols,strip):new cv.Rect(a.cols-strip,0,strip,a.rows);
   let searchPad=vertical?Math.min(b.rows,Math.round(strip*2.5)):Math.min(b.cols,Math.round(strip*2.5));
   let br=vertical?new cv.Rect(0,0,b.cols,searchPad):new cv.Rect(0,0,searchPad,b.rows);
   let am=a.roi(ar), bm=b.roi(br);
   if(am.cols<=bm.cols&&am.rows<=bm.rows){let r=new cv.Mat();cv.matchTemplate(bm,am,r,cv.TM_CCOEFF_NORMED);let mm=cv.minMaxLoc(r),score=mm.maxVal;
     let dx=vertical?mm.maxLoc.x:(a.cols-strip+mm.maxLoc.x),dy=vertical?(a.rows-strip+mm.maxLoc.y):mm.maxLoc.y;
     if(!best||score>best.score)best={dx,dy,score,dir:t};r.delete()}am.delete();bm.delete()}
 a.delete();b.delete();return best}
stitch.onclick=async()=>{try{stitch.disabled=true;dl.disabled=true;status.textContent='Analysiere Überlappungen …';await new Promise(r=>setTimeout(r,30));
 let src=bitmaps.map(b=>matFromBitmap(b)), mats=src.map(x=>x.mat),scale=src[0].scale,ov=+$('#overlap').value,dir=$('#direction').value;
 let pos=[{x:0,y:0}],scores=[];
 for(let i=1;i<mats.length;i++){status.textContent='Verbinde '+i+' / '+(mats.length-1)+' …';await new Promise(r=>setTimeout(r,5));let m=matchPair(mats[i-1],mats[i],dir,ov);if(!m||m.score<.22)throw new Error('Keine sichere Überlappung zwischen Bild '+i+' und '+(i+1)+' erkannt. Mehr Überlappung aufnehmen oder die Aufnahmerichtung fest einstellen.');pos.push({x:pos[i-1].x+m.dx,y:pos[i-1].y+m.dy});scores.push(m.score)}
 let minX=Math.min(...pos.map(p=>p.x)),minY=Math.min(...pos.map(p=>p.y)),maxX=Math.max(...pos.map((p,i)=>p.x+mats[i].cols)),maxY=Math.max(...pos.map((p,i)=>p.y+mats[i].rows)),W=Math.ceil(maxX-minX),H=Math.ceil(maxY-minY);
 if(W*H>120000000)throw new Error('Ergebnis wäre zu groß für den Browser. Bitte weniger Bilder in einem Durchgang verwenden.');
 canvas.width=W;canvas.height=H;let ctx=canvas.getContext('2d');ctx.clearRect(0,0,W,H);
 bitmaps.forEach((b,i)=>{let p=pos[i];ctx.drawImage(b,p.x-minX,p.y-minY,mats[i].cols,mats[i].rows)});
 mats.forEach(m=>m.delete());canvas.style.display='block';empty.style.display='none';resultReady=true;dl.disabled=false;status.textContent='Fertig · '+W+' × '+H+' px · mittlere Übereinstimmung '+(scores.reduce((a,b)=>a+b,0)/scores.length*100).toFixed(0)+' %';
 }catch(e){status.textContent='Fehler: '+e.message}finally{stitch.disabled=files.length<2||!cvOk()}};
dl.onclick=()=>{if(!resultReady)return;canvas.toBlob(blob=>{let a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='zusammengesetzte-karte.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)},'image/png')};
