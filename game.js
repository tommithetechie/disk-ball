/**
 * Disk Ball
 * Throw 3.5" floppies into the office trash can.
 * Loaded by index.html. The room is drawn in code. The disk and can are photos.
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
  towerX: 268,
  towerW: 78,
  towerH: 146,
  canX: 790,
  rimY: 350,
  mouthHalf: 32,
  mouthLine: 366,
  outerRx: 72,
  outerRy: 18,
  innerRx: 34,
  innerRy: 10
};

// Fractions of the cropped tower.png: monitor, case, glass, and the floppy slot.
const SETUP = {
  monitor: { x: 0.052, y: 0, w: 0.518, h: 0.745 },
  tower: { x: 0.625, y: 0.116, w: 0.374, h: 0.629 },
  screen: { x: 0.112, y: 0.106, w: 0.394, h: 0.346 },
  slot: { x: 0.699, y: 0.398, w: 0.242, h: 0.029 }
};

// The physics circle is smaller than the art and bottom-aligned, so the disk
// can drop through the mouth while still sitting flush on the desk.
const DISK = {
  size: 28,
  radius: 10,
  offsetX: 4,
  offsetY: 9
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
    this.disk = null;
    this.boundColliders = [];
    this.drag = null;
    this.flightMs = 0;
    this.cursor = '';
    this.callout = null;
  }

  preload() {
    this.load.image('floppy', 'assets/white-disk.png');
    this.load.image('trashcan', 'assets/trash-can.png');
    this.load.image('tower', 'assets/tower.png');
    this.load.image('desk', 'assets/desk.png');
  }

  create() {
    const floppyFrame = this.cutCheckerboard('floppy');
    const canFrame = this.cutCheckerboard('trashcan');
    this.textures.get('floppy').add('disk', 0, floppyFrame.x, floppyFrame.y, floppyFrame.w, floppyFrame.h);
    this.textures.get('trashcan').add('can', 0, canFrame.x, canFrame.y, canFrame.w, canFrame.h);
    const deskFrame = this.cutCheckerboard('desk');
    const towerFrame = this.cutCheckerboard('tower');
    this.textures.get('desk').add('top', 0, deskFrame.x, deskFrame.y, deskFrame.w, deskFrame.h);
    this.textures.get('tower').add('setup', 0, towerFrame.x, towerFrame.y, towerFrame.w, towerFrame.h);
    this.canFrame = canFrame;
    this.deskFrame = deskFrame;
    this.towerFrame = towerFrame;

    this.drawRoom();
    this.placeDesk();
    this.placeSetup();
    this.placeCan();
    this.makeSolids();

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

    if (disk.getData('seekingSlot')) {
      if (this.pullTowardSlot(disk, delta)) {
        this.resolveDrive();
        return;
      }
    }

    if (disk.x < -90 || disk.x > WIDTH + 90 || disk.y > HEIGHT + 40) {
      this.resolveMiss();
      return;
    }

    const body = disk.body;
    const bottom = body.center.y + body.halfHeight;
    const overDesk = disk.x >= LAYOUT.deskX && disk.x <= LAYOUT.deskX + LAYOUT.deskW;
    const onDesk = overDesk && bottom >= LAYOUT.deskY - 6 && bottom <= LAYOUT.deskY + 36;
    const onMonitor = disk.x >= this.monitorHit.x
      && disk.x <= this.monitorHit.x + this.monitorHit.w
      && bottom >= this.monitorHit.y - 6
      && bottom <= this.monitorHit.y + 24;
    const onTower = disk.x >= this.towerHit.x
      && disk.x <= this.towerHit.x + this.towerHit.w
      && bottom >= this.towerHit.y - 6
      && bottom <= this.towerHit.y + 24;
    const onFloor = bottom >= LAYOUT.floorY - 8;
    const againstCan = (disk.getData('hitRim') || disk.getData('surface') === 'can') && bottom >= LAYOUT.rimY;
    // Only settle on a real surface. A low vertical speed in mid-air is just the top of the arc.
    // A disk already steered at the drive keeps flying until it reaches the slot.
    const supported = body.blocked.down && (onDesk || onFloor || onMonitor || onTower || againstCan);
    if (!disk.getData('seekingSlot') && supported && this.flightMs > 160) {
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

  placeDesk() {
    const frame = this.deskFrame;
    const displayW = 450;
    const naturalH = displayW * (frame.h / frame.w);
    // Wider than the photo, and a little taller so the top has more depth.
    const displayH = naturalH * 0.8;
    const lip = displayH * 0.31;
    const bottom = LAYOUT.floorY + displayH * 0.12;
    const top = bottom - displayH;
    LAYOUT.deskX = 48;
    LAYOUT.deskW = displayW;
    LAYOUT.deskY = top + lip;
    this.deskInset = 28;
    const desk = this.add.image(LAYOUT.deskX + displayW / 2, top + displayH / 2, 'desk', 'top');
    desk.setDisplaySize(displayW, displayH);
    desk.setDepth(DEPTH.desk);
  }

  placeSetup() {
    const frame = this.towerFrame;
    const displayW = 196;
    const displayH = displayW * (frame.h / frame.w);
    const left = LAYOUT.deskX + 36;
    const top = LAYOUT.deskY - this.deskInset - displayH;
    const setup = this.add.image(left + displayW / 2, top + displayH / 2, 'tower', 'setup');
    setup.setDisplaySize(displayW, displayH);
    setup.setDepth(DEPTH.monitor);
    this.setupRect = { left, top, w: displayW, h: displayH };
    this.monitorHit = this.setupPart(SETUP.monitor);
    this.towerHit = this.setupPart(SETUP.tower);
    const deskRight = LAYOUT.deskX + LAYOUT.deskW;
    LAYOUT.spawnX = deskRight - DISK.size / 2 - 72;

    const screen = this.setupPart(SETUP.screen);
    this.crtText = this.add.text(screen.x + 6, screen.y + 6, 'C:\\>', {
      fontFamily: UI_FONT,
      fontSize: '11px',
      color: '#b6ff8a'
    }).setDepth(DEPTH.monitor + 1).setResolution(2);
    this.crtHome = { x: this.crtText.x, y: this.crtText.y };
    this.crtInfected = false;

    this.skull = this.add.graphics().setDepth(DEPTH.monitor + 1).setVisible(false);
    this.drawSkull(this.skull, screen.x + screen.w - 18, screen.y + screen.h - 20);

    this.time.addEvent({
      delay: 520,
      loop: true,
      callback: () => {
        if (this.crtInfected) return;
        const showing = this.crtText.text.endsWith('_');
        this.crtText.setText(showing ? 'C:\\>' : 'C:\\>_');
      }
    });
  }

  setupPart(part) {
    const s = this.setupRect;
    return {
      x: s.left + s.w * part.x,
      y: s.top + s.h * part.y,
      w: s.w * part.w,
      h: s.h * part.h
    };
  }

  drawSkull(g, x, y) {
    g.fillStyle(0xd7ffb0, 1);
    g.fillCircle(x, y, 11);
    g.fillStyle(PAL.screen, 1);
    g.fillRect(x - 7, y - 4, 4, 4);
    g.fillRect(x + 3, y - 4, 4, 4);
    g.fillRect(x - 1, y + 2, 2, 3);
    g.fillRect(x - 6, y + 7, 12, 3);
    g.fillStyle(0xd7ffb0, 1);
    g.fillRect(x - 4, y + 7, 1, 3);
    g.fillRect(x - 1, y + 7, 1, 3);
    g.fillRect(x + 2, y + 7, 1, 3);
  }

  // The drive slot on the tower.png case.
  floppySlotRect() {
    const slot = this.setupPart(SETUP.slot);
    return {
      x: slot.x,
      y: slot.y,
      w: slot.w,
      h: slot.h,
      cx: slot.x + slot.w / 2,
      cy: slot.y + slot.h / 2
    };
  }

  // The photos bake in a checkerboard. Clear only the background connected to the edge.
  cutCheckerboard(key) {
    const source = this.textures.get(key).getSourceImage();
    const w = source.width;
    const h = source.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0);
    const image = ctx.getImageData(0, 0, w, h);
    const data = image.data;
    const open = new Uint8Array(w * h);
    const at = (x, y) => y * w + x;
    for (let i = 0; i < w * h; i++) {
      const p = i * 4;
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      if (Math.abs(r - g) < 18 && Math.abs(g - b) < 18 && r > 198) open[i] = 1;
    }
    const stack = [];
    const push = (x, y) => {
      const i = at(x, y);
      if (!open[i]) return;
      open[i] = 0;
      stack.push(i);
    };
    for (let x = 0; x < w; x++) {
      push(x, 0);
      push(x, h - 1);
    }
    for (let y = 0; y < h; y++) {
      push(0, y);
      push(w - 1, y);
    }
    while (stack.length) {
      const i = stack.pop();
      data[i * 4 + 3] = 0;
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0) push(x - 1, y);
      if (x + 1 < w) push(x + 1, y);
      if (y > 0) push(x, y - 1);
      if (y + 1 < h) push(x, y + 1);
    }
    for (let y = 0; y < h; y++) data[(y * w + (w - 1)) * 4 + 3] = 0;
    ctx.putImageData(image, 0, 0);

    const rowCount = new Uint32Array(h);
    const colCount = new Uint32Array(w);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] === 0) continue;
        rowCount[y] += 1;
        colCount[x] += 1;
      }
    }
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < h; y++) {
      if (rowCount[y] < 24) continue;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    for (let x = 0; x < w; x++) {
      if (colCount[x] < 24) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    this.textures.remove(key);
    this.textures.addCanvas(key, canvas);
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  placeCan() {
    const canH = 118;
    const bottom = LAYOUT.floorY - 2;
    const top = bottom - canH;
    const canW = canH * (this.canFrame.w / this.canFrame.h);
    LAYOUT.outerRy = 11;
    LAYOUT.outerRx = canW / 2;
    LAYOUT.rimY = top + LAYOUT.outerRy;
    LAYOUT.mouthHalf = 20;
    LAYOUT.mouthLine = LAYOUT.rimY + 10;
    LAYOUT.innerRx = 21;
    LAYOUT.innerRy = 6;
    const can = this.add.image(LAYOUT.canX, bottom - canH / 2, 'trashcan', 'can');
    can.setDisplaySize(canW, canH);
    can.setDepth(DEPTH.canFront);
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
      this.monitorHit.x + this.monitorHit.w / 2,
      this.monitorHit.y + this.monitorHit.h / 2,
      this.monitorHit.w,
      this.monitorHit.h
    );

    this.towerBody = this.solid(
      this.towerHit.x + this.towerHit.w / 2,
      this.towerHit.y + this.towerHit.h / 2,
      this.towerHit.w,
      this.towerHit.h
    );

    const rimW = 18;
    const rimH = 16;
    this.rimL = this.solid(LAYOUT.canX - LAYOUT.mouthHalf - rimW / 2, LAYOUT.rimY, rimW, rimH);
    this.rimR = this.solid(LAYOUT.canX + LAYOUT.mouthHalf + rimW / 2, LAYOUT.rimY, rimW, rimH);

    const wallW = 14;
    const wallTop = LAYOUT.rimY + 8;
    const wallH = LAYOUT.floorY - wallTop;
    const wallY = wallTop + wallH / 2;
    const wallX = LAYOUT.outerRx * 0.94;
    // Walls sit outside the mouth, so a centered shot falls in and a wide shot bounces.
    this.wallL = this.solid(LAYOUT.canX - wallX, wallY, wallW, wallH);
    this.wallR = this.solid(LAYOUT.canX + wallX, wallY, wallW, wallH);
  }

  // -------------------------------------------------------------------------
  // 4. Floppies
  // -------------------------------------------------------------------------

  spawnDisk() {
    const y = LAYOUT.deskY - 10 - DISK.size / 2;
    const disk = this.physics.add.sprite(LAYOUT.spawnX, y, 'floppy', 'disk');
    const scale = DISK.size / Math.max(disk.frame.width, disk.frame.height);
    disk.setScale(scale);
    // Circle values are in source pixels. Arcade multiplies them by the sprite scale.
    const radius = DISK.radius / scale;
    const drop = DISK.offsetY + DISK.radius - DISK.size / 2;
    const offsetX = disk.frame.width / 2 - radius;
    const offsetY = disk.frame.height / 2 + (drop - DISK.radius) / scale;
    disk.setCircle(radius, offsetX, offsetY);
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
      this.physics.add.collider(disk, this.towerBody, (f) => f.setData('surface', 'tower'), (floppy) => {
        if (floppy.getData('seekingSlot')) {
          floppy.setBounce(0);
          return true;
        }
        return soft(floppy);
      }),
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

  // Once a throw has failed, the disk veers into the floppy slot instead of settling.
  trySlotRedirect(disk) {
    if (disk.getData('driveRolled') || disk.getData('seekingSlot')) return false;
    if (disk.x < 30 || disk.x > WIDTH - 30 || disk.y < 20 || disk.y > HEIGHT - 20) return false;
    const slot = this.floppySlotRect();
    if (Math.hypot(slot.cx - disk.x, slot.cy - disk.y) < 28) return false;
    disk.setData('driveRolled', true);

    const aim = this.slotAim(disk);
    const dx = aim.x - disk.x;
    const dy = aim.y - disk.y;
    const dist = Math.hypot(dx, dy);
    const speed = 540;
    const side = disk.x < this.towerHit.x + this.towerHit.w / 2 ? -1 : 1;
    disk.setData('seekingSlot', true);
    disk.setData('slotSide', side);
    disk.setData('surface', null);
    disk.setVelocity((dx / dist) * speed, (dy / dist) * speed);
    disk.setAngularVelocity(Math.sign(dx || 1) * 360);
    this.flightMs = 0;
    return true;
  }

  // A point just in front of the slot, on the side the disk is coming from.
  slotAim(disk) {
    const slot = this.floppySlotRect();
    const side = disk.getData('slotSide')
      || (disk.x < this.towerHit.x + this.towerHit.w / 2 ? -1 : 1);
    const x = side < 0 ? this.towerHit.x - 22 : this.towerHit.x + this.towerHit.w + 22;
    return { x, y: slot.cy, slot };
  }

  // Nudges the steered disk toward the slot each frame. Gravity still acts.
  pullTowardSlot(disk, delta) {
    const aim = this.slotAim(disk);
    const dx = aim.x - disk.x;
    const dy = aim.y - disk.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 18 && Math.abs(disk.y - aim.y) < 12) return true;

    const speed = 540;
    const vx = (dx / dist) * speed;
    const vy = (dy / dist) * speed;
    const blend = 1 - Math.exp(-delta / 140);
    disk.body.velocity.x += (vx - disk.body.velocity.x) * blend;
    disk.body.velocity.y += (vy - disk.body.velocity.y) * blend;
    return false;
  }

  resolveDrive() {
    const disk = this.disk;
    if (!disk || this.phase !== 'flying') return;
    this.phase = 'resolving';

    const slot = this.floppySlotRect();
    this.clearBindings();
    this.physics.world.disable(disk);
    disk.setDepth(DEPTH.disk);

    this.tweens.add({
      targets: disk,
      x: slot.cx,
      y: slot.cy,
      scaleX: 0.55,
      scaleY: 0.12,
      angle: 0,
      alpha: 0,
      duration: 280,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        disk.destroy();
        if (this.disk === disk) this.disk = null;
        this.playVirus();
      }
    });
  }

  // The disk that finds the slot formats the score.
  playVirus() {
    this.crtInfected = true;
    this.crtText.setPosition(this.crtHome.x, this.crtHome.y);
    this.crtText.setFontSize(10);
    this.crtText.setColor('#ff6a62');
    this.crtText.setText('VIRUS DETECTED');
    this.skull.setVisible(true);
    this.cameras.main.flash(140, 190, 36, 42);
    this.glitchBuzz();

    this.score = 0;
    this.refreshHud();
    this.say('Score formatted.', WIDTH / 2, 128);

    this.time.delayedCall(220, () => {
      if (!this.crtInfected) return;
      this.cameras.main.flash(180, 170, 24, 32);
      this.crtText.setText('A:> FORMAT C:');
    });

    const homeX = this.crtHome.x;
    this.time.addEvent({
      delay: 45,
      repeat: 7,
      callback: () => {
        if (!this.crtInfected) return;
        this.crtText.x = homeX + Phaser.Math.Between(-3, 3);
      }
    });

    this.time.delayedCall(1100, () => {
      const resume = this.phase === 'resolving';
      this.restoreCrt();
      if (resume) this.afterShot();
    });
  }

  restoreCrt() {
    if (!this.crtText) return;
    this.crtInfected = false;
    this.skull.setVisible(false);
    this.crtText.setPosition(this.crtHome.x, this.crtHome.y);
    this.crtText.setFontSize(11);
    this.crtText.setColor('#b6ff8a');
    this.crtText.setText('C:\\>');
  }

  glitchBuzz() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!this.audio) this.audio = new Ctx();
    const ctx = this.audio;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(180, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(55, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.04, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.22);
  }

  resolveMiss() {
    const disk = this.disk;
    if (!disk || this.phase !== 'flying') return;
    if (this.trySlotRedirect(disk)) return;
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
    if (surface === 'tower') return 'On the tower';
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
    this.restoreCrt();
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
