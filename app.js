'use strict';
const KEY = 'facturaya.v2';
const RE = {21: 5.2, 10: 1.4, 4: 0.5, 0: 0}; // recargo de equivalencia
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const eur = n => (n || 0).toLocaleString('es-ES', {style: 'currency', currency: 'EUR'});
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toISOString().slice(0, 10);
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };

let S = load();
function load() {
  const d = {settings: {serie: '', defIva: 21, defIrpf: 0, plazo: 30}, clients: [], docs: [], expenses: []};
  try {
    const o = JSON.parse(localStorage.getItem(KEY));
    if (o) { Object.assign(d, o); d.settings = Object.assign({serie: '', defIva: 21, defIrpf: 0, plazo: 30}, o.settings); }
  } catch (e) {}
  return d;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { alert('No se pudo guardar: el navegador no tiene espacio o bloquea el almacenamiento.'); } }

// ---------- cálculo ----------
function totals(d) {
  const by = {};
  d.lines.forEach(l => { by[l.iva] = (by[l.iva] || 0) + num(l.q) * num(l.p); });
  let base = 0, iva = 0, rec = 0;
  const rows = Object.keys(by).map(Number).sort((a, b) => b - a).map(k => {
    const b = r2(by[k]), i = r2(b * k / 100), re = d.recargo ? r2(b * (RE[k] || 0) / 100) : 0;
    base += b; iva += i; rec += re;
    return {k, b, i, re};
  });
  base = r2(base); iva = r2(iva); rec = r2(rec);
  const ret = r2(base * num(d.irpf) / 100);
  return {rows, base, iva, rec, ret, total: r2(base + iva + rec - ret)};
}
function nextNum(type) {
  const y = new Date().getFullYear();
  const pfx = type === 'presupuesto' && S.settings.serie ? 'P' + S.settings.serie : (S.settings.serie || (type === 'factura' ? 'F' : 'P'));
  const p = pfx + '-' + y + '-';
  let max = 0;
  S.docs.filter(d => d.type === type).forEach(d => {
    if (d.num.startsWith(p)) max = Math.max(max, parseInt(d.num.slice(p.length), 10) || 0);
  });
  return p + String(max + 1).padStart(3, '0');
}
function estado(d) {
  if (d.type !== 'factura') return d.estado === 'aceptado' ? 'aceptado' : 'borrador';
  if (d.estado === 'cobrada') return 'cobrada';
  return d.venc && d.venc < today() ? 'vencida' : 'pendiente';
}
const TAG = {cobrada: ['ok', 'Cobrada'], pendiente: ['pe', 'Pendiente'], vencida: ['ve', 'Vencida'], aceptado: ['ok', 'Aceptado'], borrador: ['', 'Enviado']};
const tag = e => `<span class="tag ${TAG[e][0]}">${TAG[e][1]}</span>`;

// ---------- vistas ----------
let view = 'facturas', D = null;
const VIEWS = {facturas: vFacturas, clientes: vClientes, gastos: vGastos, resumen: vResumen, ajustes: vAjustes, editor: vEditor, doc: vDoc};
function go(v) { location.hash = v; }
function route() {
  const h = (location.hash || '#facturas').slice(1);
  view = VIEWS[h] ? h : 'facturas';
  if ((view === 'editor' && !D) || (view === 'doc' && !D)) view = 'facturas';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === view));
  VIEWS[view]();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

function vFacturas() {
  const y = new Date().getFullYear();
  const f = S.docs.filter(d => d.type === 'factura');
  const yr = f.filter(d => d.fecha.startsWith(y));
  const fact = yr.reduce((a, d) => a + totals(d).total, 0);
  const pend = f.filter(d => estado(d) !== 'cobrada').reduce((a, d) => a + totals(d).total, 0);
  const venc = f.filter(d => estado(d) === 'vencida').length;
  const docs = S.docs.slice().sort((a, b) => b.fecha.localeCompare(a.fecha) || b.num.localeCompare(a.num));
  $('#app').innerHTML = `
  <div class="grid3">
   <div class="card kpi">${eur(fact)}<small>Facturado en ${y} (con IVA)</small></div>
   <div class="card kpi">${eur(pend)}<small>Pendiente de cobro</small></div>
   <div class="card kpi">${venc}<small>Facturas vencidas</small></div>
  </div>
  <div class="card">
   <div class="bar">
    <button data-act="new" data-t="factura">+ Nueva factura</button>
    <button class="g" data-act="new" data-t="presupuesto">+ Nuevo presupuesto</button>
    <span class="sp"></span>
    <input id="q" placeholder="Buscar por nº o cliente" style="max-width:240px">
    <button class="g" data-act="csv">Exportar CSV</button>
   </div>
   <div style="overflow-x:auto"><table><thead><tr><th>Nº</th><th>Fecha</th><th>Cliente</th><th class="n">Total</th><th>Estado</th><th></th></tr></thead>
   <tbody id="rows"></tbody></table></div>
   ${docs.length ? '' : '<p class="note">Aún no hay documentos. Empieza creando tu primera factura. Antes, rellena tus datos en <a href="#ajustes">Ajustes</a>.</p>'}
  </div>`;
  const draw = () => {
    const q = ($('#q').value || '').toLowerCase();
    $('#rows').innerHTML = docs.filter(d => !q || (d.num + ' ' + d.client.nom).toLowerCase().includes(q)).map(d => `
     <tr><td>${esc(d.num)}<br><span class="note">${d.type === 'factura' ? 'Factura' : 'Presupuesto'}</span></td><td>${esc(d.fecha)}</td><td>${esc(d.client.nom)}</td>
     <td class="n">${eur(totals(d).total)}</td><td>${tag(estado(d))}</td>
     <td class="n">
      <button class="s g" data-act="view" data-id="${d.id}">Ver / PDF</button>
      <button class="s g" data-act="edit" data-id="${d.id}">Editar</button>
      ${d.type === 'factura' && d.estado !== 'cobrada' ? `<button class="s" data-act="paid" data-id="${d.id}">Cobrada</button>` : ''}
      ${d.type === 'presupuesto' ? `<button class="s" data-act="tofact" data-id="${d.id}">→ Factura</button>` : ''}
      <button class="s g" data-act="dup" data-id="${d.id}">Duplicar</button>
      <button class="s d" data-act="del" data-id="${d.id}">Borrar</button>
     </td></tr>`).join('');
  };
  $('#q').oninput = draw; draw();
}

function newDoc(type) {
  const s = S.settings;
  return {id: uid(), type, num: nextNum(type), fecha: today(), venc: type === 'factura' ? addDays(today(), s.plazo || 0) : addDays(today(), 30),
    client: {nom: '', nif: '', dir: '', email: ''}, lines: [{d: '', q: 1, p: 0, iva: num(s.defIva)}],
    irpf: num(s.defIrpf), recargo: false, notas: '', estado: type === 'factura' ? 'pendiente' : 'borrador'};
}
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

function vEditor() {
  const ivaOpts = v => [21, 10, 4, 0].map(x => `<option value="${x}"${x === v ? ' selected' : ''}>${x === 0 ? 'Exento 0 %' : x + ' %'}</option>`).join('');
  const isF = D.type === 'factura';
  $('#app').innerHTML = `
  <div class="card">
   <div class="bar"><h2 style="margin:0">${isF ? 'Factura' : 'Presupuesto'} ${esc(D.num)}</h2><span class="sp"></span>
    <button class="g" data-act="cancel">Cancelar</button><button data-act="saveDoc">Guardar</button></div>
   ${S.settings.nom ? '' : '<div class="warn">Faltan tus datos de emisor (nombre y NIF). Complétalos en <a href="#ajustes">Ajustes</a> antes de emitir; si no, saldrá vacío.</div>'}
   <div class="grid">
    <div>
     <div class="row"><div><label>Número</label><input data-f="num" value="${esc(D.num)}"></div>
      <div><label>Fecha</label><input data-f="fecha" type="date" value="${esc(D.fecha)}"></div>
      <div><label>${isF ? 'Vencimiento' : 'Válido hasta'}</label><input data-f="venc" type="date" value="${esc(D.venc)}"></div></div>
     <label>Cliente guardado</label>
     <select id="pick"><option value="">— escribir uno nuevo —</option>${S.clients.map(c => `<option value="${c.id}">${esc(c.nom)}</option>`).join('')}</select>
     <label>Nombre / razón social</label><input data-c="nom" value="${esc(D.client.nom)}">
     <div class="row"><div><label>NIF/CIF</label><input data-c="nif" value="${esc(D.client.nif)}"></div>
      <div><label>Email</label><input data-c="email" value="${esc(D.client.email)}"></div></div>
     <label>Dirección</label><input data-c="dir" value="${esc(D.client.dir)}">
    </div>
    <div>
     <div class="row"><div><label>Retención IRPF</label><select data-f="irpf">
       ${[[0, '0 % (cliente particular)'], [15, '15 % (profesional)'], [7, '7 % (nuevo autónomo, 3 años)'], [1, '1 % (módulos agrícolas)'], [19, '19 % (alquileres)']].map(([v, t]) => `<option value="${v}"${v === num(D.irpf) ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
      <div><label>Recargo de equivalencia</label><select data-f="recargo"><option value="0">No</option><option value="1"${D.recargo ? ' selected' : ''}>Sí (cliente comerciante minorista)</option></select></div></div>
     <label>Notas / condiciones (opcional)</label><textarea data-f="notas" rows="4">${esc(D.notas)}</textarea>
     <p class="note">Si el IVA es 0 %, indica la causa en notas (p. ej. «Exento art. 20 LIVA» o «Inversión del sujeto pasivo»).</p>
    </div>
   </div>
   <h3>Conceptos</h3>
   <div class="line note"><span>Descripción</span><span>Cantidad</span><span>Precio (sin IVA)</span><span>IVA</span><span></span></div>
   <div id="lines"></div>
   <div class="bar" style="margin-top:10px"><button class="g" data-act="addLine">+ Añadir línea</button></div>
   <div class="tot" id="edTot"></div>
  </div>`;
  const drawLines = () => {
    $('#lines').innerHTML = D.lines.map((l, i) => `<div class="line" data-i="${i}">
      <input data-l="d" value="${esc(l.d)}" placeholder="Descripción">
      <input data-l="q" inputmode="decimal" value="${esc(l.q)}">
      <input data-l="p" inputmode="decimal" value="${esc(l.p)}">
      <select data-l="iva">${ivaOpts(num(l.iva))}</select>
      <button class="g s" data-act="rmLine" data-i="${i}" title="Quitar">×</button></div>`).join('');
  };
  drawLines(); drawTot();
  $('#app').oninput = e => {
    const t = e.target;
    if (t.dataset.f) { D[t.dataset.f] = t.dataset.f === 'recargo' ? t.value === '1' : (t.dataset.f === 'irpf' ? num(t.value) : t.value); }
    else if (t.dataset.c) D.client[t.dataset.c] = t.value;
    else if (t.dataset.l) { const l = D.lines[+t.closest('.line').dataset.i]; l[t.dataset.l] = t.dataset.l === 'd' ? t.value : (t.dataset.l === 'iva' ? num(t.value) : t.value); }
    drawTot();
  };
  $('#app').onchange = e => {
    if (e.target.id === 'pick') {
      const c = S.clients.find(x => x.id === e.target.value);
      if (c) { D.client = {nom: c.nom, nif: c.nif, dir: c.dir, email: c.email}; if (c.irpf != null) D.irpf = c.irpf; vEditor(); }
    }
  };
  D._redraw = drawLines;
}
function drawTot() {
  const t = totals(D);
  $('#edTot').innerHTML = t.rows.map(r => `<div><span>Base ${r.k} %</span><span>${eur(r.b)}</span></div><div><span>IVA ${r.k} %</span><span>${eur(r.i)}</span></div>` + (D.recargo && r.re ? `<div><span>Recargo ${RE[r.k]} %</span><span>${eur(r.re)}</span></div>` : '')).join('') +
    (num(D.irpf) ? `<div><span>IRPF −${num(D.irpf)} %</span><span>−${eur(t.ret)}</span></div>` : '') + `<div class="big"><span>Total</span><span>${eur(t.total)}</span></div>`;
}

function saveDoc() {
  const d = D;
  d.lines = d.lines.map(l => ({d: l.d, q: num(l.q), p: num(l.p), iva: num(l.iva)})).filter(l => l.d || l.p);
  if (!d.lines.length) return alert('Añade al menos un concepto.');
  if (!d.client.nom.trim()) return alert('Indica el nombre del cliente.');
  if (!d.num.trim()) return alert('Indica el número del documento.');
  if (S.docs.some(x => x.id !== d.id && x.type === d.type && x.num === d.num)) return alert('Ya existe un documento con ese número. Los números no deben repetirse.');
  const c = S.clients.find(x => (d.client.nif && x.nif === d.client.nif) || x.nom.toLowerCase() === d.client.nom.toLowerCase());
  if (!c) S.clients.push({id: uid(), nom: d.client.nom, nif: d.client.nif, dir: d.client.dir, email: d.client.email, irpf: num(d.irpf)});
  const clean = Object.assign({}, d); delete clean._redraw;
  const i = S.docs.findIndex(x => x.id === d.id);
  if (i >= 0) S.docs[i] = clean; else S.docs.push(clean);
  save(); D = clean; go('doc'); route();
}

function vDoc() {
  const d = D, s = S.settings, t = totals(d), isF = d.type === 'factura';
  const notes = [];
  if (isF && s.iban) notes.push('Pago por transferencia a: ' + s.iban);
  if (d.notas) notes.push(d.notas);
  if (!isF) notes.push('Presupuesto sin compromiso. Válido hasta ' + d.venc + '.');
  $('#app').innerHTML = `
  <div class="bar noprint"><button class="g" data-act="back">← Volver</button><span class="sp"></span>
   <button class="g" data-act="edit" data-id="${d.id}">Editar</button><button data-act="print">Descargar PDF / Imprimir</button></div>
  <div id="docview"><div id="doc">
   <div class="hd"><div>${s.logo ? `<img class="logo" src="${esc(s.logo)}" alt="">` : ''}
     <p><b>${esc(s.nom || '(tu nombre)')}</b><br>NIF ${esc(s.nif || '')}<br>${esc(s.dir || '')}<br>${esc(s.email || '')} ${esc(s.tel || '')}</p></div>
    <div style="text-align:right"><h2 style="font-size:24px;margin:0">${isF ? 'FACTURA' : 'PRESUPUESTO'}</h2>
     <b>Nº ${esc(d.num)}</b><br>Fecha: ${esc(d.fecha)}${isF && d.venc ? '<br>Vencimiento: ' + esc(d.venc) : ''}</div></div>
   <p><b>Cliente</b><br>${esc(d.client.nom)}<br>NIF ${esc(d.client.nif)}<br>${esc(d.client.dir)}</p>
   <table><thead><tr><th>Concepto</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">IVA</th><th class="n">Importe</th></tr></thead>
   <tbody>${d.lines.map(l => `<tr><td>${esc(l.d)}</td><td class="n">${esc(l.q)}</td><td class="n">${eur(num(l.p))}</td><td class="n">${l.iva} %</td><td class="n">${eur(r2(num(l.q) * num(l.p)))}</td></tr>`).join('')}</tbody></table>
   <div class="tot"><div><span>Base imponible</span><span>${eur(t.base)}</span></div>
    ${t.rows.map(r => `<div><span>IVA ${r.k} % s/ ${eur(r.b)}</span><span>${eur(r.i)}</span></div>${d.recargo && r.re ? `<div><span>Recargo eq. ${RE[r.k]} %</span><span>${eur(r.re)}</span></div>` : ''}`).join('')}
    ${num(d.irpf) ? `<div><span>Retención IRPF −${num(d.irpf)} %</span><span>−${eur(t.ret)}</span></div>` : ''}
    <div class="big"><span>TOTAL</span><span>${eur(t.total)}</span></div></div>
   <p class="note" style="margin-top:20px">${notes.map(esc).join('<br>')}</p>
  </div></div>`;
}

function vClientes() {
  const cs = S.clients.slice().sort((a, b) => a.nom.localeCompare(b.nom));
  $('#app').innerHTML = `<div class="card"><div class="bar"><h2 style="margin:0">Clientes</h2><span class="sp"></span><button data-act="newClient">+ Nuevo cliente</button></div>
   <div id="cform"></div>
   <div style="overflow-x:auto"><table><thead><tr><th>Nombre</th><th>NIF</th><th>Email</th><th class="n">Facturado</th><th></th></tr></thead><tbody>
   ${cs.map(c => { const tot = S.docs.filter(d => d.type === 'factura' && d.client.nom === c.nom).reduce((a, d) => a + totals(d).total, 0);
     return `<tr><td>${esc(c.nom)}<br><span class="note">${esc(c.dir)}</span></td><td>${esc(c.nif)}</td><td>${esc(c.email)}</td><td class="n">${eur(tot)}</td>
     <td class="n"><button class="s g" data-act="editClient" data-id="${c.id}">Editar</button> <button class="s d" data-act="delClient" data-id="${c.id}">Borrar</button></td></tr>`; }).join('')}
   </tbody></table></div>${cs.length ? '' : '<p class="note">Los clientes se guardan solos al emitir una factura, o añádelos aquí.</p>'}</div>`;
}
function clientForm(c) {
  c = c || {id: '', nom: '', nif: '', dir: '', email: '', irpf: 0};
  $('#cform').innerHTML = `<div class="card" style="background:#f6f8f7"><div class="grid"><div><label>Nombre / razón social</label><input id="cn" value="${esc(c.nom)}">
   <label>NIF/CIF</label><input id="cf" value="${esc(c.nif)}"></div>
   <div><label>Dirección</label><input id="cd" value="${esc(c.dir)}"><label>Email</label><input id="ce" value="${esc(c.email)}">
   <label>IRPF por defecto</label><select id="ci">${[0, 15, 7, 1, 19].map(v => `<option value="${v}"${v === num(c.irpf) ? ' selected' : ''}>${v} %</option>`).join('')}</select></div></div>
   <div class="bar" style="margin-top:10px"><button data-act="saveClient" data-id="${c.id}">Guardar cliente</button><button class="g" data-act="routeNow">Cancelar</button></div></div>`;
}

function vGastos() {
  const ex = S.expenses.slice().sort((a, b) => b.fecha.localeCompare(a.fecha));
  $('#app').innerHTML = `<div class="card"><h2>Gastos deducibles</h2>
   <p class="note">Apunta tus facturas recibidas (material, cuota de autónomos, suministros…) para calcular IVA soportado y el modelo 130.</p>
   <div class="row"><div><label>Fecha</label><input id="gf" type="date" value="${today()}"></div>
    <div><label>Concepto</label><input id="gc"></div><div><label>Proveedor</label><input id="gp"></div>
    <div><label>Base (€)</label><input id="gb" inputmode="decimal"></div>
    <div><label>IVA</label><select id="gi"><option>21</option><option>10</option><option>4</option><option>0</option></select></div>
    <div style="flex:0 0 auto;align-self:end"><button data-act="addExp">Añadir</button></div></div>
   <div style="overflow-x:auto;margin-top:12px"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Proveedor</th><th class="n">Base</th><th class="n">IVA</th><th></th></tr></thead><tbody>
   ${ex.map(e => `<tr><td>${esc(e.fecha)}</td><td>${esc(e.conc)}</td><td>${esc(e.prov)}</td><td class="n">${eur(e.base)}</td><td class="n">${e.iva} % · ${eur(r2(e.base * e.iva / 100))}</td>
    <td class="n"><button class="s d" data-act="delExp" data-id="${e.id}">Borrar</button></td></tr>`).join('')}</tbody></table></div></div>`;
}

function quarterOf(iso) { return Math.floor((parseInt(iso.slice(5, 7), 10) - 1) / 3) + 1; }
function vResumen() {
  const now = new Date(), y0 = now.getFullYear(), q0 = Math.floor(now.getMonth() / 3) + 1;
  const y = +(sessionStorage.getItem('fy_y') || y0), q = +(sessionStorage.getItem('fy_q') || q0);
  const inQ = (iso, Q) => iso.startsWith(y) && quarterOf(iso) === Q;
  const fact = S.docs.filter(d => d.type === 'factura');
  // 303
  const fq = fact.filter(d => inQ(d.fecha, q)), eq = S.expenses.filter(e => inQ(e.fecha, q));
  const byRate = {};
  fq.forEach(d => totals(d).rows.forEach(r => { const o = byRate[r.k] || (byRate[r.k] = {b: 0, i: 0}); o.b += r.b; o.i += r.i; }));
  const rep = r2(Object.values(byRate).reduce((a, o) => a + o.i, 0));
  const sop = r2(eq.reduce((a, e) => a + e.base * e.iva / 100, 0));
  // 130 acumulado
  let pagado = 0, r130 = 0, ing = 0, gas = 0, ret = 0;
  for (let Q = 1; Q <= q; Q++) {
    fact.filter(d => inQ(d.fecha, Q)).forEach(d => { const t = totals(d); ing += t.base; ret += t.ret; });
    S.expenses.filter(e => inQ(e.fecha, Q)).forEach(e => gas += e.base);
    r130 = r2(0.2 * Math.max(0, ing - gas) - ret - pagado);
    if (Q < q) pagado += Math.max(0, r130);
  }
  const yrs = []; for (let i = y0; i >= y0 - 4; i--) yrs.push(i);
  $('#app').innerHTML = `<div class="card"><div class="bar"><h2 style="margin:0">Resumen trimestral</h2><span class="sp"></span>
   <select id="ry" style="width:auto">${yrs.map(v => `<option${v === y ? ' selected' : ''}>${v}</option>`).join('')}</select>
   <select id="rq" style="width:auto">${[1, 2, 3, 4].map(v => `<option value="${v}"${v === q ? ' selected' : ''}>${v}T</option>`).join('')}</select></div>
   <div class="warn">Cálculo orientativo para preparar tus modelos. Revísalo con tu gestor antes de presentar: no contempla deducciones especiales, compensaciones ni regímenes distintos de estimación directa simplificada.</div>
   <div class="grid" style="margin-top:14px">
    <div><h3>Modelo 303 (IVA) · ${q}T ${y}</h3><table>
     ${Object.keys(byRate).sort((a, b) => b - a).map(k => `<tr><td>Base ${k} %</td><td class="n">${eur(r2(byRate[k].b))}</td><td class="n">IVA ${eur(r2(byRate[k].i))}</td></tr>`).join('') || '<tr><td colspan="3" class="note">Sin facturas emitidas en el trimestre.</td></tr>'}
     <tr><td><b>IVA repercutido</b></td><td></td><td class="n"><b>${eur(rep)}</b></td></tr>
     <tr><td><b>IVA soportado (gastos)</b></td><td></td><td class="n"><b>${eur(sop)}</b></td></tr>
     <tr><td><b>${rep - sop >= 0 ? 'A ingresar' : 'A compensar / devolver'}</b></td><td></td><td class="n"><b>${eur(r2(rep - sop))}</b></td></tr></table></div>
    <div><h3>Modelo 130 (IRPF) · acumulado hasta ${q}T</h3><table>
     <tr><td>Ingresos (base)</td><td class="n">${eur(r2(ing))}</td></tr>
     <tr><td>Gastos deducibles</td><td class="n">${eur(r2(gas))}</td></tr>
     <tr><td>Rendimiento neto</td><td class="n">${eur(r2(ing - gas))}</td></tr>
     <tr><td>20 % del rendimiento</td><td class="n">${eur(r2(0.2 * Math.max(0, ing - gas)))}</td></tr>
     <tr><td>Retenciones soportadas</td><td class="n">−${eur(r2(ret))}</td></tr>
     <tr><td>Pagos de trimestres anteriores</td><td class="n">−${eur(r2(pagado))}</td></tr>
     <tr><td><b>Resultado</b></td><td class="n"><b>${eur(Math.max(0, r130))}</b></td></tr></table></div>
   </div></div>`;
  $('#ry').onchange = e => { sessionStorage.setItem('fy_y', e.target.value); vResumen(); };
  $('#rq').onchange = e => { sessionStorage.setItem('fy_q', e.target.value); vResumen(); };
}

function vAjustes() {
  const s = S.settings;
  const f = (id, l, v, ph) => `<label>${l}</label><input id="${id}" value="${esc(v)}" placeholder="${ph || ''}">`;
  $('#app').innerHTML = `<div class="card"><h2>Tus datos de emisor</h2><div class="grid"><div>
   ${f('sn', 'Nombre y apellidos / razón social', s.nom)}${f('sf', 'NIF', s.nif)}${f('sd', 'Dirección fiscal', s.dir)}</div><div>
   ${f('se', 'Email', s.email)}${f('st', 'Teléfono', s.tel)}${f('si', 'IBAN para cobros', s.iban)}</div></div>
   <div class="row"><div>${f('ss', 'Prefijo de serie (vacío = F / P)', s.serie, 'F')}</div>
    <div><label>IVA por defecto</label><select id="sv">${[21, 10, 4, 0].map(v => `<option${v === num(s.defIva) ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
    <div><label>IRPF por defecto</label><select id="sr">${[0, 15, 7].map(v => `<option${v === num(s.defIrpf) ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
    <div>${f('sp', 'Plazo de pago (días)', s.plazo)}</div></div>
   <label>Logo (opcional)</label><input id="slogo" type="file" accept="image/*">
   ${s.logo ? `<p><img src="${esc(s.logo)}" alt="" style="max-height:60px"> <button class="s d" data-act="rmLogo">Quitar logo</button></p>` : ''}
   <div class="bar" style="margin-top:12px"><button data-act="saveSet">Guardar ajustes</button></div></div>
  <div class="card"><h2>Copia de seguridad</h2>
   <p class="note">Tus datos solo existen en este navegador. Si borras los datos del navegador o cambias de equipo, los pierdes. Descarga una copia a menudo.</p>
   <div class="bar"><button data-act="backup">Descargar copia (.json)</button>
   <label class="btn g" style="margin:0">Restaurar copia<input id="rest" type="file" accept=".json" class="hidden"></label>
   <button class="d" data-act="wipe">Borrar todos los datos</button></div></div>`;
  $('#slogo').onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => { const k = Math.min(1, 300 / img.width), c = document.createElement('canvas');
      c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      S.settings.logo = c.toDataURL('image/png'); URL.revokeObjectURL(url); save(); vAjustes(); };
    img.src = url;
  };
  $('#rest').onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    const rd = new FileReader();
    rd.onload = () => { try { const o = JSON.parse(rd.result);
      if (!o || !Array.isArray(o.docs) || !Array.isArray(o.clients)) throw 0;
      if (!confirm('Esto reemplazará los datos actuales. ¿Continuar?')) return;
      localStorage.setItem(KEY, JSON.stringify(o)); S = load(); route(); alert('Copia restaurada.');
    } catch (err) { alert('El archivo no es una copia válida de FacturaYa.'); } };
    rd.readAsText(file);
  };
}

function download(name, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type: mime})); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ---------- acciones ----------
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, id = b.dataset.id, doc = () => S.docs.find(d => d.id === id);
  const A = {
    new: () => { D = newDoc(b.dataset.t); go('editor'); route(); },
    edit: () => { D = JSON.parse(JSON.stringify(doc() || D)); go('editor'); route(); },
    view: () => { D = doc(); go('doc'); route(); },
    back: () => { D = null; go('facturas'); },
    cancel: () => { D = null; go('facturas'); },
    saveDoc, print: () => window.print(),
    addLine: () => { D.lines.push({d: '', q: 1, p: 0, iva: num(S.settings.defIva)}); D._redraw(); },
    rmLine: () => { D.lines.splice(+b.dataset.i, 1); if (!D.lines.length) D.lines = [{d: '', q: 1, p: 0, iva: num(S.settings.defIva)}]; D._redraw(); drawTot(); },
    paid: () => { doc().estado = 'cobrada'; save(); route(); },
    del: () => { if (confirm('¿Borrar este documento? Las facturas emitidas no deberían borrarse; considera rectificarlas.')) { S.docs = S.docs.filter(d => d.id !== id); save(); route(); } },
    dup: () => { const c = JSON.parse(JSON.stringify(doc())); c.id = uid(); c.type = doc().type; c.num = nextNum(c.type); c.fecha = today(); c.estado = c.type === 'factura' ? 'pendiente' : 'borrador'; D = c; go('editor'); route(); },
    tofact: () => { const c = JSON.parse(JSON.stringify(doc())); c.id = uid(); c.type = 'factura'; c.num = nextNum('factura'); c.fecha = today(); c.venc = addDays(today(), S.settings.plazo || 0); c.estado = 'pendiente'; D = c; go('editor'); route(); },
    csv: () => {
      const rows = [['Tipo', 'Numero', 'Fecha', 'Cliente', 'NIF', 'Base', 'IVA', 'Recargo', 'IRPF', 'Total', 'Estado']];
      S.docs.forEach(d => { const t = totals(d); rows.push([d.type, d.num, d.fecha, d.client.nom, d.client.nif, t.base, t.iva, t.rec, t.ret, t.total, estado(d)]); });
      const q = v => { v = String(v).replace(/"/g, '""'); v = /^[=+\-@\t\r]/.test(v) ? "'" + v : v; return '"' + v + '"'; };
      download('facturaya-' + today() + '.csv', '﻿' + rows.map(r => r.map((v, i) => typeof v === 'number' ? String(v).replace('.', ',') : q(v)).join(';')).join('\r\n'), 'text/csv');
    },
    newClient: () => clientForm(),
    editClient: () => clientForm(S.clients.find(c => c.id === id)),
    routeNow: route,
    saveClient: () => {
      const c = {id: id || uid(), nom: $('#cn').value.trim(), nif: $('#cf').value.trim(), dir: $('#cd').value.trim(), email: $('#ce').value.trim(), irpf: num($('#ci').value)};
      if (!c.nom) return alert('Indica el nombre.');
      const i = S.clients.findIndex(x => x.id === c.id); if (i >= 0) S.clients[i] = c; else S.clients.push(c);
      save(); route();
    },
    delClient: () => { if (confirm('¿Borrar cliente? Sus facturas se conservan.')) { S.clients = S.clients.filter(c => c.id !== id); save(); route(); } },
    addExp: () => {
      const base = num($('#gb').value), conc = $('#gc').value.trim();
      if (!conc || !base) return alert('Indica concepto y base.');
      S.expenses.push({id: uid(), fecha: $('#gf').value || today(), conc, prov: $('#gp').value.trim(), base, iva: num($('#gi').value)});
      save(); route();
    },
    delExp: () => { S.expenses = S.expenses.filter(x => x.id !== id); save(); route(); },
    saveSet: () => {
      Object.assign(S.settings, {nom: $('#sn').value.trim(), nif: $('#sf').value.trim(), dir: $('#sd').value.trim(), email: $('#se').value.trim(),
        tel: $('#st').value.trim(), iban: $('#si').value.trim(), serie: $('#ss').value.trim().replace(/[^A-Za-z0-9]/g, ''),
        defIva: num($('#sv').value), defIrpf: num($('#sr').value), plazo: Math.max(0, parseInt($('#sp').value, 10) || 0)});
      save(); alert('Ajustes guardados.');
    },
    rmLogo: () => { delete S.settings.logo; save(); vAjustes(); },
    backup: () => download('facturaya-copia-' + today() + '.json', JSON.stringify(S), 'application/json'),
    wipe: () => { if (confirm('Se borrarán TODAS tus facturas, clientes y gastos. ¿Seguro?') && confirm('Última confirmación: no se puede deshacer.')) { localStorage.removeItem(KEY); S = load(); route(); } }
  };
  if (A[act]) A[act]();
});

route();
