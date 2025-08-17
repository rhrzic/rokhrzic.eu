// Minimal app with relative paths, resilient uploads
const els = {
  deckSelect: document.getElementById('deckSelect'),
  deckName: document.getElementById('deckName'),
  addDeck: document.getElementById('addDeck'),
  delDeck: document.getElementById('delDeck'),
  drop: document.getElementById('drop'),
  picker: document.getElementById('picker'),
  showThumbs: document.getElementById('showThumbs'),
  thumbs: document.getElementById('thumbs'),
  draw: document.getElementById('draw'),
  save: document.getElementById('save'),
  load: document.getElementById('load'),
  clearAll: document.getElementById('clearAll'),
  display: document.getElementById('display'),
  pill: document.getElementById('pill'),
  status: document.getElementById('status'),
  toast: document.getElementById('toast'),
};

function toast(msg, kind='ok', ms=1800){
  try{
    if (!els.toast){
      const c = document.createElement('div'); c.id='toast'; document.body.appendChild(c); els.toast=c;
    }
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = msg;
    els.toast.appendChild(t);
    requestAnimationFrame(()=> t.classList.add('show'));
    setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(), 250); }, ms);
  }catch(e){ console.log('Toast:', msg); }
}

// IndexedDB
const DB_NAME = 'cards-pwa';
const DB_VERSION = 1;
const STORE = 'decks';
function idbOpen(){ return new Promise((res, rej)=>{ const r=indexedDB.open(DB_NAME, DB_VERSION); r.onupgradeneeded=()=>{const db=r.result; if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{keyPath:'name'});}; r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function idbTxn(db, mode){ const tx=db.transaction(STORE, mode); const s=tx.objectStore(STORE); return {s, done:new Promise((res,rej)=>{ tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); tx.onabort=()=>rej(tx.error||new Error('aborted')); })}; }
async function saveAll(map){ try{ const db=await idbOpen(); const {s,done}=idbTxn(db,'readwrite'); await new Promise((res,rej)=>{const r=s.clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error);}); for(const d of map.values()){ const cards=[]; for(const c of d.sources){ if(c.blob) cards.push({name:c.name, blob:c.blob}); } await new Promise((res,rej)=>{ const r=s.put({name:d.name, cards}); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); } await done; db.close(); return true;}catch(e){console.error(e); return false;} }
async function loadAll(){ try{ const db=await idbOpen(); const {s,done}=idbTxn(db,'readonly'); const all=await new Promise((res,rej)=>{ const r=s.getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); }); await done; db.close(); return all; }catch(e){ console.error(e); return []; } }
async function clearAllSaved(){ try{ const db=await idbOpen(); const {s,done}=idbTxn(db,'readwrite'); await new Promise((res,rej)=>{ const r=s.clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); await done; db.close(); return true; }catch(e){ console.error(e); return false; } }

// Decks
const decks = new Map();
let active = null;
function createDeck(name){ if(decks.has(name)) return null; const d={name, sources:[]}; decks.set(name,d); return d; }
function deleteDeck(name){ const d=decks.get(name); if(!d) return; d.sources.forEach(s=>{try{URL.revokeObjectURL(s.url)}catch{}}); decks.delete(name); if(active?.name===name) active=null; }
function setActive(name){ active=decks.get(name)||null; renderDeckList(); renderUI(); }
function renderDeckList(){ const sel=els.deckSelect; const cur=active?.name; sel.innerHTML=''; for(const name of decks.keys()){ const o=document.createElement('option'); o.value=name; o.textContent=name; if(name===cur) o.selected=true; sel.appendChild(o);} }
function renderUI(){ const has=!!active && active.sources.length>0; els.draw.disabled=!active; els.status.textContent= has?`Deck “${active.name}”: ${active.sources.length} cards`:(active?`Deck “${active.name}” is empty`:'No deck loaded'); els.pill.textContent=has?'Deck ready':'Waiting for images…'; renderThumbs(); if(!has){ els.display.innerHTML='<span class=\"pill\">Waiting for images…</span>'; } }
function renderThumbs(){ if(!active){ els.thumbs.style.display='none'; els.thumbs.innerHTML=''; return; } if(!els.showThumbs.checked){ els.thumbs.style.display='none'; els.thumbs.innerHTML=''; return; } els.thumbs.style.display='grid'; els.thumbs.innerHTML=''; for(const s of active.sources){ const t=document.createElement('img'); t.src=s.url; t.alt=s.name; t.title=s.name; els.thumbs.appendChild(t);} }
function showCard(url,name){ els.display.innerHTML=''; const img=document.createElement('img'); img.className='card-img'; img.src=url; img.alt=name; els.display.appendChild(img); const p=document.createElement('span'); p.className='pill'; p.textContent=name; els.display.appendChild(p); }
function draw(){ if(!active || active.sources.length===0) return; const i=Math.floor(Math.random()*active.sources.length); const c=active.sources[i]; showCard(c.url, c.name); toast('Drawn ✓','ok'); }

function filesFromDataTransfer(dt){ const out=[]; try{ if(dt.items&&dt.items.length){ for(const it of dt.items){ if(it.kind==='file'){ const f=it.getAsFile(); if(f) out.push(f); } } } }catch(e){} if(!out.length&&dt.files) return [...dt.files]; return out; }

async function addImagesToActive(fileList){ if(!active) return; const arr = Array.isArray(fileList)? fileList : [...fileList]; const files = arr.filter(f=>{ const t=(f.type||'').toLowerCase(); if(t==='image/png'||t==='image/jpeg'||t==='image/jpg') return true; const n=(f.name||'').toLowerCase(); return /\.(png|jpe?g)$/.test(n); }); if(!files.length){ toast('No PNG/JPEG images found','warn'); return; } for(const f of files){ const url=URL.createObjectURL(f); active.sources.push({name:f.name, url, blob:f}); } renderUI(); toast(`Added ${files.length} image(s) to “${active.name}”`,'ok'); }

// UI
els.addDeck.addEventListener('click', ()=>{ const name=(els.deckName.value||'').trim()||`Deck ${decks.size+1}`; if(decks.has(name)){ toast('Deck exists','warn'); return; } createDeck(name); setActive(name); els.deckName.value=''; toast(`Created “${name}”`,'ok'); });
els.delDeck.addEventListener('click', ()=>{ if(!active) return; const name=active.name; if(!confirm(`Delete deck “${name}” from this session? (Saved decks stay until you delete them)`)) return; deleteDeck(name); setActive([...decks.keys()][0]||null); toast(`Deleted “${name}”`,'warn'); });
els.deckSelect.addEventListener('change', e=> setActive(e.target.value));
els.showThumbs.addEventListener('change', renderThumbs);
['dragenter','dragover'].forEach(type=>{ els.drop.addEventListener(type, e=>{ e.preventDefault(); els.drop.classList.add('drag'); }); });
['dragleave','dragend'].forEach(type=>{ els.drop.addEventListener(type, ()=> els.drop.classList.remove('drag')); });
els.drop.addEventListener('drop', e=>{ e.preventDefault(); els.drop.classList.remove('drag'); const files = e.dataTransfer ? filesFromDataTransfer(e.dataTransfer) : []; addImagesToActive(files); });
els.drop.addEventListener('click', ()=> els.picker.click());
els.picker.addEventListener('change', e=>{ addImagesToActive(e.target.files); e.target.value=''; });
els.draw.addEventListener('click', draw);
els.save.addEventListener('click', async ()=>{ const ok=await saveAll(decks); toast(ok?'Saved decks ✓':'Save failed', ok?'ok':'err'); });
els.load.addEventListener('click', async ()=>{ const saved=await loadAll(); if(!saved.length){ toast('No saved decks','warn'); return; } for(const d of decks.values()){ d.sources.forEach(s=>{try{URL.revokeObjectURL(s.url)}catch{}}); } decks.clear(); for(const rec of saved){ const d=createDeck(rec.name); for(const c of rec.cards){ const url=URL.createObjectURL(c.blob); d.sources.push({name:c.name, url, blob:c.blob}); } } setActive(saved[0].name); toast('Loaded decks ✓','ok'); });
els.clearAll.addEventListener('click', async ()=>{ if(!confirm('Delete ALL saved decks from storage?')) return; const ok=await clearAllSaved(); toast(ok?'Deleted all saved ✓':'Delete failed', ok?'ok':'err'); });

// Init
createDeck('Deck 1'); setActive('Deck 1'); renderUI();
(async ()=>{ const saved=await loadAll(); if(saved.length){ decks.clear(); for(const rec of saved){ const d=createDeck(rec.name); for(const c of rec.cards){ const url=URL.createObjectURL(c.blob); d.sources.push({name:c.name, url, blob:c.blob}); } } setActive(saved[0].name); toast('Auto-loaded saved ✓','ok'); } })();
