// ═══════════════════════════════════════════════
//  OWLY v2.1 — SQLite + Auth + Groq Free API
//  🔒 Security Fixes Applied:
//   1. Secrets moved to .env file
//   2. Session delete endpoint protected with auth
//   3. PDF files deleted after extraction
//   4. Quiz counter double-count fixed
//   5. Rate limiting on login/register
//   6. Input validation & trimming
// ═══════════════════════════════════════════════
console.log("ENV CHECK:", process.env.GROQ_API_KEY);

require('dotenv').config();

const express    = require('express');
const multer     = require('multer');
const cors       = require('cors');
const fs         = require('fs');
const path       = require('path');
const pdfParse   = require('pdf-parse');
const bcrypt     = require('bcrypt');
const jwt        = require('jsonwebtoken');
const Database   = require('better-sqlite3');
const nodemailer = require('nodemailer');

const app  = express();
const PORT = process.env.PORT || 3000;

// ══ FIX #1: Secrets loaded from .env ══

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const JWT_SECRET   = process.env.JWT_SECRET;

if (!GROQ_API_KEY) {
  console.error('❌ GROQ_API_KEY missing in environment variables!');
  process.exit(1);
}

if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET missing in environment variables!');
  process.exit(1);
}

// ══ Email Transporter ══
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});

// In-memory store for verification tokens { token: { email, name, password, expires } }
const pendingVerifications = new Map();

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL    = 'llama-3.1-8b-instant';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'Public')));

// ═══════════════════════════════════════════════
// 🗄️ SQLite Database Setup
// ═══════════════════════════════════════════════
const db = new Database(path.join(__dirname, 'owly.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL,
    email     TEXT    UNIQUE NOT NULL,
    password  TEXT    NOT NULL,
    created_at TEXT   DEFAULT (datetime('now')),
    verified   INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS chats (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    title      TEXT    NOT NULL DEFAULT 'Chat',
    created_at TEXT    DEFAULT (datetime('now')),
    updated_at TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id    INTEGER NOT NULL,
    role       TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    created_at TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (chat_id) REFERENCES chats(id)
  );

  CREATE TABLE IF NOT EXISTS stats (
    user_id    INTEGER PRIMARY KEY,
    pdfs       INTEGER DEFAULT 0,
    quizzes    INTEGER DEFAULT 0,
    best_score TEXT    DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);
console.log('✅ Database ready: owly.db');

// ═══════════════════════════════════════════════
// 🔒 FIX #5: Rate Limiter (simple in-memory)
// ═══════════════════════════════════════════════
const rateLimitMap = new Map();

function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    const record = rateLimitMap.get(key) || { count: 0, start: now };

    if (now - record.start > windowMs) {
      // reset window
      record.count = 1;
      record.start = now;
    } else {
      record.count++;
    }

    rateLimitMap.set(key, record);

    if (record.count > maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
    }
    next();
  };
}

// Clean up rate limit map every 10 minutes to avoid memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitMap.entries()) {
    if (now - record.start > 15 * 60 * 1000) rateLimitMap.delete(key);
  }
}, 10 * 60 * 1000);

// ═══════════════════════════════════════════════
// 🔐 JWT Auth Middleware
// ═══════════════════════════════════════════════
function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch(e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ═══════════════════════════════════════════════
// ✅ Validate Groq API Key on startup
// ═══════════════════════════════════════════════
async function validateApiKey() {
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_API_KEY },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 })
    });
    if (res.status === 401) { console.error('❌ Invalid Groq API Key!'); process.exit(1); }
    console.log('✅ Groq API Key valid');
  } catch(e) {
    console.log('⚠️  Could not validate key, continuing...');
  }
}

app.get('/api/validate-key', async (req, res) => {
  try {
    const r = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_API_KEY },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 })
    });
    return res.json({ valid: r.status !== 401 });
  } catch(e) { return res.json({ valid: false }); }
});

// ═══════════════════════════════════════════════
// 👤 Auth Endpoints
// ═══════════════════════════════════════════════

// FIX #5 applied: rate limit 10 attempts per 15 minutes on login/register
// FIX #6 applied: trim & sanitize input

// Register — Step 1: send verification email
app.post('/api/auth/register', rateLimit(10, 15 * 60 * 1000), async (req, res) => {
  const name     = (req.body.name     || '').trim();
  const email    = (req.body.email    || '').trim().toLowerCase();
  const password =  req.body.password || '';

  if (!name || !email || !password)
    return res.status(400).json({ error: 'All fields required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9\-]+(\.[a-zA-Z0-9\-]+)+$/.test(email) || !/\.[a-zA-Z]{2,}$/.test(email))
    return res.status(400).json({ error: 'Invalid email format' });
  const blockedDomains = ['test.com','example.com','fake.com','mailinator.com','guerrillamail.com','tempmail.com','throwaway.com','yopmail.com','sharklasers.com','trashmail.com'];
  if (blockedDomains.includes(email.split('@')[1]))
    return res.status(400).json({ error: 'Please use a real email address' });

  try {
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (exists) return res.status(400).json({ error: 'Email already registered' });

    // Create verification token (expires in 1 hour)
    const verifyToken = require('crypto').randomBytes(32).toString('hex');
    const hashed = await bcrypt.hash(password, 10);
    pendingVerifications.set(verifyToken, {
      name, email, password: hashed,
      expires: Date.now() + 60 * 60 * 1000
    });

    // Send verification email
  const BASE_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const verifyUrl = `${BASE_URL}/api/auth/verify?token=${verifyToken}`;
    await transporter.sendMail({
      from: `"Owly 🦉" <${process.env.MAIL_USER}>`,
      to: email,
      subject: '✅ Confirm your Owly account',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9f9f9;border-radius:12px;">
          <h2 style="color:#6c47ff;">🦉 Welcome to Owly, ${name}!</h2>
          <p>Click the button below to verify your email and activate your account.</p>
          <a href="${verifyUrl}" style="display:inline-block;margin:16px 0;padding:12px 28px;background:#6c47ff;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">
            ✅ Verify My Email
          </a>
          <p style="color:#999;font-size:12px;">This link expires in 1 hour. If you didn't create an account, ignore this email.</p>
        </div>
      `
    });

    res.json({ message: 'Verification email sent! Please check your inbox.' });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Could not send verification email. Check MAIL_USER and MAIL_PASS in .env' });
  }
});

// Register — Step 2: verify token from email link
app.get('/api/auth/verify', async (req, res) => {
  const { token } = req.query;
  const data = pendingVerifications.get(token);

  if (!data) return res.send(`
    <div style="font-family:Arial;text-align:center;padding:60px;">
      <h2>❌ Link invalid or expired</h2>
      <p>Please register again.</p>
      <a href="/">Go back</a>
    </div>`);

  if (Date.now() > data.expires) {
    pendingVerifications.delete(token);
    return res.send(`
      <div style="font-family:Arial;text-align:center;padding:60px;">
        <h2>⏰ Link expired</h2>
        <p>Please register again.</p>
        <a href="/">Go back</a>
      </div>`);
  }

  try {
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(data.email);
    if (exists) return res.send(`
      <div style="font-family:Arial;text-align:center;padding:60px;">
        <h2>⚠️ Email already registered</h2>
        <a href="/">Sign in</a>
      </div>`);

    const result = db.prepare('INSERT INTO users (name, email, password, verified) VALUES (?, ?, ?, 1)')
      .run(data.name, data.email, data.password);
    db.prepare('INSERT INTO stats (user_id) VALUES (?)').run(result.lastInsertRowid);
    pendingVerifications.delete(token);

    res.send(`
      <div style="font-family:Arial;text-align:center;padding:60px;background:#f0fff4;min-height:100vh;">
        <h2 style="color:#22c55e;">🎉 Email Verified!</h2>
        <p>Your account has been activated. You can now sign in.</p>
        <a href="/" style="display:inline-block;margin-top:16px;padding:12px 28px;background:#6c47ff;color:#fff;border-radius:8px;text-decoration:none;">
          Go to Owly 🦉
        </a>
      </div>`);
  } catch(e) {
    console.error(e);
    res.status(500).send('Server error');
  }
});

// Login
app.post('/api/auth/login', rateLimit(10, 15 * 60 * 1000), async (req, res) => {
  // FIX #6: trim inputs
  const email    = (req.body.email    || '').trim().toLowerCase();
  const password =  req.body.password || '';

  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return res.status(401).json({ error: 'Email not found' });

    if (!user.verified) return res.status(401).json({ error: 'Please verify your email first. Check your inbox.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Wrong password' });

    const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user  = db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(req.user.id);
  const stats = db.prepare('SELECT * FROM stats WHERE user_id = ?').get(req.user.id);
  res.json({ user, stats });
});

// ═══════════════════════════════════════════════
// 📊 Stats Endpoints
// ═══════════════════════════════════════════════
app.get('/api/stats', authMiddleware, (req, res) => {
  const stats = db.prepare('SELECT * FROM stats WHERE user_id = ?').get(req.user.id);
  res.json(stats || { pdfs: 0, quizzes: 0, best_score: null });
});

app.post('/api/stats/update', authMiddleware, (req, res) => {
  const { type, score } = req.body;
  const stats = db.prepare('SELECT * FROM stats WHERE user_id = ?').get(req.user.id);
  if (!stats) {
    db.prepare('INSERT INTO stats (user_id) VALUES (?)').run(req.user.id);
  }
  if (type === 'pdf') {
    db.prepare('UPDATE stats SET pdfs = pdfs + 1 WHERE user_id = ?').run(req.user.id);
  } else if (type === 'quiz') {
    const current = db.prepare('SELECT * FROM stats WHERE user_id = ?').get(req.user.id);
    let newBest = current.best_score;
    if (score) {
      if (!newBest) { newBest = score; }
      else {
        const [cs, ct] = newBest.split('/').map(Number);
        const [ns, nt] = score.split('/').map(Number);
        if (ns/nt > cs/ct) newBest = score;
      }
    }
    db.prepare('UPDATE stats SET quizzes = quizzes + 1, best_score = ? WHERE user_id = ?').run(newBest, req.user.id);
  }
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════
// 💬 Chat History Endpoints
// ═══════════════════════════════════════════════

app.get('/api/chats', authMiddleware, (req, res) => {
  const chats = db.prepare(`
    SELECT c.id, c.title, c.updated_at,
           COUNT(m.id) as message_count
    FROM chats c
    LEFT JOIN messages m ON m.chat_id = c.id
    WHERE c.user_id = ?
    GROUP BY c.id
    ORDER BY c.updated_at DESC
  `).all(req.user.id);
  res.json(chats);
});

app.get('/api/chats/:id', authMiddleware, (req, res) => {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  const messages = db.prepare('SELECT role, content, created_at FROM messages WHERE chat_id = ? ORDER BY id ASC').all(req.params.id);
  res.json({ chat, messages });
});

app.post('/api/chats/save', authMiddleware, (req, res) => {
  const { chatId, title, messages } = req.body;
  if (!messages || messages.length === 0) return res.json({ ok: true });

  try {
    let id = chatId;
    if (id) {
      db.prepare('UPDATE chats SET title = ?, updated_at = datetime("now") WHERE id = ? AND user_id = ?').run(title || 'Chat', id, req.user.id);
      db.prepare('DELETE FROM messages WHERE chat_id = ?').run(id);
    } else {
      const result = db.prepare('INSERT INTO chats (user_id, title) VALUES (?, ?)').run(req.user.id, title || 'Chat');
      id = result.lastInsertRowid;
    }
    const insertMsg = db.prepare('INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)');
    const insertMany = db.transaction((msgs) => { for (const m of msgs) insertMsg.run(id, m.role, m.text || m.content); });
    insertMany(messages);
    res.json({ ok: true, chatId: id });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Save failed' });
  }
});

app.delete('/api/chats/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(req.params.id);
  db.prepare('DELETE FROM chats WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════
// 🤖 Groq API
// ═══════════════════════════════════════════════
async function askGroq(systemPrompt, userMessage) {
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_API_KEY },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage  }
        ],
        temperature: 0.3,
        max_tokens: 600
      })
    });
    if (!res.ok) { console.log('Groq error:', res.status); return null; }
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.log('Groq error:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════
// 🌐 Language Detection
// ═══════════════════════════════════════════════
function isArabic(text) {
  const arabicChars = text.match(/[\u0600-\u06FF]/g);
  return arabicChars && arabicChars.length > text.length * 0.25;
}
function detectLang(text) { return isArabic(text) ? 'ar' : 'en'; }

const ARABIC_STOP = new Set([
  'ما','ماذا','كيف','لماذا','متى','اين','من','هل','اشرح','وضح','عرف',
  'قارن','اذكر','حدد','في','الى','على','عن','مع','هذا','هذه','ذلك',
  'هو','هي','هم','نحن','انت','و','او','لكن','ان','يكون','كان','كانت'
]);
function extractKeywords(q) {
  const tokens = q.replace(/[؟?!،,.\-:]/g,' ').split(/\s+/).map(w=>w.trim()).filter(w=>w.length>1);
  const kw = tokens.filter(w=>!ARABIC_STOP.has(w));
  return kw.length > 0 ? kw : tokens;
}

// ═══════════════════════════════════════════════
// 📂 Upload + Multer + Sessions
// ═══════════════════════════════════════════════
const upload   = multer({ dest: 'uploads/', limits: { fileSize: 15 * 1024 * 1024 } });
const sessions = {};

function cleanText(text) {
  return text
    .replace(/\u0000/g,'')
    .replace(/([a-z])([A-Z])/g,'$1 $2')
    .replace(/([A-Za-z])([0-9])/g,'$1 $2')
    .replace(/([0-9])([A-Za-z])/g,'$1 $2')
    .replace(/([.?!,])([A-Za-z])/g,'$1 $2')
    .replace(/[ \t]+/g,' ')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
}

async function extractText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data   = await pdfParse(buffer);
  const text   = cleanText(data.text);
  const lang   = detectLang(text);
  const chunks = [];
  const size = 600, overlap = 100;
  for (let i = 0; i < text.length; i += size - overlap) {
    const chunk = text.slice(i, i + size).trim();
    if (chunk.length > 60) chunks.push(chunk);
  }
  console.log('PDF extracted: ' + chunks.length + ' chunks, lang: ' + lang);

  // FIX #3: Delete the uploaded PDF file after extraction to free disk space
  try { fs.unlinkSync(filePath); } catch(e) { console.warn('Could not delete temp PDF:', e.message); }

  return { text, chunks, lang };
}

function getRelevantChunks(question, chunks, topN) {
  topN = topN || 4;
  const keywords = isArabic(question)
    ? extractKeywords(question)
    : question.toLowerCase().split(/[\s,?!.\-]+/).filter(w=>w.length>2);
  if (!keywords.length) return chunks.slice(0, topN);
  const scored = chunks.map(chunk => {
    const lower = chunk.toLowerCase();
    let score = 0;
    for (const w of keywords) {
      const wl = w.toLowerCase();
      if (lower.includes(wl)) score += 1;
      else if (wl.length>=4 && lower.includes(wl.slice(0,Math.ceil(wl.length*0.75)))) score += 0.4;
    }
    return { chunk, score: score/keywords.length };
  });
  scored.sort((a,b)=>b.score-a.score);
  const rel = scored.slice(0,topN).filter(c=>c.score>0);
  return rel.length === 0 ? chunks.slice(0,topN) : rel.map(c=>c.chunk);
}

// ═══════════════════════════════════════════════
// 🤖 Smart Answer with Explain Levels
// ═══════════════════════════════════════════════
async function smartAnswer(question, session, level) {
  level = level || 'normal';
  const arabicQ   = isArabic(question);
  const topChunks = getRelevantChunks(question, session.chunks, 4);
  const context   = topChunks.join('\n\n');

  let explainStyle = '';
  if (arabicQ) {
    if (level==='simple')   explainStyle='اشرح بأسلوب بسيط جداً كأنك بتشرح لطفل مع أمثلة من الحياة اليومية.';
    else if (level==='advanced') explainStyle='اشرح بأسلوب أكاديمي متقدم مع تفاصيل وأمثلة علمية دقيقة.';
    else explainStyle='اشرح بأسلوب واضح ومناسب لطالب جامعي.';
  } else {
    if (level==='simple')   explainStyle='Explain in very simple terms for a beginner with everyday examples.';
    else if (level==='advanced') explainStyle='Explain in detailed academic terms with technical depth.';
    else explainStyle='Explain clearly for a university student.';
  }

  const systemPrompt = arabicQ
    ? `أنت مساعد دراسي ذكي اسمك Owly. ${explainStyle}\n- أجب بالعربية فقط\n- إذا كان المحتوى بالإنجليزي ترجمه واشرحه\n- ابدأ مباشرة بدون مقدمات`
    : `You are Owly, a smart study assistant. ${explainStyle}\n- Answer in the same language as the question\n- Start directly`;

  const userMessage = arabicQ
    ? `محتوى المحاضرة:\n"""\n${context}\n"""\n\nسؤال: ${question}\n\nأجب:`
    : `Lecture:\n"""\n${context}\n"""\n\nQuestion: ${question}\n\nAnswer:`;

  const answer = await askGroq(systemPrompt, userMessage);
  if (answer) return { answer };
  return { answer: arabicQ ? 'عذراً، حصل خطأ. حاول مرة أخرى.' : 'Sorry, an error occurred.' };
}

// ═══════════════════════════════════════════════
// 📝 Summary
// ═══════════════════════════════════════════════
function textToHtml(text) {
  return text.split('\n').map(l=>l.trim()).filter(l=>l.length>0).map(l=>{
    if(l.match(/^#+\s/)) return '<h3>'+l.replace(/^#+\s*/,'')+'</h3>';
    if(l.match(/^\*\*(.+)\*\*$/)) return '<h4>'+l.replace(/\*\*/g,'')+'</h4>';
    if(l.startsWith('-')||l.startsWith('*')||l.startsWith('•')) return '<li>'+l.replace(/^[-*•]\s*/,'')+'</li>';
    return '<p>'+l+'</p>';
  }).join('\n').replace(/(<li>[^]*?<\/li>\n?)+/g,m=>'<ul>'+m+'</ul>');
}

app.post('/api/summary', authMiddleware, async (req, res) => {
  const session = sessions[req.body.sessionId];
  if (!session) return res.status(404).json({ error: 'Session not found' });
  try {
    const context = session.chunks.slice(0,6).join('\n\n');
    const isAr = session.lang === 'ar';
    const sys = isAr
      ? 'أنت مساعد دراسي. اعمل ملخصاً شاملاً بالعربية مع نقاط رئيسية.'
      : 'You are a study assistant. Write a comprehensive summary in English with bullet points.';
    const msg = isAr ? `المحتوى:\n"""\n${context}\n"""\n\nاعمل ملخصاً:` : `Content:\n"""\n${context}\n"""\n\nSummarize:`;
    const summaryText = await askGroq(sys, msg);
    if (summaryText) return res.json({ summary: textToHtml(summaryText), lang: session.lang });
    const fallback = session.chunks.slice(0,4).map(c=>'<p>'+c.replace(/\n/g,' ').slice(0,250)+'...</p>').join('');
    res.json({ summary: fallback, lang: session.lang });
  } catch(e) { res.status(500).json({ error: 'Summary failed' }); }
});

app.post('/api/translate-summary', authMiddleware, async (req, res) => {
  const session = sessions[req.body.sessionId];
  if (!session) return res.status(404).json({ error: 'Session not found' });
  try {
    const context = session.chunks.slice(0,6).join('\n\n');
    const sys = 'أنت مساعد دراسي. اعمل ملخصاً شاملاً بالعربية مع نقاط رئيسية وترجم المحتوى.';
    const msg = `المحتوى:\n"""\n${context}\n"""\n\nاعمل ملخصاً بالعربية:`;
    const summaryText = await askGroq(sys, msg);
    if (summaryText) return res.json({ summary: textToHtml(summaryText) });
    res.status(500).json({ error: 'Translation failed' });
  } catch(e) { res.status(500).json({ error: 'Translation failed' }); }
});

// ═══════════════════════════════════════════════
// 💬 Chat
// ═══════════════════════════════════════════════
app.post('/api/chat', authMiddleware, async (req, res) => {
  const { sessionId, question, level } = req.body;
  const session = sessions[sessionId];
  if (!session) return res.status(404).json({ error: 'Session not found' });
  try {
    const { answer } = await smartAnswer(question, session, level || 'normal');
    res.json({ answer });
  } catch(e) { res.json({ answer: 'حصل خطأ، حاول تاني.' }); }
});

// ═══════════════════════════════════════════════
// 📄 Upload
// ═══════════════════════════════════════════════
app.post('/api/upload', authMiddleware, upload.single('pdf'), async (req, res) => {
  try {
    // FIX #3: extractText now deletes the file after reading it
    const { text, chunks, lang } = await extractText(req.file.path);
    const id = Date.now().toString();
    sessions[id] = { text, chunks, lang };   // filePath no longer stored (already deleted)
    db.prepare('UPDATE stats SET pdfs = pdfs + 1 WHERE user_id = ?').run(req.user.id);
    res.json({ sessionId: id, lang });
  } catch(e) {
    // If extraction fails, still try to clean up the temp file
    if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch(_) {} }
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ═══════════════════════════════════════════════
// 🎯 Quiz
// ═══════════════════════════════════════════════
function shuffle(arr) {
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
function generateQuizFromText(text) {
  const sentences=text.replace(/\n+/g,' ').split(/(?<=[.?!])\s+/).map(s=>s.trim()).filter(s=>s.length>40&&s.length<300);
  const shuffled=shuffle(sentences);
  function extractKw(s){const m=s.match(/^(.+?)\s+(?:is|are|was|were|includes?|refers? to|means?)\s+(.+)/i);return m?{subject:m[1].trim(),answer:m[2].trim()}:null;}
  const phrases=sentences.map(s=>{const m=s.match(/(?:is|are|was|were|includes?)\s+(.+?)(?:\.|,|and|but|or)/i);return m?m[1].trim():null;}).filter(Boolean).filter(p=>p.length>5&&p.length<80);
  const mcq=[];
  for(const s of shuffled){
    if(mcq.length>=5)break;
    const kw=extractKw(s);if(!kw)continue;
    const wrongs=shuffle(phrases.filter(p=>p!==kw.answer)).slice(0,3);if(wrongs.length<2)continue;
    const correct=kw.answer.slice(0,80);
    const opts=shuffle([correct,...wrongs.map(w=>w.slice(0,80))]).slice(0,4);
    mcq.push({q:'What does "'+kw.subject.slice(0,60)+'" refer to?',opts,ans:opts.indexOf(correct)});
  }
  const tf=[];
  const tfs=shuffle(sentences.filter(s=>s.length>50)).slice(0,6);
  for(let i=0;i<tfs.length&&tf.length<4;i++){
    const s=tfs[i];
    if(i%2===0){tf.push({q:s.slice(0,150),ans:true});}
    else{const map={can:'cannot',is:'is not',are:'are not',does:'does not',has:'does not have',have:'do not have'};const neg=s.replace(/\b(can|is|are|does|has|have)\b/,m=>map[m]||m);if(neg!==s)tf.push({q:neg.slice(0,150),ans:false});}
  }
  return {mcq,tf};
}

app.post('/api/quiz', authMiddleware, async (req, res) => {
  const { sessionId, difficulty } = req.body;
  const session = sessions[sessionId];
  if (!session) return res.status(404).json({ error: 'Session not found' });
  try {
    const diff = difficulty || 'medium';
    const context = session.chunks.slice(0,8).join('\n\n');
    const diffInstructions = {
      easy:   'Make questions simple. Test basic definitions and facts.',
      medium: 'Make questions moderately challenging. Test understanding.',
      hard:   'Make questions difficult. Test analysis and critical thinking.'
    };
    const prompt = `You are a quiz generator. Create a quiz from the lecture content.
Difficulty: ${diff.toUpperCase()} - ${diffInstructions[diff]}

Lecture:
"""
${context}
"""

Generate EXACTLY this JSON (no extra text):
{
  "mcq": [
    {"q": "Full question?", "opts": ["Complete answer one", "Complete answer two", "Complete answer three", "Complete answer four"], "ans": 0},
    {"q": "Full question?", "opts": ["Complete answer one", "Complete answer two", "Complete answer three", "Complete answer four"], "ans": 1},
    {"q": "Full question?", "opts": ["Complete answer one", "Complete answer two", "Complete answer three", "Complete answer four"], "ans": 2},
    {"q": "Full question?", "opts": ["Complete answer one", "Complete answer two", "Complete answer three", "Complete answer four"], "ans": 3},
    {"q": "Full question?", "opts": ["Complete answer one", "Complete answer two", "Complete answer three", "Complete answer four"], "ans": 0}
  ],
  "tf": [
    {"q": "A complete statement.", "ans": true},
    {"q": "A complete statement.", "ans": false},
    {"q": "A complete statement.", "ans": true},
    {"q": "A complete statement.", "ans": false}
  ]
}
RULES: opts must be REAL complete phrases NOT letters like A/B/C/D. Return ONLY JSON.`;

    const raw = await askGroq('Return only valid JSON.', prompt);
    if (raw) {
      try {
        const clean = raw.replace(/```json|```/g,'').trim();
        const parsed = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}')+1));
        if (parsed.mcq && parsed.tf) {
          const validMcq = parsed.mcq.filter(q=>q.opts&&q.opts.length>=2&&q.opts.every(o=>o&&o.length>2&&!/^[A-D]$/.test(o.trim())));
          if (validMcq.length >= 3) {
            // FIX #4: quiz count is updated ONLY here (removed duplicate from /api/quiz/score)
            db.prepare('UPDATE stats SET quizzes = quizzes + 1 WHERE user_id = ?').run(req.user.id);
            return res.json({ questions: { mcq: validMcq, tf: parsed.tf.filter(q=>q.q&&q.q.length>5) }, difficulty: diff });
          }
        }
      } catch(e) { console.log('Quiz JSON parse failed, using fallback'); }
    }
    // fallback also counts as one quiz
    db.prepare('UPDATE stats SET quizzes = quizzes + 1 WHERE user_id = ?').run(req.user.id);
    const questions = generateQuizFromText(session.text);
    res.json({ questions, difficulty: diff });
  } catch(e) { res.status(500).json({ error: 'Failed to generate quiz.' }); }
});

// Update best score only — FIX #4: no longer increments quizzes counter here
app.post('/api/quiz/score', authMiddleware, (req, res) => {
  const { score } = req.body;
  if (!score) return res.json({ ok: true });
  const current = db.prepare('SELECT best_score FROM stats WHERE user_id = ?').get(req.user.id);
  if (current) {
    let newBest = current.best_score;
    if (!newBest) { newBest = score; }
    else {
      const [cs,ct]=newBest.split('/').map(Number);
      const [ns,nt]=score.split('/').map(Number);
      if(ns/nt>cs/ct) newBest=score;
    }
    // FIX #4: removed "quizzes=quizzes+1" from here — only updates best_score now
    db.prepare('UPDATE stats SET best_score=? WHERE user_id=?').run(newBest, req.user.id);
  }
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════
// 🗑️ Delete Session — FIX #2: now protected with authMiddleware
// ═══════════════════════════════════════════════
app.delete('/api/session/:id', authMiddleware, (req, res) => {
  // FIX #3: file is already deleted at upload time, nothing to unlink here
  delete sessions[req.params.id];
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════
app.listen(PORT, async () => {
  console.log('🦉 Owly v2.1 running on http://localhost:' + PORT);
  console.log('📦 SQLite DB: owly.db');
  await validateApiKey();
});