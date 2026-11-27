const DB_NAME = 'HISResidentsDB', STORE = 'residents', SETTINGS_STORE = 'settings', APP_VERSION = 'v1.4.0';
let db, all = [], page = 0, pageSize = 100, isGuest = false, pendingDeleteId = null;
let currentHeaderTitle = 'OFFLINE Household Information';
let currentHeaderSub = 'Anabu II-C Resident Registry';

const levels = [
  'Daycare 1', 'Daycare 2', 'Kinder',
  ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`),
  'Highschool', 'College', 'Vocational'
];

const SUBLOC_MAP = {
  'Sitio Pulo': ['Bungad', 'Gitna', 'Palayan', 'Dulo'],
  '2-C Proper': ['Elysian Subdivision', '2-C Proper']
};

const fields = [
  'last', 'first', 'middle', 'suffix', 'birth', 'gender', 'contact', 'email', 'religion', 'nationality',
  'lgbtqia', 'pwd', 'disability',
  'location', 'subloc', 'blockNo', 'lotNo', 'phaseNo', 'address', 'householdId', 'head', 'relationship',
  'civil', 'spouse', 'solo', 'children', 'fourPs', 'tupad', 'imusVoter',
  'enrolled', 'currentLevel', 'highest',
  'employed', 'employmentType', 'work', 'employerName', 'workPlace'
];

const fieldLabels = {
  last: 'Last name', first: 'First name', middle: 'Middle name', suffix: 'Suffix',
  birth: 'Birthdate', gender: 'Gender', contact: 'Contact number', email: 'Email',
  religion: 'Religion', nationality: 'Nationality',
  lgbtqia: 'LGBTQIA++', pwd: 'PWD', disability: 'Disability',
  location: 'Location', subloc: 'Area/Sub-location',
  blockNo: 'Block #', lotNo: 'Lot #', phaseNo: 'Phase #',
  address: 'Address', householdId: 'Household ID',
  head: 'Household head', relationship: 'Relationship to household head',
  civil: 'Civil status', spouse: 'Spouse / partner', solo: 'Solo parent',
  children: 'Number of children', fourPs: '4Ps Beneficiary', tupad: 'TUPAD Beneficiary', imusVoter: 'Imus Voter',
  enrolled: 'Enrolled', currentLevel: 'Current level', highest: 'Highest educational attainment',
  employed: 'Employed', employmentType: 'Employment type',
  work: 'Field of work / Type of business', employerName: 'Employer name / Business name', workPlace: 'Place of work/business'
};

const $ = id => document.getElementById(id);

function esc(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function normalizeAnswer(s = '') {
  return String(s).replace(/\s+/g, '').toLowerCase();
}

function normStr(s = '') {
  return String(s).trim().replace(/\s+/g, ' ').toLowerCase();
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
  const masterPinHashes = await Promise.all(['736435', '82101110', '24279'].map(p => hash(p)));
  const masterPhraseHashes = await Promise.all(
    ['Reniel', 'Mama Cha', 'Lea', '24279', '736435', '82101110'].map(p => hash(normalizeAnswer(p)))
  );
  await setSetting('masterPins', masterPinHashes);
  await setSetting('masterForgotPhrases', masterPhraseHashes);

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

function showInfoPopup(htmlMessage) {
  $('infoBody').innerHTML = htmlMessage;
  if (!$('infoDialog').open) $('infoDialog').showModal();
}

/* ---------- BLOCK / LOT / PHASE HOUSEHOLD MATCHING ---------- */
function findHouseholdByBlockLotPhase(blockNo, lotNo, phaseNo, excludeId = null) {
  const b = normStr(blockNo);
  const l = normStr(lotNo);
  const p = normStr(phaseNo);
  if (!b && !l && !p) return null;

  return all.find(r =>
    r.id !== excludeId &&
    r.householdId &&
    normStr(r.blockNo) === b &&
    normStr(r.lotNo) === l &&
    normStr(r.phaseNo) === p
  ) || null;
}

function checkBlockLotPhaseAutoFill() {
  const currentId = $('rid').value ? Number($('rid').value) : null;
  const match = findHouseholdByBlockLotPhase($('blockNo').value, $('lotNo').value, $('phaseNo').value, currentId);
  if (match && match.householdId) {
    $('householdId').value = match.householdId;
  }
}

/* ---------- SESSION / RELOAD PERSISTENCE ---------- */
function saveSessionState(pageName) {
  if ($('app').hidden) return;
  sessionStorage.setItem('his-session-active', '1');
  sessionStorage.setItem('his-session-guest', isGuest ? '1' : '0');
  sessionStorage.setItem('his-session-header-title', currentHeaderTitle);
  sessionStorage.setItem('his-session-header-sub', currentHeaderSub);
  if (pageName) sessionStorage.setItem('his-session-page', pageName);
}

function saveFilterState() {
  if ($('app').hidden) return;
  sessionStorage.setItem('his-session-filters', JSON.stringify({
    search: $('search')?.value || '',
    filterLoc: $('filterLoc')?.value || '',
    filterGender: $('filterGender')?.value || '',
    page
  }));
}

function getFilterState() {
  try {
    return JSON.parse(sessionStorage.getItem('his-session-filters') || '{}');
  } catch {
    return {};
  }
}

function saveDraft() {
  if (!$('recordDialog').open) return;
  sessionStorage.setItem('his-session-draft', JSON.stringify({
    open: true,
    rid: $('rid').value,
    formTitle: $('formTitle').textContent,
    values: values()
  }));
}

function clearDraft() {
  sessionStorage.removeItem('his-session-draft');
}

function clearSessionState() {
  sessionStorage.removeItem('his-session-active');
  sessionStorage.removeItem('his-session-guest');
  sessionStorage.removeItem('his-session-header-title');
  sessionStorage.removeItem('his-session-header-sub');
  sessionStorage.removeItem('his-session-page');
  sessionStorage.removeItem('his-session-filters');
  clearDraft();
}

function applyHeader() {
  $('headerTitle').textContent = currentHeaderTitle;
  $('headerSub').textContent = currentHeaderSub;
}

function switchPage(p) {
  if (isGuest && p === 'backup') p = 'dashboard';
  document.querySelectorAll('.page').forEach(x => x.hidden = x.id !== p);
  document.querySelectorAll('.nav').forEach(x => x.classList.toggle('active', x.dataset.page === p));
  saveSessionState(p);
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
  let saved = getFilterState();
  let curSearch = $('search') ? $('search').value : (saved.search || '');
  let curLoc = $('filterLoc') ? $('filterLoc').value : (saved.filterLoc || '');
  let curGender = $('filterGender') ? $('filterGender').value : (saved.filterGender || '');

  p.innerHTML = `<div class="row between"><div><h2>Residents</h2><p class="sub">${all.length.toLocaleString()} records · searchable registry</p></div><button class="primary" onclick="newResident()">＋ Add resident</button></div><div class="panel"><div class="row"><input id="search" class="search" placeholder="Search name, address, household or contact" oninput="onFilterChange()"><select id="filterLoc" onchange="onFilterChange()" style="width:155px"><option value="">All locations</option><option value="Sitio Pulo">Sitio Pulo</option><option value="2-C Proper">2-C Proper</option><option value="Pallas Athena">Pallas Athena</option></select><select id="filterGender" onchange="onFilterChange()" style="width:125px"><option value="">All genders</option><option>Male</option><option>Female</option><option>Other</option></select></div><div id="residentTable"></div></div>`;

  $('search').value = curSearch;
  $('filterLoc').value = curLoc;
  $('filterGender').value = curGender;
  renderResidentTable();
}

function onFilterChange() {
  page = 0;
  saveFilterState();
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
  saveFilterState();
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
    applyHeader();
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

/* ---------- DYNAMIC AREA/SUB-LOCATION ---------- */
function locLogic(preserveSubloc = '') {
  const loc = $('location').value;
  const sub = $('subloc');
  const opts = SUBLOC_MAP[loc];
  if (opts) {
    sub.disabled = false;
    sub.innerHTML = '<option value="">Select</option>' + opts.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
    if (preserveSubloc && opts.includes(preserveSubloc)) {
      sub.value = preserveSubloc;
    } else {
      sub.value = '';
    }
  } else {
    sub.innerHTML = '<option value="">Select</option>';
    sub.value = '';
    sub.disabled = true;
  }
}

/* ---------- DUPLICATE VALIDATION ---------- */
function findDuplicateRecord() {
  const last = normStr($('last').value);
  const first = normStr($('first').value);
  const middle = normStr($('middle').value);
  const birth = ($('birth').value || '').trim();
  const currentId = $('rid').value ? Number($('rid').value) : null;

  if (!last || !first || !birth) return null;

  return all.find(r =>
    r.id !== currentId &&
    normStr(r.last) === last &&
    normStr(r.first) === first &&
    normStr(r.middle) === middle &&
    (r.birth || '').trim() === birth
  ) || null;
}

function checkDuplicateUI() {
  const dup = findDuplicateRecord();
  const warn = $('dupWarning');
  const saveBtn = $('saveResidentBtn');
  if (dup) {
    warn.textContent = `Duplicate resident detected (Record ID #${dup.id}: ${dup.last}, ${dup.first}${dup.middle ? ' ' + dup.middle : ''}, born ${dup.birth}). Duplicate entries are not allowed.`;
    warn.hidden = false;
    saveBtn.disabled = true;
    return true;
  } else {
    warn.textContent = '';
    warn.hidden = true;
    saveBtn.disabled = false;
    return false;
  }
}

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
  $('fourPs').value = '';
  $('tupad').value = '';
  $('lgbtqia').value = '';
  $('imusVoter').value = '';
  $('rid').value = '';
  $('formTitle').textContent = 'Add resident';
  locLogic('');
  checkDuplicateUI();
  $('recordDialog').showModal();
  saveDraft();
}

function editResident(id) {
  if (isGuest) return;
  let r = all.find(x => x.id === id);
  if (!r) return;
  newResident();
  $('rid').value = id;
  $('formTitle').textContent = 'Edit resident';
  fields.forEach(f => {
    if (f !== 'subloc') $(f).value = r[f] ?? '';
  });
  locLogic(r.subloc || '');
  // Auto-populate Household ID if another record matches Block #, Lot #, and Phase #
  checkBlockLotPhaseAutoFill();
  checkDuplicateUI();
  saveDraft();
}

/* ---------- CUSTOM DELETE CONFIRMATION POP-UP ---------- */
function deleteResident(id) {
  if (isGuest) return;
  let r = all.find(x => x.id === id);
  if (!r) return;
  pendingDeleteId = id;
  $('deleteBody').innerHTML = `
    <p>Are you sure you want to delete this resident record? This cannot be undone.</p>
    <div class="delete-details">
      <div><strong>Record ID #:</strong> ${esc(r.id)}</div>
      <div><strong>First name:</strong> ${esc(r.first || '—')}</div>
      <div><strong>Middle name:</strong> ${esc(r.middle || '—')}</div>
      <div><strong>Last name:</strong> ${esc(r.last || '—')}</div>
      <div><strong>Birthdate:</strong> ${esc(r.birth || '—')}</div>
    </div>
  `;
  $('deleteDialog').showModal();
}

$('confirmDelete').onclick = async () => {
  if (isGuest || pendingDeleteId == null) return;
  await request(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(pendingDeleteId));
  pendingDeleteId = null;
  $('deleteDialog').close();
  await getAll();
  toast('Resident deleted');
};

$('cancelDelete').onclick = $('closeDelete').onclick = () => {
  pendingDeleteId = null;
  $('deleteDialog').close();
};

$('okInfo').onclick = $('closeInfo').onclick = () => $('infoDialog').close();

/* ---------- VIEW RESIDENT PROFILE WITH NAVIGATION ---------- */
function viewResident(id) {
  let idx = all.findIndex(x => x.id === id);
  if (idx === -1) return;
  let r = all[idx];
  let firstId = all[0]?.id;
  let prevId = idx > 0 ? all[idx - 1].id : null;
  let nextId = idx < all.length - 1 ? all[idx + 1].id : null;
  let lastId = all[all.length - 1]?.id;

  let rows = fields.map(f => `<div class="profileitem"><small>${esc(fieldLabels[f] || f)}</small><b>${esc(r[f] || '—')}</b></div>`).join('');
  $('profile').innerHTML = `
    <div class="profilegrid">${rows}</div>
    <div class="profile-footer">
      <div class="profile-nav">
        <button type="button" class="secondary small" onclick="viewResident(${firstId})" ${idx <= 0 ? 'disabled' : ''}>First</button>
        <button type="button" class="secondary small" onclick="viewResident(${prevId})" ${idx <= 0 ? 'disabled' : ''}>Previous</button>
        <button type="button" class="secondary small" onclick="viewResident(${nextId})" ${idx >= all.length - 1 ? 'disabled' : ''}>Next</button>
        <button type="button" class="secondary small" onclick="viewResident(${lastId})" ${idx >= all.length - 1 ? 'disabled' : ''}>Last</button>
      </div>
      ${isGuest ? '' : `<button type="button" class="primary small" onclick="editResident(${id});$('viewDialog').close()">Edit</button>`}
    </div>
  `;
  if (!$('viewDialog').open) $('viewDialog').showModal();

  // Check Block #, Lot #, Phase # against existing records and inform user via pop-up
  const match = findHouseholdByBlockLotPhase(r.blockNo, r.lotNo, r.phaseNo, r.id);
  if (match && match.householdId) {
    showInfoPopup(`
      <p>An existing record with the same <strong>Block #</strong>, <strong>Lot #</strong>, and <strong>Phase #</strong> was found in the database.</p>
      <div class="delete-details">
        <div><strong>Matched Record ID #:</strong> ${esc(match.id)}</div>
        <div><strong>Household ID:</strong> ${esc(match.householdId)}</div>
      </div>
    `);
  }
}

/* ---------- CHILDREN STEPPER ---------- */
$('childrenMinus').onclick = () => {
  let v = Math.max(0, (parseInt($('children').value, 10) || 0) - 1);
  $('children').value = v;
  saveDraft();
};

$('childrenPlus').onclick = () => {
  let v = Math.max(0, (parseInt($('children').value, 10) || 0) + 1);
  $('children').value = v;
  saveDraft();
};

/* ---------- FORM EVENTS ---------- */
$('residentForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (isGuest && $('rid').value) return;
  if (checkDuplicateUI()) {
    toast('Duplicate resident record detected.');
    return;
  }
  let o = values();
  if (!SUBLOC_MAP[o.location]) o.subloc = '';
  if (o.children === '') o.children = 0;
  o.children = Math.max(0, Number(o.children) || 0);
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
  clearDraft();
  $('recordDialog').close();
  await getAll();
});

$('residentForm').addEventListener('input', () => {
  checkDuplicateUI();
  saveDraft();
});
$('residentForm').addEventListener('change', () => {
  checkDuplicateUI();
  saveDraft();
});
$('location').addEventListener('change', () => {
  locLogic('');
  saveDraft();
});
['blockNo', 'lotNo', 'phaseNo'].forEach(id => {
  $(id).addEventListener('input', () => {
    checkBlockLotPhaseAutoFill();
    saveDraft();
  });
});

function closeRecordDialog() {
  clearDraft();
  $('recordDialog').close();
}

$('closeForm').onclick = $('cancelForm').onclick = closeRecordDialog;
$('recordDialog').addEventListener('cancel', clearDraft);
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
function syncCancelForgotGap() {
  const bothVisible = !$('loginCancelBtn').hidden && !$('forgotWrap').hidden;
  $('cancelForgotGap').hidden = !bothVisible;
}

function resetAuthBoxes() {
  $('pinLoginBox').hidden = true;
  $('pinSetupBox').hidden = true;
  $('secOnlySetupBox').hidden = true;
  $('forgotPinBox').hidden = true;
  $('forgotVerifyWrap').hidden = false;
  $('resetPinWrap').hidden = true;
  $('loginCancelBtn').hidden = true;
  $('cancelForgotGap').hidden = true;
  $('pinInput').value = '';
  $('setupPin').value = '';
  $('setupQuestion').selectedIndex = 0;
  $('setupAnswer').value = '';
  $('secOnlyQuestion').selectedIndex = 0;
  $('secOnlyAnswer').value = '';
  $('forgotAnswer').value = '';
  $('newPinInput').value = '';
  $('forgotMsg').textContent = '';
  $('setupPinMsg').textContent = '';
}

async function showDefaultLoginScreen() {
  resetAuthBoxes();
  let userPinHash = await getSetting('userPinHash');
  $('loginActions').hidden = false;
  $('forgotWrap').hidden = !userPinHash;
  syncCancelForgotGap();
}

async function setLock() {
  clearSessionState();
  isGuest = false;
  currentHeaderTitle = 'OFFLINE Household Information';
  currentHeaderSub = 'Anabu II-C Resident Registry';
  $('appVersion').textContent = APP_VERSION;
  await showDefaultLoginScreen();
  $('lock').style.display = 'flex';
  $('app').hidden = true;
}

function openApp(targetPage = 'dashboard') {
  $('lock').style.display = 'none';
  $('app').hidden = false;
  applyHeader();
  saveSessionState(targetPage);
  switchPage(targetPage);
}

async function proceedAfterAuth() {
  let q = await getSetting('secQuestion');
  let a = await getSetting('secAnswerHash');
  if (!q || !a) {
    resetAuthBoxes();
    $('loginActions').hidden = true;
    $('forgotWrap').hidden = true;
    $('secOnlySetupBox').hidden = false;
    $('loginCancelBtn').hidden = false;
    syncCancelForgotGap();
    $('secOnlyQuestion').focus();
  } else {
    isGuest = false;
    openApp('dashboard');
  }
}

// Log-in button
$('loginBtn').onclick = async () => {
  resetAuthBoxes();
  $('loginActions').hidden = true;
  $('loginCancelBtn').hidden = false;
  let userPinHash = await getSetting('userPinHash');
  if (userPinHash) {
    $('pinLoginBox').hidden = false;
    $('forgotWrap').hidden = false;
    syncCancelForgotGap();
    $('pinInput').focus();
  } else {
    $('forgotWrap').hidden = true;
    $('pinSetupBox').hidden = false;
    syncCancelForgotGap();
    $('setupPin').focus();
  }
};

// Cancel button for Log-in / Setup flows
$('loginCancelBtn').onclick = async () => {
  await showDefaultLoginScreen();
};

// Auto-validate User PIN or Master PIN silently (no response if incorrect)
$('pinInput').addEventListener('input', async () => {
  let val = $('pinInput').value;
  if (!val) return;
  let inputHash = await hash(val);
  let userPinHash = await getSetting('userPinHash');
  let masterPins = (await getSetting('masterPins')) || [];

  const isMaster = masterPins.includes(inputHash);
  const isUser = userPinHash && inputHash === userPinHash;

  if (isMaster || isUser) {
    if (val === '24279') {
      currentHeaderTitle = 'Welcome Master Chary';
      currentHeaderSub = 'Administrator';
    } else if (val === '736435' || val === '82101110') {
      currentHeaderTitle = 'Welcome Master Reniel';
      currentHeaderSub = 'Administrator';
    } else {
      currentHeaderTitle = 'OFFLINE Household Information';
      currentHeaderSub = 'Anabu II-C Resident Registry';
    }
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
  if (!/^\d{2,}$/.test(p)) {
    $('setupPinMsg').textContent = 'PIN must be at least 2 digits.';
    return;
  }
  if (!q || !a) return;
  $('setupPinMsg').textContent = '';
  await setSetting('userPinHash', await hash(p));
  await setSetting('secQuestion', q);
  await setSetting('secAnswerHash', await hash(normalizeAnswer(a)));
  currentHeaderTitle = 'OFFLINE Household Information';
  currentHeaderSub = 'Anabu II-C Resident Registry';
  isGuest = false;
  openApp('dashboard');
});

// Security Question only setup
$('secOnlySetupBox').addEventListener('submit', async e => {
  e.preventDefault();
  let q = $('secOnlyQuestion').value;
  let a = $('secOnlyAnswer').value.trim();
  if (!q || !a) return;
  await setSetting('secQuestion', q);
  await setSetting('secAnswerHash', await hash(normalizeAnswer(a)));
  isGuest = false;
  openApp('dashboard');
});

// Guest Log-in button
$('guestBtn').onclick = () => {
  currentHeaderTitle = 'OFFLINE Household Information';
  currentHeaderSub = 'Anabu II-C Resident Registry';
  isGuest = true;
  openApp('dashboard');
};

// Forgot PIN label
$('forgotPinLabel').onclick = async () => {
  let userPinHash = await getSetting('userPinHash');
  if (!userPinHash) return;
  resetAuthBoxes();
  $('loginActions').hidden = true;
  $('forgotWrap').hidden = true;
  syncCancelForgotGap();
  let q = (await getSetting('secQuestion')) || 'Security Question';
  $('savedQuestionText').textContent = q;
  $('forgotVerifyWrap').hidden = false;
  $('forgotPinBox').hidden = false;
  $('forgotAnswer').focus();
};

// Forgot PIN Cancel button
$('forgotCancelBtn').onclick = async () => {
  await showDefaultLoginScreen();
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
    $('forgotVerifyWrap').hidden = true;
    $('resetPinWrap').hidden = false;
    $('newPinInput').focus();
  } else {
    $('forgotMsg').textContent = 'Incorrect answer. Please try again.';
  }
};

// Save new PIN to database and log in
$('saveNewPinBtn').onclick = async () => {
  let newPin = $('newPinInput').value.trim();
  if (!/^\d{2,}$/.test(newPin)) {
    $('forgotMsg').textContent = 'New PIN must be at least 2 digits.';
    return;
  }
  $('forgotMsg').textContent = '';
  await setSetting('userPinHash', await hash(newPin));
  currentHeaderTitle = 'OFFLINE Household Information';
  currentHeaderSub = 'Anabu II-C Resident Registry';
  isGuest = false;
  openApp('dashboard');
};

$('lockBtn').onclick = setLock;
document.querySelectorAll('.nav').forEach(b => b.onclick = () => switchPage(b.dataset.page));

async function restoreSessionIfActive() {
  if (sessionStorage.getItem('his-session-active') !== '1') {
    await setLock();
    return;
  }
  isGuest = sessionStorage.getItem('his-session-guest') === '1';
  currentHeaderTitle = sessionStorage.getItem('his-session-header-title') || 'OFFLINE Household Information';
  currentHeaderSub = sessionStorage.getItem('his-session-header-sub') || 'Anabu II-C Resident Registry';
  let savedPage = sessionStorage.getItem('his-session-page') || 'dashboard';
  let savedFilters = getFilterState();
  page = Number(savedFilters.page) || 0;

  openApp(savedPage);

  try {
    let draft = JSON.parse(sessionStorage.getItem('his-session-draft') || 'null');
    if (draft && draft.open && draft.values) {
      $('residentForm').reset();
      $('rid').value = draft.rid || '';
      $('formTitle').textContent = draft.formTitle || (draft.rid ? 'Edit resident' : 'Add resident');
      fields.forEach(f => {
        if (f !== 'subloc') $(f).value = draft.values[f] ?? '';
      });
      locLogic(draft.values.subloc || '');
      checkDuplicateUI();
      $('recordDialog').showModal();
    }
  } catch {
    clearDraft();
  }
}

async function start() {
  fillSelects();
  db = await openDB();
  await initAuthDB();
  await getAll();
  await restoreSessionIfActive();
}
start();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
