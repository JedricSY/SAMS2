let ME = null;
let STATE = { settings: {}, sections: [], students: [] };

(async function init() {
  ME = SAMS.requireAuth('teacher');
  if (!ME) return;
  document.getElementById('tb-who').textContent = ME.name;
  document.getElementById('logout-btn').addEventListener('click', SAMS.logout);
  wireTabs();
  wireStaticButtons();
  await loadBootstrap();
  document.getElementById('day-select').value = todayIso();
  document.getElementById('report-start').value = isoDaysAgo(6);
  document.getElementById('report-end').value = todayIso();
})();

async function loadBootstrap() {
  try {
    const data = await SAMS.call('bootstrap', {});
    STATE.settings = data.settings; STATE.sections = data.sections; STATE.students = data.students;
    applyBranding();
    document.getElementById('no-section-msg').style.display = STATE.sections.length ? 'none' : 'block';

    const wrap = document.getElementById('section-picker-wrap');
    if (STATE.sections.length > 1) {
      wrap.style.display = 'block';
      const sel = document.getElementById('student-section-filter');
      sel.innerHTML = '<option value="">All my sections</option>' + STATE.sections.map((s) => '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>').join('');
    } else { wrap.style.display = 'none'; }

    renderOverview();
    renderStudents();
    renderDayRoster();
    document.querySelector('#me-photo .avatar').src = avatarSrc(data.me.photoUrl, data.me.name);
  } catch (err) { toast(err.message, 'error'); }
}

function applyBranding() {
  document.getElementById('tb-school').textContent = STATE.settings.schoolName || 'SAMS';
  if (STATE.settings.logoUrl) {
    const img = document.getElementById('tb-logo');
    img.src = STATE.settings.logoUrl; img.style.display = 'block';
  }
  applyThemeFromLogo(STATE.settings);
}

/* ---- Tabs ------------------------------------------------------------- */
function wireTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));
}
function switchView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelector('.tab-btn[data-view="' + name + '"]').classList.add('active');
  if (name === 'scanner') {
    stopScanner(); scannerRunning = false; document.getElementById('scanner-toggle').textContent = 'Start Scanner';
  } else {
    exitScannerFullscreen(); stopScanner(); scannerRunning = false;
  }
}

/* ---- Overview ------------------------------------------------------------- */
async function renderOverview() {
  const host = document.getElementById('stat-tiles');
  if (!STATE.sections.length) { host.innerHTML = ''; return; }
  host.innerHTML = '<div class="text-soft">Loading live stats…</div>';
  try {
    const s = await SAMS.call('stats', {});
    host.innerHTML = ['today', 'week', 'month'].map((k) => statTile(k, s[k], s.totalStudents)).join('');
  } catch (err) { host.innerHTML = '<div class="text-soft">' + escapeHtml(err.message) + '</div>'; }
}
function statTile(label, d, total) {
  const titles = { today: 'Today', week: 'This Week', month: 'This Month' };
  return '<div class="stat-tile"><div class="label">' + titles[label] + '</div>' +
    '<div class="value">' + d.present + '<span style="font-size:1rem;color:var(--ink-soft)">/' + total + '</span></div>' +
    '<div class="breakdown">' +
    '<span><span class="dot present"></span>' + d.present + ' Present</span>' +
    '<span><span class="dot late"></span>' + d.late + ' Late</span>' +
    '<span><span class="dot absent"></span>' + d.absent + ' Absent</span>' +
    '</div></div>';
}

/* ---- Students -------------------------------------------------------------- */
function renderStudents() {
  const sectionFilter = document.getElementById('student-section-filter') ? document.getElementById('student-section-filter').value : '';
  const q = (document.getElementById('student-search').value || '').toLowerCase();
  let rows = STATE.students;
  if (sectionFilter) rows = rows.filter((s) => s.sectionId === sectionFilter);
  if (q) rows = rows.filter((s) => s.name.toLowerCase().includes(q) || (s.lrn || '').toLowerCase().includes(q));

  const host = document.getElementById('students-list');
  if (!rows.length) { host.innerHTML = emptyState('🧒', 'No students found.'); return; }
  host.innerHTML = rows.map((s) => {
    const sec = STATE.sections.find((x) => x.id === s.sectionId);
    return '<div class="list-row"><img class="avatar" src="' + avatarSrc(s.photoUrl, s.name) + '" alt="">' +
      '<div class="meta"><div class="name">' + escapeHtml(s.name) + '</div>' +
      '<div class="sub">' + (s.lrn ? 'LRN ' + escapeHtml(s.lrn) + ' &middot; ' : '') + (sec ? escapeHtml(sec.name) : '') + '</div></div>' +
      '<div class="row-actions">' +
      '<button class="btn secondary sm" onclick="openQrModal(\'' + s.id + '\')">QR</button>' +
      '<button class="btn secondary sm" onclick="openStudentModal(\'' + s.id + '\')">Edit</button>' +
      '<button class="btn danger sm" onclick="deleteStudent(\'' + s.id + '\')">Delete</button>' +
      '</div></div>';
  }).join('');
}
document.addEventListener('input', (e) => { if (e.target.id === 'student-search') renderStudents(); });
document.addEventListener('change', (e) => { if (e.target.id === 'student-section-filter') renderStudents(); });

function openStudentModal(id) {
  if (!STATE.sections.length) { toast('You are not assigned to a section yet', 'error'); return; }
  const s = id ? STATE.students.find((x) => x.id === id) : null;
  const sectionSelect = STATE.sections.length > 1
    ? '<div class="field"><label>Section</label><select id="m-s-section">' +
      STATE.sections.map((sec) => '<option value="' + sec.id + '" ' + (s && s.sectionId === sec.id ? 'selected' : '') + '>' + escapeHtml(sec.name) + '</option>').join('') +
      '</select></div>'
    : '<input type="hidden" id="m-s-section" value="' + STATE.sections[0].id + '">';
  openModal(
    '<h3>' + (s ? 'Edit Student' : 'New Student') + '</h3>' +
    '<div class="photo-picker" id="m-student-photo"><img class="avatar" alt=""><div><button type="button" class="btn secondary sm pick-btn">Upload Photo</button><input type="file" accept="image/*"></div></div>' +
    '<div class="field mt-16"><label>Full name</label><input type="text" id="m-s-name" value="' + (s ? escapeHtml(s.name) : '') + '"></div>' +
    '<div class="field"><label>LRN / Student ID</label><input type="text" id="m-s-lrn" value="' + (s ? escapeHtml(s.lrn) : '') + '"></div>' +
    sectionSelect +
    '<div class="field"><label>Guardian contact</label><input type="text" id="m-s-guardian" value="' + (s ? escapeHtml(s.guardianContact) : '') + '"></div>' +
    '<button class="btn block mt-16" onclick="saveStudent(' + (s ? "'" + s.id + "'" : 'null') + ')">Save Student</button>'
  );
  const picker = wirePhotoPicker(document.getElementById('m-student-photo'), s ? s.photoUrl : '', s ? s.name : 'New');
  document.getElementById('m-student-photo').__picker = picker;
}
async function saveStudent(id) {
  const picker = document.getElementById('m-student-photo').__picker;
  const base64 = picker.getBase64();
  try {
    let photoUrl;
    if (base64) {
      const up = await SAMS.call('uploadImage', { base64, type: 'studentPhoto', mimeType: 'image/jpeg' });
      photoUrl = up.url;
    }
    const payload = {
      id: id || undefined,
      name: document.getElementById('m-s-name').value.trim(),
      lrn: document.getElementById('m-s-lrn').value.trim(),
      sectionId: document.getElementById('m-s-section').value,
      guardianContact: document.getElementById('m-s-guardian').value.trim(),
      photoUrl: photoUrl
    };
    if (!payload.name) { toast('Student name is required', 'error'); return; }
    if (id) await SAMS.call('updateStudent', { student: payload });
    else await SAMS.call('createStudent', { student: payload });
    closeModal(); toast('Student saved', 'success'); await loadBootstrap();
  } catch (err) { toast(err.message, 'error'); }
}
async function deleteStudent(id) {
  if (!confirm('Remove this student? Their attendance history is kept.')) return;
  try { await SAMS.call('deleteStudent', { studentId: id }); toast('Student removed', 'success'); await loadBootstrap(); }
  catch (err) { toast(err.message, 'error'); }
}

function openQrModal(id) {
  const s = STATE.students.find((x) => x.id === id);
  openModal(
    '<h3>Student QR Code</h3>' +
    '<div class="qr-card"><div class="name" style="font-weight:700">' + escapeHtml(s.name) + '</div>' +
    '<div id="qr-canvas-holder"></div>' +
    '<div class="id-strip">' + (s.lrn ? 'LRN ' + escapeHtml(s.lrn) : escapeHtml(s.id)) + '</div>' +
    '<button class="btn block mt-16" onclick="downloadQr(\'' + escapeHtml(s.name) + '\')">Download PNG</button></div>'
  );
  renderQrInto(document.getElementById('qr-canvas-holder'), id);
}
function downloadQr(name) {
  const canvas = document.querySelector('#qr-canvas-holder canvas');
  if (!canvas) return;
  const a = document.createElement('a');
  a.download = 'QR_' + name.replace(/\s+/g, '_') + '.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
}

/* ---- Day roster -------------------------------------------------------------- */
document.getElementById('day-select').addEventListener('change', renderDayRoster);
async function renderDayRoster() {
  const date = document.getElementById('day-select').value || todayIso();
  const host = document.getElementById('day-roster');
  host.innerHTML = '<div class="text-soft">Loading…</div>';
  try {
    const res = await SAMS.call('dayStatus', { date });
    if (!res.roster.length) { host.innerHTML = emptyState('📋', 'No students to show.'); return; }
    host.innerHTML = res.roster.map((r) => (
      '<div class="list-row"><img class="avatar" src="' + avatarSrc(r.photoUrl, r.name) + '" alt="">' +
      '<div class="meta"><div class="name">' + escapeHtml(r.name) + '</div><div class="sub">' + (r.lrn || '') + '</div></div>' +
      '<span class="stamp ' + r.status.toLowerCase() + '">' + r.status + (r.timeIn ? ' · ' + r.timeIn : '') + '</span></div>'
    )).join('');
  } catch (err) { host.innerHTML = '<div class="text-soft">' + escapeHtml(err.message) + '</div>'; }
}

/* ---- Scanner ------------------------------------------------------------------ */
let scannerRunning = false;
document.getElementById('scanner-toggle').addEventListener('click', async () => {
  const btn = document.getElementById('scanner-toggle');
  if (!scannerRunning) { await startScanner('qr-reader', onScan); scannerRunning = true; btn.textContent = 'Stop Scanner'; }
  else { await stopScanner(); scannerRunning = false; btn.textContent = 'Start Scanner'; }
});
document.getElementById('scanner-fullscreen-btn').addEventListener('click', async () => {
  enterScannerFullscreen();
  if (!scannerRunning) {
    await startScanner('qr-reader', onScan);
    scannerRunning = true; document.getElementById('scanner-toggle').textContent = 'Stop Scanner';
  }
});
function onScannerFsClose() {
  stopScanner(); scannerRunning = false; document.getElementById('scanner-toggle').textContent = 'Start Scanner';
}
let lastScanTs = 0;
async function onScan(text) {
  const now = Date.now();
  if (now - lastScanTs < 2500) return;
  lastScanTs = now;
  try {
    const res = await SAMS.call('scanAttendance', { qrData: text, location: 'Classroom' });
    const badgeClass = res.attendance.status === 'Present' ? 'present' : 'late';
    document.getElementById('scan-result').innerHTML =
      '<div class="card"><img class="avatar" src="' + avatarSrc(res.student.photoUrl, res.student.name) + '" alt="">' +
      '<div class="meta"><div class="name">' + escapeHtml(res.student.name) + '</div>' +
      '<div class="sub">' + (res.alreadyRecorded ? 'Already recorded today' : 'Time in ' + res.attendance.timeIn) + '</div>' +
      '<span class="stamp ' + badgeClass + '">' + res.attendance.status + '</span></div></div>';
    const sec = STATE.sections.find((x) => x.id === res.student.sectionId);
    updateFullscreenScanResult(res.student, sec ? sec.name : '', res.attendance.status);
  } catch (err) { toast(err.message, 'error'); }
}

/* ---- Reports --------------------------------------------------------------------- */
document.getElementById('report-generate').addEventListener('click', async () => {
  const startDate = document.getElementById('report-start').value;
  const endDate = document.getElementById('report-end').value;
  if (!startDate || !endDate) { toast('Choose a start and end date', 'error'); return; }
  try {
    const res = await SAMS.call('generateReport', { startDate, endDate });
    downloadCsv(res.filename, res.csv);
    document.getElementById('report-hint').textContent = 'Downloaded ' + res.rowCount + ' rows.';
  } catch (err) { toast(err.message, 'error'); }
});

/* ---- Account --------------------------------------------------------------------- */
document.getElementById('me-photo-save').addEventListener('click', async () => {
  const picker = document.getElementById('me-photo').__picker;
  if (!picker.getBase64()) { toast('Choose a photo first', 'error'); return; }
  try {
    const up = await SAMS.call('uploadImage', { base64: picker.getBase64(), type: 'teacherPhoto', mimeType: 'image/jpeg' });
    await SAMS.call('updateMyProfile', { profile: { photoUrl: up.url } });
    toast('Photo updated', 'success');
  } catch (err) { toast(err.message, 'error'); }
});
document.getElementById('pw-save').addEventListener('click', async () => {
  try {
    await SAMS.call('changePassword', { oldPassword: document.getElementById('pw-old').value, newPassword: document.getElementById('pw-new').value });
    document.getElementById('pw-old').value = ''; document.getElementById('pw-new').value = '';
    toast('Password changed', 'success');
  } catch (err) { toast(err.message, 'error'); }
});

function wireStaticButtons() {
  document.getElementById('add-student-btn').addEventListener('click', () => openStudentModal(null));
  document.getElementById('import-students-btn').addEventListener('click', () => openBulkImportStudentsModal());
  document.getElementById('bulk-qr-btn').addEventListener('click', () => openBulkQrModal());
  const picker = wirePhotoPicker(document.getElementById('me-photo'), '', 'Me');
  document.getElementById('me-photo').__picker = picker;
}

function emptyState(icon, text) { return '<div class="empty-state"><div class="big">' + icon + '</div>' + text + '</div>'; }
