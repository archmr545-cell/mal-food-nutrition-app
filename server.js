require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("JWT_SECRET wajib ada dan minimal 32 karakter.");
  process.exit(1);
}
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
  console.error("ADMIN_EMAIL dan ADMIN_PASSWORD wajib diisi di .env.");
  process.exit(1);
}
if (process.env.ADMIN_PASSWORD.length < 8) {
  console.error("ADMIN_PASSWORD minimal 8 karakter.");
  process.exit(1);
}

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req,res) => {
    const isLogin = req.path === "/api/auth/login";
    res.status(429).json({
      error: isLogin
        ? "Terlalu banyak percobaan login. Tunggu 15 menit lalu coba lagi."
        : "Terlalu banyak permintaan autentikasi. Tunggu beberapa menit lalu coba lagi."
    });
  }
});
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => req.path.startsWith("/auth/"),
  handler: (req,res) => res.status(429).json({
    error: "Terlalu banyak permintaan. Tunggu beberapa menit lalu coba lagi."
  })
});

app.use("/api", generalLimiter);

const db = new Database(path.join(__dirname, "database.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  birth_day INTEGER NOT NULL,
  birth_month INTEGER NOT NULL,
  birth_year INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS foods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  serving TEXT NOT NULL,
  calories REAL NOT NULL CHECK(calories >= 0),
  protein REAL NOT NULL DEFAULT 0 CHECK(protein >= 0),
  carbs REAL NOT NULL DEFAULT 0 CHECK(carbs >= 0),
  fat REAL NOT NULL DEFAULT 0 CHECK(fat >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS diary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  food_id INTEGER NOT NULL,
  amount REAL NOT NULL CHECK(amount > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(food_id) REFERENCES foods(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS password_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  email TEXT NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_diary_user_created ON diary(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_status ON password_reports(status);

CREATE TABLE IF NOT EXISTS data_seeds (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS site_visitors (
  visitor_id TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS site_visits (
  session_id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  page_path TEXT NOT NULL DEFAULT '/',
  visited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(visitor_id) REFERENCES site_visitors(visitor_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_site_visits_visited_at ON site_visits(visited_at);
`);

if (!db.prepare("PRAGMA table_info(users)").all().some(column => column.name === "token_version")) {
  db.exec("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0");
}

const seedFoods = [
  ["Nasi putih","100 g",130,2.7,28,0.3],
  ["Ayam goreng","100 g",260,25,8,15],
  ["Dada ayam panggang","100 g",165,31,0,3.6],
  ["Telur ayam","1 butir",78,6.3,0.6,5.3],
  ["Tempe","100 g",193,19,9,11],
  ["Tahu","100 g",76,8,1.9,4.8],
  ["Pisang","1 buah",105,1.3,27,0.4],
  ["Apel","1 buah",95,0.5,25,0.3],
  ["Mie instan","1 bungkus",380,8,52,16],
  ["Susu","250 ml",150,8,12,8],
  ["Roti tawar","2 lembar",140,5,26,2],
  ["Oatmeal","40 g",150,5,27,3],
  ["Alpukat","100 g",160,2,8.5,15],
  ["Ikan tuna","100 g",132,28,0,1.3],
  ["Kentang rebus","100 g",87,1.9,20,0.1]
];

if (db.prepare("SELECT COUNT(*) AS n FROM foods").get().n === 0) {
  const insert = db.prepare(`
    INSERT INTO foods(name, serving, calories, protein, carbs, fat)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => seedFoods.forEach(f => insert.run(...f)))();
}

const healthyFoodCatalog = [
  ["Jeruk","1 buah sedang",62,1.2,15.4,0.2],
  ["Pepaya","150 g",65,0.7,16,0.3],
  ["Jambu biji","100 g",68,2.6,14,1],
  ["Nanas segar","100 g",50,0.5,13,0.1],
  ["Semangka","150 g",45,0.9,11,0.2],
  ["Melon","150 g",51,1.3,12,0.3],
  ["Stroberi","100 g",32,0.7,7.7,0.3],
  ["Blueberry","100 g",57,0.7,14,0.3],
  ["Anggur","100 g",69,0.7,18,0.2],
  ["Mangga","100 g",60,0.8,15,0.4],
  ["Kiwi","1 buah",42,0.8,10,0.4],
  ["Pir","1 buah sedang",101,0.6,27,0.2],
  ["Jambu air","100 g",46,0.6,11,0.2],
  ["Salak","100 g",82,0.4,22,0.4],
  ["Buah naga","100 g",57,1.1,13,0.1],
  ["Sawo","100 g",83,0.4,20,1.1],
  ["Delima","100 g",83,1.7,19,1.2],
  ["Leci","100 g",66,0.8,17,0.4],
  ["Kurma","2 buah",45,0.4,12,0],
  ["Markisa","2 buah",34,0.8,8,0.4],
  ["Brokoli kukus","100 g",35,2.4,7.2,0.4],
  ["Wortel rebus","100 g",35,0.8,8.2,0.2],
  ["Bayam rebus","100 g",23,3,3.8,0.3],
  ["Kangkung rebus","100 g",28,3,5,0.3],
  ["Sawi hijau","100 g",22,2.2,3.9,0.3],
  ["Pakcoy kukus","100 g",13,1.5,2.2,0.2],
  ["Kembang kol kukus","100 g",23,1.8,4.1,0.5],
  ["Kol rebus","100 g",23,1.3,5.5,0.1],
  ["Kol ungu","100 g",31,1.4,7.4,0.2],
  ["Buncis rebus","100 g",35,1.9,7.9,0.3],
  ["Kacang panjang rebus","100 g",47,2.8,8.4,0.4],
  ["Tomat ceri","100 g",18,0.9,3.9,0.2],
  ["Mentimun","100 g",15,0.7,3.6,0.1],
  ["Selada romaine","100 g",17,1.2,3.3,0.3],
  ["Paprika merah","100 g",31,1,6,0.3],
  ["Paprika kuning","100 g",27,1,6.3,0.2],
  ["Terong panggang","100 g",35,0.8,8.7,0.2],
  ["Labu kuning kukus","100 g",34,1.1,8.1,0.1],
  ["Jamur tiram","100 g",33,3.3,6.1,0.4],
  ["Jamur kancing","100 g",22,3.1,3.3,0.3],
  ["Salmon panggang","100 g",206,22,0,12],
  ["Sarden segar panggang","100 g",208,25,0,11],
  ["Ikan kembung panggang","100 g",167,20,0,9],
  ["Ikan nila kukus","100 g",128,26,0,2.7],
  ["Ikan kakap kukus","100 g",128,26,0,2.7],
  ["Ikan gurame kukus","100 g",120,19,0,4],
  ["Udang rebus","100 g",99,24,0.2,0.3],
  ["Cumi rebus","100 g",92,16,3.1,1.4],
  ["Dada ayam rebus","100 g",165,31,0,3.6],
  ["Dada kalkun panggang","100 g",135,29,0,1.6],
  ["Putih telur rebus","2 butir",34,7.2,0.5,0.1],
  ["Edamame kukus","100 g",121,12,9,5.2],
  ["Kacang merah rebus","100 g",127,8.7,22.8,0.5],
  ["Kacang hijau rebus","100 g",105,7,19,0.4],
  ["Kacang arab rebus","100 g",164,8.9,27.4,2.6],
  ["Lentil rebus","100 g",116,9,20,0.4],
  ["Kacang hitam rebus","100 g",132,8.9,23.7,0.5],
  ["Yogurt Yunani tawar","150 g",130,15,7,4],
  ["Keju cottage rendah lemak","100 g",98,11,3.4,4.3],
  ["Susu kedelai tanpa gula","200 ml",66,6.6,3.2,3.6],
  ["Nasi merah matang","100 g",123,2.7,25.6,1],
  ["Nasi cokelat matang","100 g",123,2.7,25.6,1],
  ["Nasi hitam matang","100 g",145,4.5,30,1.5],
  ["Quinoa matang","100 g",120,4.4,21.3,1.9],
  ["Barley matang","100 g",123,2.3,28.2,0.4],
  ["Oat matang","100 g",71,2.5,12,1.5],
  ["Pasta gandum utuh matang","100 g",149,6,30,1.7],
  ["Ubi jalar kukus","100 g",86,1.6,20.1,0.1],
  ["Jagung rebus","1 tongkol sedang",96,3.4,21,1.5],
  ["Singkong rebus","100 g",112,1.4,27.8,0.3],
  ["Talas kukus","100 g",142,0.5,34.6,0.1],
  ["Soba matang","100 g",99,5.1,21.4,0.1],
  ["Millet matang","100 g",119,3.5,23.7,1],
  ["Bulgur matang","100 g",83,3.1,18.6,0.2],
  ["Roti pita gandum utuh","1 lembar",170,6,35,1.5],
  ["Tortilla gandum utuh","1 lembar",130,4,22,3],
  ["Roti multigrain","1 lembar",90,4,15,1.5],
  ["Pisang kepok rebus","1 buah",109,1.3,28,0.4],
  ["Pasta kacang arab matang","100 g",150,8,30,2],
  ["Ubi jalar tumbuk","100 g",90,2,21,0.2],
  ["Kacang almond","20 g",116,4.2,4.3,10],
  ["Kacang kenari","20 g",131,3,2.7,13],
  ["Kacang pistachio","20 g",112,4,5.5,9],
  ["Kacang mete panggang tawar","20 g",111,3.6,6,8.8],
  ["Kacang tanah panggang tawar","20 g",113,5.2,3.2,9.8],
  ["Biji labu","15 g",84,4.5,1.6,7],
  ["Biji bunga matahari","15 g",88,3.1,3,7.7],
  ["Biji chia","15 g",73,2.5,6.3,4.6],
  ["Biji rami","15 g",80,2.7,4.3,6.3],
  ["Biji wijen","15 g",86,2.7,3.5,7.4],
  ["Selai kacang tanpa gula","1 sdm",94,4,3.2,8],
  ["Hummus","2 sdm",70,2,6,4],
  ["Minyak zaitun","1 sdt",40,0,0,4.5],
  ["Minyak alpukat","1 sdt",40,0,0,4.5],
  ["Kefir tawar","200 ml",100,7,9,3],
  ["Susu rendah lemak","200 ml",100,7,10,3],
  ["Air kelapa segar","200 ml",38,0.7,9,0.2],
  ["Yogurt kedelai tanpa gula","125 g",80,5,4,4],
  ["Rumput laut nori","1 lembar",10,1,1,0.1],
  ["Rumput laut wakame","10 g kering",45,3,9,0.6]
];

const applyHealthyFoodSeed = db.transaction(() => {
  if (db.prepare("SELECT 1 FROM data_seeds WHERE name=?").get("healthy-foods-v1")) return;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO foods(name, serving, calories, protein, carbs, fat)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  healthyFoodCatalog.forEach(food => insert.run(...food));
  db.prepare("INSERT INTO data_seeds(name) VALUES(?)").run("healthy-foods-v1");
});
applyHealthyFoodSeed();

function cleanEmail(email) {
  return String(email || "").trim().toLowerCase();
}
function publicUser(u) {
  return {
    id: u.id, name: u.name, email: u.email,
    birth_day: u.birth_day, birth_month: u.birth_month,
    birth_year: u.birth_year, role: u.role,
    status: u.status, created_at: u.created_at
  };
}
function tokenFor(u) {
  return jwt.sign({ id: u.id, role: u.role, ver: u.token_version }, JWT_SECRET, { expiresIn: "7d" });
}
function auth(req, res, next) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return res.status(401).json({error:"Login diperlukan."});
  try {
    const payload = jwt.verify(h.slice(7), JWT_SECRET);
    const u = db.prepare("SELECT * FROM users WHERE id=?").get(payload.id);
    if (!u) return res.status(401).json({error:"Akun tidak ditemukan."});
    if ((payload.ver ?? 0) !== u.token_version)
      return res.status(401).json({error:"Password akun telah berubah. Silakan login kembali."});
    if (u.status !== "active") return res.status(403).json({error:"Akun dinonaktifkan."});
    req.user = u;
    next();
  } catch {
    return res.status(401).json({error:"Sesi tidak valid atau sudah berakhir."});
  }
}
function admin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({error:"Akses admin diperlukan."});
  next();
}
function validBirth(d,m,y) {
  const day = Number(d), month = Number(m), year = Number(y);
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return false;
  if (year < 1900 || year > new Date().getFullYear()) return false;
  const dt = new Date(year, month - 1, day);
  return dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day;
}
function validFood(body) {
  const fields = ["name","serving","calories","protein","carbs","fat"];
  if (!fields.every(k => body[k] !== undefined && body[k] !== "")) return false;
  return [body.calories,body.protein,body.carbs,body.fat].every(v => Number.isFinite(Number(v)) && Number(v) >= 0);
}

app.post("/api/visits", (req,res,next) => {
  try {
    const visitorId=String(req.body.visitorId||"");
    const sessionId=String(req.body.sessionId||"");
    const pagePath=String(req.body.pagePath||"/").replace(/[^a-zA-Z0-9/_-]/g,"").slice(0,120)||"/";
    if(!/^[0-9a-f-]{36}$/i.test(visitorId)||!/^[0-9a-f-]{36}$/i.test(sessionId))
      return res.status(400).json({error:"Identitas kunjungan tidak valid."});
    const recordVisit=db.transaction(()=>{
      db.prepare(`
        INSERT INTO site_visitors(visitor_id) VALUES(?)
        ON CONFLICT(visitor_id) DO UPDATE SET last_seen=CURRENT_TIMESTAMP
      `).run(visitorId);
      db.prepare("INSERT OR IGNORE INTO site_visits(session_id,visitor_id,page_path) VALUES(?,?,?)")
        .run(sessionId,visitorId,pagePath);
    });
    recordVisit();
    res.status(204).end();
  } catch(e){ next(e); }
});

/* Auth */
app.post("/api/auth/register", authLimiter, async (req,res,next) => {
  try {
    const {name,email,password,birthDay,birthMonth,birthYear} = req.body;
    const normalizedName = String(name || "").trim();
    if (normalizedName.length < 2 || normalizedName.length > 80 || !email || !password || !validBirth(birthDay,birthMonth,birthYear))
      return res.status(400).json({error:"Isi nama lengkap, email, password, dan tanggal lahir yang valid."});
    if (String(password).length < 8) return res.status(400).json({error:"Password minimal 8 karakter."});
    const e = cleanEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return res.status(400).json({error:"Email tidak valid."});
    if (db.prepare("SELECT id FROM users WHERE email=?").get(e))
      return res.status(409).json({error:"Email sudah terdaftar."});
    const hash = await bcrypt.hash(password, 12);
    const r = db.prepare(`
      INSERT INTO users(name,email,password_hash,birth_day,birth_month,birth_year)
      VALUES(?,?,?,?,?,?)
    `).run(normalizedName,e,hash,Number(birthDay),Number(birthMonth),Number(birthYear));
    const u = db.prepare("SELECT * FROM users WHERE id=?").get(r.lastInsertRowid);
    res.status(201).json({token:tokenFor(u),user:publicUser(u)});
  } catch(e){ next(e); }
});

app.post("/api/auth/login", authLimiter, async (req,res,next) => {
  try {
    const u = db.prepare("SELECT * FROM users WHERE email=?").get(cleanEmail(req.body.email));
    if (!u || !(await bcrypt.compare(String(req.body.password || ""), u.password_hash)))
      return res.status(401).json({error:"Email atau password salah."});
    if (u.status !== "active") return res.status(403).json({error:"Akun dinonaktifkan. Hubungi admin."});
    res.json({token:tokenFor(u),user:publicUser(u)});
  } catch(e){ next(e); }
});

app.post("/api/auth/forgot-password", authLimiter, (req,res,next) => {
  try {
    const email = cleanEmail(req.body.email);
    const user = db.prepare("SELECT id FROM users WHERE email=?").get(email);
    db.prepare("INSERT INTO password_reports(user_id,email,message) VALUES(?,?,?)")
      .run(user?.id || null,email,String(req.body.message || "User meminta bantuan reset password.").slice(0,500));
    res.json({message:"Laporan sudah dikirim. Admin akan memproses permintaan Anda."});
  } catch(e){ next(e); }
});

app.get("/api/auth/me", auth, (req,res) => res.json(publicUser(req.user)));

app.patch("/api/profile", auth, (req,res,next) => {
  try {
    const name = String(req.body.name || "").trim();
    if (name.length < 2 || name.length > 80) return res.status(400).json({error:"Nama harus 2-80 karakter."});
    db.prepare("UPDATE users SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(name,req.user.id);
    res.json({user:publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id))});
  } catch(e){ next(e); }
});

app.post("/api/profile/password", auth, async (req,res,next) => {
  try {
    const currentPassword=String(req.body.currentPassword||"");
    const password=String(req.body.password||"");
    if(password.length<8)return res.status(400).json({error:"Password baru minimal 8 karakter."});
    if(!(await bcrypt.compare(currentPassword,req.user.password_hash)))
      return res.status(401).json({error:"Password saat ini salah."});
    const hash=await bcrypt.hash(password,12);
    db.prepare("UPDATE users SET password_hash=?,token_version=token_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(hash,req.user.id);
    res.json({message:"Password berhasil diganti. Silakan login kembali."});
  } catch(e){ next(e); }
});

/* Foods */
app.get("/api/foods", auth, (req,res) => {
  const q = String(req.query.search || "").trim();
  const rows = q
    ? db.prepare("SELECT * FROM foods WHERE name LIKE ? ORDER BY name").all(`%${q}%`)
    : db.prepare("SELECT * FROM foods ORDER BY name").all();
  res.json(rows);
});

/* Diary */
app.get("/api/diary", auth, (req,res) => {
  const rows = db.prepare(`
    SELECT d.id,d.amount,d.created_at,f.id AS food_id,f.name,f.serving,
           f.calories,f.protein,f.carbs,f.fat
    FROM diary d JOIN foods f ON f.id=d.food_id
    WHERE d.user_id=? ORDER BY d.created_at DESC
  `).all(req.user.id);
  res.json(rows);
});
app.post("/api/diary", auth, (req,res,next) => {
  try {
    const foodId = Number(req.body.foodId), amount = Number(req.body.amount);
    if (!Number.isInteger(foodId) || !Number.isFinite(amount) || amount <= 0 || amount > 100)
      return res.status(400).json({error:"Food atau jumlah porsi tidak valid."});
    if (!db.prepare("SELECT id FROM foods WHERE id=?").get(foodId))
      return res.status(404).json({error:"Makanan tidak ditemukan."});
    const r = db.prepare("INSERT INTO diary(user_id,food_id,amount) VALUES(?,?,?)").run(req.user.id,foodId,amount);
    res.status(201).json({id:r.lastInsertRowid});
  } catch(e){ next(e); }
});
app.delete("/api/diary/:id", auth, (req,res,next) => {
  try {
    const r = db.prepare("DELETE FROM diary WHERE id=? AND user_id=?").run(Number(req.params.id),req.user.id);
    if (!r.changes) return res.status(404).json({error:"Data diary tidak ditemukan."});
    res.json({message:"Diary dihapus."});
  } catch(e){ next(e); }
});

/* Admin stats */
app.get("/api/admin/stats", auth, admin, (req,res) => {
  res.json({
    users: db.prepare("SELECT COUNT(*) n FROM users WHERE role='user'").get().n,
    activeUsers: db.prepare("SELECT COUNT(*) n FROM users WHERE role='user' AND status='active'").get().n,
    foods: db.prepare("SELECT COUNT(*) n FROM foods").get().n,
    pendingReports: db.prepare("SELECT COUNT(*) n FROM password_reports WHERE status='pending'").get().n,
    visitors: db.prepare("SELECT COUNT(*) n FROM site_visitors").get().n,
    visitsToday: db.prepare("SELECT COUNT(DISTINCT visitor_id) n FROM site_visits WHERE date(visited_at)=date('now','localtime')").get().n
  });
});

/* Admin users */
app.get("/api/admin/admins", auth, admin, (req,res) => {
  const rows=db.prepare(`
    SELECT id,name,email,status,created_at
    FROM users
    WHERE role='admin'
    ORDER BY name COLLATE NOCASE
  `).all();
  res.json(rows);
});

app.get("/api/admin/users", auth, admin, (req,res) => {
  const q = String(req.query.search || "").trim();
  const rows = q
    ? db.prepare(`
      SELECT u.id,u.name,u.email,u.birth_day,u.birth_month,u.birth_year,u.role,u.status,u.created_at,
             COUNT(d.id) diary_count
      FROM users u LEFT JOIN diary d ON d.user_id=u.id
      WHERE u.name LIKE ? OR u.email LIKE ?
      GROUP BY u.id ORDER BY u.created_at DESC
    `).all(`%${q}%`,`%${q}%`)
    : db.prepare(`
      SELECT u.id,u.name,u.email,u.birth_day,u.birth_month,u.birth_year,u.role,u.status,u.created_at,
             COUNT(d.id) diary_count
      FROM users u LEFT JOIN diary d ON d.user_id=u.id
      GROUP BY u.id ORDER BY u.created_at DESC
    `).all();
  res.json(rows);
});

app.get("/api/admin/users/:id", auth, admin, (req,res) => {
  const id = Number(req.params.id);
  const u = db.prepare(`
    SELECT id,name,email,birth_day,birth_month,birth_year,role,status,created_at
    FROM users WHERE id=?
  `).get(id);
  if (!u) return res.status(404).json({error:"User tidak ditemukan."});
  const diary = db.prepare(`
    SELECT d.id,d.amount,d.created_at,f.name,f.calories,f.protein,f.carbs,f.fat
    FROM diary d JOIN foods f ON f.id=d.food_id WHERE d.user_id=? ORDER BY d.created_at DESC
  `).all(id);
  res.json({user:u,diary});
});

app.patch("/api/admin/users/:id/status", auth, admin, (req,res,next) => {
  try {
    const id=Number(req.params.id), status=req.body.status;
    const u=db.prepare("SELECT id,role FROM users WHERE id=?").get(id);
    if(!u) return res.status(404).json({error:"User tidak ditemukan."});
    if(u.role==="admin") return res.status(403).json({error:"Admin tidak dapat dinonaktifkan."});
    if(!["active","disabled"].includes(status)) return res.status(400).json({error:"Status tidak valid."});
    db.prepare("UPDATE users SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status,id);
    res.json({message:"Status user diperbarui."});
  } catch(e){next(e);}
});

app.post("/api/admin/users/:id/reset-password", auth, admin, async (req,res,next) => {
  try {
    const id=Number(req.params.id), password=String(req.body.newPassword || "");
    if(password.length < 8) return res.status(400).json({error:"Password baru minimal 8 karakter."});
    const u=db.prepare("SELECT id,role FROM users WHERE id=?").get(id);
    if(!u) return res.status(404).json({error:"User tidak ditemukan."});
    if(u.role==="admin") return res.status(403).json({error:"Gunakan prosedur khusus untuk akun admin."});
    const hash=await bcrypt.hash(password,12);
    db.prepare("UPDATE users SET password_hash=?,token_version=token_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(hash,id);
    db.prepare("UPDATE password_reports SET status='resolved',resolved_at=CURRENT_TIMESTAMP WHERE user_id=? AND status='pending'").run(id);
    res.json({message:"Password berhasil direset."});
  } catch(e){next(e);}
});

app.delete("/api/admin/users/:id", auth, admin, (req,res,next) => {
  try {
    const id=Number(req.params.id), u=db.prepare("SELECT id,role FROM users WHERE id=?").get(id);
    if(!u) return res.status(404).json({error:"User tidak ditemukan."});
    if(u.role==="admin") return res.status(403).json({error:"Admin tidak dapat dihapus."});
    db.prepare("DELETE FROM users WHERE id=?").run(id);
    res.json({message:"User dihapus."});
  } catch(e){next(e);}
});

/* Admin food CRUD */
app.post("/api/admin/foods", auth, admin, (req,res,next) => {
  try {
    if(!validFood(req.body)) return res.status(400).json({error:"Data makanan tidak valid."});
    const r=db.prepare(`
      INSERT INTO foods(name,serving,calories,protein,carbs,fat) VALUES(?,?,?,?,?,?)
    `).run(String(req.body.name).trim(),String(req.body.serving).trim(),Number(req.body.calories),Number(req.body.protein),Number(req.body.carbs),Number(req.body.fat));
    res.status(201).json({id:r.lastInsertRowid});
  } catch(e) {
    if(String(e.message).includes("UNIQUE")) return res.status(409).json({error:"Nama makanan sudah ada."});
    next(e);
  }
});
app.put("/api/admin/foods/:id", auth, admin, (req,res,next) => {
  try {
    if(!validFood(req.body)) return res.status(400).json({error:"Data makanan tidak valid."});
    const r=db.prepare(`
      UPDATE foods SET name=?,serving=?,calories=?,protein=?,carbs=?,fat=?,updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).run(String(req.body.name).trim(),String(req.body.serving).trim(),Number(req.body.calories),Number(req.body.protein),Number(req.body.carbs),Number(req.body.fat),Number(req.params.id));
    if(!r.changes) return res.status(404).json({error:"Makanan tidak ditemukan."});
    res.json({message:"Makanan diperbarui."});
  } catch(e) {
    if(String(e.message).includes("UNIQUE")) return res.status(409).json({error:"Nama makanan sudah ada."});
    next(e);
  }
});
app.delete("/api/admin/foods/:id", auth, admin, (req,res,next) => {
  try {
    const r=db.prepare("DELETE FROM foods WHERE id=?").run(Number(req.params.id));
    if(!r.changes) return res.status(404).json({error:"Makanan tidak ditemukan."});
    res.json({message:"Makanan dihapus."});
  } catch(e) {
    if(String(e.message).includes("FOREIGN KEY")) return res.status(409).json({error:"Makanan sudah dipakai di diary dan tidak bisa dihapus."});
    next(e);
  }
});

/* Admin reset reports */
app.get("/api/admin/password-reports", auth, admin, (req,res) => {
  res.json(db.prepare(`
    SELECT r.id,r.email,r.message,r.status,r.created_at,r.resolved_at,u.name
    FROM password_reports r LEFT JOIN users u ON u.id=r.user_id
    ORDER BY r.status='pending' DESC,r.created_at DESC
  `).all());
});

app.post("/api/admin/password-reports/:id/resolve", auth, admin, (req,res,next) => {
  try {
    const result=db.prepare(`
      UPDATE password_reports
      SET status='resolved',resolved_at=CURRENT_TIMESTAMP
      WHERE id=? AND status='pending'
    `).run(Number(req.params.id));
    if(!result.changes)return res.status(404).json({error:"Laporan tidak ditemukan atau sudah diselesaikan."});
    res.json({message:"Laporan ditandai selesai."});
  } catch(e){ next(e); }
});

/* Production static */
app.use(express.static(path.join(__dirname,"public")));

app.use((req,res,next) => {
  if (req.method === "GET" && !req.path.startsWith("/api/"))
    return res.sendFile(path.join(__dirname,"public","index.html"));
  next();
});

app.use((err,req,res,next) => {
  console.error(err);
  res.status(500).json({error:"Terjadi kesalahan pada server."});
});

app.listen(PORT, () => {
  console.log(`Mal-Food Nutrition berjalan di http://localhost:${PORT}`);
});
