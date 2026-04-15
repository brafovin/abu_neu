import * as THREE from 'three';
import { WEAPONS, makeInventory } from './weapons.js';

const GRAVITY      = 24;
const MOVE_SPEED   = 7.5;
const SPRINT_MULT  = 1.45;
const JUMP_SPEED   = 9.0;
const EYE_HEIGHT   = 1.7;
const PLAYER_RADIUS= 0.45;

export class Player {
  constructor(camera, world) {
    this.camera = camera;
    this.world  = world;

    // transform
    this.position = new THREE.Vector3(0, 10, 0);
    this.velocity = new THREE.Vector3();
    this.yaw      = 0;
    this.pitch    = 0;
    this.onGround = false;

    // stats
    this.health = 100;
    this.maxHealth = 100;
    this.shield = 50;
    this.maxShield = 100;
    this.wood   = 200;
    this.alive  = true;

    // inventory
    this.inventory = makeInventory();
    this.currentWeapon = 'pistol';
    this.currentBuild  = null;         // 'wall' | 'floor' | 'ramp' | null
    this.kills = 0;
    this.damageFlashUntil = 0;

    this._spawn();
  }

  _spawn() {
    const sx = (Math.random() - 0.5) * 40;
    const sz = (Math.random() - 0.5) * 40;
    this.position.set(sx, this.world.groundHeight(sx, sz) + 2, sz);
  }

  get eyePos() {
    return new THREE.Vector3(
      this.position.x,
      this.position.y + EYE_HEIGHT,
      this.position.z
    );
  }

  /** Unit vector the camera is facing. */
  forwardVector() {
    const v = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
       Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    return v.normalize();
  }

  update(dt, input, buildSystem, botsProvider) {
    if (!this.alive) return;

    // Look from mouse delta
    this.yaw   -= input.mouseDX * 0.0025;
    this.pitch -= input.mouseDY * 0.0025;
    const lim = Math.PI / 2 - 0.05;
    if (this.pitch >  lim) this.pitch =  lim;
    if (this.pitch < -lim) this.pitch = -lim;
    input.mouseDX = 0;
    input.mouseDY = 0;

    // Movement input
    const fwdMove   = (input.keys.KeyW ? 1 : 0) - (input.keys.KeyS ? 1 : 0);
    const sideMove  = (input.keys.KeyD ? 1 : 0) - (input.keys.KeyA ? 1 : 0);
    const sprint    = input.keys.ShiftLeft || input.keys.ShiftRight;
    const speed = MOVE_SPEED * (sprint ? SPRINT_MULT : 1);

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right   = new THREE.Vector3( Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const move = new THREE.Vector3();
    move.addScaledVector(forward, fwdMove);
    move.addScaledVector(right,   sideMove);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);

    this.velocity.x = move.x;
    this.velocity.z = move.z;

    // Gravity
    this.velocity.y -= GRAVITY * dt;

    // Jump
    if (input.keys.Space && this.onGround) {
      this.velocity.y = JUMP_SPEED;
      this.onGround = false;
    }

    // Integrate & collide
    this._moveAndCollide(dt, buildSystem);

    // Shield regen out of combat (slow)
    if (performance.now() > this.damageFlashUntil + 4000 && this.shield < this.maxShield) {
      this.shield = Math.min(this.maxShield, this.shield + 6 * dt);
    }

    // Camera
    this.camera.position.copy(this.eyePos);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    // Fire / build
    this._handleAction(input, buildSystem, botsProvider);
  }

  _moveAndCollide(dt, buildSystem) {
    // Horizontal
    const nextX = this.position.x + this.velocity.x * dt;
    const nextZ = this.position.z + this.velocity.z * dt;

    const testX = new THREE.Vector3(nextX, this.position.y, this.position.z);
    if (!this._collides(testX, buildSystem)) this.position.x = nextX;

    const testZ = new THREE.Vector3(this.position.x, this.position.y, nextZ);
    if (!this._collides(testZ, buildSystem)) this.position.z = nextZ;

    // Vertical
    const nextY = this.position.y + this.velocity.y * dt;
    const testY = new THREE.Vector3(this.position.x, nextY, this.position.z);

    if (this._collides(testY, buildSystem) && this.velocity.y <= 0) {
      this.velocity.y = 0;
      this.onGround = true;
    } else if (this._collides(testY, buildSystem) && this.velocity.y > 0) {
      this.velocity.y = 0;
    } else {
      this.position.y = nextY;
      this.onGround = false;
    }

    // Ground clamp
    const g = this.world.groundHeight(this.position.x, this.position.z);
    if (this.position.y < g) {
      this.position.y = g;
      this.velocity.y = 0;
      this.onGround = true;
    }

    // Map bounds
    const s = this.world.size / 2 - 2;
    if (this.position.x >  s) this.position.x =  s;
    if (this.position.x < -s) this.position.x = -s;
    if (this.position.z >  s) this.position.z =  s;
    if (this.position.z < -s) this.position.z = -s;
  }

  _collides(pos, buildSystem) {
    const r = PLAYER_RADIUS;
    const minP = { x: pos.x - r, y: pos.y,         z: pos.z - r };
    const maxP = { x: pos.x + r, y: pos.y + 1.75,  z: pos.z + r };

    for (const c of this.world.staticColliders) {
      if (maxP.x < c.min.x || minP.x > c.max.x) continue;
      if (maxP.y < c.min.y || minP.y > c.max.y) continue;
      if (maxP.z < c.min.z || minP.z > c.max.z) continue;
      return true;
    }
    for (const b of buildSystem.placed) {
      if (maxP.x < b.min.x || minP.x > b.max.x) continue;
      if (maxP.y < b.min.y || minP.y > b.max.y) continue;
      if (maxP.z < b.min.z || minP.z > b.max.z) continue;
      return true;
    }
    return false;
  }

  _handleAction(input, buildSystem, botsProvider) {
    // Building preview update
    if (this.currentBuild) {
      buildSystem.updatePreview(this, this.currentBuild);
    } else {
      buildSystem.hidePreview();
    }

    if (!input.mouseDown) {
      this._firedThisClick = false;
      return;
    }

    // Place building on click
    if (this.currentBuild) {
      if (!this._firedThisClick) {
        this._firedThisClick = true;
        const placed = buildSystem.tryPlace(this, this.currentBuild);
        if (placed) this.wood -= 10;
      }
      return;
    }

    // Shoot
    const wDef = WEAPONS[this.currentWeapon];
    const wInv = this.inventory[this.currentWeapon];

    if (wInv.reloading) {
      if (performance.now() >= wInv.reloadUntil) {
        const needed = wDef.clip - wInv.ammo;
        const give = Math.min(needed, wInv.reserve);
        wInv.ammo += give;
        wInv.reserve -= give;
        wInv.reloading = false;
      }
      return;
    }

    if (wDef.melee) {
      if (!wDef.auto && this._firedThisClick) return;
      const now = performance.now();
      if (now - wInv.lastFire < 60000 / wDef.rpm) return;
      wInv.lastFire = now;
      this._firedThisClick = true;
      this._meleeSwing(botsProvider);
      return;
    }

    if (wInv.ammo <= 0) {
      // auto-reload
      if (wInv.reserve > 0) this._beginReload();
      return;
    }

    if (!wDef.auto && this._firedThisClick) return;

    const now = performance.now();
    if (now - wInv.lastFire < 60000 / wDef.rpm) return;
    wInv.lastFire = now;
    this._firedThisClick = true;

    this._fireWeapon(wDef, botsProvider);
    wInv.ammo--;
  }

  _fireWeapon(wDef, botsProvider) {
    // emit via game (set externally)
    const origin = this.eyePos;
    const pellets = wDef.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const dir = this.forwardVector().clone();
      if (wDef.spread > 0) {
        dir.x += (Math.random() - 0.5) * wDef.spread;
        dir.y += (Math.random() - 0.5) * wDef.spread;
        dir.z += (Math.random() - 0.5) * wDef.spread;
        dir.normalize();
      }
      this.onFire && this.onFire(origin, dir, wDef, 'player');
    }
    // simple recoil kick
    this.pitch += wDef.recoil * 0.01;
  }

  _meleeSwing(botsProvider) {
    const origin = this.eyePos;
    const dir = this.forwardVector();
    this.onFire && this.onFire(origin, dir, WEAPONS.pickaxe, 'player');
  }

  _beginReload() {
    const wDef = WEAPONS[this.currentWeapon];
    const wInv = this.inventory[this.currentWeapon];
    if (wInv.reloading || wInv.ammo === wDef.clip || wInv.reserve === 0) return;
    wInv.reloading = true;
    wInv.reloadUntil = performance.now() + wDef.reload * 1000;
  }

  selectWeapon(key) {
    if (WEAPONS[key]) {
      this.currentWeapon = key;
      this.currentBuild  = null;
    }
  }

  selectBuild(kind) {
    this.currentBuild = kind;
  }

  reload() {
    if (this.currentBuild) return;
    this._beginReload();
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.damageFlashUntil = performance.now() + 300;
    if (this.shield > 0) {
      const absorb = Math.min(this.shield, amount);
      this.shield -= absorb;
      amount -= absorb;
    }
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
  }

  addWood(n) { this.wood = Math.min(999, this.wood + n); }
}
