// SPMA — Express + SQLite backend. Serves the four SPL modules plus
// /api/auth and /api/kv. Single process, run with `npm start`.
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const authRoutes = require('./routes/auth');
const kvRoutes   = require('./routes/kv');
const seed       = require('./db/seed');

const PORT = parseInt(process.env.PORT || '3000', 10);
const FRONTEND_DIR = path.resolve(__dirname, '..', 'frontend');

// Run idempotent seed on boot — populates users + canonical kv if empty.
seed.run();

const app = express();
app.use(cors());                       // dev-only; lock down via env in prod
app.use(express.json({ limit: '6mb' })); // photo data-urls fit under 5MB

// Health + meta
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));
app.get('/api/version', (req, res) => res.json({ name: 'SPMA', version: '1.0.0' }));

// Auth + KV
app.use('/api/auth', authRoutes);
app.use('/api/kv',   kvRoutes);

// Static frontend — everything in ../frontend served as-is.
app.use(express.static(FRONTEND_DIR, { extensions: ['html'] }));

// SPA-ish fallback: any unmatched GET that doesn't look like an API call
// redirects to login.html.
app.get(/^(?!\/api).+/, (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'login.html')));

// Error envelope
app.use((err, req, res, next) => {
  console.error('[err]', err);
  res.status(500).json({ error: 'internal', detail: String(err?.message || err) });
});

app.listen(PORT, () => {
  console.log(`SPMA backend listening on http://localhost:${PORT}`);
  console.log(`  Open http://localhost:${PORT}/login.html to sign in.`);
});
