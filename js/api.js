/**
 * Thin wrapper around the Apps Script web app.
 * IMPORTANT: requests use Content-Type "text/plain" on purpose — Apps Script web
 * apps don't handle the CORS preflight (OPTIONS) that a real "application/json"
 * request triggers, so text/plain avoids the preflight while the backend still
 * JSON.parses the body itself.
 */
const SAMS = (() => {
  function getToken() { return localStorage.getItem('sams_token') || ''; }
  function setToken(t) { localStorage.setItem('sams_token', t); }
  function clearToken() { localStorage.removeItem('sams_token'); }
  function getUser() { try { return JSON.parse(localStorage.getItem('sams_user') || 'null'); } catch (e) { return null; } }
  function setUser(u) { localStorage.setItem('sams_user', JSON.stringify(u)); }

  async function call(action, payload) {
    if (!API_BASE_URL || API_BASE_URL.indexOf('PASTE_YOUR') === 0) {
      throw new Error('Backend URL not configured yet — edit js/config.js with your Apps Script Web App URL.');
    }
    const body = Object.assign({ action, token: getToken() }, payload || {});
    const res = await fetch(API_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Network error (' + res.status + ')');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Request failed');
    return json.data;
  }

  async function publicSettings() {
    if (!API_BASE_URL || API_BASE_URL.indexOf('PASTE_YOUR') === 0) return { schoolName: 'My School', logoUrl: '' };
    const res = await fetch(API_BASE_URL + '?action=publicSettings');
    const json = await res.json();
    return json.success ? json.data : { schoolName: 'My School', logoUrl: '' };
  }

  function logout() { clearToken(); localStorage.removeItem('sams_user'); location.href = 'index.html'; }

  function requireAuth(expectedRole) {
    const token = getToken();
    const user = getUser();
    if (!token || !user) { location.href = 'index.html'; return null; }
    if (expectedRole && user.role !== expectedRole) {
      location.href = user.role === 'admin' ? 'admin.html' : 'teacher.html';
      return null;
    }
    return user;
  }

  return { call, publicSettings, getToken, setToken, clearToken, getUser, setUser, logout, requireAuth };
})();
