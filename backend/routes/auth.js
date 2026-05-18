// /api/auth — email + password login. Role is determined by the user record,
// not by the caller.
const express = require('express');
const router  = express.Router();
const { signToken, requireAuth, verifyPassword } = require('../lib/auth');
const { audit, _state } = require('../lib/db');

function findUserByEmail(email) {
  if (!email) return null;
  const target = String(email).trim().toLowerCase();
  for (const u of Object.values(_state.users)) {
    if (u.email && u.email.toLowerCase() === target) return u;
  }
  return null;
}

// POST /api/auth/login   { email, password }   →  { token, user }
// The role + playerId in the response come from the DB record, never from
// the request. Wrong password → 401.
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email + password required' });
  const user = findUserByEmail(email);
  if (!user) {
    audit(null, null, 'auth.login.fail', null, null, JSON.stringify({ email, reason: 'no_such_user' }));
    return res.status(401).json({ error: 'invalid email or password' });
  }
  if (!verifyPassword(password, user.password_hash)) {
    audit(user.id, user.role, 'auth.login.fail', null, null, JSON.stringify({ email, reason: 'bad_password' }));
    return res.status(401).json({ error: 'invalid email or password' });
  }
  const token = signToken(user);
  audit(user.id, user.role, 'auth.login', null, null, null);
  res.json({
    token,
    user: { id: user.id, role: user.role, name: user.name, playerId: user.player_id || null, email: user.email || null },
  });
});

router.post('/logout', requireAuth, (req, res) => {
  audit(req.user.id, req.user.role, 'auth.logout', null, null, null);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, role: req.user.role, name: req.user.name, playerId: req.user.player_id || null, email: req.user.email || null } });
});

module.exports = router;
