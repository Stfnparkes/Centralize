// JWT + RBAC middleware + password hashing (built-in crypto.scrypt — no deps).
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { userById } = require('./db');

// If no JWT_SECRET is provided, generate a fresh one for this process.
// This means restarting the server (e.g. after deleting backend/data/) will
// invalidate every previously-issued token and force users to sign in again.
const JWT_SECRET  = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRES = process.env.JWT_EXPIRES || '12h';
const SCRYPT_N   = 16384;
const SCRYPT_R   = 8;
const SCRYPT_P   = 1;
const KEY_LEN    = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return salt.toString('hex') + ':' + hash.toString('hex');
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  let saltBuf, hashBuf;
  try {
    saltBuf = Buffer.from(saltHex, 'hex');
    hashBuf = Buffer.from(hashHex, 'hex');
  } catch { return false; }
  if (hashBuf.length !== KEY_LEN) return false;
  let candidate;
  try {
    candidate = crypto.scryptSync(password, saltBuf, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  } catch { return false; }
  return crypto.timingSafeEqual(candidate, hashBuf);
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name, playerId: user.player_id || null, email: user.email || null },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function decode(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

function requireAuth(req, res, next) {
  const payload = decode(req);
  if (!payload) return res.status(401).json({ error: 'unauthenticated' });
  const user = userById(payload.sub);
  if (!user) return res.status(401).json({ error: 'unknown user' });
  req.user = { ...user, ...payload };
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden', requires: roles });
    next();
  };
}

module.exports = { signToken, decode, requireAuth, requireRole, hashPassword, verifyPassword };
