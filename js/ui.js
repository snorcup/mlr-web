export class UI {
  constructor(){
    this.grid=document.getElementById('grid'); this.tracks=document.getElementById('tracks'); this.makeGrid(); this.makeTracks();
  }
  makeGrid(){
    this.grid.innerHTML='';
    this.grid.style.setProperty('--grid-cols','16');
    for(let y=0;y<8;y++) for(let x=0;x<16;x++){ const b=document.createElement('button'); b.className='pad'+(y===7?' fn':''); b.dataset.x=x; b.dataset.y=y; b.ariaLabel=`pad ${x},${y}`; this.grid.appendChild(b); }
  }
  makeTracks(){
    this.tracks.innerHTML='';
    for(let i=0;i<7;i++){ const d=document.createElement('div'); d.className='track'; d.innerHTML=`<strong>${i+1}</strong><span class="muted" id="clip-${i}">drop audio</span><div class="track-meter"><span id="meter-${i}"></span></div>`; this.tracks.appendChild(d); }
  }
  onPad(fn){
    this.grid.addEventListener('pointerdown', e=>{ const p=e.target.closest('.pad'); if(p) fn({x:+p.dataset.x,y:+p.dataset.y,state:true}); });
    this.grid.addEventListener('pointerup', e=>{ const p=e.target.closest('.pad'); if(p) fn({x:+p.dataset.x,y:+p.dataset.y,state:false}); });
    this.grid.addEventListener('pointerleave', e=>{ const p=e.target.closest('.pad'); if(p) fn({x:+p.dataset.x,y:+p.dataset.y,state:false}); });
  }
  render(frame){
    [...this.grid.children].forEach(el=>{ const x=+el.dataset.x,y=+el.dataset.y,l=frame[y]?.[x] ?? 0; el.classList.toggle('on',l>=12); el.classList.toggle('dim',l>0&&l<12); });
  }
  setClipNames(clips){ clips.slice(0,7).forEach((clip,i)=>{ const el=document.getElementById(`clip-${i}`); if(el) el.textContent=clip.name; }); }
}

export function setPill(id, text, mode=''){ const el=document.getElementById(id); el.textContent=text; el.className=`pill ${mode}`.trim(); }
