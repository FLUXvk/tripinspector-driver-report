/* Trip Inspector DRIVER · Trip Report — PDFs built on the phone (jsPDF + autotable). Same look as the Trip Inspector DRIVER report. */
'use strict';
const GOLD = [246, 181, 48], INK = [20, 20, 20], MUTE = [107, 100, 87], PAPER = [251, 247, 238], LINEC = [230, 220, 198], REDC = [179, 38, 30], OKC = [31, 122, 61];
let LOGO_DATA = null;
/* Helvetica in jsPDF only knows Latin-1 — strip / replace everything else */
const T = s => String(s ?? '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/→/g, '->').replace(/›/g, '>').replace(/≥/g, '>=').replace(/↺/g, '').replace(/[✔✓]/g, 'OK').replace(/⚠/g, '!').replace(/[^\x00-\xFF—–·°×±]/g, '');
async function blobData(b, max = 1000) {
  try { if (!b) return null; const c = await compress(b, max, 0.72); const d = await fileToDataURL(c); const i = await loadImg(d); return { d, w: i.width, h: i.height }; } catch (e) { return null; }
}
async function urlData(url, max) { try { const r = await fetch(url); if (!r.ok) return null; return blobData(await r.blob(), max); } catch (e) { return null; } }
const photo = (ownerId, slot) => DB.get('photos', ownerId + ':' + slot).then(b => blobData(b));
const gpsTxt = g => g ? `${g.lat.toFixed(5)}, ${g.lng.toFixed(5)} (±${g.acc} m)` : '';

/* shared page furniture: header band, sections, tables, photo grid, footer */
async function pdfKit(title, ref) {
  if (!LOGO_DATA) LOGO_DATA = await urlData('assets/logo_report.jpg', 600);
  const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const W = 210, H = 297, M = 14; const k = { doc, W, H, M, y: 40 };
  k.head = () => {
    doc.setFillColor(...INK); doc.rect(0, 0, W, 30, 'F'); doc.setFillColor(...GOLD); doc.rect(0, 30, W, 1.4, 'F');
    if (LOGO_DATA) { const h = 22, w = LOGO_DATA.w / LOGO_DATA.h * h; doc.addImage(LOGO_DATA.d, 'JPEG', M, 4, w, h); }
    doc.setTextColor(...(title.startsWith('INCIDENT') ? [255, 120, 105] : GOLD)); doc.setFont('times', 'bold'); doc.setFontSize(17); doc.text(title, W - M, 13, { align: 'right' });
    doc.setFont('courier', 'normal'); doc.setFontSize(9); doc.setTextColor(230, 214, 168); doc.text(`CASE FILE ${ref}`, W - M, 19.5, { align: 'right' });
    doc.text(T(SET.company || 'Trip Inspector DRIVER'), W - M, 25, { align: 'right' });
  };
  k.newPage = () => { doc.addPage(); k.head(); k.y = 40; };
  k.sect = txt => { if (k.y > H - 45) k.newPage(); doc.setFont('times', 'bold'); doc.setFontSize(13); doc.setTextColor(...INK); doc.text(T(txt), M, k.y); doc.setDrawColor(...GOLD); doc.setLineWidth(0.8); doc.line(M, k.y + 1.8, M + 40, k.y + 1.8); k.y += 5; };
  k.tbl = (body, cols, opts = {}) => {
    doc.autoTable({ startY: k.y, margin: { left: M, right: M, top: 38, bottom: 18 }, theme: 'grid', body, head: opts.head ? [opts.head] : undefined,
      styles: { font: 'helvetica', fontSize: 8.6, cellPadding: 1.8, textColor: INK, lineColor: LINEC, lineWidth: 0.2, overflow: 'linebreak' },
      headStyles: { fillColor: INK, textColor: GOLD, fontStyle: 'bold' }, columnStyles: cols || {}, didDrawPage: () => k.head(), ...opts.extra });
    k.y = doc.lastAutoTable.finalY + 6;
  };
  k.L = s => ({ content: T(s), styles: { fillColor: PAPER, fontStyle: 'bold' } });
  k.red = s => ({ content: T(s), styles: { textColor: REDC, fontStyle: 'bold' } });
  k.val = (x, f = s => s) => x == null || x === '' ? k.red('not captured') : T(f(x));
  k.C4 = { 0: { cellWidth: 30 }, 1: { cellWidth: 61 }, 2: { cellWidth: 30 } };
  k.photoGrid = (list, cols) => {
    const gap = 4, cw = (W - 2 * M - gap * (cols - 1)) / cols, chh = cw * 0.75; let c = 0;
    list.forEach(([im, cap]) => {
      if (c === 0 && k.y + chh + 8 > H - 18) k.newPage();
      const x = M + c * (cw + gap);
      doc.setFillColor(240, 236, 226); doc.rect(x, k.y, cw, chh, 'F');
      if (im) { const s = Math.min(cw / im.w, chh / im.h), w = im.w * s, h = im.h * s; doc.addImage(im.d, 'JPEG', x + (cw - w) / 2, k.y + (chh - h) / 2, w, h); }
      else { doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...REDC); doc.text('NOT CAPTURED', x + cw / 2, k.y + chh / 2, { align: 'center' }); }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2); doc.setTextColor(...MUTE); doc.text(doc.splitTextToSize(T(cap), cw), x, k.y + chh + 3.5);
      c++; if (c === cols) { c = 0; k.y += chh + 9; }
    });
    if (c) k.y += chh + 9;
  };
  /* GPS table: last column is a clickable "Open map" link */
  k.gpsTable = rows => {
    k.tbl(rows.map(([p, g]) => [T(p), g ? T(fmtDT(g.at)) : '—', g ? T(gpsTxt(g)) : k.red('not captured'), g ? { content: 'Open map', styles: { textColor: [26, 86, 170], fontStyle: 'bold' } } : '']),
      { 0: { cellWidth: 44 }, 1: { cellWidth: 34 }, 3: { cellWidth: 22 } },
      { head: ['Point', 'Time', 'Coordinates', 'Map'], extra: { didDrawCell: dd => { if (dd.section === 'body' && dd.column.index === 3) { const g = rows[dd.row.index][1]; if (g) doc.link(dd.cell.x, dd.cell.y, dd.cell.width, dd.cell.height, { url: mapURL(g) }); } } } });
  };
  k.signoff = (left, right) => {
    if (k.y > H - 45) k.newPage();
    k.sect('Sign-off'); const y = k.y;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...INK); doc.setDrawColor(...INK); doc.setLineWidth(0.3);
    doc.text(T(left), M, y + 10); doc.line(M + 50, y + 10, M + 88, y + 10);
    doc.text(T(right), M + 100, y + 10); doc.line(M + 118, y + 10, W - M, y + 10);
    doc.setTextColor(...MUTE); doc.setFontSize(7.5); doc.text('Signature / date', M + 50, y + 14); doc.text('Name, signature / date', M + 118, y + 14);
  };
  k.finish = () => {
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i); doc.setDrawColor(...GOLD); doc.setLineWidth(0.6); doc.line(M, H - 13, W - M, H - 13);
      doc.setFont('courier', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTE);
      doc.text(T(`Trip Inspector DRIVER — Every Driver Leaves a Trail. | ${ref} | ${fmtDT(new Date())} | page ${i} of ${n}`), W / 2, H - 8.5, { align: 'center' });
    }
    return n;
  };
  k.head();
  return k;
}
const safeName = s => T(s).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');

/* ================================================================== TRIP REPORT */
async function buildReport(t, missing, incidents = []) {
  const v = t.vehicle || {}, d = t.driver || {}, b = t.budget, bc = budgetCalc(t), m = moneyCalc(t), act = actualKm(t), G = t.gps || {};
  const ref = tripRef(t), dest = b.stops.filter(Boolean).slice(-1)[0], ho = hoCheck(t);
  const k = await pdfKit('TRIP REPORT', ref), { doc, W, H, M } = k;
  doc.setFont('times', 'bold'); doc.setFontSize(18); doc.setTextColor(...INK);
  doc.text(T(dest ? `${startTown(t)} -> ${dest}${b.round ? ` -> ${b.fromHO ? SET.hoName : startTown(t)}` : ''}` : 'Trip report'), M, k.y); k.y += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTE);
  doc.text(T(`${d.name || 'Driver not selected'} · ${v.name ? `${v.name} (${v.reg})` : 'Vehicle not selected'} · ${fmtD(b.departAt || t.createdAt)}${b.round ? ' · round trip' : ''}`), M, k.y); k.y += 5;

  // summary strip
  const boxes = [['Planned', bc.km ? kmF(bc.km) : '—'], ['Actual', act != null ? kmF(act) : '—'], ['Fuel spent', nad(m.spent)], m.due > 0 ? ['Due to driver', nad(m.due), 1] : ['Fuel money left', nad(m.remaining)]];
  const bw = (W - 2 * M - 9) / 4;
  boxes.forEach(([l, x, warn], i) => {
    const bx = M + i * (bw + 3);
    doc.setFillColor(...(warn ? [250, 228, 225] : i === 3 ? [226, 242, 230] : PAPER)); doc.roundedRect(bx, k.y, bw, 16, 2, 2, 'F');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...(warn ? REDC : MUTE)); doc.text(T(l.toUpperCase()), bx + 3, k.y + 5);
    doc.setFont('times', 'bold'); doc.setFontSize(13); doc.setTextColor(...(warn ? REDC : INK)); doc.text(T(x), bx + 3, k.y + 12.5);
  });
  k.y += 22;
  const note = (txt, fill, line, col) => {
    doc.setFillColor(...fill); doc.setDrawColor(...line); doc.setLineWidth(0.4);
    const lines = doc.splitTextToSize(T(txt), W - 2 * M - 8); const bh = lines.length * 3.8 + 5; doc.roundedRect(M, k.y, W - 2 * M, bh, 2, 2, 'FD');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...col); doc.text(lines, M + 4, k.y + 5); k.y += bh + 4;
  };
  if (ho && !ho.ok) note(`Vehicle NOT returned to ${hoLabel()} — trip ended ${ho.km} km away${t.end.where ? `: ${t.end.where}` : ''}.`, [250, 228, 225], REDC, REDC);
  if (incidents.length) note(`${incidents.length} incident(s) reported on this trip — see section 6.`, [250, 228, 225], REDC, REDC);
  if (missing && missing.length) note('Generated with incomplete steps — not captured: ' + missing.join('; ') + '.', [253, 243, 220], GOLD, [120, 80, 0]);
  k.y += 2;

  k.sect('1. Vehicle & driver');
  k.tbl([[k.L('Vehicle'), k.val(v.name && `${v.name} · ${v.reg}`), k.L('Driver'), k.val(d.name)],
    [k.L('Make / model'), T(v.make || '—'), k.L('Employee / ID no.'), T([d.empNo, d.idNo].filter(Boolean).join(' / ') || '—')],
    [k.L('Fuel / consumption'), T(v.fuel ? `${v.fuel} · ${v.cons || '?'} l/100 km${v.tank ? ` · tank ${v.tank} L` : ''}` : '—'), k.L("Driver's licence"), T(d.licNo ? `${d.licNo}${d.licCode ? ' · code ' + d.licCode : ''}${d.licExpiry ? ' · exp. ' + fmtD(d.licExpiry) : ''}` : '—')],
    [k.L('Purpose'), T(b.purpose || '—'), k.L('Cell'), T(d.phone || '—')]], k.C4);

  k.sect('2. Pre-trip inspection');
  const de = t.insp.diskExpiry, today = dayKey(new Date(b.departAt || t.createdAt));
  k.tbl([[k.L('Licence disc expiry'), de ? { content: T(`${fmtD(de)} — ${de >= today ? 'VALID' : 'EXPIRED'}`), styles: { textColor: de >= today ? OKC : REDC, fontStyle: 'bold' } } : k.red('not captured'), k.L('Read by OCR'), T(t.insp.diskOcrState === 'found' ? 'yes — confirmed by driver' : t.insp.diskOcrState === 'none' ? 'no — entered manually' : '—')],
    [k.L('Start odometer'), k.val(num(t.insp.odo), kmF), k.L('OCR reading'), T(t.insp.odoOcr ? kmF(t.insp.odoOcr) : '—')],
    [k.L('Inspection location'), G.insp ? T(gpsTxt(G.insp)) : k.red('not captured'), k.L('Departure'), T(fmtDT(b.departAt) || '—')]], k.C4);
  k.photoGrid([...await Promise.all(SIDES.map(async ([s, l], i) => [await photo(t.id, 'insp_' + s), `${i + 1}. ${l} — before trip`])), [await photo(t.id, 'insp_disk'), '5. Licence disc'], [await photo(t.id, 'insp_odo'), `6. Odometer at start${t.insp.odo ? ' · ' + kmF(num(t.insp.odo)) : ''}`]], 3);

  k.sect('3. Trip budget');
  const legs = bc.route && !b.manual ? bc.route.legs.map((l, i) => `${l.from} -> ${i === bc.route.legs.length - 1 && b.round && b.fromHO ? SET.hoName + ', ' + l.to : l.to} ${kmF(l.km)}`).join('\n') : dest ? `${startTown(t)} -> ${b.stops.filter(Boolean).join(' -> ')}${b.round ? ` -> ${startTown(t)}` : ''}` : 'not captured';
  k.tbl([[k.L('Start'), T(startLabel(t)), k.L('Return to'), T(b.round ? (b.fromHO ? hoLabel() : startTown(t)) : 'one way — no return')],
    [k.L('Route'), { content: T(legs), colSpan: 3, styles: dest ? {} : { textColor: REDC, fontStyle: 'bold' } }],
    [k.L('Planned distance'), bc.km ? T(`${kmF(bc.km)} ${b.manual ? '(entered manually)' : '(road network)'}`) : k.red('not captured'), k.L('Fuel estimate'), T(`${bc.litres} L = ${nad(bc.cost)}`)],
    [k.L('Estimate basis'), { content: T(`${bc.cons} l/100 km + ${bc.buf}% buffer @ ${nad(bc.price)}/L`), colSpan: 3 }],
    [k.L('Fuel money received'), num(b.received) != null ? { content: T(nad(m.received)), styles: { fontStyle: 'bold' } } : k.red('not captured'), k.L('Received as'), T(`${b.method || '—'}${b.note ? ' · ' + b.note : ''}`)]], k.C4);

  k.sect('4. Refuelling');
  const rf = t.refuels.filter(r => num(r.amount) != null || ['receipt', 'pump', 'odo'].some(s => t.photos[`rf_${r.id}_${s}`]));
  if (rf.length) {
    let run = m.received;
    const rows = rf.map((r, i) => { const a = num(r.amount) || 0; run -= a; const g = G['rf_' + r.id]; return [String(i + 1), T(fmtDT(r.at) || '—'), { content: T((r.station || '—') + (g ? `\n${g.lat.toFixed(4)}, ${g.lng.toFixed(4)}` : '\nno GPS')), styles: g ? {} : { textColor: REDC } }, T(num(r.odo) != null ? kmF(num(r.odo)) : '—'), T(num(r.litres) != null ? `${num(r.litres)} L` : '—'), num(r.amount) != null ? T(nad(a)) : k.red('not captured'), run >= 0 ? T(nad(run)) : { content: T(`-${nad(-run)}`), styles: { textColor: REDC, fontStyle: 'bold' } }]; });
    rows.push([{ content: 'TOTAL', colSpan: 4, styles: { fontStyle: 'bold', fillColor: PAPER } }, { content: T(m.litres ? `${Math.round(m.litres * 10) / 10} L` : ''), styles: { fontStyle: 'bold', fillColor: PAPER } }, { content: T(nad(m.spent)), styles: { fontStyle: 'bold', fillColor: PAPER } }, { content: '', styles: { fillColor: PAPER } }]);
    k.tbl(rows, { 0: { cellWidth: 8 }, 1: { cellWidth: 28 }, 3: { cellWidth: 24 }, 4: { cellWidth: 17 }, 5: { cellWidth: 26, halign: 'right' }, 6: { cellWidth: 27, halign: 'right' } }, { head: ['#', 'Date / time', 'Station / GPS', 'Odometer', 'Litres', 'Cost', 'Money left'] });
  } else { k.tbl([[k.red('No refuels recorded')]]); }
  k.tbl([[k.L('Fuel money received'), T(nad(m.received)), k.L('Spent on fuel'), T(nad(m.spent))],
    m.due > 0 ? [k.L('TOTAL DUE TO DRIVER'), { content: T(`${nad(m.due)}  (driver used own money)`), colSpan: 3, styles: { textColor: REDC, fontStyle: 'bold', fontSize: 10 } }]
      : [k.L('Fuel money remaining'), { content: T(`${nad(m.remaining)}  (to be returned / accounted for)`), colSpan: 3, styles: { textColor: OKC, fontStyle: 'bold', fontSize: 10 } }],
    [k.L('Budget vs actual'), { content: T(bc.cost ? `Estimate ${nad(bc.cost)} · actual ${nad(m.spent)} · ${m.spent <= bc.cost ? 'within estimate by ' : 'over estimate by '}${nad(Math.abs(bc.cost - m.spent))}` : '—'), colSpan: 3 }]], k.C4);
  if (rf.length) { const ph = []; for (const [i, r] of rf.entries()) for (const [s, l] of [['receipt', 'Receipt'], ['pump', 'Pump'], ['odo', 'Odometer']]) ph.push([await photo(t.id, `rf_${r.id}_${s}`), `Refuel ${i + 1} · ${l}${s === 'receipt' && num(r.amount) != null ? ' · ' + nad(num(r.amount)) : s === 'odo' && num(r.odo) != null ? ' · ' + kmF(num(r.odo)) : ''}`]); k.photoGrid(ph, 3); }

  k.sect('5. Trip end');
  const s0 = num(t.insp.odo), s1 = num(t.end.odo);
  const cons = act && m.litres ? Math.round(m.litres / act * 1000) / 10 : null;
  k.tbl([[k.L('End odometer'), k.val(s1, kmF), k.L('Trip ended'), T(fmtDT(t.end.at) || '—')],
    [k.L('Actual distance'), act != null ? { content: T(`${kmF(act)}  (${kmF(s1)} - ${kmF(s0)})`), styles: { fontStyle: 'bold' } } : k.red(s0 == null || s1 == null ? 'not available — odometer missing' : 'check odometer readings'), k.L('Planned distance'), T(bc.km ? `${kmF(bc.km)}${act != null ? ` · difference ${act - bc.km >= 0 ? '+' : ''}${Math.round(act - bc.km)} km` : ''}` : '—')],
    [k.L('End location'), G.end ? T(gpsTxt(G.end)) : k.red('not captured'), k.L('Returned to HO'), !returnsToHO(t) ? T('n/a (not a head-office round trip)') : !ho ? k.red('unknown — no GPS') : ho.ok ? { content: T(`YES — ${ho.km} km from ${ho.exact ? 'head office' : 'town centre'}`), styles: { textColor: OKC, fontStyle: 'bold' } } : k.red(`NO — ${ho.km} km away${t.end.where ? ': ' + t.end.where : ''}`)],
    [k.L('Fuel consumption'), T(cons ? `${cons} l/100 km (litres bought / km)` : '—'), k.L('Spec'), T(v.cons ? `${v.cons} l/100 km` : '—')],
    [k.L('Driver notes'), { content: T(t.end.notes || '—'), colSpan: 3 }]], k.C4);
  k.photoGrid([[await photo(t.id, 'end_odo'), `Odometer at end${s1 != null ? ' · ' + kmF(s1) : ''}`], ...await Promise.all(SIDES.map(async ([s, l], i) => [await photo(t.id, 'end_' + s), `${i + 1}. ${l} — after trip`]))], 3);

  if (incidents.length) {
    k.sect('6. Incidents');
    k.tbl(incidents.map(x => [T(incRef(x)), T(fmtDT(x.at)), T(x.type || '—'), T(`${x.description || ''}${x.police === 'yes' ? ` · Police case ${x.caseNo || '—'}` : ''}${x.injuries === 'yes' ? ' · INJURIES' : ''}`)]),
      { 0: { cellWidth: 26 }, 1: { cellWidth: 28 }, 2: { cellWidth: 34 } }, { head: ['Ref', 'When', 'Type', 'Details'] });
    const ph = []; for (const x of incidents) for (const [s, l] of INC_SLOTS) { if (x.photos && x.photos[s]) ph.push([await photo(x.id, s), `${incRef(x)} · ${l}`]); }
    if (ph.length) k.photoGrid(ph, 3);
  }

  k.sect(`${incidents.length ? 7 : 6}. GPS log`);
  k.gpsTable([['Pre-trip inspection', G.insp], ...rf.map((r, i) => [`Refuel ${i + 1}${r.station ? ' · ' + r.station : ''}`, G['rf_' + r.id]]), ...incidents.map(x => [`Incident · ${x.type || ''}`, x.gps && x.gps.here]), ['Trip end', G.end]]);

  k.signoff(`Driver: ${d.name || ''}`, 'Manager:');
  const pages = k.finish();
  const name = `TripReport_${ref}_${safeName(v.reg || 'vehicle')}_${safeName(dest || 'trip')}_${dayKey(new Date(b.departAt || t.createdAt))}.pdf`;
  return { blob: doc.output('blob'), name, title: `Trip report ${ref} — ${d.name || ''}`, pages };
}

/* ================================================================== INCIDENT REPORT */
async function buildIncidentReport(x) {
  const v = x.vehicle || {}, d = x.driver || {}, g = x.gps && x.gps.here, ref = incRef(x);
  const trip = x.tripId ? await DB.get('trips', x.tripId) : null;
  const k = await pdfKit('INCIDENT REPORT', ref), { doc, M } = k;
  doc.setFont('times', 'bold'); doc.setFontSize(18); doc.setTextColor(...REDC); doc.text(T(x.type || 'Incident'), M, k.y); k.y += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTE);
  doc.text(T(`${fmtDT(x.at)} · ${d.name || 'driver not selected'} · ${v.name ? `${v.name} (${v.reg})` : 'vehicle not selected'}`), M, k.y); k.y += 7;
  k.sect('1. What happened');
  k.tbl([[k.L('Type'), k.val(x.type), k.L('Date & time'), T(fmtDT(x.at))],
    [k.L('Description'), { content: (x.description || '').trim() ? T(x.description) : 'not captured', colSpan: 3, styles: (x.description || '').trim() ? {} : { textColor: REDC, fontStyle: 'bold' } }],
    [k.L('Place'), T(x.place || '—'), k.L('GPS'), g ? T(gpsTxt(g)) : k.red('not captured')],
    [k.L('Injuries'), x.injuries === 'yes' ? k.red(`YES — ${x.injuryDetails || 'details not given'}`) : T('No'), k.L('Vehicle drivable'), x.drivable === 'no' ? k.red('NO') : T('Yes')],
    [k.L('Police'), T(x.police === 'yes' ? `Reported · case ${x.caseNo || '—'}` : 'Not reported'), k.L('Police station'), T(x.policeStation || '—')]], k.C4);
  k.sect('2. Vehicle & driver');
  k.tbl([[k.L('Vehicle'), k.val(v.name && `${v.name} · ${v.reg}`), k.L('Driver'), k.val(d.name)],
    [k.L('Make / model'), T(v.make || '—'), k.L("Driver's licence"), T(d.licNo ? `${d.licNo}${d.licCode ? ' · code ' + d.licCode : ''}` : '—')],
    [k.L('Odometer'), T(num(x.odo) != null ? kmF(num(x.odo)) : '—'), k.L('Cell'), T(d.phone || '—')],
    [k.L('Trip'), { content: T(trip ? `${tripRef(trip)} · ${startTown(trip)} -> ${trip.budget.stops.filter(Boolean).join(' -> ') || '—'}${trip.budget.purpose ? ' · ' + trip.budget.purpose : ''}` : 'not linked to a trip'), colSpan: 3 }]], k.C4);
  const th = x.third || {};
  if (th.name || th.phone || th.reg || th.insurer) {
    k.sect('3. Other party');
    k.tbl([[k.L('Name'), T(th.name || '—'), k.L('Cell'), T(th.phone || '—')], [k.L('Vehicle reg.'), T(th.reg || '—'), k.L('Insurer'), T(th.insurer || '—')]], k.C4);
  }
  const ph = []; for (const [s, l] of INC_SLOTS) if (x.photos && x.photos[s]) ph.push([await photo(x.id, s), l]);
  k.sect('Photos'); if (ph.length) k.photoGrid(ph, 3); else k.tbl([[k.red('No photos taken')]]);
  k.sect('Location'); k.gpsTable([['Incident location', g]]);
  k.signoff(`Driver: ${d.name || ''}`, 'Manager:');
  const pages = k.finish();
  return { blob: doc.output('blob'), name: `IncidentReport_${ref}_${safeName(v.reg || 'vehicle')}_${dayKey(new Date(x.at || x.createdAt))}.pdf`, title: `Incident report ${ref} — ${x.type || ''}`, pages };
}
