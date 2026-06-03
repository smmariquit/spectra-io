/**
 * Canvas renderer — ports the Java Swing paintComponent to HTML5 Canvas.
 */
class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.stars = [];
    this.time = 0;
    this.shakeTimer = 0;
    this.flashTimer = 0;
    this.arenaW = 900;
    this.arenaH = 650;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;

    for (let i = 0; i < 120; i++) {
      this.stars.push({
        x: Math.random() * 2000, y: Math.random() * 2000,
        size: 1 + Math.random() * 2, speed: 0.05 + Math.random() * 0.15,
        alpha: 0.2 + Math.random() * 0.5,
      });
    }
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Fit arena to screen
    const scaleX = window.innerWidth / this.arenaW;
    const scaleY = window.innerHeight / this.arenaH;
    this.scale = Math.min(scaleX, scaleY);
    this.offsetX = (window.innerWidth - this.arenaW * this.scale) / 2;
    this.offsetY = (window.innerHeight - this.arenaH * this.scale) / 2;
  }

  setArena(w, h) { this.arenaW = w; this.arenaH = h; this.resize(); }

  triggerShake() { this.shakeTimer = 0.4; }
  triggerFlash() { this.flashTimer = 0.3; }

  render(snap, mySlot) {
    const ctx = this.ctx;
    const dt = 1 / 60;
    this.time += dt;
    if (this.shakeTimer > 0) this.shakeTimer -= dt;
    if (this.flashTimer > 0) this.flashTimer -= dt;

    const W = window.innerWidth, H = window.innerHeight;
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#06060f';
    ctx.fillRect(0, 0, W, H);

    // Starfield
    for (const s of this.stars) {
      s.y += s.speed;
      if (s.y > H) { s.y = -5; s.x = Math.random() * W; }
      const pulse = Math.sin(this.time * 1.5) * 0.15 + 0.85;
      ctx.globalAlpha = Math.min(1, s.alpha * pulse);
      ctx.fillStyle = '#fff';
      ctx.fillRect(s.x, s.y, s.size, s.size);
    }
    ctx.globalAlpha = 1;

    if (!snap) return;

    // Transform to arena space
    ctx.save();
    if (this.shakeTimer > 0) {
      const amt = this.shakeTimer * 15;
      ctx.translate(
        this.offsetX + (Math.random() * 2 - 1) * amt,
        this.offsetY + (Math.random() * 2 - 1) * amt,
      );
    } else {
      ctx.translate(this.offsetX, this.offsetY);
    }
    ctx.scale(this.scale, this.scale);

    // Arena border
    ctx.strokeStyle = 'rgba(100,200,255,0.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, this.arenaW, this.arenaH);

    // Vignette
    const vg = ctx.createRadialGradient(
      this.arenaW / 2, this.arenaH / 2, this.arenaW * 0.2,
      this.arenaW / 2, this.arenaH / 2, this.arenaW * 0.7,
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, this.arenaW, this.arenaH);

    // Draw prism
    this.drawPrism(ctx, snap.c);

    // Draw power-ups
    for (const pu of snap.u || []) this.drawPowerUp(ctx, pu);

    // Draw rays
    for (const r of snap.r || []) this.drawRay(ctx, r);

    // Draw players
    for (const p of snap.p || []) this.drawPlayer(ctx, p, p.s === mySlot);

    ctx.restore();

    // Flash overlay
    if (this.flashTimer > 0) {
      ctx.globalAlpha = Math.min(1, this.flashTimer / 0.3 * 0.6);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  getWLColor(wlIdx) {
    const colors = ['#ff3c3c', '#3ca0ff', '#fff03c', '#3cff78'];
    return colors[wlIdx] || '#fff';
  }

  drawPrism(ctx, charge) {
    const cx = this.arenaW / 2, cy = this.arenaH / 2;
    const r = 80;
    const pulse = Math.sin(this.time * 1.8) * 0.2 + 0.8;

    // Aura glow
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(100,200,255,${0.08 * pulse})`;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Charge ring
    ctx.beginPath();
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + (Math.PI * 2 * charge / 100);
    ctx.arc(cx, cy, r - 6, startAngle, endAngle);
    ctx.strokeStyle = charge >= 100 ? '#3cff78' : 'rgba(100,200,255,0.7)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Core
    const coreColor = charge >= 100 ? '#3cff78' : '#fff';
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = coreColor;
    ctx.fill();

    // Core glow
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, Math.PI * 2);
    ctx.fillStyle = charge >= 100 ? 'rgba(60,255,120,0.2)' : 'rgba(255,255,255,0.15)';
    ctx.fill();

    // Charge percentage text
    ctx.fillStyle = 'rgba(100,200,255,0.5)';
    ctx.font = '600 11px "JetBrains Mono"';
    ctx.textAlign = 'center';
    ctx.fillText(Math.floor(charge) + '%', cx, cy + r + 16);
  }

  drawRay(ctx, r) {
    const wlColor = this.getWLColor(r.wl);
    const frozen = r.st === 1;
    const color = frozen ? '#b4f0ff' : wlColor;

    // Parse color for RGBA ops
    ctx.save();

    // Tail (if not frozen)
    if (!frozen) {
      const vx = r.vx / 10, vy = r.vy / 10;
      for (let i = 1; i <= 6; i++) {
        ctx.globalAlpha = 0.12 * (1 - i / 7);
        ctx.fillStyle = color;
        ctx.fillRect(r.x - vx * i * 2, r.y - vy * i * 2, r.w, r.h);
      }
    }

    // Glow
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = color;
    ctx.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);

    // Core
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.fillRect(r.x, r.y, r.w, r.h);

    // Outline
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x, r.y, r.w, r.h);

    // Frozen ice particles
    if (frozen) {
      for (let i = 0; i < 3; i++) {
        const ox = Math.sin(this.time * 2 + i * 2) * 6;
        const oy = Math.cos(this.time * 2 + i * 2) * 6;
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#d0f4ff';
        ctx.fillRect(r.x + r.w / 2 + ox - 1, r.y + r.h / 2 + oy - 1, 3, 3);
      }
    }

    // Chase indicator
    if (r.st === 2) {
      ctx.globalAlpha = 0.4 + Math.sin(this.time * 8) * 0.3;
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
    }

    ctx.restore();
  }

  drawPlayer(ctx, p, isMe) {
    const wlColor = this.getWLColor(p.w);
    const lumFactor = p.l / 100;
    const isGray = p.g === 1;

    ctx.save();

    // Parse color
    const baseRGB = this.hexToRgb(isGray ? '#666666' : wlColor);
    const r = Math.floor(baseRGB.r * (isGray ? 0.5 : lumFactor));
    const g = Math.floor(baseRGB.g * (isGray ? 0.5 : lumFactor));
    const b = Math.floor(baseRGB.b * (isGray ? 0.5 : lumFactor));
    const coreColor = `rgb(${r},${g},${b})`;

    // Bloom glow
    for (let i = 4; i > 0; i--) {
      const spread = i * 5;
      ctx.globalAlpha = 0.12 / i;
      ctx.fillStyle = coreColor;
      ctx.fillRect(p.x - spread, p.y - spread, 28 + spread * 2, 28 + spread * 2);
    }

    // Core
    ctx.globalAlpha = 1;
    ctx.fillStyle = coreColor;
    ctx.fillRect(p.x, p.y, 28, 28);

    // Inner highlight
    if (!isGray && p.l > 50) {
      ctx.strokeStyle = `rgba(255,255,255,${lumFactor * 0.4})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x + 2, p.y + 2, 24, 24);
    }

    // Invulnerability flicker
    if (p.iv && Math.floor(this.time * 20) % 2 === 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x - 2, p.y - 2, 32, 32);
    }

    // Damage flash
    if (p.df > 0) {
      ctx.globalAlpha = (p.df / 100) * 0.7;
      ctx.fillStyle = 'rgba(255,0,0,0.8)';
      ctx.fillRect(p.x - 5, p.y - 5, 38, 38);
    }

    // Heal flash
    if (p.hf > 0) {
      ctx.globalAlpha = (p.hf / 100) * 0.6;
      ctx.strokeStyle = '#64ff64';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x + 14, p.y + 14, 18, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Flare animation
    if (p.fa > 0) {
      const prog = 1 - p.fa / 50;
      const radius = prog * 120;
      ctx.globalAlpha = (1 - prog) * 0.35;
      ctx.fillStyle = wlColor;
      ctx.beginPath();
      ctx.arc(p.x + 14, p.y + 14, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = (1 - prog) * 0.6;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Color change burst
    if (p.ca > 0) {
      const prog = 1 - p.ca / 25;
      const burstR = prog * 50;
      ctx.globalAlpha = (1 - prog) * 0.5;
      ctx.strokeStyle = wlColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x + 14, p.y + 14, burstR, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Prismatic shield ring
    if (p.ps) {
      const shimmer = Math.sin(this.time * 5) * 0.3 + 0.7;
      ctx.globalAlpha = shimmer * 0.7;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x + 14, p.y + 14, 20, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Refraction lens dashed ring
    if (p.rl) {
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = '#00e8d8';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(p.x + 14, p.y + 14, 23, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.globalAlpha = 1;

    // Player name
    if (p.n) {
      ctx.fillStyle = isMe ? '#64c8ff' : 'rgba(200,210,230,0.7)';
      ctx.font = '600 10px "Outfit"';
      ctx.textAlign = 'center';
      ctx.fillText(p.n, p.x + 14, p.y - 8);
    }

    // "ME" indicator
    if (isMe) {
      ctx.fillStyle = 'rgba(100,200,255,0.5)';
      ctx.beginPath();
      ctx.moveTo(p.x + 14, p.y - 14);
      ctx.lineTo(p.x + 10, p.y - 20);
      ctx.lineTo(p.x + 18, p.y - 20);
      ctx.fill();
    }

    // Next color indicator dot
    if (!isGray) {
      const nextWlIdx = (p.w + 1) % 4;
      ctx.fillStyle = this.getWLColor(nextWlIdx);
      ctx.beginPath();
      ctx.arc(p.x + 28, p.y - 2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.restore();
  }

  drawPowerUp(ctx, pu) {
    const types = [
      { color: '#00e8dc', label: 'LENS' },
      { color: '#d0d8f0', label: 'SHIELD' },
      { color: '#ffd200', label: 'SURGE' },
    ];
    const t = types[pu.t] || types[0];
    const cx = pu.x + 10, cy = pu.y + 10;
    const pulse = Math.sin(this.time * 3) * 0.15 + 1;
    const half = 10 * pulse;

    ctx.save();

    // Glow
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = t.color;
    ctx.beginPath();
    ctx.arc(cx, cy, half + 6, 0, Math.PI * 2);
    ctx.fill();

    // Diamond
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = t.color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - half);
    ctx.lineTo(cx + half, cy);
    ctx.lineTo(cx, cy + half);
    ctx.lineTo(cx - half, cy);
    ctx.closePath();
    ctx.fill();

    // Outline
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.7;
    ctx.stroke();

    // Label
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = t.color;
    ctx.font = 'bold 8px "Outfit"';
    ctx.textAlign = 'center';
    ctx.fillText(t.label, cx, cy + half + 12);

    ctx.restore();
  }

  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16),
    } : { r: 255, g: 255, b: 255 };
  }
}

window.GameRenderer = GameRenderer;
