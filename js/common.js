/* ---- Toasts ------------------------------------------------------------ */
function toast(message, type) {
  const host = document.getElementById('toast-host');
  if (!host) { alert(message); return; }
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

/* ---- Modal --------------------------------------------------------------- */
function openModal(innerHtml) {
  let backdrop = document.getElementById('modal-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'modal-backdrop';
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = '<div class="modal" id="modal-body"></div>';
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
  }
  document.getElementById('modal-body').innerHTML = innerHtml;
  backdrop.classList.add('open');
}
function closeModal() {
  const backdrop = document.getElementById('modal-backdrop');
  if (backdrop) backdrop.classList.remove('open');
}

/* ---- Images -------------------------------------------------------------- */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function avatarSrc(url, name) {
  if (url) return url;
  return 'https://ui-avatars.com/api/?background=e7ecf7&color=16264b&name=' + encodeURIComponent(name || '?');
}

/* Wires up a .photo-picker block: click avatar -> pick file -> preview -> upload on save.
   Returns { getBase64, avatarEl } so the caller can read the pending base64 at submit time. */
function wirePhotoPicker(containerEl, currentUrl, name) {
  const avatar = containerEl.querySelector('.avatar');
  const input = containerEl.querySelector('input[type=file]');
  avatar.src = avatarSrc(currentUrl, name);
  let pendingBase64 = null;
  containerEl.querySelector('.pick-btn').addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    pendingBase64 = await fileToBase64(file);
    avatar.src = pendingBase64;
  });
  return { getBase64: () => pendingBase64 };
}

/* ---- CSV download --------------------------------------------------------- */
function downloadCsv(filename, csvText) {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ---- CSV parsing (for bulk import) ------------------------------------------
   Small hand-rolled parser: handles quoted fields, escaped quotes ("") and
   commas/newlines inside quotes. Good enough for simple student/teacher rosters
   without pulling in a library. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c === '\r') {
      // ignore, \n handles the line break
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell !== ''));
}

/* Turns CSV text into an array of objects keyed by the header row. */
function csvToObjects(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] !== undefined ? String(r[idx]).trim() : ''); });
    return obj;
  });
}

/* ---- Dates ----------------------------------------------------------------- */
function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function prettyDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/* ---- QR: generate a code for a student id into a container element -------- */
function renderQrInto(el, studentId) {
  el.innerHTML = '';
  // eslint-disable-next-line no-undef
  new QRCode(el, { text: 'SAMS:' + studentId, width: 190, height: 190, colorDark: '#16264b', colorLight: '#ffffff' });
}

/* ---- QR scanner wrapper (html5-qrcode) ------------------------------------- */
let __activeScanner = null;
async function startScanner(elementId, onDecoded) {
  await stopScanner();
  // eslint-disable-next-line no-undef
  __activeScanner = new Html5Qrcode(elementId);
  const config = { fps: 10, qrbox: { width: 220, height: 220 } };
  try {
    await __activeScanner.start({ facingMode: 'environment' }, config, (decodedText) => {
      onDecoded(decodedText);
    });
  } catch (err) {
    toast('Camera error: ' + err, 'error');
  }
}
async function stopScanner() {
  if (__activeScanner) {
    try { await __activeScanner.stop(); await __activeScanner.clear(); } catch (e) { /* noop */ }
    __activeScanner = null;
  }
}

/* ---- Bulk import (CSV) -------------------------------------------------------
   Shared by admin.js (students + teachers) and teacher.js (students only).
   Callers must have a global STATE.sections array and a loadBootstrap() function
   in scope to resolve section names and refresh the view after import. */
function openBulkImportStudentsModal() {
  if (!STATE.sections || !STATE.sections.length) { toast('You need at least one section before importing students', 'error'); return; }
  openModal(
    '<h3>Bulk Import Students</h3>' +
    '<p class="hint">CSV columns: <span class="mono">name, lrn, sectionName, guardianContact</span>. ' +
    '<code class="mono">sectionName</code> must match an existing section name exactly (case-insensitive).</p>' +
    '<button type="button" class="btn secondary sm" id="m-import-template">Download CSV Template</button>' +
    '<div class="field mt-16"><label>CSV file</label><input type="file" accept=".csv,text/csv" id="m-import-file"></div>' +
    '<div id="import-result" class="hint mt-8"></div>' +
    '<button class="btn block mt-16" id="m-import-run">Import Students</button>'
  );
  document.getElementById('m-import-template').addEventListener('click', () => {
    downloadCsv('students_template.csv', 'name,lrn,sectionName,guardianContact\n');
  });
  document.getElementById('m-import-run').addEventListener('click', () => runBulkImport('bulkImportStudents', 'student(s)'));
}

function openBulkImportTeachersModal() {
  openModal(
    '<h3>Bulk Import Teachers</h3>' +
    '<p class="hint">CSV columns: <span class="mono">name, username, email, password</span>. Leave <code class="mono">password</code> blank to use the default temporary password.</p>' +
    '<button type="button" class="btn secondary sm" id="m-import-template">Download CSV Template</button>' +
    '<div class="field mt-16"><label>CSV file</label><input type="file" accept=".csv,text/csv" id="m-import-file"></div>' +
    '<div id="import-result" class="hint mt-8"></div>' +
    '<button class="btn block mt-16" id="m-import-run">Import Teachers</button>'
  );
  document.getElementById('m-import-template').addEventListener('click', () => {
    downloadCsv('teachers_template.csv', 'name,username,email,password\n');
  });
  document.getElementById('m-import-run').addEventListener('click', () => runBulkImport('bulkImportTeachers', 'teacher(s)'));
}

async function runBulkImport(action, noun) {
  const fileInput = document.getElementById('m-import-file');
  const file = fileInput.files[0];
  if (!file) { toast('Choose a CSV file first', 'error'); return; }
  const text = await file.text();
  const rows = csvToObjects(text);
  if (!rows.length) { toast('No rows found in that CSV', 'error'); return; }
  const btn = document.getElementById('m-import-run');
  const originalLabel = btn.textContent;
  btn.disabled = true; btn.textContent = 'Importing…';
  try {
    const res = await SAMS.call(action, { rows });
    const resultHost = document.getElementById('import-result');
    resultHost.textContent = 'Imported ' + res.created + ' ' + noun + '.' +
      (res.failed.length ? ' ' + res.failed.length + ' row(s) failed (bad name/username/section) — see below.' : '');
    if (res.failed.length) {
      resultHost.innerHTML += '<br>' + res.failed.map((f) => 'Row ' + f.row + ': ' + escapeHtml(f.error)).join('<br>');
    }
    toast(res.created + ' ' + noun + ' imported' + (res.failed.length ? ', ' + res.failed.length + ' failed' : ''), res.failed.length ? 'error' : 'success');
    await loadBootstrap();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = originalLabel;
  }
}

/* ---- Auto-theme from the school logo ---------------------------------------
   Samples the logo's pixels on a hidden canvas, picks the most vivid hue as the
   accent color and a secondary hue for the gradient partner, then derives dark
   "navy" shades from the same hue so buttons/topbar/tabs stay legible. Prefers
   settings.logoDataUri (a same-origin data: URI from the backend) because a
   cross-origin <img> — like the Drive-hosted logoUrl — usually can't be read
   into a canvas at all (CORS taints it). Fails silently and keeps the default
   theme if extraction isn't possible for any reason. */
async function applyThemeFromLogo(settings) {
  const src = settings && (settings.logoDataUri || settings.logoUrl);
  if (!src) return;
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = src;
    });
    const palette = extractLogoPalette_(img);
    if (palette) applyThemePalette_(palette);
  } catch (e) { /* couldn't read the logo's pixels — keep the default theme */ }
}

function extractLogoPalette_(img) {
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, size, size);
  let data;
  try { data = ctx.getImageData(0, 0, size, size).data; }
  catch (e) { return null; } // tainted canvas (cross-origin) — bail out

  // Bucket pixels into 15°-wide hue slices, weighted toward saturated, mid-lightness
  // pixels (skips near-white/near-black backgrounds and greys).
  const buckets = {};
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 128) continue;
    const [h, s, l] = rgbToHsl_(r, g, b);
    if (l < 0.08 || l > 0.94 || s < 0.15) continue;
    const key = Math.round(h * 24);
    const weight = s * (1 - Math.abs(l - 0.5) * 0.6);
    if (!buckets[key]) buckets[key] = { h: 0, s: 0, l: 0, w: 0 };
    buckets[key].h += h * weight; buckets[key].s += s * weight; buckets[key].l += l * weight; buckets[key].w += weight;
  }
  const arr = Object.values(buckets).filter((b) => b.w > 0).sort((a, b) => b.w - a.w);
  if (!arr.length) return null;

  const top = arr[0];
  const h1 = top.h / top.w, s1 = top.s / top.w;
  const hueDist = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 1 - d); };
  const second = arr.find((b, idx) => idx > 0 && hueDist(b.h / b.w, h1) > 0.08);
  const h2 = second ? second.h / second.w : (h1 + 0.12) % 1;
  const s2 = second ? second.s / second.w : s1;
  return { h1, s1, h2, s2 };
}

function rgbToHsl_(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h, s, l];
}
function hslToHex_(h, s, l) {
  const hue2rgb = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

function applyThemePalette_(p) {
  const s1 = Math.max(Math.min(p.s1, 0.85), 0.4);
  const s2 = Math.max(Math.min(p.s2, 0.85), 0.4);
  const root = document.documentElement.style;
  root.setProperty('--accent', hslToHex_(p.h1, s1, 0.62));
  root.setProperty('--accent-2', hslToHex_(p.h2, s2, 0.58));
  root.setProperty('--accent-soft', hslToHex_(p.h1, Math.min(s1, 0.55), 0.94));
  root.setProperty('--navy-950', hslToHex_(p.h1, Math.min(s1 * 0.55, 0.45), 0.08));
  root.setProperty('--navy-900', hslToHex_(p.h1, Math.min(s1 * 0.55, 0.45), 0.15));
  root.setProperty('--navy-800', hslToHex_(p.h1, Math.min(s1 * 0.5, 0.4), 0.21));
  root.setProperty('--navy-700', hslToHex_(p.h1, Math.min(s1 * 0.45, 0.38), 0.3));
  root.setProperty('--navy-100', hslToHex_(p.h1, Math.min(s1, 0.35), 0.95));
}

/* ---- Bulk QR Print (per section or hand-picked students) --------------------
   Shared by admin.js and teacher.js. Renders each student's QR into an offscreen
   holder (reusing the same qrcode.js lib as the single-student QR modal), then
   opens a plain print-friendly window with a grid of QR + name + section cards. */
function openBulkQrModal() {
  if (!STATE.students || !STATE.students.length) { toast('No students to print yet', 'error'); return; }
  const sectionOptions = STATE.sections.map((s) => '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>').join('');
  openModal(
    '<h3>Bulk QR Print</h3>' +
    '<div class="field"><label>Print for</label><select id="bqr-mode">' +
    '<option value="section">A whole section</option>' +
    '<option value="select">Hand-picked students</option>' +
    '</select></div>' +
    '<div class="field" id="bqr-section-wrap"><label>Section</label>' +
    '<select id="bqr-section"><option value="">' + (STATE.sections.length > 1 ? 'All my sections' : 'All students') + '</option>' + sectionOptions + '</select></div>' +
    '<div class="field" id="bqr-select-wrap" style="display:none">' +
    '<label class="flex between">Students <button type="button" class="btn ghost sm" id="bqr-select-all" style="padding:2px 8px">Select all</button></label>' +
    '<div id="bqr-student-checks" class="qr-check-list"></div>' +
    '</div>' +
    '<button class="btn block mt-16" id="bqr-run">Generate Print Sheet</button>'
  );
  const modeSel = document.getElementById('bqr-mode');
  const secWrap = document.getElementById('bqr-section-wrap');
  const selWrap = document.getElementById('bqr-select-wrap');
  const checksHost = document.getElementById('bqr-student-checks');

  function renderChecks() {
    checksHost.innerHTML = STATE.students.map((s) => {
      const sec = STATE.sections.find((x) => x.id === s.sectionId);
      return '<label class="qr-check-row"><input type="checkbox" value="' + s.id + '" checked> ' +
        escapeHtml(s.name) + (sec ? ' <span class="text-soft text-sm">&middot; ' + escapeHtml(sec.name) + '</span>' : '') + '</label>';
    }).join('');
  }
  modeSel.addEventListener('change', () => {
    if (modeSel.value === 'select') { secWrap.style.display = 'none'; selWrap.style.display = 'block'; renderChecks(); }
    else { secWrap.style.display = 'block'; selWrap.style.display = 'none'; }
  });
  document.getElementById('bqr-select-all').addEventListener('click', () => {
    checksHost.querySelectorAll('input[type=checkbox]').forEach((cb) => { cb.checked = true; });
  });
  document.getElementById('bqr-run').addEventListener('click', () => {
    let students;
    if (modeSel.value === 'select') {
      const ids = Array.from(checksHost.querySelectorAll('input[type=checkbox]:checked')).map((cb) => cb.value);
      students = STATE.students.filter((s) => ids.includes(s.id));
    } else {
      const sectionId = document.getElementById('bqr-section').value;
      students = sectionId ? STATE.students.filter((s) => s.sectionId === sectionId) : STATE.students;
    }
    if (!students.length) { toast('No students match — choose at least one', 'error'); return; }
    closeModal();
    printQrSheet(students);
  });
}

function printQrSheet(students) {
  const offhost = document.createElement('div');
  offhost.style.position = 'fixed'; offhost.style.left = '-9999px'; offhost.style.top = '0';
  document.body.appendChild(offhost);

  const schoolName = (STATE.settings && STATE.settings.schoolName) || 'SAMS';
  const cards = students.map((s) => {
    const holder = document.createElement('div');
    offhost.appendChild(holder);
    // eslint-disable-next-line no-undef
    new QRCode(holder, { text: 'SAMS:' + s.id, width: 180, height: 180, colorDark: '#16264b', colorLight: '#ffffff' });
    const canvas = holder.querySelector('canvas');
    const dataUrl = canvas ? canvas.toDataURL('image/png') : '';
    const sec = STATE.sections.find((x) => x.id === s.sectionId);
    return '<div class="qr-print-card">' +
      '<img src="' + dataUrl + '" width="150" height="150" alt="">' +
      '<div class="qr-print-name">' + escapeHtml(s.name) + '</div>' +
      '<div class="qr-print-sub">' + (s.lrn ? 'LRN ' + escapeHtml(s.lrn) : '') + (sec ? (s.lrn ? ' &middot; ' : '') + escapeHtml(sec.name) : '') + '</div>' +
      '</div>';
  }).join('');
  document.body.removeChild(offhost);

  const win = window.open('', '_blank');
  if (!win) { toast('Please allow pop-ups to print QR codes', 'error'); return; }
  win.document.write(
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>QR Print — ' + escapeHtml(schoolName) + '</title>' +
    '<style>' +
    'body{font-family:Arial,Helvetica,sans-serif;margin:24px;color:#16264b;}' +
    'h2{margin:0 0 18px;}' +
    '.qr-print-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}' +
    '.qr-print-card{border:1.5px dashed #b7bfd4;border-radius:10px;padding:12px;text-align:center;page-break-inside:avoid;}' +
    '.qr-print-card img{display:block;margin:0 auto 8px;}' +
    '.qr-print-name{font-weight:700;font-size:13px;}' +
    '.qr-print-sub{font-size:11px;color:#656c7e;font-family:monospace;margin-top:2px;}' +
    '@media print{ .qr-print-card{border-color:#ccc;} }' +
    '</style></head><body>' +
    '<h2>' + escapeHtml(schoolName) + ' — Student QR IDs</h2>' +
    '<div class="qr-print-grid">' + cards + '</div>' +
    '<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };<\/script>' +
    '</body></html>'
  );
  win.document.close();
}

/* ---- Full-screen scanner mode ------------------------------------------------
   Shared by admin.js and teacher.js. Moves the existing #qr-reader element (so
   the active camera stream isn't interrupted) into a full-viewport overlay:
   scanner on the left, the scanned student's photo bleeding edge-to-edge on the
   right with name/section overlaid. Each page defines a global onScannerFsClose()
   that stops its own camera and resets its own Start/Stop button label; the close
   (X) button calls it after restoring the DOM. */
let __scannerReaderHome = null;

function getScannerFullscreenOverlay_() {
  let overlay = document.getElementById('scanner-fullscreen-overlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'scanner-fullscreen-overlay';
  overlay.className = 'scanner-fullscreen-overlay';
  overlay.innerHTML =
    '<button class="icon-btn fs-close" id="fs-close-btn" title="Exit full screen" aria-label="Exit full screen">' +
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
    '<div class="fs-scanner-pane"><div id="fs-reader-slot"></div><p class="fs-hint">Point a student\'s QR ID at the camera</p></div>' +
    '<div class="fs-photo-pane" id="fs-photo-pane">' +
    '<div class="fs-placeholder" id="fs-placeholder"><span>🪪</span><div>Waiting for a scan…</div></div>' +
    '<img id="fs-photo" class="fs-photo" alt="" style="display:none">' +
    '<div class="fs-caption" id="fs-caption" style="display:none">' +
    '<div class="fs-name" id="fs-name"></div>' +
    '<div class="fs-section" id="fs-section"></div>' +
    '<span class="stamp" id="fs-stamp"></span>' +
    '</div></div>';
  document.body.appendChild(overlay);
  document.getElementById('fs-close-btn').addEventListener('click', () => {
    exitScannerFullscreen();
    if (typeof onScannerFsClose === 'function') onScannerFsClose();
  });
  return overlay;
}
function enterScannerFullscreen() {
  const overlay = getScannerFullscreenOverlay_();
  const reader = document.getElementById('qr-reader');
  const slot = document.getElementById('fs-reader-slot');
  if (reader && reader.parentNode !== slot) {
    __scannerReaderHome = { parent: reader.parentNode, next: reader.nextSibling };
    slot.appendChild(reader);
  }
  resetFullscreenResult_();
  overlay.classList.add('open');
  document.body.classList.add('no-scroll');
}
function exitScannerFullscreen() {
  const overlay = document.getElementById('scanner-fullscreen-overlay');
  if (overlay) overlay.classList.remove('open');
  document.body.classList.remove('no-scroll');
  const reader = document.getElementById('qr-reader');
  if (reader && __scannerReaderHome) {
    if (__scannerReaderHome.next) __scannerReaderHome.parent.insertBefore(reader, __scannerReaderHome.next);
    else __scannerReaderHome.parent.appendChild(reader);
    __scannerReaderHome = null;
  }
}
function resetFullscreenResult_() {
  const ph = document.getElementById('fs-placeholder');
  if (!ph) return;
  ph.style.display = 'flex';
  document.getElementById('fs-photo').style.display = 'none';
  document.getElementById('fs-caption').style.display = 'none';
}
/** Called from onScan() in admin.js/teacher.js after a successful scan; no-op if fullscreen isn't open. */
function updateFullscreenScanResult(student, sectionName, statusLabel) {
  const overlay = document.getElementById('scanner-fullscreen-overlay');
  if (!overlay || !overlay.classList.contains('open')) return;
  document.getElementById('fs-placeholder').style.display = 'none';
  const img = document.getElementById('fs-photo');
  img.src = avatarSrc(student.photoUrl, student.name);
  img.style.display = 'block';
  document.getElementById('fs-name').textContent = student.name;
  document.getElementById('fs-section').textContent = sectionName || '';
  const stampEl = document.getElementById('fs-stamp');
  stampEl.textContent = statusLabel || '';
  stampEl.className = 'stamp ' + (statusLabel || '').toLowerCase();
  document.getElementById('fs-caption').style.display = 'block';
}

/* ---- Misc ------------------------------------------------------------------- */
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function debounce(fn, ms) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
