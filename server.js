const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== Database Layer ====================
// Uses PostgreSQL (via DATABASE_URL) when available, falls back to JSON file
const DATABASE_URL = process.env.DATABASE_URL;
let pool = null;

if (DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
  });
  console.log('Using PostgreSQL database');
} else {
  console.log('Using local JSON file storage');
}

const DATA_FILE = path.join(__dirname, 'lab-finance-data.json');
let localData = { users: [], suppliers: [], records: [] };

function genId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

const DEFAULT_USERS = [
  { id: 'u1', name: '系统管理员', username: 'admin', password: 'admin123', role: 'admin' },
  { id: 'u2', name: '张录入', username: 'recorder', password: '123456', role: 'recorder' },
  { id: 'u3', name: '李核查', username: 'verifier', password: '123456', role: 'verifier' },
];

const DEFAULT_SUPPLIERS = [
  { id: 's1', name: '生工生物工程有限公司', contact: '王经理', phone: '13800001111', address: '上海市松江区', bankAccount: '6222 0000 1111 2222', notes: '常规试剂供应商' },
  { id: 's2', name: '赛默飞世尔科技', contact: '刘经理', phone: '13900002222', address: '北京市朝阳区', bankAccount: '6222 0000 3333 4444', notes: '仪器设备供应商' },
  { id: 's3', name: '国药集团化学试剂', contact: '陈经理', phone: '13700003333', address: '上海市黄浦区', bankAccount: '6222 0000 5555 6666', notes: '化学试剂供应商' },
];

// ==================== Database Operations ====================
async function initDB() {
  if (pool) {
    // PostgreSQL: create tables and seed default data
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lfc_users (
        id TEXT PRIMARY KEY,
        name TEXT, username TEXT UNIQUE, password TEXT, role TEXT
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lfc_suppliers (
        id TEXT PRIMARY KEY,
        name TEXT, contact TEXT, phone TEXT, address TEXT, bankAccount TEXT, notes TEXT
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lfc_records (
        id TEXT PRIMARY KEY,
        date TEXT, supplierId TEXT, category TEXT, receiptNo TEXT, purchaser TEXT,
        itemName TEXT, specification TEXT, unit TEXT,
        quantity NUMERIC, unitPrice NUMERIC, totalAmount NUMERIC,
        recorder TEXT, recorderId TEXT, status TEXT, notes TEXT,
        verifiedBy TEXT, verifierId TEXT, verifiedAmount NUMERIC,
        difference NUMERIC, verifiedAt TEXT, verifyNote TEXT,
        createdAt TEXT
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lfc_sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT,
        expire TIMESTAMPTZ
      );
    `);

    // Seed default users if empty
    const userCount = await pool.query('SELECT COUNT(*) FROM lfc_users');
    if (parseInt(userCount.rows[0].count) === 0) {
      for (const u of DEFAULT_USERS) {
        await pool.query('INSERT INTO lfc_users VALUES($1,$2,$3,$4,$5)',
          [u.id, u.name, u.username, u.password, u.role]);
      }
      console.log('Seeded default users');
    }

    // Seed default suppliers if empty
    const supCount = await pool.query('SELECT COUNT(*) FROM lfc_suppliers');
    if (parseInt(supCount.rows[0].count) === 0) {
      for (const s of DEFAULT_SUPPLIERS) {
        await pool.query('INSERT INTO lfc_suppliers VALUES($1,$2,$3,$4,$5,$6,$7)',
          [s.id, s.name, s.contact, s.phone, s.address, s.bankAccount, s.notes]);
      }
      console.log('Seeded default suppliers');
    }
  } else {
    // JSON file: load or create
    if (fs.existsSync(DATA_FILE)) {
      localData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } else {
      localData.users = [...DEFAULT_USERS];
      localData.suppliers = [...DEFAULT_SUPPLIERS];
      localData.records = [];
      saveLocal();
    }
  }
}

function saveLocal() {
  if (!pool) fs.writeFileSync(DATA_FILE, JSON.stringify(localData, null, 2));
}

// User operations
async function getUsers() {
  if (pool) {
    const r = await pool.query('SELECT * FROM lfc_users ORDER BY name');
    return r.rows.map(row => ({
      id: row.id, name: row.name, username: row.username, password: row.password, role: row.role
    }));
  }
  return localData.users;
}

async function addUser(u) {
  if (pool) {
    await pool.query('INSERT INTO lfc_users VALUES($1,$2,$3,$4,$5)',
      [genId('u'), u.name, u.username, u.password, u.role]);
    const r = await pool.query('SELECT * FROM lfc_users WHERE username=$1', [u.username]);
    return r.rows[0];
  }
  const user = { id: genId('u'), ...u };
  localData.users.push(user); saveLocal();
  return user;
}

async function updateUser(id, u) {
  if (pool) {
    await pool.query('UPDATE lfc_users SET name=$1,password=$2,role=$3 WHERE id=$4',
      [u.name, u.password, u.role, id]);
    const r = await pool.query('SELECT * FROM lfc_users WHERE id=$1', [id]);
    return r.rows[0];
  }
  const idx = localData.users.find(x => x.id === id);
  if (idx) Object.assign(idx, u, { id });
  saveLocal();
  return idx;
}

async function deleteUser(id) {
  if (pool) await pool.query('DELETE FROM lfc_users WHERE id=$1', [id]);
  else { localData.users = localData.users.filter(u => u.id !== id); saveLocal(); }
}

// Supplier operations
async function getSuppliers() {
  if (pool) {
    const r = await pool.query('SELECT * FROM lfc_suppliers ORDER BY name');
    return r.rows.map(row => ({
      id: row.id, name: row.name, contact: row.contact, phone: row.phone,
      address: row.address, bankAccount: row.bankaccount, notes: row.notes
    }));
  }
  return localData.suppliers;
}

async function addSupplier(s) {
  if (pool) {
    const id = genId('s');
    await pool.query('INSERT INTO lfc_suppliers VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id, s.name, s.contact || '', s.phone || '', s.address || '', s.bankAccount || '', s.notes || '']);
    const r = await pool.query('SELECT * FROM lfc_suppliers WHERE id=$1', [id]);
    return r.rows[0];
  }
  const sup = { id: genId('s'), ...s };
  localData.suppliers.push(sup); saveLocal();
  return sup;
}

async function updateSupplier(id, s) {
  if (pool) {
    await pool.query('UPDATE lfc_suppliers SET name=$1,contact=$2,phone=$3,address=$4,bankAccount=$5,notes=$6 WHERE id=$7',
      [s.name, s.contact || '', s.phone || '', s.address || '', s.bankAccount || '', s.notes || '', id]);
    const r = await pool.query('SELECT * FROM lfc_suppliers WHERE id=$1', [id]);
    return r.rows[0];
  }
  const idx = localData.suppliers.find(x => x.id === id);
  if (idx) Object.assign(idx, s, { id });
  saveLocal();
  return idx;
}

async function deleteSupplier(id) {
  if (pool) await pool.query('DELETE FROM lfc_suppliers WHERE id=$1', [id]);
  else { localData.suppliers = localData.suppliers.filter(s => s.id !== id); saveLocal(); }
}

// Record operations
function mapRecordRow(row) {
  return {
    id: row.id, date: row.date, supplierId: row.supplierid, category: row.category,
    receiptNo: row.receiptno, purchaser: row.purchaser, itemName: row.itemname,
    specification: row.specification, unit: row.unit,
    quantity: parseFloat(row.quantity) || 0, unitPrice: parseFloat(row.unitprice) || 0,
    totalAmount: parseFloat(row.totalamount) || 0,
    recorder: row.recorder, recorderId: row.recorderid,
    status: row.status, notes: row.notes,
    verifiedBy: row.verifiedby, verifierId: row.verifierid,
    verifiedAmount: row.verifiedamount ? parseFloat(row.verifiedamount) : null,
    difference: row.difference != null ? parseFloat(row.difference) : null,
    verifiedAt: row.verifiedat, verifyNote: row.verifynote,
    createdAt: row.createdat,
  };
}

async function getRecords() {
  if (pool) {
    const r = await pool.query('SELECT * FROM lfc_records ORDER BY date DESC, createdAt DESC');
    return r.rows.map(mapRecordRow);
  }
  return localData.records;
}

async function addRecord(rec) {
  if (pool) {
    const id = genId('r');
    await pool.query(`INSERT INTO lfc_records
      (id, date, supplierId, category, receiptNo, purchaser, itemName, specification, unit,
       quantity, unitPrice, totalAmount, recorder, recorderId, status, notes,
       verifiedBy, verifierId, verifiedAmount, difference, verifiedAt, verifyNote, createdAt)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [id, rec.date, rec.supplierId, rec.category, rec.receiptNo || '', rec.purchaser || '',
       rec.itemName, rec.specification || '', rec.unit || '',
       rec.quantity, rec.unitPrice, rec.totalAmount,
       rec.recorder || '', rec.recorderId || '', rec.status || 'pending', rec.notes || '',
       rec.verifiedBy || null, rec.verifierId || null, rec.verifiedAmount || null,
       rec.difference || null, rec.verifiedAt || null, rec.verifyNote || null,
       rec.createdAt || new Date().toISOString()]);
    const r = await pool.query('SELECT * FROM lfc_records WHERE id=$1', [id]);
    return mapRecordRow(r.rows[0]);
  }
  const record = { id: genId('r'), ...rec };
  localData.records.push(record); saveLocal();
  return record;
}

async function updateRecord(id, rec) {
  if (pool) {
    // First fetch existing record to preserve fields not being updated
    const existing = await pool.query('SELECT * FROM lfc_records WHERE id=$1', [id]);
    if (existing.rows.length === 0) return null;
    const old = mapRecordRow(existing.rows[0]);
    const merged = { ...old, ...rec, id };
    await pool.query(`UPDATE lfc_records SET
      date=$1, supplierId=$2, category=$3, receiptNo=$4, purchaser=$5, itemName=$6,
      specification=$7, unit=$8, quantity=$9, unitPrice=$10, totalAmount=$11, notes=$12,
      verifiedBy=$13, verifierId=$14, verifiedAmount=$15, difference=$16, verifiedAt=$17,
      verifyNote=$18, status=$19
      WHERE id=$20`,
      [merged.date, merged.supplierId, merged.category, merged.receiptNo || '', merged.purchaser || '',
       merged.itemName, merged.specification || '', merged.unit || '',
       merged.quantity, merged.unitPrice, merged.totalAmount, merged.notes || '',
       merged.verifiedBy || null, merged.verifierId || null, merged.verifiedAmount || null,
       merged.difference || null, merged.verifiedAt || null, merged.verifyNote || null,
       merged.status || 'pending', id]);
    const r = await pool.query('SELECT * FROM lfc_records WHERE id=$1', [id]);
    return mapRecordRow(r.rows[0]);
  }
  const idx = localData.records.find(r => r.id === id);
  if (idx) Object.assign(idx, rec, { id });
  saveLocal();
  return idx;
}

async function deleteRecord(id) {
  if (pool) await pool.query('DELETE FROM lfc_records WHERE id=$1', [id]);
  else { localData.records = localData.records.filter(r => r.id !== id); saveLocal(); }
}

async function clearAll() {
  if (pool) {
    await pool.query('DELETE FROM lfc_records');
    await pool.query('DELETE FROM lfc_suppliers');
    await pool.query('DELETE FROM lfc_users');
    for (const u of DEFAULT_USERS) {
      await pool.query('INSERT INTO lfc_users VALUES($1,$2,$3,$4,$5)',
        [u.id, u.name, u.username, u.password, u.role]);
    }
  } else {
    localData.records = [];
    localData.suppliers = [];
    localData.users = [...DEFAULT_USERS];
    saveLocal();
  }
}

async function exportAll() {
  return {
    users: await getUsers(),
    suppliers: await getSuppliers(),
    records: await getRecords(),
    exportDate: new Date().toISOString(),
  };
}

async function importAll(data) {
  await clearAll();
  if (data.users) {
    for (const u of data.users) {
      if (pool) await pool.query('INSERT INTO lfc_users VALUES($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING',
        [u.id || genId('u'), u.name, u.username, u.password, u.role]);
      else localData.users.push(u);
    }
  }
  if (data.suppliers) {
    for (const s of data.suppliers) {
      if (pool) await pool.query('INSERT INTO lfc_suppliers VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING',
        [s.id || genId('s'), s.name, s.contact || '', s.phone || '', s.address || '', s.bankAccount || '', s.notes || '']);
      else localData.suppliers.push(s);
    }
  }
  if (data.records) {
    for (const r of data.records) {
      await addRecord(r);
    }
  }
  if (!pool) saveLocal();
}

// ==================== Express App ====================
app.use(express.json({ limit: '10mb' }));

// Session: use PostgreSQL store if available, else MemoryStore
let sessionMiddleware;
if (pool) {
  const pgSession = require('connect-pg-simple')(session);
  sessionMiddleware = session({
    store: new pgSession({ pool, tableName: 'lfc_sessions' }),
    secret: process.env.SESSION_SECRET || 'lab-finance-checker-2024-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
  });
} else {
  sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'lab-finance-checker-2024-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
  });
}
app.use(sessionMiddleware);

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: '请先登录' });
  next();
}

// Serve static files
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'lab-finance-checker.html')));
app.get('/lab-finance-checker.html', (req, res) => res.sendFile(path.join(__dirname, 'lab-finance-checker.html')));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Auth
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const users = await getUsers();
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });
  req.session.user = { id: user.id, name: user.name, username: user.username, role: user.role };
  res.json(req.session.user);
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: '未登录' });
  res.json(req.session.user);
});

app.get('/api/init', requireAuth, async (req, res) => {
  res.json({
    users: await getUsers(),
    suppliers: await getSuppliers(),
    records: await getRecords(),
  });
});

// Users
app.get('/api/users', requireAuth, async (req, res) => res.json(await getUsers()));

app.post('/api/users', requireAuth, async (req, res) => {
  const users = await getUsers();
  if (users.find(u => u.username === req.body.username)) {
    return res.status(400).json({ error: '用户名已存在' });
  }
  const user = await addUser(req.body);
  res.json(user);
});

app.put('/api/users/:id', requireAuth, async (req, res) => {
  const user = await updateUser(req.params.id, req.body);
  res.json(user);
});

app.delete('/api/users/:id', requireAuth, async (req, res) => {
  await deleteUser(req.params.id);
  res.json({ ok: true });
});

// Suppliers
app.get('/api/suppliers', requireAuth, async (req, res) => res.json(await getSuppliers()));

app.post('/api/suppliers', requireAuth, async (req, res) => {
  const sup = await addSupplier(req.body);
  res.json(sup);
});

app.put('/api/suppliers/:id', requireAuth, async (req, res) => {
  const sup = await updateSupplier(req.params.id, req.body);
  res.json(sup);
});

app.delete('/api/suppliers/:id', requireAuth, async (req, res) => {
  await deleteSupplier(req.params.id);
  res.json({ ok: true });
});

// Records
app.get('/api/records', requireAuth, async (req, res) => res.json(await getRecords()));

app.post('/api/records', requireAuth, async (req, res) => {
  const rec = await addRecord(req.body);
  res.json(rec);
});

app.put('/api/records/:id', requireAuth, async (req, res) => {
  const rec = await updateRecord(req.params.id, req.body);
  res.json(rec);
});

app.put('/api/records/:id/verify', requireAuth, async (req, res) => {
  const rec = await updateRecord(req.params.id, req.body);
  res.json(rec);
});

app.delete('/api/records/:id', requireAuth, async (req, res) => {
  await deleteRecord(req.params.id);
  res.json({ ok: true });
});

// Export/Import/Clear
app.get('/api/export', requireAuth, async (req, res) => res.json(await exportAll()));

app.post('/api/import', requireAuth, async (req, res) => {
  const imported = req.body;
  if (!imported.records || !imported.suppliers) return res.status(400).json({ error: '数据格式错误' });
  await importAll(imported);
  res.json({ ok: true });
});

app.post('/api/clear', requireAuth, async (req, res) => {
  await clearAll();
  res.json({ ok: true });
});

// ==================== Start ====================
async function start() {
  await initDB();
  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  ========================================');
    console.log('   实验室财务核查系统已启动');
    console.log('  ========================================');
    console.log('');
    console.log('  访问地址: http://localhost:' + PORT);
    console.log('  存储: ' + (pool ? 'PostgreSQL' : 'JSON文件'));
    console.log('');
  });
}

start().catch(err => {
  console.error('启动失败:', err.message);
  process.exit(1);
});
