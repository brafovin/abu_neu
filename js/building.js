import * as THREE from 'three';

const GRID = 4;             // build grid size (XZ and wall height)
const WALL_THICK  = 0.25;
const FLOOR_THICK = 0.25;

/**
 * Build a triangular-prism ramp geometry.
 * Local frame: footprint x ∈ [-GRID/2, GRID/2], z ∈ [-GRID/2, GRID/2],
 * height y ∈ [0, GRID]. Low end at local +Z, high end at local -Z
 * so that rotating by the player's yaw orients the slope along
 * their forward direction.
 */
function makeRampGeometry() {
  const hw = GRID / 2;
  const h  = GRID;
  const geo = new THREE.BufferGeometry();

  // 6 unique corners
  const verts = [
    -hw, 0,  hw,   // 0 left-front-low
    -hw, 0, -hw,   // 1 left-back-low
    -hw, h, -hw,   // 2 left-back-high
     hw, 0,  hw,   // 3 right-front-low
     hw, 0, -hw,   // 4 right-back-low
     hw, h, -hw,   // 5 right-back-high
  ];
  const idx = [
    0, 1, 2,              // left triangle face
    3, 5, 4,              // right triangle face
    0, 3, 4,  0, 4, 1,    // bottom quad
    1, 4, 5,  1, 5, 2,    // back wall quad
    0, 2, 5,  0, 5, 3,    // slope quad (top surface)
  ];

  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Snaps builds to a 4x4 grid (similar feel to Fortnite).
 * Manages placement preview, placement and destruction.
 */
export class BuildSystem {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.placed = [];           // see tryPlace for entry shape
    this.previewMesh = null;
    this._makePreview();
  }

  _makePreview() {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4fc3f7,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.previewMesh = new THREE.Mesh(new THREE.BoxGeometry(GRID, GRID, WALL_THICK), mat);
    this.previewMesh.visible = false;
    this.scene.add(this.previewMesh);
  }

  _setPreviewGeo(kind) {
    let geo;
    if (kind === 'wall')  geo = new THREE.BoxGeometry(GRID, GRID, WALL_THICK);
    if (kind === 'floor' || kind === 'roof')
                          geo = new THREE.BoxGeometry(GRID, FLOOR_THICK, GRID);
    if (kind === 'ramp')  geo = makeRampGeometry();
    if (this.previewMesh.geometry) this.previewMesh.geometry.dispose();
    this.previewMesh.geometry = geo;
  }

  hidePreview() {
    if (this.previewMesh) this.previewMesh.visible = false;
  }

  _snap(v) { return Math.round(v / GRID) * GRID; }

  _snapYaw(yaw) {
    return Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
  }

  /**
   * Compute the mesh position for a new build at (player, kind).
   * Fortnite-style: placement is close to the player and snapped to
   * the 4x4 grid. Note: for ramps the mesh origin is at the BASE.
   */
  _computePlacement(player, kind) {
    const fwd2D = new THREE.Vector3(
      -Math.sin(player.yaw), 0, -Math.cos(player.yaw)
    ).normalize();

    const anchor = player.position;
    const snapY = (y) => Math.round(y / GRID) * GRID;

    if (kind === 'floor') {
      // Floor 1 grid ahead of the player, at the nearest grid level
      const p = anchor.clone().add(fwd2D.clone().multiplyScalar(GRID * 0.6));
      const baseY = Math.floor((player.position.y + 0.2) / GRID) * GRID;
      return new THREE.Vector3(this._snap(p.x), baseY, this._snap(p.z));
    }
    if (kind === 'wall') {
      // Wall on the grid cell about half a tile in front of the player
      const p = anchor.clone().add(fwd2D.clone().multiplyScalar(GRID * 0.5));
      const baseY = Math.floor((player.position.y + 0.2) / GRID) * GRID;
      return new THREE.Vector3(this._snap(p.x), baseY + GRID / 2, this._snap(p.z));
    }
    if (kind === 'ramp') {
      // Ramp starts roughly at the player's feet, extending forward
      const p = anchor.clone().add(fwd2D.clone().multiplyScalar(GRID * 0.4));
      const baseY = Math.floor((player.position.y + 0.2) / GRID) * GRID;
      return new THREE.Vector3(this._snap(p.x), baseY, this._snap(p.z));
    }
    if (kind === 'roof') {
      // Roof above player's current grid cell, one wall-height up
      const baseY = Math.floor((player.position.y + 0.2) / GRID) * GRID;
      return new THREE.Vector3(
        this._snap(anchor.x),
        baseY + GRID,
        this._snap(anchor.z),
      );
    }
    return new THREE.Vector3(this._snap(anchor.x), anchor.y, this._snap(anchor.z));
  }

  /**
   * Compute the axis-aligned bounding box for a placed build of the given
   * kind at position c, for the given yaw.
   */
  _computeAABB(kind, c, yaw) {
    if (kind === 'wall') {
      const sin = Math.abs(Math.sin(yaw));
      const cos = Math.abs(Math.cos(yaw));
      const hx = (GRID / 2) * cos + (WALL_THICK / 2) * sin;
      const hz = (GRID / 2) * sin + (WALL_THICK / 2) * cos;
      return {
        min: new THREE.Vector3(c.x - hx, c.y - GRID / 2, c.z - hz),
        max: new THREE.Vector3(c.x + hx, c.y + GRID / 2, c.z + hz),
      };
    }
    if (kind === 'floor' || kind === 'roof') {
      return {
        min: new THREE.Vector3(c.x - GRID / 2, c.y - FLOOR_THICK, c.z - GRID / 2),
        max: new THREE.Vector3(c.x + GRID / 2, c.y + FLOOR_THICK, c.z + GRID / 2),
      };
    }
    if (kind === 'ramp') {
      // Ramp origin is at base → full cube AABB GRID tall
      return {
        min: new THREE.Vector3(c.x - GRID / 2, c.y,        c.z - GRID / 2),
        max: new THREE.Vector3(c.x + GRID / 2, c.y + GRID, c.z + GRID / 2),
      };
    }
    return {
      min: c.clone(),
      max: c.clone(),
    };
  }

  updatePreview(player, kind) {
    this._setPreviewGeo(kind);
    const c = this._computePlacement(player, kind);
    const yaw = this._snapYaw(player.yaw);

    this.previewMesh.rotation.set(0, 0, 0);
    this.previewMesh.position.copy(c);

    if (kind === 'wall' || kind === 'ramp') {
      this.previewMesh.rotation.y = yaw;
    }

    this.previewMesh.visible = true;
    this.previewMesh.material.color.set(
      this._canPlace(kind, c, yaw) ? 0x4fc3f7 : 0xff5252
    );
  }

  _canPlace(kind, c, yaw) {
    const aabb = this._computeAABB(kind, c, yaw);
    for (const b of this.placed) {
      if (aabb.max.x <= b.min.x || aabb.min.x >= b.max.x) continue;
      if (aabb.max.y <= b.min.y || aabb.min.y >= b.max.y) continue;
      if (aabb.max.z <= b.min.z || aabb.min.z >= b.max.z) continue;
      return false;
    }
    return true;
  }

  tryPlace(player, kind) {
    if (player.wood < 10) return null;
    const c = this._computePlacement(player, kind);
    const yaw = this._snapYaw(player.yaw);
    if (!this._canPlace(kind, c, yaw)) return null;

    const mat = new THREE.MeshLambertMaterial({ color: 0xbb8855 });
    let mesh;

    if (kind === 'wall') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(GRID, GRID, WALL_THICK), mat);
      mesh.rotation.y = yaw;
    } else if (kind === 'floor' || kind === 'roof') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(GRID, FLOOR_THICK, GRID), mat);
    } else if (kind === 'ramp') {
      mesh = new THREE.Mesh(makeRampGeometry(), mat);
      mesh.rotation.y = yaw;
    } else {
      return null;
    }

    mesh.position.copy(c);
    this.scene.add(mesh);

    const aabb = this._computeAABB(kind, c, yaw);

    const entry = {
      min: aabb.min,
      max: aabb.max,
      mesh,
      hp: 150,
      kind,
      yaw,
      center: c.clone(),
    };
    this.placed.push(entry);
    return entry;
  }

  /**
   * Place a build from network data (no cost, no player needed).
   * Used when receiving build events from remote players.
   */
  placeFromNetwork(kind, centerArr, yaw) {
    const c = new THREE.Vector3(...centerArr);
    if (!this._canPlace(kind, c, yaw)) return null;

    const mat = new THREE.MeshLambertMaterial({ color: 0xbb8855 });
    let mesh;
    if (kind === 'wall') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(GRID, GRID, WALL_THICK), mat);
      mesh.rotation.y = yaw;
    } else if (kind === 'floor' || kind === 'roof') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(GRID, FLOOR_THICK, GRID), mat);
    } else if (kind === 'ramp') {
      mesh = new THREE.Mesh(makeRampGeometry(), mat);
      mesh.rotation.y = yaw;
    } else {
      return null;
    }

    mesh.position.copy(c);
    this.scene.add(mesh);
    const aabb = this._computeAABB(kind, c, yaw);
    const entry = {
      min: aabb.min, max: aabb.max,
      mesh, hp: 150, kind, yaw,
      center: c.clone(),
    };
    this.placed.push(entry);
    return entry;
  }

  /**
   * Returns the walking surface height at (wx, wz) for a ramp build,
   * or null if (wx, wz) is outside the ramp's footprint.
   */
  rampSurfaceHeight(ramp, wx, wz) {
    const hw = GRID / 2;
    const cx = ramp.center.x;
    const cz = ramp.center.z;
    const baseY = ramp.center.y;

    const dx = wx - cx;
    const dz = wz - cz;

    // Inverse rotation by -yaw around Y
    const cs = Math.cos(ramp.yaw);
    const sn = Math.sin(ramp.yaw);
    const lx =  dx * cs - dz * sn;
    const lz =  dx * sn + dz * cs;

    if (lx < -hw || lx > hw || lz < -hw || lz > hw) return null;
    // Slope: y = 0 at lz = +hw, y = GRID at lz = -hw
    const t = (hw - lz) / GRID;  // 0..1
    return baseY + t * GRID;
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
