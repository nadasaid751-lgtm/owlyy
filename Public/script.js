/* ═══════════════════════════════════════════════
   OWLY v2.0 — script.js
═══════════════════════════════════════════════ */

const API = 'https://owlyy-production.up.railway.app/api';

let currentSessionId = null;
let chatSessions     = [];
let activeChatId     = null;
let activeMessages   = [];
let explainLevel     = 'normal';
let authToken        = localStorage.getItem('owlyToken') || null;
let currentUser      = JSON.parse(localStorage.getItem('owlyUserObj') || 'null');
let currentQuizDifficulty = 'medium';

// ── Auth helpers ──────────────────────────────
function getAuthHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken };
}

// ── Stats ──────────────────────────────────────
async function _loadStatsFromDB() {
  if (!authToken) return;
  try {
    const res = await fetch(`${API}/stats`, { headers: getAuthHeaders() });
    const s   = await res.json();
    const pdfEl   = document.querySelector('.stat-card:nth-child(1) .stat-value');
    const quizEl  = document.querySelector('.stat-card:nth-child(2) .stat-value');
    const scoreEl = document.querySelector('.stat-card:nth-child(3) .stat-value');
    if (pdfEl)   pdfEl.textContent   = s.pdfs   || 0;
    if (quizEl)  quizEl.textContent  = s.quizzes || 0;
    if (scoreEl) scoreEl.textContent = s.best_score || '—';
  } catch(e) {}
}

// ═══════════════════════════════════════════════
//  TYPEWRITER + STEPS
// ═══════════════════════════════════════════════
(function(){
  const el = document.getElementById('tw');
  if (!el) return;
  const text = 'Study Smart, Not Hard.';
  let i = 0;
  function type(){ if(i<=text.length){ el.textContent=text.slice(0,i++); setTimeout(type,i===1?900:52); } }
  setTimeout(type,850);
})();

(function(){
  const steps=['si0','si1','si2','si3'], seps=['sep0','sep1','sep2'];
  steps.forEach((id,i)=>{
    setTimeout(()=>{
      const el=document.getElementById(id); if(el) el.classList.add('visible');
      const s=document.getElementById(seps[i]); if(s) s.classList.add('visible');
    },1950+i*180);
  });
})();

// ═══════════════════════════════════════════════
//  MODAL
// ═══════════════════════════════════════════════
function openForm(screenId){
  document.getElementById('modalBg').classList.add('open');
  show(screenId);
  document.body.style.overflow='hidden';
}
function closeForm(){
  document.getElementById('modalBg').classList.remove('open');
  document.body.style.overflow='';
}
function closeFormOnBg(e){ if(e.target===document.getElementById('modalBg')) closeForm(); }

// ═══════════════════════════════════════════════
//  AUTH UI helpers
// ═══════════════════════════════════════════════
function show(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function toggleEye(id,icon){
  const inp=document.getElementById(id);
  inp.type=inp.type==='password'?'text':'password';
  icon.classList.toggle('fa-eye'); icon.classList.toggle('fa-eye-slash');
}
function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2800);
}
function shake(){
  const c=document.getElementById('modalCard');
  c.classList.remove('shake'); void c.offsetWidth;
  c.classList.add('shake'); setTimeout(()=>c.classList.remove('shake'),500);
}

// ═══════════════════════════════════════════════
//  EXPLAIN LEVEL
// ═══════════════════════════════════════════════
function setLevel(level){
  explainLevel = level;
  document.querySelectorAll('.level-btn').forEach(b=>b.classList.remove('active'));
  const btn = document.getElementById('lvl-'+level);
  if(btn) btn.classList.add('active');
  const labels={simple:'🟢 Simple',normal:'🟡 Normal',advanced:'🔴 Advanced'};
  showToast(labels[level]||level);
}

// ═══════════════════════════════════════════════
//  SIGN IN — Real Auth with DB
// ═══════════════════════════════════════════════
async function doSignIn(){
  const email    = document.getElementById('siEmail').value.trim();
  const password = document.getElementById('siPassword')?.value || '';
  const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9\-]+(\.[a-zA-Z0-9\-]+)+$/;
  if (!email){ shake(); showToast('⚠️ Please enter your email'); return; }
  if (!emailRegex.test(email) || !/\.[a-zA-Z]{2,}$/.test(email)){ shake(); showToast('⚠️ Invalid email! e.g. name@gmail.com'); return; }
  if (!password){ shake(); showToast('⚠️ Please enter your password'); return; }

  const btn = document.getElementById('signInBtn');
  btn.innerHTML='<i class="fas fa-circle-notch fa-spin"></i> Signing in…'; btn.disabled=true;
  try {
    const res  = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok){ shake(); showToast('❌ ' + (data.error||'Login failed')); btn.innerHTML='<i class="fas fa-arrow-right-to-bracket"></i> Sign In'; btn.disabled=false; return; }
    authToken   = data.token;
    currentUser = data.user;
    localStorage.setItem('owlyToken',   authToken);
    localStorage.setItem('owlyUserObj', JSON.stringify(currentUser));
    btn.innerHTML='<i class="fas fa-arrow-right-to-bracket"></i> Sign In'; btn.disabled=false;
    showToast('✅ Welcome back, ' + currentUser.name.split(' ')[0] + '!');
    setTimeout(()=>{ closeForm(); enterApp(); },600);
  } catch(e){
    shake(); showToast('❌ Server not running! Start node server.js');
    btn.innerHTML='<i class="fas fa-arrow-right-to-bracket"></i> Sign In'; btn.disabled=false;
  }
}

// ═══════════════════════════════════════════════
//  REGISTER — Real Auth with DB
// ═══════════════════════════════════════════════
async function doRegister(){
  const name     = document.getElementById('regName').value.trim();
  const email    = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword')?.value || '';
  const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9\-]+(\.[a-zA-Z0-9\-]+)+$/;
  const knownFakeDomains = ['test.com','example.com','fake.com','mailinator.com','guerrillamail.com','tempmail.com','throwaway.com','yopmail.com','sharklasers.com','trashmail.com'];
  if (!name||!email||!password){ shake(); showToast('⚠️ Please fill in all fields'); return; }
  if (!emailRegex.test(email) || !/\.[a-zA-Z]{2,}$/.test(email)){ shake(); showToast('⚠️ Invalid email! e.g. name@gmail.com'); return; }
  const emailDomain = email.split('@')[1]?.toLowerCase();
  if (knownFakeDomains.includes(emailDomain)){ shake(); showToast('⚠️ Please use a real email address'); return; }
  if (password.length < 6){ shake(); showToast('⚠️ Password must be at least 6 characters'); return; }

  const btn = document.getElementById('signUpBtn');
  btn.innerHTML='<i class="fas fa-circle-notch fa-spin"></i> Creating…'; btn.disabled=true;
  try {
    const res  = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json();
    if (!res.ok){ shake(); showToast('❌ ' + (data.error||'Registration failed')); btn.innerHTML='<i class="fas fa-user-check"></i> Sign Up'; btn.disabled=false; return; }
    btn.innerHTML='<i class="fas fa-user-check"></i> Sign Up'; btn.disabled=false;
    showToast('📧 Verification email sent! Check your inbox.');
    setTimeout(()=>show('screenSignIn'),2500);
  } catch(e){
    shake(); showToast('❌ Server not running!');
    btn.innerHTML='<i class="fas fa-user-check"></i> Sign Up'; btn.disabled=false;
  }
}

document.addEventListener('keydown',e=>{
  if(e.key!=='Enter') return;
  const mb=document.getElementById('modalBg');
  if(!mb.classList.contains('open')) return;
  const active=document.querySelector('.screen.active');
  if(!active) return;
  if(active.id==='screenSignIn') doSignIn();
  if(active.id==='screenRegister') doRegister();
});

// ═══════════════════════════════════════════════
//  APP NAV
// ═══════════════════════════════════════════════
function enterApp(){
  document.getElementById('auth-container').style.display='none';
  document.getElementById('app-container').style.display='block';
  if (currentUser) {
    const firstName = currentUser.name.split(' ')[0];
    document.getElementById('welcomeMsg').textContent = `Welcome back, ${firstName} 👋`;
  }
  _loadStatsFromDB();
  _loadChatsFromDB();
  go('dashboard');
}

// Auto-login if token exists
window.addEventListener('DOMContentLoaded', async () => {
  if (authToken && currentUser) {
    try {
      const res = await fetch(`${API}/auth/me`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        // تحقق إن اليوزر موجود فعلاً في الداتابيز
        if (data && data.user && data.user.id) {
          currentUser = data.user;
          enterApp();
          return;
        }
      }
    } catch(e){
      // السيرفر مش شغال — امسح الـ token
    }
    // فشل التحقق — امسح كل حاجة وارجع لشاشة الـ Login
    localStorage.removeItem('owlyToken');
    localStorage.removeItem('owlyUserObj');
    authToken = null;
    currentUser = null;
  }
});

function doLogout(){
  authToken = null; currentUser = null;
  localStorage.removeItem('owlyToken');
  localStorage.removeItem('owlyUserObj');
  if(currentSessionId){
    fetch(`${API}/session/${currentSessionId}`,{method:'DELETE'}).catch(()=>{});
    currentSessionId=null; activeMessages=[];
  }
  showToast('👋 See you soon!');
  setTimeout(()=>{
    document.getElementById('app-container').style.display='none';
    document.getElementById('auth-container').style.display='flex';
  },1000);
}

function _baseGo(page){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  document.querySelectorAll('[data-page]').forEach(a=>a.classList.toggle('active',a.dataset.page===page));
  document.getElementById('mobileDrawer').classList.remove('open');
  document.getElementById('hamburger').classList.remove('open');
  if(page==='quiz')    initQuizPage();
  if(page==='summary') initSummaryPage();
  if(page==='chats')   renderChatsPage();
  if(page==='dashboard') _loadStatsFromDB();
  window.scrollTo({top:0,behavior:'smooth'});
}
function go(page){ _baseGo(page); }

function toggleDrawer(){
  document.getElementById('mobileDrawer').classList.toggle('open');
  document.getElementById('hamburger').classList.toggle('open');
}

// ═══════════════════════════════════════════════
//  UPLOAD
// ═══════════════════════════════════════════════
let pickedFile=null;

function dzOver(e){e.preventDefault();document.getElementById('dropZone').classList.add('drag-over');}
function dzLeave(e){document.getElementById('dropZone').classList.remove('drag-over');}
function dzDrop(e){
  e.preventDefault();dzLeave(e);
  const f=e.dataTransfer.files[0];
  if(f&&f.type==='application/pdf') pickFile(f);
  else showToast('⚠️ Please drop a valid PDF.');
}
function pickFile(f){
  pickedFile=f;
  document.getElementById('chipName').textContent=f.name;
  const kb=f.size/1024;
  document.getElementById('chipSize').textContent=kb>1024?(kb/1024).toFixed(1)+' MB':kb.toFixed(0)+' KB';
  document.getElementById('fileChip').classList.add('visible');
  document.getElementById('uploadBtn').disabled=false;
  document.getElementById('dropZone').classList.add('has-file');
}
function clearFile(){
  pickedFile=null;
  document.getElementById('fileChip').classList.remove('visible');
  document.getElementById('progBlock').classList.remove('visible');
  document.getElementById('dropZone').classList.remove('has-file');
  document.getElementById('fileInput').value='';
  const btn=document.getElementById('uploadBtn');
  btn.innerHTML='<i class="fas fa-upload"></i> Upload &amp; Analyse'; btn.disabled=true;
}

async function _doUploadCore(){
  if(!pickedFile) return;
  const pb=document.getElementById('progBlock');
  const fill=document.getElementById('progFill');
  const st=document.getElementById('progStatus');
  const pct=document.getElementById('progPct');
  const btn=document.getElementById('uploadBtn');
  pb.classList.add('visible'); btn.disabled=true;
  btn.innerHTML='<i class="fas fa-circle-notch fa-spin"></i> Processing…';
  const stages=[{at:30,label:'Uploading…'},{at:55,label:'Extracting text…'},{at:80,label:'Analysing…'},{at:95,label:'Almost there…'}];
  let p=0,si=0;
  const iv=setInterval(()=>{
    p+=Math.random()*4+1; if(p>95) p=95;
    while(si<stages.length-1&&p>=stages[si].at) si++;
    st.textContent=stages[si].label; pct.textContent=Math.floor(p)+'%'; fill.style.width=p+'%';
  },120);
  try {
    if(currentSessionId){
      fetch(`${API}/session/${currentSessionId}`,{method:'DELETE'}).catch(()=>{});
      currentSessionId=null;
    }
    const formData=new FormData();
    formData.append('pdf',pickedFile);
    const res=await fetch(`${API}/upload`,{method:'POST',headers:{'Authorization':'Bearer '+authToken},body:formData});
    const data=await res.json();
    if(!res.ok) throw new Error(data.error||'Upload failed');
    currentSessionId=data.sessionId;
    activeMessages=[];
    clearInterval(iv);
    fill.style.width='100%'; pct.textContent='100%'; st.textContent='✓ Complete!';
    btn.innerHTML='<i class="fas fa-circle-check"></i> Uploaded!';
    showToast('✅ PDF analysed! Go to Summary, Q&A, or Quiz.');
    _resetChatBox();
    _loadStatsFromDB();
  } catch(err){
    clearInterval(iv);
    fill.style.width='0%'; pct.textContent='0%'; st.textContent='Upload failed';
    btn.innerHTML='<i class="fas fa-upload"></i> Upload &amp; Analyse'; btn.disabled=false;
    showToast('❌ '+(err.message||'Upload failed. Try again.'));
  }
}

async function doUpload(){
  const panel=document.getElementById('autoQs');
  if(panel) panel.style.display='none';
  await _doUploadCore();
  if(currentSessionId) setTimeout(_showAutoQuestions,400);
}

// ═══════════════════════════════════════════════
//  SUMMARY
// ═══════════════════════════════════════════════
async function initSummaryPage(){
  if(!currentSessionId){
    document.getElementById('summaryBody').innerHTML='<p style="color:var(--text-mut)">📄 Please upload a PDF first.</p>';
    return;
  }
  await _loadSummary();
}

async function _loadSummary(){
  const body=document.getElementById('summaryBody');
  body.innerHTML='<p><i class="fas fa-circle-notch fa-spin"></i> Generating summary…</p>';
  try {
    const res=await fetch(`${API}/summary`,{method:'POST',headers:getAuthHeaders(),body:JSON.stringify({sessionId:currentSessionId})});
    const data=await res.json();
    if(!res.ok) throw new Error(data.error||'Summary failed');
    body.style.cssText='opacity:0;transform:translateY(10px);transition:opacity .3s,transform .3s';
    setTimeout(()=>{
      body.innerHTML=data.summary;
      body.style.cssText='opacity:1;transform:none;transition:opacity .3s,transform .3s';
      const translateBtn=document.getElementById('translateSummaryBtn');
      if(translateBtn) translateBtn.style.display=(data.lang&&data.lang!=='ar')?'inline-flex':'none';
    },300);
  } catch(err){
    body.innerHTML=`<p style="color:var(--red)">❌ ${err.message}</p>`;
  }
}

async function translateSummary(){
  if(!currentSessionId){showToast('⚠️ Upload a PDF first!');return;}
  const btn=document.getElementById('translateSummaryBtn');
  const body=document.getElementById('summaryBody');
  if(btn){btn.disabled=true;btn.innerHTML='<i class="fas fa-circle-notch fa-spin"></i> Translating…';}
  try {
    const res=await fetch(`${API}/translate-summary`,{method:'POST',headers:getAuthHeaders(),body:JSON.stringify({sessionId:currentSessionId})});
    const data=await res.json();
    if(!res.ok) throw new Error(data.error||'Translation failed');
    body.style.cssText='opacity:0;transition:opacity .3s';
    setTimeout(()=>{ body.innerHTML=data.summary; body.style.cssText='opacity:1;transition:opacity .3s'; },200);
    showToast('✅ Translated to Arabic!');
    if(btn) btn.style.display='none';
  } catch(err){
    showToast('❌ Translation failed');
    if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-language"></i> ترجمة للعربي';}
  }
}

async function regenSummary(){
  if(!currentSessionId){showToast('⚠️ Upload a PDF first!');return;}
  const btn=document.querySelector('[onclick="regenSummary()"]');
  if(btn){btn.disabled=true;btn.innerHTML='<i class="fas fa-circle-notch fa-spin"></i> Generating…';}
  await _loadSummary();
  showToast('✨ Summary regenerated!');
  if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-rotate-right"></i> Regenerate';}
}

function downloadSummary(){
  const text=document.getElementById('summaryBody').innerText;
  const url=URL.createObjectURL(new Blob([text],{type:'text/plain'}));
  Object.assign(document.createElement('a'),{href:url,download:'summary.txt'}).click();
  URL.revokeObjectURL(url); showToast('📥 Downloaded!');
}

// ═══════════════════════════════════════════════
//  CHAT / Q&A
// ═══════════════════════════════════════════════
function _resetChatBox(){
  const box=document.getElementById('chatMessages');
  const owlHtml=document.querySelector('.nav-owl-icon')?.innerHTML||'';
  const firstName = currentUser ? currentUser.name.split(' ')[0] : '';
  const greeting = firstName ? `Hi ${firstName}! 👋 Your PDF is ready. Ask me anything!` : `Hi! 👋 Your PDF is ready. Ask me anything!`;
  box.innerHTML=`<div class="bubble-row bot"><div class="bav"><div class="bav-owl">${owlHtml}</div></div><div class="bubble">${greeting}</div></div>`;
  activeChatId=null; activeMessages=[];
}

function chatKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();}}
function autoResize(el){el.style.height='auto';el.style.height=el.scrollHeight+'px';}

async function sendMsg(){
  const inp=document.getElementById('chatInp');
  const msg=inp.value.trim();
  if(!msg) return;
  if(!currentSessionId){showToast('⚠️ Please upload a PDF first!');return;}
  inp.value=''; inp.style.height='auto';
  addBubble('user',msg);
  activeMessages.push({role:'user',text:msg});
  const tid=addTyping();
  try {
    const res=await fetch(`${API}/chat`,{
      method:'POST',
      headers:getAuthHeaders(),
      body:JSON.stringify({sessionId:currentSessionId,question:msg,level:explainLevel,history:activeMessages.slice(-10)})
    });
    const data=await res.json();
    removeTyping(tid);
    if(!res.ok) throw new Error(data.error||'Chat failed');
    addBubble('bot',data.answer);
    activeMessages.push({role:'bot',text:data.answer});
  } catch(err){
    removeTyping(tid);
    const errMsg='⚠️ '+(err.message||'Could not get a response.');
    addBubble('bot',errMsg);
    activeMessages.push({role:'bot',text:errMsg});
  }
  _persistCurrentChat();
}

function addBubble(role,text){
  const box=document.getElementById('chatMessages');
  const div=document.createElement('div');
  div.className=`bubble-row ${role}`;
  const owlHtml=document.querySelector('.nav-owl-icon')?.innerHTML||'';
  const av=role==='bot'?`<div class="bav"><div class="bav-owl">${owlHtml}</div></div>`:'<div class="bav"><i class="fas fa-user"></i></div>';
  div.innerHTML=`${av}<div class="bubble">${esc(text)}</div>`;
  box.appendChild(div);
  box.scrollTop=box.scrollHeight;
}
function addTyping(){
  const id='ty'+Date.now(),box=document.getElementById('chatMessages');
  const div=document.createElement('div');
  div.className='bubble-row bot'; div.id=id;
  div.innerHTML=`<div class="bav"></div><div class="bubble"><div class="typing-dots"><div class="td"></div><div class="td"></div><div class="td"></div></div></div>`;
  box.appendChild(div); box.scrollTop=box.scrollHeight; return id;
}
function removeTyping(id){const el=document.getElementById(id);if(el)el.remove();}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br/>');}

// ═══════════════════════════════════════════════
//  QUIZ
// ═══════════════════════════════════════════════
let quizAllQ=[], qIdx=0, score=0, picked=false, quizWrongs=[];

async function initQuizPage(){
  if(!currentSessionId){
    document.getElementById('quizQ').textContent='Please upload a PDF first.';
    document.getElementById('quizOpts').innerHTML='';
    return;
  }
  await startQuiz();
}

function getDifficultyFromScore(s,t){ const p=s/t; return p<0.5?'easy':p<0.8?'medium':'hard'; }

async function startQuiz(difficulty){
  if(!currentSessionId){showToast('⚠️ Upload a PDF first!');return;}
  currentQuizDifficulty = difficulty || currentQuizDifficulty || 'medium';
  qIdx=0; score=0; picked=false; quizWrongs=[];
  document.getElementById('quizGame').style.display='block';
  document.getElementById('quizResult').classList.remove('visible');
  const diffLabels={easy:'🟢 Easy',medium:'🟡 Medium',hard:'🔴 Hard'};
  document.getElementById('quizQ').textContent='⏳ Generating '+(diffLabels[currentQuizDifficulty]||'')+' questions…';
  document.getElementById('quizOpts').innerHTML='<p style="opacity:.6;padding:1rem 0">Please wait…</p>';
  document.getElementById('quizNext').disabled=true;
  try {
    const res=await fetch(`${API}/quiz`,{method:'POST',headers:getAuthHeaders(),body:JSON.stringify({sessionId:currentSessionId,difficulty:currentQuizDifficulty})});
    const data=await res.json();
    if(!res.ok) throw new Error(data.error||'Quiz failed');
    const q=data.questions;
    quizAllQ=[
      ...(q.mcq||[]).map(x=>({...x,type:'mcq'})),
      ...(q.tf||[]).map(x=>({q:x.q,opts:['True','False'],ans:x.ans?0:1,type:'tf'}))
    ];
    if(!quizAllQ.length){showToast('⚠️ Not enough content.');document.getElementById('quizGame').style.display='none';return;}
    renderQ();
  } catch(err){
    document.getElementById('quizQ').textContent='❌ '+err.message;
    document.getElementById('quizOpts').innerHTML='';
  }
}

function renderQ(){
  picked=false;
  const q=quizAllQ[qIdx];
  document.getElementById('quizNum').textContent=`Question ${qIdx+1}`;
  document.getElementById('quizQ').textContent=q.q;
  document.getElementById('quizLbl').textContent=`${qIdx+1} / ${quizAllQ.length}`;
  document.getElementById('quizFill').style.width=((qIdx+1)/quizAllQ.length*100)+'%';
  document.getElementById('quizNext').disabled=true;
  const letters=['A','B','C','D'];
  const cont=document.getElementById('quizOpts'); cont.innerHTML='';
  q.opts.forEach((opt,i)=>{
    const btn=document.createElement('button');
    btn.className='quiz-opt';
    btn.innerHTML=`<span class="opt-ltr">${letters[i]||i+1}</span>${opt}`;
    btn.onclick=()=>pick(i,btn);
    cont.appendChild(btn);
  });
}

function pick(i,btn){
  if(picked) return; picked=true;
  const q=quizAllQ[qIdx];
  const c=q.ans;
  document.querySelectorAll('.quiz-opt').forEach(b=>b.classList.add('locked'));
  document.querySelectorAll('.quiz-opt')[c].classList.add('correct');
  if(i!==c){ btn.classList.add('wrong'); quizWrongs.push({q:q.q,correct:q.opts[c]}); }
  else { score++; }
  document.getElementById('quizNext').disabled=false;
}

function nextQ(){qIdx++;if(qIdx>=quizAllQ.length) showResult();else renderQ();}

function showResult(){
  document.getElementById('quizGame').style.display='none';
  const res=document.getElementById('quizResult');
  res.classList.add('visible');
  const total=quizAllQ.length;
  document.getElementById('resScore').textContent=`${score} / ${total}`;
  const p=score/total;
  const[emoji,msg]=p===1?['🏆','Perfect score!']:p>=.8?['🎉','Excellent!']:p>=.6?['👍','Good effort!']:p>=.4?['📚','Keep studying!']:['😔','Re-read the material.'];
  document.getElementById('resEmoji').textContent=emoji;
  document.getElementById('resMsg').textContent=msg;

  // Adaptive difficulty
  const nextDiff=getDifficultyFromScore(score,total);
  const diffLabels2={easy:'🟢 Easy',medium:'🟡 Medium',hard:'🔴 Hard'};
  const diffMsg=nextDiff===currentQuizDifficulty?'Same level: '+diffLabels2[nextDiff]:'Next quiz: '+diffLabels2[nextDiff];
  currentQuizDifficulty=nextDiff;
  const adaptEl=document.getElementById('adaptiveDiff');
  if(adaptEl) adaptEl.textContent=diffMsg;

  // Save score to DB
  const scoreStr=`${score}/${total}`;
  fetch(`${API}/quiz/score`,{method:'POST',headers:getAuthHeaders(),body:JSON.stringify({score:scoreStr})}).catch(()=>{});
  _loadStatsFromDB();

  // Weakness notes
  const wb=document.getElementById('weaknessBlock'); if(wb) wb.remove();
  if(quizWrongs.length>0){
    const block=document.createElement('div');
    block.id='weaknessBlock'; block.className='weakness-block';
    block.innerHTML=`<div class="weakness-title"><i class="fas fa-triangle-exclamation" style="margin-right:6px"></i>Areas to review (${quizWrongs.length})</div>`;
    quizWrongs.forEach(w=>{
      const item=document.createElement('div'); item.className='weakness-item';
      item.innerHTML=`<i class="fas fa-times-circle"></i><span><strong>Q:</strong> ${_esc(w.q)}<br><span style="color:var(--green)">✓ ${_esc(w.correct)}</span></span>`;
      block.appendChild(item);
    });
    res.appendChild(block);
  }
}

// ═══════════════════════════════════════════════
//  CHAT SESSIONS — DB backed
// ═══════════════════════════════════════════════
async function _loadChatsFromDB(){
  if(!authToken) return;
  try {
    const res = await fetch(`${API}/chats`, { headers: getAuthHeaders() });
    if(res.ok) chatSessions = await res.json();
  } catch(e){}
}

async function _persistCurrentChat(){
  const hasUser=activeMessages.some(m=>m.role==='user');
  if(!hasUser||!authToken) return;
  const firstUser=activeMessages.find(m=>m.role==='user');
  const title=firstUser?firstUser.text.trim().split(/\s+/).slice(0,5).join(' ')+'…':'Chat';
  try {
    const res=await fetch(`${API}/chats/save`,{
      method:'POST',
      headers:getAuthHeaders(),
      body:JSON.stringify({chatId:activeChatId,title,messages:activeMessages})
    });
    const data=await res.json();
    if(data.chatId) activeChatId=data.chatId;
    await _loadChatsFromDB();
  } catch(e){}
}

function renderChatsPage(){
  _loadChatsFromDB().then(()=>{
    const grid=document.getElementById('chatsGrid');
    const empty=document.getElementById('chatsEmpty');
    if(!grid) return;
    grid.innerHTML='';
    if(!chatSessions.length){if(empty) empty.style.display='flex';return;}
    if(empty) empty.style.display='none';
    [...chatSessions].forEach(s=>_renderChatCard(grid,s));
  });
}

function _renderChatCard(container,s){
  const card=document.createElement('div');
  card.className='chat-card'; card.dataset.id=s.id;
  const date=new Date(s.updated_at||s.timestamp||Date.now());
  const dateStr=date.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  const timeStr=date.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  card.innerHTML=`
    <div class="cc-top">
      <div class="cc-icon"><i class="fas fa-comment-dots"></i></div>
      <div class="cc-title">${_esc(s.title)}</div>
      <button class="cc-del" onclick="_deleteChatCard('${s.id}',event)" title="Delete"><i class="fas fa-trash-can"></i></button>
    </div>
    <div class="cc-foot">
      <div class="cc-meta">
        <span class="cc-badge"><i class="fas fa-comment"></i> ${s.message_count||0} messages</span>
        <span class="cc-date">${dateStr} · ${timeStr}</span>
      </div>
      <span class="cc-open">Open <i class="fas fa-arrow-right"></i></span>
    </div>`;
  card.addEventListener('click',(e)=>{if(e.target.closest('.cc-del')) return;_openChatFromHistory(s.id);});
  container.appendChild(card);
}

function _esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

async function _deleteChatCard(id,e){
  e.stopPropagation();
  await fetch(`${API}/chats/${id}`,{method:'DELETE',headers:getAuthHeaders()}).catch(()=>{});
  chatSessions=chatSessions.filter(s=>s.id!=id);
  if(activeChatId==id){activeChatId=null;activeMessages=[];}
  renderChatsPage(); showToast('🗑️ Chat deleted');
}

async function _openChatFromHistory(id){
  try {
    const res=await fetch(`${API}/chats/${id}`,{headers:getAuthHeaders()});
    if(!res.ok) return;
    const data=await res.json();
    activeChatId=id;
    activeMessages=data.messages.map(m=>({role:m.role,text:m.content}));
    const box=document.getElementById('chatMessages');
    if(!box) return;
    box.innerHTML='';
    const owlHtml=document.querySelector('.nav-owl-icon')?.innerHTML||'';
    data.messages.forEach(m=>{
      const div=document.createElement('div');
      div.className=`bubble-row ${m.role}`;
      const av=m.role==='bot'?`<div class="bav"><div class="bav-owl">${owlHtml}</div></div>`:'<div class="bav"><i class="fas fa-user"></i></div>';
      div.innerHTML=`${av}<div class="bubble">${_esc(m.content)}</div>`;
      box.appendChild(div);
    });
    box.scrollTop=box.scrollHeight;
    go('qa'); showToast('💬 Chat loaded!');
  } catch(e){ showToast('❌ Could not load chat'); }
}

function startNewChat(){
  _persistCurrentChat();
  activeChatId=null; activeMessages=[];
  const box=document.getElementById('chatMessages');
  if(box){
    const owlHtml=document.querySelector('.nav-owl-icon')?.innerHTML||'';
    const firstName=currentUser?currentUser.name.split(' ')[0]:'';
    const _gr=firstName?`Hi ${firstName}! 👋 I've analysed your document. Ask me anything!`:`Hi! 👋 I've analysed your document. Ask me anything!`;
    box.innerHTML=`<div class="bubble-row bot"><div class="bav"><div class="bav-owl">${owlHtml}</div></div><div class="bubble">${_gr}</div></div>`;
  }
  go('qa'); showToast('✨ New chat started!');
}

function filterChats(query){
  const grid=document.getElementById('chatsGrid');
  if(!grid) return;
  grid.innerHTML='';
  const q=query.toLowerCase().trim();
  const filtered=q?chatSessions.filter(s=>s.title.toLowerCase().includes(q)):[...chatSessions];
  if(!filtered.length){grid.innerHTML='<div class="chats-no-results"><i class="fas fa-magnifying-glass" style="margin-right:8px;opacity:.5"></i>No chats found.</div>';return;}
  filtered.forEach(s=>_renderChatCard(grid,s));
}

// ═══════════════════════════════════════════════
//  AUTO-QUESTIONS
// ═══════════════════════════════════════════════
const AQ_BANK=[
  ['What are the main topics covered?','Can you explain the key concepts simply?','What is the most important takeaway?','Are there any definitions I should know?','How does this connect to real life?'],
  ['What are the differences between the main concepts?','Can you summarise the structure?','What questions might appear in an exam?','Which section is most important?','Give me an example for each key concept.'],
  ['What are the causes and effects described?','How would you explain this to a beginner?','What are the most challenging concepts?','What are the pros and cons mentioned?','Highlight the most critical points.'],
];

function _showAutoQuestions(){
  const panel=document.getElementById('autoQs');
  const list=document.getElementById('aqList');
  if(!panel||!list) return;
  const bank=AQ_BANK[Math.floor(Math.random()*AQ_BANK.length)];
  list.innerHTML='';
  bank.forEach(q=>{
    const btn=document.createElement('button');
    btn.className='aq-item';
    btn.innerHTML=`<i class="fas fa-chevron-right"></i>${q}`;
    btn.onclick=()=>{ startNewChat(); setTimeout(()=>{ const inp=document.getElementById('chatInp'); if(inp){inp.value=q;inp.focus();autoResize(inp);} },200); };
    list.appendChild(btn);
  });
  panel.style.display='block';
}
