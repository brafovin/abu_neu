import * as THREE from 'three';

const GRID = 4;             // build grid size
const WALL_THICK = 0.25;
const FLOOR_THICK = 0.25;

/**
 * Snaps builds to a 4x4 grid (similar feel to Fortnite).
 * Manages placement preview, placement and destruction.
 */
export class BuildSystem {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.placed = [];           // {min, max, mesh, hp, kind}
    this.previewMesh = null;
    this._makePreview();
  }

  _makePreview() {
    const geo = new THREE.BoxGeometry(GRID, GRID, WALL_THICK);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4fc3f7,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.previewMesh = new THREE.Mesh(geo, mat);
    this.previewMesh.visible = false;
    this.scene.add(this.previewMesh);
  }

  _setPreviewGeo(kind) {
    let geo;
    if (kind === 'wall')  geo = new THREE.BoxGeometry(GRID, GRID, WALL_THICK);
    if (kind === 'floor' || kind === 'roof')
                           geo = new THREE.BoxGeometry(GRID, FLOOR_THICK, GRID);
    if (kind === 'ramp')   geo = new THREE.BoxGeometry(GRID, GRID, WALL_THICK);
    if (this.previewMesh.geometry) this.previewMesh.geometry.dispose();
    this.previewMesh.geometry = geo;
  }

  hidePreview() {
    if (this.previewMesh) this.previewMesh.visible = false;
  }

  _snap(v) { return Math.round(v / GRID) * GRID; }

  /** Compute the AABB centre (Vector3) where a new structure would be placed. */
  _computePlacement(player, kind) {
    const fwd = player.forwardVector().clone();
    const pos = player.eyePos.clone().add(fwd.multiplyScalar(5));
    const cx = this._snap(pos.x);
    const cz = this._snap(pos.z);

    let cy;
    if (kind === 'floor') {
      cy = this._snap(pos.y);
    } else if (kind === 'roof') {
      // place a ceiling above ground height
      cy = this.world.groundHeight(cx, cz) + GRID;
    } else {
      // wall/ramp: anchor to ground at its base
      const groundY = this.world.groundHeight(cx, cz);
      cy = groundY + GRID / 2;
    }

    return new THREE.Vector3(cx, cy, cz);
  }

  updatePreview(player, kind) {
    this._setPreviewGeo(kind);
    const c = this._computePlacement(player, kind);
    this.previewMesh.position.copy(c);
    this.previewMesh.rotation.set(0, 0, 0);

    if (kind === 'wall') {
      // face perpendicular to yaw
      const yaw = player.yaw;
      const snapped = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
      this.previewMesh.rotation.y = snapped;
    }
    if (kind === 'ramp') {
      const yaw = player.yaw;
      const snapped = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
      this.previewMesh.rotation.y = snapped;
      this.previewMesh.rotation.x = -Math.PI / 4;
    }

    this.previewMesh.visible = true;
    this.previewMesh.material.color.set(
      this._canPlace(c, kind) ? 0x4fc3f7 : 0xff5252
    );
  }

  _canPlace(centre, kind) {
    const half = this._halfExtents(kind);
    const min = centre.clone().sub(half);
    const max = centre.clone().add(half);
    // don't overlap existing builds
    for (const b of this.placed) {
      if (max.x <= b.min.x || min.x >= b.max.x) continue;
      if (max.y <= b.min.y || min.y >= b.max.y) continue;
      if (max.z <= b.min.z || min.z >= b.max.z) continue;
      return false;
    }
    return true;
  }

  _halfExtents(kind) {
    if (kind === 'wall')  return new THREE.Vector3(GRID/2, GRID/2, WALL_THICK);
    if (kind === 'floor' || kind === 'roof')
                          return new THREE.Vector3(GRID/2, FLOOR_THICK, GRID/2);
    if (kind === 'ramp')  return new THREE.Vector3(GRID/2, GRID/2, WALL_THICK);
    return new THREE.Vector3();
  }

  tryPlace(player, kind) {
    if (player.wood < 10) return false;
    const c = this._computePlacement(player, kind);
    if (!this._canPlace(c, kind)) return false;

    const half = this._halfExtents(kind);
    let geo, mesh;
    const mat = new THREE.MeshLambertMaterial({ color: 0xbb8855 });

    if (kind === 'wall') {
      geo = new THREE.BoxGeometry(GRID, GRID, WALL_THICK);
      mesh = new THREE.Mesh(geo, mat);
      const yaw = Math.round(player.yaw / (Math.PI/2)) * (Math.PI/2);
      mesh.rotation.y = yaw;
    }
    if (kind === 'floor' || kind === 'roof') {
      geo = new THREE.BoxGeometry(GRID, FLOOR_THICK, GRID);
      mesh = new THREE.Mesh(geo, mat);
    }
    if (kind === 'ramp') {
      geo = new THREE.BoxGeometry(GRID, GRID, WALL_THICK);
      mesh = new THREE.Mesh(geo, mat);
      const yaw = Math.round(player.yaw / (Math.PI/2)) * (Math.PI/2);
      mesh.rotation.y = yaw;
      mesh.rotation.x = -Math.PI / 4;
    }

    mesh.position.copy(c);
    this.scene.add(mesh);

    // AABB (worst-case axis-aligned for collision simplicity)
    const worldHalf = new THREE.Vector3(GRID/2, GRID/2, GRID/2);
    if (kind === 'floor' || kind === 'roof') worldHalf.y = FLOOR_THICK;

    const entry = {
      min: c.clone().sub(worldHalf),
      max: c.clone().add(worldHalf),
      mesh,
      hp: 150,
      kind,
    };
    this.placed.push(entry);
    return true;
  }

  damage(build, amount) {
    build.hp -= amount;
    if (build.hp <= 0) {
      this.scene.remove(build.mesh);
      const idx = this.placed.indexOf(build);
      if (idx >= 0) this.placed.splice(idx, 1);
    } else {
      // darken as it breaks
      const ratio = Math.max(0.2, build.hp / 150);
      build.mesh.material.color.setRGB(0.73 * ratio, 0.53 * ratio, 0.33 * ratio);
    }
  }
}
