// Minimal app w/ fronts+backs, relative paths, resilient uploads
const els = {
  deckSelect: document.getElementById('deckSelect'),
  deckName: document.getElementById('deckName'),
  addDeck: document.getElementById('addDeck'),
  delDeck: document.getElementById('delDeck'),
  deckType: document.getElementById('deckType'),
  pairingWrap: document.getElementById('pairingWrap'),
  pairingMode: document.getElementById('pairingMode'),
  drop: document.getElementById('drop'),
  picker: document.getElementById('picker'),
  showThumbs: document.getElementById('showThumbs'),
  thumbs: document.getElementById('thumbs'),
  draw: document.getElementById('draw'),
  flip: document.getElementById('flip'),
  save: document.getElementById('save'),
  load: document.getElementById('load'),
  clearAll: document.getElementById('clearAll'),
  display: document.getElementById('display'),
  pill: document.getElementById('pill'),
  status: document.getElementById('status'),
  toast: document.getElementById('toast'),
  toggleUpload: document.getElementById('toggleUpload'),
  uploadPanel: document.getElementById('uploadPanel'),
  uploadBody: document.getElementById('uploadBody'),
};

function toast(msg, kind='ok', ms=1800){
  try{
    if (!els.toast){ const c=document.createElement('div'); c.id='toast'; document.body.appendChild(c); els.toast=c; }
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = msg;
    els.toast.appendChild(t);
    requestAnimationFrame(()=> t.classList.add('show'));
    setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(), 250); }, ms);
  }catch(e){ console.log('Toast:', msg); }
}

function setUploadCollapsed(collapsed) {
  if (!els.uploadPanel || !els.toggleUpload) return;
  els.uploadPanel.classList.toggle('collapsed', !!collapsed);
  els.toggleUpload.textContent = collapsed ? 'Show' : 'Hide';
  els.toggleUpload.setAttribute('aria-expanded', String(!collapsed));
  try { localStorage.setItem('uploadCollapsed', collapsed ? '1' : '0'); } catch {}
}
(function initUploadCollapsed() {
  if (els.uploadPanel && els.toggleUpload) {
    const saved = (typeof localStorage !== 'undefined') && localStorage.getItem('uploadCollapsed') === '1';
    setUploadCollapsed(saved);
  }
})();

// IndexedDB (same store name; records now hold {front,back?})
const DB_NAME = 'cards-pwa';
const DB_VERSION = 2; // bump for new card shape
const STORE = 'decks';
function idbOpen(){ return new Promise((res, rej)=>{ const r=indexedDB.open(DB_NAME, DB_VERSION);
  r.onupgradeneeded=()=>{ const db=r.result; if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{keyPath:'name'}); };
  r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function idbTxn(db, mode){ const tx=db.transaction(STORE, mode); const s=tx.objectStore(STORE); return {s, done:new Promise((res,rej)=>{ tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); tx.onabort=()=>rej(tx.error||new Error('aborted')); })}; }

async function saveAll(map){
  try{
    const db=await idbOpen(); const {s,done}=idbTxn(db,'readwrite');
    await new Promise((res,rej)=>{ const r=s.clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
    for (const d of map.values()){
      // Persist as { name, cards:[ {front:{name,blob}, back?:{name,blob}} ] }
      const cards=[];
      for (const c of d.cards){
        const rec = { front: { name: c.front.name, blob: c.front.blob } };
        if (c.back) rec.back = { name: c.back.name, blob: c.back.blob };
        cards.push(rec);
      }
      await new Promise((res,rej)=>{ const r=s.put({name:d.name, cards}); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
    }
    await done; db.close(); return true;
  }catch(e){ console.error(e); return false; }
}
async function loadAll(){
  try{
    const db=await idbOpen(); const {s,done}=idbTxn(db,'readonly');
    const all=await new Promise((res,rej)=>{ const r=s.getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); });
    await done; db.close(); return all;
  }catch(e){ console.error(e); return []; }
}
async function clearAllSaved(){
  try{ const db=await idbOpen(); const {s,done}=idbTxn(db,'readwrite');
    await new Promise((res,rej)=>{ const r=s.clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
    await done; db.close(); return true;
  }catch(e){ console.error(e); return false; }
}

// Decks & draw state
const decks = new Map(); // name -> { name, cards:[{front, back?}] }
let active = null;
let lastDraw = null; // { idx, showing: 'front'|'back' }

function createDeck(name){ if(decks.has(name)) return null; const d={ name, cards: [] }; decks.set(name,d); return d; }
function deleteDeck(name){ const d=decks.get(name); if(!d) return;
  d.cards.forEach(card => {
    try{ URL.revokeObjectURL(card.front.url); }catch{}
    if (card.back) { try{ URL.revokeObjectURL(card.back.url); }catch{} }
  });
  decks.delete(name); if(active?.name===name) active=null;
}
function setActive(name){ active=decks.get(name)||null; lastDraw=null; renderDeckList(); renderUI(); }
function renderDeckList(){ const sel=els.deckSelect; const cur=active?.name; sel.innerHTML='';
  for(const name of decks.keys()){ const o=document.createElement('option'); o.value=name; o.textContent=name; if(name===cur) o.selected=true; sel.appendChild(o); }
}
function renderUI(){
  const has=!!active && active.cards.length>0;
  els.draw.disabled=!active;
  els.flip.disabled = !lastDraw || !active?.cards[lastDraw.idx]?.back;
  els.status.textContent = has?`Deck “${active.name}”: ${active.cards.length} cards`:(active?`Deck “${active.name}” is empty`:'No deck loaded');
  els.pill.textContent = has?'Deck ready':'Waiting for images…';
  renderThumbs();
  if(!has){ els.display.innerHTML='<span class="pill">Waiting for images…</span>'; }
}
function renderThumbs(){
  if(!active){ els.thumbs.style.display='none'; els.thumbs.innerHTML=''; return; }
  if(!els.showThumbs.checked){ els.thumbs.style.display='none'; els.thumbs.innerHTML=''; return; }
  els.thumbs.style.display='grid'; els.thumbs.innerHTML='';
  for (const c of active.cards){
    const t = document.createElement('img');
    t.src = c.front.url; t.alt = c.front.name; t.title = c.front.name + (c.back ? ' (±back)' : '');
    els.thumbs.appendChild(t);
  }
}
function showCard(card, side='front'){
  els.display.innerHTML='';
  const img = document.createElement('img');
  const part = card[side] || card.front;
  img.className='card-img'; img.src = part.url; img.alt = part.name;
  els.display.appendChild(img);
  const p = document.createElement('span'); p.className='pill'; p.textContent = part.name;
  els.display.appendChild(p);
}
function draw(){
  if(!active || active.cards.length===0) return;
  const idx = Math.floor(Math.random()*active.cards.length);
  const card = active.cards[idx];
  lastDraw = { idx, showing: 'front' };
  showCard(card, 'front');
  els.flip.disabled = !card.back;
  toast('Drawn ✓','ok');
}
function flip(){
  if(!lastDraw || !active) return;
  const card = active.cards[lastDraw.idx];
  if(!card.back) return;
  lastDraw.showing = lastDraw.showing === 'front' ? 'back' : 'front';
  showCard(card, lastDraw.showing);
}

// Upload helpers
function filesFromDataTransfer(dt){ const out=[]; try{ if(dt.items&&dt.items.length){ for(const it of dt.items){ if(it.kind==='file'){ const f=it.getAsFile(); if(f) out.push(f); } } } }catch(e){} if(!out.length&&dt.files) return [...dt.files]; return out; }
function isImage(f){ const t=(f.type||'').toLowerCase(); if(t==='image/png'||t==='image/jpeg'||t==='image/jpg') return true; const n=(f.name||'').toLowerCase(); return /\.(png|jpe?g)$/.test(n); }
function objUrl(f){ return URL.createObjectURL(f); }

function splitBySuffix(files){
  // Group pairs using suffix markers: _front/_back | -front/-back | .front/.back
  const FRONT_RX = /([._-])front(?:\b|$)/i;
  const BACK_RX  = /([._-])back(?:\b|$)/i;

  const fronts = new Map(); // base -> file
  const backs  = new Map(); // base -> file

  function baseKey(name){
    const n = name.toLowerCase();
    if (FRONT_RX.test(n)) return n.replace(FRONT_RX, '');
    if (BACK_RX.test(n))  return n.replace(BACK_RX,  '');
    return null;
  }

  for(const f of files){
    const key = baseKey(f.name);
    if(!key) continue;
    if (FRONT_RX.test(f.name.toLowerCase())) fronts.set(key, f);
    else if (BACK_RX.test(f.name.toLowerCase())) backs.set(key, f);
  }

  const cards = [];
  for(const [key, f] of fronts){
    const b = backs.get(key);
    if (b){
      cards.push({
        front: { name: f.name, url: objUrl(f), blob: f },
        back:  { name: b.name, url: objUrl(b), blob: b }
      });
      backs.delete(key);
    }else{
      // unmatched front still becomes a front-only card
      cards.push({ front: { name: f.name, url: objUrl(f), blob: f } });
    }
  }
  // Any leftover backs are ignored (we could warn)
  const skippedBacks = backs.size;
  return { cards, skippedBacks };
}

function pairAlternate(filesSorted){
  const cards = [];
  for (let i=0;i<filesSorted.length;i+=2){
    const f = filesSorted[i];
    const b = filesSorted[i+1];
    if (!b){
      // odd one out → front-only
      cards.push({ front: { name: f.name, url: objUrl(f), blob: f } });
    } else {
      cards.push({
        front: { name: f.name, url: objUrl(f), blob: f },
        back:  { name: b.name, url: objUrl(b), blob: b }
      });
    }
  }
  return cards;
}

async function addImagesToActive(fileList){
  if(!active) return;
  const arr = Array.isArray(fileList)? fileList : [...fileList];
  const files = arr.filter(isImage);
  if(!files.length){ toast('No PNG/JPEG images found','warn'); return; }

  const type = els.deckType.value;
  let added = 0, skippedBacks = 0;

  if (type === 'fronts'){
    for(const f of files){
      active.cards.push({ front: { name: f.name, url: objUrl(f), blob: f } });
      added++;
    }
  } else {
    // fronts + backs
    const mode = els.pairingMode.value;
    if (mode === 'suffix'){
      const res = splitBySuffix(files);
      active.cards.push(...res.cards);
      added += res.cards.length;
      skippedBacks = res.skippedBacks;
    } else {
      // alternate
      const sorted = [...files].sort((a,b)=> a.name.localeCompare(b.name, undefined, {numeric:true}));
      const cards = pairAlternate(sorted);
      active.cards.push(...cards);
      added += cards.length;
    }
  }

  renderUI();
  let msg = `Added ${added} card(s) to “${active.name}”`;
  if (skippedBacks) msg += ` • skipped ${skippedBacks} unpaired back(s)`;
  toast(msg,'ok');
}

// UI wiring
els.addDeck.addEventListener('click', ()=>{ const name=(els.deckName.value||'').trim()||`Deck ${decks.size+1}`; if(decks.has(name)){ toast('Deck exists','warn'); return; } createDeck(name); setActive(name); els.deckName.value=''; toast(`Created “${name}”`,'ok'); });
els.delDeck.addEventListener('click', ()=>{ if(!active) return; const name=active.name; if(!confirm(`Delete deck “${name}” from this session? (Saved decks stay until you delete them)`)) return; deleteDeck(name); setActive([...decks.keys()][0]||null); toast(`Deleted “${name}”`,'warn'); });
els.deckSelect.addEventListener('change', e=> setActive(e.target.value));
els.deckType.addEventListener('change', () => { els.pairingWrap.style.display = els.deckType.value==='fronts_backs' ? '' : 'none'; });
els.pairingWrap.style.display = 'none'; // default hidden
els.showThumbs.addEventListener('change', renderThumbs);
['dragenter','dragover'].forEach(type=>{ els.drop.addEventListener(type, e=>{ e.preventDefault(); els.drop.classList.add('drag'); }); });
['dragleave','dragend'].forEach(type=>{ els.drop.addEventListener(type, ()=> els.drop.classList.remove('drag')); });
els.drop.addEventListener('drop', e=>{ e.preventDefault(); els.drop.classList.remove('drag'); const files = e.dataTransfer ? filesFromDataTransfer(e.dataTransfer) : []; addImagesToActive(files); });
els.drop.addEventListener('click', ()=> els.picker.click());
els.picker.addEventListener('change', e=>{ addImagesToActive(e.target.files); e.target.value=''; });
els.draw.addEventListener('click', draw);
els.flip.addEventListener('click', flip);
els.save.addEventListener('click', async ()=>{ const ok=await saveAll(decks); toast(ok?'Saved decks ✓':'Save failed', ok?'ok':'err'); });
els.load.addEventListener('click', async ()=>{ const saved=await loadAll(); if(!saved.length){ toast('No saved decks','warn'); return; }
  // replace in-memory with saved set
  for (const d of decks.values()){
    d.cards.forEach(c=>{ try{URL.revokeObjectURL(c.front.url)}catch{}; if(c.back){ try{URL.revokeObjectURL(c.back.url)}catch{}; } });
  }
  decks.clear();
  for (const rec of saved){
    const d = createDeck(rec.name);
    // Backward-compat: your older saves were {cards:[{name,blob}]}
    if (rec.cards && rec.cards.length && rec.cards[0].front === undefined){
      // old shape → treat all as fronts
      for (const c of rec.cards){
        const url = URL.createObjectURL(c.blob);
        d.cards.push({ front: { name: c.name, url, blob: c.blob } });
      }
    } else {
      for (const c of rec.cards){
        const frontUrl = URL.createObjectURL(c.front.blob);
        const card = { front: { name: c.front.name, url: frontUrl, blob: c.front.blob } };
        if (c.back){
          const backUrl = URL.createObjectURL(c.back.blob);
          card.back = { name: c.back.name, url: backUrl, blob: c.back.blob };
        }
        d.cards.push(card);
      }
    }
  }
  setActive(saved[0].name);
  toast('Loaded decks ✓','ok');
});
els.clearAll.addEventListener('click', async ()=>{ if(!confirm('Delete ALL saved decks from storage?')) return; const ok=await clearAllSaved(); toast(ok?'Deleted all saved ✓':'Delete failed', ok?'ok':'err'); });

const savedCollapsed = (typeof localStorage !== 'undefined') && localStorage.getItem('uploadCollapsed') === '1';
setUploadCollapsed(savedCollapsed);

if (els.toggleUpload){
  els.toggleUpload.addEventListener('click', () => {
    const collapsed = !els.uploadPanel.classList.contains('collapsed');
    setUploadCollapsed(collapsed);
  });
}

// Init
createDeck('Deck 1'); setActive('Deck 1'); renderUI();
(async ()=>{ const saved=await loadAll(); if(saved.length){
  decks.clear();
  for (const rec of saved){
    const d = createDeck(rec.name);
    if (rec.cards && rec.cards.length && rec.cards[0].front === undefined){
      for (const c of rec.cards){ const url = URL.createObjectURL(c.blob); d.cards.push({ front: { name: c.name, url, blob: c.blob } }); }
    } else {
      for (const c of rec.cards){
        const frontUrl = URL.createObjectURL(c.front.blob);
        const card = { front: { name: c.front.name, url: frontUrl, blob: c.front.blob } };
        if (c.back){ const backUrl = URL.createObjectURL(c.back.blob); card.back = { name: c.back.name, url: backUrl, blob: c.back.blob }; }
        d.cards.push(card);
      }
    }
  }
  setActive(saved[0].name);
  toast('Auto-loaded saved ✓','ok');
} })();
