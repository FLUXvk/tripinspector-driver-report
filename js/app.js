/* Trip Inspector DRIVER · Trip Report — lightweight offline app (no server).
   Flow: 1 vehicle & driver → 2 pre-trip inspection (mandatory) → 3 trip budget → 4 refuels → 5 trip end → PDF report.
   Plus: incident reports, GPS at inspection / every refuel / trip end, head-office round trips. */
'use strict';
const APP_VERSION = '1.1.0';

/* ------------------------------------------------------------------ helpers */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = v => { const n = parseFloat(String(v ?? '').replace(/[^\d.\-]/g, '')); return isNaN(n) ? null : n; };
const nad = n => 'N$ ' + (Math.round((+n || 0) * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kmF = n => `${Math.round(+n || 0).toLocaleString('en-GB')} km`;
const pd = s => { if (!s) return null; const d = new Date(s); return isNaN(d) ? null : d; };
const fmtD = s => { const d = pd(s); return d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''; };
const fmtDT = s => { const d = pd(s); return d ? d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; };
const dayKey = d => { const x = d instanceof Date ? d : pd(d); return x ? `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` : ''; };
const localInput = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
const tripRef = t => 'TR-' + (t.createdAt ? dayKey(new Date(t.createdAt)).replace(/-/g, '').slice(2) : '') + '-' + t.id.slice(-4).toUpperCase();
const incRef = x => 'IN-' + (x.createdAt ? dayKey(new Date(x.createdAt)).replace(/-/g, '').slice(2) : '') + '-' + x.id.slice(-4).toUpperCase();
const mapURL = g => `https://maps.google.com/?q=${g.lat},${g.lng}`;
function hav(a, b) { const R = 6371, r = x => x * Math.PI / 180, dLa = r(b.lat - a.lat), dLo = r(b.lng - a.lng); const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }

/* ------------------------------------------------------------------ storage (IndexedDB) */
const DB = (() => {
  let p;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('ti-trip-report', 2);
    r.onupgradeneeded = () => { const d = r.result; ['vehicles', 'drivers', 'trips', 'incidents'].forEach(s => d.objectStoreNames.contains(s) || d.createObjectStore(s, { keyPath: 'id' })); ['kv', 'photos'].forEach(s => d.objectStoreNames.contains(s) || d.createObjectStore(s)); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (st, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(st, mode); const q = fn(t.objectStore(st)); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
  return {
    all: s => tx(s, 'readonly', o => o.getAll()).then(x => x || []),
    get: (s, k) => tx(s, 'readonly', o => o.get(k)),
    put: (s, v, k) => tx(s, 'readwrite', o => k === undefined ? o.put(v) : o.put(v, k)),
    del: (s, k) => tx(s, 'readwrite', o => o.delete(k)),
    keys: s => tx(s, 'readonly', o => o.getAllKeys()).then(x => x || []),
  };
})();
/* Head office: trips normally start here and return here. The exact spot is set once in Settings (default = Windhoek centre). */
const DEFAULT_SETTINGS = { company: '', diesel: 28.30, petrol: 25.13, buffer: 10, hoName: 'Head Office', hoTown: 'Windhoek', hoLat: -22.5609, hoLng: 17.0658, hoSet: false, hoRadius: 1 };
let SET = { ...DEFAULT_SETTINGS };
async function loadSettings() { try { const v = await DB.get('kv', 'settings'); if (v) SET = { ...DEFAULT_SETTINGS, ...v }; } catch (e) { } return SET; }
const saveSettings = () => DB.put('kv', SET, 'settings');
const hoLabel = () => `${SET.hoName || 'Head Office'}, ${SET.hoTown}`;

/* photos: Blob per owner (trip / incident) slot, key "<ownerId>:<slot>" */
const URLS = {};
async function photoURL(ownerId, slot) {
  const k = ownerId + ':' + slot; if (URLS[k]) return URLS[k];
  const b = await DB.get('photos', k); if (!b) return ''; URLS[k] = URL.createObjectURL(b); return URLS[k];
}
async function setPhoto(ownerId, slot, blob) { const k = ownerId + ':' + slot; await DB.put('photos', blob, k); if (URLS[k]) URL.revokeObjectURL(URLS[k]); URLS[k] = URL.createObjectURL(blob); }
async function delPhoto(ownerId, slot) { const k = ownerId + ':' + slot; await DB.del('photos', k); if (URLS[k]) { URL.revokeObjectURL(URLS[k]); delete URLS[k]; } }
async function delPhotos(ownerId) { for (const k of await DB.keys('photos')) if (String(k).startsWith(ownerId + ':')) await DB.del('photos', k); }
async function deleteTrip(t) { await delPhotos(t.id); await DB.del('trips', t.id); }

/* ------------------------------------------------------------------ image tools */
function fileToDataURL(f) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); }); }
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
async function compress(file, max = 1400, q = 0.72) {
  const url = URL.createObjectURL(file); const img = await loadImg(url); URL.revokeObjectURL(url);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', q));
}

/* ------------------------------------------------------------------ icons (same set as Trip Inspector DRIVER) */
const I = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  home: I('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
  car: I('<path d="M5 17h14v-5l-2-5H7l-2 5z"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/><path d="M5 12h14"/>'),
  user: I('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>'),
  camera: I('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="4"/>'),
  image: I('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'),
  fuel: I('<path d="M4 20V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15"/><path d="M3 20h12M4 10h10"/><path d="M14 8h2l3 3v6a1.5 1.5 0 0 1-3 0v-3h-2"/>'),
  route: I('<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>'),
  clip: I('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M9 12l2 2 4-4"/>'),
  flag: I('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  doc: I('<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h6"/>'),
  gear: I('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
  share: I('<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.5M8.2 13.2l7.6 4.5"/>'),
  check: I('<path d="M4 12l5 5L20 6"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  trash: I('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  pin: I('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  building: I('<path d="M4 21V5l8-3v19M12 8l8 3v10M2 21h20M7 9h2M7 13h2M7 17h2M15 14h2M15 18h2"/>'),
  download: I('<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>'),
  lock: I('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  alert: '<svg viewBox="0 0 24 24"><path d="M12 2.6L1.4 21h21.2z" fill="#d93025" stroke="#d93025" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 9v5.6" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="17.7" r="1.35" fill="#fff"/></svg>',
};

/* ------------------------------------------------------------------ UI primitives */
function toast(msg, ms = 2600) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); }
function modal(title, html, buttons) {
  return new Promise(res => {
    const m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = `<div class="box"><h3>${esc(title)}</h3><div class="mbody">${html}</div><div class="stack" style="margin-top:16px">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${b.icon ? ICON[b.icon] : ''}${esc(b.label)}</button>`).join('')}</div></div>`;
    m.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) { const v = buttons[+b.dataset.i].value; m.remove(); res(v); } else if (e.target === m) { m.remove(); res(undefined); } });
    document.body.appendChild(m);
  });
}
const confirmBox = (t, h, ok = 'Confirm', cls = 'gold') => modal(t, h, [{ label: ok, value: true, cls }, { label: 'Cancel', value: false, cls: 'ghost' }]);
const ROUTES = [];
const route = (p, fn) => ROUTES.push({ re: new RegExp('^' + p.replace(/:(\w+)/g, '([^/]+)') + '$'), fn });
const go = h => { if (location.hash === h) render(); else location.hash = h; };
window.addEventListener('hashchange', () => render());
let RQ = Promise.resolve();
function render(keepScroll) { RQ = RQ.then(() => doRender(keepScroll)).catch(e => console.error(e)); return RQ; }
async function doRender(keepScroll) {
  const y = window.scrollY; const h = location.hash.replace(/^#/, '') || '/';
  const r = ROUTES.find(x => x.re.test(h)); if (!r) return go('#/');
  try { await r.fn(...h.match(r.re).slice(1).map(decodeURIComponent)); } catch (e) { console.error(e); page('Something went wrong', `<div class="banner bad">${esc(e.message)}</div><button class="btn" onclick="go('#/')">Home</button>`); }
  window.scrollTo(0, keepScroll ? y : 0);
}
const TABS = [['#/', 'Home', 'home'], ['#/new', 'New trip', 'plus'], ['#/incidents', 'Incident', 'alert'], ['#/trips', 'Reports', 'doc'], ['#/settings', 'Settings', 'gear']];
function page(title, body, opts = {}) {
  GPS_HOOK = null;
  const cur = '#' + (location.hash.replace(/^#/, '') || '/');
  const isOn = hh => hh === '#/incidents' ? cur.startsWith('#/incident') : hh === '#/trips' ? cur === hh || cur.startsWith('#/trip/') : cur === hh;
  $('#app').innerHTML = `<header class="top">${opts.back ? `<button class="back" onclick="go('${opts.back}')" aria-label="Back">‹</button>` : ''}
      <img class="logo" src="assets/logo_header.jpg" alt="Trip Inspector" onclick="go('#/')"><span class="sp"></span><span id="net" class="net ${navigator.onLine ? '' : 'off'}">${navigator.onLine ? 'online' : 'offline'}</span></header>
    <main class="page">${opts.kicker ? `<div class="kicker">${esc(opts.kicker)}</div>` : ''}${title ? `<h1>${esc(title)}</h1>` : ''}${opts.sub ? `<p class="sub">${opts.sub}</p>` : ''}${body}</main>
    ${opts.noTabs ? '' : `<nav class="tabs">${TABS.map(([hh, l, i]) => `<a href="${hh}" class="${isOn(hh) ? 'on' : ''} ${i === 'alert' ? 'inc' : ''}">${ICON[i]}${l}</a>`).join('')}</nav>`}`;
}
window.addEventListener('online', () => { const n = $('#net'); if (n) { n.textContent = 'online'; n.classList.remove('off'); } });
window.addEventListener('offline', () => { const n = $('#net'); if (n) { n.textContent = 'offline'; n.classList.add('off'); } });
const segHTML = (id, opts, cur) => `<div class="seg" id="${id}">${opts.map(([v, l]) => `<button type="button" data-v="${esc(v)}" class="${String(cur) === String(v) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
function bindSeg(sel, fn) { $$(sel + ' button').forEach(b => b.onclick = () => { $$(sel + ' button').forEach(x => x.classList.toggle('on', x === b)); fn(b.dataset.v); }); }

/* photo widgets — camera input fills the tile; small gallery button in the corner. data-slot = storage slot */
function bigShot(slot, label, hint, url) {
  return `<div class="shot ${url ? 'has' : ''}">${url ? `<img src="${url}" alt="${esc(label)}">` : `${ICON.camera.replace('<svg', '<svg width="44" height="44"')}<b>${esc(label)}</b>${hint ? `<span class="muted small">${esc(hint)}</span>` : ''}`}
    <div class="row wrap" style="justify-content:center;width:100%"><label class="btn ${url ? 'ghost sm' : 'gold'}" style="${url ? '' : 'max-width:300px'}">${ICON.camera} ${url ? 'Retake' : 'Take photo'}<input type="file" accept="image/*" capture="environment" data-slot="${slot}" hidden></label>
    <label class="btn ghost sm">${ICON.image} Gallery<input type="file" accept="image/*" data-slot="${slot}" hidden></label></div></div>`;
}
function miniShot(slot, label, url, n) {
  return `<div class="mini ${url ? 'has' : ''}">${n ? `<span class="n">${n}</span>` : ''}${url ? `<img src="${url}" alt="">` : ICON.camera}${url ? '' : `<span>${esc(label)}</span>`}${url ? `<span class="lbl">✓ ${esc(label)}</span>` : ''}
    <input type="file" accept="image/*" capture="environment" data-slot="${slot}" aria-label="Take ${esc(label)} photo">
    <label class="gal" title="Choose from gallery">${ICON.image}<input type="file" accept="image/*" data-slot="${slot}"></label></div>`;
}
function bindSlots(owner, after, save = saveTrip) {
  $$('input[data-slot]').forEach(inp => inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return; const slot = inp.dataset.slot;
    const tile = inp.closest('.shot,.mini'); if (tile) tile.style.opacity = .5;
    const blob = await compress(f); await setPhoto(owner.id, slot, blob);
    owner.photos = owner.photos || {}; owner.photos[slot] = Date.now(); await save(owner);
    after && await after(slot, blob);
    await render(true);
  });
}

/* ------------------------------------------------------------------ GPS */
let GPS_HOOK = null;
function getGPS(timeout = 25000) {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('GPS is not available on this device'));
    navigator.geolocation.getCurrentPosition(p => res({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy), at: new Date().toISOString() }),
      e => rej(new Error(e.code === 1 ? 'Location permission is blocked — allow location for this app in the phone settings' : e.code === 3 ? 'GPS timed out — step outside and try again' : 'Location unavailable — switch on Location and try again')),
      { enableHighAccuracy: true, timeout, maximumAge: 0 });
  });
}
function gpsBox(key, g, label = 'GPS location') {
  return `<div class="gps ${g ? 'has' : ''}" id="gpsbox_${key}">${ICON.pin}<div class="grow">${g
    ? `<b>${esc(label)} ✓</b><div class="small muted">${g.lat.toFixed(5)}, ${g.lng.toFixed(5)} · ±${g.acc} m<br>${fmtDT(g.at)} · <a href="${mapURL(g)}" target="_blank" rel="noopener">view on map</a></div>`
    : `<b>${esc(label)}</b><div class="small muted">Not captured yet — location services must be on</div>`}</div>
    <button type="button" class="btn ${g ? 'ghost' : 'gold'} sm" data-gps="${key}" data-label="${esc(label)}">${g ? 'Update' : 'Capture'}</button></div>`;
}
async function captureGPS(owner, key, save, quiet) {
  const box = $('#gpsbox_' + key), btn = box && $('button', box), label = btn ? btn.dataset.label : 'GPS location';
  if (btn) { btn.disabled = true; btn.textContent = 'Locating…'; }
  let ok = false;
  try { const g = await getGPS(); owner.gps = owner.gps || {}; owner.gps[key] = g; await save(owner); ok = true; if (!quiet) toast(`Location captured (±${g.acc} m)`); }
  catch (e) { if (!quiet) toast(e.message, 5000); else console.warn(e.message); }
  const b2 = $('#gpsbox_' + key); if (b2) { b2.outerHTML = gpsBox(key, owner.gps && owner.gps[key], label); bindGPS(owner, save); }
  if (ok && GPS_HOOK) GPS_HOOK(key);
  return ok;
}
function bindGPS(owner, save = saveTrip) { $$('[data-gps]').forEach(b => b.onclick = () => captureGPS(owner, b.dataset.gps, save)); }
const AUTO = new Set();
function autoGPS(owner, key, save = saveTrip) { const k = owner.id + key; if (AUTO.has(k) || (owner.gps && owner.gps[key])) return; AUTO.add(k); captureGPS(owner, key, save, true); }

/* ------------------------------------------------------------------ OCR (Tesseract, runs on the phone; first use downloads ≈15 MB) */
let OCR = null, OCR_MODE = '';
async function loadScript(src) { if ([...document.scripts].some(s => s.src.endsWith(src))) return; await new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
async function ocrWorker(mode) {
  await loadScript('lib/tesseract/tesseract.min.js');
  if (!OCR) OCR = await Tesseract.createWorker('eng', 1, { workerPath: new URL('lib/tesseract/worker.min.js', location.href).href, corePath: new URL('lib/tesseract/core', location.href).href, langPath: new URL('lib/tesseract/lang', location.href).href, gzip: true });
  if (OCR_MODE !== mode) { await OCR.setParameters(mode === 'digits' ? { tessedit_char_whitelist: '0123456789 ', tessedit_pageseg_mode: '11' } : { tessedit_char_whitelist: '', tessedit_pageseg_mode: '3' }); OCR_MODE = mode; }
  return OCR;
}
async function prep(blob, { invert = false, scale = 1800 } = {}) {
  const img = await loadImg(URL.createObjectURL(blob)); const k = Math.max(1, scale / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; const g = c.getContext('2d');
  g.filter = `grayscale(1) contrast(1.7)${invert ? ' invert(1)' : ''}`; g.drawImage(img, 0, 0, c.width, c.height); return c;
}
async function ocrDisc(blob) {
  const w = await ocrWorker('text'); const { data } = await w.recognize(await prep(blob));
  return { text: data.text || '', ...pickExpiry(data.text || '') };
}
function pickExpiry(text) {
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const t = text.replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, '0');
  const found = []; let m;
  const add = (y, mo, d, idx) => { y = +y; mo = +mo; d = +d; if (y < 100) y += 2000; if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2015 || y > 2040) return; const dt = new Date(Date.UTC(y, mo - 1, d)); if (dt.getUTCDate() !== d) return; found.push({ date: dt.toISOString().slice(0, 10), idx }); };
  const r1 = /(?<!\d)(\d{4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})(?!\d)/g; while ((m = r1.exec(t))) add(m[1], m[2], m[3], m.index);
  const r2 = /(?<!\d)(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4}|\d{2})(?!\d)/g; while ((m = r2.exec(t))) add(m[3], m[2], m[1], m.index);
  const r3 = /(?<!\d)(\d{1,2})\s*([A-Za-z]{3,4})[a-z]*\.?\s*(\d{4})(?!\d)/g; while ((m = r3.exec(t))) { const mo = MON[m[2].toLowerCase()]; if (mo) add(m[3], mo, m[1], m.index); }
  if (!found.length) return { expiry: '', candidates: [] };
  const kw = /expir|verval|valid|date of exp/ig; const kws = []; while ((m = kw.exec(t))) kws.push(m.index);
  let best = null;
  if (kws.length) best = found.map(f => ({ ...f, dist: Math.min(...kws.map(k => Math.abs(k - f.idx))) })).sort((a, b) => a.dist - b.dist)[0];
  if (!best || best.dist > 120) best = found.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
  return { expiry: best.date, candidates: [...new Set(found.map(f => f.date))] };
}
async function ocrOdo(blob, lastOdo) {
  const w = await ocrWorker('digits'); const cands = [];
  for (const invert of [false, true]) {
    const { data } = await w.recognize(await prep(blob, { invert }));
    (data.text || '').split('\n').forEach(line => (line.match(/\d[\d ]{2,9}\d/g) || []).forEach(s => {
      const parts = s.trim().split(/\s+/); // "152 410" → 152410 ; keep groups of 3 joined, otherwise each run separately
      const joined = parts.length > 1 && parts.slice(1).every(p => p.length === 3) ? [parts.join('')] : parts;
      joined.forEach(d => { if (d.length >= 4 && d.length <= 7) cands.push(+d); });
    }));
  }
  const uniq = [...new Set(cands)];
  if (!uniq.length) return { value: null, candidates: [] };
  let pick;
  if (lastOdo) { const ok = uniq.filter(v => v >= lastOdo - 5 && v <= lastOdo + 30000); pick = (ok.length ? ok : uniq).sort((a, b) => Math.abs(a - lastOdo) - Math.abs(b - lastOdo))[0]; }
  else pick = uniq.sort((a, b) => String(b).length - String(a).length || b - a)[0];
  return { value: pick, candidates: uniq };
}

/* ------------------------------------------------------------------ trip model */
/* Namibia drives on the left → right-hand-drive vehicles: driver side = right, passenger side = left */
const SIDES = [['front', 'Front', 'Front'], ['driver', 'Driver side (right)', 'Driver side'], ['back', 'Back', 'Back'], ['passenger', 'Passenger side (left)', 'Passenger side']];
let CUR = null, saveT = null;
async function saveTrip(t, debounce) {
  t.updatedAt = Date.now();
  if (debounce) { clearTimeout(saveT); saveT = setTimeout(() => DB.put('trips', t), 300); } else { clearTimeout(saveT); await DB.put('trips', t); }
}
async function getTrip(id) { if (!(CUR && CUR.id === id)) CUR = await DB.get('trips', id); if (CUR) { CUR.gps = CUR.gps || {}; CUR.photos = CUR.photos || {}; } return CUR; }
function newTrip() {
  return { id: uid(), status: 'draft', createdAt: Date.now(), updatedAt: Date.now(), vehicleId: '', driverId: '', vehicle: null, driver: null, photos: {}, gps: {},
    insp: { diskExpiry: '', diskOcr: '', odo: '', odoOcr: '' },
    budget: { fromHO: true, from: SET.hoTown || 'Windhoek', stops: [''], round: true, manual: false, kmManual: '', cons: '', price: '', received: '', method: 'Cash', note: '', departAt: localInput(new Date()), purpose: '' },
    refuels: [], end: { odo: '', odoOcr: '', notes: '', at: '', where: '' } };
}
const startTown = t => t.budget.fromHO ? SET.hoTown : t.budget.from;
const startLabel = t => t.budget.fromHO ? hoLabel() : t.budget.from;
const returnsToHO = t => t.budget.fromHO && t.budget.round;
function budgetCalc(t) {
  const b = t.budget, v = t.vehicle || {};
  const r = tripRoute([startTown(t), ...b.stops], b.round);
  const km = b.manual ? num(b.kmManual) || 0 : r ? r.km : 0;
  const cons = num(b.cons) || +v.cons || 12, price = num(b.price) || (v.fuel === 'petrol' ? +SET.petrol : +SET.diesel), buf = +SET.buffer || 0;
  const litres = Math.round(km * cons / 100 * (1 + buf / 100) * 10) / 10;
  return { route: r, km, cons, price, buf, litres, cost: Math.round(litres * price * 100) / 100 };
}
function moneyCalc(t) {
  const received = num(t.budget.received) || 0;
  const spent = t.refuels.reduce((a, r) => a + (num(r.amount) || 0), 0), litres = t.refuels.reduce((a, r) => a + (num(r.litres) || 0), 0);
  const remaining = received - spent;
  return { received, spent, litres, remaining: Math.max(0, remaining), due: Math.max(0, -remaining) };
}
function actualKm(t) { const a = num(t.insp.odo), b = num(t.end.odo); return a != null && b != null && b >= a ? b - a : null; }
/* where did the trip end relative to head office? (only for trips that start at head office and return there) */
function hoCheck(t) {
  if (!returnsToHO(t) || !t.gps.end) return null;
  const d = hav(t.gps.end, { lat: +SET.hoLat, lng: +SET.hoLng }), radius = SET.hoSet ? (+SET.hoRadius || 1) : 6;
  return { km: Math.round(d * 10) / 10, ok: d <= radius, exact: !!SET.hoSet };
}
function stepStatus(t) {
  const P = t.photos || {}; const has = s => !!P[s]; const G = t.gps || {};
  const s1 = [t.vehicleId ? null : 'Vehicle not selected', t.driverId ? null : 'Driver not selected'];
  const s2 = [...SIDES.map(([k, l]) => has('insp_' + k) ? null : `${l} photo`), has('insp_disk') ? null : 'Licence disc photo', t.insp.diskExpiry ? null : 'Licence disc expiry date', has('insp_odo') ? null : 'Odometer photo', num(t.insp.odo) != null ? null : 'Odometer reading', G.insp ? null : 'GPS location'];
  const bc = budgetCalc(t);
  const s3 = [t.budget.stops.filter(Boolean).length ? null : 'Destination', bc.km ? null : 'Trip distance', num(t.budget.received) != null ? null : 'Fuel money received'];
  const s4 = t.refuels.length ? t.refuels.flatMap((r, i) => [num(r.amount) != null ? null : `Refuel ${i + 1}: amount`, has(`rf_${r.id}_receipt`) ? null : `Refuel ${i + 1}: receipt photo`, has(`rf_${r.id}_pump`) ? null : `Refuel ${i + 1}: pump photo`, has(`rf_${r.id}_odo`) ? null : `Refuel ${i + 1}: odometer photo`, G['rf_' + r.id] ? null : `Refuel ${i + 1}: GPS location`]) : ['No refuels recorded'];
  const s5 = [has('end_odo') ? null : 'End odometer photo', num(t.end.odo) != null ? null : 'End odometer reading', G.end ? null : 'GPS location at trip end', ...SIDES.map(([k, l]) => has('end_' + k) ? null : `${l} photo (after trip)`)];
  return [s1, s2, s3, s4, s5].map(list => { const miss = list.filter(Boolean); return { miss, state: miss.length === 0 ? 'done' : miss.length === list.length ? 'todo' : 'part' }; });
}
/* steps 1 + 2 are mandatory before the trip can continue */
const gateMissing = t => { const st = stepStatus(t); return { s1: st[0].miss, s2: st[1].miss }; };
const unlocked = t => { const g = gateMissing(t); return !g.s1.length && !g.s2.length; };
function lockedPage(t, n) {
  const g = gateMissing(t), first = g.s1.length ? 1 : 2;
  page(STEPS[n - 1][0], `${stepBar(n)}<div class="banner warn"><b>Finish the ${first === 1 ? 'vehicle & driver selection' : 'pre-trip inspection'} first.</b><br>The trip can only continue once the pre-trip inspection is complete.</div>
    <div class="card"><b>Still missing</b><ul class="miss small">${[...g.s1, ...g.s2].map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>
    <button class="btn gold" onclick="go('#/trip/${t.id}/${first}')">${first === 1 ? 'Select vehicle & driver' : 'Complete the inspection'}</button>`, stepOpts(t, n));
}
const STEPS = [['Vehicle & driver', 'car'], ['Pre-trip inspection', 'clip'], ['Trip budget', 'route'], ['Refuelling', 'fuel'], ['Trip end', 'flag']];

/* ------------------------------------------------------------------ install (PWA) */
let DEFER_INSTALL = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); DEFER_INSTALL = e; if (location.hash.startsWith('#/settings')) render(true); });
window.addEventListener('appinstalled', () => { DEFER_INSTALL = null; toast('App installed — open it from your home screen'); if (location.hash.startsWith('#/settings')) render(true); });
function installHTML() {
  if (isStandalone()) return `<div class="banner ok">${ICON.check.replace('<svg', '<svg width="20" height="20" style="vertical-align:-4px"')} Installed — you are using the app version.</div>`;
  if (DEFER_INSTALL) return `<p class="small" style="margin-top:0">Put Trip Report on the home screen like a normal app. It opens full-screen and works without signal.</p><button class="btn gold" id="inst">${ICON.download} Install app on this phone</button>`;
  if (isIOS()) return `<p class="small" style="margin-top:0">On iPhone: open this page in <b>Safari</b>, tap the <b>Share</b> button (square with arrow) and choose <b>Add to Home Screen</b>.</p>`;
  return `<p class="small" style="margin-top:0">Open this page in <b>Chrome</b>, tap the <b>⋮</b> menu and choose <b>Install app</b> (or <b>Add to Home screen</b>).</p><button class="btn ghost" id="inst2">${ICON.download} Install app</button>`;
}
function bindInstall() {
  const b = $('#inst'); if (b) b.onclick = async () => { const p = DEFER_INSTALL; if (!p) return; p.prompt(); const r = await p.userChoice.catch(() => null); DEFER_INSTALL = null; if (r && r.outcome === 'accepted') toast('Installing…'); render(true); };
  const b2 = $('#inst2'); if (b2) b2.onclick = () => modal('Install the app', `<p>Your browser has not offered the install button yet. Install it from the browser menu:</p><ul class="miss small"><li><b>Chrome (Android):</b> ⋮ menu → <b>Install app</b> / <b>Add to Home screen</b></li><li><b>Samsung Internet:</b> ≡ menu → <b>Add page to</b> → <b>Home screen</b></li><li><b>iPhone (Safari):</b> Share → <b>Add to Home Screen</b></li></ul><p class="small muted">The app must be opened from its https:// GitHub Pages link.</p>`, [{ label: 'OK', value: 1, cls: 'gold' }]);
}

/* ------------------------------------------------------------------ home */
route('/', async () => {
  await loadSettings();
  const [trips, vs, ds] = await Promise.all([DB.all('trips'), DB.all('vehicles'), DB.all('drivers')]);
  const open = trips.filter(t => t.status !== 'completed').sort((a, b) => b.updatedAt - a.updatedAt);
  const done = trips.filter(t => t.status === 'completed').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
  const setup = !vs.length || !ds.length;
  page('', `<div class="home-hero"><img src="assets/logo_full_black.jpg" alt="Trip Inspector DRIVER"><div class="kicker" style="color:var(--gold);margin-top:6px">Trip Report</div></div>
    ${setup ? `<div class="banner warn">First add your ${!vs.length ? 'vehicles' : ''}${!vs.length && !ds.length ? ' and ' : ''}${!ds.length ? 'drivers' : ''} in <a href="#/settings">Settings</a>.</div>` : ''}
    <button class="btn gold" onclick="go('#/new')" style="min-height:66px;font-size:20px">${ICON.plus} Start new trip</button>
    <div style="height:10px"></div><button class="btn redo" onclick="go('#/incident/new')">${ICON.alert} Report an incident</button>
    ${open.length ? `<h2>Trips in progress</h2>${open.map(t => tripCard(t)).join('')}` : ''}
    ${done.length ? `<h2>Recent reports</h2>${done.map(t => tripCard(t)).join('')}<button class="btn ghost" onclick="go('#/trips')">All reports</button>` : ''}
    <p class="tiny muted" style="text-align:center;margin-top:20px">Trip Inspector DRIVER · Trip Report v${APP_VERSION} · data stays on this phone</p>`, {});
});
function tripCard(t) {
  t.gps = t.gps || {};
  const st = stepStatus(t), doneN = st.filter(s => s.state === 'done').length;
  const dest = t.budget.stops.filter(Boolean).slice(-1)[0];
  return `<button class="stepcard" onclick="go('#/trip/${t.id}')"><span class="num" style="${t.status === 'completed' ? 'background:var(--ink);color:var(--gold)' : ''}">${t.status === 'completed' ? '✓' : doneN + '/5'}</span>
    <span><b>${esc(dest ? `${startTown(t)} → ${dest}${t.budget.round ? ' ↺' : ''}` : 'New trip')}</b><span class="s">${esc(t.vehicle ? t.vehicle.name + ' · ' + t.vehicle.reg : 'no vehicle')} · ${esc(t.driver ? t.driver.name : 'no driver')}<br>${tripRef(t)} · ${fmtD(t.createdAt)}</span></span>
    <span class="st">${t.status === 'completed' ? '<span class="chip completed">Report</span>' : '<span class="chip pending">In progress</span>'}</span></button>`;
}
route('/new', async () => { await loadSettings(); const t = newTrip(); await DB.put('trips', t); CUR = t; go(`#/trip/${t.id}/1`); });
route('/trips', async () => {
  const trips = (await DB.all('trips')).sort((a, b) => b.updatedAt - a.updatedAt);
  page('Trips & reports', trips.length ? trips.map(tripCard).join('') : '<div class="banner info">No trips yet.</div>', { kicker: `${trips.length} trip(s) on this phone` });
});

/* ------------------------------------------------------------------ trip overview */
route('/trip/:id', async id => {
  const t = await getTrip(id); if (!t) return go('#/');
  const st = stepStatus(t), open = unlocked(t);
  const incs = (await DB.all('incidents')).filter(x => x.tripId === t.id);
  const dest = t.budget.stops.filter(Boolean).slice(-1)[0];
  page(dest ? `${startTown(t)} → ${dest}` : 'Trip report', `
    ${STEPS.map(([l], i) => { const lock = i >= 2 && !open; return `<button class="stepcard ${lock ? 'lock' : st[i].state}" onclick="go('#/trip/${t.id}/${i + 1}')"><span class="num">${lock ? ICON.lock.replace('<svg', '<svg width="20" height="20"') : st[i].state === 'done' ? '✓' : i + 1}</span>
      <span><b>${l}</b><span class="s">${lock ? 'Locked — complete the pre-trip inspection first' : st[i].state === 'done' ? 'Complete' : st[i].miss.slice(0, 2).join(' · ') + (st[i].miss.length > 2 ? ` · +${st[i].miss.length - 2} more` : '')}</span></span>
      <span class="st">${lock ? '' : st[i].state === 'done' ? '<span class="chip ok">Done</span>' : i < 2 ? '<span class="chip bad">Required</span>' : st[i].state === 'part' ? '<span class="chip pending">Partly</span>' : '<span class="chip">To do</span>'}</span></button>`; }).join('')}
    <div class="card"><div class="between"><b style="font:700 18px var(--serif)">Incidents on this trip</b><span class="pill">${incs.length}</span></div>
      ${incs.map(x => `<div class="small" style="margin-top:8px"><a href="#/incident/${x.id}">${esc(x.type || 'Incident')} · ${fmtDT(x.at)}</a></div>`).join('')}
      <button class="btn redo sm" style="margin-top:12px" onclick="go('#/incident/new?trip=${t.id}')">${ICON.alert} Report incident on this trip</button></div>
    <button class="btn black" id="gen" style="margin-top:6px">${ICON.doc} ${t.status === 'completed' ? 'Re-generate report' : 'Generate trip report'}</button>
    <div style="height:10px"></div><button class="btn ghost" id="del">${ICON.trash} Delete this trip</button>`, { back: '#/', kicker: tripRef(t) });
  $('#gen').onclick = () => generate(t);
  $('#del').onclick = async () => { if (await confirmBox('Delete trip?', '<p>All photos and data of this trip are removed from the phone. Reports already shared are not affected.</p>', 'Delete', 'red')) { await deleteTrip(t); CUR = null; go('#/'); } };
});
function stepNav(t, n, nextLabel) {
  return `<div class="grid2" style="margin-top:16px"><button class="btn ghost" onclick="go('${n > 1 ? `#/trip/${t.id}/${n - 1}` : `#/trip/${t.id}`}')">Back</button>
    <button class="btn gold" id="next">${nextLabel || (n < 5 ? 'Save & next' : 'Finish')}</button></div>
    <button class="btn ghost" style="margin-top:10px" onclick="go('#/trip/${t.id}')">All steps</button>`;
}
const stepBar = n => `<div class="steps">${[1, 2, 3, 4, 5].map(i => `<i class="${i < n ? 'done' : i === n ? 'on' : ''}"></i>`).join('')}</div>`;
const stepOpts = (t, n) => ({ back: `#/trip/${t.id}`, kicker: `${tripRef(t)} · step ${n} of 5` });

/* ------------------------------------------------------------------ step 1: vehicle & driver */
route('/trip/:id/1', async id => {
  const t = await getTrip(id); if (!t) return go('#/');
  const [vs, ds] = await Promise.all([DB.all('vehicles'), DB.all('drivers')]);
  vs.sort((a, b) => a.name.localeCompare(b.name)); ds.sort((a, b) => a.name.localeCompare(b.name));
  const today = dayKey(new Date());
  page('Vehicle & driver', `${stepBar(1)}<h2 style="margin-top:4px">Vehicle</h2>
    ${vs.length ? `<div class="pick">${vs.map(v => `<button class="opt ${t.vehicleId === v.id ? 'on' : ''}" data-veh="${v.id}">${ICON.car.replace('<svg', '<svg width="34" height="34"')}<div class="grow"><b>${esc(v.name)}</b> <span class="muted">${esc(v.reg)}</span><div class="muted">${esc(v.make || '')} · ${esc(v.fuel)} · ${v.cons || '?'} l/100 km${v.odo ? ' · last ' + kmF(v.odo) : ''}</div></div></button>`).join('')}</div>` : '<div class="banner warn">No vehicles yet.</div>'}
    <button class="btn ghost sm" style="margin-top:10px" onclick="go('#/vehicle/new?ret=${t.id}')">${ICON.plus} Add vehicle</button>
    <h2>Driver</h2>
    ${ds.length ? `<div class="pick">${ds.map(d => { const exp = (d.licExpiry || ''); return `<button class="opt ${t.driverId === d.id ? 'on' : ''}" data-drv="${d.id}">${ICON.user.replace('<svg', '<svg width="34" height="34"')}<div class="grow"><b>${esc(d.name)}</b>${d.empNo ? ` <span class="muted">${esc(d.empNo)}</span>` : ''}<div class="muted">Licence ${esc(d.licNo || '—')}${d.licCode ? ' · code ' + esc(d.licCode) : ''}${exp ? ` · exp. ${fmtD(exp)}` : ''}</div>${exp && exp < today ? '<span class="chip bad" style="margin-top:4px">Licence expired</span>' : ''}</div></button>`; }).join('')}</div>` : '<div class="banner warn">No drivers yet.</div>'}
    <button class="btn ghost sm" style="margin-top:10px" onclick="go('#/driver/new?ret=${t.id}')">${ICON.plus} Add driver</button>
    ${stepNav(t, 1)}`, stepOpts(t, 1));
  $$('[data-veh]').forEach(b => b.onclick = async () => { const v = vs.find(x => x.id === b.dataset.veh); t.vehicleId = v.id; t.vehicle = { ...v }; t.budget.cons = ''; t.budget.price = ''; $$('[data-veh]').forEach(x => x.classList.toggle('on', x === b)); await saveTrip(t); });
  $$('[data-drv]').forEach(b => b.onclick = async () => { const d = ds.find(x => x.id === b.dataset.drv); t.driverId = d.id; t.driver = { ...d }; $$('[data-drv]').forEach(x => x.classList.toggle('on', x === b)); await saveTrip(t); });
  $('#next').onclick = () => { if (!t.vehicleId || !t.driverId) return toast(!t.vehicleId ? 'Select the vehicle first' : 'Select the driver first'); go(`#/trip/${t.id}/2`); };
});

/* ------------------------------------------------------------------ step 2: pre-trip inspection (all items required) */
route('/trip/:id/2', async id => {
  const t = await getTrip(id); if (!t) return go('#/');
  if (gateMissing(t).s1.length) return lockedPage(t, 2);
  const u = {}; for (const s of ['insp_front', 'insp_driver', 'insp_back', 'insp_passenger', 'insp_disk', 'insp_odo']) u[s] = await photoURL(t.id, s);
  const exp = t.insp.diskExpiry, valid = exp && exp >= dayKey(new Date());
  const lastOdo = t.vehicle && t.vehicle.odo;
  const P = t.photos, sideDone = SIDES.every(([k]) => P['insp_' + k]);
  const sn = (n, ok) => `<span class="secnum ${ok ? 'ok' : ''}">${ok ? '✓' : n}</span>`;
  page('Pre-trip inspection', `${stepBar(2)}
    <p class="sub">All items are required before the trip can continue.</p>
    <h2 style="margin-top:4px">${sn('1–4', sideDone)}Vehicle walk-around</h2><p class="sub" style="font-size:14px">In this order: front, driver side, back, passenger side. Tap a tile for the camera, or <span style="display:inline-block;width:18px;vertical-align:-3px">${ICON.image}</span> for the gallery.</p>
    <div class="photo4">${SIDES.map(([k, , s], i) => miniShot('insp_' + k, s, u['insp_' + k], i + 1)).join('')}</div>
    <h2>${sn(5, P.insp_disk && exp)}Licence disc</h2>${bigShot('insp_disk', 'Licence disc photo', 'Close-up of the windscreen disc — the expiry date is read automatically', u.insp_disk)}
    <div class="card" style="margin-top:10px"><div id="discOcr" class="ocrnote">${t.insp.diskOcrState === 'found' ? '<span class="chip ok">Read from the disc — please confirm</span>' : t.insp.diskOcrState === 'none' ? '<span class="chip pending">Date not readable — enter it</span>' : ''}</div>
      <label class="f" style="margin:8px 0 0"><span>Licence disc expiry date</span><input id="dexp" type="date" value="${esc(exp)}"></label>
      <div style="margin-top:8px">${exp ? `<span class="chip ${valid ? 'ok' : 'bad'}">${valid ? 'Valid' : 'EXPIRED — report to your manager'}</span>` : '<span class="chip">Not set</span>'}</div></div>
    <h2>${sn(6, P.insp_odo && num(t.insp.odo) != null)}Odometer reading</h2>${bigShot('insp_odo', 'Odometer photo', 'Dashboard with the reading clearly visible', u.insp_odo)}
    <div class="card" style="margin-top:10px"><div id="odoOcr" class="ocrnote">${t.insp.odoOcrState === 'found' ? `<span class="chip ok">Read: ${kmF(t.insp.odoOcr)} — please confirm</span>` : t.insp.odoOcrState === 'none' ? '<span class="chip pending">Not readable — type the reading</span>' : ''}</div>
      <label class="f" style="margin:8px 0 0"><span>Start odometer (km)</span><input id="odo" class="big-num" inputmode="numeric" value="${esc(t.insp.odo)}" placeholder="${lastOdo ? 'last ' + lastOdo : ''}"></label>
      ${lastOdo ? `<p class="tiny muted" style="margin:6px 0 0">Last recorded for this vehicle: ${kmF(lastOdo)}</p>` : ''}</div>
    <h2>${sn(7, t.gps.insp)}Location</h2>${gpsBox('insp', t.gps.insp, 'Inspection location')}
    ${stepNav(t, 2)}`, stepOpts(t, 2));
  bindGPS(t); autoGPS(t, 'insp');
  bindSlots(t, async (slot, blob) => {
    if (slot === 'insp_disk') {
      toast('Reading licence disc…', 4000);
      try { const r = await ocrDisc(blob); t.insp.diskOcr = r.text.slice(0, 1500); if (r.expiry) { t.insp.diskExpiry = r.expiry; t.insp.diskOcrState = 'found'; } else t.insp.diskOcrState = 'none'; }
      catch (e) { console.warn(e); t.insp.diskOcrState = 'none'; }
      await saveTrip(t);
    }
    if (slot === 'insp_odo') {
      toast('Reading odometer…', 4000);
      try { const r = await ocrOdo(blob, lastOdo); if (r.value) { t.insp.odoOcr = r.value; t.insp.odoOcrState = 'found'; if (!num(t.insp.odo)) t.insp.odo = String(r.value); } else t.insp.odoOcrState = 'none'; }
      catch (e) { console.warn(e); t.insp.odoOcrState = 'none'; }
      await saveTrip(t);
    }
  });
  $('#dexp').onchange = async () => { t.insp.diskExpiry = $('#dexp').value; await saveTrip(t); render(true); };
  $('#odo').oninput = () => { t.insp.odo = $('#odo').value; saveTrip(t, true); };
  $('#next').onclick = async () => {
    await saveTrip(t);
    const miss = gateMissing(t).s2;
    if (miss.length) return modal('Inspection not complete', `<p class="small">Please complete these items before continuing:</p><ul class="miss small">${miss.map(m => `<li>${esc(m)}</li>`).join('')}</ul>`, [{ label: 'OK, complete it', value: 1, cls: 'gold' }]);
    const o = num(t.insp.odo); if (o != null && lastOdo && o < lastOdo - 1 && !(await confirmBox('Check the odometer', `<p>${kmF(o)} is lower than the last recorded ${kmF(lastOdo)} for this vehicle. Continue anyway?</p>`, 'Continue'))) return;
    go(`#/trip/${t.id}/3`);
  };
});

/* ------------------------------------------------------------------ step 3: trip budget */
route('/trip/:id/3', async id => {
  const t = await getTrip(id); if (!t) return go('#/'); await loadSettings();
  if (!unlocked(t)) return lockedPage(t, 3);
  const b = t.budget; const v = t.vehicle || {};
  const opts = cur => `<option value="">Select town…</option>${TOWNS.map(n => `<option ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join('')}`;
  page('Trip budget', `${stepBar(3)}
    <div class="card"><label class="f"><span>Departure</span><input id="dep" type="datetime-local" value="${esc(b.departAt)}"></label>
      <label class="f" style="margin-bottom:0"><span>Purpose of the trip</span><input id="pur" value="${esc(b.purpose)}" placeholder="e.g. Site maintenance at Swakopmund"></label></div>
    <h2>Where to?</h2>
    <div class="card">
      ${b.fromHO ? `<div class="ho">${ICON.building}<div class="grow"><span class="small" style="color:#c9c0ad">Start</span><br><b>${esc(hoLabel())}</b></div></div>` : `<label class="f"><span>Start from</span><select id="from">${opts(b.from)}</select></label>`}
      ${b.stops.map((s, i) => `<div class="row" style="align-items:flex-end;margin-bottom:14px"><label class="f grow" style="margin:0"><span>${i === b.stops.length - 1 ? 'Destination' : 'Stop ' + (i + 1)}</span><select data-stop="${i}">${opts(s)}</select></label>${b.stops.length > 1 ? `<button class="btn ghost sm" data-rm="${i}" aria-label="Remove stop">✕</button>` : ''}</div>`).join('')}
      <button class="btn ghost sm" id="addstop">${ICON.plus} Add a stop</button>
      ${b.round ? `<div class="ho" style="margin:14px 0 0">${ICON.building}<div class="grow"><span class="small" style="color:#c9c0ad">Return — vehicle back to</span><br><b>${esc(b.fromHO ? hoLabel() : b.from || 'start')}</b></div></div>` : ''}
      <div class="toggle" style="margin:14px 0 0">Round trip (return to ${b.fromHO ? 'head office' : 'start'})<input type="checkbox" id="round" ${b.round ? 'checked' : ''}></div>
      <div class="toggle" style="margin:10px 0 0">Trip starts at ${esc(SET.hoName || 'head office')}<input type="checkbox" id="fromho" ${b.fromHO ? 'checked' : ''}></div></div>
    <div class="card" id="dist"></div>
    <div class="card dark" id="est"></div>
    <h2>Fuel money received</h2>
    <div class="card"><label class="f"><span>Total fuel money received (N$)</span><input id="rec" class="big-num" inputmode="decimal" value="${esc(b.received)}" placeholder="0.00"></label>
      <div style="font-weight:600;font-size:14px;margin-bottom:6px">Received as</div>${segHTML('meth', [['Cash', 'Cash'], ['Fuel card', 'Fuel card'], ['EFT', 'EFT / transfer']], b.method)}
      <label class="f" style="margin:14px 0 0"><span>Note (optional)</span><input id="rnote" value="${esc(b.note)}" placeholder="e.g. Issued by finance, voucher no."></label>
      <div id="recCmp" class="small" style="margin-top:10px"></div></div>
    ${stepNav(t, 3)}`, stepOpts(t, 3));
  const recCmp = c => { const rec = num(b.received); $('#recCmp').innerHTML = rec != null ? (rec >= c.cost ? `<span class="chip ok">Covers the estimate (+${nad(rec - c.cost)})</span>` : `<span class="chip pending">${nad(c.cost - rec)} less than the estimate</span>`) : ''; };
  const update = () => {
    const c = budgetCalc(t);
    $('#dist').innerHTML = `<div class="between"><b style="font:700 19px var(--serif)">Trip distance</b><span class="pill">${b.manual ? 'manual' : 'from road network'}</span></div>
      ${c.route && !b.manual ? `<div style="font:700 30px var(--serif);margin:6px 0">${kmF(c.km)}</div><div class="route">${c.route.legs.map((l, i) => `${esc(l.from)} → ${esc(i === c.route.legs.length - 1 && b.round && b.fromHO ? SET.hoName + ', ' + l.to : l.to)}: <b>${kmF(l.km)}</b>`).join('<br>')}<br><span class="tiny">Via ${esc(c.route.path.join(' › '))}</span></div>` : !b.manual ? '<p class="muted small">Select the destination to calculate the distance.</p>' : ''}
      <div class="toggle" style="margin:12px 0 0">Enter distance manually<input type="checkbox" id="man" ${b.manual ? 'checked' : ''}></div>
      ${b.manual ? `<label class="f" style="margin:12px 0 0"><span>Total trip distance (km)</span><input id="kmm" class="big-num" inputmode="numeric" value="${esc(b.kmManual)}"></label>` : ''}`;
    $('#est').innerHTML = `<div class="kicker" style="color:#c9c0ad">Estimated fuel budget</div>
      <div class="between" style="margin-top:6px"><b style="font:700 32px var(--serif);color:var(--gold)">${nad(c.cost)}</b><span>${c.litres} L ${esc(v.fuel || 'diesel')}</span></div>
      <div class="muted small" style="margin:6px 0 12px">${kmF(c.km)} × ${c.cons} l/100 km + ${c.buf}% buffer @ ${nad(c.price)}/L</div>
      <div class="grid2"><label class="f" style="margin:0"><span style="color:#c9c0ad">Consumption l/100 km</span><input id="cons" inputmode="decimal" value="${esc(b.cons)}" placeholder="${v.cons || 12}"></label><label class="f" style="margin:0"><span style="color:#c9c0ad">Fuel price N$/L</span><input id="price" inputmode="decimal" value="${esc(b.price)}" placeholder="${(v.fuel === 'petrol' ? SET.petrol : SET.diesel)}"></label></div>`;
    recCmp(c);
    $('#man').onchange = () => { b.manual = $('#man').checked; if (b.manual && !b.kmManual && c.km) b.kmManual = String(c.km); saveTrip(t, true); update(); };
    const kmm = $('#kmm'); if (kmm) kmm.oninput = () => { b.kmManual = kmm.value; saveTrip(t, true); updateEst(); };
    $('#cons').oninput = () => { b.cons = $('#cons').value; saveTrip(t, true); updateEst(); };
    $('#price').oninput = () => { b.price = $('#price').value; saveTrip(t, true); updateEst(); };
  };
  const updateEst = () => { const c = budgetCalc(t); const big = $('#est b'); if (big) big.textContent = nad(c.cost); const sm = $('#est .between span'); if (sm) sm.textContent = `${c.litres} L ${v.fuel || 'diesel'}`; const ln = $('#est .muted'); if (ln) ln.textContent = `${kmF(c.km)} × ${c.cons} l/100 km + ${c.buf}% buffer @ ${nad(c.price)}/L`; recCmp(c); };
  update();
  $('#dep').oninput = () => { b.departAt = $('#dep').value; saveTrip(t, true); };
  $('#pur').oninput = () => { b.purpose = $('#pur').value; saveTrip(t, true); };
  const fr = $('#from'); if (fr) fr.onchange = async () => { b.from = fr.value; await saveTrip(t); render(true); };
  $$('[data-stop]').forEach(s => s.onchange = () => { b.stops[+s.dataset.stop] = s.value; saveTrip(t, true); update(); });
  $$('[data-rm]').forEach(x => x.onclick = async () => { b.stops.splice(+x.dataset.rm, 1); await saveTrip(t); render(true); });
  $('#addstop').onclick = async () => { b.stops.push(''); await saveTrip(t); render(true); };
  $('#round').onchange = async () => { b.round = $('#round').checked; await saveTrip(t); render(true); };
  $('#fromho').onchange = async () => { b.fromHO = $('#fromho').checked; if (!b.fromHO && !b.from) b.from = SET.hoTown; await saveTrip(t); render(true); };
  $('#rec').oninput = () => { b.received = $('#rec').value; saveTrip(t, true); updateEst(); };
  bindSeg('#meth', x => { b.method = x; saveTrip(t, true); });
  $('#rnote').oninput = () => { b.note = $('#rnote').value; saveTrip(t, true); };
  $('#next').onclick = async () => { await saveTrip(t); go(`#/trip/${t.id}/4`); };
});

/* ------------------------------------------------------------------ step 4: refuelling */
function moneyHTML(t) {
  const m = moneyCalc(t);
  return `<div class="kicker" style="color:#c9c0ad">Fuel money</div><div class="money" style="margin-top:8px">
    <div class="m"><span>Received</span><b>${nad(m.received)}</b></div><div class="m"><span>Spent on fuel</span><b>${nad(m.spent)}</b></div>
    ${m.due > 0 ? `<div class="m due" style="grid-column:1/-1"><span>Total due to driver (own money used)</span><b>${nad(m.due)}</b></div>` : `<div class="m ok" style="grid-column:1/-1"><span>Remaining fuel money</span><b>${nad(m.remaining)}</b></div>`}</div>
    ${m.received ? `<div class="meter dark ${m.spent > m.received ? 'over' : ''}" style="margin-top:10px"><i style="width:${Math.min(100, Math.round(100 * m.spent / m.received))}%"></i></div>` : '<p class="small" style="color:#ffb4ab;margin:8px 0 0">No fuel money entered in step 3 — every refuel counts as due to the driver.</p>'}`;
}
route('/trip/:id/4', async id => {
  const t = await getTrip(id); if (!t) return go('#/');
  if (!unlocked(t)) return lockedPage(t, 4);
  if (!t.refuels.length) t.refuels.push({ id: uid(), at: localInput(new Date()), amount: '', litres: '', odo: '', station: '' });
  const blocks = [];
  for (const [i, r] of t.refuels.entries()) {
    const u = { receipt: await photoURL(t.id, `rf_${r.id}_receipt`), pump: await photoURL(t.id, `rf_${r.id}_pump`), odo: await photoURL(t.id, `rf_${r.id}_odo`) };
    const ppl = num(r.amount) && num(r.litres) ? num(r.amount) / num(r.litres) : null;
    blocks.push(`<div class="block" data-rf="${r.id}"><div class="bh"><b>${ICON.fuel.replace('<svg', '<svg width="22" height="22" style="vertical-align:-4px"')} Refuel ${i + 1}</b>${t.refuels.length > 1 ? `<button class="btn ghost sm" data-delrf="${r.id}">${ICON.trash}</button>` : ''}</div>
      <label class="f"><span>Refuel cost (N$)</span><input class="big-num" data-f="amount" inputmode="decimal" value="${esc(r.amount)}" placeholder="0.00"></label>
      <div class="grid2"><label class="f"><span>Litres</span><input data-f="litres" inputmode="decimal" value="${esc(r.litres)}"></label><label class="f"><span>Odometer (km)</span><input data-f="odo" inputmode="numeric" value="${esc(r.odo)}"></label></div>
      <label class="f"><span>Fuel station / town</span><input data-f="station" list="towns" value="${esc(r.station)}" placeholder="e.g. Engen Karibib"></label><label class="f"><span>Date & time</span><input data-f="at" type="datetime-local" value="${esc(r.at)}"></label>
      ${ppl ? `<p class="small muted" style="margin:-6px 0 10px">${nad(ppl)} per litre</p>` : ''}
      <div class="photo3">${miniShot(`rf_${r.id}_receipt`, 'Receipt', u.receipt)}${miniShot(`rf_${r.id}_pump`, 'Pump display', u.pump)}${miniShot(`rf_${r.id}_odo`, 'Odometer', u.odo)}</div>
      ${gpsBox('rf_' + r.id, t.gps['rf_' + r.id], 'Fuel stop location')}</div>`);
  }
  page('Refuelling', `${stepBar(4)}<div class="card dark" id="money">${moneyHTML(t)}</div>
    <datalist id="towns">${TOWNS.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    ${blocks.join('')}
    <button class="btn black" id="addrf">${ICON.plus} Add another refuel</button>
    ${stepNav(t, 4)}`, stepOpts(t, 4));
  bindGPS(t);
  $$('[data-rf]').forEach(el => {
    const r = t.refuels.find(x => x.id === el.dataset.rf);
    $$('[data-f]', el).forEach(inp => inp.oninput = () => { r[inp.dataset.f] = inp.value; saveTrip(t, true); $('#money').innerHTML = moneyHTML(t); });
  });
  bindSlots(t, async (slot, blob) => {
    const m = slot.match(/^rf_(.+)_(receipt|pump|odo)$/); if (!m) return;
    if (!t.gps['rf_' + m[1]]) { try { t.gps['rf_' + m[1]] = await getGPS(15000); await saveTrip(t); } catch (e) { toast(e.message, 4000); } }
    if (m[2] !== 'odo') return;
    const r = t.refuels.find(x => x.id === m[1]); if (!r || num(r.odo)) return;
    toast('Reading odometer…', 3000);
    try { const res = await ocrOdo(blob, num(t.insp.odo) || (t.vehicle && t.vehicle.odo)); if (res.value) { r.odo = String(res.value); await saveTrip(t); toast(`Odometer read: ${kmF(res.value)} — please check`); } } catch (e) { console.warn(e); }
  });
  $$('[data-delrf]').forEach(b => b.onclick = async () => {
    if (!(await confirmBox('Remove this refuel?', '<p>Its amounts, photos and location are deleted.</p>', 'Remove', 'red'))) return;
    const id2 = b.dataset.delrf; for (const s of ['receipt', 'pump', 'odo']) { await delPhoto(t.id, `rf_${id2}_${s}`); delete t.photos[`rf_${id2}_${s}`]; }
    delete t.gps['rf_' + id2]; t.refuels = t.refuels.filter(x => x.id !== id2); await saveTrip(t); render(true);
  });
  $('#addrf').onclick = async () => { const r = { id: uid(), at: localInput(new Date()), amount: '', litres: '', odo: '', station: '' }; t.refuels.push(r); await saveTrip(t); await render(true); const last = $$('.block').pop(); if (last) last.scrollIntoView({ behavior: 'smooth', block: 'start' }); captureGPS(t, 'rf_' + r.id, saveTrip, true); };
  $('#next').onclick = async () => {
    // drop a completely empty block so it is not reported as skipped
    t.refuels = t.refuels.filter(r => num(r.amount) != null || ['receipt', 'pump', 'odo'].some(s => t.photos[`rf_${r.id}_${s}`]) || t.refuels.length === 1);
    await saveTrip(t); go(`#/trip/${t.id}/5`);
  };
});

/* ------------------------------------------------------------------ step 5: trip end */
function hoHTML(t) {
  if (!returnsToHO(t)) return '';
  const h = hoCheck(t);
  if (!h) return `<div class="banner info">Capture the location to confirm the vehicle is back at ${esc(hoLabel())}.</div>`;
  return h.ok ? `<div class="banner ok"><b>Vehicle returned to ${esc(hoLabel())}</b> ✓ <span class="small">(${h.km} km from the ${h.exact ? 'head office point' : 'town centre'})</span></div>`
    : `<div class="banner bad"><b>Not at ${esc(hoLabel())}</b> — ${kmF(h.km)} away.</div>
       <label class="f"><span>Where is the vehicle / why was it not returned?</span><input id="where" value="${esc(t.end.where)}" placeholder="e.g. Left at site, driver's home, workshop"></label>`;
}
route('/trip/:id/5', async id => {
  const t = await getTrip(id); if (!t) return go('#/');
  if (!unlocked(t)) return lockedPage(t, 5);
  if (!t.end.at) { t.end.at = localInput(new Date()); }
  const u = {}; for (const s of ['end_odo', 'end_front', 'end_driver', 'end_back', 'end_passenger']) u[s] = await photoURL(t.id, s);
  const plan = budgetCalc(t);
  page('Trip end', `${stepBar(5)}
    ${returnsToHO(t) ? `<div class="ho">${ICON.building}<div class="grow"><span class="small" style="color:#c9c0ad">Return the vehicle to</span><br><b>${esc(hoLabel())}</b></div></div>` : ''}
    <h2 style="margin-top:4px">Odometer at the end</h2>${bigShot('end_odo', 'Odometer photo', 'Dashboard with the reading clearly visible', u.end_odo)}
    <div class="card" style="margin-top:10px"><div class="ocrnote">${t.end.odoOcrState === 'found' ? `<span class="chip ok">Read: ${kmF(t.end.odoOcr)} — please confirm</span>` : t.end.odoOcrState === 'none' ? '<span class="chip pending">Not readable — type the reading</span>' : ''}</div>
      <label class="f" style="margin:8px 0 0"><span>End odometer (km)</span><input id="odo" class="big-num" inputmode="numeric" value="${esc(t.end.odo)}" placeholder="${t.insp.odo ? '≥ ' + t.insp.odo : ''}"></label>
      <div id="act" style="margin-top:10px"></div></div>
    <h2>Location at trip end</h2>${gpsBox('end', t.gps.end, 'Trip end location')}<div id="hochk">${hoHTML(t)}</div>
    <h2>Vehicle photos after the trip</h2><div class="photo4">${SIDES.map(([k, , s], i) => miniShot('end_' + k, s, u['end_' + k], i + 1)).join('')}</div>
    <div class="card" style="margin-top:14px"><label class="f"><span>Trip ended</span><input id="eat" type="datetime-local" value="${esc(t.end.at)}"></label>
      <label class="f" style="margin:0"><span>Notes (optional)</span><textarea id="notes" placeholder="Vehicle condition, delays, damage, anything to report">${esc(t.end.notes)}</textarea></label></div>
    ${stepNav(t, 5, 'Generate report')}`, stepOpts(t, 5));
  const showAct = () => {
    const a = actualKm(t), s = num(t.insp.odo), e = num(t.end.odo);
    $('#act').innerHTML = s == null ? '<span class="chip pending">Start odometer missing (step 2)</span>' : e == null ? '' : e < s ? '<span class="chip bad">Lower than the start odometer</span>'
      : `<div class="between"><span>Actual trip distance</span><b style="font:700 26px var(--serif)">${kmF(a)}</b></div>${plan.km ? `<div class="small muted">Planned ${kmF(plan.km)} · difference ${a - plan.km >= 0 ? '+' : ''}${kmF(a - plan.km)}</div>` : ''}`;
  };
  const bindWhere = () => { const w = $('#where'); if (w) w.oninput = () => { t.end.where = w.value; saveTrip(t, true); }; };
  showAct(); bindWhere(); bindGPS(t);
  GPS_HOOK = key => { if (key === 'end') { $('#hochk').innerHTML = hoHTML(t); bindWhere(); } };
  autoGPS(t, 'end');
  bindSlots(t, async (slot, blob) => {
    if (slot !== 'end_odo') return; toast('Reading odometer…', 4000);
    try { const r = await ocrOdo(blob, num(t.insp.odo) || (t.vehicle && t.vehicle.odo)); if (r.value) { t.end.odoOcr = r.value; t.end.odoOcrState = 'found'; if (!num(t.end.odo)) t.end.odo = String(r.value); } else t.end.odoOcrState = 'none'; }
    catch (e) { console.warn(e); t.end.odoOcrState = 'none'; }
    await saveTrip(t);
  });
  $('#odo').oninput = () => { t.end.odo = $('#odo').value; saveTrip(t, true); showAct(); };
  $('#eat').oninput = () => { t.end.at = $('#eat').value; saveTrip(t, true); };
  $('#notes').oninput = () => { t.end.notes = $('#notes').value; saveTrip(t, true); };
  $('#next').onclick = async () => { await saveTrip(t); generate(t); };
});

/* ------------------------------------------------------------------ generate (inspection gate + skipped-step check) */
async function generate(t) {
  await saveTrip(t);
  if (!unlocked(t)) {
    const g = gateMissing(t);
    const go2 = await modal('Pre-trip inspection not complete', `<p class="small">A trip report needs a complete pre-trip inspection. Missing:</p><ul class="miss small">${[...g.s1, ...g.s2].map(m => `<li>${esc(m)}</li>`).join('')}</ul>`, [{ label: 'Complete the inspection', value: true, cls: 'gold' }, { label: 'Cancel', value: false, cls: 'ghost' }]);
    if (go2) go(`#/trip/${t.id}/${g.s1.length ? 1 : 2}`); return;
  }
  const st = stepStatus(t); const miss = st.flatMap((s, i) => s.miss.map(m => [i + 1, m]));
  if (miss.length) {
    const byStep = STEPS.map(([l], i) => [l, miss.filter(m => m[0] === i + 1).map(m => m[1])]).filter(x => x[1].length);
    const ok = await modal('Some steps were skipped', `<p class="small">The report can still be created, but these items are missing and will be marked as <b>not captured</b>:</p>
      ${byStep.map(([l, ms]) => `<p style="margin:10px 0 4px"><b>${esc(l)}</b></p><ul class="miss small">${ms.map(m => `<li>${esc(m)}</li>`).join('')}</ul>`).join('')}`,
      [{ label: 'Generate report anyway', value: true, cls: 'gold', icon: 'doc' }, { label: 'Cancel', value: false, cls: 'ghost' }]);
    if (!ok) return;
  }
  const wait = document.createElement('div'); wait.className = 'modal'; wait.innerHTML = '<div class="box"><h3>Creating report…</h3><div class="spinner"></div><p class="muted small" style="text-align:center">Adding photos and calculations</p></div>'; document.body.appendChild(wait);
  let r;
  try { const incs = (await DB.all('incidents')).filter(x => x.tripId === t.id).sort((a, b) => String(a.at).localeCompare(String(b.at))); r = await buildReport(t, miss.map(m => `Step ${m[0]}: ${m[1]}`), incs); }
  catch (e) { wait.remove(); console.error(e); toast('Report failed: ' + e.message, 6000); return; }
  wait.remove();
  t.status = 'completed'; t.completedAt = Date.now(); await saveTrip(t);
  if (t.vehicleId) { const v = await DB.get('vehicles', t.vehicleId); if (v) { if (num(t.end.odo) > (+v.odo || 0)) v.odo = num(t.end.odo); if (t.insp.diskExpiry) v.diskExpiry = t.insp.diskExpiry; await DB.put('vehicles', v); } }
  downloadPdf(r); // saved to the phone first
  await shareMenu(r);
  render();
}
function downloadPdf(r) { const a = document.createElement('a'); a.href = URL.createObjectURL(r.blob); a.download = r.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); }
async function shareMenu(r) {
  while (true) {
    const pick = await modal('Report ready', `<p class="small">✔ <b>${esc(r.name)}</b> has been saved to your Downloads (${r.pages} page${r.pages > 1 ? 's' : ''}).</p>
      <p class="small muted">Send it with WhatsApp, Gmail, Outlook or Bluetooth — choose the app in the share menu.</p>`,
      [{ label: 'Share — WhatsApp · Gmail · Outlook · Bluetooth', value: 'share', cls: 'gold', icon: 'share' }, { label: 'Download again', value: 'dl', cls: 'black' }, { label: 'View report', value: 'view', cls: 'ghost' }, { label: 'Done', value: null, cls: 'ghost' }]);
    if (pick === 'share') {
      const file = new File([r.blob], r.name, { type: 'application/pdf' });
      try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: r.title, text: r.title }); continue; } } catch (e) { if (e.name === 'AbortError') continue; }
      toast('Sharing is not supported in this browser — open the PDF from Downloads and share it from there.', 6000); continue;
    }
    if (pick === 'dl') { downloadPdf(r); continue; }
    if (pick === 'view') { window.open(URL.createObjectURL(r.blob), '_blank'); continue; }
    return;
  }
}

/* ------------------------------------------------------------------ incidents */
const INC_TYPES = ['Accident / collision', 'Breakdown', 'Tyre puncture / damage', 'Vehicle damage (no collision)', 'Animal strike', 'Theft / break-in', 'Traffic fine / police stop', 'Injury', 'Other'];
const INC_SLOTS = [['p1', 'Scene'], ['p2', 'Damage'], ['p3', 'Damage'], ['p4', 'Other vehicle'], ['p5', 'Documents'], ['p6', 'Extra']];
let INC = null, saveI = null;
async function saveInc(x, debounce) { x.updatedAt = Date.now(); if (debounce) { clearTimeout(saveI); saveI = setTimeout(() => DB.put("incidents", x), 300); } else { clearTimeout(saveI); await DB.put("incidents", x); } }
async function getInc(id) { if (!(INC && INC.id === id)) INC = await DB.get('incidents', id); if (INC) { INC.gps = INC.gps || {}; INC.photos = INC.photos || {}; } return INC; }
const incReady = x => [x.type ? null : 'Type of incident', (x.description || '').trim() ? null : 'What happened', x.gps.here ? null : 'GPS location'].filter(Boolean);
function incCard(x) {
  return `<button class="stepcard" onclick="go('#/incident/${x.id}')"><span class="num" style="background:#fbe4e2">${ICON.alert.replace('<svg', '<svg width="26" height="26"')}</span>
    <span><b>${esc(x.type || 'Incident (draft)')}</b><span class="s">${esc(x.vehicle ? x.vehicle.name + ' · ' + x.vehicle.reg : 'no vehicle')} · ${esc(x.driver ? x.driver.name : 'no driver')}<br>${incRef(x)} · ${fmtDT(x.at)}</span></span>
    <span class="st">${x.reportedAt ? '<span class="chip completed">Report</span>' : '<span class="chip pending">Draft</span>'}</span></button>`;
}
route('/incidents', async () => {
  const xs = (await DB.all('incidents')).sort((a, b) => b.updatedAt - a.updatedAt);
  page('Incidents', `<p class="sub">Accident, breakdown, damage, fine or anything else that happened with a vehicle. Capture it on the spot — photos, location and details — and send the incident report.</p>
    <button class="btn red" onclick="go('#/incident/new')" style="min-height:66px;font-size:20px">${ICON.alert.replace('fill="#d93025" stroke="#d93025"', 'fill="#fff" stroke="#fff"').replace('stroke="#fff" stroke-width="2.5"', 'stroke="#b3261e" stroke-width="2.5"').replace('r="1.35" fill="#fff"', 'r="1.35" fill="#b3261e"')} Report new incident</button>
    ${xs.length ? `<h2>Reported incidents</h2>${xs.map(incCard).join('')}` : ''}
    <div class="banner info" style="margin-top:14px"><b>In an emergency</b> first make the scene safe and call for help: Police <a href="tel:10111">10111</a> · Ambulance <a href="tel:+26461211111">061 211 111</a> (City of Windhoek emergency).</div>`, { kicker: 'Incident reports' });
});
route('/incident/:id', async id => {
  await loadSettings();
  if (id.startsWith('new')) {
    const m = location.hash.match(/\?trip=([\w]+)/); const trips = await DB.all('trips');
    const trip = m ? trips.find(x => x.id === m[1]) : trips.filter(x => x.status !== 'completed').sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const x = { id: uid(), createdAt: Date.now(), updatedAt: Date.now(), at: localInput(new Date()), tripId: trip ? trip.id : '', vehicleId: trip ? trip.vehicleId : '', vehicle: trip ? trip.vehicle : null, driverId: trip ? trip.driverId : '', driver: trip ? trip.driver : null,
      type: '', description: '', place: '', odo: '', injuries: 'no', injuryDetails: '', police: 'no', caseNo: '', policeStation: '', third: { name: '', phone: '', reg: '', insurer: '' }, drivable: 'yes', photos: {}, gps: {} };
    await DB.put('incidents', x); INC = x; history.replaceState(null, '', `#/incident/${x.id}`); render(); return;
  }
  const x = await getInc(id); if (!x) return go('#/incidents');
  const [vs, ds, trips] = await Promise.all([DB.all('vehicles'), DB.all('drivers'), DB.all('trips')]);
  const u = {}; for (const [s] of INC_SLOTS) u[s] = await photoURL(x.id, s);
  const tripOpts = trips.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
  const yn = (k, v) => segHTML(k, [['no', 'No'], ['yes', 'Yes']], v);
  page('Incident report', `
    <div class="card"><label class="f"><span>Type of incident</span><select id="i_type"><option value="">Select…</option>${INC_TYPES.map(o => `<option ${o === x.type ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
      <label class="f"><span>Date & time</span><input id="i_at" type="datetime-local" value="${esc(x.at)}"></label>
      <label class="f" style="margin:0"><span>What happened?</span><textarea id="i_desc" placeholder="Describe what happened, the damage and what was done">${esc(x.description)}</textarea></label></div>
    <h2>Location</h2>${gpsBox('here', x.gps.here, 'Incident location')}
    <label class="f"><span>Place / road (optional)</span><input id="i_place" value="${esc(x.place)}" placeholder="e.g. B2, 20 km after Karibib" list="towns"></label>
    <datalist id="towns">${TOWNS.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <h2>Photos</h2><div class="photo3">${INC_SLOTS.map(([s, l]) => miniShot(s, l, u[s])).join('')}</div>
    <h2>Vehicle & driver</h2>
    <div class="card"><label class="f"><span>Trip</span><select id="i_trip"><option value="">Not linked to a trip</option>${tripOpts.map(t => `<option value="${t.id}" ${t.id === x.tripId ? 'selected' : ''}>${esc(tripRef(t))} · ${esc(t.budget.stops.filter(Boolean).slice(-1)[0] || 'trip')} · ${esc(t.vehicle ? t.vehicle.reg : '')}</option>`).join('')}</select></label>
      <label class="f"><span>Vehicle</span><select id="i_veh"><option value="">Select…</option>${vs.map(v => `<option value="${v.id}" ${v.id === x.vehicleId ? 'selected' : ''}>${esc(v.name)} · ${esc(v.reg)}</option>`).join('')}</select></label>
      <label class="f"><span>Driver</span><select id="i_drv"><option value="">Select…</option>${ds.map(d => `<option value="${d.id}" ${d.id === x.driverId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
      <div class="grid2"><label class="f" style="margin:0"><span>Odometer (km)</span><input id="i_odo" inputmode="numeric" value="${esc(x.odo)}"></label><div><div style="font-weight:600;font-size:14px;margin-bottom:6px">Vehicle drivable?</div>${segHTML('i_drivable', [['yes', 'Yes'], ['no', 'No']], x.drivable)}</div></div></div>
    <h2>Injuries & police</h2>
    <div class="card"><div style="font-weight:600;font-size:14px;margin-bottom:6px">Anyone injured?</div>${yn('i_inj', x.injuries)}
      ${x.injuries === 'yes' ? `<label class="f" style="margin:12px 0 0"><span>Who and how?</span><input id="i_injd" value="${esc(x.injuryDetails)}"></label>` : ''}
      <div style="font-weight:600;font-size:14px;margin:14px 0 6px">Reported to the police?</div>${yn('i_pol', x.police)}
      ${x.police === 'yes' ? `<div class="grid2" style="margin-top:12px"><label class="f" style="margin:0"><span>Case / CR no.</span><input id="i_case" value="${esc(x.caseNo)}"></label><label class="f" style="margin:0"><span>Police station</span><input id="i_ps" value="${esc(x.policeStation)}"></label></div>` : ''}</div>
    <h2>Other party (if any)</h2>
    <div class="card"><div class="grid2"><label class="f"><span>Name</span><input id="t_name" value="${esc(x.third.name)}"></label><label class="f"><span>Cell</span><input id="t_phone" type="tel" value="${esc(x.third.phone)}"></label></div>
      <div class="grid2"><label class="f" style="margin:0"><span>Vehicle reg.</span><input id="t_reg" value="${esc(x.third.reg)}"></label><label class="f" style="margin:0"><span>Insurer</span><input id="t_ins" value="${esc(x.third.insurer)}"></label></div></div>
    <button class="btn red" id="i_pdf" style="margin-top:6px">${ICON.doc} Generate incident report</button>
    <div style="height:10px"></div><button class="btn ghost" id="i_del">${ICON.trash} Delete incident</button>`, { back: '#/incidents', kicker: incRef(x) });
  bindGPS(x, saveInc); autoGPS(x, 'here', saveInc);
  bindSlots(x, null, saveInc);
  const f = (sel, key, obj = x) => { const el = $(sel); if (el) el.oninput = () => { obj[key] = el.value; saveInc(x, true); }; };
  f('#i_at', 'at'); f('#i_desc', 'description'); f('#i_place', 'place'); f('#i_odo', 'odo'); f('#i_injd', 'injuryDetails'); f('#i_case', 'caseNo'); f('#i_ps', 'policeStation');
  f('#t_name', 'name', x.third); f('#t_phone', 'phone', x.third); f('#t_reg', 'reg', x.third); f('#t_ins', 'insurer', x.third);
  $('#i_type').onchange = () => { x.type = $('#i_type').value; saveInc(x); };
  $('#i_veh').onchange = () => { const v = vs.find(z => z.id === $('#i_veh').value); x.vehicleId = v ? v.id : ''; x.vehicle = v ? { ...v } : null; saveInc(x); };
  $('#i_drv').onchange = () => { const d = ds.find(z => z.id === $('#i_drv').value); x.driverId = d ? d.id : ''; x.driver = d ? { ...d } : null; saveInc(x); };
  $('#i_trip').onchange = async () => { const t = trips.find(z => z.id === $('#i_trip').value); x.tripId = t ? t.id : ''; if (t) { x.vehicleId = t.vehicleId; x.vehicle = t.vehicle; x.driverId = t.driverId; x.driver = t.driver; } await saveInc(x); render(true); };
  bindSeg('#i_drivable', v => { x.drivable = v; saveInc(x); });
  bindSeg('#i_inj', async v => { x.injuries = v; await saveInc(x); render(true); });
  bindSeg('#i_pol', async v => { x.police = v; await saveInc(x); render(true); });
  $('#i_del').onclick = async () => { if (await confirmBox('Delete incident?', '<p>The incident, its photos and location are removed from this phone.</p>', 'Delete', 'red')) { await delPhotos(x.id); await DB.del('incidents', x.id); INC = null; go('#/incidents'); } };
  $('#i_pdf').onclick = async () => {
    await saveInc(x);
    const miss = incReady(x);
    if (miss.length && !(await modal('Incident report incomplete', `<p class="small">Missing:</p><ul class="miss small">${miss.map(m => `<li>${esc(m)}</li>`).join('')}</ul>`, [{ label: 'Generate report anyway', value: true, cls: 'gold' }, { label: 'Cancel', value: false, cls: 'ghost' }]))) return;
    const wait = document.createElement('div'); wait.className = 'modal'; wait.innerHTML = '<div class="box"><h3>Creating incident report…</h3><div class="spinner"></div></div>'; document.body.appendChild(wait);
    let r; try { r = await buildIncidentReport(x); } catch (e) { wait.remove(); console.error(e); return toast('Report failed: ' + e.message, 6000); }
    wait.remove(); x.reportedAt = Date.now(); await saveInc(x);
    downloadPdf(r); await shareMenu(r); render(true);
  };
});

/* ------------------------------------------------------------------ settings: vehicles, drivers, fuel, head office, install */
route('/settings', async () => {
  await loadSettings(); const [vs, ds] = await Promise.all([DB.all('vehicles'), DB.all('drivers')]);
  vs.sort((a, b) => a.name.localeCompare(b.name)); ds.sort((a, b) => a.name.localeCompare(b.name));
  let est = ''; try { const e = await navigator.storage.estimate(); est = `${(e.usage / 1048576).toFixed(1)} MB used on this phone`; } catch (e) { }
  page('Settings', `<h2 style="margin-top:4px">Install the app</h2><div class="card">${installHTML()}</div>
    <h2>Vehicles (${vs.length})</h2>
    <div class="card list">${vs.map(v => `<div class="item" onclick="go('#/vehicle/${v.id}')" style="cursor:pointer">${ICON.car.replace('<svg', '<svg width="28" height="28"')}<div class="grow"><b>${esc(v.name)}</b> <span class="muted small">${esc(v.reg)}</span><div class="small muted">${esc(v.fuel)} · ${v.cons || '?'} l/100 km${v.odo ? ' · ' + kmF(v.odo) : ''}</div></div><span class="muted">›</span></div>`).join('') || '<span class="muted">No vehicles yet.</span>'}</div>
    <button class="btn gold" onclick="go('#/vehicle/new')">${ICON.plus} Add vehicle</button>
    <h2>Drivers (${ds.length})</h2>
    <div class="card list">${ds.map(d => `<div class="item" onclick="go('#/driver/${d.id}')" style="cursor:pointer">${ICON.user.replace('<svg', '<svg width="28" height="28"')}<div class="grow"><b>${esc(d.name)}</b><div class="small muted">Licence ${esc(d.licNo || '—')}${d.licExpiry ? ' · exp. ' + fmtD(d.licExpiry) : ''}${d.phone ? ' · ' + esc(d.phone) : ''}</div></div><span class="muted">›</span></div>`).join('') || '<span class="muted">No drivers yet.</span>'}</div>
    <button class="btn gold" onclick="go('#/driver/new')">${ICON.plus} Add driver</button>
    <h2>Head office</h2>
    <div class="card"><p class="small" style="margin-top:0">Trips start here and the vehicle must be returned here. At trip end the app checks the GPS position against this point.</p>
      <div class="grid2"><label class="f"><span>Name</span><input id="s_hoName" value="${esc(SET.hoName)}"></label><label class="f"><span>Town</span><select id="s_hoTown">${TOWNS.map(n => `<option ${n === SET.hoTown ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label></div>
      <div class="gps ${SET.hoSet ? 'has' : ''}">${ICON.building}<div class="grow"><b>${SET.hoSet ? 'Head office location set ✓' : 'Exact location not set'}</b><div class="small muted">${SET.hoSet ? `${(+SET.hoLat).toFixed(5)}, ${(+SET.hoLng).toFixed(5)} · <a href="${mapURL({ lat: SET.hoLat, lng: SET.hoLng })}" target="_blank" rel="noopener">view on map</a>` : `Using ${esc(SET.hoTown)} town centre (±6 km). Stand at the head office and tap “Use my location”.`}</div></div></div>
      <button class="btn black" id="s_hoHere">${ICON.pin} Use my location as head office</button>
      <label class="f" style="margin:14px 0 0"><span>“Returned” radius (km)</span><input id="s_hoRadius" inputmode="decimal" value="${SET.hoRadius}"></label></div>
    <h2>Fuel & report</h2>
    <div class="card"><div class="grid2"><label class="f"><span>Diesel N$/L</span><input id="s_diesel" inputmode="decimal" value="${SET.diesel}"></label><label class="f"><span>Petrol N$/L</span><input id="s_petrol" inputmode="decimal" value="${SET.petrol}"></label></div>
      <label class="f"><span>Budget buffer %</span><input id="s_buffer" inputmode="numeric" value="${SET.buffer}"></label>
      <label class="f"><span>Company name (on reports)</span><input id="s_company" value="${esc(SET.company)}"></label>
      <button class="btn black" id="sv">Save</button></div>
    <h2>Backup</h2>
    <div class="card"><p class="small" style="margin-top:0">Vehicles, drivers, trips and incidents live only on this phone. Export a backup to move them to a new phone. ${esc(est)}</p>
      <div class="stack"><button class="btn ghost" id="exp">Export backup (without photos)</button><label class="btn ghost">Import backup<input type="file" id="imp" accept=".json,application/json" hidden></label></div></div>
    <p class="tiny muted" style="text-align:center">Trip Inspector DRIVER · Trip Report v${APP_VERSION}</p>`, { kicker: 'Install, vehicles, drivers & fuel' });
  bindInstall();
  const readHO = () => { SET.hoName = $('#s_hoName').value.trim() || 'Head Office'; SET.hoTown = $('#s_hoTown').value; SET.hoRadius = num($('#s_hoRadius').value) || 1; };
  $('#s_hoName').onchange = $('#s_hoTown').onchange = $('#s_hoRadius').onchange = async () => { readHO(); await saveSettings(); toast('Head office saved'); };
  $('#s_hoHere').onclick = async () => {
    const b = $('#s_hoHere'); b.disabled = true; b.textContent = 'Locating…';
    try { const g = await getGPS(); readHO(); SET.hoLat = g.lat; SET.hoLng = g.lng; SET.hoSet = true; await saveSettings(); toast(`Head office location saved (±${g.acc} m)`); } catch (e) { toast(e.message, 5000); }
    render(true);
  };
  $('#sv').onclick = async () => { SET.diesel = num($('#s_diesel').value) || 0; SET.petrol = num($('#s_petrol').value) || 0; SET.buffer = num($('#s_buffer').value) || 0; SET.company = $('#s_company').value.trim(); readHO(); await saveSettings(); toast('Saved'); };
  $('#exp').onclick = async () => {
    const data = { app: 'ti-trip-report', version: APP_VERSION, at: new Date().toISOString(), settings: SET, vehicles: await DB.all('vehicles'), drivers: await DB.all('drivers'), trips: await DB.all('trips'), incidents: await DB.all('incidents') };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' }); const name = `TripReport_backup_${dayKey(new Date())}.json`; const f = new File([blob], name, { type: 'application/json' });
    try { if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: name }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  };
  $('#imp').onchange = async e => {
    try { const d = JSON.parse(await e.target.files[0].text()); if (d.app !== 'ti-trip-report') throw new Error('Not a Trip Report backup');
      for (const v of d.vehicles || []) await DB.put('vehicles', v); for (const x of d.drivers || []) await DB.put('drivers', x); for (const t of d.trips || []) await DB.put('trips', t); for (const x of d.incidents || []) await DB.put('incidents', x);
      if (d.settings) { SET = { ...DEFAULT_SETTINGS, ...d.settings }; await saveSettings(); } toast('Backup imported'); render(); } catch (err) { toast('Import failed: ' + err.message); }
  };
});
function retTarget() { const m = location.hash.match(/\?ret=([\w]+)/); return m ? `#/trip/${m[1]}/1` : '#/settings'; }
route('/vehicle/:id', async id => {
  const isNew = id.startsWith('new'); const v = isNew ? { fuel: 'diesel' } : await DB.get('vehicles', id); if (!v) return go('#/settings');
  const f = (k, l, x = '') => `<label class="f"><span>${l}</span><input id="v_${k}" value="${esc(v[k] ?? '')}" ${x}></label>`;
  page(isNew ? 'Add vehicle' : v.name, `<div class="card">${f('name', 'Name (e.g. Hilux 1)')}${f('reg', 'Registration number')}${f('make', 'Make & model')}
      <div style="font-weight:600;font-size:14px;margin-bottom:6px">Fuel type</div>${segHTML('fuel', [['diesel', 'Diesel'], ['petrol', 'Petrol']], v.fuel)}<div style="height:14px"></div>
      <div class="grid2">${f('cons', 'Consumption (l/100 km)', 'inputmode="decimal"')}${f('tank', 'Tank size (L)', 'inputmode="numeric"')}</div>
      ${f('odo', 'Current odometer (km)', 'inputmode="numeric"')}<label class="f"><span>Licence disc expiry</span><input id="v_diskExpiry" type="date" value="${esc(v.diskExpiry || '')}"></label></div>
    <button class="btn gold" id="sv">Save vehicle</button>${isNew ? '' : `<div style="height:10px"></div><button class="btn ghost" id="del">${ICON.trash} Delete vehicle</button>`}`, { back: retTarget(), kicker: 'Settings · vehicle' });
  let fuel = v.fuel; bindSeg('#fuel', x => fuel = x);
  $('#sv').onclick = async () => {
    const d = { ...v, id: isNew ? uid() : v.id, name: $('#v_name').value.trim(), reg: $('#v_reg').value.trim(), make: $('#v_make').value.trim(), fuel, cons: num($('#v_cons').value), tank: num($('#v_tank').value), odo: num($('#v_odo').value), diskExpiry: $('#v_diskExpiry').value };
    if (!d.name || !d.reg) return toast('Name and registration are required'); await DB.put('vehicles', d); toast('Vehicle saved');
    const ret = retTarget(); if (ret.startsWith('#/trip/')) { const t = await getTrip(ret.split('/')[2]); if (t && !t.vehicleId) { t.vehicleId = d.id; t.vehicle = { ...d }; await saveTrip(t); } } go(ret);
  };
  const del = $('#del'); if (del) del.onclick = async () => { if (await confirmBox('Delete vehicle?', '<p>Existing trips keep their copy of the vehicle details.</p>', 'Delete', 'red')) { await DB.del('vehicles', v.id); go('#/settings'); } };
});
route('/driver/:id', async id => {
  const isNew = id.startsWith('new'); const d = isNew ? {} : await DB.get('drivers', id); if (!d) return go('#/settings');
  const f = (k, l, x = '') => `<label class="f"><span>${l}</span><input id="d_${k}" value="${esc(d[k] ?? '')}" ${x}></label>`;
  page(isNew ? 'Add driver' : d.name, `<div class="card">${f('name', 'Full name')}${f('empNo', 'Employee no.')}${f('idNo', 'ID number')}${f('phone', 'Cell number', 'type="tel"')}
      ${f('licNo', "Driver's licence no.")}<div class="grid2">${f('licCode', 'Licence code (e.g. B, EB)')}<label class="f"><span>Licence expiry</span><input id="d_licExpiry" type="date" value="${esc(d.licExpiry || '')}"></label></div>
      <label class="f" style="margin:0"><span>PrDP / notes</span><input id="d_notes" value="${esc(d.notes || '')}"></label></div>
    <button class="btn gold" id="sv">Save driver</button>${isNew ? '' : `<div style="height:10px"></div><button class="btn ghost" id="del">${ICON.trash} Delete driver</button>`}`, { back: retTarget(), kicker: 'Settings · driver' });
  $('#sv').onclick = async () => {
    const x = { ...d, id: isNew ? uid() : d.id }; ['name', 'empNo', 'idNo', 'phone', 'licNo', 'licCode', 'licExpiry', 'notes'].forEach(k => x[k] = $('#d_' + k).value.trim());
    if (!x.name) return toast('Name is required'); await DB.put('drivers', x); toast('Driver saved');
    const ret = retTarget(); if (ret.startsWith('#/trip/')) { const t = await getTrip(ret.split('/')[2]); if (t && !t.driverId) { t.driverId = x.id; t.driver = { ...x }; await saveTrip(t); } } go(ret);
  };
  const del = $('#del'); if (del) del.onclick = async () => { if (await confirmBox('Delete driver?', '<p>Existing trips keep their copy of the driver details.</p>', 'Delete', 'red')) { await DB.del('drivers', d.id); go('#/settings'); } };
});

/* ------------------------------------------------------------------ boot */
(async function boot() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { }
  await loadSettings(); render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      reg.addEventListener('updatefound', () => { const nw = reg.installing; nw && nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) confirmBox('Update available', '<p>A new version is ready. Your trips are kept.</p>', 'Update now').then(ok => { if (ok) { nw.postMessage('skip'); setTimeout(() => location.reload(), 400); } });
      }); });
    } catch (e) { console.warn(e); }
  }
})();
