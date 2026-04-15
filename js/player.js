import * as THREE from 'three';
import { WEAPONS, makeInventory } from './weapons.js';

/**
 * Build a simple "viewmodel" weapon group that lives in front of the camera.
 * We'll swap its look when the player switches weapons.
 */
function makeViewmodel() {
  const group = new THREE.Group();

  const armMat = new THREE.MeshLambertMaterial({ color: 0xffe0bd });
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.6), armMat);
  arm.position.set(0.15, -0.25, -0.35);
  group.add(arm);

  const gunMat = new THREE.MeshLambertMaterial({ color: 0x2a2a33 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.7), gunMat);
  body.position.set(0.38, -0.28, -0.55);
  group.add(body);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), gunMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0.38, -0.24, -0.95);
  group.add(barrel);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.15), gunMat);
  grip.position.set(0.38, -0.42, -0.38);
  group.add(grip);

  group.userData = { body, barrel, grip, arm };
  return group;
}

/** Set the weapon viewmodel's look per weapon key. */
function styleViewmodel(vm, weaponKey) {
  const { body, barrel, grip } = vm.userData;
  const cfg = {
    pistol:   { color: 0x2a2a33, barrelLen: 0.35, bodyLen: 0.55 },
    rifle:    { color: 0x3a3a45, barrelLen: 0.7,  bodyLen: 0.9  },
    shotgun:  { color: 0x5a3a22, barrelLen: 0.85, bodyLen: 0.95 },
    sniper:   { color: 0x1e2028, barrelLen: 1.1,  bodyLen: 1.05 },
    pickaxe:  { color: 0x8a7a40, barrelLen: 0.55, bodyLen: 0.3  },
  }[weaponKey] || { color: 0x2a2a33, barrelLen: 0.5, bodyLen: 0.7 };

  body.material.color.setHex(cfg.color);
  barrel.material.color.setHex(cfg.color);
  grip.material.color.setHex(cfg.color);

  if (body.geometry) body.geometry.dispose();
  body.geometry = new THREE.BoxGeometry(0.18, 0.24, cfg.bodyLen);
  body.position.z = -0.4 - cfg.bodyLen / 2;

  if (barrel.geometry) barrel.geometry.dispose();
  barrel.geometry = new THREE.CylinderGeometry(0.04, 0.04, cfg.barrelLen, 8);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = body.position.z - cfg.bodyLen / 2 - cfg.barrelLen / 2;
}

const GRAVITY       = 24;
const MOVE_SPEED    = 7.5;
const SPRINT_MULT   = 1.45;
const CROUCH_MULT   = 0.55;
const ADS_MULT      = 0.65;
const JUMP_SPEED    = 9.0;
const EYE_HEIGHT    = 1.7;
const CROUCH_HEIGHT = 1.05;
const PLAYER_RADIUS = 0.45;
const NORMAL_FOV    = 75;
const ADS_FOV       = 45;

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
    this.crouching = false;
    this.aiming    = false;   // ADS

    // stats  (buffed so the player doesn't die instantly)
    this.health = 150;
    this.maxHealth = 150;
    this.shield = 100;
    this.maxShield = 100;
    this.wood   = 200;
    this.alive  = true;
    this.team   = 'player';

    // inventory
    this.inventory = makeInventory();
    this.currentWeapon = 'pistol';
    this.currentBuild  = null;  // 'wall' | 'floor' | 'ramp' | 'roof' | null
    this.kills = 0;
    this.damageFlashUntil = 0;

    // viewmodel attached to camera
    this.viewmodel = makeViewmodel();
    this.camera.add(this.viewmodel);
    styleViewmodel(this.viewmodel, this.currentWeapon);
    this.camera.fov = NORMAL_FOV;
    this.camera.updateProjectionMatrix();

    this._spawn();
  }

  _spawn() {
    const sx = (Math.random() - 0.5) * 40;
    const sz = (Math.random() - 0.5) * 40;
    this.position.set(sx, this.world.groundHeight(sx, sz) + 2, sz);
  }

  get eyePos() {
    const h = this.crouching ? CROUCH_HEIGHT : EYE_HEIGHT;
    return new THREE.Vector3(
      this.position.x,
      this.position.y + h,
      this.position.z
    );
  }

  get hitboxHeight() { return this.crouching ? 1.2 : 1.8; }

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
    const sprint    = (input.keys.ShiftLeft || input.keys.ShiftRight) && !this.crouching && !this.aiming;

    // Crouch toggle handled from game.js; keep value, apply speed here
    let speed = MOVE_SPEED;
    if (sprint)        speed *= SPRINT_MULT;
    if (this.crouching) speed *= CROUCH_MULT;
    if (this.aiming)    speed *= ADS_MULT;

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

    // Jump (can't jump while crouching)
    if (input.keys.Space && this.onGround && !this.crouching) {
      this.velocity.y = JUMP_SPEED;
      this.onGround = false;
    }

    // Smoothly lerp FOV for ADS
    const targetFov = this.aiming ? ADS_FOV : NORMAL_FOV;
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 12);
      this.camera.updateProjectionMatrix();
    }

    // Viewmodel bob & ADS position
    const vm = this.viewmodel;
    if (vm) {
      const moving = (fwdMove !== 0 || sideMove !== 0) && this.onGround;
      const t = performance.now() * 0.008;
      const bob = moving ? Math.sin(t) * 0.015 : 0;
      const adsX = this.aiming ? -0.38 : 0;  // center gun when aiming
      const adsZ = this.aiming ? 0.08  : 0;
      vm.position.x += ((adsX) - vm.position.x) * Math.min(1, dt * 14);
      vm.position.y += ((bob) - vm.position.y) * Math.min(1, dt * 14);
      vm.position.z += ((adsZ) - vm.position.z) * Math.min(1, dt * 14);
    }

    // Integrate & collide
    this._moveAndCollide(dt, buildSystem);

    // Shield regen out of combat (kicks in faster after the first buff)
    if (performance.now() > this.damageFlashUntil + 3000 && this.shield < this.maxShield) {
      this.shield = Math.min(this.maxShield, this.shield + 15 * dt);
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
    const h = this.hitboxHeight;
    const minP = { x: pos.x - r, y: pos.y,     z: pos.z - r };
    const maxP = { x: pos.x + r, y: pos.y + h, z: pos.z + r };

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
    // ADS tightens the cone significantly; crouching helps a bit more
    let spread = wDef.spread;
    if (this.aiming)    spread *= 0.25;
    if (this.crouching) spread *= 0.7;

    for (let i = 0; i < pellets; i++) {
      const dir = this.forwardVector().clone();
      if (spread > 0) {
        dir.x += (Math.random() - 0.5) * spread;
        dir.y += (Math.random() - 0.5) * spread;
        dir.z += (Math.random() - 0.5) * spread;
        dir.normalize();
      }
      this.onFire && this.onFire(origin, dir, wDef, this);
    }
    // simple recoil kick (ADS reduces)
    this.pitch += wDef.recoil * (this.aiming ? 0.004 : 0.01);
  }

  _meleeSwing(botsProvider) {
    const origin = this.eyePos;
    const dir = this.forwardVector();
    this.onFire && this.onFire(origin, dir, WEAPONS.pickaxe, this);
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
      if (this.viewmodel) {
        styleViewmodel(this.viewmodel, key);
        this.viewmodel.visible = true;
      }
    }
  }

  selectBuild(kind) {
    this.currentBuild = kind;
    if (kind) this.aiming = false;
    // hide the gun while in build mode
    if (this.viewmodel) this.viewmodel.visible = !kind;
  }

  setCrouch(on) { this.crouching = !!on; }
  setAim(on)    { this.aiming    = !!on && !this.currentBuild; }

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
