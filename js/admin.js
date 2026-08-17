let ME = null;
let STATE = { settings: {}, teachers: [], sections: [], students: [] };

(async function init() {
  ME = SAMS.requireAuth('admin');
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
    STATE.settings = data.settings; STATE.teachers = data.teachers;
    STATE.sections = data.sections; STATE.students = data.students;
    applyBranding();
    renderOverview();
    renderSections();
    renderTeachers();
    renderStudents();
    fillSectionSelects();
    renderDayRoster();
  } catch (err) { toast(err.message, 'error'); }
}

function applyBranding() {
  document.getElementById('tb-school').textContent = STATE.settings.schoolName || 'SAMS';
  if (STATE.settings.logoUrl) {
    const img = document.getElementById('tb-logo');
    img.src = STATE.settings.logoUrl; img.style.display = 'block';
  }
  document.getElementById('settings-school-name').value = STATE.settings.schoolName || '';
  document.getElementById('settings-late-cutoff').value = STATE.settings.lateCutoff || '08:00';
  document.querySelector('#logo-picker .avatar').src = avatarSrc(STATE.settings.logoUrl, 'Logo');
}

/* ---- Tabs -------------------------------------------------------------- */
function wireTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}
function switchView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelector('.tab-btn[data-view="' + name + '"]').classList.add('active');
  if (name === 'scanner') stopScanner();
}

/* ---- Overview / stats --------------------------------------------------- */
async function renderOverview() {
  const host = document.getElementById('stat-tiles');
  host.innerHTML = '<div class="text-soft">Loading live stats…</div>';
  try {
    const s = await SAMS.call('stats', {});
    host.innerHTML = ['today', 'week', 'month'].map((k) => statTile(k, s[k], s.totalStudents)).join('');
  } catch (err) { host.innerHTML = '<div class="text-soft">' + escapeHtml(err.message) + '</div>'; }

  const secHost = document.getElementById('overview-sections');
  if (!STATE.sections.length) {
    secHost.innerHTML = '<div class="empty-state"><div class="big">🏫</div>No sections yet. Create one under Sections.</div>';
  } else {
    secHost.innerHTML = STATE.sections.map((s) => (
      '<div class="list-row"><div class="meta"><div class="name">' + escapeHtml(s.name) +
      (s.gradeLevel ? ' <span class="text-soft text-sm">· ' + escapeHtml(s.gradeLevel) + '</span>' : '') + '</div>' +
      '<div class="sub">' + (s.adviserName ? escapeHtml(s.adviserName) : 'No adviser assigned') + '</div></div>' +
      '<span class="badge-count">' + s.studentCount + ' students</span></div>'
    )).join('');
  }
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

/* ---- Sections ------------------------------------------------------------ */
function renderSections() {
  const host = document.getElementById('sections-list');
  if (!STATE.sections.length) { host.innerHTML = emptyState('📚', 'No sections yet.'); return; }
  host.innerHTML = STATE.sections.map((s) => (
    '<div class="list-row"><div class="meta">' +
    '<div class="name">' + escapeHtml(s.name) + (s.gradeLevel ? ' <span class="text-soft text-sm">· ' + escapeHtml(s.gradeLevel) + '</span>' : '') + '</div>' +
    '<div class="sub">' + s.studentCount + ' students &middot; Adviser: ' + (s.adviserName ? escapeHtml(s.adviserName) : '<em>none</em>') + '</div></div>' +
    '<div class="row-actions">' +
    '<button class="btn secondary sm" onclick="openSectionModal(\'' + s.id + '\')">Edit</button>' +
    '<button class="btn danger sm" onclick="deleteSection(\'' + s.id + '\')">Delete</button>' +
    '</div></div>'
  )).join('');
}

function openSectionModal(id) {
  const s = id ? STATE.sections.find((x) => x.id === id) : null;
  openModal(
    '<h3>' + (s ? 'Edit Section' : 'New Section') + '</h3>' +
    '<div class="field"><label>Section name</label><input type="text" id="m-sec-name" value="' + (s ? escapeHtml(s.name) : '') + '"></div>' +
    '<div class="field"><label>Grade level</label><input type="text" id="m-sec-grade" value="' + (s ? escapeHtml(s.gradeLevel) : '') + '" placeholder="e.g. Grade 7"></div>' +
    '<div class="field"><label>Adviser</label><select id="m-sec-adviser"><option value="">— None —</option>' +
    STATE.teachers.map((t) => '<option value="' + t.id + '" ' + (s && s.adviserId === t.id ? 'selected' : '') + '>' + escapeHtml(t.name) + '</option>').join('') +
    '</select></div>' +
    '<button class="btn block mt-16" onclick="saveSection(' + (s ? "'" + s.id + "'" : 'null') + ')">Save Section</button>'
  );
}
async function saveSection(id) {
  const payload = {
    id: id || undefined,
    name: document.getElementById('m-sec-name').value.trim(),
    gradeLevel: document.getElementById('m-sec-grade').value.trim(),
    adviserId: document.getElementById('m-sec-adviser').value
  };
  if (!payload.name) { toast('Section name is required', 'error'); return; }
  try {
    if (id) {
      await SAMS.call('updateSection', { section: payload });
      if (payload.adviserId !== undefined) await SAMS.call('assignTeacher', { sectionId: id, teacherId: payload.adviserId });
    } else {
      await SAMS.call('createSection', { section: payload });
    }
    closeModal(); toast('Section saved', 'success'); await loadBootstrap();
  } catch (err) { toast(err.message, 'error'); }
}
async function deleteSection(id) {
  if (!confirm('Delete this section? This only works if it has no students.')) return;
  try { await SAMS.call('deleteSection', { sectionId: id }); toast('Section deleted', 'success'); await loadBootstrap(); }
  catch (err) { toast(err.message, 'error'); }
}

/* ---- Teachers -------------------------------------------------------------- */
function renderTeachers() {
  const host = document.getElementById('teachers-list');
  if (!STATE.teachers.length) { host.innerHTML = emptyState('🧑‍🏫', 'No teacher accounts yet.'); return; }
  host.innerHTML = STATE.teachers.map((t) => (
    '<div class="list-row"><img class="avatar" src="' + avatarSrc(t.photoUrl, t.name) + '" alt="">' +
    '<div class="meta"><div class="name">' + escapeHtml(t.name) + '</div>' +
    '<div class="sub">@' + escapeHtml(t.username) + (t.email ? ' &middot; ' + escapeHtml(t.email) : '') + '</div></div>' +
    '<div class="row-actions">' +
    '<button class="btn secondary sm" onclick="openTeacherModal(\'' + t.id + '\')">Edit</button>' +
    '<button class="btn danger sm" onclick="deleteTeacher(\'' + t.id + '\')">Delete</button>' +
    '</div></div>'
  )).join('');
}
function openTeacherModal(id) {
  const t = id ? STATE.teachers.find((x) => x.id === id) : null;
  openModal(
    '<h3>' + (t ? 'Edit Teacher' : 'New Teacher') + '</h3>' +
    '<div class="photo-picker" id="m-teacher-photo"><img class="avatar" alt=""><div><button type="button" class="btn secondary sm pick-btn">Upload Photo</button><input type="file" accept="image/*"></div></div>' +
    '<div class="field mt-16"><label>Full name</label><input type="text" id="m-t-name" value="' + (t ? escapeHtml(t.name) : '') + '"></div>' +
    '<div class="field"><label>Username</label><input type="text" id="m-t-username" value="' + (t ? escapeHtml(t.username) : '') + '" ' + (t ? 'disabled' : '') + '></div>' +
    '<div class="field"><label>Email</label><input type="email" id="m-t-email" value="' + (t ? escapeHtml(t.email) : '') + '"></div>' +
    '<div class="field"><label>' + (t ? 'Reset password (optional)' : 'Temporary password') + '</label><input type="text" id="m-t-password" placeholder="' + (t ? 'Leave blank to keep current' : 'e.g. teacher123') + '"></div>' +
    '<button class="btn block mt-16" onclick="saveTeacher(' + (t ? "'" + t.id + "'" : 'null') + ')">Save Teacher</button>'
  );
  const picker = wirePhotoPicker(document.getElementById('m-teacher-photo'), t ? t.photoUrl : '', t ? t.name : 'New');
  document.getElementById('m-teacher-photo').__picker = picker;
}
async function saveTeacher(id) {
  const picker = document.getElementById('m-teacher-photo').__picker;
  const base64 = picker.getBase64();
  try {
    let photoUrl;
    if (base64) {
      const up = await SAMS.call('uploadImage', { base64, type: 'teacherPhoto', mimeType: 'image/jpeg' });
      photoUrl = up.url;
    }
    const payload = {
      id: id || undefined,
      name: document.getElementById('m-t-name').value.trim(),
      username: document.getElementById('m-t-username').value.trim(),
      email: document.getElementById('m-t-email').value.trim(),
      password: document.getElementById('m-t-password').value.trim() || undefined,
      photoUrl: photoUrl
    };
    if (!payload.name || (!id && !payload.username)) { toast('Name and username are required', 'error'); return; }
    if (id) await SAMS.call('updateTeacher', { teacher: payload });
    else await SAMS.call('createTeacher', { teacher: payload });
    closeModal(); toast('Teacher saved', 'success'); await loadBootstrap();
  } catch (err) { toast(err.message, 'error'); }
}
async function deleteTeacher(id) {
  if (!confirm('Delete this teacher account? Their sections will be left without an adviser.')) return;
  try { await SAMS.call('deleteTeacher', { teacherId: id }); toast('Teacher deleted', 'success'); await loadBootstrap(); }
  catch (err) { toast(err.message, 'error'); }
}

/* ---- Students --------------------------------------------------------------- */
function fillSectionSelects() {
  const opts = STATE.sections.map((s) => '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>').join('');
  ['student-filter-section', 'report-section', 'day-section-filter'].forEach((id) => {
    const el = document.getElementById(id);
    const current = el.value;
    el.innerHTML = el.querySelector('option').outerHTML + opts;
    el.value = current;
  });
}
function renderStudents() {
  const sectionFilter = document.getElementById('student-filter-section').value;
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
      '<div class="sub">' + (s.lrn ? 'LRN ' + escapeHtml(s.lrn) + ' &middot; ' : '') + (sec ? escapeHtml(sec.name) : 'Unassigned') + '</div></div>' +
      '<div class="row-actions">' +
      '<button class="btn secondary sm" onclick="openQrModal(\'' + s.id + '\')">QR</button>' +
      '<button class="btn secondary sm" onclick="openStudentModal(\'' + s.id + '\')">Edit</button>' +
      '<button class="btn danger sm" onclick="deleteStudent(\'' + s.id + '\')">Delete</button>' +
      '</div></div>';
  }).join('');
}
document.addEventListener('input', (e) => {
  if (e.target.id === 'student-search') renderStudents();
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'student-filter-section') renderStudents();
});

function openStudentModal(id) {
  const s = id ? STATE.students.find((x) => x.id === id) : null;
  openModal(
    '<h3>' + (s ? 'Edit Student' : 'New Student') + '</h3>' +
    '<div class="photo-picker" id="m-student-photo"><img class="avatar" alt=""><div><button type="button" class="btn secondary sm pick-btn">Upload Photo</button><input type="file" accept="image/*"></div></div>' +
    '<div class="field mt-16"><label>Full name</label><input type="text" id="m-s-name" value="' + (s ? escapeHtml(s.name) : '') + '"></div>' +
    '<div class="field"><label>LRN / Student ID</label><input type="text" id="m-s-lrn" value="' + (s ? escapeHtml(s.lrn) : '') + '"></div>' +
    '<div class="field"><label>Section</label><select id="m-s-section">' +
    STATE.sections.map((sec) => '<option value="' + sec.id + '" ' + (s && s.sectionId === sec.id ? 'selected' : '') + '>' + escapeHtml(sec.name) + '</option>').join('') +
    '</select></div>' +
    '<div class="field"><label>Guardian contact</label><input type="text" id="m-s-guardian" value="' + (s ? escapeHtml(s.guardianContact) : '') + '"></div>' +
    '<button class="btn block mt-16" onclick="saveStudent(' + (s ? "'" + s.id + "'" : 'null') + ')">Save Student</button>'
  );
  const picker = wirePhotoPicker(document.getElementById('m-student-photo'), s ? s.photoUrl : '', s ? s.name : 'New');
  document.getElementById('m-student-photo').__picker = picker;
}
async function saveStudent(id) {
  if (!STATE.sections.length) { toast('Create a section first', 'error'); return; }
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

/* ---- Scanner ------------------------------------------------------------------ */
let scannerRunning = false;
document.getElementById('scanner-toggle').addEventListener('click', async () => {
  const btn = document.getElementById('scanner-toggle');
  if (!scannerRunning) {
    await startScanner('qr-reader', onScan);
    scannerRunning = true; btn.textContent = 'Stop Scanner';
  } else {
    await stopScanner(); scannerRunning = false; btn.textContent = 'Start Scanner';
  }
});
let lastScanTs = 0;
async function onScan(text) {
  const now = Date.now();
  if (now - lastScanTs < 2500) return; // debounce rapid repeat reads of the same code
  lastScanTs = now;
  try {
    const res = await SAMS.call('scanAttendance', { qrData: text, location: 'Gate' });
    const badgeClass = res.attendance.status === 'Present' ? 'present' : 'late';
    document.getElementById('scan-result').innerHTML =
      '<div class="card"><img class="avatar" src="' + avatarSrc(res.student.photoUrl, res.student.name) + '" alt="">' +
      '<div class="meta"><div class="name">' + escapeHtml(res.student.name) + '</div>' +
      '<div class="sub">' + (res.alreadyRecorded ? 'Already recorded today' : 'Time in ' + res.attendance.timeIn) + '</div>' +
      '<span class="stamp ' + badgeClass + '">' + res.attendance.status + '</span></div></div>';
  } catch (err) { toast(err.message, 'error'); }
}

/* ---- Reports ------------------------------------------------------------------- */
document.getElementById('report-generate').addEventListener('click', async () => {
  const sectionId = document.getElementById('report-section').value;
  const startDate = document.getElementById('report-start').value;
  const endDate = document.getElementById('report-end').value;
  if (!startDate || !endDate) { toast('Choose a start and end date', 'error'); return; }
  try {
    const res = await SAMS.call('generateReport', { sectionId, startDate, endDate });
    downloadCsv(res.filename, res.csv);
    document.getElementById('report-hint').textContent = 'Downloaded ' + res.rowCount + ' rows.';
  } catch (err) { toast(err.message, 'error'); }
});

document.getElementById('day-select').addEventListener('change', renderDayRoster);
document.getElementById('day-section-filter').addEventListener('change', renderDayRoster);
async function renderDayRoster() {
  const date = document.getElementById('day-select').value || todayIso();
  const sectionId = document.getElementById('day-section-filter').value;
  const host = document.getElementById('day-roster');
  host.innerHTML = '<div class="text-soft">Loading…</div>';
  try {
    const res = await SAMS.call('dayStatus', { sectionId, date });
    if (!res.roster.length) { host.innerHTML = emptyState('📋', 'No students to show.'); return; }
    host.innerHTML = res.roster.map((r) => (
      '<div class="list-row"><img class="avatar" src="' + avatarSrc(r.photoUrl, r.name) + '" alt="">' +
      '<div class="meta"><div class="name">' + escapeHtml(r.name) + '</div><div class="sub">' + (r.lrn || '') + '</div></div>' +
      '<span class="stamp ' + r.status.toLowerCase() + '">' + r.status + (r.timeIn ? ' · ' + r.timeIn : '') + '</span></div>'
    )).join('');
  } catch (err) { host.innerHTML = '<div class="text-soft">' + escapeHtml(err.message) + '</div>'; }
}

/* ---- Settings ------------------------------------------------------------------- */
document.getElementById('settings-save').addEventListener('click', async () => {
  try {
    const picker = document.getElementById('logo-picker').__picker;
    let logoUrl = STATE.settings.logoUrl;
    if (picker && picker.getBase64()) {
      const up = await SAMS.call('uploadImage', { base64: picker.getBase64(), type: 'logo', mimeType: 'image/jpeg' });
      logoUrl = up.url;
    }
    await SAMS.call('updateSettings', {
      settings: {
        schoolName: document.getElementById('settings-school-name').value.trim(),
        lateCutoff: document.getElementById('settings-late-cutoff').value.trim(),
        logoUrl: logoUrl
      }
    });
    toast('Settings saved', 'success');
    await loadBootstrap();
  } catch (err) { toast(err.message, 'error'); }
});
document.getElementById('pw-save').addEventListener('click', async () => {
  try {
    await SAMS.call('changePassword', {
      oldPassword: document.getElementById('pw-old').value,
      newPassword: document.getElementById('pw-new').value
    });
    document.getElementById('pw-old').value = ''; document.getElementById('pw-new').value = '';
    toast('Password changed', 'success');
  } catch (err) { toast(err.message, 'error'); }
});

function wireStaticButtons() {
  document.getElementById('add-section-btn').addEventListener('click', () => openSectionModal(null));
  document.getElementById('add-teacher-btn').addEventListener('click', () => openTeacherModal(null));
  document.getElementById('add-student-btn').addEventListener('click', () => openStudentModal(null));
  document.getElementById('import-teachers-btn').addEventListener('click', () => openBulkImportTeachersModal());
  document.getElementById('import-students-btn').addEventListener('click', () => openBulkImportStudentsModal());
  const picker = wirePhotoPicker(document.getElementById('logo-picker'), '', 'Logo');
  document.getElementById('logo-picker').__picker = picker;
}

function emptyState(icon, text) { return '<div class="empty-state"><div class="big">' + icon + '</div>' + text + '</div>'; }
