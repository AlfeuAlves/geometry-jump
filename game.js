// ============================================================
//  GEOMETRY JUMP — game.js
// ============================================================

// ---------- Canvas setup ----------
const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');
canvas.width  = 900;
canvas.height = 462;

// ---------- Constants ----------
const GRAVITY    = 0.55;
const JUMP_FORCE = -13.5;
const SPEED_BASE = 5;
const GROUND_Y   = canvas.height - 60;   // top of the ground platform
const PLAYER_SIZE= 36;

// ---------- State ----------
let state = 'menu';   // menu | levelSelect | playing | dead | win
let currentLevel = 1;
let attempts = 1;
let lives = 3;
const MAX_LIVES = 3;
let gameLoop  = null;
let stars = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

// ============================================================
//  SUPABASE CONFIG
// ============================================================
const SUPABASE_URL = 'https://mybnztjirkqqmniudusp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_3IyAAwk5-XQ6MTYNyi9Sfg_0cSbv9S3';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
//  USER / RANKING SYSTEM
// ============================================================
let currentUser   = null;
let currentUserId = null;

async function registerUser(username, password) {
  if (!username || username.length < 2) return 'Nome deve ter ao menos 2 caracteres.';
  if (!password || password.length < 3)  return 'Senha deve ter ao menos 3 caracteres.';
  const { error } = await db.from('users').insert({ username, password });
  if (error) {
    console.error('Supabase register error:', error);
    if (error.code === '23505') return 'Esse nome já está em uso.';
    return `Erro: ${error.message}`;
  }
  return null;
}

async function loginUser(username, password) {
  if (!username) return 'Digite seu nome.';
  if (!password) return 'Digite sua senha.';
  const { data, error } = await db.from('users').select('id, password').eq('username', username).single();
  if (error || !data) return 'Usuário não encontrado.';
  if (data.password !== password) return 'Senha incorreta.';
  currentUserId = data.id;
  return null;
}

async function saveUserScore(level, newStars, totalAttempts) {
  if (!currentUserId) return;
  const { data: existing } = await db.from('scores')
    .select('stars, attempts').eq('user_id', currentUserId).eq('level', level).single();
  if (!existing) {
    await db.from('scores').insert({ user_id: currentUserId, username: currentUser, level, stars: newStars, attempts: totalAttempts });
  } else {
    const better = newStars > existing.stars || (newStars === existing.stars && totalAttempts < existing.attempts);
    if (better) {
      await db.from('scores').update({
        stars: Math.max(newStars, existing.stars),
        attempts: newStars > existing.stars ? totalAttempts : Math.min(existing.attempts, totalAttempts),
        updated_at: new Date().toISOString(),
      }).eq('user_id', currentUserId).eq('level', level);
    }
  }
}

async function loadUserStars() {
  if (!currentUserId) return;
  stars = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const { data } = await db.from('scores').select('level, stars').eq('user_id', currentUserId);
  if (data) data.forEach(row => { stars[row.level] = row.stars; });
}

async function buildRanking() {
  const { data, error } = await db.from('scores').select('username, stars, attempts');
  if (error || !data) return [];
  const map = {};
  data.forEach(row => {
    if (!map[row.username]) map[row.username] = { name: row.username, totalStars: 0, levelsCleared: 0, totalAttempts: 0 };
    map[row.username].totalStars    += row.stars    || 0;
    map[row.username].totalAttempts += row.attempts || 0;
    if ((row.stars || 0) > 0) map[row.username].levelsCleared++;
  });
  return Object.values(map).sort((a, b) => b.totalStars - a.totalStars || a.totalAttempts - b.totalAttempts);
}

// ---------- Player ----------
const player = {
  x: 80,
  y: GROUND_Y - PLAYER_SIZE,
  vy: 0,
  onGround: false,
  jumpsLeft: 2,       // double jump
  rotation: 0,
  trail: [],
  invincible: false,
  invincibleTimer: 0,   // frames remaining
};
const INVINCIBLE_FRAMES = 300;  // 5s × 60fps

// ---------- Camera ----------
let camX = 0;
let levelProgress = 0;

// ---------- Particles ----------
let particles = [];

// ---------- Background stars (decorative) ----------
let bgStars = [];
function genBgStars() {
  bgStars = [];
  for (let i = 0; i < 80; i++) {
    bgStars.push({
      x: Math.random() * 3000,
      y: Math.random() * GROUND_Y,
      r: Math.random() * 1.5 + 0.3,
      spd: Math.random() * 0.3 + 0.1,
      alpha: Math.random() * 0.5 + 0.2,
    });
  }
}
genBgStars();

// ============================================================
//  LEVEL DEFINITIONS
// ============================================================
/*
  Obstacle types:
    spike  — triangle pointing up, instant kill
    block  — solid square, land on top or die on side
    gap    — gap in the ground (defined by removing ground segments)
    portal — changes speed (visual only for now)
    platform — floating platform, can jump on
    ceiling — ceiling segment that kills if you touch it
    sawblade — spinning circle, instant kill
    doubleSpike — two spikes side by side
    tallBlock — tall block (2x height)
*/

function buildLevel(defs) {
  return defs;
}

const LEVELS = {
  1: buildLevel([
    // Format: { type, x, [extra props] }
    // Ground runs from 0 to levelEnd implicitly
    { type: 'powerstar',    x: 580,  y: GROUND_Y - 115 },
    { type: 'spike',        x: 400 },
    { type: 'spike',        x: 500 },
    { type: 'spike',        x: 502 },
    { type: 'gap',          x: 650,  w: 80 },
    { type: 'spike',        x: 820 },
    { type: 'block',        x: 950,  w: 40, h: 40 },
    { type: 'spike',        x: 1050 },
    { type: 'spike',        x: 1100 },
    { type: 'gap',          x: 1230, w: 100 },
    { type: 'spike',        x: 1420 },
    { type: 'spike',        x: 1422 },
    { type: 'spike',        x: 1424 },
    { type: 'block',        x: 1600, w: 40, h: 70 },
    { type: 'spike',        x: 1720 },
    { type: 'gap',          x: 1850, w: 120 },
    { type: 'spike',        x: 2050 },
    { type: 'spike',        x: 2052 },
    { type: 'finish',       x: 2200 },
  ]),

  2: buildLevel([
    { type: 'spike',        x: 350 },
    { type: 'spike',        x: 352 },
    { type: 'gap',          x: 500,  w: 100 },
    { type: 'block',        x: 680,  w: 40, h: 50 },
    { type: 'spike',        x: 780 },
    { type: 'ceiling',      x: 880,  w: 200, y: 80 },
    { type: 'spike',        x: 900 },
    { type: 'gap',          x: 1100, w: 120 },
    { type: 'sawblade',     x: 1300, y: GROUND_Y - 30 },
    { type: 'spike',        x: 1420 },
    { type: 'spike',        x: 1422 },
    { type: 'spike',        x: 1424 },
    { type: 'platform',     x: 1550, y: GROUND_Y - 120, w: 100 },
    { type: 'gap',          x: 1550, w: 150 },
    { type: 'sawblade',     x: 1750, y: GROUND_Y - 30 },
    { type: 'block',        x: 1900, w: 40, h: 80 },
    { type: 'spike',        x: 2000 },
    { type: 'gap',          x: 2100, w: 130 },
    { type: 'spike',        x: 2320 },
    { type: 'spike',        x: 2322 },
    { type: 'sawblade',     x: 2480, y: GROUND_Y - 30 },
    { type: 'finish',       x: 2650 },
  ]),

  3: buildLevel([
    { type: 'spike',        x: 280 },
    { type: 'spike',        x: 282 },
    { type: 'spike',        x: 284 },
    { type: 'gap',          x: 400,  w: 100 },
    { type: 'sawblade',     x: 580,  y: GROUND_Y - 30 },
    { type: 'ceiling',      x: 650,  w: 180, y: 60 },
    { type: 'block',        x: 700,  w: 40, h: 60 },
    { type: 'spike',        x: 820 },
    { type: 'spike',        x: 822 },
    { type: 'gap',          x: 930,  w: 130 },
    { type: 'sawblade',     x: 1150, y: GROUND_Y - 30 },
    { type: 'spike',        x: 1250 },
    { type: 'spike',        x: 1252 },
    { type: 'spike',        x: 1254 },
    { type: 'platform',     x: 1380, y: GROUND_Y - 140, w: 80 },
    { type: 'gap',          x: 1380, w: 160 },
    { type: 'ceiling',      x: 1600, w: 200, y: 70 },
    { type: 'sawblade',     x: 1650, y: GROUND_Y - 30 },
    { type: 'spike',        x: 1820 },
    { type: 'spike',        x: 1822 },
    { type: 'spike',        x: 1824 },
    { type: 'gap',          x: 1960, w: 150 },
    { type: 'block',        x: 2180, w: 40, h: 90 },
    { type: 'sawblade',     x: 2300, y: GROUND_Y - 30 },
    { type: 'spike',        x: 2430 },
    { type: 'spike',        x: 2432 },
    { type: 'gap',          x: 2550, w: 140 },
    { type: 'sawblade',     x: 2780, y: GROUND_Y - 30 },
    { type: 'spike',        x: 2880 },
    { type: 'spike',        x: 2882 },
    { type: 'spike',        x: 2884 },
    { type: 'finish',       x: 3050 },
  ]),

  // ── NÍVEL 4 — EXTREMO ──────────────────────────────────────
  4: buildLevel([
    { type: 'spike',    x: 250 },
    { type: 'spike',    x: 252 },
    { type: 'spike',    x: 254 },
    { type: 'spike',    x: 256 },
    { type: 'gap',      x: 370,  w: 90 },
    { type: 'sawblade', x: 530,  y: GROUND_Y - 30 },
    { type: 'sawblade', x: 590,  y: GROUND_Y - 30 },
    { type: 'ceiling',  x: 650,  w: 220, y: 55 },
    { type: 'spike',    x: 680 },
    { type: 'spike',    x: 682 },
    { type: 'gap',      x: 800,  w: 110 },
    { type: 'block',    x: 980,  w: 40,  h: 80 },
    { type: 'spike',    x: 1080 },
    { type: 'spike',    x: 1082 },
    { type: 'spike',    x: 1084 },
    { type: 'sawblade', x: 1200, y: GROUND_Y - 30 },
    { type: 'ceiling',  x: 1250, w: 180, y: 60 },
    { type: 'gap',      x: 1500, w: 120 },
    { type: 'spike',    x: 1700 },
    { type: 'spike',    x: 1702 },
    { type: 'spike',    x: 1704 },
    { type: 'spike',    x: 1706 },
    { type: 'sawblade', x: 1850, y: GROUND_Y - 30 },
    { type: 'sawblade', x: 1910, y: GROUND_Y - 30 },
    { type: 'block',    x: 2050, w: 40,  h: 100 },
    { type: 'gap',      x: 2160, w: 130 },
    { type: 'ceiling',  x: 2350, w: 200, y: 50 },
    { type: 'spike',    x: 2360 },
    { type: 'spike',    x: 2362 },
    { type: 'sawblade', x: 2620, y: GROUND_Y - 30 },
    { type: 'gap',      x: 2750, w: 140 },
    { type: 'spike',    x: 2970 },
    { type: 'spike',    x: 2972 },
    { type: 'spike',    x: 2974 },
    { type: 'spike',    x: 2976 },
    { type: 'finish',   x: 3200 },
  ]),

  // ── NÍVEL 5 — INSANO ───────────────────────────────────────
  5: buildLevel([
    { type: 'spike',    x: 200 },
    { type: 'spike',    x: 202 },
    { type: 'spike',    x: 204 },
    { type: 'spike',    x: 206 },
    { type: 'spike',    x: 208 },
    { type: 'gap',      x: 320,  w: 100 },
    { type: 'sawblade', x: 490,  y: GROUND_Y - 30 },
    { type: 'sawblade', x: 550,  y: GROUND_Y - 30 },
    { type: 'sawblade', x: 610,  y: GROUND_Y - 30 },
    { type: 'ceiling',  x: 700,  w: 260, y: 50 },
    { type: 'spike',    x: 720 },
    { type: 'spike',    x: 722 },
    { type: 'spike',    x: 724 },
    { type: 'gap',      x: 850,  w: 120 },
    { type: 'block',    x: 1040, w: 40,  h: 90 },
    { type: 'spike',    x: 1140 },
    { type: 'spike',    x: 1142 },
    { type: 'spike',    x: 1144 },
    { type: 'spike',    x: 1146 },
    { type: 'sawblade', x: 1280, y: GROUND_Y - 30 },
    { type: 'sawblade', x: 1340, y: GROUND_Y - 30 },
    { type: 'ceiling',  x: 1420, w: 240, y: 48 },
    { type: 'spike',    x: 1440 },
    { type: 'spike',    x: 1442 },
    { type: 'gap',      x: 1600, w: 130 },
    { type: 'sawblade', x: 1800, y: GROUND_Y - 30 },
    { type: 'block',    x: 1960, w: 40,  h: 110 },
    { type: 'spike',    x: 2060 },
    { type: 'spike',    x: 2062 },
    { type: 'spike',    x: 2064 },
    { type: 'spike',    x: 2066 },
    { type: 'gap',      x: 2200, w: 140 },
    { type: 'ceiling',  x: 2400, w: 280, y: 45 },
    { type: 'sawblade', x: 2420, y: GROUND_Y - 30 },
    { type: 'sawblade', x: 2480, y: GROUND_Y - 30 },
    { type: 'spike',    x: 2650 },
    { type: 'spike',    x: 2652 },
    { type: 'spike',    x: 2654 },
    { type: 'gap',      x: 2800, w: 150 },
    { type: 'sawblade', x: 3020, y: GROUND_Y - 30 },
    { type: 'sawblade', x: 3080, y: GROUND_Y - 30 },
    { type: 'spike',    x: 3230 },
    { type: 'spike',    x: 3232 },
    { type: 'spike',    x: 3234 },
    { type: 'spike',    x: 3236 },
    { type: 'spike',    x: 3238 },
    { type: 'finish',   x: 3450 },
  ]),

  // ── NÍVEL 6 — 2.2 (LENDÁRIO) ──────────────────────────────
  6: buildLevel([
    { type: 'spike',    x: 160 },
    { type: 'spike',    x: 162 },
    { type: 'spike',    x: 164 },
    { type: 'spike',    x: 166 },
    { type: 'spike',    x: 168 },
    { type: 'gap',      x: 280,  w: 110 },
    { type: 'sawblade', x: 460,  y: GROUND_Y - 30 },
    { type: 'sawblade', x: 520,  y: GROUND_Y - 30 },
    { type: 'sawblade', x: 580,  y: GROUND_Y - 30 },
    { type: 'ceiling',  x: 650,  w: 280, y: 45 },
    { type: 'spike',    x: 660 },
    { type: 'spike',    x: 662 },
    { type: 'spike',    x: 664 },
    { type: 'spike',    x: 666 },
    { type: 'gap',      x: 800,  w: 130 },
    { type: 'block',    x: 1000, w: 40,  h: 100 },
    { type: 'sawblade', x: 1100, y: GROUND_Y - 30 },
    { type: 'spike',    x: 1200 },
    { type: 'spike',    x: 1202 },
    { type: 'spike',    x: 1204 },
    { type: 'spike',    x: 1206 },
    { type: 'spike',    x: 1208 },
    { type: 'ceiling',  x: 1300, w: 300, y: 42 },
    { type: 'sawblade', x: 1320, y: GROUND_Y - 30 },
    { type: 'sawblade', x: 1380, y: GROUND_Y - 30 },
    { type: 'sawblade', x: 1440, y: GROUND_Y - 30 },
    { type: 'gap',      x: 1600, w: 140 },
    { type: 'spike',    x: 1820 },
    { type: 'spike',    x: 1822 },
    { type: 'spike',    x: 1824 },
    { type: 'spike',    x: 1826 },
    { type: 'block',    x: 1980, w: 40,  h: 120 },
    { type: 'sawblade', x: 2080, y: GROUND_Y - 30 },
    { type: 'sawblade', x: 2140, y: GROUND_Y - 30 },
    { type: 'gap',      x: 2280, w: 150 },
    { type: 'ceiling',  x: 2490, w: 300, y: 40 },
    { type: 'spike',    x: 2510 },
    { type: 'spike',    x: 2512 },
    { type: 'spike',    x: 2514 },
    { type: 'sawblade', x: 2680, y: GROUND_Y - 30 },
    { type: 'sawblade', x: 2740, y: GROUND_Y - 30 },
    { type: 'sawblade', x: 2800, y: GROUND_Y - 30 },
    { type: 'gap',      x: 2950, w: 160 },
    { type: 'spike',    x: 3180 },
    { type: 'spike',    x: 3182 },
    { type: 'spike',    x: 3184 },
    { type: 'spike',    x: 3186 },
    { type: 'spike',    x: 3188 },
    { type: 'ceiling',  x: 3300, w: 260, y: 38 },
    { type: 'sawblade', x: 3320, y: GROUND_Y - 30 },
    { type: 'sawblade', x: 3380, y: GROUND_Y - 30 },
    { type: 'gap',      x: 3550, w: 160 },
    { type: 'spike',    x: 3790 },
    { type: 'spike',    x: 3792 },
    { type: 'spike',    x: 3794 },
    { type: 'spike',    x: 3796 },
    { type: 'spike',    x: 3798 },
    { type: 'spike',    x: 3800 },
    { type: 'finish',   x: 4000 },
  ]),
};

// ============================================================
//  COMPUTED OBSTACLES (runtime)
// ============================================================
let obstacles  = [];    // current level obstacles (processed)
let levelEnd   = 2400;
let sawAngle   = 0;

function loadLevel(num) {
  const defs = LEVELS[num];
  obstacles  = defs.map(d => ({ ...d }));
  const finish = defs.find(d => d.type === 'finish');
  levelEnd = finish ? finish.x + 200 : 2500;
  camX = 0;
  attempts = 1;
  resetPlayer();
  particles = [];
  sawAngle  = 0;
  updateHUD();
}

function resetPlayer() {
  player.x  = 80;
  player.y  = GROUND_Y - PLAYER_SIZE;
  player.vy = 0;
  player.onGround = false;
  player.jumpsLeft = 2;
  player.rotation  = 0;
  player.trail = [];
  player.invincible      = false;
  player.invincibleTimer = 0;
}

// ============================================================
//  INPUT
// ============================================================
const keys = {};
document.addEventListener('keydown', e => {
  if (e.code === 'ArrowUp' || e.code === 'Space') {
    if (!keys['jump']) {
      keys['jump'] = true;
      if (state === 'playing') tryJump();
      if (state === 'dead')    retryLevel();
    }
  }
  if (e.code === 'ArrowDown') keys['down'] = true;
  if (e.code === 'KeyR' && (state === 'playing' || state === 'dead' || state === 'win')) retryLevel();
  if (e.code === 'Escape' && (state === 'playing' || state === 'dead')) goMenu();
});
document.addEventListener('keyup', e => {
  if (e.code === 'ArrowUp' || e.code === 'Space') keys['jump'] = false;
  if (e.code === 'ArrowDown') keys['down'] = false;
});

function tryJump() {
  if (player.jumpsLeft > 0) {
    player.vy = JUMP_FORCE;
    player.jumpsLeft--;
    spawnJumpParticles();
  }
}

// ============================================================
//  PARTICLES
// ============================================================
function spawnJumpParticles() {
  const col = getPlayerColor();
  for (let i = 0; i < 8; i++) {
    particles.push({
      x: player.x + PLAYER_SIZE / 2,
      y: player.y + PLAYER_SIZE,
      vx: (Math.random() - 0.5) * 4,
      vy: Math.random() * 3 + 1,
      life: 1,
      decay: 0.06,
      r: Math.random() * 5 + 3,
      color: col,
    });
  }
}
function spawnDeathParticles() {
  for (let i = 0; i < 30; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd   = Math.random() * 8 + 2;
    particles.push({
      x: player.x + PLAYER_SIZE / 2,
      y: player.y + PLAYER_SIZE / 2,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      life: 1,
      decay: 0.03,
      r: Math.random() * 7 + 3,
      color: `hsl(${Math.random()*60 + 10}, 100%, 60%)`,
    });
  }
}
function spawnStarCollectParticles(sx, sy) {
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2;
    const spd   = Math.random() * 6 + 2;
    particles.push({
      x: sx, y: sy,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd - 2,
      life: 1, decay: 0.025,
      r: Math.random() * 6 + 3,
      color: `hsl(${Math.random() * 40 + 40}, 100%, 65%)`,
    });
  }
}
function updateParticles() {
  particles = particles.filter(p => p.life > 0);
  particles.forEach(p => {
    p.x    += p.vx;
    p.y    += p.vy;
    p.vy   += 0.15;
    p.life -= p.decay;
  });
}
function drawParticles() {
  particles.forEach(p => {
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x - camX, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

// ============================================================
//  LEVEL COLOR SCHEMES
// ============================================================
const SCHEMES = {
  1: {
    sky1: '#0a0a2e', sky2: '#1a1a4e',
    ground: '#1a3a5c', groundLine: '#00cfff',
    playerFill: '#00cfff', playerGlow: '#00cfff',
    obstacleSpike: '#ff2244', obstacleBlock: '#0077ff',
    sawFill: '#ff6600',
  },
  2: {
    sky1: '#1a0a00', sky2: '#3a1a00',
    ground: '#3a1a00', groundLine: '#ff6a00',
    playerFill: '#ff6a00', playerGlow: '#ff6a00',
    obstacleSpike: '#ff2244', obstacleBlock: '#cc5500',
    sawFill: '#ff2244',
  },
  3: {
    sky1: '#0a001a', sky2: '#1a0033',
    ground: '#220033', groundLine: '#cc00ff',
    playerFill: '#ff22cc', playerGlow: '#ff22cc',
    obstacleSpike: '#ff0055', obstacleBlock: '#7700ff',
    sawFill: '#ff0055',
  },
  4: {
    sky1: '#001a00', sky2: '#003300',
    ground: '#002200', groundLine: '#00ff66',
    playerFill: '#00ff66', playerGlow: '#00ff66',
    obstacleSpike: '#ff4400', obstacleBlock: '#005500',
    sawFill: '#ffcc00',
  },
  5: {
    sky1: '#1a1a00', sky2: '#332200',
    ground: '#2a1a00', groundLine: '#ffaa00',
    playerFill: '#ffaa00', playerGlow: '#ffaa00',
    obstacleSpike: '#ff2200', obstacleBlock: '#663300',
    sawFill: '#ff2200',
  },
  6: {
    sky1: '#000000', sky2: '#0a0a0a',
    ground: '#111111', groundLine: '#ffffff',
    playerFill: '#ffffff', playerGlow: '#aaaaff',
    obstacleSpike: '#ff0000', obstacleBlock: '#333333',
    sawFill: '#ff0000',
  },
};
function scheme() { return SCHEMES[currentLevel] || SCHEMES[1]; }
function getPlayerColor() { return scheme().playerFill; }

// ============================================================
//  DRAWING HELPERS
// ============================================================
function drawGlow(x, y, r, color, alpha = 0.4) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color.replace(')', `, ${alpha})`).replace('rgb', 'rgba').replace('#', 'rgba(').replace(/([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/, (_, r2, g2, b2) =>
    `${parseInt(r2,16)},${parseInt(g2,16)},${parseInt(b2,16)},`
  ));
  // simpler approach:
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawBackground() {
  const sc = scheme();
  const grad = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  grad.addColorStop(0, sc.sky1);
  grad.addColorStop(1, sc.sky2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // decorative bg stars
  bgStars.forEach(s => {
    const bx = ((s.x - camX * s.spd) % canvas.width + canvas.width) % canvas.width;
    ctx.globalAlpha = s.alpha;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(bx, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function drawGround() {
  const sc = scheme();
  const gaps = obstacles.filter(o => o.type === 'gap');

  // Build ground segments
  const segs = [];
  let curX = -200;
  const ends = levelEnd + 300;

  gaps.forEach(g => {
    segs.push({ start: curX, end: g.x });
    curX = g.x + g.w;
  });
  segs.push({ start: curX, end: ends });

  segs.forEach(seg => {
    const sx = seg.start - camX;
    const ex = seg.end   - camX;
    if (ex < 0 || sx > canvas.width) return;
    const w = ex - sx;

    // Ground fill
    ctx.fillStyle = sc.ground;
    ctx.fillRect(sx, GROUND_Y, w, canvas.height - GROUND_Y);

    // Top line glow
    ctx.strokeStyle = sc.groundLine;
    ctx.lineWidth = 2;
    ctx.shadowColor = sc.groundLine;
    ctx.shadowBlur  = 8;
    ctx.beginPath();
    ctx.moveTo(sx, GROUND_Y);
    ctx.lineTo(ex, GROUND_Y);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Grid lines inside ground
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let gx = Math.floor(seg.start / 40) * 40; gx < seg.end; gx += 40) {
      const gxScreen = gx - camX;
      ctx.beginPath();
      ctx.moveTo(gxScreen, GROUND_Y);
      ctx.lineTo(gxScreen, canvas.height);
      ctx.stroke();
    }
  });
}

function drawObstacles() {
  const sc = scheme();
  sawAngle += 0.05;

  obstacles.forEach(o => {
    const ox = o.x - camX;
    if (ox > canvas.width + 100 || ox < -200) return;

    if (o.type === 'spike' || o.type === 'doubleSpike') {
      const count = o.type === 'doubleSpike' ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const sx = ox + i * 20;
        drawSpike(sx, GROUND_Y, 20, 28, sc.obstacleSpike);
      }
    }

    if (o.type === 'block') {
      const bx = ox;
      const by = GROUND_Y - o.h;
      ctx.fillStyle = sc.obstacleBlock;
      ctx.shadowColor = sc.obstacleBlock;
      ctx.shadowBlur  = 10;
      ctx.fillRect(bx, by, o.w, o.h);
      ctx.shadowBlur = 0;
      // top glow line
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.4;
      ctx.strokeRect(bx, by, o.w, o.h);
      ctx.globalAlpha = 1;
    }

    if (o.type === 'ceiling') {
      const cy = o.y;
      ctx.fillStyle = sc.obstacleBlock;
      ctx.shadowColor = sc.obstacleSpike;
      ctx.shadowBlur  = 8;
      ctx.fillRect(ox, cy, o.w, 20);
      ctx.shadowBlur = 0;
      // spikes hanging down
      for (let si = 0; si < Math.floor(o.w / 20); si++) {
        drawSpike(ox + si * 20 + 10, cy + 20, 20, 28, sc.obstacleSpike, true);
      }
    }

    if (o.type === 'platform') {
      ctx.fillStyle = '#44aaff';
      ctx.shadowColor = '#44aaff';
      ctx.shadowBlur  = 10;
      ctx.fillRect(ox, o.y, o.w, 14);
      ctx.shadowBlur = 0;
    }

    if (o.type === 'sawblade') {
      const cy = o.y;
      const r  = 22;
      ctx.save();
      ctx.translate(ox + r, cy);
      ctx.rotate(sawAngle);
      drawSawblade(r, sc.sawFill);
      ctx.restore();
    }

    if (o.type === 'finish') {
      // Finish line
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 4;
      ctx.shadowColor = '#00ff88';
      ctx.shadowBlur  = 20;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.moveTo(ox, 0);
      ctx.lineTo(ox, canvas.height);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;

      // Label
      ctx.fillStyle = '#00ff88';
      ctx.font = 'bold 16px Orbitron, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('FIM', ox, 40);
    }

    if (o.type === 'powerstar' && !o.collected) {
      const pulse = 0.85 + Math.sin(Date.now() / 220) * 0.15;
      const cy = o.y + Math.sin(Date.now() / 400) * 6;  // hover
      ctx.save();
      ctx.translate(ox, cy);
      ctx.rotate(sawAngle * 0.4);
      ctx.scale(pulse, pulse);
      // outer glow
      ctx.shadowColor = '#ffee00';
      ctx.shadowBlur  = 22;
      drawStarShape(0, 0, 18, 8, '#ffee00', '#ff8800');
      ctx.shadowBlur = 0;
      ctx.restore();
      // "PODER" label
      ctx.save();
      ctx.globalAlpha = 0.7 + Math.sin(Date.now() / 300) * 0.3;
      ctx.fillStyle = '#ffee00';
      ctx.font = 'bold 10px Orbitron, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('PODER', ox, cy - 26);
      ctx.restore();
    }
  });
}

function drawStarShape(cx, cy, outerR, innerR, fillColor, strokeColor) {
  const points = 5;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  if (strokeColor) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawSpike(x, groundY, w, h, color, flipped = false) {
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur  = 8;
  ctx.beginPath();
  if (!flipped) {
    ctx.moveTo(x, groundY);
    ctx.lineTo(x + w / 2, groundY - h);
    ctx.lineTo(x + w, groundY);
  } else {
    ctx.moveTo(x, groundY);
    ctx.lineTo(x + w / 2, groundY + h);
    ctx.lineTo(x + w, groundY);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawSawblade(r, color) {
  const teeth = 8;
  ctx.strokeStyle = color;
  ctx.lineWidth   = 3;
  ctx.shadowColor = color;
  ctx.shadowBlur  = 15;
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const angle = (i / (teeth * 2)) * Math.PI * 2;
    const dist  = i % 2 === 0 ? r : r * 0.55;
    const px    = Math.cos(angle) * dist;
    const py    = Math.sin(angle) * dist;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawPlayer() {
  if (state === 'dead') return;
  const sc    = scheme();
  const cx    = player.x - camX + PLAYER_SIZE / 2;
  const cy    = player.y + PLAYER_SIZE / 2;
  const half  = PLAYER_SIZE / 2;

  const isInvinc = player.invincible;
  const invFlash = isInvinc && Math.floor(Date.now() / 100) % 2 === 0;
  const fillColor = isInvinc ? (invFlash ? '#ffee00' : '#fff87a') : sc.playerFill;
  const glowColor = isInvinc ? '#ffee00' : sc.playerGlow;

  // Trail
  player.trail.forEach((t, i) => {
    const alpha = (i / player.trail.length) * (isInvinc ? 0.6 : 0.4);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fillColor;
    ctx.fillRect(t.x - camX, t.y, PLAYER_SIZE * 0.85, PLAYER_SIZE * 0.85);
  });
  ctx.globalAlpha = 1;

  // Glow
  ctx.shadowColor = glowColor;
  ctx.shadowBlur  = isInvinc ? 35 : 20;

  // Player cube with rotation
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(player.rotation);

  ctx.fillStyle = fillColor;
  ctx.fillRect(-half, -half, PLAYER_SIZE, PLAYER_SIZE);

  // Inner decoration
  ctx.strokeStyle = isInvinc ? 'rgba(255,255,100,0.9)' : 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(-half + 4, -half + 4, PLAYER_SIZE - 8, PLAYER_SIZE - 8);

  // Star on player when invincible
  if (isInvinc) {
    ctx.shadowColor = '#ffee00';
    ctx.shadowBlur  = 10;
    drawStarShape(0, 0, 8, 3.5, '#ffee00', null);
  }

  ctx.restore();
  ctx.shadowBlur = 0;

  // Invincibility timer bar above player
  if (isInvinc) {
    const barW = 44;
    const barH = 5;
    const bx   = cx - barW / 2;
    const by   = player.y - 14;
    const pct  = player.invincibleTimer / INVINCIBLE_FRAMES;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(bx, by, barW, barH);
    ctx.fillStyle = pct > 0.4 ? '#ffee00' : '#ff8800';
    ctx.fillRect(bx, by, barW * pct, barH);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, barW, barH);
  }
}

// ============================================================
//  COLLISION
// ============================================================
function getGroundY(worldX) {
  // Returns the Y of the ground at worldX, or Infinity if over a gap
  const gaps = obstacles.filter(o => o.type === 'gap');
  for (const g of gaps) {
    if (worldX > g.x && worldX < g.x + g.w) return Infinity;
  }
  return GROUND_Y;
}

function checkCollision() {
  const px = player.x;
  const py = player.y;
  const ps = PLAYER_SIZE;
  const margin = 3;  // small margin for fairness

  for (const o of obstacles) {
    if (o.type === 'spike') {
      // Triangle collision — bounding box approach with margin
      const sx = o.x + margin;
      const sy = GROUND_Y - 28 + margin;
      const ex = o.x + 20 - margin;
      if (px + ps > sx && px < ex && py + ps > sy && py < GROUND_Y) {
        return true;
      }
    }

    if (o.type === 'block') {
      const bx = o.x;
      const by = GROUND_Y - o.h;
      // If landing on top — handled in physics. Collision from side = death
      if (px + ps > bx + margin && px < bx + o.w - margin) {
        if (py + ps > by + margin && py < GROUND_Y) {
          // Are we coming from the side (not landing from above)?
          if (py + ps - 1 > by + 4) {
            return true;
          }
        }
      }
    }

    if (o.type === 'ceiling') {
      const cx = o.x;
      const cy = o.y;
      const cw = o.w;
      if (px + ps > cx && px < cx + cw) {
        // Spikes hanging down
        if (py < cy + 20 + 28) {
          return true;
        }
      }
    }

    if (o.type === 'sawblade') {
      const sx = o.x + 22;
      const sy = o.y;
      const r  = 22;
      const dx = (px + ps / 2) - sx;
      const dy = (py + ps / 2) - sy;
      if (Math.sqrt(dx * dx + dy * dy) < r - 4) {
        return true;
      }
    }
  }
  return false;
}

// ============================================================
//  PHYSICS UPDATE
// ============================================================
function updatePhysics() {
  // Gravity
  player.vy += GRAVITY;
  player.y  += player.vy;

  // Trail
  player.trail.push({ x: player.x, y: player.y });
  if (player.trail.length > 8) player.trail.shift();

  // Rotation
  if (!player.onGround) {
    player.rotation += 0.07;
  } else {
    // Snap to nearest 90 degrees
    const snap = Math.round(player.rotation / (Math.PI / 2)) * (Math.PI / 2);
    player.rotation += (snap - player.rotation) * 0.25;
  }

  // Ground / platform collision
  player.onGround = false;
  const groundY = getGroundY(player.x + PLAYER_SIZE / 2);

  if (player.y + PLAYER_SIZE >= groundY) {
    if (groundY === Infinity) {
      // Fell into gap — die
      killPlayer();
      return;
    }
    player.y  = groundY - PLAYER_SIZE;
    player.vy = 0;
    player.onGround  = true;
    player.jumpsLeft = 2;
  }

  // Platform landing
  for (const o of obstacles) {
    if (o.type === 'platform') {
      const px2 = player.x + PLAYER_SIZE;
      const py2 = player.y + PLAYER_SIZE;
      if (player.x < o.x + o.w && px2 > o.x) {
        if (py2 >= o.y && py2 <= o.y + 20 && player.vy >= 0) {
          player.y  = o.y - PLAYER_SIZE;
          player.vy = 0;
          player.onGround  = true;
          player.jumpsLeft = 2;
        }
      }
    }
  }

  // Block top landing
  for (const o of obstacles) {
    if (o.type === 'block') {
      const by  = GROUND_Y - o.h;
      const px2 = player.x + PLAYER_SIZE;
      const py2 = player.y + PLAYER_SIZE;
      if (player.x < o.x + o.w && px2 > o.x) {
        if (py2 >= by && py2 <= by + 12 && player.vy >= 0) {
          player.y  = by - PLAYER_SIZE;
          player.vy = 0;
          player.onGround  = true;
          player.jumpsLeft = 2;
        }
      }
    }
  }

  // Invincibility countdown
  if (player.invincible) {
    player.invincibleTimer--;
    if (player.invincibleTimer <= 0) {
      player.invincible = false;
      player.invincibleTimer = 0;
    }
  }

  // Power-star collection
  for (const o of obstacles) {
    if (o.type === 'powerstar' && !o.collected) {
      const starCX = o.x;
      const starCY = o.y;
      const dx = (player.x + PLAYER_SIZE / 2) - starCX;
      const dy = (player.y + PLAYER_SIZE / 2) - starCY;
      if (Math.sqrt(dx * dx + dy * dy) < 28) {
        o.collected = true;
        player.invincible = true;
        player.invincibleTimer = INVINCIBLE_FRAMES;
        spawnStarCollectParticles(starCX, starCY);
      }
    }
  }

  // Die if off screen top (ceiling)
  if (player.y < -60) {
    killPlayer();
    return;
  }

  // Obstacle collision
  if (checkCollision()) {
    killPlayer();
    return;
  }

  // Check finish
  const finish = obstacles.find(o => o.type === 'finish');
  if (finish && player.x >= finish.x) {
    winLevel();
  }
}

// ============================================================
//  GAME FLOW
// ============================================================
function killPlayer() {
  if (state !== 'playing') return;
  if (player.invincible) return;   // imune!
  state = 'dead';
  spawnDeathParticles();
  lives--;
  updateHUD();
  if (lives <= 0) {
    setTimeout(() => showScreen('death-screen'), 700);
  } else {
    setTimeout(() => {
      attempts++;
      state = 'playing';
      resetPlayer();
      camX = 0;
      particles = [];
      sawAngle  = 0;
      showScreen('game-screen');
      updateHUD();
    }, 600);
  }
}

function winLevel() {
  if (state !== 'playing') return;
  state = 'win';
  const s = attempts <= 1 ? 3 : attempts <= 5 ? 2 : 1;
  stars[currentLevel] = Math.max(stars[currentLevel] || 0, s);
  saveUserScore(currentLevel, s, attempts);

  document.getElementById('win-stars').textContent = '★'.repeat(s) + '☆'.repeat(3 - s);
  document.getElementById('win-attempts').textContent = `Tentativas: ${attempts} | Vidas restantes: ${lives}`;
  updateStarDisplay();

  const nextBtn = document.getElementById('btn-next-level');
  nextBtn.style.display = currentLevel < 6 ? 'block' : 'none';
  showScreen('win-screen');
}

function retryLevel() {
  lives    = MAX_LIVES;
  attempts = 1;
  state    = 'playing';
  resetPlayer();
  camX = 0;
  particles = [];
  sawAngle  = 0;
  showScreen('game-screen');
  updateHUD();
}

function startLevel(num) {
  currentLevel = num;
  attempts     = 1;
  lives        = MAX_LIVES;
  state        = 'playing';
  loadLevel(num);
  showScreen('game-screen');
  updateHUD();
  if (!gameLoop) startGameLoop();
}

function goMenu() {
  state = 'menu';
  if (!currentUser) {
    showScreen('login-screen');
  } else {
    document.getElementById('menu-user-badge').textContent = `👤 ${currentUser}`;
    showScreen('menu-screen');
  }
}

function updateHUD() {
  document.getElementById('level-label').textContent = `NÍVEL ${currentLevel}`;
  document.getElementById('lives-label').textContent = '❤️'.repeat(Math.max(0, lives)) + '🖤'.repeat(Math.max(0, MAX_LIVES - lives));
}

function updateStarDisplay() {
  [1,2,3,4,5,6].forEach(n => {
    const el = document.getElementById(`stars-${n}`);
    if (!el) return;
    const s = stars[n] || 0;
    el.textContent = '★'.repeat(s) + '☆'.repeat(3 - s);
  });
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function hideOverlays() {
  document.querySelectorAll('.screen.overlay').forEach(s => s.classList.remove('active'));
}

// ============================================================
//  GAME LOOP
// ============================================================
function tick() {
  // Clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (state === 'playing' || state === 'dead') {
    // Advance camera
    if (state === 'playing') {
      const speed = SPEED_BASE + (currentLevel - 1) * 1.1;
      player.x += speed;
      camX = Math.max(0, player.x - 150);
    }

    // Progress
    const finish = obstacles.find(o => o.type === 'finish');
    if (finish) {
      levelProgress = Math.min(1, Math.max(0, (player.x - 80) / (finish.x - 80)));
    }
    const pct = Math.round(levelProgress * 100);
    document.getElementById('progress-bar-fill').style.width = pct + '%';
    document.getElementById('progress-text').textContent     = pct + '%';

    // Physics
    if (state === 'playing') updatePhysics();
    updateParticles();

    // Draw
    drawBackground();
    drawGround();
    drawObstacles();
    drawParticles();
    drawPlayer();
  }
}

function startGameLoop() {
  if (gameLoop) return;
  function loop() {
    tick();
    gameLoop = requestAnimationFrame(loop);
  }
  gameLoop = requestAnimationFrame(loop);
}

// Start the loop always (draws menu bg too)
startGameLoop();

// ============================================================
//  RANKING DISPLAY
// ============================================================
async function showRanking() {
  const tbody = document.getElementById('ranking-body');
  tbody.innerHTML = `<tr><td colspan="5" class="ranking-empty">Carregando...</td></tr>`;
  showScreen('ranking-screen');

  const ranking = await buildRanking();
  const medals  = ['🥇', '🥈', '🥉'];
  tbody.innerHTML = '';

  if (ranking.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="ranking-empty">Nenhum jogador ainda.</td></tr>`;
  } else {
    ranking.forEach((entry, i) => {
      const isYou = entry.name === currentUser;
      const tr = document.createElement('tr');
      if (isYou) tr.classList.add('rank-you');
      else if (i < 3) tr.classList.add(`rank-${i + 1}`);
      tr.innerHTML = `
        <td class="rank-medal">${medals[i] || i + 1}</td>
        <td>${entry.name}${isYou ? ' <span style="color:#00cfff;font-size:0.75rem">(você)</span>' : ''}</td>
        <td>${entry.totalStars} / 18</td>
        <td>${entry.levelsCleared} / 6</td>
        <td>${entry.totalAttempts || 0}</td>
      `;
      tbody.appendChild(tr);
    });
  }
}

// ============================================================
//  UI WIRING
// ============================================================

// --- Login / Register ---
function setLoginError(msg) {
  document.getElementById('login-error').textContent = msg || '';
}

document.getElementById('btn-login').addEventListener('click', async () => {
  const u = document.getElementById('login-username').value.trim();
  const p = document.getElementById('login-password').value;
  setLoginError('Entrando...');
  const err = await loginUser(u, p);
  if (err) { setLoginError(err); return; }
  currentUser = u;
  await loadUserStars();
  updateStarDisplay();
  document.getElementById('menu-user-badge').textContent = `👤 ${currentUser}`;
  setLoginError('');
  showScreen('menu-screen');
});

document.getElementById('btn-register').addEventListener('click', async () => {
  const u = document.getElementById('login-username').value.trim();
  const p = document.getElementById('login-password').value;
  setLoginError('Registrando...');
  const err = await registerUser(u, p);
  if (err) { setLoginError(err); return; }
  const loginErr = await loginUser(u, p);
  if (loginErr) { setLoginError(loginErr); return; }
  currentUser = u;
  await loadUserStars();
  updateStarDisplay();
  document.getElementById('menu-user-badge').textContent = `👤 ${currentUser}`;
  setLoginError('');
  showScreen('menu-screen');
});

// Allow Enter key on login fields
['login-username','login-password'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-login').click();
  });
});

// --- Menu ---
document.getElementById('btn-play').addEventListener('click', () => startLevel(1));
document.getElementById('btn-levels').addEventListener('click', () => {
  updateStarDisplay();
  showScreen('level-select-screen');
});
document.getElementById('btn-ranking').addEventListener('click', showRanking);
document.getElementById('btn-logout').addEventListener('click', () => {
  currentUser = null;
  stars = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  setLoginError('');
  showScreen('login-screen');
});

document.getElementById('btn-back-menu').addEventListener('click', goMenu);
document.getElementById('btn-back-from-ranking').addEventListener('click', goMenu);

document.querySelectorAll('.level-card').forEach(card => {
  card.addEventListener('click', () => {
    startLevel(parseInt(card.dataset.level));
  });
});

document.getElementById('btn-retry').addEventListener('click', retryLevel);
document.getElementById('btn-menu-from-death').addEventListener('click', goMenu);
document.getElementById('btn-next-level').addEventListener('click', () => {
  if (currentLevel < 6) startLevel(currentLevel + 1);
  else goMenu();
});
document.getElementById('btn-menu-from-win').addEventListener('click', goMenu);

// Init — show login screen
updateStarDisplay();
