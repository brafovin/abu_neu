import * as THREE from 'three';
import { WEAPONS } from './weapons.js';

const BOT_NAMES = [
  'Rex', 'Nova', 'Tango', 'Echo', 'Blitz', 'Vex', 'Kilo', 'Ryu',
  'Zara', 'Hex', 'Ash', 'Jinx', 'Ghost', 'Raven', 'Storm',
];

const GRAVITY = 24;
const BOT_SPEED = 5.0;
const SIGHT_RANGE = 80;
const COLORS = [0xff5252, 0xff9800, 0xe91e63, 0x9c27b0, 0x3f51b5];

/**
 * Each bot: state machine PATROL → CHASE → ATTACK → (RETREAT).
 * Bots use a random weapon; they aim with small error depending on
 * difficulty.  They can also break builds in front of them.
 */
export class Bot {
  constructor(scene, world, team, difficulty = 1) {
    this.scene = scene;
    this.world = world;
    this.team  = team;                 // 'enemy' | 'ally'
    this.faction = team;               // overridden by game (FFA / TDM)
    this.difficulty = difficulty;      // scales aim / reaction
    this.alive = true;
    this.name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];

    this.health = 100;
    this.maxHealth = 100;

    this.state = 'patrol';
    this.target = null;
    this.targetSeenAt = 0;             // ms first time current target was spotted
    this.lastFire = 0;
    this.patrolTarget = new THREE.Vector3();
    this.nextPatrolPick = 0;

    // assign a weapon (bias towards weaker so the player has a chance)
    const pool = ['pistol', 'pistol', 'rifle', 'shotgun', 'sniper'];
    this.weaponKey = pool[Math.floor(Math.random() * pool.length)];
    this.ammo = WEAPONS[this.weaponKey].clip;
    this.reloadUntil = 0;

    this._makeMesh();
    this._spawn();
  }

  _makeMesh() {
    const group = new THREE.Group();
    const color = this.team === 'ally'
      ? 0x4fc3f7
      : COLORS[Math.floor(Math.random() * COLORS.length)];
    const bodyMat = new THREE.MeshLambertMaterial({ color });
    const headMat = new THREE.MeshLambertMaterial({ color: 0xffe0bd });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.5), bodyMat);
    body.position.y = 0.6;
    group.add(body);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), headMat);
    head.position.y = 1.5;
    group.add(head);

    const legMat = new THREE.MeshLambertMaterial({ color: 0x333355 });
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 0.3), legMat);
    const legR = legL.clone();
    legL.position.set(-0.2, -0.45 + 0.6, 0);
    legR.position.set( 0.2, -0.45 + 0.6, 0);
    group.add(legL); group.add(legR);

    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.15, 0.9),
      new THREE.MeshLambertMaterial({ color: 0x222 })
    );
    gun.position.set(0.35, 1.0, 0.4);
    group.add(gun);

    // Name tag is just via console/kill feed to keep HUD simple.
    this.mesh = group;
    this.body = body;
    this.scene.add(group);
  }

  _spawn() {
    const s = this.world.size / 2 - 20;
    const x = (Math.random() - 0.5) * 2 * s;
    const z = (Math.random() - 0.5) * 2 * s;
    const y = this.world.groundHeight(x, z) + 1;
    this.position = new THREE.Vector3(x, y, z);
    this.velocity = new THREE.Vector3();
    this.mesh.position.copy(this.position);
  }

  get eyePos() {
    return new THREE.Vector3(this.position.x, this.position.y + 1.5, this.position.z);
  }

  /** Broad‑phase AABB used by raycasts. */
  getAABB() {
    return {
      min: new THREE.Vector3(this.position.x - 0.5, this.position.y,        this.position.z - 0.5),
      max: new THREE.Vector3(this.position.x + 0.5, this.position.y + 2.0,  this.position.z + 0.5),
    };
  }

  _visibleTo(target, obstacles) {
    const from = this.eyePos.clone();
    const to   = target.eyePos ? target.eyePos.clone() : target.position.clone();
    const dir  = to.clone().sub(from);
    const dist = dir.length();
    if (dist > SIGHT_RANGE) return false;
    dir.normalize();

    // test against static colliders and builds
    for (const c of obstacles) {
      const t = rayVsAABB(from, dir, c.min, c.max);
      if (t !== null && t < dist - 0.2) return false;
    }
    return true;
  }

  update(dt, ctx) {
    if (!this.alive) return;
    const { player, bots, buildSystem, world, fire, findTargetFor } = ctx;

    // pick / validate target
    if (!this.target || !this.target.alive ||
        this.target.position.distanceTo(this.position) > SIGHT_RANGE * 1.2) {
      this.target = findTargetFor(this);
    }

    const obstacles = world.staticColliders.concat(buildSystem.placed);

    let canSee = false;
    if (this.target) {
      canSee = this._visibleTo(this.target, obstacles);
    }

    const now = performance.now();
    if (this.target && canSee) {
      if (this.state !== 'attack') this.targetSeenAt = now;
      this.state = 'attack';
    } else if (this.target) {
      this.state = 'chase';
      this.targetSeenAt = 0;
    } else {
      this.state = 'patrol';
      this.targetSeenAt = 0;
    }

    // Motion desire
    const desired = new THREE.Vector3();
    if (this.state === 'attack') {
      // strafe while shooting if close, otherwise approach
      const dist = this.position.distanceTo(this.target.position);
      const toT = this.target.position.clone().sub(this.position).setY(0).normalize();
      if (dist > 22) {
        desired.copy(toT);
      } else if (dist < 8) {
        desired.copy(toT).multiplyScalar(-0.6);
      } else {
        // strafe
        const side = new THREE.Vector3(-toT.z, 0, toT.x);
        desired.copy(side).multiplyScalar(Math.sin(performance.now() * 0.002) > 0 ? 1 : -1);
      }
    } else if (this.state === 'chase' && this.target) {
      const toT = this.target.position.clone().sub(this.position).setY(0).normalize();
      desired.copy(toT);
    } else {
      // patrol
      const now = performance.now();
      if (now > this.nextPatrolPick ||
          this.position.distanceTo(this.patrolTarget) < 2) {
        this.nextPatrolPick = now + 3000 + Math.random() * 3000;
        const s = world.size / 2 - 10;
        this.patrolTarget.set(
          (Math.random() - 0.5) * 2 * s, 0,
          (Math.random() - 0.5) * 2 * s
        );
      }
      const toT = this.patrolTarget.clone().sub(this.position).setY(0).normalize();
      desired.copy(toT);
    }

    this.velocity.x = desired.x * BOT_SPEED;
    this.velocity.z = desired.z * BOT_SPEED;
    this.velocity.y -= GRAVITY * dt;

    this._moveAndCollide(dt, buildSystem);

    // Facing
    if (this.target) {
      const toT = this.target.position.clone().sub(this.position);
      this.mesh.rotation.y = Math.atan2(toT.x, toT.z);
    } else if (this.velocity.lengthSq() > 0.01) {
      this.mesh.rotation.y = Math.atan2(this.velocity.x, this.velocity.z);
    }
    this.mesh.position.copy(this.position);

    // Fire at target
    if (this.state === 'attack' && this.target && this.target.alive) {
      this._tryFire(ctx);
    }
  }

  _tryFire(ctx) {
    const now = performance.now();
    const wDef = WEAPONS[this.weaponKey];

    // Reaction delay: wait before first shot after seeing target
    if (now - this.targetSeenAt < 500) return;

    if (now < this.reloadUntil) return;
    if (this.ammo <= 0) {
      this.reloadUntil = now + wDef.reload * 1000 * 1.3;  // slower reload
      this.ammo = wDef.clip;
      return;
    }

    // Effective fire rate is slower than the base weapon
    const cd = (60000 / wDef.rpm) * 1.45;
    if (now - this.lastFire < cd) return;
    this.lastFire = now;
    this.ammo--;

    const origin = this.eyePos;
    const dir = this.target.eyePos
      ? this.target.eyePos.clone().sub(origin).normalize()
      : this.target.position.clone().sub(origin).normalize();

    // Aim error is big so the bots aren't laser-accurate
    const err = (0.11 / this.difficulty) + wDef.spread;
    dir.x += (Math.random() - 0.5) * err;
    dir.y += (Math.random() - 0.5) * err;
    dir.z += (Math.random() - 0.5) * err;
    dir.normalize();

    const pellets = wDef.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const d = dir.clone();
      if (wDef.pellets) {
        d.x += (Math.random() - 0.5) * wDef.spread;
        d.y += (Math.random() - 0.5) * wDef.spread;
        d.z += (Math.random() - 0.5) * wDef.spread;
        d.normalize();
      }
      ctx.fire(origin, d, wDef, this);
    }
  }

  _moveAndCollide(dt, buildSystem) {
    const r = 0.45;
    const attempt = (dx, dy, dz) => {
      const nx = this.position.x + dx;
      const ny = this.position.y + dy;
      const nz = this.position.z + dz;
      const min = { x: nx - r, y: ny,        z: nz - r };
      const max = { x: nx + r, y: ny + 1.8,  z: nz + r };

      for (const c of this.world.staticColliders) {
        if (max.x < c.min.x || min.x > c.max.x) continue;
        if (max.y < c.min.y || min.y > c.max.y) continue;
        if (max.z < c.min.z || min.z > c.max.z) continue;
        return c;
      }
      for (const b of buildSystem.placed) {
        if (max.x < b.min.x || min.x > b.max.x) continue;
        if (max.y < b.min.y || min.y > b.max.y) continue;
        if (max.z < b.min.z || min.z > b.max.z) continue;
        return b;
      }
      return null;
    };

    const stepX = this.velocity.x * dt;
    if (!attempt(stepX, 0, 0)) this.position.x += stepX;
    else {
      // try step over small obstacle
      if (!attempt(stepX, 0.8, 0)) { this.position.x += stepX; this.position.y += 0.2; }
    }
    const stepZ = this.velocity.z * dt;
    if (!attempt(0, 0, stepZ)) this.position.z += stepZ;
    else {
      if (!attempt(0, 0.8, stepZ)) { this.position.z += stepZ; this.position.y += 0.2; }
    }

    const stepY = this.velocity.y * dt;
    const hit = attempt(0, stepY, 0);
    if (!hit) {
      this.position.y += stepY;
    } else if (this.velocity.y < 0) {
      this.velocity.y = 0;
    } else {
      this.velocity.y = 0;
    }

    const g = this.world.groundHeight(this.position.x, this.position.z);
    if (this.position.y < g) {
      this.position.y = g;
      this.velocity.y = 0;
    }
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.health -= amount;
    // flash
    this.body.material.emissive = new THREE.Color(0xff3030);
    setTimeout(() => {
      if (this.body && this.body.material) {
        this.body.material.emissive = new THREE.Color(0x000000);
      }
    }, 80);
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.scene.remove(this.mesh);
    }
  }
}

/** Ray vs AABB intersection. Returns t or null. */
export function rayVsAABB(origin, dir, min, max) {
  let tmin = -Infinity, tmax = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    if (Math.abs(dir[axis]) < 1e-8) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return null;
    } else {
      const inv = 1 / dir[axis];
      let t1 = (min[axis] - origin[axis]) * inv;
      let t2 = (max[axis] - origin[axis]) * inv;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  return tmin >= 0 ? tmin : (tmax >= 0 ? tmax : null);
}
