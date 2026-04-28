/* ═══════════════════════════════════════════════
   SMBOT — script.js (Redesigned)
═══════════════════════════════════════════════ */

const API = 'https://owlyy-production.up.railway.app/api';

let currentSessionId      = null;
let chatSessions          = [];
let activeChatId          = null;
let activeMessages        = [];
let explainLevel          = 'normal';
let currentQuizDifficulty = 'medium';
let authToken             = localStorage.getItem('smbotToken') || null;
let currentUser           = (() => {
  try {
    const v = localStorage.getItem('smbotUser');
    return (v && v !== 'undefined') ? JSON.parse(v) : null;
  } catch(e) { return null; }
})();

/* ─────────────── THEME ─────────────── */
(function initTheme() {
  const saved = localStorage.getItem('smbotTheme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
})();

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('smbotTheme', next);
}

/* ─────────────── SMOOTH SCROLL ─────────────── */
function smoothTo(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}

/* ─────────────── SCROLL REVEAL ─────────────── */
function initReveal() {
  const elements = document.querySelectorAll('.reveal');
  if (!elements.length) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) entry.target.classList.add('visible');
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  elements.forEach(el => observer.observe(el));
}

/* ─────────────── HEADER SCROLL EFFECT ─────────────── */
function initHeaderScroll() {
  const header = document.getElementById('lpHeader');
  if (!header) return;
  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 40);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ─────────────── PAGE ROUTING ─────────────── */
// Strict: only one page visible at a time.
// welcome-page and app-page use display:block via .active
// auth-page uses display:flex via .active (overridden in CSS)
function navigate(targetId) {
  // Guard: must be logged in to access app
  if (targetId === 'app-page' && !authToken) {
    navigate('auth-page');
    return;
  }

  // Hide all pages
  document.querySelectorAll('.page-view').forEach(p => {
    p.classList.remove('active');
  });

  // Show target
  const target = document.getElementById(targetId);
  if (target) {
    target.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  if (targetId === 'welcome-page') {
    setTimeout(() => {
      initReveal();
      initHeaderScroll();
    }, 100);
  }
}

function goPage(page) {
  if (!authToken) {
    navigate('auth-page');
    return;
  }

  // Make sure app-page is visible
  document.querySelectorAll('.page-view').forEach(p => p.classList.remove('active'));
  const appPage = document.getElementById('app-page');
  if (appPage) appPage.classList.add('active');

  // Switch section inside app
  document.querySelectorAll('.app-section').forEach(s => s.classList.remove('active'));
  const sec = document.getElementById('sec-' + page);
  if (sec) sec.classList.add('active');

  // Update nav active state
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.dataset.page === page);
  });

  // Close mobile drawer
  const drawer = document.getElementById('mobileDrawer');
  if (drawer) drawer.classList.remove('open');

  if (page === 'quiz')      initQuizPage();
  if (page === 'summary')   initSummaryPage();
  if (page === 'chats')     renderChatsPage();
  if (page === 'dashboard') _loadStatsFromDB();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleDrawer() {
  const drawer = document.getElementById('mobileDrawer');
  if (drawer) drawer.classList.toggle('open');
}

/* ─────────────── TOAST ─────────────── */
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

function shakeCard(selector) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 500);
}

/* ─────────────── AUTH HELPERS ─────────────── */
function getAuthHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken };
}

/* ─────────────── AUTH TABS ─────────────── */
function switchTab(tab) {
  const tabSignin   = document.getElementById('tab-signin');
  const tabRegister = document.getElementById('tab-register');

  if (tabSignin)   tabSignin.classList.toggle('active', tab === 'signin');
  if (tabRegister) tabRegister.classList.toggle('active', tab === 'register');

  const indicator = document.getElementById('tabIndicator');
  if (indicator) {
    indicator.style.transform = tab === 'register' ? 'translateX(100%)' : 'translateX(0)';
  }

  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  const formId = tab === 'signin' ? 'form-signin' : tab === 'register' ? 'form-register' : 'form-verify';
  const form   = document.getElementById(formId);
  if (form) form.classList.add('active');
}

/* ─────────────── TOGGLE PASSWORD EYE ─────────────── */
function toggleEye(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.textContent = inp.type === 'password' ? '👁' : '🙈';
}

/* ─────────────── SIGN IN ─────────────── */
async function doSignIn() {
  const email    = (document.getElementById('siEmail')?.value || '').trim();
  const password = document.getElementById('siPassword')?.value || '';

  if (!email)    { shakeCard('.auth-card'); showToast('⚠️ Enter your email'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { shakeCard('.auth-card'); showToast('⚠️ Enter a valid email'); return; }
  if (!password) { shakeCard('.auth-card'); showToast('⚠️ Enter your password'); return; }

  const btn = document.getElementById('signinBtn');
  if (!btn) return;
  btn.textContent = 'Signing in…'; btn.disabled = true;

  try {
    const res  = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) {
      shakeCard('.auth-card');
      showToast('❌ ' + (data.error || 'Login failed'));
      btn.textContent = 'Sign In →'; btn.disabled = false;
      return;
    }
    authToken   = data.token;
    currentUser = data.user;
    localStorage.setItem('smbotToken', authToken);
    localStorage.setItem('smbotUser',  JSON.stringify(currentUser));
    btn.textContent = 'Sign In →'; btn.disabled = false;
    showToast('✅ Welcome back, ' + currentUser.name.split(' ')[0] + '!');
    setTimeout(() => enterApp(), 600);
  } catch(e) {
    shakeCard('.auth-card');
    showToast('❌ Cannot reach server. Check your connection.');
    btn.textContent = 'Sign In →'; btn.disabled = false;
  }
}

/* ─────────────── REGISTER ─────────────── */
async function doRegister() {
  const name     = (document.getElementById('regName')?.value || '').trim();
  const email    = (document.getElementById('regEmail')?.value || '').trim();
  const password = document.getElementById('regPassword')?.value || '';
  const confirm  = document.getElementById('regConfirm')?.value || '';

  if (!name || !email || !password || !confirm) { shakeCard('.auth-card'); showToast('⚠️ Fill in all fields'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { shakeCard('.auth-card'); showToast('⚠️ Enter a valid email'); return; }
  if (password.length < 6) { shakeCard('.auth-card'); showToast('⚠️ Password must be at least 6 characters'); return; }
  if (password !== confirm) { shakeCard('.auth-card'); showToast('⚠️ Passwords do not match'); return; }

  const btn = document.getElementById('registerBtn');
  if (!btn) return;
  btn.textContent = 'Sending code…'; btn.disabled = true;

  try {
    const res  = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch(_) {
      shakeCard('.auth-card');
      showToast('❌ Invalid server response');
      btn.textContent = 'Create Account →'; btn.disabled = false;
      return;
    }
    if (!res.ok) {
      shakeCard('.auth-card');
      showToast('❌ ' + (data.error || 'Registration failed'));
      btn.textContent = 'Create Account →'; btn.disabled = false;
      return;
    }
    window._pendingVerifyEmail = email;
    btn.textContent = 'Create Account →'; btn.disabled = false;
    showToast('📧 Check your email for a verification code!');

    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    const verifyForm = document.getElementById('form-verify');
    if (verifyForm) verifyForm.classList.add('active');

    const tabSignin   = document.getElementById('tab-signin');
    const tabRegister = document.getElementById('tab-register');
    if (tabSignin)   tabSignin.classList.remove('active');
    if (tabRegister) tabRegister.classList.remove('active');
  } catch(e) {
    shakeCard('.auth-card');
    showToast('❌ ' + (e.message || 'Connection error'));
    btn.textContent = 'Create Account →'; btn.disabled = false;
  }
}

/* ─────────────── VERIFY ─────────────── */
async function doVerify() {
  const code  = (document.getElementById('verifyCode')?.value || '').trim();
  const email = window._pendingVerifyEmail || '';

  if (!code || code.length !== 6) { shakeCard('.auth-card'); showToast('⚠️ Enter the 6-digit code'); return; }
  if (!email) { shakeCard('.auth-card'); showToast('⚠️ Please register first'); switchTab('register'); return; }

  const btn = document.getElementById('verifyBtn');
  if (!btn) return;
  btn.textContent = 'Verifying…'; btn.disabled = true;

  try {
    const res  = await fetch(`${API}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code })
    });
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch(_) {
      shakeCard('.auth-card');
      showToast('❌ Invalid server response');
      btn.textContent = 'Verify →'; btn.disabled = false;
      return;
    }
    if (!res.ok) {
      shakeCard('.auth-card');
      showToast('❌ ' + (data.error || 'Verification failed'));
      btn.textContent = 'Verify →'; btn.disabled = false;
      return;
    }
    authToken   = data.token;
    currentUser = data.user;
    localStorage.setItem('smbotToken', authToken);
    localStorage.setItem('smbotUser',  JSON.stringify(currentUser));
    window._pendingVerifyEmail = null;
    btn.textContent = 'Verify →'; btn.disabled = false;
    showToast('✅ Welcome, ' + data.user.name.split(' ')[0] + '!');
    setTimeout(() => enterApp(), 600);
  } catch(e) {
    shakeCard('.auth-card');
    showToast('❌ ' + (e.message || 'Connection error'));
    btn.textContent = 'Verify →'; btn.disabled = false;
  }
}

/* ─────────────── RESEND CODE ─────────────── */
async function doResendCode() {
  const email = window._pendingVerifyEmail || '';
  if (!email) { showToast('⚠️ Please register first'); switchTab('register'); return; }
  try {
    const res  = await fetch(`${API}/auth/resend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) { showToast('❌ ' + (data.error || 'Could not resend')); return; }
    showToast('📧 New code sent!');
  } catch(e) { showToast('❌ Server error'); }
}

/* ─────────────── ENTER KEY (auth page only) ─────────────── */
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const apVisible = document.getElementById('auth-page')?.classList.contains('active');
  if (!apVisible) return;
  const active = document.querySelector('.auth-form.active');
  if (!active) return;
  if (active.id === 'form-signin')   doSignIn();
  if (active.id === 'form-register') doRegister();
  if (active.id === 'form-verify')   doVerify();
});

/* ─────────────── ENTER APP ─────────────── */
function enterApp() {
  // Hide all pages, show only app-page
  document.querySelectorAll('.page-view').forEach(p => p.classList.remove('active'));
  const appPage = document.getElementById('app-page');
  if (appPage) appPage.classList.add('active');

  if (currentUser) {
    const name = currentUser.name.split(' ')[0];
    const el   = document.getElementById('welcomeMsg');
    if (el) el.textContent = `Welcome back, ${name} 👋`;
    const dw = document.getElementById('dashWelcome');
    if (dw) dw.textContent = `Let's keep studying, ${name}!`;
  }

  _loadStatsFromDB();
  _loadChatsFromDB();
  goPage('dashboard');
}

/* ─────────────── AUTO LOGIN ─────────────── */
window.addEventListener('DOMContentLoaded', async () => {
  if (authToken && currentUser) {
    try {
      const res = await fetch(`${API}/auth/me`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data?.user?.id) {
          currentUser = data.user;
          enterApp();
          return;
        }
      }
    } catch(e) {}
    // Token invalid — clear and show welcome
    localStorage.removeItem('smbotToken');
    localStorage.removeItem('smbotUser');
    authToken = null; currentUser = null;
  }
  navigate('welcome-page');
  setTimeout(() => {
    initReveal();
    initHeaderScroll();
  }, 100);
});

/* ─────────────── LOGOUT ─────────────── */
function doLogout() {
  authToken = null; currentUser = null;
  localStorage.removeItem('smbotToken');
  localStorage.removeItem('smbotUser');
  if (currentSessionId) {
    fetch(`${API}/session/${currentSessionId}`, { method: 'DELETE' }).catch(() => {});
    currentSessionId = null; activeMessages = [];
  }
  showToast('👋 See you soon!');
  setTimeout(() => navigate('welcome-page'), 900);
}

/* ─────────────── STATS ─────────────── */
async function _loadStatsFromDB() {
  if (!authToken) return;
  try {
    const res = await fetch(`${API}/stats`, { headers: getAuthHeaders() });
    const s   = await res.json();
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setVal('statPdfs',    s.pdfs    || 0);
    setVal('statQuizzes', s.quizzes || 0);
    setVal('statBest',    s.best_score || '—');
  } catch(e) {}
}

/* ─────────────── UPLOAD ─────────────── */
let pickedFile = null;

function dzOver(e)  { e.preventDefault(); const dz = document.getElementById('dropZone'); if (dz) dz.classList.add('drag-over'); }
function dzLeave()  { const dz = document.getElementById('dropZone'); if (dz) dz.classList.remove('drag-over'); }
function dzDrop(e)  {
  e.preventDefault(); dzLeave();
  const f = e.dataTransfer.files[0];
  if (f && f.type === 'application/pdf') pickFile(f);
  else showToast('⚠️ Please drop a valid PDF');
}

function pickFile(f) {
  pickedFile = f;
  const chipName  = document.getElementById('chipName');
  const chipSize  = document.getElementById('chipSize');
  const fileChip  = document.getElementById('fileChip');
  const uploadBtn = document.getElementById('uploadBtn');
  const dropZone  = document.getElementById('dropZone');

  if (chipName) chipName.textContent = f.name;
  const kb = f.size / 1024;
  if (chipSize) chipSize.textContent = kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb.toFixed(0) + ' KB';
  if (fileChip) fileChip.classList.add('visible');
  if (uploadBtn) uploadBtn.disabled = false;
  if (dropZone) dropZone.classList.add('has-file');
}

function clearFile() {
  pickedFile = null;
  const fileChip  = document.getElementById('fileChip');
  const progBlock = document.getElementById('progBlock');
  const dropZone  = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const uploadBtn = document.getElementById('uploadBtn');

  if (fileChip) fileChip.classList.remove('visible');
  if (progBlock) progBlock.classList.remove('visible');
  if (dropZone) dropZone.classList.remove('has-file');
  if (fileInput) fileInput.value = '';
  if (uploadBtn) { uploadBtn.textContent = 'Upload & Analyse'; uploadBtn.disabled = true; }
}

async function doUpload() {
  const panel = document.getElementById('autoQs');
  if (panel) panel.style.display = 'none';
  if (!pickedFile) return;

  const pb   = document.getElementById('progBlock');
  const fill = document.getElementById('progFill');
  const st   = document.getElementById('progStatus');
  const pct  = document.getElementById('progPct');
  const btn  = document.getElementById('uploadBtn');

  if (pb) pb.classList.add('visible');
  if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }

  const stages = [
    { at: 30, label: 'Uploading…' },
    { at: 55, label: 'Extracting text…' },
    { at: 80, label: 'Analysing…' },
    { at: 95, label: 'Almost there…' }
  ];
  let p = 0, si = 0;
  const iv = setInterval(() => {
    p += Math.random() * 4 + 1; if (p > 95) p = 95;
    while (si < stages.length - 1 && p >= stages[si].at) si++;
    if (st)   st.textContent  = stages[si].label;
    if (pct)  pct.textContent = Math.floor(p) + '%';
    if (fill) fill.style.width = p + '%';
  }, 120);

  try {
    if (currentSessionId) {
      fetch(`${API}/session/${currentSessionId}`, { method: 'DELETE' }).catch(() => {});
      currentSessionId = null;
    }
    const formData = new FormData();
    formData.append('pdf', pickedFile);
    const res  = await fetch(`${API}/upload`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + authToken },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    currentSessionId = data.sessionId;
    activeMessages   = [];
    clearInterval(iv);
    if (fill) fill.style.width = '100%';
    if (pct)  pct.textContent  = '100%';
    if (st)   st.textContent   = '✓ Complete!';
    if (btn)  btn.textContent  = '✓ Uploaded!';
    showToast('✅ PDF analysed! Go to Summary, Q&A, or Quiz.');
    _resetChatBox();
    _loadStatsFromDB();
    setTimeout(_showAutoQuestions, 400);
  } catch(err) {
    clearInterval(iv);
    if (fill) fill.style.width = '0%';
    if (pct)  pct.textContent  = '0%';
    if (st)   st.textContent   = 'Upload failed';
    if (btn)  { btn.textContent = 'Upload & Analyse'; btn.disabled = false; }
    showToast('❌ ' + (err.message || 'Upload failed. Try again.'));
  }
}

/* ─────────────── SUMMARY ─────────────── */
async function initSummaryPage() {
  if (!currentSessionId) {
    const body = document.getElementById('summaryBody');
    if (body) body.innerHTML = '<p style="color:var(--text-muted)">📄 Upload a PDF first to generate a summary.</p>';
    return;
  }
  await _loadSummary();
}

async function _loadSummary() {
  const body = document.getElementById('summaryBody');
  if (!body) return;
  body.innerHTML = '<p style="color:var(--text-muted)">⏳ Generating summary…</p>';
  try {
    const res  = await fetch(`${API}/summary`, {
      method: 'POST', headers: getAuthHeaders(),
      body: JSON.stringify({ sessionId: currentSessionId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Summary failed');
    body.style.opacity = '0';
    setTimeout(() => {
      body.innerHTML = data.summary;
      body.style.transition = 'opacity .3s';
      body.style.opacity = '1';
      const tb = document.getElementById('translateBtn');
      if (tb) tb.style.display = (data.lang && data.lang !== 'ar') ? 'inline-flex' : 'none';
    }, 300);
  } catch(err) {
    body.innerHTML = `<p style="color:var(--danger)">❌ ${err.message}</p>`;
  }
}

async function regenSummary() {
  if (!currentSessionId) { showToast('⚠️ Upload a PDF first!'); return; }
  await _loadSummary();
  showToast('✨ Summary regenerated!');
}

async function translateSummary() {
  if (!currentSessionId) { showToast('⚠️ Upload a PDF first!'); return; }
  const btn  = document.getElementById('translateBtn');
  const body = document.getElementById('summaryBody');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Translating…'; }
  try {
    const res  = await fetch(`${API}/translate-summary`, {
      method: 'POST', headers: getAuthHeaders(),
      body: JSON.stringify({ sessionId: currentSessionId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Translation failed');
    if (body) {
      body.style.opacity = '0';
      setTimeout(() => { body.innerHTML = data.summary; body.style.opacity = '1'; }, 200);
    }
    showToast('✅ Translated to Arabic!');
    if (btn) btn.style.display = 'none';
  } catch(err) {
    showToast('❌ Translation failed');
    if (btn) { btn.disabled = false; btn.textContent = '🌐 Translate to Arabic'; }
  }
}

function downloadSummary() {
  const body = document.getElementById('summaryBody');
  if (!body) return;
  const text = body.innerText;
  const url  = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  Object.assign(document.createElement('a'), { href: url, download: 'smbot-summary.txt' }).click();
  URL.revokeObjectURL(url);
  showToast('📥 Downloaded!');
}

/* ─────────────── CHAT ─────────────── */
function _resetChatBox() {
  const box  = document.getElementById('chatMessages');
  if (!box) return;
  const name = currentUser ? currentUser.name.split(' ')[0] : '';
  const greeting = name
    ? `Hi ${name}! 👋 Your PDF is ready. Ask me anything about it!`
    : `Hi! 👋 Your PDF is ready. Ask me anything about it!`;
  box.innerHTML = `<div class="bubble-row bot"><div class="bubble-av">🤖</div><div class="bubble">${greeting}</div></div>`;
  activeChatId = null; activeMessages = [];
}

function setLevel(level) {
  explainLevel = level;
  document.querySelectorAll('.lvl-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('lvl-' + level);
  if (btn) btn.classList.add('active');
  const labels = { simple: '🟢 Simple', normal: '🟡 Normal', advanced: '🔴 Advanced' };
  showToast(labels[level] || level);
}

function chatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

async function sendMsg() {
  const inp = document.getElementById('chatInp');
  if (!inp) return;
  const msg = inp.value.trim();
  if (!msg) return;
  if (!currentSessionId) { showToast('⚠️ Upload a PDF first!'); return; }
  inp.value = ''; inp.style.height = 'auto';
  addBubble('user', msg);
  activeMessages.push({ role: 'user', text: msg });
  const tid = addTyping();
  try {
    const res  = await fetch(`${API}/chat`, {
      method: 'POST', headers: getAuthHeaders(),
      body: JSON.stringify({
        sessionId: currentSessionId,
        question: msg,
        level: explainLevel,
        history: activeMessages.slice(-10)
      })
    });
    const data = await res.json();
    removeTyping(tid);
    if (!res.ok) throw new Error(data.error || 'Chat failed');
    addBubble('bot', data.answer);
    activeMessages.push({ role: 'bot', text: data.answer });
  } catch(err) {
    removeTyping(tid);
    const errMsg = '⚠️ ' + (err.message || 'Could not get a response.');
    addBubble('bot', errMsg);
    activeMessages.push({ role: 'bot', text: errMsg });
  }
  _persistCurrentChat();
}

function addBubble(role, text) {
  const box = document.getElementById('chatMessages');
  if (!box) return;
  const div = document.createElement('div');
  div.className = `bubble-row ${role}`;
  const av = role === 'bot'
    ? '<div class="bubble-av">🤖</div>'
    : '<div class="bubble-av">👤</div>';
  div.innerHTML = `${av}<div class="bubble">${_esc(text)}</div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function addTyping() {
  const id  = 'ty' + Date.now();
  const box = document.getElementById('chatMessages');
  if (!box) return id;
  const div = document.createElement('div');
  div.className = 'bubble-row bot'; div.id = id;
  div.innerHTML = `<div class="bubble-av">🤖</div><div class="bubble"><div class="typing-dots"><div class="td"></div><div class="td"></div><div class="td"></div></div></div>`;
  box.appendChild(div); box.scrollTop = box.scrollHeight;
  return id;
}

function removeTyping(id) {
  const el = document.getElementById(id); if (el) el.remove();
}

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');
}

/* ─────────────── QUIZ ─────────────── */
let quizAllQ = [], qIdx = 0, score = 0, picked = false, quizWrongs = [];

async function initQuizPage() {
  if (!currentSessionId) {
    const q    = document.getElementById('quizQ');
    const opts = document.getElementById('quizOpts');
    if (q)    q.textContent    = 'Upload a PDF to start the quiz.';
    if (opts) opts.innerHTML   = '';
    return;
  }
  await startQuiz();
}

function getDifficultyFromScore(s, t) {
  const p = s / t;
  return p < 0.5 ? 'easy' : p < 0.8 ? 'medium' : 'hard';
}

async function startQuiz(difficulty) {
  if (!currentSessionId) { showToast('⚠️ Upload a PDF first!'); return; }
  currentQuizDifficulty = difficulty || currentQuizDifficulty || 'medium';
  qIdx = 0; score = 0; picked = false; quizWrongs = [];

  const qr = document.getElementById('quizResult');
  const qg = document.getElementById('quizGame');
  if (qr) qr.style.display = 'none';
  if (qg) qg.style.display = 'block';

  const diffLabels  = { easy: '🟢 Easy', medium: '🟡 Medium', hard: '🔴 Hard' };
  const quizQ       = document.getElementById('quizQ');
  const quizOpts    = document.getElementById('quizOpts');
  const quizNext    = document.getElementById('quizNext');

  if (quizQ)    quizQ.textContent = '⏳ Generating ' + (diffLabels[currentQuizDifficulty] || '') + ' questions…';
  if (quizOpts) quizOpts.innerHTML = '<p style="opacity:.6;padding:1rem 0">Please wait…</p>';
  if (quizNext) quizNext.disabled = true;

  try {
    const res  = await fetch(`${API}/quiz`, {
      method: 'POST', headers: getAuthHeaders(),
      body: JSON.stringify({ sessionId: currentSessionId, difficulty: currentQuizDifficulty })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Quiz failed');
    const q = data.questions;
    quizAllQ = [
      ...(q.mcq || []).map(x => ({ ...x, type: 'mcq' })),
      ...(q.tf  || []).map(x => ({ q: x.q, opts: ['True', 'False'], ans: x.ans ? 0 : 1, type: 'tf' }))
    ];
    if (!quizAllQ.length) {
      showToast('⚠️ Not enough content.');
      if (qg) qg.style.display = 'none';
      return;
    }
    renderQ();
  } catch(err) {
    if (quizQ) quizQ.textContent = '❌ ' + err.message;
    if (quizOpts) quizOpts.innerHTML = '';
  }
}

function renderQ() {
  picked = false;
  const q        = quizAllQ[qIdx];
  const quizNum  = document.getElementById('quizNum');
  const quizQ    = document.getElementById('quizQ');
  const quizLbl  = document.getElementById('quizLbl');
  const quizFill = document.getElementById('quizFill');
  const quizNext = document.getElementById('quizNext');
  const quizOpts = document.getElementById('quizOpts');

  if (quizNum)  quizNum.textContent   = `Question ${qIdx + 1}`;
  if (quizQ)    quizQ.textContent     = q.q;
  if (quizLbl)  quizLbl.textContent   = `${qIdx + 1} / ${quizAllQ.length}`;
  if (quizFill) quizFill.style.width  = ((qIdx + 1) / quizAllQ.length * 100) + '%';
  if (quizNext) quizNext.disabled     = true;

  const letters = ['A', 'B', 'C', 'D'];
  if (quizOpts) {
    quizOpts.innerHTML = '';
    q.opts.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'quiz-opt';
      btn.innerHTML = `<span class="opt-ltr">${letters[i] || i + 1}</span>${_esc(opt)}`;
      btn.onclick = () => pick(i, btn);
      quizOpts.appendChild(btn);
    });
  }
}

function pick(i, btn) {
  if (picked) return; picked = true;
  const q = quizAllQ[qIdx], c = q.ans;
  document.querySelectorAll('.quiz-opt').forEach(b => b.classList.add('locked'));
  const correctOpt = document.querySelectorAll('.quiz-opt')[c];
  if (correctOpt) correctOpt.classList.add('correct');
  if (i !== c) {
    btn.classList.add('wrong');
    quizWrongs.push({ q: q.q, correct: q.opts[c] });
  } else {
    score++;
  }
  const quizNext = document.getElementById('quizNext');
  if (quizNext) quizNext.disabled = false;
}

function nextQ() {
  qIdx++;
  if (qIdx >= quizAllQ.length) showResult(); else renderQ();
}

function showResult() {
  const qg = document.getElementById('quizGame');
  const qr = document.getElementById('quizResult');
  if (qg) qg.style.display = 'none';
  if (qr) qr.style.display = 'block';

  const total    = quizAllQ.length;
  const resScore = document.getElementById('resScore');
  if (resScore) resScore.textContent = `${score} / ${total}`;

  const p = score / total;
  const [emoji, msg] = p === 1 ? ['🏆', 'Perfect score!'] : p >= .8 ? ['🎉', 'Excellent work!'] : p >= .6 ? ['👍', 'Good effort!'] : p >= .4 ? ['📚', 'Keep studying!'] : ['😔', 'Re-read the material.'];
  const resEmoji = document.getElementById('resEmoji');
  const resMsg   = document.getElementById('resMsg');
  if (resEmoji) resEmoji.textContent = emoji;
  if (resMsg)   resMsg.textContent   = msg;

  const nextDiff    = getDifficultyFromScore(score, total);
  const diffLabels2 = { easy: '🟢 Easy', medium: '🟡 Medium', hard: '🔴 Hard' };
  const diffMsg     = nextDiff === currentQuizDifficulty ? 'Same level: ' + diffLabels2[nextDiff] : 'Next quiz: ' + diffLabels2[nextDiff];
  currentQuizDifficulty = nextDiff;
  const adaptEl = document.getElementById('adaptiveDiff');
  if (adaptEl) adaptEl.textContent = diffMsg;

  fetch(`${API}/quiz/score`, {
    method: 'POST', headers: getAuthHeaders(),
    body: JSON.stringify({ score: `${score}/${total}` })
  }).catch(() => {});
  _loadStatsFromDB();

  const wb = document.getElementById('weaknessBlock');
  if (wb) {
    wb.innerHTML = '';
    if (quizWrongs.length > 0) {
      wb.innerHTML = `<div class="weakness-block"><div class="weakness-title">⚠ Areas to review (${quizWrongs.length})</div>${
        quizWrongs.map(w => `<div class="weakness-item"><span class="weakness-item-ico">✕</span><span><strong>Q:</strong> ${_esc(w.q)}<br><span style="color:var(--accent)">✓ ${_esc(w.correct)}</span></span></div>`).join('')
      }</div>`;
    }
  }
}

/* ─────────────── CHAT SESSIONS ─────────────── */
async function _loadChatsFromDB() {
  if (!authToken) return;
  try {
    const res = await fetch(`${API}/chats`, { headers: getAuthHeaders() });
    if (res.ok) chatSessions = await res.json();
  } catch(e) {}
}

async function _persistCurrentChat() {
  const hasUser = activeMessages.some(m => m.role === 'user');
  if (!hasUser || !authToken) return;
  const firstUser = activeMessages.find(m => m.role === 'user');
  const title     = firstUser ? firstUser.text.trim().split(/\s+/).slice(0, 5).join(' ') + '…' : 'Chat';
  try {
    const res  = await fetch(`${API}/chats/save`, {
      method: 'POST', headers: getAuthHeaders(),
      body: JSON.stringify({ chatId: activeChatId, title, messages: activeMessages })
    });
    const data = await res.json();
    if (data.chatId) activeChatId = data.chatId;
    await _loadChatsFromDB();
  } catch(e) {}
}

function renderChatsPage() {
  _loadChatsFromDB().then(() => {
    const grid  = document.getElementById('chatsGrid');
    const empty = document.getElementById('chatsEmpty');
    if (!grid) return;
    grid.innerHTML = '';
    if (!chatSessions.length) {
      if (empty) empty.classList.add('visible');
      return;
    }
    if (empty) empty.classList.remove('visible');
    chatSessions.forEach(s => _renderChatCard(grid, s));
  });
}

function _renderChatCard(container, s) {
  const card    = document.createElement('div');
  card.className = 'chat-card'; card.dataset.id = s.id;
  const date    = new Date(s.updated_at || s.timestamp || Date.now());
  const dateStr = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  card.innerHTML = `
    <div class="cc-top">
      <div class="cc-ico">💬</div>
      <div class="cc-title">${_esc(s.title)}</div>
      <button class="cc-del" onclick="_deleteChatCard('${s.id}', event)" title="Delete">✕</button>
    </div>
    <div class="cc-foot">
      <div class="cc-meta">
        <span class="cc-badge">💬 ${s.message_count || 0} messages</span>
        <span class="cc-date">${dateStr} · ${timeStr}</span>
      </div>
      <span class="cc-open">Open →</span>
    </div>`;
  card.addEventListener('click', e => {
    if (e.target.closest('.cc-del')) return;
    _openChatFromHistory(s.id);
  });
  container.appendChild(card);
}

async function _deleteChatCard(id, e) {
  e.stopPropagation();
  await fetch(`${API}/chats/${id}`, { method: 'DELETE', headers: getAuthHeaders() }).catch(() => {});
  chatSessions = chatSessions.filter(s => s.id != id);
  if (activeChatId == id) { activeChatId = null; activeMessages = []; }
  renderChatsPage();
  showToast('🗑️ Chat deleted');
}

async function _openChatFromHistory(id) {
  try {
    const res  = await fetch(`${API}/chats/${id}`, { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    activeChatId   = id;
    activeMessages = data.messages.map(m => ({ role: m.role, text: m.content }));
    const box = document.getElementById('chatMessages');
    if (!box) return;
    box.innerHTML = '';
    data.messages.forEach(m => {
      const div = document.createElement('div');
      div.className = `bubble-row ${m.role}`;
      const av = m.role === 'bot' ? '<div class="bubble-av">🤖</div>' : '<div class="bubble-av">👤</div>';
      div.innerHTML = `${av}<div class="bubble">${_esc(m.content)}</div>`;
      box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
    goPage('qa');
    showToast('💬 Chat loaded!');
  } catch(e) { showToast('❌ Could not load chat'); }
}

function startNewChat() {
  _persistCurrentChat();
  activeChatId = null; activeMessages = [];
  _resetChatBox();
  goPage('qa');
  showToast('✨ New chat started!');
}

function filterChats(query) {
  const grid = document.getElementById('chatsGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const q        = query.toLowerCase().trim();
  const filtered = q ? chatSessions.filter(s => s.title.toLowerCase().includes(q)) : [...chatSessions];
  const empty    = document.getElementById('chatsEmpty');
  if (!filtered.length) {
    if (empty) empty.classList.add('visible');
    grid.innerHTML = '<div class="chats-no-results">🔍 No chats found.</div>';
    return;
  }
  if (empty) empty.classList.remove('visible');
  filtered.forEach(s => _renderChatCard(grid, s));
}

/* ─────────────── AUTO QUESTIONS ─────────────── */
const AQ_BANK = [
  ['What are the main topics covered?', 'Can you explain the key concepts simply?', 'What is the most important takeaway?', 'Are there definitions I should know?', 'How does this connect to real life?'],
  ['What are the differences between the main concepts?', 'Can you summarise the structure?', 'What exam questions might appear?', 'Which section is most important?', 'Give me an example for each key concept.'],
  ['What are the causes and effects described?', 'How would you explain this to a beginner?', 'What are the most challenging concepts?', 'What are the pros and cons mentioned?', 'Highlight the most critical points.'],
];

function _showAutoQuestions() {
  const panel = document.getElementById('autoQs');
  const list  = document.getElementById('aqList');
  if (!panel || !list) return;
  const bank = AQ_BANK[Math.floor(Math.random() * AQ_BANK.length)];
  list.innerHTML = '';
  bank.forEach(q => {
    const btn = document.createElement('button');
    btn.className   = 'aq-item';
    btn.textContent = q;
    btn.onclick = () => {
      startNewChat();
      setTimeout(() => {
        const inp = document.getElementById('chatInp');
        if (inp) { inp.value = q; inp.focus(); autoResize(inp); }
        goPage('qa');
      }, 200);
    };
    list.appendChild(btn);
  });
  panel.style.display = 'block';
}