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

/* ---- Misc ------------------------------------------------------------------- */
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function debounce(fn, ms) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
