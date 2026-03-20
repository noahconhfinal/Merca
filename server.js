const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.CLOUDRON_APP_DATA || path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'merca.db'));
db.pragma('journal_mode = WAL');

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    quantity TEXT DEFAULT '1',
    added_by TEXT NOT NULL,
    note TEXT DEFAULT '',
    category TEXT DEFAULT '',
    urgent INTEGER DEFAULT 0,
    bought INTEGER DEFAULT 0,
    bought_by TEXT DEFAULT NULL,
    price REAL DEFAULT NULL,
    trip_id INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    bought_at DATETIME DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_by TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    total REAL DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    finished_at DATETIME DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    category TEXT DEFAULT '',
    note TEXT DEFAULT '',
    times_bought INTEGER DEFAULT 1
  );
`);

// Migrations: add columns if missing (safe for existing DBs)
const cols = db.prepare("PRAGMA table_info(items)").all().map(c => c.name);
if (!cols.includes('category')) db.exec("ALTER TABLE items ADD COLUMN category TEXT DEFAULT ''");
if (!cols.includes('urgent')) db.exec("ALTER TABLE items ADD COLUMN urgent INTEGER DEFAULT 0");
if (!cols.includes('price')) db.exec("ALTER TABLE items ADD COLUMN price REAL DEFAULT NULL");
if (!cols.includes('trip_id')) db.exec("ALTER TABLE items ADD COLUMN trip_id INTEGER DEFAULT NULL");

const tripCols = db.prepare("PRAGMA table_info(trips)").all().map(c => c.name);
if (!tripCols.includes('total')) db.exec("ALTER TABLE trips ADD COLUMN total REAL DEFAULT 0");

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Items ────────────────────────────────────────

// Get all pending items
app.get('/api/items', (req, res) => {
  const items = db.prepare(`
    SELECT * FROM items WHERE bought = 0 ORDER BY urgent DESC, created_at DESC
  `).all();
  res.json(items);
});

// Get bought items (history)
app.get('/api/items/history', (req, res) => {
  const items = db.prepare(`
    SELECT * FROM items WHERE bought = 1 ORDER BY bought_at DESC LIMIT 100
  `).all();
  res.json(items);
});

// Add item
app.post('/api/items', (req, res) => {
  const { name, quantity, added_by, note, category, urgent } = req.body;
  if (!name || !added_by) {
    return res.status(400).json({ error: 'Nombre y quién lo pide son obligatorios' });
  }
  const result = db.prepare(`
    INSERT INTO items (name, quantity, added_by, note, category, urgent) VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, quantity || '1', added_by, note || '', category || '', urgent ? 1 : 0);
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(item);
});

// Edit item
app.patch('/api/items/:id', (req, res) => {
  const { name, quantity, note, category, urgent } = req.body;
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'No encontrado' });
  db.prepare(`
    UPDATE items SET name = ?, quantity = ?, note = ?, category = ?, urgent = ? WHERE id = ?
  `).run(
    name ?? item.name,
    quantity ?? item.quantity,
    note ?? item.note,
    category ?? item.category,
    urgent !== undefined ? (urgent ? 1 : 0) : item.urgent,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id));
});

// Mark item as bought
app.patch('/api/items/:id/buy', (req, res) => {
  const { bought_by } = req.body;
  const activeTrip = db.prepare("SELECT id FROM trips WHERE status = 'active' LIMIT 1").get();
  db.prepare(`
    UPDATE items SET bought = 1, bought_by = ?, bought_at = datetime('now','localtime'), trip_id = ? WHERE id = ?
  `).run(bought_by || 'Alguien', activeTrip ? activeTrip.id : null, req.params.id);
  res.json({ ok: true });
});

// Set price on a bought item
app.patch('/api/items/:id/price', (req, res) => {
  const { price } = req.body;
  if (price === undefined || price === null) return res.status(400).json({ error: 'Falta el precio' });
  db.prepare('UPDATE items SET price = ? WHERE id = ?').run(parseFloat(price), req.params.id);
  // Update trip total
  const item = db.prepare('SELECT trip_id FROM items WHERE id = ?').get(req.params.id);
  if (item && item.trip_id) {
    const total = db.prepare('SELECT COALESCE(SUM(price), 0) as total FROM items WHERE trip_id = ? AND price IS NOT NULL').get(item.trip_id);
    db.prepare('UPDATE trips SET total = ? WHERE id = ?').run(total.total, item.trip_id);
  }
  res.json({ ok: true });
});

// Undo buy (move back to pending)
app.patch('/api/items/:id/unbuy', (req, res) => {
  db.prepare(`
    UPDATE items SET bought = 0, bought_by = NULL, bought_at = NULL, price = NULL, trip_id = NULL WHERE id = ?
  `).run(req.params.id);
  res.json({ ok: true });
});

// Delete item
app.delete('/api/items/:id', (req, res) => {
  db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Trips ────────────────────────────────────────

// Active trip
app.get('/api/trip', (req, res) => {
  const trip = db.prepare(`
    SELECT * FROM trips WHERE status = 'active' ORDER BY created_at DESC LIMIT 1
  `).get();
  if (trip) {
    trip.items = db.prepare('SELECT * FROM items WHERE trip_id = ? AND bought = 1').all(trip.id);
  }
  res.json(trip || null);
});

// Trip history
app.get('/api/trips', (req, res) => {
  const trips = db.prepare(`
    SELECT * FROM trips WHERE status = 'finished' ORDER BY finished_at DESC LIMIT 20
  `).all();
  for (const trip of trips) {
    trip.items = db.prepare('SELECT * FROM items WHERE trip_id = ?').all(trip.id);
  }
  res.json(trips);
});

// Start trip
app.post('/api/trip', (req, res) => {
  const { started_by } = req.body;
  if (!started_by) return res.status(400).json({ error: 'Falta quién va' });
  db.prepare(`UPDATE trips SET status = 'finished', finished_at = datetime('now','localtime') WHERE status = 'active'`).run();
  const result = db.prepare('INSERT INTO trips (started_by) VALUES (?)').run(started_by);
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(result.lastInsertRowid);
  trip.items = [];
  res.status(201).json(trip);
});

// Finish trip
app.post('/api/trip/finish', (req, res) => {
  const trip = db.prepare("SELECT id FROM trips WHERE status = 'active' LIMIT 1").get();
  if (trip) {
    const total = db.prepare('SELECT COALESCE(SUM(price), 0) as total FROM items WHERE trip_id = ? AND price IS NOT NULL').get(trip.id);
    db.prepare("UPDATE trips SET status = 'finished', finished_at = datetime('now','localtime'), total = ? WHERE id = ?").run(total.total, trip.id);
  }
  res.json({ ok: true });
});

// ─── Balances ─────────────────────────────────────

// Get balance summary: who has paid how much for whom
app.get('/api/balances', (req, res) => {
  // All bought items with prices, grouped by who bought and who requested
  const rows = db.prepare(`
    SELECT bought_by, added_by, SUM(price) as total
    FROM items
    WHERE bought = 1 AND price IS NOT NULL AND bought_by != added_by
    GROUP BY bought_by, added_by
  `).all();

  // Calculate net debts
  const debts = {};
  for (const row of rows) {
    const key = [row.added_by, row.bought_by].sort().join('|');
    if (!debts[key]) debts[key] = { between: [row.added_by, row.bought_by].sort(), amount: 0 };
    // added_by owes bought_by
    if (debts[key].between[0] === row.added_by) {
      debts[key].amount += row.total;
    } else {
      debts[key].amount -= row.total;
    }
  }

  const result = Object.values(debts).map(d => ({
    from: d.amount > 0 ? d.between[0] : d.between[1],
    to: d.amount > 0 ? d.between[1] : d.between[0],
    amount: Math.abs(d.amount)
  })).filter(d => d.amount > 0.01);

  // Per-person totals
  const spent = db.prepare(`
    SELECT bought_by as name, SUM(price) as total
    FROM items WHERE bought = 1 AND price IS NOT NULL
    GROUP BY bought_by
  `).all();

  res.json({ debts: result, spent });
});

// Settle debt between two people
app.post('/api/balances/settle', (req, res) => {
  const { from, to } = req.body;
  if (!from || !to) return res.status(400).json({ error: 'Faltan datos' });
  // Mark all items between these two as settled by setting price to NULL
  // (or we could add a settled flag, but NULL price is simpler)
  db.prepare(`
    UPDATE items SET price = NULL
    WHERE bought = 1 AND price IS NOT NULL
    AND ((bought_by = ? AND added_by = ?) OR (bought_by = ? AND added_by = ?))
  `).run(to, from, from, to);
  res.json({ ok: true });
});

// ─── Favorites ────────────────────────────────────

app.get('/api/favorites', (req, res) => {
  const favs = db.prepare('SELECT * FROM favorites ORDER BY times_bought DESC').all();
  res.json(favs);
});

app.post('/api/favorites', (req, res) => {
  const { name, category, note } = req.body;
  if (!name) return res.status(400).json({ error: 'Falta nombre' });
  const existing = db.prepare('SELECT * FROM favorites WHERE name = ?').get(name);
  if (existing) {
    db.prepare('UPDATE favorites SET times_bought = times_bought + 1 WHERE id = ?').run(existing.id);
    res.json(existing);
  } else {
    const result = db.prepare('INSERT INTO favorites (name, category, note) VALUES (?, ?, ?)').run(name, category || '', note || '');
    res.status(201).json(db.prepare('SELECT * FROM favorites WHERE id = ?').get(result.lastInsertRowid));
  }
});

app.delete('/api/favorites/:id', (req, res) => {
  db.prepare('DELETE FROM favorites WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Auto-add to favorites when an item is bought
function autoFavorite(itemName, category, note) {
  const existing = db.prepare('SELECT * FROM favorites WHERE name = ?').get(itemName);
  if (existing) {
    db.prepare('UPDATE favorites SET times_bought = times_bought + 1 WHERE id = ?').run(existing.id);
  } else {
    db.prepare('INSERT OR IGNORE INTO favorites (name, category, note) VALUES (?, ?, ?)').run(itemName, category || '', note || '');
  }
}

// Hook: auto-favorite on buy
const origBuy = app._router;

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Merca corriendo en puerto ${PORT}`);
});
