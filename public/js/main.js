/**
 * Client entry — connects Socket.IO, ties input → server → renderer.
 */
(function () {
  const WL_COLORS = ['#ff3c3c', '#3ca0ff', '#fff03c', '#3cff78'];
  const WL_NAMES = ['RED', 'BLUE', 'YELLOW', 'GREEN'];

  // DOM
  const menuScreen = document.getElementById('menu-screen');
  const gameCanvas = document.getElementById('game-canvas');
  const bgCanvas = document.getElementById('bg-canvas');
  const playBtn = document.getElementById('play-btn');
  const nameInput = document.getElementById('name-input');
  const lobbyStatus = document.getElementById('lobby-status');
  const lobbyText = document.getElementById('lobby-text');
  const lobbyPlayers = document.getElementById('lobby-players');
  const hud = document.getElementById('hud');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlaySub = document.getElementById('overlay-subtitle');
  const restartBtn = document.getElementById('restart-btn');
  const extractionFill = document.getElementById('extraction-fill');
  const extractionText = document.getElementById('extraction-text');
  const waveCounter = document.getElementById('wave-counter');
  const playerStatsDiv = document.getElementById('player-stats');
  const myLumFill = document.getElementById('my-lum-fill');
  const myLumText = document.getElementById('my-lum-text');
  const myColorInd = document.getElementById('my-color-indicator');
  const myFlareCd = document.getElementById('my-flare-cd');

  // Background canvas particles
  const bgCtx = bgCanvas.getContext('2d');
  const bgStars = [];
  const bgParticles = [];
  function initBg() {
    bgCanvas.width = window.innerWidth;
    bgCanvas.height = window.innerHeight;
    for (let i = 0; i < 80; i++) {
      bgStars.push({
        x: Math.random() * bgCanvas.width,
        y: Math.random() * bgCanvas.height,
        size: 1 + Math.random() * 2,
        speed: 0.02 + Math.random() * 0.1,
        alpha: 0.15 + Math.random() * 0.4,
      });
    }
    for (let i = 0; i < 30; i++) {
      bgParticles.push({
        x: Math.random() * bgCanvas.width,
        y: Math.random() * bgCanvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        size: 2 + Math.random() * 5,
        maxLife: 3 + Math.random() * 6,
        life: Math.random() * 6,
        colorIdx: Math.floor(Math.random() * 4),
      });
    }
  }
  let bgTime = 0;
  function drawBg() {
    bgTime += 1 / 60;
    const W = bgCanvas.width, H = bgCanvas.height;
    bgCtx.clearRect(0, 0, W, H);
    bgCtx.fillStyle = '#06060f';
    bgCtx.fillRect(0, 0, W, H);

    for (const s of bgStars) {
      s.y += s.speed;
      if (s.y > H) { s.y = -5; s.x = Math.random() * W; }
      bgCtx.globalAlpha = s.alpha * (0.7 + Math.sin(bgTime * 1.5) * 0.2);
      bgCtx.fillStyle = '#fff';
      bgCtx.fillRect(s.x, s.y, s.size, s.size);
    }

    for (const p of bgParticles) {
      p.x += p.vx; p.y += p.vy;
      p.life += 1 / 60;
      if (p.life > p.maxLife) {
        p.x = Math.random() * W; p.y = Math.random() * H;
        p.life = 0;
      }
      let a;
      const prog = p.life / p.maxLife;
      if (prog < 0.2) a = prog / 0.2;
      else if (prog > 0.8) a = (1 - prog) / 0.2;
      else a = 1;
      a *= 0.4;
      const col = WL_COLORS[p.colorIdx];
      bgCtx.globalAlpha = Math.max(0, a);
      bgCtx.fillStyle = col;
      const glow = p.size * 3;
      bgCtx.beginPath();
      bgCtx.arc(p.x, p.y, glow, 0, Math.PI * 2);
      bgCtx.fill();
      bgCtx.globalAlpha = Math.max(0, a * 2);
      bgCtx.beginPath();
      bgCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      bgCtx.fill();
    }
    bgCtx.globalAlpha = 1;
  }

  window.addEventListener('resize', () => {
    bgCanvas.width = window.innerWidth;
    bgCanvas.height = window.innerHeight;
  });
  initBg();

  // Renderer & Input
  const renderer = new GameRenderer(gameCanvas);
  const input = new InputManager();
  const socket = io();

  let mySlot = -1;
  let latestSnap = null;
  let gameState = 'menu'; // menu | lobby | playing | over
  let prevWaveIndex = 0;

  // ── Menu Animations ────────────────────────────────────────────────────
  function menuLoop() {
    if (gameState === 'menu' || gameState === 'lobby') {
      drawBg();
      requestAnimationFrame(menuLoop);
    }
  }
  menuLoop();

  // ── Connect & Join ─────────────────────────────────────────────────────
  playBtn.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'Player';
    socket.emit('join', { name });
    playBtn.style.display = 'none';
    nameInput.disabled = true;
    lobbyStatus.classList.remove('hidden');
    lobbyPlayers.classList.remove('hidden');
    lobbyText.textContent = 'Connecting...';
    gameState = 'lobby';
  });

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') playBtn.click();
  });

  socket.on('joined', (data) => {
    mySlot = data.slot;
    renderer.setArena(data.arenaW, data.arenaH);
    lobbyText.textContent = `Joined room • Waiting for players... (${data.playerCount}/4)`;

    if (data.playerCount < 2) {
      // Solo — show "start anyway" option
      const soloBtn = document.createElement('button');
      soloBtn.className = 'btn-primary';
      soloBtn.style.marginTop = '10px';
      soloBtn.style.fontSize = '0.85rem';
      soloBtn.style.padding = '10px 28px';
      soloBtn.textContent = '▶ START SOLO';
      soloBtn.id = 'solo-btn';
      soloBtn.addEventListener('click', () => socket.emit('ready'));
      if (!document.getElementById('solo-btn')) {
        lobbyPlayers.parentNode.insertBefore(soloBtn, lobbyPlayers.nextSibling);
      }
    }
  });

  socket.on('lobby', (data) => {
    lobbyText.textContent = `Waiting for players... (${data.players.length}/4)`;
    lobbyPlayers.innerHTML = '';
    for (const p of data.players) {
      const div = document.createElement('div');
      div.className = 'lobby-player';
      div.style.borderLeftColor = WL_COLORS[p.slot % 4];
      div.style.borderLeftWidth = '3px';
      div.style.borderLeftStyle = 'solid';
      div.textContent = p.name || 'Player';
      lobbyPlayers.appendChild(div);
    }
  });

  // ── Game Start ─────────────────────────────────────────────────────────
  socket.on('gameStart', () => {
    gameState = 'playing';
    menuScreen.classList.add('hidden');
    hud.classList.remove('hidden');
    overlay.classList.add('hidden');
    prevWaveIndex = 0;
    const soloBtn = document.getElementById('solo-btn');
    if (soloBtn) soloBtn.remove();
    gameLoop();
  });

  // ── Snapshot ────────────────────────────────────────────────────────────
  socket.on('snap', (snap) => {
    latestSnap = snap;

    // Wave spawn effects
    if (snap.wi > prevWaveIndex) {
      renderer.triggerShake();
      renderer.triggerFlash();
      prevWaveIndex = snap.wi;
    }

    // End states
    if (snap.st === 'gameover' || snap.st === 'won') {
      if (gameState === 'playing') {
        gameState = 'over';
        showOverlay(snap.st);
      }
    }
  });

  // ── Game Loop ──────────────────────────────────────────────────────────
  let inputTick = 0;
  function gameLoop() {
    if (gameState !== 'playing' && gameState !== 'over') return;

    renderer.render(latestSnap, mySlot);
    updateHUD();

    // Send input at ~30Hz
    inputTick++;
    if (inputTick % 2 === 0 && gameState === 'playing') {
      const inp = input.poll();
      if (inp.dx || inp.dy || inp.cycle || inp.flare) {
        socket.volatile.emit('input', inp);
      } else {
        // Send idle state too so server knows we stopped
        socket.volatile.emit('input', inp);
      }
    }

    requestAnimationFrame(gameLoop);
  }

  // ── HUD Update ─────────────────────────────────────────────────────────
  function updateHUD() {
    if (!latestSnap) return;

    // Extraction
    extractionFill.style.width = latestSnap.c + '%';
    extractionText.textContent = `Extraction: ${Math.floor(latestSnap.c)}%`;
    waveCounter.textContent = `Wave ${latestSnap.wi}`;

    // My stats
    const me = latestSnap.p.find(p => p.s === mySlot);
    if (me) {
      myLumFill.style.width = me.l + '%';
      myLumText.textContent = me.l;
      myColorInd.style.background = WL_COLORS[me.w];
    }

    // Player stats (top right)
    playerStatsDiv.innerHTML = '';
    for (const p of latestSnap.p) {
      const row = document.createElement('div');
      row.className = 'player-stat-row';
      if (p.g) row.style.opacity = '0.4';

      const name = document.createElement('span');
      name.className = 'player-stat-name';
      name.textContent = p.n || 'P' + (p.s + 1);
      if (p.s === mySlot) name.style.color = '#64c8ff';

      const lumBar = document.createElement('div');
      lumBar.className = 'player-stat-lum';
      const lumFill = document.createElement('div');
      lumFill.className = 'player-stat-lum-fill';
      lumFill.style.width = p.l + '%';
      lumFill.style.background = p.g ? '#666' : WL_COLORS[p.w];
      lumBar.appendChild(lumFill);

      const colorDot = document.createElement('div');
      colorDot.className = 'player-stat-color';
      colorDot.style.background = p.g ? '#666' : WL_COLORS[p.w];

      row.appendChild(name);
      row.appendChild(lumBar);
      row.appendChild(colorDot);
      playerStatsDiv.appendChild(row);
    }
  }

  // ── Overlays ───────────────────────────────────────────────────────────
  function showOverlay(state) {
    overlay.classList.remove('hidden');
    if (state === 'won') {
      overlayTitle.textContent = 'EXTRACTION COMPLETE';
      overlayTitle.style.color = '#3cff78';
      overlaySub.textContent = 'You survived the dying of the light.';
    } else {
      overlayTitle.textContent = 'BIG HEAT DEATH';
      overlayTitle.style.color = '#ff3c3c';
      overlaySub.textContent = 'All luminance has been extinguished...';
    }
  }

  restartBtn.addEventListener('click', () => {
    socket.emit('restart');
    overlay.classList.add('hidden');
    gameState = 'playing';
    prevWaveIndex = 0;
  });
})();
