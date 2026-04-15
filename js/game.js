import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { BuildSystem } from './building.js';
import { Bot, rayVsAABB } from './bot.js';
import { WEAPONS } from './weapons.js';

/** Game orchestrates world, player, bots, bullets, HUD. */
export class Game {
  constructor(canvas, mode, hooks = {}) {
    this.canvas = canvas;
    this.mode   = mode;
    this.hooks  = hooks;
    this.paused = false;
    this.stopped = false;
    this.startTime = performance.now();
    this.elapsed = 0;

    // Renderer & scene
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);

    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 400);
    this._resize();

    // Entities
    this.world  = new World(this.scene);
    this.builds = new BuildSystem(this.scene, this.world);
    this.player = new Player(this.camera, this.world);
    this.player.onFire = (origin, dir, wDef, shooter) =>
      this._fireHitscan(origin, dir, wDef, shooter);

    this.bots = [];
    this.allyBots = [];
    this.bullets = [];           // transient tracer sprites

    // input
    this.input = {
      keys: {},
      mouseDX: 0,
      mouseDY: 0,
      mouseDown: false,
    };
    this._bindInput();

    // mode setup
    this._configureMode();
    this._updateHUD();

    // kill feed
    this.killFeedEl = document.getElementById('kill-feed');
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _bindInput() {
    const keydown = (e) => {
      if (this.stopped) return;
      this.input.keys[e.code] = true;

      if (e.code === 'Digit1') this._selectWeapon('pistol');
      if (e.code === 'Digit2') this._selectWeapon('rifle');
      if (e.code === 'Digit3') this._selectWeapon('shotgun');
      if (e.code === 'Digit4') this._selectWeapon('sniper');
      if (e.code === 'Digit5') this._selectWeapon('pickaxe');
      if (e.code === 'KeyQ')   this._selectBuild('wall');
      if (e.code === 'KeyF')   this._selectBuild('floor');
      if (e.code === 'KeyC')   this._selectBuild('ramp');
      if (e.code === 'KeyG')   this._selectBuild(this.player.currentBuild ? null : 'wall');
      if (e.code === 'KeyR')   this.player.reload();
      if (e.code === 'Escape') this.togglePause();

      if (e.code === 'Space') e.preventDefault();
    };
    const keyup = (e) => {
      if (this.stopped) return;
      this.input.keys[e.code] = false;
    };
    const mousedown = (e) => {
      if (this.stopped) return;
      if (this.paused) return;
      if (document.pointerLockElement !== this.canvas) {
        this.canvas.requestPointerLock();
        return;
      }
      if (e.button === 0) this.input.mouseDown = true;
    };
    const mouseup = (e) => {
      if (e.button === 0) this.input.mouseDown = false;
    };
    const mousemove = (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      this.input.mouseDX += e.movementX || 0;
      this.input.mouseDY += e.movementY || 0;
    };
    const wheel = (e) => {
      // cycle weapon
      const order = ['pistol','rifle','shotgun','sniper','pickaxe'];
      let idx = order.indexOf(this.player.currentWeapon);
      if (idx < 0) idx = 0;
      idx = (idx + (e.deltaY > 0 ? 1 : -1) + order.length) % order.length;
      this._selectWeapon(order[idx]);
    };

    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup',   keyup);
    this.canvas.addEventListener('mousedown', mousedown);
    window.addEventListener('mouseup',   mouseup);
    window.addEventListener('mousemove', mousemove);
    this.canvas.addEventListener('wheel', wheel, { passive: true });

    this._unbindInput = () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup',   keyup);
      this.canvas.removeEventListener('mousedown', mousedown);
      window.removeEventListener('mouseup',   mouseup);
      window.removeEventListener('mousemove', mousemove);
      this.canvas.removeEventListener('wheel', wheel);
    };
  }

  _selectWeapon(key) {
    this.player.selectWeapon(key);
    this._updateHotbar();
    this._updateHUD();
  }
  _selectBuild(kind) {
    this.player.selectBuild(kind);
    this._updateHotbar();
  }

  _configureMode() {
    this.wave = 0;
    if (this.mode === 'solo') {
      for (let i = 0; i < 9; i++) this._spawnEnemy(1);
      this.victoryCondition = () => this.bots.every(b => !b.alive);
    } else if (this.mode === 'waves') {
      this._spawnWave();
      this.victoryCondition = () => false;
    } else if (this.mode === 'sandbox') {
      this.player.wood = 9999;
      this.player.maxShield = 100;
      this.player.shield = 100;
      for (let i = 0; i < 3; i++) this._spawnEnemy(0.8);
      this.victoryCondition = () => false;
    } else if (this.mode === 'tdm') {
      for (let i = 0; i < 2; i++) this._spawnAlly();
      for (let i = 0; i < 4; i++) this._spawnEnemy(1.1);
      this.teamKills = 0;
      this.enemyKills = 0;
      this.victoryCondition = () => this.teamKills >= 20 || this.enemyKills >= 20;
    }
  }

  _spawnWave() {
    this.wave++;
    const count = 3 + this.wave * 2;
    for (let i = 0; i < count; i++) {
      this._spawnEnemy(1 + this.wave * 0.15);
    }
    this._pushKillFeed(`Welle ${this.wave} beginnt!`);
  }

  _spawnEnemy(difficulty) {
    const b = new Bot(this.scene, this.world, 'enemy', difficulty);
    this.bots.push(b);
  }
  _spawnAlly() {
    const b = new Bot(this.scene, this.world, 'ally', 1.0);
    // spawn near player
    const px = this.player.position.x;
    const pz = this.player.position.z;
    b.position.set(px + (Math.random()-0.5)*8, this.world.groundHeight(px, pz) + 1, pz + (Math.random()-0.5)*8);
    b.mesh.position.copy(b.position);
    this.allyBots.push(b);
  }

  start() {
    this._loop = this._loop.bind(this);
    this._last = performance.now();
    requestAnimationFrame(this._loop);
    this.canvas.requestPointerLock();
  }

  destroy() {
    this.stopped = true;
    window.removeEventListener('resize', this._resize);
    this._unbindInput && this._unbindInput();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    // dispose scene
    this.renderer.dispose();
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose && o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material.dispose && o.material.dispose();
      }
    });
  }

  togglePause() {
    if (this.paused) this.resume();
    else this.pause();
  }
  pause() {
    this.paused = true;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.hooks.onPause && this.hooks.onPause();
  }
  resume() {
    this.paused = false;
    this.canvas.requestPointerLock();
    this.hooks.onResume && this.hooks.onResume();
    this._last = performance.now();
  }

  _loop(now) {
    if (this.stopped) return;
    requestAnimationFrame(this._loop);
    if (this.paused) { this.renderer.render(this.scene, this.camera); return; }

    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    this.elapsed += dt;

    // Update player
    this.player.update(dt, this.input, this.builds, () => this.bots);

    // Update bots
    const ctx = {
      player: this.player,
      bots: this.bots,
      allies: this.allyBots,
      buildSystem: this.builds,
      world: this.world,
      fire: (o, d, w, s) => this._fireHitscan(o, d, w, s),
      findTargetFor: (bot) => this._findTargetFor(bot),
    };
    for (const b of this.bots) b.update(dt, ctx);
    for (const b of this.allyBots) b.update(dt, ctx);

    // Update bullets (tracers)
    this._updateBullets(dt);

    // Mode logic
    if (this.mode === 'waves') {
      if (this.bots.every(b => !b.alive)) {
        // clear dead
        this.bots = this.bots.filter(b => b.alive);
        this._spawnWave();
      }
    }

    // Check end conditions
    if (!this.player.alive) {
      this._endGame(false);
    } else if (this.victoryCondition && this.victoryCondition()) {
      this._endGame(true);
    }

    // HUD tick (cheap)
    this._updateHUD();

    this.renderer.render(this.scene, this.camera);
  }

  _findTargetFor(bot) {
    if (bot.team === 'enemy') {
      // prefer player, otherwise any ally
      const candidates = [this.player].concat(this.allyBots).filter(t => t && t.alive);
      if (!candidates.length) return null;
      return nearest(bot.position, candidates);
    } else {
      const candidates = this.bots.filter(b => b.alive);
      if (!candidates.length) return null;
      return nearest(bot.position, candidates);
    }
  }

  _fireHitscan(origin, dir, wDef, shooter) {
    // Draw tracer
    this._spawnTracer(origin, dir, wDef);

    // Collect candidate targets that are NOT shooter
    const targets = [];
    if (shooter !== this.player && this.player.alive) {
      targets.push({ kind: 'player', obj: this.player, aabb: playerAABB(this.player) });
    }
    for (const b of this.bots) {
      if (!b.alive || b === shooter) continue;
      targets.push({ kind: 'bot', obj: b, aabb: b.getAABB() });
    }
    for (const b of this.allyBots) {
      if (!b.alive || b === shooter) continue;
      targets.push({ kind: 'ally', obj: b, aabb: b.getAABB() });
    }

    // Find first hit (target or environment)
    let bestT = wDef.range;
    let bestHit = null; // {type, obj/collider}

    for (const t of targets) {
      const hitT = rayVsAABB(origin, dir, t.aabb.min, t.aabb.max);
      if (hitT !== null && hitT < bestT) {
        // friendly fire skip: enemies shouldn't hurt enemies, allies shouldn't hurt allies
        if (shooter && shooter.team === 'enemy' && t.kind === 'bot') continue;
        if (shooter && shooter.team === 'ally' && (t.kind === 'ally' || t.kind === 'player')) continue;
        bestT = hitT;
        bestHit = { type: 'target', target: t };
      }
    }
    for (const c of this.world.staticColliders) {
      const hitT = rayVsAABB(origin, dir, c.min, c.max);
      if (hitT !== null && hitT < bestT) {
        bestT = hitT;
        bestHit = { type: 'collider', collider: c };
      }
    }
    for (const b of this.builds.placed) {
      const hitT = rayVsAABB(origin, dir, b.min, b.max);
      if (hitT !== null && hitT < bestT) {
        bestT = hitT;
        bestHit = { type: 'build', build: b };
      }
    }

    if (!bestHit) return;

    if (bestHit.type === 'target') {
      const obj = bestHit.target.obj;
      let dmg = wDef.damage;
      // headshot bonus (very rough: if hit Y is above 1.4 local)
      const hitY = origin.y + dir.y * bestT;
      const head = obj.eyePos ? obj.eyePos.y : obj.position.y + 1.5;
      if (Math.abs(hitY - head) < 0.35) dmg *= 1.8;

      obj.takeDamage(dmg);

      if (bestHit.target.kind === 'player' && !obj.alive) {
        this._pushKillFeed(`${shooter.name || 'Bot'} hat dich eliminiert`);
      } else if (!obj.alive) {
        const who = shooter === this.player ? 'Du' : (shooter.name || 'Bot');
        const victim = obj.name || 'Spieler';
        this._pushKillFeed(`${who} → ${victim}`);
        if (shooter === this.player) {
          this.player.kills++;
          if (this.mode === 'tdm') this.teamKills++;
        }
        if (obj.team === 'enemy' && shooter && shooter.team === 'ally') {
          if (this.mode === 'tdm') this.teamKills++;
        }
        if (obj === this.player && shooter && shooter.team === 'enemy' && this.mode === 'tdm') {
          this.enemyKills++;
        }
      }
    } else if (bestHit.type === 'collider') {
      const reward = this.world.hitCollider(bestHit.collider, wDef.damage);
      if (reward > 0 && shooter === this.player) this.player.addWood(reward);
    } else if (bestHit.type === 'build') {
      this.builds.damage(bestHit.build, wDef.damage);
    }
  }

  _spawnTracer(origin, dir, wDef) {
    const length = Math.min(wDef.range, 60);
    const end = origin.clone().add(dir.clone().multiplyScalar(length));
    const geo = new THREE.BufferGeometry().setFromPoints([origin, end]);
    const mat = new THREE.LineBasicMaterial({
      color: wDef.bulletColor || 0xffffff,
      transparent: true,
      opacity: 0.8,
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.bullets.push({ mesh: line, ttl: 0.07 });
  }

  _updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.ttl -= dt;
      if (b.mesh.material) b.mesh.material.opacity = Math.max(0, b.ttl / 0.07 * 0.8);
      if (b.ttl <= 0) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
        this.bullets.splice(i, 1);
      }
    }
  }

  _endGame(victory) {
    if (this.stopped) return;
    this.stopped = true;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    const secs = Math.floor(this.elapsed);
    const min = Math.floor(secs / 60);
    const sec = secs % 60;
    const timeStr = `${min}:${sec.toString().padStart(2,'0')}`;
    this.hooks.onEnd && this.hooks.onEnd({
      victory,
      kills: this.player.kills,
      timeStr,
      wave: this.mode === 'waves' ? this.wave : null,
    });
  }

  _pushKillFeed(text) {
    const el = document.createElement('div');
    el.className = 'entry';
    el.textContent = text;
    this.killFeedEl.prepend(el);
    setTimeout(() => el.remove(), 5000);
  }

  _updateHUD() {
    const hf = (this.player.health / this.player.maxHealth) * 100;
    const sf = (this.player.shield / this.player.maxShield) * 100;
    document.getElementById('health-fill').style.width = hf + '%';
    document.getElementById('shield-fill').style.width = sf + '%';
    document.getElementById('health-text').textContent = Math.ceil(this.player.health);
    document.getElementById('shield-text').textContent = Math.ceil(this.player.shield);
    document.getElementById('wood-count').textContent = this.player.wood;

    const wDef = WEAPONS[this.player.currentWeapon];
    const wInv = this.player.inventory[this.player.currentWeapon];
    document.getElementById('weapon-name').textContent = wDef.name;
    const ammo = wDef.clip === Infinity
      ? '∞'
      : `${wInv.ammo} / ${wInv.reserve}`;
    document.getElementById('ammo').textContent = ammo;

    const modeTitles = {
      solo: 'Solo Showdown',
      waves: 'Wellen-Überleben',
      sandbox: 'Bau-Sandbox',
      tdm: 'Team-Deathmatch',
    };
    document.getElementById('mode-title').textContent = modeTitles[this.mode];
    let status = '';
    const aliveEnemies = this.bots.filter(b => b.alive).length;
    if (this.mode === 'solo') status = `Gegner: ${aliveEnemies}`;
    else if (this.mode === 'waves') status = `Welle ${this.wave} · Gegner: ${aliveEnemies}`;
    else if (this.mode === 'sandbox') status = `Kills: ${this.player.kills}`;
    else if (this.mode === 'tdm') status = `Team ${this.teamKills} – ${this.enemyKills} Feinde`;
    document.getElementById('mode-status').textContent = status;

    this._updateHotbar();
  }

  _updateHotbar() {
    const slots = document.querySelectorAll('#hotbar .slot');
    slots.forEach(s => s.classList.remove('active'));
    const map = {
      pistol: 1, rifle: 2, shotgun: 3, sniper: 4, pickaxe: 5,
    };
    if (this.player.currentBuild) {
      const b = { wall: 6, floor: 7, ramp: 8 }[this.player.currentBuild];
      if (b) slots[b - 1].classList.add('active');
    } else {
      const idx = map[this.player.currentWeapon];
      if (idx) slots[idx - 1].classList.add('active');
    }
  }
}

function playerAABB(player) {
  return {
    min: new THREE.Vector3(player.position.x - 0.45, player.position.y, player.position.z - 0.45),
    max: new THREE.Vector3(player.position.x + 0.45, player.position.y + 1.8, player.position.z + 0.45),
  };
}

function nearest(pos, arr) {
  let best = null, bestD = Infinity;
  for (const t of arr) {
    const d = pos.distanceToSquared(t.position);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}
