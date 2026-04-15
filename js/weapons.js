/**
 * Weapon definitions. Used by both player and bots.
 */
export const WEAPONS = {
  pistol: {
    name: 'Pistole',
    damage: 22,
    rpm: 300,          // rounds per minute
    spread: 0.02,
    range: 120,
    clip: 12,
    reserve: 60,
    reload: 1.1,
    auto: false,
    bulletColor: 0xffe066,
    recoil: 0.4,
  },
  rifle: {
    name: 'Sturmgewehr',
    damage: 18,
    rpm: 650,
    spread: 0.035,
    range: 140,
    clip: 30,
    reserve: 120,
    reload: 2.0,
    auto: true,
    bulletColor: 0xfff066,
    recoil: 0.3,
  },
  shotgun: {
    name: 'Schrotflinte',
    damage: 14,        // per pellet
    pellets: 7,
    rpm: 75,
    spread: 0.13,
    range: 40,
    clip: 5,
    reserve: 25,
    reload: 2.4,
    auto: false,
    bulletColor: 0xffb066,
    recoil: 1.6,
  },
  sniper: {
    name: 'Sniper',
    damage: 110,
    rpm: 40,
    spread: 0.001,
    range: 240,
    clip: 4,
    reserve: 16,
    reload: 3.0,
    auto: false,
    bulletColor: 0x66e6ff,
    recoil: 2.5,
  },
  pickaxe: {
    name: 'Spitzhacke',
    damage: 25,
    rpm: 120,
    spread: 0,
    range: 4,
    clip: Infinity,
    reserve: Infinity,
    reload: 0,
    auto: false,
    melee: true,
  },
};

export function makeInventory() {
  const inv = {};
  for (const key of Object.keys(WEAPONS)) {
    const w = WEAPONS[key];
    inv[key] = {
      key,
      ammo: w.clip,
      reserve: w.reserve,
      reloading: false,
      reloadUntil: 0,
      lastFire: 0,
    };
  }
  return inv;
}
