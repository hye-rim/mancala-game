'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (arcade/public/tutorial.js 가 듣는다. 튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 만칼라: 화면·입력·소리·온라인. 규칙과 컴퓨터는 logic.js (LOGIC_MANCALA), 방·매칭은 server.js
(() => {
const L = LOGIC_MANCALA;
const $ = (id) => document.getElementById(id);
const T = { cpu: 700, step: 150, over: 900, banner: 1100 };         // 시간(ms). 시험용으로 줄일 수 있다
const SIDE_NAME = ['아래(노랑)', '위(분홍)'];
const SEED_COLORS = ['#ffd23f', '#ff5fa2', '#4fd1c5', '#8a4fe0', '#ff7a45', '#7bd34f'];

// ---------- 저장소 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
let wins = Number(store.get('mancalaWins')) || 0;
const ONLINE_KEY = 'mancalaOnline', SESSION_KEY = 'mancalaSession';
const loadJson = (k) => { try { return JSON.parse(store.get(k)) || {}; } catch (_) { return {}; } };
function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (_) { return null; } }
function saveSession(s) { try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch (_) {} }
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const myName = () => store.get('mancalaName') || '';

// ---------- 소리 ----------
let audio = null;
let muted = store.get('mancalaMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.09, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type = 'triangle', vol = 0.09) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.0009, type, vol), i * step));
const sfx = {
  drop: (k) => tone(300 + k * 22, 0.05, 'triangle', 0.07),
  store: () => seq([660, 880], 70, 'triangle', 0.08),
  extra: () => seq([523, 659, 784], 80, 'triangle', 0.09),
  capture: () => seq([300, 220, 160], 90, 'square', 0.07),
  bad: () => tone(150, 0.1, 'square', 0.05),
  found: () => seq([392, 523], 90, 'triangle', 0.08),
  win: () => seq([523, 659, 784, 1047], 110, 'triangle', 0.1),
  lose: () => seq([392, 330, 262, 196], 150, 'sawtooth', 0.06),
  draw: () => seq([440, 440], 130, 'triangle', 0.07),
};
function toggleMute() { muted = !muted; store.set('mancalaMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 상태 ----------
let mode = 'easy';                  // 'easy' · 'hard' (컴퓨터) · 'online'
let phase = 'title';                // title · play · over
let st = null;                      // 컴퓨터 대전 판
let cpuYou = 0;                     // 컴퓨터 대전에서 내 자리 (0 아래·먼저, 1 위). 다시 하면 서로 바뀐다
let room = null, netDown = false, waitingNet = false, turnEnd = 0, recorded = '', seenMove = 0, pendingRoom = null;
let cpuTimer = 0, overTimer = 0, thinking = false, bannerTimer = 0;
let shown = null;                   // 지금 화면에 보이는 판 (애니메이션 중에는 실제 판과 다르다)
let animating = false, popIdx = -1, lastIdx = -1, capIdx = [];
const online = () => mode === 'online';

// 화면이 쓰는 모양으로: { v: { board, turn, legal }, you, state, winner, reason, names }
function model() {
  if (online()) {
    if (!room) return null;
    return { v: { board: room.board, turn: room.turn, legal: room.legal || [] }, you: room.you, state: room.state, winner: room.winner, reason: room.reason,
      names: [0, 1].map((c) => (c === room.you ? '나' : ((room.players.find((p) => p.color === c) || {}).name || '상대'))) };
  }
  if (!st) return null;
  const mine = st.turn === cpuYou && !st.over;
  return { v: { board: st.board, turn: st.turn, legal: mine ? L.legalPits(st) : [] }, you: cpuYou, state: st.over ? 'over' : 'playing', winner: st.winner, reason: st.reason, names: cpuYou === 0 ? ['나', '컴퓨터'] : ['컴퓨터', '나'] };
}
const myTurn = (m) => !!m && m.state === 'playing' && m.v.turn === m.you && !netDown && !thinking && !animating;
const canAct = (m) => myTurn(m) && !waitingNet;

// ---------- 그리기 ----------
// 구덩이마다 콩 모양 자리: 콩이 몇 개든 같은 자리에 차례로 쌓인다
const SPOTS = [[50, 22], [30, 34], [70, 34], [50, 46], [26, 58], [74, 58], [50, 66], [34, 78], [66, 78], [50, 12], [18, 44], [82, 44], [50, 86], [38, 22], [62, 22]];
const rowTop = $('rowTop'), rowBottom = $('rowBottom');
const pitEls = {};                                   // 칸 번호 -> 구덩이 요소
let builtFor = -2;
function buildBoard(you) {
  if (builtFor === you) return;
  builtFor = you;
  rowTop.innerHTML = ''; rowBottom.innerHTML = ''; $('idxRow').innerHTML = '';
  for (let k = 0; k < 6; k++) {                      // 아래: 내 구덩이 (왼쪽 → 오른쪽)
    const i = L.pitIndex(you, k);
    const b = document.createElement('button');
    b.className = 'pit'; b.type = 'button'; b.dataset.i = i; b.dataset.k = k;
    rowBottom.appendChild(b); pitEls[i] = b;
    const t = document.createElement('span'); t.textContent = k + 1; $('idxRow').appendChild(t);
  }
  for (let k = 5; k >= 0; k--) {                     // 위: 상대 구덩이 (오른쪽부터 시작해서 왼쪽 방향으로 이어진다)
    const i = L.pitIndex(1 - you, k);
    const b = document.createElement('button');
    b.className = 'pit'; b.type = 'button'; b.dataset.i = i; b.disabled = true;
    rowTop.appendChild(b); pitEls[i] = b;
  }
}
function paintPit(el, n) {
  let html = '';
  for (let s = 0; s < Math.min(n, SPOTS.length); s++) html += `<i class="seed" style="left:${SPOTS[s][0]}%;top:${SPOTS[s][1]}%;background:${SEED_COLORS[s % SEED_COLORS.length]}"></i>`;
  el.innerHTML = `${html}<span class="n">${n}</span>`;
}

function render() {
  const m = model();
  if (!m) { renderHud(null); return; }
  buildBoard(m.you);
  const v = m.v, board = shown || v.board;
  const mine = canAct(m);
  const youStore = L.storeOf(m.you), oppStore = L.storeOf(1 - m.you);
  for (const i in pitEls) {
    const el = pitEls[i], n = board[i], idx = Number(i);
    if (el.dataset.n !== String(n)) { paintPit(el, n); el.dataset.n = n; }
    const k = el.dataset.k;
    el.classList.toggle('can', mine && k !== undefined && v.legal.includes(Number(k)));
    el.classList.toggle('pop', idx === popIdx);
    el.classList.toggle('last', idx === lastIdx);
    el.classList.toggle('cap', capIdx.includes(idx));
  }
  const putStore = (id, idx) => {
    const el = $(id);
    el.innerHTML = `<b>${board[idx]}</b><small>${idx === youStore ? '내 창고' : '상대 창고'}</small>`;
    el.classList.toggle('pop', idx === popIdx);
  };
  putStore('storeBottom', youStore); putStore('storeTop', oppStore);
  const opp = 1 - m.you;
  $('capTop').innerHTML = `<span class="who s${opp}">${esc(m.names[opp])}${m.state === 'playing' && v.turn === opp ? ' ▶' : ''}</span><span class="role">${SIDE_NAME[opp]}</span>`;
  $('capBottom').innerHTML = `<span class="who s${m.you}">${esc(m.names[m.you])}${m.state === 'playing' && v.turn === m.you ? ' ▶' : ''}</span><span class="role">${SIDE_NAME[m.you]}</span>`;
  renderHud(m);
}
function renderHud(m = model()) {
  $('wins').textContent = wins.toLocaleString('ko-KR');
  let text = '만칼라';
  if (m && phase === 'play' && m.state === 'playing') {
    const sec = Math.max(0, Math.ceil((turnEnd - performance.now()) / 1000));
    if (online() && netDown) text = '연결 다시 붙이는 중…';
    else if (m.v.turn === m.you) text = `내 차례${online() ? ` · ${sec}초` : ''}`;
    else text = online() ? `${m.names[m.v.turn]} 차례 · ${sec}초` : '컴퓨터 차례…';
  }
  $('turn').textContent = text;
  $('resignBtn').style.display = online() && room && room.state === 'playing' ? '' : 'none';
}
function say(t) { $('msg').textContent = t; }
function banner(text, color) {
  const b = $('banner');
  b.textContent = text; b.style.color = color || '#fff'; b.classList.add('show');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => b.classList.remove('show'), T.banner);
}

// ---------- 콩 뿌리기 ----------
// 한 수를 화면에서 보여 준다: 고른 구덩이를 비우고 콩을 하나씩 떨어뜨린 뒤, 가져오기·마무리를 반영한다. before = 두기 전 판, after = 둔 뒤 실제 판
function playMove(before, ev, after, done) {
  animating = true; capIdx = []; lastIdx = -1;
  shown = before.slice();
  shown[ev.from] = 0; popIdx = -1;
  render();
  ev.path.forEach((idx, k) => setTimeout(() => {
    shown[idx]++; popIdx = idx; sfx.drop(k % 14);
    render();
  }, (k + 1) * T.step));
  setTimeout(() => {
    popIdx = -1; lastIdx = ev.last;
    if (L.isStore(ev.last)) sfx.store();
    if (ev.capture) { capIdx = [ev.capture.pit, ev.capture.opp]; sfx.capture(); }
    shown = after.slice();
    animating = false;
    render();
    setTimeout(() => { capIdx = []; render(); }, 700);
    done();
  }, (ev.path.length + 1) * T.step + 60);
}
// 받침에 따라 바뀌는 조사 (이/가)
const iga = (w) => (/[가-힣]$/.test(w) ? (((w.charCodeAt(w.length - 1) - 0xAC00) % 28 === 0) ? '가' : '이') : '이(가)');
function announce(ev) {
  const m = model();
  if (!m) return;
  const mine = ev.who === m.you;
  const nm = mine ? '내가' : (online() ? `${m.names[ev.who]}${iga(m.names[ev.who])}` : '컴퓨터가');
  let t = `${nm} 콩 ${ev.path.length}개를 뿌렸어요`;
  if (ev.extra) { sfx.extra(); t += `\n창고에 들어갔어요! ${mine ? '한 번 더 둬요' : '한 번 더 둬요'}`; banner('한 번 더!', '#ffd23f'); }
  if (ev.capture) t += `\n맞은편 콩을 포함해 ${ev.capture.n}개를 ${mine ? '가져왔어요' : '가져갔어요'}!`;
  if (ev.swept) t += '\n한쪽 줄이 비어서 끝나요';
  say(t);
}

// ---------- 창 ----------
const overlayOpen = () => !$('overlay').classList.contains('hidden');
function showOverlay(html) { $('overlay').innerHTML = html; $('overlay').classList.remove('hidden'); }
function hideOverlay() { $('overlay').classList.add('hidden'); }

// ---------- 입력 ----------
$('rowBottom').addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.pit');
  if (!el) return;
  e.preventDefault();
  const m = model();
  if (!m || phase !== 'play') return;
  const k = Number(el.dataset.k);
  if (!canAct(m)) return;
  if (!m.v.legal.includes(k)) { sfx.bad(); say('콩이 없는 구덩이예요. 콩이 있는 내 구덩이를 눌러요'); return; }
  dispatch({ type: 'sow', pit: k });
});
addEventListener('keydown', (e) => { if (e.code === 'KeyM') toggleMute(); });

// 내 동작 하나를 낸다 (컴퓨터 판은 바로 적용, 온라인은 서버로)
function dispatch(a) {
  const m = model();
  if (!canAct(m)) return;
  if (online()) { waitingNet = true; net.send('act', { action: a }); render(); return; }
  const before = st.board.slice();
  const ev = L.apply(st, a);
  if (!ev) return;
  afterMove(before, ev, true);
}
function afterMove(before, ev, mine) {
  announce(ev);
  if (mine) tutorialSignal('sow');
  playMove(before, ev, st.board, () => {
    render();
    if (online()) return;
    if (st.over) { overTimer = setTimeout(showOver, T.over); return; }
    if (st.turn !== cpuYou) scheduleCpu();
  });
}

// ---------- 컴퓨터 대전 ----------
function startCpu(level, you = 0) {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = level; cpuYou = you; st = L.newGame(); phase = 'play'; thinking = false; animating = false; turnEnd = 0; shown = null; lastIdx = -1; capIdx = []; popIdx = -1;
  hideOverlay(); builtFor = -2; render();
  say(`내 구덩이는 아래 줄이에요. 구덩이를 눌러 콩을 뿌려요\n${you === 0 ? '내가 먼저 둬요' : '컴퓨터가 먼저 둬요'}`);
  if (you === 1) scheduleCpu();
}
function scheduleCpu() { thinking = true; render(); cpuTimer = setTimeout(cpuTurn, T.cpu); }
function cpuTurn() {
  if (phase !== 'play' || !st || online() || st.over || st.turn === cpuYou) { thinking = false; render(); return; }
  const a = L.aiPick(st, mode === 'hard' ? 'hard' : 'easy');
  thinking = false;
  const before = st.board.slice();
  const ev = a && L.apply(st, a);
  if (!ev) { render(); return; }
  afterMove(before, ev, false);
}
const reasonText = { empty: '한쪽 줄이 비어서 끝났어요', majority: '창고에 과반(25개)이 넘게 모았어요', limit: '수가 너무 길어져 끝났어요' };
function showOver() {
  phase = 'over';
  const youWon = st.winner === cpuYou, draw = st.winner === 2;
  if (youWon) { wins++; store.set('mancalaWins', String(wins)); sfx.win(); } else if (draw) sfx.draw(); else sfx.lose();
  const mine = st.board[L.storeOf(cpuYou)], theirs = st.board[L.storeOf(1 - cpuYou)];
  const next = 1 - cpuYou;
  showOverlay(`
    <h2>${draw ? '비겼어요! 🤝' : youWon ? '이겼어요! 🎉' : '아쉬워요! 😵'}</h2>
    <p>${esc(reasonText[st.reason] || '')}</p>
    <dl class="stats card2"><dt>내 창고</dt><dd>${mine}개</dd><dt>컴퓨터 창고</dt><dd>${theirs}개</dd><dt>둔 수</dt><dd>${st.plies}</dd></dl>
    <p>컴퓨터 상대 승리 <b>${wins}</b>번</p>
    <div class="col"><button data-act="again">다시 하기<small>이번엔 ${next === 0 ? '내가 먼저' : '컴퓨터가 먼저'} 둬요</small></button><button class="sub" data-act="view">판 보기</button><button class="sub" data-act="home">처음으로</button></div>`);
  render();
}
function showTitle() {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = 'easy'; phase = 'title'; st = L.newGame(); cpuYou = 0; thinking = false; animating = false; shown = null; lastIdx = -1; capIdx = []; popIdx = -1;
  builtFor = -2; say(''); render();
  const on = loadJson(ONLINE_KEY);
  showOverlay(`
    <h1>만칼라</h1>
    <p>콩을 <b>뿌려서</b> 내 창고에 더 많이 모으면 이겨요!</p>
    <div class="card2" style="font-size:13px">구덩이의 콩을 모두 집어 한 칸씩 <b>오른쪽으로</b> 뿌려요<br>마지막 콩이 <b>내 창고</b>에 들어가면 <b>한 번 더</b>!<br>내 쪽 빈 구덩이에 떨어지면 맞은편 콩을 <b>가져와요</b></div>
    <div class="col"><button data-act="cpu" data-lv="easy">🤖 컴퓨터랑 · 쉬움</button><button class="sub" data-act="cpu" data-lv="hard">🤖 컴퓨터랑 · 어려움</button><button class="sub" data-act="online">🌐 온라인 대전${on.w || on.l ? ` · ${on.w || 0}승 ${on.l || 0}패` : ''}</button></div>`);
}

// ---------- 온라인: 연결 ----------
const net = {
  ws: null, pulse: null, outbox: [], retry: 0,
  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}${location.pathname}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.raw('hello', { name: myName() });
      const s = loadSession();
      if (s) this.raw('resume', s);
      for (const [t, p] of this.outbox.splice(0)) this.raw(t, p);
      clearInterval(this.pulse);
      this.pulse = setInterval(() => this.raw('pulse'), 10000);
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onNet(m); };
    ws.onclose = () => {
      clearInterval(this.pulse);
      if (this.ws !== ws) return;
      this.ws = null;
      if (!online()) return;
      if (room || loadSession()) {
        netDown = true; waitingNet = false; render();
        setTimeout(() => { if (online()) this.connect(); }, Math.min(4000, 500 * 2 ** this.retry++));
      } else showOnline('서버와 연결이 끊겼어요. 다시 시도해 주세요.');
    };
  },
  send(t, p = {}) {
    if (this.ws && this.ws.readyState === 1) this.raw(t, p);
    else { this.outbox.push([t, p]); this.connect(); }
  },
  raw(t, p = {}) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t, ...p })); },
  close() {
    const ws = this.ws;
    this.ws = null; this.outbox = [];
    clearInterval(this.pulse);
    if (ws) ws.close();
  },
};

function onNet(m) {
  if (m.t === 'queued') showQueued();
  else if (m.t === 'room') { if (animating) pendingRoom = m; else applyRoom(m); }
  else if (m.t === 'rejected') { waitingNet = false; render(); }
  else if (m.t === 'error') { room = null; saveSession(null); showOnline(m.msg); }
  else if (m.t === 'resumeFailed') {
    saveSession(null);
    if (room) { room = null; showOnline('대국이 끝나서 이어갈 수 없어요.'); }
    netDown = false; render();
  }
}

function leaveOnline() {
  if (!online()) return;
  net.send('leave'); net.close();
  saveSession(null);
  room = null; netDown = false; waitingNet = false; mode = 'easy'; phase = 'title'; shown = null; animating = false; pendingRoom = null;
}

// ---------- 온라인: 대국 ----------
function applyRoom(r) {
  const prev = room;
  const fresh = !prev || prev.code !== r.code;
  const newGame = fresh || prev.games !== r.games;
  const before = shown || (prev ? prev.board.slice() : null);
  room = r;
  netDown = false; waitingNet = false;
  saveSession({ code: r.code, token: r.token });
  turnEnd = performance.now() + r.remain;
  if (newGame) { seenMove = r.lastMove ? r.lastMove.seq : 0; shown = null; lastIdx = -1; capIdx = []; say(''); builtFor = -2; }
  if (r.state === 'waiting') { phase = 'title'; showWaiting(); render(); return; }
  phase = r.state === 'playing' ? 'play' : 'over';
  if (newGame && r.state === 'playing') { sfx.found(); say(`내 구덩이는 아래 줄이에요 (${SIDE_NAME[r.you]})\n${r.turn === r.you ? '내가 먼저 둬요' : '상대가 먼저 둬요'}`); }
  if (!($('overlay').dataset.screen === 'confirm') && r.state !== 'over') hideOverlay();
  const lm = r.lastMove;
  const fin = () => { pendingRoomCheck(); render(); if (r.state === 'over') afterOver(); };
  if (lm && lm.seq > seenMove && !newGame && before) {
    seenMove = lm.seq;
    announce(Object.assign({}, lm));
    if (lm.who === r.you) tutorialSignal('sow');
    playMove(before, lm, r.board, fin);
  } else { shown = null; fin(); }
}
function pendingRoomCheck() {
  if (pendingRoom) { const p = pendingRoom; pendingRoom = null; setTimeout(() => applyRoom(p), 0); }
}
function afterOver() {
  const r = room;
  const key = `${r.code}:${r.games}:${r.reason}:${r.winner}`;
  if (recorded !== key) {
    recorded = key;
    const rec = loadJson(ONLINE_KEY);
    if (r.winner === r.you) { rec.w = (rec.w || 0) + 1; sfx.win(); } else if (r.winner === 2) sfx.draw(); else { rec.l = (rec.l || 0) + 1; sfx.lose(); }
    store.set(ONLINE_KEY, JSON.stringify(rec));
    setTimeout(() => { if (room && room.state === 'over') showResult(); }, T.over);
  } else if (overlayOpen()) showResult();
}

function showResult() {
  const r = room;
  const won = r.winner === r.you, draw = r.winner === 2;
  const why = Object.assign({}, reasonText, {
    resign: won ? '상대가 기권했어요' : '기권했어요',
    timeout: won ? '상대가 시간을 넘겼어요' : '시간을 넘겼어요',
    left: won ? '상대가 나갔어요' : '연결이 끊겨 패배했어요',
  })[r.reason] || '';
  const rec = loadJson(ONLINE_KEY);
  const opp = r.players.find((p) => p.color !== r.you);
  const iVoted = r.rematch.includes(r.you), theyVoted = opp && r.rematch.includes(opp.color);
  let again;
  if (!opp) again = '<p>상대가 방을 나갔어요</p>';
  else if (iVoted) again = '<p>상대를 기다리는 중…</p>';
  else again = `${theyVoted ? '<p>상대가 한 판 더 하고 싶어해요!</p>' : ''}<button data-act="rematch">한 판 더</button>`;
  showOverlay(`
    <h2>${draw ? '🤝 무승부' : won ? '🎉 승리!' : '😵 패배'}</h2>
    ${why ? `<p>${esc(why)}</p>` : ''}
    <p>내 창고 ${r.board[L.storeOf(r.you)]}개 · 상대 창고 ${r.board[L.storeOf(1 - r.you)]}개</p>
    <span class="tag">온라인 ${rec.w || 0}승 ${rec.l || 0}패</span>
    <div class="col">${again}
      <div class="row"><button class="sub" data-act="view">판 보기</button><button class="sub" data-act="leave">나가기</button></div>
    </div>`);
}

function showOnline(error = '') {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = 'online'; phase = 'title'; room = null; st = L.newGame(); waitingNet = false; thinking = false; shown = null; builtFor = -2; animating = false;
  say(''); render();
  showOverlay(`
    <h2>🌐 온라인 대전</h2>
    <input id="nameInput" maxlength="10" placeholder="내 이름 (최대 10자)" value="${esc(myName())}" autocomplete="off">
    <div class="col">
      <button data-act="quick">⚡ 빠른 대전</button>
      <button class="sub" data-act="create">방 만들기</button>
      <div class="row join"><input id="codeInput" maxlength="4" placeholder="방 코드" autocomplete="off" autocapitalize="characters"><button class="sub" data-act="join">들어가기</button></div>
    </div>
    <span class="error">${esc(error)}</span>
    <button class="back" data-act="home">← 처음으로</button>
    <p style="font-size:12.5px">한 번 둘 때마다 45초 · 먼저 하는 쪽은 한 판마다 바뀌어요</p>`);
}
function showQueued() {
  showOverlay(`
    <h2>상대를 찾는 중…</h2>
    <div class="dots"><span></span><span></span><span></span></div>
    <p>누군가 빠른 대전을 누르면 바로 시작해요</p>
    <button class="sub" data-act="cancel">취소</button>`);
}
const inviteUrl = () => `${location.origin}${location.pathname}?room=${room.code}`;
function showWaiting() {
  showOverlay(`
    <h2>친구를 기다리는 중…</h2>
    <p>방 코드</p>
    <div class="code">${esc(room.code)}</div>
    <p>친구가 <b>온라인 대전 → 들어가기</b>에<br>이 코드를 넣으면 시작해요</p>
    <button data-act="copy">🔗 초대 링크 복사</button>
    <button class="sub" data-act="cancel">취소</button>`);
}
function saveName() {
  const input = $('nameInput');
  if (!input) return;
  const name = input.value.trim().slice(0, 10);
  store.set('mancalaName', name);
  net.send('hello', { name });
}
function confirmResign() {
  showOverlay(`<h2>기권할까요?</h2><p>이번 판은 패배로 기록돼요</p>
    <div class="row"><button data-act="close">계속하기</button><button class="sub" data-act="resign">🏳 기권</button></div>`);
  $('overlay').dataset.screen = 'confirm';
}

let lastCpu = 'easy';
$('overlay').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  btn.blur();
  $('overlay').dataset.screen = '';
  const act = btn.dataset.act;
  if (act === 'cpu') { lastCpu = btn.dataset.lv; startCpu(lastCpu, 0); }
  else if (act === 'again') startCpu(lastCpu, 1 - cpuYou);
  else if (act === 'home') showTitle();
  else if (act === 'online') showOnline();
  else if (act === 'quick') { saveName(); net.send('quick'); }
  else if (act === 'create') { saveName(); net.send('create'); }
  else if (act === 'join') {
    const code = ($('codeInput').value || '').trim().toUpperCase();
    if (code.length !== 4) { $('overlay').querySelector('.error').textContent = '방 코드 4자리를 넣어 주세요.'; return; }
    saveName();
    net.send('join', { code });
  } else if (act === 'cancel') { net.send('cancel'); showOnline(); }
  else if (act === 'copy') {
    const url = inviteUrl();
    const done = () => { btn.textContent = '✅ 복사했어요'; setTimeout(() => { btn.textContent = '🔗 초대 링크 복사'; }, 1500); };
    if (navigator.share && matchMedia('(pointer: coarse)').matches) navigator.share({ title: '만칼라 한 판 해요!', url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('링크를 복사하세요', url));
    else prompt('링크를 복사하세요', url);
  } else if (act === 'rematch') { net.send('rematch'); }
  else if (act === 'view') hideOverlay();
  else if (act === 'leave') showOnline();
  else if (act === 'resign') { net.send('resign'); hideOverlay(); }
  else if (act === 'close') hideOverlay();
});
$('overlay').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'codeInput') $('overlay').querySelector('[data-act="join"]').click();
  if (e.target.id === 'nameInput') $('overlay').querySelector('[data-act="quick"]').click();
  e.stopPropagation();
});
$('resignBtn').onclick = (e) => { e.currentTarget.blur(); if (online() && room && room.state === 'playing') confirmResign(); };
setInterval(() => { if (online() && room && room.state === 'playing' && !netDown) renderHud(); }, 500);

// ---------- 시작 ----------
const invite = new URLSearchParams(location.search).get('room');
if (invite) { try { window.history.replaceState(null, '', location.pathname); } catch (_) {} }
function joinInvite(code) { showOnline(); net.send('join', { code: code.toUpperCase() }); }
if (loadSession()) {
  mode = 'online';
  st = L.newGame(); render();
  showOverlay('<h2>대국으로 돌아가는 중…</h2>');
  net.connect();
  const until = setInterval(() => {
    if (room || !loadSession()) { clearInterval(until); if (!room) invite ? joinInvite(invite) : showOnline(); }
  }, 100);
} else if (invite) joinInvite(invite);
else showTitle();

/* @test-hooks:start */
window.__mc = { get st() { return st; }, get mode() { return mode; }, get phase() { return phase; }, get room() { return room; }, get thinking() { return thinking; }, get animating() { return animating; }, T, dispatch, startCpu, render, model, L };
/* @test-hooks:end */
})();
