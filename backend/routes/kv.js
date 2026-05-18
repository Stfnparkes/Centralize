// /api/kv — generic key/value over the SQLite store. Mirrors the frontend
// window.storage interface: list / get / set / delete, scoped by prefix.
//
// RBAC: every prefix has an allowlist of roles that can read/write it.
// Anything not explicitly allowlisted is closed. This matches the SRS
// access matrix without needing per-row checks for the prototype.
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../lib/auth');
const { kvList, kvGet, kvSet, kvDelete, audit } = require('../lib/db');

// Access matrix. true = allowed. Defaults to false. The frontend tries to
// list every prefix at startup; unauthorized lists return [].
//
// prefix: { read: ['player','coach','trainer'], write: ['coach'] }
const ACCESS = {
  // SHARED CATALOG
  roster:          { read: ['player','coach','trainer','admin'], write: ['coach','admin'] },
  games:           { read: ['player','coach','trainer','admin'], write: ['coach','admin'] },
  gameStats:       { read: ['player','coach','trainer','admin'], write: ['coach','admin'] },
  teamStats:       { read: ['player','coach','trainer','admin'], write: ['coach','admin'] },
  teamProfile:     { read: ['player','coach','trainer','admin'], write: ['coach','admin'] },

  // PLAYS / VIDEOS / ROTATIONS / TRAINING — coach-owned, player consumes
  plays:           { read: ['player','coach','trainer','admin'], write: ['coach','admin'] },
  playbooks:       { read: ['player','coach','trainer','admin'], write: ['coach','admin'] },
  drills:          { read: ['coach','trainer','admin'],          write: ['coach','admin'] },
  practiceSessions:{ read: ['player','coach','trainer','admin'], write: ['coach','admin'] },
  videos:          { read: ['player','coach','admin'],           write: ['coach','admin'] },
  images:          { read: ['player','coach','admin'],           write: ['coach','admin'] },
  audio:           { read: ['player','coach','admin'],           write: ['coach','admin'] },
  rotations:       { read: ['player','coach','admin'],           write: ['coach','admin'] },
  training:        { read: ['player','coach','trainer','admin'], write: ['coach','trainer','admin'] },

  // PLAYER PROFILE — player authors, coach verifies
  playerProfiles:  { read: ['player','coach','trainer','admin'], write: ['player','coach','admin'] },

  // TRAINER-OWNED — trainer writes, player reads ATTR-04 / WRK-08 / WRK-09 / coach reads INJ-04
  attributes:      { read: ['player','coach','trainer','admin'], write: ['trainer','admin'] },
  workouts:        { read: ['player','coach','trainer','admin'], write: ['trainer','admin'] },
  dietPlans:       { read: ['player','trainer','admin'],         write: ['trainer','admin'] },
  injuries:        { read: ['coach','trainer','admin'],          write: ['trainer','admin'] },
  exercises:       { read: ['trainer','admin'],                  write: ['trainer','admin'] },

  // MESSAGES — every role reads & writes (visibility filtering is in the frontend)
  messages:        { read: ['player','coach','trainer','admin'], write: ['player','coach','trainer','admin'] },
};

function can(action, prefix, role) {
  const rule = ACCESS[prefix];
  if (!rule) return false;
  return (rule[action] || []).includes(role);
}

// GET /api/kv/:prefix → returns all items under prefix (frontend list+get fused)
router.get('/:prefix', requireAuth, (req, res) => {
  const { prefix } = req.params;
  if (!can('read', prefix, req.user.role)) return res.json({ keys: [] });
  const rows = kvList(prefix);
  res.json({
    keys: rows.map(r => `${prefix}:${r.key}`),
    items: rows.map(r => ({ key: `${prefix}:${r.key}`, value: r.value, updatedAt: r.updated_at })),
  });
});

// GET /api/kv/:prefix/:key → single get
router.get('/:prefix/:key', requireAuth, (req, res) => {
  const { prefix, key } = req.params;
  if (!can('read', prefix, req.user.role)) return res.status(403).json({ error: 'forbidden' });
  const row = kvGet(prefix, key);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ value: row.value, updatedAt: row.updated_at });
});

// PUT /api/kv/:prefix/:key → upsert
router.put('/:prefix/:key', requireAuth, (req, res) => {
  const { prefix, key } = req.params;
  if (!can('write', prefix, req.user.role)) return res.status(403).json({ error: 'forbidden' });
  const value = typeof req.body?.value === 'string' ? req.body.value : JSON.stringify(req.body);
  const updatedAt = kvSet(prefix, key, value, req.user.id);
  audit(req.user.id, req.user.role, 'kv.set', prefix, key, null);
  res.json({ ok: true, updatedAt });
});

// DELETE /api/kv/:prefix/:key
router.delete('/:prefix/:key', requireAuth, (req, res) => {
  const { prefix, key } = req.params;
  if (!can('write', prefix, req.user.role)) return res.status(403).json({ error: 'forbidden' });
  const changes = kvDelete(prefix, key);
  audit(req.user.id, req.user.role, 'kv.delete', prefix, key, null);
  res.json({ ok: true, deleted: changes });
});

router.get('/_access', (req, res) => res.json(ACCESS));

module.exports = router;
