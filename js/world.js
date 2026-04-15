import * as THREE from 'three';

/**
 * Procedural map with hills, trees, rocks, a couple of buildings.
 * Everything static lives in `staticColliders` (AABBs) for hit detection.
 */
export class World {
  constructor(scene) {
    this.scene = scene;
    this.size  = 240;                  // play field side length
    this.staticColliders = [];         // {min:Vec3, max:Vec3, destructible:bool, mesh, hp}
    this.destructibleMeshes = [];

    this._buildSky();
    this._buildLights();
    this._buildGround();
    this._scatterTrees(60);
    this._scatterRocks(25);
    this._buildStructures(4);
    this._scatterLootCrates(14);
    this._buildBoundary();
  }

  _buildSky() {
    this.scene.background = new THREE.Color(0x88c0ff);
    this.scene.fog = new THREE.Fog(0x88c0ff, 60, 260);
  }

  _buildLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff4d6, 1.0);
    sun.position.set(80, 140, 60);
    sun.castShadow = false;
    this.scene.add(sun);

    const fill = new THREE.HemisphereLight(0xbfe3ff, 0x3d5a2d, 0.35);
    this.scene.add(fill);
  }

  _buildGround() {
    const seg = 60;
    const geo = new THREE.PlaneGeometry(this.size, this.size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    // gentle hills
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = Math.sin(x * 0.03) * 1.5 + Math.cos(z * 0.04) * 1.2
              + Math.sin((x + z) * 0.07) * 0.6;
      pos.setY(i, h);
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({ color: 0x5c8a3a });
    const mesh = new THREE.Mesh(geo, mat);
    this.ground = mesh;
    this.scene.add(mesh);
  }

  /** Sample ground height at (x, z). */
  groundHeight(x, z) {
    return Math.sin(x * 0.03) * 1.5 + Math.cos(z * 0.04) * 1.2
         + Math.sin((x + z) * 0.07) * 0.6;
  }

  _scatterTrees(n) {
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3.5, 6);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4226 });
    const leafGeo  = new THREE.ConeGeometry(2.0, 4.5, 8);
    const leafMat  = new THREE.MeshLambertMaterial({ color: 0x2f6b2f });

    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * (this.size - 20);
      const z = (Math.random() - 0.5) * (this.size - 20);
      const y = this.groundHeight(x, z);

      const g = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 1.75;
      g.add(trunk);
      const leaves = new THREE.Mesh(leafGeo, leafMat);
      leaves.position.y = 5.5;
      g.add(leaves);
      g.position.set(x, y, z);
      this.scene.add(g);

      const half = new THREE.Vector3(0.7, 4, 0.7);
      const centre = new THREE.Vector3(x, y + 3.5, z);
      this.staticColliders.push({
        min: centre.clone().sub(half),
        max: centre.clone().add(half),
        destructible: true,
        hp: 60,
        reward: 40,
        mesh: g,
      });
      this.destructibleMeshes.push(g);
    }
  }

  _scatterRocks(n) {
    const mat = new THREE.MeshLambertMaterial({ color: 0x808087 });
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * (this.size - 20);
      const z = (Math.random() - 0.5) * (this.size - 20);
      const y = this.groundHeight(x, z);
      const r = 0.8 + Math.random() * 1.6;
      const geo = new THREE.DodecahedronGeometry(r, 0);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y + r * 0.6, z);
      m.rotation.y = Math.random() * Math.PI;
      this.scene.add(m);

      const half = new THREE.Vector3(r, r, r);
      this.staticColliders.push({
        min: m.position.clone().sub(half),
        max: m.position.clone().add(half),
        destructible: false,
        mesh: m,
      });
    }
  }

  _buildStructures(n) {
    // Simple block "houses" to fight around
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xb8a088 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x884030 });

    for (let i = 0; i < n; i++) {
      const cx = (Math.random() - 0.5) * (this.size - 60);
      const cz = (Math.random() - 0.5) * (this.size - 60);
      const cy = this.groundHeight(cx, cz);
      const w = 8, h = 5, d = 8;

      const box = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        wallMat
      );
      box.position.set(cx, cy + h / 2, cz);
      this.scene.add(box);

      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(w * 0.85, 3, 4),
        roofMat
      );
      roof.position.set(cx, cy + h + 1.5, cz);
      roof.rotation.y = Math.PI / 4;
      this.scene.add(roof);

      const half = new THREE.Vector3(w / 2, h / 2, d / 2);
      this.staticColliders.push({
        min: box.position.clone().sub(half),
        max: box.position.clone().add(half),
        destructible: false,
        mesh: box,
      });
    }
  }

  _scatterLootCrates(n) {
    const types = ['shield', 'health', 'ammo', 'wood'];
    const colors = {
      shield: 0x4fc3f7,
      health: 0xef5350,
      ammo:   0xffd54f,
      wood:   0xa0744a,
    };

    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * (this.size - 30);
      const z = (Math.random() - 0.5) * (this.size - 30);
      const y = this.groundHeight(x, z);
      const loot = types[Math.floor(Math.random() * types.length)];

      const group = new THREE.Group();

      const box = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 1.2, 1.4),
        new THREE.MeshLambertMaterial({ color: 0x9c6a3a })
      );
      box.position.y = 0.6;
      group.add(box);

      // colored top "lid" hinting the loot type
      const lid = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 0.18, 1.5),
        new THREE.MeshLambertMaterial({
          color: colors[loot],
          emissive: colors[loot],
          emissiveIntensity: 0.4,
        })
      );
      lid.position.y = 1.25;
      group.add(lid);

      group.position.set(x, y, z);
      this.scene.add(group);

      const half = new THREE.Vector3(0.8, 0.8, 0.8);
      const centre = new THREE.Vector3(x, y + 0.7, z);
      this.staticColliders.push({
        min: centre.clone().sub(half),
        max: centre.clone().add(half),
        destructible: true,
        hp: 40,
        reward: 15,
        loot,                    // marker used by game.js
        mesh: group,
      });
    }
  }

  _buildBoundary() {
    // Invisible walls at map edge
    const s = this.size / 2;
    const h = 30;
    const t = 2;
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    const pairs = [
      [ 0, -s,  this.size, t ],
      [ 0,  s,  this.size, t ],
      [-s,  0,  t, this.size ],
      [ s,  0,  t, this.size ],
    ];
    for (const [x, z, w, d] of pairs) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, h / 2, z);
      this.scene.add(m);
      const half = new THREE.Vector3(w / 2, h / 2, d / 2);
      this.staticColliders.push({
        min: m.position.clone().sub(half),
        max: m.position.clone().add(half),
        destructible: false,
        mesh: m,
      });
    }
  }

  /** Damage a destructible collider and remove if dead. Returns reward wood. */
  hitCollider(collider, amount) {
    if (!collider.destructible) return 0;
    collider.hp -= amount;
    if (collider.hp <= 0) {
      this.scene.remove(collider.mesh);
      const idx = this.staticColliders.indexOf(collider);
      if (idx >= 0) this.staticColliders.splice(idx, 1);
      return collider.reward || 20;
    }
    return 0;
  }
}
