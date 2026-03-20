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

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    quantity TEXT DEFAULT '1',
    added_by TEXT NOT NULL,
    note TEXT DEFAULT '',
    bought INTEGER DEFAULT 0,
    bought_by TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    bought_at DATETIME DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_by TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    finished_at DATETIME DEFAULT NULL
  );
`);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Get all pending items
app.get('/api/items', (req, res) => {
  const items = db.prepare(`
    SELECT * FROM items WHERE bought = 0 ORDER BY created_at DESC
  `).all();
  res.json(items);
});

// Get bought items (history)
app.get('/api/items/history', (req, res) => {
  const items = db.prepare(`
    SELECT * FROM items WHERE bought = 1 ORDER BY bought_at DESC LIMIT 50
  `).all();
  res.json(items);
});

// Add item
app.post('/api/items', (req, res) => {
  const { name, quantity, added_by, note } = req.body;
  if (!name || !added_by) {
    return res.status(400).json({ error: 'Nombre y quién lo pide son obligatorios' });
  }
  const result = db.prepare(`
    INSERT INTO items (name, quantity, added_by, note) VALUES (?, ?, ?, ?)
  `).run(name, quantity || '1', added_by, note || '');
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(item);
});

// Mark item as bought
app.patch('/api/items/:id/buy', (req, res) => {
  const { bought_by } = req.body;
  db.prepare(`
    UPDATE items SET bought = 1, bought_by = ?, bought_at = datetime('now','localtime') WHERE id = ?
  `).run(bought_by || 'Alguien', req.params.id);
  res.json({ ok: true });
});

// Delete item
app.delete('/api/items/:id', (req, res) => {
  db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Active trip
app.get('/api/trip', (req, res) => {
  const trip = db.prepare(`
    SELECT * FROM trips WHERE status = 'active' ORDER BY created_at DESC LIMIT 1
  `).get();
  res.json(trip || null);
});

// Start a trip ("Voy al Mercadona!")
app.post('/api/trip', (req, res) => {
  const { started_by } = req.body;
  if (!started_by) return res.status(400).json({ error: 'Falta quién va' });
  // Close any active trip
  db.prepare(`UPDATE trips SET status = 'finished', finished_at = datetime('now','localtime') WHERE status = 'active'`).run();
  const result = db.prepare(`INSERT INTO trips (started_by) VALUES (?)`).run(started_by);
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(trip);
});

// End trip
app.post('/api/trip/finish', (req, res) => {
  db.prepare(`UPDATE trips SET status = 'finished', finished_at = datetime('now','localtime') WHERE status = 'active'`).run();
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Merca lista corriendo en puerto ${PORT}`);
});
