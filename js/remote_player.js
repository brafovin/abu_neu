import * as THREE from 'three';

const COLORS = [0x4fc3f7, 0xffb74d, 0xba68c8, 0x81c784, 0xff8a65];

/**
 * A networked remote player: simple avatar that follows
 * positions sent over the wire.
 */
export class RemotePlayer {
  constructor(scene, id) {
    this.id    = id;
    this.name  = id.slice(0, 6);
    this.alive = true;
    this.health = 150;
    this.maxHealth = 150;
    this.shield = 100;
    this.maxShield = 100;
    this.faction = `peer_${id}`;
    this.team    = 'peer';

    this.position = new THREE.Vector3(0, 5, 0);
    this.yaw   = 0;
    this.pitch = 0;

    // Interpolation targets (last received network state)
    this.targetPosition = this.position.clone();
    this.targetYaw      = 0;

    this._makeMesh(scene);
  }

  _makeMesh(scene) {
    const group = new THREE.Group();
    const hash = this._hash(this.id);
    const color = COLORS[hash % COLORS.length];

    const bodyMat = new THREE.MeshLambertMaterial({ color });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.5), bodyMat);
    body.position.y = 0.6;
    group.add(body);

    const headMat = new THREE.MeshLambertMaterial({ color: 0xffe0bd });
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

    this.mesh = group;
    this.body = body;
    scene.add(group);
  }

  _hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  get eyePos() {
    return new THREE.Vector3(
      this.position.x,
      this.position.y + 1.55,
      this.position.z
    );
  }

  getAABB() {
    return {
      min: new THREE.Vector3(this.position.x - 0.5, this.position.y,       this.position.z - 0.5),
      max: new THREE.Vector3(this.position.x + 0.5, this.position.y + 1.9, this.position.z + 0.5),
    };
  }

  /** Called from the network layer with the latest snapshot. */
  applyState(state) {
    if (state.pos) {
      this.targetPosition.set(state.pos[0], state.pos[1], state.pos[2]);
    }
    if (typeof state.yaw === 'number') this.targetYaw = state.yaw;
    if (typeof state.pitch === 'number') this.pitch = state.pitch;
    if (typeof state.health === 'number') this.health = state.health;
    if (typeof state.shield === 'number') this.shield = state.shield;
    if (typeof state.alive === 'boolean') this.alive = state.alive;
  }

  update(dt) {
    // Smooth towards the last received position / yaw
    const k = Math.min(1, dt * 14);
    this.position.lerp(this.targetPosition, k);
    this.yaw += (this.targetYaw - this.yaw) * k;

    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.yaw;
    this.mesh.visible = this.alive;
  }

  takeDamage(amount) {
    // Visual feedback only; real damage is applied on the owning peer
    if (!this.body || !this.body.material) return;
    this.body.material.emissive = new THREE.Color(0xff3030);
    setTimeout(() => {
      if (this.body && this.body.material) {
        this.body.material.emissive = new THREE.Color(0x000000);
      }
    }, 80);
  }

  destroy() {
    if (this.mesh && this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}
