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

/* ---- Misc ------------------------------------------------------------------- */
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function debounce(fn, ms) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
