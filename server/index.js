const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Constants ────────────────────────────────────────────────────────────────
const ARENA_W = 900, ARENA_H = 650;
const PLAYER_SIZE = 28;
const MAX_PLAYERS = 4;
const TICK_RATE = 60;
const MOVE_SPEED = 4;
const LUMINANCE_MAX = 100;
const HIT_INVULN_SEC = 0.4;
const FLARE_COOLDOWN_SEC = 9;
const FLARE_RADIUS = 120;
const FLARE_FREEZE_SEC = 2.5;
const RESONANCE_HEAL = 3;
const RESONANCE_CD_SEC = 1.0;
const REVIVE_TIME_SEC = 0.5;
const MAX_RAYS = 12;
const WAVE_INTERVAL_SEC = 18;
const COLOR_CYCLE_SEC = 6.5;
const PRISM_CHARGE_PER_SEC = 100 / 120; // ~90s to full
const PRISM_RADIUS = 80;
const PRISM_MIN_LUM = 20;
const WAVELENGTHS = ['RED', 'BLUE', 'YELLOW', 'GREEN'];

function nextWL(wl) {
  const i = WAVELENGTHS.indexOf(wl);
  return WAVELENGTHS[(i + 1) % WAVELENGTHS.length];
}

// ── Room management ──────────────────────────────────────────────────────────
const rooms = new Map();
let roomCounter = 0;

function createRoom() {
  const id = `room_${++roomCounter}`;
  const room = {
    id,
    players: {},
    playerOrder: [],
    rays: [],
    powerUps: [],
    prismCharge: 0,
    waveIndex: 0,
    waveTimer: WAVE_INTERVAL_SEC,
    powerUpTimer: 12 + Math.random() * 8,
    tickCount: 0,
    state: 'lobby', // lobby | playing | gameover | won
    countdown: 0,
    gameOverTimer: 0,
  };
  rooms.set(id, room);
  return room;
}

function findOpenRoom() {
  for (const [, room] of rooms) {
    if (room.state === 'lobby' && room.playerOrder.length < MAX_PLAYERS) return room;
  }
  return createRoom();
}

function makePlayer(slot) {
  const spawnPositions = [
    { x: ARENA_W * 0.25, y: ARENA_H * 0.5 },
    { x: ARENA_W * 0.75, y: ARENA_H * 0.5 },
    { x: ARENA_W * 0.5, y: ARENA_H * 0.25 },
    { x: ARENA_W * 0.5, y: ARENA_H * 0.75 },
  ];
  const sp = spawnPositions[slot % 4];
  return {
    slot,
    x: sp.x, y: sp.y,
    w: PLAYER_SIZE, h: PLAYER_SIZE,
    luminance: LUMINANCE_MAX,
    wavelength: WAVELENGTHS[slot % 4],
    grayscale: false,
    invuln: 0, flareCd: 0, resonanceCd: 0,
    reviveAccum: 0,
    damageFlash: 0, healFlash: 0, flareAnim: 0, colorChangeAnim: 0,
    prismaticShield: false, refractionLens: 0,
    dirX: 0, dirY: 0,
    name: '',
  };
}

// ── Ray factories ────────────────────────────────────────────────────────────
function randSign() { return Math.random() < 0.5 ? -1 : 1; }
function randSpawn(max, sz) { return Math.floor(Math.random() * Math.max(1, max - sz)); }

function makeGammaRay() {
  const v = 2.5 + Math.random();
  return {
    kind: 'G', x: randSpawn(ARENA_W, 22), y: randSpawn(ARENA_H, 22),
    w: 22, h: 22, vx: randSign() * v, vy: randSign() * v,
    speedMult: 1.4, drain: 4, wavelength: 'RED',
    state: 'NORMAL', frozen: 0, colorTimer: COLOR_CYCLE_SEC,
  };
}
function makeUVRay() {
  const v = 1.5 + Math.random() * 0.5;
  return {
    kind: 'U', x: randSpawn(ARENA_W, 8), y: randSpawn(ARENA_H, 30),
    w: 8, h: 30, vx: randSign() * v, vy: randSign() * v,
    speedMult: 0.75, drain: 12, wavelength: 'BLUE',
    state: 'NORMAL', frozen: 0, colorTimer: COLOR_CYCLE_SEC,
  };
}
function makeVisibleRay() {
  const v = 2 + Math.random() * 0.5;
  return {
    kind: 'V', x: randSpawn(ARENA_W, 22), y: randSpawn(ARENA_H, 22),
    w: 22, h: 22, vx: randSign() * v, vy: randSign() * v,
    speedMult: 1.0, drain: 7, wavelength: 'YELLOW',
    state: 'NORMAL', frozen: 0, colorTimer: COLOR_CYCLE_SEC,
    chaseCd: 0, chaseActive: 0, chaseTarget: -1,
  };
}

const POWERUP_TYPES = ['REFRACTION_LENS', 'PRISMATIC_SHIELD', 'RADIANT_SURGE'];
function makePowerUp() {
  const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
  const spd = 0.3 + Math.random() * 0.4;
  const angle = Math.random() * Math.PI * 2;
  return {
    type, x: 40 + Math.random() * (ARENA_W - 80), y: 40 + Math.random() * (ARENA_H - 80),
    vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd, collected: false, id: Math.random(),
  };
}

// ── AABB helpers ─────────────────────────────────────────────────────────────
function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function dist2(ax, ay, bx, by) { return (ax - bx) ** 2 + (ay - by) ** 2; }
function cx(e) { return e.x + e.w / 2; }
function cy(e) { return e.y + e.h / 2; }

// ── Tick ─────────────────────────────────────────────────────────────────────
function tickRoom(room) {
  if (room.state !== 'playing') return;
  const dt = 1 / TICK_RATE;
  const players = room.playerOrder.map(id => room.players[id]).filter(Boolean);

  // Move players
  for (const p of players) {
    if (p.grayscale) continue;
    if (p.dirX || p.dirY) {
      let dx = p.dirX, dy = p.dirY;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) { dx /= len; dy /= len; }
      p.x += dx * MOVE_SPEED;
      p.y += dy * MOVE_SPEED;
      p.x = Math.max(0, Math.min(ARENA_W - p.w, p.x));
      p.y = Math.max(0, Math.min(ARENA_H - p.h, p.y));
    }
  }

  // Tick player timers
  for (const p of players) {
    if (p.invuln > 0) p.invuln -= dt;
    if (p.flareCd > 0) p.flareCd -= dt;
    if (p.resonanceCd > 0) p.resonanceCd -= dt;
    if (p.damageFlash > 0) p.damageFlash -= dt;
    if (p.healFlash > 0) p.healFlash -= dt;
    if (p.flareAnim > 0) p.flareAnim -= dt;
    if (p.colorChangeAnim > 0) p.colorChangeAnim -= dt;
    if (p.refractionLens > 0) p.refractionLens -= dt;
  }

  // Tick rays
  for (const r of room.rays) {
    // Frozen tick
    if (r.state === 'FROZEN') {
      r.frozen -= dt;
      if (r.frozen <= 0) { r.frozen = 0; r.state = 'NORMAL'; }
      continue;
    }
    // Color cycle
    r.colorTimer -= dt;
    if (r.colorTimer <= 0) { r.wavelength = nextWL(r.wavelength); r.colorTimer = COLOR_CYCLE_SEC; }

    // Chase logic for visible rays
    if (r.kind === 'V') {
      if (r.chaseCd > 0) r.chaseCd -= dt;
      if (r.state === 'CHASING') {
        r.chaseActive -= dt;
        const target = players.find(p => p.slot === r.chaseTarget);
        if (!target || target.grayscale || r.chaseActive <= 0) {
          r.state = 'NORMAL'; r.chaseTarget = -1; r.chaseCd = 5;
        } else {
          // Steer toward target
          const dx = cx(target) - cx(r), dy = cy(target) - cy(r);
          const len = Math.hypot(dx, dy);
          if (len > 1) {
            const curAng = Math.atan2(r.vy, r.vx);
            const wantAng = Math.atan2(dy, dx);
            let delta = wantAng - curAng;
            while (delta > Math.PI) delta -= 2 * Math.PI;
            while (delta < -Math.PI) delta += 2 * Math.PI;
            const maxStep = 2.5 * dt;
            const step = Math.max(-maxStep, Math.min(maxStep, delta));
            const newAng = curAng + step;
            const spd = Math.hypot(r.vx, r.vy);
            r.vx = Math.cos(newAng) * spd;
            r.vy = Math.sin(newAng) * spd;
          }
        }
      } else if (r.chaseCd <= 0) {
        let best = null, bestD = 200 * 200;
        for (const p of players) {
          if (p.grayscale) continue;
          const d = dist2(cx(r), cy(r), cx(p), cy(p));
          if (d < bestD) { bestD = d; best = p; }
        }
        if (best) { r.state = 'CHASING'; r.chaseActive = 3; r.chaseTarget = best.slot; }
      }
    }

    // Move
    r.x += r.vx * r.speedMult;
    r.y += r.vy * r.speedMult;
    // Bounce
    if (r.x < 0) { r.x = 0; r.vx = -r.vx; }
    else if (r.x + r.w > ARENA_W) { r.x = ARENA_W - r.w; r.vx = -r.vx; }
    if (r.y < 0) { r.y = 0; r.vy = -r.vy; }
    else if (r.y + r.h > ARENA_H) { r.y = ARENA_H - r.h; r.vy = -r.vy; }
  }

  // Ray-player collision
  for (const p of players) {
    if (p.grayscale || p.invuln > 0) continue;
    for (const r of room.rays) {
      if (r.state === 'FROZEN') continue;
      if (!intersects(p, r)) continue;
      if (p.wavelength === r.wavelength) {
        if (p.resonanceCd > 0) continue;
        const heal = p.refractionLens > 0 ? RESONANCE_HEAL * 2 : RESONANCE_HEAL;
        p.luminance = Math.min(LUMINANCE_MAX, p.luminance + heal);
        p.resonanceCd = RESONANCE_CD_SEC;
        p.healFlash = 0.4; p.damageFlash = 0;
      } else {
        if (p.prismaticShield) {
          p.prismaticShield = false; p.invuln = HIT_INVULN_SEC; p.healFlash = 0.4;
        } else {
          p.luminance = Math.max(0, p.luminance - r.drain);
          if (p.luminance <= 0) { p.luminance = 0; p.grayscale = true; }
          p.invuln = HIT_INVULN_SEC; p.damageFlash = 0.3;
        }
      }
    }
  }

  // Revive
  for (const p of players) {
    if (p.grayscale) continue;
    for (const d of players) {
      if (!d.grayscale || p === d) continue;
      if (intersects(p, d)) {
        d.reviveAccum += dt;
        if (d.reviveAccum >= REVIVE_TIME_SEC) {
          const donation = Math.min(20, Math.max(0, p.luminance - 1));
          p.luminance -= donation;
          d.grayscale = false;
          d.luminance = Math.min(LUMINANCE_MAX, 35);
          d.reviveAccum = 0;
          d.healFlash = 0.5;
        }
      } else {
        d.reviveAccum = 0;
      }
    }
  }

  // Prism charge
  const prismCx = ARENA_W / 2, prismCy = ARENA_H / 2;
  let anyCharging = false;
  for (const p of players) {
    if (p.grayscale || p.luminance < PRISM_MIN_LUM) continue;
    if (dist2(cx(p), cy(p), prismCx, prismCy) < PRISM_RADIUS * PRISM_RADIUS) {
      anyCharging = true; break;
    }
  }
  if (anyCharging) {
    room.prismCharge = Math.min(100, room.prismCharge + PRISM_CHARGE_PER_SEC * dt);
  }

  // Wave spawning
  room.waveTimer -= dt;
  if (room.waveTimer <= 0 && room.rays.length < MAX_RAYS) {
    if (room.rays.length < MAX_RAYS) room.rays.push(makeGammaRay());
    if (room.rays.length < MAX_RAYS) room.rays.push(makeUVRay());
    if (room.rays.length < MAX_RAYS) room.rays.push(makeVisibleRay());
    room.waveIndex++;
    room.waveTimer = WAVE_INTERVAL_SEC;
    // Speed up existing rays slightly each wave
    for (const r of room.rays) {
      r.vx *= 1.04; r.vy *= 1.04;
    }
  }

  // Power-up spawning
  room.powerUpTimer -= dt;
  if (room.powerUpTimer <= 0 && room.powerUps.filter(u => !u.collected).length < 3) {
    room.powerUps.push(makePowerUp());
    room.powerUpTimer = 10 + Math.random() * 10;
  }
  // Power-up movement & collision
  for (const pu of room.powerUps) {
    if (pu.collected) continue;
    pu.x += pu.vx; pu.y += pu.vy;
    if (pu.x < 0 || pu.x + 20 > ARENA_W) pu.vx = -pu.vx;
    if (pu.y < 0 || pu.y + 20 > ARENA_H) pu.vy = -pu.vy;
    for (const p of players) {
      if (intersects(p, { x: pu.x, y: pu.y, w: 20, h: 20 })) {
        pu.collected = true;
        if (pu.type === 'REFRACTION_LENS') p.refractionLens = 10;
        else if (pu.type === 'PRISMATIC_SHIELD') p.prismaticShield = true;
        else if (pu.type === 'RADIANT_SURGE') {
          if (p.grayscale) { p.grayscale = false; p.luminance = 20; }
          else p.luminance = Math.min(LUMINANCE_MAX, p.luminance + 20);
        }
        break;
      }
    }
  }
  room.powerUps = room.powerUps.filter(u => !u.collected);

  // Win/lose checks
  if (room.prismCharge >= 100) {
    room.state = 'won';
    broadcastState(room);
    return;
  }
  if (players.length > 0 && players.every(p => p.grayscale)) {
    room.state = 'gameover';
    broadcastState(room);
    return;
  }

  room.tickCount++;
  if (room.tickCount % 2 === 0) broadcastState(room);
}

function broadcastState(room) {
  const players = room.playerOrder.map(id => {
    const p = room.players[id];
    if (!p) return null;
    return {
      s: p.slot, x: Math.round(p.x), y: Math.round(p.y),
      l: p.luminance, w: WAVELENGTHS.indexOf(p.wavelength),
      g: p.grayscale ? 1 : 0, n: p.name,
      df: Math.round(p.damageFlash * 100), hf: Math.round(p.healFlash * 100),
      fa: Math.round(p.flareAnim * 100), ca: Math.round(p.colorChangeAnim * 100),
      ps: p.prismaticShield ? 1 : 0, rl: p.refractionLens > 0 ? 1 : 0,
      iv: p.invuln > 0 ? 1 : 0,
    };
  }).filter(Boolean);

  const rays = room.rays.map(r => ({
    k: r.kind, x: Math.round(r.x), y: Math.round(r.y),
    w: r.w, h: r.h, vx: Math.round(r.vx * 10), vy: Math.round(r.vy * 10),
    wl: WAVELENGTHS.indexOf(r.wavelength), st: r.state === 'FROZEN' ? 1 : r.state === 'CHASING' ? 2 : 0,
  }));

  const pups = room.powerUps.filter(u => !u.collected).map(u => ({
    t: POWERUP_TYPES.indexOf(u.type), x: Math.round(u.x), y: Math.round(u.y),
  }));

  const snap = {
    p: players, r: rays, u: pups,
    c: Math.round(room.prismCharge * 100) / 100,
    wi: room.waveIndex, st: room.state,
  };

  for (const sid of room.playerOrder) {
    const sock = io.sockets.sockets.get(sid);
    if (sock) sock.volatile.emit('snap', snap);
  }
}

// ── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  let currentRoom = null;
  let playerName = 'Player';

  socket.on('join', (data) => {
    playerName = (data?.name || 'Player').substring(0, 16);
    const room = findOpenRoom();
    currentRoom = room;
    const slot = room.playerOrder.length;
    room.playerOrder.push(socket.id);
    room.players[socket.id] = makePlayer(slot);
    room.players[socket.id].name = playerName;
    socket.join(room.id);
    socket.emit('joined', {
      roomId: room.id, slot, arenaW: ARENA_W, arenaH: ARENA_H,
      playerCount: room.playerOrder.length, state: room.state,
    });
    io.to(room.id).emit('lobby', {
      players: room.playerOrder.map(id => ({
        name: room.players[id]?.name || 'Player',
        slot: room.players[id]?.slot,
      })),
      state: room.state,
    });

    // Auto-start when 2+ players (can be changed to 4 for full experience)
    if (room.playerOrder.length >= 2 && room.state === 'lobby') {
      startGame(room);
    }
  });

  socket.on('ready', () => {
    if (!currentRoom || currentRoom.state !== 'lobby') return;
    if (currentRoom.playerOrder.length >= 1) startGame(currentRoom);
  });

  socket.on('input', (data) => {
    if (!currentRoom || currentRoom.state !== 'playing') return;
    const p = currentRoom.players[socket.id];
    if (!p) return;
    p.dirX = clamp(data.dx || 0, -1, 1);
    p.dirY = clamp(data.dy || 0, -1, 1);
    if (data.cycle && !p.grayscale) {
      p.wavelength = nextWL(p.wavelength);
      p.colorChangeAnim = 0.25;
    }
    if (data.flare && !p.grayscale && p.flareCd <= 0) {
      const cost = Math.max(5, Math.floor(p.luminance * 0.1));
      if (p.luminance > cost) {
        p.luminance -= cost;
        p.flareCd = FLARE_COOLDOWN_SEC;
        p.flareAnim = 0.5;
        // Freeze nearby rays
        for (const r of currentRoom.rays) {
          if (dist2(cx(p), cy(p), cx(r), cy(r)) < FLARE_RADIUS * FLARE_RADIUS) {
            r.state = 'FROZEN'; r.frozen = FLARE_FREEZE_SEC;
          }
        }
      }
    }
  });

  socket.on('restart', () => {
    if (!currentRoom) return;
    if (currentRoom.state === 'gameover' || currentRoom.state === 'won') {
      resetRoom(currentRoom);
      startGame(currentRoom);
    }
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    delete currentRoom.players[socket.id];
    currentRoom.playerOrder = currentRoom.playerOrder.filter(id => id !== socket.id);
    if (currentRoom.playerOrder.length === 0) {
      rooms.delete(currentRoom.id);
    } else {
      io.to(currentRoom.id).emit('lobby', {
        players: currentRoom.playerOrder.map(id => ({
          name: currentRoom.players[id]?.name || 'Player',
          slot: currentRoom.players[id]?.slot,
        })),
        state: currentRoom.state,
      });
    }
  });
});

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function startGame(room) {
  room.state = 'playing';
  room.rays = [];
  room.powerUps = [];
  room.prismCharge = 0;
  room.waveIndex = 0;
  room.waveTimer = 3; // first wave comes fast
  room.powerUpTimer = 10 + Math.random() * 8;
  // Initial ray bundle
  room.rays.push(makeGammaRay());
  room.rays.push(makeVisibleRay());
  io.to(room.id).emit('gameStart', { playerCount: room.playerOrder.length });
}

function resetRoom(room) {
  room.rays = [];
  room.powerUps = [];
  room.prismCharge = 0;
  room.waveIndex = 0;
  room.tickCount = 0;
  for (const sid of room.playerOrder) {
    const p = room.players[sid];
    if (p) {
      const sp = makePlayer(p.slot);
      sp.name = p.name;
      room.players[sid] = sp;
    }
  }
}

// Game loop
setInterval(() => {
  for (const [, room] of rooms) tickRoom(room);
}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Spectra.io running on http://localhost:${PORT}`));
