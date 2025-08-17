// app.js — minimal, PNG-only, draw-with-replacement, multi-deck with IndexedDB
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
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  els.toast.appendChild(t);
  requestAnimationFrame(()=> t.classList.add('show'));
  setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(), 250); }, ms);
}

// --- IndexedDB (vanilla) ---
const DB_NAME = 'cards-pwa';
const DB_VERSION = 1;
const STORE = 'decks';

function idbOpen(){
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(STORE)){
        db.createObjectStore(STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
function idbTxn(db, mode){
  const tx = db.transaction(STORE, mode);
  const store = tx.objectStore(STORE);
  return { store, done: new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('aborted'));
  })};
}
async function saveAll(decks){
  try{
    if (navigator.storage && navigator.storage.persist) { try{ await navigator.storage.persist(); }catch{} }
    const db = await idbOpen();
    const { store, done } = idbTxn(db, 'readwrite');
    // Replace-all save
    await new Promise((res, rej)=>{ const r=store.clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
    for (const deck of decks.values()){
      const cards = [];
      for (const s of deck.sources){
        const blob = s.blob || null;
        if (blob) cards.push({ name: s.name, blob });
      }
      await new Promise((res, rej)=>{
        const r = store.put({ name: deck.name, cards });
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
      });
    }
    await done; db.close();
    return true;
  }catch(e){ console.error(e); return false; }
}
async function loadAll(){
  try{
    const db = await idbOpen();
    const { store, done } = idbTxn(db, 'readonly');
    const all = await new Promise((res, rej)=>{
      const r = store.getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error);
    });
    await done; db.close();
    return all;
  }catch(e){ console.error(e); return []; }
}
async function clearAllSaved(){
  try{
    const db = await idbOpen();
    const { store, done } = idbTxn(db, 'readwrite');
    await new Promise((res, rej)=>{ const r=store.clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
    await done; db.close();
    return true;
  }catch(e){ console.error(e); return false; }
}

// --- Deck model (PNG only, with replacement) ---
const decks = new Map(); // name -> { name, sources:[{name, url, blob}] }
let active = null;

function createDeck(name){
  if (decks.has(name)) return null;
  const deck = { name, sources: [] };
  decks.set(name, deck);
  return deck;
}
function deleteDeck(name){
  const d = decks.get(name);
  if (!d) return;
  d.sources.forEach(s => { try{ URL.revokeObjectURL(s.url); }catch{} });
  decks.delete(name);
  if (active?.name === name) active = null;
}

function setActive(name){
  active = decks.get(name) || null;
  renderDeckList();
  renderUI();
}

function renderDeckList(){
  const sel = els.deckSelect;
  const current = active?.name;
  sel.innerHTML = '';
  for (const name of decks.keys()){
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    if (name === current) opt.selected = true;
    sel.appendChild(opt);
  }
}

function renderUI(){
  const has = !!active && active.sources.length>0;
  els.draw.disabled = !active;
  els.status.textContent = has ? `Deck “${active.name}”: ${active.sources.length} cards` : (active ? `Deck “${active.name}” is empty` : 'No deck loaded');
  els.pill.textContent = has ? 'Deck ready' : 'Waiting for PNGs…';
  renderThumbs();
  if (!has) { els.display.innerHTML = '<span class="pill">Waiting for PNGs…</span>'; }
}

function renderThumbs(){
  if (!active){ els.thumbs.style.display='none'; els.thumbs.innerHTML=''; return; }
  if (!els.showThumbs.checked){ els.thumbs.style.display='none'; els.thumbs.innerHTML=''; return; }
  els.thumbs.style.display='grid';
  els.thumbs.innerHTML = '';
  for (const s of active.sources){
    const t = document.createElement('img');
    t.src = s.url; t.alt = s.name; t.title = s.name;
    els.thumbs.appendChild(t);
  }
}

function showCard(url, name){
  els.display.innerHTML = '';
  const img = document.createElement('img');
  img.className = 'card-img'; img.src = url; img.alt = name;
  els.display.appendChild(img);
  const pill = document.createElement('span');
  pill.className = 'pill'; pill.textContent = name;
  els.display.appendChild(pill);
}

function draw(){
  if (!active || active.sources.length===0) return;
  const i = Math.floor(Math.random() * active.sources.length);
  const c = active.sources[i];
  showCard(c.url, c.name);
  toast('Drawn ✓','ok');
}

async function addPNGsToActive(fileList){
  if (!active) return;
  const files = [...fileList].filter(f => f.type === 'image/png' || f.type === 'image/jpeg');
  if (!files.length){ toast('No PNG/JPEGs found','warn'); return; }
  for (const f of files){
    const url = URL.createObjectURL(f);
    active.sources.push({ name: f.name, url, blob: f });
  }
  renderUI();
  toast(`Added ${files.length} image(s) to “${active.name}”`,'ok');
}

// --- UI wires ---
els.addDeck.addEventListener('click', () => {
  const name = (els.deckName.value || '').trim() || `Deck ${decks.size+1}`;
  if (decks.has(name)) { toast('Deck exists','warn'); return; }
  createDeck(name); setActive(name); els.deckName.value=''; toast(`Created “${name}”`,'ok');
});
els.delDeck.addEventListener('click', () => {
  if (!active) return;
  const name = active.name;
  if (!confirm(`Delete deck “${name}” from this session? (Saved decks stay until you delete them)`)) return;
  deleteDeck(name); setActive([...decks.keys()][0] || null); toast(`Deleted “${name}”`,'warn');
});
els.deckSelect.addEventListener('change', e => setActive(e.target.value));
els.showThumbs.addEventListener('change', renderThumbs);

['dragenter','dragover'].forEach(type => {
  els.drop.addEventListener(type, e => { e.preventDefault(); els.drop.classList.add('drag'); });
});
['dragleave','dragend'].forEach(type => {
  els.drop.addEventListener(type, () => els.drop.classList.remove('drag'));
});
els.drop.addEventListener('drop', e => {
  e.preventDefault(); els.drop.classList.remove('drag');
  addPNGsToActive(e.dataTransfer.files);
});
els.drop.addEventListener('click', () => els.picker.click());
els.picker.addEventListener('change', e => { addPNGsToActive(e.target.files); e.target.value=''; });

els.draw.addEventListener('click', draw);

els.save.addEventListener('click', async () => {
  const ok = await saveAll(decks);
  toast(ok?'Saved decks ✓':'Save failed','ok');
});
els.load.addEventListener('click', async () => {
  const saved = await loadAll();
  if (!saved.length){ toast('No saved decks','warn'); return; }
  // replace in-memory decks with saved set
  for (const d of decks.values()){ d.sources.forEach(s=>{try{URL.revokeObjectURL(s.url)}catch{}}); }
  decks.clear();
  for (const rec of saved){
    const deck = createDeck(rec.name);
    for (const c of rec.cards){
      const url = URL.createObjectURL(c.blob);
      deck.sources.push({ name: c.name, url, blob: c.blob });
    }
  }
  setActive(saved[0].name);
  toast('Loaded decks ✓','ok');
});
els.clearAll.addEventListener('click', async () => {
  if(!confirm('Delete ALL saved decks from storage?')) return;
  const ok = await clearAllSaved();
  toast(ok?'Deleted all saved ✓':'Delete failed', ok?'ok':'err');
});

// Init default deck
createDeck('Deck 1'); setActive('Deck 1'); renderUI();

// Optional: auto-load saved on startup
(async () => {
  const saved = await loadAll();
  if (saved.length){
    decks.clear();
    for (const rec of saved){
      const deck = createDeck(rec.name);
      for (const c of rec.cards){
        const url = URL.createObjectURL(c.blob);
        deck.sources.push({ name: c.name, url, blob: c.blob });
      }
    }
    setActive(saved[0].name);
    toast('Auto-loaded saved ✓','ok');
  }
})();
