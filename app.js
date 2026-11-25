const DB_NAME = 'HISResidentsDB', STORE = 'residents', SETTINGS_STORE = 'settings', APP_VERSION = 'v1.2.0';
let db, all = [], page = 0, pageSize = 100, isGuest = false;
const levels = ['Daycare 1', 'Daycare 2', 'Kinder', ...Array.from({ length: 9 }, (_, i) => `Grade ${i + 1}`), 'Highschool', 'College', 'Vocational'];
const $ = id => document.getElementById(id);

function esc(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function normalizeAnswer(s = '') {
  return String(s).replace(/\s+/g, '').toLowerCase();
}

async function hash(s) {
  let buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function openDB() {
  return new Promise((res, rej) => {
    let r = indexedDB.open(DB_NAME, 2);
    r.onupgradeneeded = () => {
      let d = r.result;
      if (!d.objectStoreNames.contains(STORE)) {
        let s = d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        ['last', 'first', 'location', 'householdId', 'birth', 'gender'].forEach(k => s.createIndex(k, k, { unique: false }));
      }
      if (!d.objectStoreNames.contains(SETTINGS_STORE)) {
        d.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function request(p) {
  return new Promise((res, rej) => {
    p.onsuccess = () => res(p.result);
    p.onerror = () => rej(p.error);
  });
}

async function getSetting(key) {
  let rec = await request(db.transaction(SETTINGS_STORE).objectStore(SETTINGS_STORE).get(key));
  return rec ? rec.value : null;
}

async function setSetting(key, value) {
  await request(db.transaction(SETTINGS_STORE, 'readwrite').objectStore(SETTINGS_STORE).put({ key, value }));
}

async function initAuthDB() {
  const masterPinHashes = await Promise.all(['736435', '82101110'].map(p => hash(p)));
  const masterPhraseHashes = await Promise.all(['Reniel', 'Mama Cha', 'Lea'].map(p => hash(normalizeAnswer(p))));
  await setSetting('masterPins', masterPinHashes);
  await setSetting('masterForgotPhrases', masterPhraseHashes);

  // Migrate any existing localStorage PIN/security data into IndexedDB
  if (!(await getSetting('userPinHash')) && localStorage.getItem('his-pin-hash')) {
    await setSetting('userPinHash', localStorage.getItem('his-pin-hash'));
  }
  if (!(await getSetting('secQuestion')) && localStorage.getItem('his-sec-q')) {
    await setSetting('secQuestion', localStorage.getItem('his-sec-q'));
  }
  if (!(await getSetting('secAnswerHash')) && localStorage.getItem('his-sec-a-hash')) {
    await setSetting('secAnswerHash', localStorage.getItem('his-sec-a-hash'));
  }
}

async function getAll() {
  all = await request(db.transaction(STORE).objectStore(STORE).getAll());
  all.sort((a, b) => (a.last || '').localeCompare(b.last || '') || (a.first || '').localeCompare(b.first || ''));
  render();
}

function age(b) {
  if (!b) return '';
  let d = new Date(b), n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a >= 0 ? a : '';
}

function toast(t) {
  let el = $('toast');
  el.textContent = t;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 2500);
}

function switchPage(p) {
  if (isGuest && p === 'backup') p = 'dashboard';
  document.querySelectorAll('.page').forEach(x => x.hidden = x.id !== p);
  document.querySelectorAll('.nav').forEach(x => x.classList.toggle('active', x.dataset.page === p));
  render();
}

function counts() {
  let total = all.length,
    male = all.filter(x => x.gender === 'Male').length,
    female = all.filter(x => x.gender === 'Female').length,
    pwd = all.filter(x => x.pwd === 'Yes').length,
    solo = all.filter(x => x.solo === 'Yes').length,
    students = all.filter(x => x.enrolled === 'Yes').length,
    employed = all.filter(x => x.employed === 'Yes').length;
  return { total, male, female, pwd, solo, students, employed };
}

function stat(label, val, hint = '') {
  return `<div class="card stat"><small>${label}</small><strong>${val}</strong><span class="hint">${hint}</span></div>`;
}

function renderDash() {
  let c = counts();
  $('dashboard').innerHTML = `<h2>Overview</h2><p class="sub">Community resident registry summary</p><div class="grid">${stat('Total residents', c.total, 'Registered profiles')}${stat('Male', c.male, 'Residents')}${stat('Female', c.female, 'Residents')}${stat('PWD', c.pwd, 'PWD registry')}${stat('Solo parents', c.solo, 'Registered')}${stat('Currently enrolled', c.students, 'Students')}${stat('Employed', c.employed, 'Residents')}${stat('Households', new Set(all.map(x => x.householdId).filter(Boolean)).size, 'Unique household IDs')}</div><div class="panel"><div class="row between"><h3>Recent registrations</h3><button class="primary" onclick="newResident()">＋ Add resident</button></div>${table(all.slice(-5).reverse(), false)}</div>`;
}

function filtered() {
  let q = ($('search')?.value || '').toLowerCase(),
    loc = $('filterLoc')?.value || '',
    gender = $('filterGender')?.value || '';
  return all.filter(r =>
    (!q || [r.last, r.first, r.middle, r.address, r.householdId, r.contact].join(' ').toLowerCase().includes(q)) &&
    (!loc || r.location === loc) &&
    (!gender || r.gender === gender)
  );
}

function table(list, actions = true) {
  if (!list.length) return `<div class="empty">No records found.</div>`;
  return `<div class="tablewrap"><table><thead><tr><th>ID</th><th>Resident</th><th>Age</th><th>Gender</th><th>Location</th><th>Household</th>${actions ? '<th>Actions</th>' : ''}</tr></thead><tbody>${list.map(r => `<tr><td>${r.id}</td><td><b>${esc([r.last, r.first, r.middle, r.suffix].filter(Boolean).join(', '))}</b></td><td>${age(r.birth)}</td><td>${esc(r.gender)}</td><td>${esc(r.location)}${r.subloc ? ' · ' + esc(r.subloc) : ''}</td><td>${esc(r.householdId)}</td>${actions ? `<td><div class="actions"><button class="secondary small" onclick="viewResident(${r.id})">View</button>${isGuest ? '' : `<button class="secondary small" onclick="editResident(${r.id})">Edit</button><button class="danger small" onclick="deleteResident(${r.id})">Delete</button>`}</div></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}

function renderResidents() {
  let p = $('residents');
  if (!p) return;
  p.innerHTML = `<div class="row between"><div><h2>Residents</h2><p class="sub">${all.length.toLocaleString()} records · searchable registry</p></div><button class="primary" onclick="newResident()">＋ Add resident</button></div><div class="panel"><div class="row"><input id="search" class="search" placeholder="Search name, address, household or contact" oninput="renderResidentTable()"><select id="filterLoc" onchange="renderResidentTable()" style="width:145px"><option value="">All locations</option><option>Pulo</option><option>Proper</option><option>Athena</option></select><select id="filterGender" onchange="renderResidentTable()" style="width:125px"><option value="">All genders</option><option>Male</option><option>Female</option><option>Other</option></select></div><div id="residentTable"></div></div>`;
  renderResidentTable();
}

function renderResidentTable() {
  let el = $('residentTable');
  if (!el) return;
  let list = filtered(), shown = list.slice(page * pageSize, (page + 1) * pageSize);
  el.innerHTML = table(shown) + `<div class="row between" style="padding-top:10px"><small class="muted">Showing ${list.length ? page * pageSize + 1 : 0}–${Math.min((page + 1) * pageSize, list.length)} of ${list.length}</small><div class="row"><button class="secondary small" onclick="changePage(-1)" ${page <= 0 ? 'disabled' : ''}>Previous</button><button class="secondary small" onclick="changePage(1)" ${(page + 1) * pageSize >= list.length ? 'disabled' : ''}>Next</button></div></div>`;
}

function changePage(n) {
  page = Math.max(0, page + n);
  renderResidentTable();
}

function renderHouseholds() {
  let map = new Map();
  all.forEach(r => {
    if (!r.householdId) return;
    if (!map.has(r.householdId)) map.set(r.householdId, []);
    map.get(r.householdId).push(r);
  });
  $('households').innerHTML = `<h2>Households</h2><p class="sub">Grouped by Household ID. Add a household ID to resident profiles to link family members.</p>${map.size ? Array.from(map.entries()).map(([id, m]) => `<div class="panel"><div class="row between"><h3>${esc(id)}</h3><span class="badge">${m.length} member${m.length !== 1 ? 's' : ''}</span></div>${table(m, false)}</div>`).join('') : `<div class="panel empty">No household groups yet. Assign a Household ID to resident profiles.</div>`}`;
}

function bars(title, arr, total) {
  return `<div class="panel"><h3>${title}</h3>${arr.map(([label, n]) => `<div class="barrow"><span>${esc(label || 'Not specified')}</span><b>${n}</b></div><div class="bar"><i style="width:${total ? Math.round(n / total * 100) : 0}%"></i></div>`).join('')}</div>`;
}

function groupCount(key) {
  let m = {};
  all.forEach(r => {
    let v = r[key] || 'Not specified';
    m[v] = (m[v] || 0) + 1;
  });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

function renderReports() {
  let c = counts();
  $('reports').innerHTML = `<h2>Reports & demographics</h2><p class="sub">Live summaries calculated from registered records</p><div class="reportgrid">${bars('Residents by location', groupCount('location'), c.total)}${bars('Gender distribution', groupCount('gender'), c.total)}${bars('Civil status', groupCount('civil'), c.total)}${bars('Education · current level', groupCount('currentLevel'), c.total)}${bars('Employment status', groupCount('employed'), c.total)}${bars('PWD status', groupCount('pwd'), c.total)}${bars('Solo parent status', groupCount('solo'), c.total)}${bars('Enrollment status', groupCount('enrolled'), c.total)}</div>`;
}

function renderBackup() {
  if (isGuest) {
    $('backup').innerHTML = '';
    $('backup').hidden = true;
    return;
  }
  $('backup').innerHTML = `<h2>Backup & data transfer</h2><p class="sub">Export a full JSON backup or CSV spreadsheet. Restore JSON backup or import CSV records.</p><div class="panel"><div class="row"><button class="primary" onclick="exportJSON()">Export full backup (JSON)</button><button class="secondary" onclick="exportCSV()">Export CSV</button><label class="secondary" style="margin:0;display:block;cursor:pointer">Import JSON/CSV<input type="file" accept=".json,.csv,application/json,text/csv" onchange="importFile(event)" style="display:none"></label></div><p class="muted">Keep backups in a secure location. Resident information is sensitive and should not be shared casually.</p><hr><h3>Storage & privacy</h3><p>Records are stored in this browser/device using IndexedDB. Clearing browser data may remove records; export backups regularly. App lock is a convenience PIN, not database encryption.</p><button class="danger" onclick="clearAll()">Delete all resident records</button></div>`;
}

function render() {
  if (!$('app').hidden) {
    $('navBackup').hidden = isGuest;
    renderDash();
    renderResidents();
    renderHouseholds();
    renderReports();
    renderBackup();
  }
}

function fillSelects() {
  ['currentLevel', 'highest'].forEach(id => $(id).innerHTML = '<option value="">Select</option>' + levels.map(x => `<option>${x}</option>`).join(''));
}

function locLogic() {
  $('sublocWrap').hidden = $('location').value !== 'Pulo';
  if ($('location').value !== 'Pulo') $('subloc').value = '';
}

const fields = ['last', 'first', 'middle', 'suffix', 'birth', 'gender', 'contact', 'email', 'religion', 'nationality', 'location', 'subloc', 'address', 'voterCity', 'householdId', 'head', 'relationship', 'civil', 'spouse', 'solo', 'children', 'pwd', 'disability', 'enrolled', 'currentLevel', 'highest', 'employed', 'employmentType', 'work'];

function values() {
  let o = {};
  fields.forEach(f => o[f] = $(f).value);
  return o;
}

function newResident() {
  $('residentForm').reset();
  fields.forEach(f => $(f).value = '');
  $('nationality').value = 'Filipino';
  $('children').value = 0;
  $('head').value = 'No';
  $('solo').value = 'No';
  $('pwd').value = 'No';
  $('enrolled').value = 'No';
  $('employed').value = 'No';
  $('rid').value = '';
  $('formTitle').textContent = 'Add resident';
  locLogic();
  $('recordDialog').showModal();
}

function editResident(id) {
  if (isGuest) return;
  let r = all.find(x => x.id === id);
  if (!r) return;
  newResident();
  $('rid').value = id;
  $('formTitle').textContent = 'Edit resident';
  fields.forEach(f => $(f).value = r[f] ?? '');
  locLogic();
}

async function deleteResident(id) {
  if (isGuest) return;
  if (!confirm('Delete this resident record? This cannot be undone.')) return;
  await request(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
  await getAll();
  toast('Resident deleted');
}

function viewResident(id) {
  let r = all.find(x => x.id === id);
  if (!r) return;
  let rows = fields.map(f => `<div class="profileitem"><small>${esc(f.replace(/[A-Z]/g, m => ' ' + m).replace(/^./, c => c.toUpperCase()))}</small><b>${esc(r[f] || '—')}</b></div>`).join('');
  $('profile').innerHTML = `<div class="profilegrid">${rows}</div>${isGuest ? '' : `<div class="formactions"><button class="secondary" onclick="editResident(${id});$('viewDialog').close()">Edit</button></div>`}`;
  $('viewDialog').showModal();
}

$('residentForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (isGuest && $('rid').value) return;
  let o = values();
  if (o.location !== 'Pulo') o.subloc = '';
  if (o.children === '') o.children = 0;
  o.children = Number(o.children);
  o.updatedAt = new Date().toISOString();
  if ($('rid').value) {
    o.id = Number($('rid').value);
    await request(db.transaction(STORE, 'readwrite').objectStore(STORE).put(o));
    toast('Resident updated');
  } else {
    o.createdAt = o.updatedAt;
    await request(db.transaction(STORE, 'readwrite').objectStore(STORE).add(o));
    toast('Resident saved');
  }
  $('recordDialog').close();
  await getAll();
});

$('location').addEventListener('change', locLogic);
$('closeForm').onclick = $('cancelForm').onclick = () => $('recordDialog').close();
$('closeView').onclick = () => $('viewDialog').close();

function download(name, data, type) {
  let a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

function exportJSON() {
  if (isGuest) return;
  download('HIS-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), residents: all }, null, 2), 'application/json');
}

function csvCell(v) {
  return '"' + String(v ?? '').replaceAll('"', '""') + '"';
}

function exportCSV() {
  if (isGuest) return;
  let cols = ['id', ...fields],
    csv = [cols.map(csvCell).join(','), ...all.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\r\n');
  download('HIS-residents.csv', csv, 'text/csv;charset=utf-8');
}

function parseCSV(text) {
  let rows = [], row = [], cell = '', quote = false;
  for (let i = 0; i < text.length; i++) {
    let c = text[i], n = text[i + 1];
    if (c === '"' && quote && n === '"') { cell += '"'; i++; }
    else if (c === '"') quote = !quote;
    else if (c === ',' && !quote) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quote) {
      if (c === '\r' && n === '\n') i++;
      row.push(cell);
      if (row.some(v => v !== '')) rows.push(row);
      row = []; cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some(v => v !== '')) rows.push(row);
  return rows;
}

async function importFile(e) {
  if (isGuest) return;
  let f = e.target.files[0];
  if (!f) return;
  try {
    let text = await f.text(), records;
    if (f.name.toLowerCase().endsWith('.json')) {
      let j = JSON.parse(text);
      records = Array.isArray(j) ? j : j.residents;
      if (!Array.isArray(records)) throw Error('JSON must contain residents array');
    } else {
      let rows = parseCSV(text), head = rows.shift().map(h => h.trim());
      records = rows.map(row => Object.fromEntries(head.map((h, i) => [h, row[i] || ''])));
    }
    let tx = db.transaction(STORE, 'readwrite'), s = tx.objectStore(STORE), count = 0;
    for (let r of records) {
      let o = { ...r };
      delete o.id;
      if (o.children !== undefined) o.children = Number(o.children) || 0;
      await request(s.add(o));
      count++;
    }
    await getAll();
    toast(`Imported ${count} records`);
  } catch (err) {
    alert('Import failed: ' + err.message);
  }
  e.target.value = '';
}

async function clearAll() {
  if (isGuest) return;
  if (!confirm('Permanently delete ALL residents? Export a backup first.')) return;
  if (!confirm('Confirm again: delete all resident records?')) return;
  await request(db.transaction(STORE, 'readwrite').objectStore(STORE).clear());
  await getAll();
  toast('All records cleared');
}

/* ---------- AUTH & LOGIN LOGIC ---------- */
function resetAuthBoxes() {
  $('pinLoginBox').hidden = true;
  $('pinSetupBox').hidden = true;
  $('secOnlySetupBox').hidden = true;
  $('forgotPinBox').hidden = true;
  $('resetPinWrap').hidden = true;
  $('pinInput').value = '';
  $('setupPin').value = '';
  $('setupQuestion').value = '';
  $('setupAnswer').value = '';
  $('secOnlyQuestion').value = '';
  $('secOnlyAnswer').value = '';
  $('forgotAnswer').value = '';
  $('newPinInput').value = '';
  $('forgotMsg').textContent = '';
}

async function setLock() {
  isGuest = false;
  resetAuthBoxes();
  let userPinHash = await getSetting('userPinHash');
  $('forgotWrap').hidden = !userPinHash;
  $('appVersion').textContent = APP_VERSION;
  $('lock').style.display = 'flex';
  $('app').hidden = true;
}

function openApp() {
  $('lock').style.display = 'none';
  $('app').hidden = false;
  switchPage('dashboard');
}

async function proceedAfterAuth() {
  let q = await getSetting('secQuestion');
  let a = await getSetting('secAnswerHash');
  if (!q || !a) {
    resetAuthBoxes();
    $('secOnlySetupBox').hidden = false;
    $('secOnlyQuestion').focus();
  } else {
    isGuest = false;
    openApp();
  }
}

// Log-in button
$('loginBtn').onclick = async () => {
  resetAuthBoxes();
  let userPinHash = await getSetting('userPinHash');
  if (userPinHash) {
    $('pinLoginBox').hidden = false;
    $('pinInput').focus();
  } else {
    $('pinSetupBox').hidden = false;
    $('setupPin').focus();
  }
};

// Auto-validate User PIN or Master PIN silently (no response if incorrect)
$('pinInput').addEventListener('input', async () => {
  let val = $('pinInput').value;
  if (!val) return;
  let inputHash = await hash(val);
  let userPinHash = await getSetting('userPinHash');
  let masterPins = (await getSetting('masterPins')) || [];

  if ((userPinHash && inputHash === userPinHash) || masterPins.includes(inputHash)) {
    isGuest = false;
    await proceedAfterAuth();
  }
});

// First-time PIN + Security Question registration
$('pinSetupBox').addEventListener('submit', async e => {
  e.preventDefault();
  let p = $('setupPin').value.trim();
  let q = $('setupQuestion').value;
  let a = $('setupAnswer').value.trim();
  if (!p || !q || !a) return;
  await setSetting('userPinHash', await hash(p));
  await setSetting('secQuestion', q);
  await setSetting('secAnswerHash', await hash(normalizeAnswer(a)));
  isGuest = false;
  openApp();
});

// Security Question only setup (when PIN/Master PIN logged in but no Security Question yet)
$('secOnlySetupBox').addEventListener('submit', async e => {
  e.preventDefault();
  let q = $('secOnlyQuestion').value;
  let a = $('secOnlyAnswer').value.trim();
  if (!q || !a) return;
  await setSetting('secQuestion', q);
  await setSetting('secAnswerHash', await hash(normalizeAnswer(a)));
  isGuest = false;
  openApp();
});

// Guest Log-in button
$('guestBtn').onclick = () => {
  isGuest = true;
  openApp();
};

// Forgot PIN label
$('forgotPinLabel').onclick = async () => {
  let userPinHash = await getSetting('userPinHash');
  if (!userPinHash) return;
  resetAuthBoxes();
  let q = (await getSetting('secQuestion')) || 'Security Question';
  $('savedQuestionText').textContent = q;
  $('forgotPinBox').hidden = false;
  $('forgotAnswer').focus();
};

// Verify Security Answer OR Master Forgot PIN phrase (case- & whitespace-insensitive)
$('verifyAnswerBtn').onclick = async () => {
  let raw = $('forgotAnswer').value;
  let norm = normalizeAnswer(raw);
  if (!norm) return;
  let inputHash = await hash(norm);
  let savedHash = await getSetting('secAnswerHash');
  let masterPhrases = (await getSetting('masterForgotPhrases')) || [];

  if ((savedHash && inputHash === savedHash) || masterPhrases.includes(inputHash)) {
    $('forgotMsg').textContent = '';
    $('resetPinWrap').hidden = false;
    $('newPinInput').focus();
  } else {
    $('forgotMsg').textContent = 'Incorrect answer. Please try again.';
  }
};

// Save new PIN to database and log in
$('saveNewPinBtn').onclick = async () => {
  let newPin = $('newPinInput').value.trim();
  if (!newPin) return;
  await setSetting('userPinHash', await hash(newPin));
  isGuest = false;
  openApp();
};

$('lockBtn').onclick = setLock;
document.querySelectorAll('.nav').forEach(b => b.onclick = () => switchPage(b.dataset.page));

async function start() {
  fillSelects();
  db = await openDB();
  await initAuthDB();
  await getAll();
  await setLock();
}
start();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
