// JSON file store. Pure-JS — no native deps. Atomic writes via temp file
// + rename. Fine for a single-process prototype.
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'spma.json');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let state = { kv: {}, users: {}, audit: [] };
if (fs.existsSync(DB_PATH)) {
  try { state = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch (e) { console.error('[db] could not parse', DB_PATH, '-- starting fresh:', e.message); }
}
state.kv    ||= {};
state.users ||= {};
state.audit ||= [];

let writeTimer = null;
function persist() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    const tmp = DB_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, DB_PATH);
    writeTimer = null;
  }, 30);
}

function kvKey(prefix, key) { return prefix + ':' + key; }

function kvList(prefix) {
  const out = [];
  for (const k of Object.keys(state.kv)) {
    if (k.startsWith(prefix + ':')) {
      const row = state.kv[k];
      out.push({ key: k.slice(prefix.length + 1), value: row.value, updated_at: row.updated_at });
    }
  }
  out.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  return out;
}
function kvGet(prefix, key) {
  const row = state.kv[kvKey(prefix, key)];
  return row ? { key, value: row.value, updated_at: row.updated_at } : null;
}
function kvSet(prefix, key, value, userId) {
  const now = Date.now();
  state.kv[kvKey(prefix, key)] = { value, updated_at: now, updated_by: userId || null };
  persist();
  return now;
}
function kvDelete(prefix, key) {
  const k = kvKey(prefix, key);
  if (!(k in state.kv)) return 0;
  delete state.kv[k];
  persist();
  return 1;
}
function kvDeletePrefix(prefix) {
  let n = 0;
  for (const k of Object.keys(state.kv)) {
    if (k.startsWith(prefix + ':')) { delete state.kv[k]; n++; }
  }
  if (n) persist();
  return n;
}
function kvHasPrefix(prefix) {
  for (const k of Object.keys(state.kv)) if (k.startsWith(prefix + ':')) return true;
  return false;
}

function audit(userId, role, action, prefix, key, detail) {
  state.audit.push({
    occurred_at: Date.now(),
    user_id: userId || null,
    role: role || null,
    action: action,
    prefix: prefix || null,
    key: key || null,
    detail: detail || null,
  });
  if (state.audit.length > 5000) state.audit.splice(0, state.audit.length - 5000);
  persist();
}

function userByPlayerId(playerId) {
  for (const u of Object.values(state.users)) {
    if (u.role === 'player' && u.player_id === playerId) return u;
  }
  return null;
}
function userByRole(role) {
  for (const u of Object.values(state.users)) if (u.role === role) return u;
  return null;
}
function userById(id) { return state.users[id] || null; }
function upsertUser(u) {
  const merged = {
    email: null, password_hash: null, created_at: Date.now(),
    ...state.users[u.id], ...u,
  };
  state.users[u.id] = merged;
  persist();
  return merged;
}

module.exports = {
  kvList, kvGet, kvSet, kvDelete, kvDeletePrefix, kvHasPrefix,
  audit,
  userByPlayerId, userByRole, userById, upsertUser,
  _state: state,
};
