/**
 * Disk Ball
 * Throw 3.5" floppies into the office trash can.
 * Loaded by index.html. Every graphic is drawn in code.
 *
 * Drag the floppy in the direction of the throw, then release.
 *
 * Sections:
 *   1. Constants
 *   2. Scene lifecycle
 *   3. Cubicle drawing
 *   4. Floppy textures
 *   5. Aim and throw
 *   6. Scoring and the round
 *   7. HUD
 */

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

// Flip this on to draw Arcade bodies while tuning the mouth and rims.
const DEBUG = false;

const WIDTH = 960;
const HEIGHT = 600;
const GRAVITY = 1100;
const STEP = 1 / 60;
const ROUND_SIZE = 5;

const PAL = {
  wall: 0xd9c7aa,
  partition: 0xcbb892,
  baseboard: 0x7d6e5c,
  carpet: 0x6a7882,
  carpetLine: 0x5c6972,
  desk: 0x946b42,
  deskFront: 0x6e4e32,
  deskLeg: 0x5a3f2c,
  ink: 0x241c16,
  bezel: 0x3a3f46,
  bezelInner: 0x2a2e33,
  screen: 0x14281a,
  can: 0x6a7078,
  canShade: 0x4a5058,
  rim: 0x2c3136,
  rimLit: 0x9aa1a8,
  mouth: 0x16181b,
  label: 0xf4efe6,
  shutter: 0xc4c8ce,
  slot: 0x22262b,
  paper: 0xf4efe6
};

// Shared by the drawing and the colliders so the hole you see is the hole you score in.
const LAYOUT = {
  floorY: 520,
  deskX: 48,
  deskY: 408,
  deskW: 456,
  deskH: 18,
  spawnX: 456,
  monitorX: 76,
  monitorY: 258,
  monitorW: 176,
  monitorH: 136,
  canX: 790,
  rimY: 350,
  mouthHalf: 32,
  mouthLine: 366,
  outerRx: 72,
  outerRy: 18,
  innerRx: 34,
  innerRy: 10
};

// The physics circle is smaller than the art and bottom-aligned, so the disk
// can drop through the mouth while still sitting flush on the desk.
const DISK = {
  size: 44,
  radius: 15,
  offsetX: 7,
  offsetY: 14
};

const AIM = {
  minPull: 28,
  maxPull: 168,
  minSpeed: 360,
  maxSpeed: 960
};

const DEPTH = {
  room: 0,
  desk: 2,
  monitor: 3,
  canBack: 4,
  diskIn: 5,
  canFront: 8,
  disk: 10,
  aim: 12,
  hud: 20,
  callout: 30,
  overlay: 40
};

const SHELLS = [
  { key: 'floppy-black', color: 0x2c2e33 },
  { key: 'floppy-blue', color: 0x3f5e86 },
  { key: 'floppy-beige', color: 0xd4c4a0 },
  { key: 'floppy-red', color: 0x8d4542 }
];

const UI_FONT = 'Courier New, Courier, monospace';

// ---------------------------------------------------------------------------
// 2. Scene
// ---------------------------------------------------------------------------

class OfficeScene extends Phaser.Scene {
  constructor() {
    super('office');
    this.phase = 'ready';
    this.score = 0;
    this.disksLeft = ROUND_SIZE;
    this.shellIndex = 0;
    this.disk = null;
    this.boundColliders = [];
    this.drag = null;
    this.flightMs = 0;
    this.cursor = '';
    this.callout = null;
  }

  create() {
    this.drawRoom();
    this.drawDesk();
    this.drawMonitor();
    this.drawCan();
    this.makeSolids();
    this.makeFloppyTextures();

    this.aimGfx = this.add.graphics().setDepth(DEPTH.aim);
    this.createHud();

    this.input.mouse.disableContextMenu();
    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);

    this.spawnDisk();
  }

  update(time, delta) {
    this.updateCursor();
    if (this.phase !== 'flying' || !this.disk) return;

    this.flightMs += delta;
    const disk = this.disk;

    if (this.crossedMouth(disk)) {
      this.resolveScore();
      return;
    }

    if (disk.x < -90 || disk.x > WIDTH + 90 || disk.y > HEIGHT + 40) {
      this.resolveMiss();
      return;
    }

    const body = disk.body;
    const bottom = body.center.y + body.halfHeight;
    const overDesk = disk.x >= LAYOUT.deskX && disk.x <= LAYOUT.deskX + LAYOUT.deskW;
    const onDesk = overDesk && bottom >= LAYOUT.deskY - 6 && bottom <= LAYOUT.deskY + 36;
    const onMonitor = disk.x >= LAYOUT.monitorX
      && disk.x <= LAYOUT.monitorX + LAYOUT.monitorW
      && bottom >= LAYOUT.monitorY - 6
      && bottom <= LAYOUT.monitorY + 24;
    const onFloor = bottom >= LAYOUT.floorY - 8;
    const againstCan = (disk.getData('hitRim') || disk.getData('surface') === 'can') && bottom >= LAYOUT.rimY;
    // Only settle on a real surface. A low vertical speed in mid-air is just the top of the arc.
    const supported = body.blocked.down && (onDesk || onFloor || onMonitor || againstCan);
    if (supported && this.flightMs > 160) {
      body.velocity.x *= 0.86;
      if (Math.hypot(body.velocity.x, body.velocity.y) < 72) {
        this.resolveMiss();
      }
    } else if (this.flightMs > 4500) {
      this.resolveMiss();
    }
  }

  // -------------------------------------------------------------------------
  // 3. Cubicle
  // -------------------------------------------------------------------------

  drawRoom() {
    const g = this.add.graphics().setDepth(DEPTH.room);
    const floorY = LAYOUT.floorY;

    g.fillStyle(PAL.partition, 1);
    g.fillRect(0, 0, 22, floorY);
    g.fillRect(WIDTH - 22, 0, 22, floorY);

    g.fillStyle(PAL.baseboard, 1);
    g.fillRect(0, floorY - 26, WIDTH, 26);
    g.lineStyle(2, PAL.ink, 1);
    g.beginPath();
    g.moveTo(0, floorY - 26);
    g.lineTo(WIDTH, floorY - 26);
    g.strokePath();

    g.fillStyle(PAL.carpet, 1);
    g.fillRect(0, floorY, WIDTH, HEIGHT - floorY);
    g.lineStyle(2, PAL.carpetLine, 1);
    g.beginPath();
    g.moveTo(0, floorY + 18);
    g.lineTo(WIDTH, floorY + 18);
    g.moveTo(0, floorY + 46);
    g.lineTo(WIDTH, floorY + 46);
    g.strokePath();
  }

  drawDesk() {
    const g = this.add.graphics().setDepth(DEPTH.desk);
    const { deskX: x, deskY: y, deskW: w, deskH: h } = LAYOUT;

    g.fillStyle(PAL.deskLeg, 1);
    g.fillRect(x + 28, y + h, 16, LAYOUT.floorY - 26 - (y + h));
    g.fillRect(x + w - 52, y + h, 16, LAYOUT.floorY - 26 - (y + h));

    g.fillStyle(PAL.desk, 1);
    g.fillRect(x, y, w, h);
    g.fillStyle(PAL.deskFront, 1);
    g.fillRect(x, y + h, w, 10);

    g.lineStyle(2, PAL.ink, 1);
    g.strokeRect(x, y, w, h + 10);
    g.lineStyle(1, 0xc49262, 0.7);
    g.beginPath();
    g.moveTo(x + 16, y + 6);
    g.lineTo(x + w - 16, y + 6);
    g.strokePath();
  }

  drawMonitor() {
    const g = this.add.graphics().setDepth(DEPTH.monitor);
    const x = LAYOUT.monitorX;
    const y = LAYOUT.monitorY;
    const w = LAYOUT.monitorW;
    const h = LAYOUT.monitorH;

    g.fillStyle(PAL.bezel, 1);
    g.fillRoundedRect(x, y, w, h, 6);
    g.lineStyle(2, PAL.ink, 1);
    g.strokeRoundedRect(x, y, w, h, 6);

    const sx = x + 14;
    const sy = y + 14;
    const sw = w - 28;
    const sh = h - 40;
    g.fillStyle(PAL.bezelInner, 1);
    g.fillRect(sx - 3, sy - 3, sw + 6, sh + 6);
    g.fillStyle(PAL.screen, 1);
    g.fillRect(sx, sy, sw, sh);

    g.fillStyle(0x000000, 0.18);
    for (let row = sy + 3; row < sy + sh; row += 4) {
      g.fillRect(sx, row, sw, 1);
    }

    g.fillStyle(0x8fea72, 1);
    g.fillCircle(x + w - 18, y + h - 16, 4);
    g.lineStyle(1, PAL.ink, 1);
    g.strokeCircle(x + w - 18, y + h - 16, 4);

    g.fillStyle(PAL.bezel, 1);
    g.fillRect(x + w / 2 - 16, y + h, 32, 12);
    g.fillRect(x + w / 2 - 36, y + h + 12, 72, 8);
    g.lineStyle(2, PAL.ink, 1);
    g.strokeRect(x + w / 2 - 36, y + h + 12, 72, 8);

    this.crtText = this.add.text(sx + 10, sy + 12, 'C:\\>', {
      fontFamily: UI_FONT,
      fontSize: '16px',
      color: '#b6ff8a'
    }).setDepth(DEPTH.monitor).setResolution(2);

    this.time.addEvent({
      delay: 520,
      loop: true,
      callback: () => {
        const showing = this.crtText.text.endsWith('_');
        this.crtText.setText(showing ? 'C:\\>' : 'C:\\>_');
      }
    });
  }

  drawCan() {
    const back = this.add.graphics().setDepth(DEPTH.canBack);
    const front = this.add.graphics().setDepth(DEPTH.canFront);
    const cx = LAYOUT.canX;
    const ry = LAYOUT.rimY;
    const top = ry + 8;
    const bot = LAYOUT.floorY - 2;
    const topHalf = 76;
    const botHalf = 58;

    back.fillStyle(0x000000, 0.15);
    back.fillEllipse(cx, bot, botHalf * 2.2, 14);

    back.fillStyle(PAL.can, 1);
    back.beginPath();
    back.moveTo(cx - topHalf, top);
    back.lineTo(cx + topHalf, top);
    back.lineTo(cx + botHalf, bot);
    back.lineTo(cx - botHalf, bot);
    back.closePath();
    back.fillPath();

    back.fillStyle(PAL.canShade, 1);
    back.beginPath();
    back.moveTo(cx + 10, top);
    back.lineTo(cx + topHalf, top);
    back.lineTo(cx + botHalf, bot);
    back.lineTo(cx + 6, bot);
    back.closePath();
    back.fillPath();

    back.lineStyle(2, PAL.ink, 1);
    back.beginPath();
    back.moveTo(cx - topHalf, top);
    back.lineTo(cx + topHalf, top);
    back.lineTo(cx + botHalf, bot);
    back.lineTo(cx - botHalf, bot);
    back.closePath();
    back.strokePath();

    // Far lip, then the dark opening. The disk drops between this and the near lip.
    back.lineStyle(8, PAL.rim, 1);
    this.strokeArc(back, cx, ry, LAYOUT.outerRx, LAYOUT.outerRy, Math.PI, Math.PI * 2, 18);

    back.fillStyle(PAL.mouth, 1);
    back.fillEllipse(cx, ry + 2, LAYOUT.innerRx * 2, LAYOUT.innerRy * 2);
    back.fillStyle(0x0c0d0f, 1);
    back.fillEllipse(cx, ry + 6, LAYOUT.innerRx * 1.5, LAYOUT.innerRy * 1.2);

    front.lineStyle(9, PAL.rim, 1);
    this.strokeArc(front, cx, ry, LAYOUT.outerRx, LAYOUT.outerRy, 0, Math.PI, 18);
    front.lineStyle(3, PAL.rimLit, 1);
    this.strokeArc(front, cx, ry + 2, LAYOUT.outerRx - 8, LAYOUT.outerRy - 4, 0.25, Math.PI - 0.25, 14);
  }

  strokeArc(g, cx, cy, rx, ry, a0, a1, steps) {
    g.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = a0 + ((a1 - a0) * i) / steps;
      const x = cx + Math.cos(t) * rx;
      const y = cy + Math.sin(t) * ry;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokePath();
  }

  // Invisible static rectangles. Arcade debug draws them when DEBUG is on.
  solid(x, y, w, h) {
    const block = this.add.rectangle(x, y, w, h, 0xff00ff, DEBUG ? 0.25 : 0);
    block.setVisible(DEBUG);
    this.physics.add.existing(block, true);
    block.body.updateFromGameObject();
    return block;
  }

  makeSolids() {
    const floorH = 80;
    this.floor = this.solid(WIDTH / 2, LAYOUT.floorY + floorH / 2, WIDTH, floorH);

    // Taller than the wooden top so a fast disk cannot tunnel through it.
    this.deskBody = this.solid(
      LAYOUT.deskX + LAYOUT.deskW / 2,
      LAYOUT.deskY + 28,
      LAYOUT.deskW,
      56
    );

    this.monitorBody = this.solid(
      LAYOUT.monitorX + LAYOUT.monitorW / 2,
      LAYOUT.monitorY + LAYOUT.monitorH / 2,
      LAYOUT.monitorW,
      LAYOUT.monitorH
    );

    const rimW = 18;
    const rimH = 16;
    this.rimL = this.solid(LAYOUT.canX - LAYOUT.mouthHalf - rimW / 2, LAYOUT.rimY, rimW, rimH);
    this.rimR = this.solid(LAYOUT.canX + LAYOUT.mouthHalf + rimW / 2, LAYOUT.rimY, rimW, rimH);

    const wallW = 16;
    const wallTop = LAYOUT.rimY + 10;
    const wallH = LAYOUT.floorY - wallTop;
    const wallY = wallTop + wallH / 2;
    // Walls sit outside the mouth, so a centered shot falls in and a wide shot bounces.
    this.wallL = this.solid(LAYOUT.canX - 68, wallY, wallW, wallH);
    this.wallR = this.solid(LAYOUT.canX + 68, wallY, wallW, wallH);
  }

  // -------------------------------------------------------------------------
  // 4. Floppies
  // -------------------------------------------------------------------------

  makeFloppyTextures() {
    SHELLS.forEach((shell) => this.drawFloppy(shell.key, shell.color));
  }

  drawFloppy(key, shell) {
    const g = this.make.graphics({ add: false });
    const s = DISK.size;

    g.fillStyle(shell, 1);
    g.fillRoundedRect(1, 1, s - 2, s - 2, 5);
    g.lineStyle(2, PAL.ink, 1);
    g.strokeRoundedRect(1, 1, s - 2, s - 2, 5);

    g.fillStyle(PAL.label, 1);
    g.fillRoundedRect(6, 5, s - 12, 18, 2);
    g.lineStyle(1, PAL.ink, 1);
    g.strokeRoundedRect(6, 5, s - 12, 18, 2);

    g.lineStyle(1, 0xc9bfb0, 1);
    g.beginPath();
    g.moveTo(10, 11);
    g.lineTo(s - 10, 11);
    g.moveTo(10, 15);
    g.lineTo(s - 16, 15);
    g.moveTo(10, 19);
    g.lineTo(s - 20, 19);
    g.strokePath();

    // Metal shutter, slid shut, with the dark window still visible.
    g.fillStyle(PAL.shutter, 1);
    g.fillRect(10, 28, 24, 13);
    g.lineStyle(2, PAL.ink, 1);
    g.strokeRect(10, 28, 24, 13);
    g.fillStyle(PAL.slot, 1);
    g.fillRect(16, 30, 10, 9);
    g.fillStyle(0xe4e8ec, 1);
    g.fillRect(12, 30, 3, 9);

    g.fillStyle(shell, 1);
    g.fillRect(s - 8, 4, 4, 5);

    g.generateTexture(key, s, s);
    g.destroy();
  }

  spawnDisk() {
    const shell = SHELLS[this.shellIndex % SHELLS.length];
    this.shellIndex += 1;
    const y = LAYOUT.deskY - DISK.size / 2 - 1;
    const disk = this.physics.add.sprite(LAYOUT.spawnX, y, shell.key);
    disk.setCircle(DISK.radius, DISK.offsetX, DISK.offsetY);
    disk.body.updateFromGameObject();
    disk.setDepth(DEPTH.disk);
    disk.setBounce(0.28);
    disk.setCollideWorldBounds(false);
    disk.body.moves = false;
    disk.body.allowGravity = false;
    disk.setData('hitRim', false);
    disk.setData('surface', null);

    this.disk = disk;
    this.bindDisk(disk);
    this.phase = 'ready';
    this.drag = null;
    this.aimGfx.clear();
  }

  bindDisk(disk) {
    this.clearBindings();
    const soft = (floppy) => {
      floppy.setBounce(0.28);
      return true;
    };
    const rim = (floppy) => {
      floppy.setBounce(0.55);
      return true;
    };
    this.boundColliders = [
      this.physics.add.collider(disk, this.floor, (f) => f.setData('surface', 'floor'), soft),
      this.physics.add.collider(disk, this.deskBody, (f) => f.setData('surface', 'desk'), soft),
      this.physics.add.collider(disk, this.monitorBody, (f) => f.setData('surface', 'monitor'), soft),
      this.physics.add.collider(disk, this.rimL, (f) => f.setData('hitRim', true), rim),
      this.physics.add.collider(disk, this.rimR, (f) => f.setData('hitRim', true), rim),
      this.physics.add.collider(disk, this.wallL, (f) => f.setData('surface', 'can'), soft),
      this.physics.add.collider(disk, this.wallR, (f) => f.setData('surface', 'can'), soft)
    ];
  }

  clearBindings() {
    this.boundColliders.forEach((collider) => collider.destroy());
    this.boundColliders = [];
  }

  // -------------------------------------------------------------------------
  // 5. Aim and throw
  // -------------------------------------------------------------------------

  onPointerDown(pointer) {
    if (pointer.rightButtonDown()) return;
    if (this.phase === 'roundover') {
      this.restartRound();
      return;
    }
    if (this.phase !== 'ready' || !this.disk) return;
    const dist = Phaser.Math.Distance.Between(pointer.x, pointer.y, this.disk.x, this.disk.y);
    if (dist > 64) return;
    this.phase = 'aiming';
    this.drag = { x: pointer.x, y: pointer.y };
    this.drawAim(pointer);
  }

  onPointerMove(pointer) {
    if (this.phase === 'aiming') this.drawAim(pointer);
  }

  onPointerUp(pointer) {
    if (this.phase !== 'aiming') return;
    const pull = this.measurePull(pointer);
    this.aimGfx.clear();
    this.drag = null;
    if (pull.dist < AIM.minPull) {
      this.phase = 'ready';
      return;
    }
    this.launch(pull.vx, pull.vy);
  }

  measurePull(pointer) {
    const dx = pointer.x - this.drag.x;
    const dy = pointer.y - this.drag.y;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, AIM.maxPull);
    const speed = Phaser.Math.Linear(AIM.minSpeed, AIM.maxSpeed, clamped / AIM.maxPull);
    const angle = Math.atan2(dy, dx);
    return {
      dist,
      speed,
      angle,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed
    };
  }

  drawAim(pointer) {
    this.aimGfx.clear();
    if (!this.disk || !this.drag) return;
    const pull = this.measurePull(pointer);
    if (pull.dist < 6) return;

    const charged = pull.dist >= AIM.minPull;
    const reach = 28 + Math.min(pull.dist, AIM.maxPull) * 0.55;
    const x0 = this.disk.x;
    const y0 = this.disk.y;
    const x1 = x0 + Math.cos(pull.angle) * reach;
    const y1 = y0 + Math.sin(pull.angle) * reach;

    this.aimGfx.lineStyle(3, PAL.ink, charged ? 0.9 : 0.35);
    this.aimGfx.beginPath();
    this.aimGfx.moveTo(x0, y0);
    this.aimGfx.lineTo(x1, y1);
    this.aimGfx.strokePath();

    if (!charged) return;

    // Same integrator as Arcade Physics: fixed 1/60 step, gravity then position.
    let x = x0;
    let y = y0;
    let vx = pull.vx;
    let vy = pull.vy;
    const deskRight = LAYOUT.deskX + LAYOUT.deskW;
    const bottomPad = DISK.size / 2;

    for (let i = 1; i <= 72; i++) {
      vy += GRAVITY * STEP;
      x += vx * STEP;
      y += vy * STEP;

      const bottom = y + bottomPad;
      const overDesk = x >= LAYOUT.deskX && x <= deskRight;
      if (overDesk && bottom >= LAYOUT.deskY) break;
      if (bottom >= LAYOUT.floorY) break;

      const belowRim = y > LAYOUT.rimY + 4;
      const withinCan = Math.abs(x - LAYOUT.canX) < LAYOUT.outerRx - 6;
      const inMouth = Math.abs(x - LAYOUT.canX) <= LAYOUT.mouthHalf;
      if (belowRim && withinCan && !inMouth) break;

      if (i % 3 === 0) {
        const fade = 1 - i / 78;
        this.aimGfx.fillStyle(PAL.paper, fade);
        this.aimGfx.fillCircle(x, y, 3.4);
        this.aimGfx.lineStyle(1.5, PAL.ink, fade);
        this.aimGfx.strokeCircle(x, y, 3.4);
      }
    }
  }

  launch(vx, vy) {
    const disk = this.disk;
    if (!disk || (this.phase !== 'ready' && this.phase !== 'aiming')) return;

    this.phase = 'flying';
    this.flightMs = 0;
    this.hint.setVisible(false);
    this.disksLeft -= 1;
    this.refreshHud();

    disk.setData('hitRim', false);
    disk.setData('surface', null);
    disk.body.moves = true;
    disk.body.allowGravity = true;
    disk.setVelocity(vx, vy);
    const spin = Math.sign(vx || 1) * Phaser.Math.Clamp(Math.abs(vx) * 0.55, 140, 620);
    disk.setAngularVelocity(spin);
    this.aimGfx.clear();
  }

  // -------------------------------------------------------------------------
  // 6. Scoring
  // -------------------------------------------------------------------------

  crossedMouth(disk) {
    const body = disk.body;
    const prevY = body.prev.y + body.halfHeight;
    const y = body.center.y;
    const x = body.center.x;
    const inOpening = Math.abs(x - LAYOUT.canX) <= LAYOUT.mouthHalf;
    const falling = body.velocity.y > 40;
    const crossed = prevY < LAYOUT.mouthLine && y >= LAYOUT.mouthLine;
    return inOpening && falling && crossed;
  }

  resolveScore() {
    const disk = this.disk;
    if (!disk || this.phase !== 'flying') return;
    this.phase = 'resolving';

    const swish = !disk.getData('hitRim');
    const spin = disk.body.velocity.x >= 0 ? 200 : -200;
    this.clearBindings();
    this.physics.world.disable(disk);

    this.score += 1;
    this.refreshHud();
    this.punchScore();
    disk.setDepth(DEPTH.diskIn);
    this.say(swish ? 'Swish!' : 'Clank', LAYOUT.canX, LAYOUT.rimY - 52);

    this.tweens.add({
      targets: disk,
      y: LAYOUT.rimY + 78,
      angle: disk.angle + spin,
      scaleX: 0.62,
      scaleY: 0.62,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        disk.destroy();
        if (this.disk === disk) this.disk = null;
        this.afterShot();
      }
    });
  }

  resolveMiss() {
    const disk = this.disk;
    if (!disk || this.phase !== 'flying') return;
    this.phase = 'resolving';

    const message = this.missText(disk);
    const x = Phaser.Math.Clamp(disk.x, 90, WIDTH - 90);
    const y = Phaser.Math.Clamp(disk.y - 28, 90, HEIGHT - 48);
    this.clearBindings();
    this.physics.world.disable(disk);
    this.say(message, x, y);

    this.tweens.add({
      targets: disk,
      alpha: 0,
      delay: 460,
      duration: 180,
      onComplete: () => {
        disk.destroy();
        if (this.disk === disk) this.disk = null;
        this.afterShot();
      }
    });
  }

  missText(disk) {
    if (disk.getData('hitRim')) return 'Off the rim';
    const surface = disk.getData('surface');
    if (surface === 'can') return 'Clank';
    if (surface === 'desk') return 'On the desk';
    if (surface === 'monitor') return 'On the monitor';
    return 'Brick';
  }

  afterShot() {
    if (this.phase !== 'resolving') return;
    if (this.disksLeft <= 0) {
      this.phase = 'roundover';
      this.roundText.setText(this.score + ' / ' + ROUND_SIZE + ' in the can\nClick to restart');
      this.roundText.setVisible(true);
      this.hint.setVisible(false);
      return;
    }
    this.spawnDisk();
  }

  restartRound() {
    if (this.callout) {
      this.callout.destroy();
      this.callout = null;
    }
    this.clearBindings();
    if (this.disk) {
      this.disk.destroy();
      this.disk = null;
    }
    this.score = 0;
    this.disksLeft = ROUND_SIZE;
    this.shellIndex = 0;
    this.roundText.setVisible(false);
    this.hint.setVisible(true);
    this.scoreText.setScale(1);
    this.refreshHud();
    this.spawnDisk();
  }

  // -------------------------------------------------------------------------
  // 7. HUD
  // -------------------------------------------------------------------------

  createHud() {
    const panel = this.add.graphics().setDepth(DEPTH.hud);
    panel.fillStyle(PAL.paper, 1);
    panel.fillRoundedRect(16, 14, 188, 58, 4);
    panel.lineStyle(2, PAL.ink, 1);
    panel.strokeRoundedRect(16, 14, 188, 58, 4);

    const style = {
      fontFamily: UI_FONT,
      fontSize: '18px',
      color: '#241c16',
      fontStyle: 'bold'
    };
    this.scoreText = this.add.text(28, 20, '', style).setDepth(DEPTH.hud).setResolution(2);
    this.diskText = this.add.text(28, 44, '', style).setDepth(DEPTH.hud).setResolution(2);

    this.hint = this.add.text(WIDTH / 2, HEIGHT - 28, 'Drag to aim the arc, release to throw', {
      fontFamily: UI_FONT,
      fontSize: '16px',
      color: '#f4efe6'
    }).setOrigin(0.5).setDepth(DEPTH.hud).setResolution(2);

    this.roundText = this.add.text(WIDTH / 2, 188, '', {
      fontFamily: UI_FONT,
      fontSize: '26px',
      color: '#241c16',
      align: 'center',
      backgroundColor: '#f4efe6',
      padding: { x: 18, y: 12 }
    }).setOrigin(0.5).setDepth(DEPTH.overlay).setResolution(2).setVisible(false);
    this.roundText.setLineSpacing(6);

    this.refreshHud();
  }

  refreshHud() {
    this.scoreText.setText('Score  ' + this.score);
    this.diskText.setText('Disks  ' + this.disksLeft);
  }

  punchScore() {
    this.scoreText.setScale(1);
    this.tweens.add({
      targets: this.scoreText,
      scaleX: 1.12,
      scaleY: 1.12,
      duration: 90,
      yoyo: true
    });
  }

  say(message, x, y) {
    if (this.callout) this.callout.destroy();
    const text = this.add.text(x, y, message, {
      fontFamily: UI_FONT,
      fontSize: '28px',
      color: '#241c16',
      fontStyle: 'bold',
      backgroundColor: '#f4efe6',
      padding: { x: 10, y: 4 }
    }).setOrigin(0.5).setDepth(DEPTH.callout).setResolution(2);
    this.callout = text;
    this.tweens.add({
      targets: text,
      y: y - 34,
      alpha: 0,
      delay: 280,
      duration: 620,
      ease: 'Quad.easeOut',
      onComplete: () => {
        if (this.callout === text) this.callout = null;
        text.destroy();
      }
    });
  }

  updateCursor() {
    let cursor = 'default';
    if (this.phase === 'roundover') {
      cursor = 'pointer';
    } else if (this.phase === 'aiming') {
      cursor = 'crosshair';
    } else if (this.phase === 'ready' && this.disk) {
      const pointer = this.input.activePointer;
      const near = Phaser.Math.Distance.Between(pointer.x, pointer.y, this.disk.x, this.disk.y) < 64;
      cursor = near ? 'pointer' : 'default';
    }
    if (cursor !== this.cursor) {
      this.cursor = cursor;
      this.input.setDefaultCursor(cursor);
    }
  }
}

const config = {
  type: Phaser.AUTO,
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: '#d9c7aa',
  parent: document.body,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: GRAVITY },
      debug: DEBUG,
      fps: 60,
      fixedStep: true
    }
  },
  scene: OfficeScene
};

new Phaser.Game(config);
