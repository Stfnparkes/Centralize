// Centralize frontend runtime — sits between the React modules and the
// Express backend.  Overrides window.storage so every existing
// `await window.storage.*` call becomes a REST call.  `currentUser:*` and
// `ui:*` keys stay in localStorage so the role gate is synchronous.
//
// Loaded BEFORE the babel script in every module HTML file.
(function () {
  const API   = (window.SPMA_API_BASE || '') + '/api';
  const TOKEN_KEY = 'spma:token';

  function isLocalKey(k) { return /^(currentUser:|ui:|spma:)/.test(k || ''); }
  function getToken()   { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
  function setToken(t)  { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} }

  // Single source of truth for redirect-on-401 so multiple in-flight requests
  // don't all kick off their own navigation.
  let redirecting = false;
  function bounceToLogin() {
    if (redirecting) return;
    if (/login\.html$/.test(location.pathname)) return;
    redirecting = true;
    // Clear identity + token so login.html starts clean.
    setToken(null);
    try {
      localStorage.removeItem('currentUser:role');
      localStorage.removeItem('currentUser:name');
      localStorage.removeItem('currentUser:playerId');
    } catch {}
    location.href = 'login.html';
  }

  async function api(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const t = getToken();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    let res;
    try {
      res = await fetch(API + path, {
        method, headers, body: body == null ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      // Network error — surface as a thrown error; callers can decide.
      throw new Error('network error: ' + e.message);
    }
    if (res.status === 401) {
      bounceToLogin();
      throw new Error('unauthenticated');
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status}: ${detail || res.statusText}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  }

  function splitKey(combined) {
    const idx = combined.indexOf(':');
    if (idx === -1) return { prefix: combined, key: '' };
    return { prefix: combined.slice(0, idx), key: combined.slice(idx + 1) };
  }

  const localShim = {
    async get(k)   { const v = localStorage.getItem(k); if (v === null) throw new Error('not found'); return { value: v }; },
    async set(k,v) { localStorage.setItem(k, v); return true; },
    async delete(k){ localStorage.removeItem(k); return true; },
    async list(p)  {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(p)) out.push(k);
      }
      return { keys: out };
    },
  };

  const remoteShim = {
    async get(k) {
      const { prefix, key } = splitKey(k);
      if (!prefix || !key || key === '__seeded') throw new Error('not found');
      try {
        const r = await api('GET', `/kv/${encodeURIComponent(prefix)}/${encodeURIComponent(key)}`);
        return { value: r.value };
      } catch (e) {
        if (e.status === 404) throw new Error('not found');
        throw e;
      }
    },
    async set(k, v) {
      const { prefix, key } = splitKey(k);
      if (!prefix || !key || key === '__seeded') return true;
      const value = typeof v === 'string' ? v : JSON.stringify(v);
      await api('PUT', `/kv/${encodeURIComponent(prefix)}/${encodeURIComponent(key)}`, { value });
      return true;
    },
    async delete(k) {
      const { prefix, key } = splitKey(k);
      if (!prefix || !key || key === '__seeded') return true;
      await api('DELETE', `/kv/${encodeURIComponent(prefix)}/${encodeURIComponent(key)}`);
      return true;
    },
    async list(p) {
      const prefix = p.endsWith(':') ? p.slice(0, -1) : p;
      try {
        const r = await api('GET', `/kv/${encodeURIComponent(prefix)}`);
        if (r.items) for (const it of r.items) cachePut(it.key, it.value);
        return { keys: r.keys || [] };
      } catch (e) {
        return { keys: [] };
      }
    },
  };

  // Tiny in-memory cache populated by list().
  const cache = new Map();
  function cachePut(k, v) { cache.set(k, v); }
  function cacheGet(k)    { return cache.get(k); }
  function cacheClear(prefix) {
    for (const k of [...cache.keys()]) if (k.startsWith(prefix + ':')) cache.delete(k);
  }

  const wrappedRemote = {
    async get(k) {
      const cached = cacheGet(k);
      if (cached !== undefined) return { value: cached };
      return remoteShim.get(k);
    },
    async set(k, v) {
      const { prefix } = splitKey(k);
      cacheClear(prefix);
      return remoteShim.set(k, v);
    },
    async delete(k) {
      const { prefix } = splitKey(k);
      cacheClear(prefix);
      return remoteShim.delete(k);
    },
    list: remoteShim.list,
  };

  window.storage = {
    async get(k)   { return isLocalKey(k) ? localShim.get(k)   : wrappedRemote.get(k); },
    async set(k,v) { return isLocalKey(k) ? localShim.set(k,v) : wrappedRemote.set(k, v); },
    async delete(k){ return isLocalKey(k) ? localShim.delete(k): wrappedRemote.delete(k); },
    async list(p)  { return isLocalKey(p) ? localShim.list(p)  : wrappedRemote.list(p); },
  };

  // Auth helpers used by login.html and the sign-out buttons in modules.
  window.cs_auth = {
    // Email + password login. Returns the user record on success; throws on
    // network failure or 401.  The server enforces role lookup — callers
    // do not pick role.
    async login(email, password) {
      const r = await api('POST', '/auth/login', { email, password });
      setToken(r.token);
      localStorage.setItem('currentUser:role',     JSON.stringify(r.user.role));
      localStorage.setItem('currentUser:name',     JSON.stringify(r.user.name));
      if (r.user.playerId) localStorage.setItem('currentUser:playerId', JSON.stringify(r.user.playerId));
      else localStorage.removeItem('currentUser:playerId');
      return r.user;
    },

    async logout() {
      try { await api('POST', '/auth/logout'); } catch {}
      setToken(null);
      ['currentUser:role','currentUser:name','currentUser:playerId'].forEach(k => localStorage.removeItem(k));
    },

    async me() {
      try { return (await api('GET', '/auth/me')).user; }
      catch { return null; }
    },

    // Module pages call this on mount.  If the server says the session is
    // invalid (no token, expired, user record deleted) OR the role doesn't
    // match the module's `expectedRole`, redirect to login.  Returns the
    // verified user, or null if a redirect was triggered.
    async requireSession(expectedRole) {
      if (!getToken()) { bounceToLogin(); return null; }
      const user = await this.me();
      if (!user) { bounceToLogin(); return null; }
      if (expectedRole && user.role !== expectedRole) { bounceToLogin(); return null; }
      // Mirror identity to localStorage so role-gated UI is consistent.
      localStorage.setItem('currentUser:role', JSON.stringify(user.role));
      localStorage.setItem('currentUser:name', JSON.stringify(user.name));
      if (user.playerId) localStorage.setItem('currentUser:playerId', JSON.stringify(user.playerId));
      else localStorage.removeItem('currentUser:playerId');
      return user;
    },

    hasToken() { return !!getToken(); },
  };

  window.cs_api = (method, path, body) => api(method, path, body);
})();
