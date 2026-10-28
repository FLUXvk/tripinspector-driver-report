/* Namibian road network — main towns, junctions & border posts.
   Each edge = road kilometres between neighbouring places on the main (mostly tarred) routes.
   Any town-to-town distance = shortest path through this network (Dijkstra).
   Calibrated to published distances: Windhoek–Otjiwarongo 245, –Tsumeb 426, –Mariental 261, –Keetmanshoop 482,
   –Lüderitz 816, –Gobabis 205, –Rundu ≈700, –Katima Mulilo ≈1 187, –Swakopmund ≈360, Swakopmund–Walvis Bay 33. */
'use strict';
const ROAD_EDGES = [
  // B1 south: Windhoek → Noordoewer
  ['Windhoek', 'Rehoboth', 87], ['Rehoboth', 'Kalkrand', 107], ['Kalkrand', 'Mariental', 67],
  ['Mariental', 'Keetmanshoop', 221], ['Keetmanshoop', 'Grünau', 161], ['Grünau', 'Noordoewer', 150],
  // B3 / B4 south
  ['Grünau', 'Karasburg', 51], ['Karasburg', 'Ariamsvlei', 108],
  ['Keetmanshoop', 'Aus', 209], ['Aus', 'Lüderitz', 125],
  ['Aus', 'Rosh Pinah', 165], ['Rosh Pinah', 'Oranjemund', 95], ['Noordoewer', 'Rosh Pinah', 167],
  ['Mariental', 'Maltahöhe', 111], ['Keetmanshoop', 'Bethanie', 140],
  // B1 north: Windhoek → Oshikango
  ['Windhoek', 'Okahandja', 70], ['Okahandja', 'Otjiwarongo', 175], ['Otjiwarongo', 'Otavi', 118],
  ['Otavi', 'Tsumeb', 63], ['Tsumeb', 'Oshivelo', 70], ['Oshivelo', 'Omuthiya', 45], ['Omuthiya', 'Ondangwa', 136], ['Ondangwa', 'Oshikango (Helao Nafidi)', 58],
  // Owambo region
  ['Ondangwa', 'Ongwediva', 26], ['Ongwediva', 'Oshakati', 7], ['Oshakati', 'Outapi', 75], ['Outapi', 'Ruacana', 70],
  ['Ondangwa', 'Eenhana', 70], ['Ruacana', 'Opuwo', 150],
  // B8 north-east: Otavi → Katima Mulilo
  ['Otavi', 'Grootfontein', 91], ['Tsumeb', 'Grootfontein', 64], ['Grootfontein', 'Rundu', 246],
  ['Rundu', 'Nkurenkuru', 140], ['Rundu', 'Divundu', 200], ['Divundu', 'Kongola', 170], ['Kongola', 'Katima Mulilo', 115], ['Katima Mulilo', 'Wenela Border Post', 6],
  // west & north-west
  ['Otjiwarongo', 'Outjo', 70], ['Outjo', 'Kamanjab', 160], ['Kamanjab', 'Opuwo', 220], ['Outjo', 'Khorixas', 132],
  ['Khorixas', 'Uis', 120], ['Uis', 'Henties Bay', 120], ['Henties Bay', 'Swakopmund', 76],
  ['Otjiwarongo', 'Okakarara', 90], ['Otjiwarongo', 'Omaruru', 125],
  // B2 coast: Okahandja → Walvis Bay
  ['Okahandja', 'Karibib', 115], ['Karibib', 'Usakos', 31], ['Usakos', 'Arandis', 79], ['Arandis', 'Swakopmund', 66], ['Swakopmund', 'Walvis Bay', 33],
  ['Karibib', 'Omaruru', 64],
  // B6 east: Windhoek → Trans Kalahari border
  ['Windhoek', 'Hosea Kutako Int. Airport', 45], ['Hosea Kutako Int. Airport', 'Gobabis', 160], ['Gobabis', 'Buitepos (Trans Kalahari)', 115],
];
const TOWNS = [...new Set(ROAD_EDGES.flatMap(e => [e[0], e[1]]))].sort((a, b) => a.localeCompare(b));
const ROAD_GRAPH = (() => { const g = {}; ROAD_EDGES.forEach(([a, b, km]) => { (g[a] = g[a] || []).push([b, km]); (g[b] = g[b] || []).push([a, km]); }); return g; })();
/** shortest road route between two places → { km, path:[towns] } or null */
function roadRoute(from, to) {
  if (!ROAD_GRAPH[from] || !ROAD_GRAPH[to]) return null;
  if (from === to) return { km: 0, path: [from] };
  const dist = { [from]: 0 }, prev = {}, done = new Set();
  while (true) {
    let u = null; for (const k in dist) if (!done.has(k) && (u === null || dist[k] < dist[u])) u = k;
    if (u === null) return null; if (u === to) break; done.add(u);
    for (const [v, w] of ROAD_GRAPH[u]) if (dist[v] === undefined || dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
  }
  const path = [to]; while (path[0] !== from) path.unshift(prev[path[0]]);
  return { km: dist[to], path };
}
/** multi-stop trip: [A, B, C] (+ return to A) */
function tripRoute(stops, round) {
  const pts = stops.filter(Boolean); if (pts.length < 2) return null;
  const legs = []; let km = 0, path = [pts[0]];
  const seq = round ? pts.concat([pts[0]]) : pts;
  for (let i = 0; i < seq.length - 1; i++) { const r = roadRoute(seq[i], seq[i + 1]); if (!r) return null; legs.push({ from: seq[i], to: seq[i + 1], km: r.km }); km += r.km; path = path.concat(r.path.slice(1)); }
  return { km, legs, path };
}
