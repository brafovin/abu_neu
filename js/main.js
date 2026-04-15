import { Game } from './game.js';
import { NetworkManager } from './network.js';

const menu     = document.getElementById('menu');
const lobby    = document.getElementById('lobby');
const pause    = document.getElementById('pause');
const endScr   = document.getElementById('end');
const hud      = document.getElementById('hud');
const canvas   = document.getElementById('game-canvas');

let game    = null;
let network = null;

function showScreen(which) {
  for (const s of [menu, lobby, pause, endScr]) s.classList.add('hidden');
  if (which) which.classList.remove('hidden');
}

function startMode(mode, opts = {}) {
  menu.classList.add('hidden');
  lobby.classList.add('hidden');
  endScr.classList.add('hidden');
  pause.classList.add('hidden');
  hud.classList.remove('hidden');

  if (game) { game.destroy(); }
  game = new Game(canvas, mode, {
    network: opts.network || null,
    onPause:  () => pause.classList.remove('hidden'),
    onResume: () => pause.classList.add('hidden'),
    onEnd:    (result) => showEnd(result),
  });
  game.start();
}

function showEnd(result) {
  hud.classList.add('hidden');
  endScr.classList.remove('hidden');
  document.getElementById('end-title').textContent =
    result.victory ? 'Victory Royale!' : 'Game Over';
  document.getElementById('end-stats').textContent =
    `Kills: ${result.kills}   ·   Überlebenszeit: ${result.timeStr}` +
    (result.wave ? `   ·   Welle: ${result.wave}` : '');
}

// ───── Offline mode buttons ─────
document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
  btn.addEventListener('click', () => startMode(btn.dataset.mode));
});

// ───── Online mode button opens the lobby ─────
document.getElementById('btn-online-mode').addEventListener('click', () => {
  if (typeof window.Peer === 'undefined') {
    alert('PeerJS konnte nicht geladen werden. Internetverbindung prüfen.');
    return;
  }
  showScreen(lobby);
});

document.getElementById('btn-lobby-back').addEventListener('click', () => {
  if (network) { network.close(); network = null; }
  showScreen(menu);
});

// ── HOST flow ──
document.getElementById('btn-host').addEventListener('click', async () => {
  const hostInfo = document.getElementById('host-info');
  const codeEl   = document.getElementById('room-code');
  codeEl.textContent = '... verbinde ...';
  hostInfo.classList.remove('hidden');
  try {
    if (network) network.close();
    network = new NetworkManager();
    const id = await network.host();
    codeEl.textContent = id;
  } catch (e) {
    codeEl.textContent = 'Fehler: ' + (e && e.message ? e.message : e);
  }
});

document.getElementById('btn-copy-code').addEventListener('click', () => {
  const code = document.getElementById('room-code').textContent || '';
  if (!code || code.startsWith('...') || code.startsWith('Fehler')) return;
  navigator.clipboard && navigator.clipboard.writeText(code).catch(() => {});
});

document.getElementById('btn-start-host').addEventListener('click', () => {
  if (!network || !network.isHost) return;
  startMode('online', { network });
});

// ── JOIN flow ──
document.getElementById('btn-join').addEventListener('click', async () => {
  const code = document.getElementById('join-code').value.trim();
  const statusEl = document.getElementById('join-status');
  if (!code) { statusEl.textContent = 'Bitte Room-Code eingeben.'; return; }

  statusEl.textContent = 'Verbinde ...';
  try {
    if (network) network.close();
    network = new NetworkManager();
    await network.join(code);
    statusEl.textContent = 'Verbunden!';
    startMode('online', { network });
  } catch (e) {
    statusEl.textContent = 'Fehler: ' + (e && e.message ? e.message : e);
    if (network) { network.close(); network = null; }
  }
});

// ───── Pause / End / Menu buttons ─────
document.getElementById('btn-resume').addEventListener('click', () => {
  if (game) game.resume();
});
document.getElementById('btn-menu').addEventListener('click', () => {
  if (game) { game.destroy(); game = null; }
  if (network) { network.close(); network = null; }
  showScreen(menu);
  hud.classList.add('hidden');
});
document.getElementById('btn-again').addEventListener('click', () => {
  if (game) {
    const m = game.mode;
    const net = game.network;
    game.destroy();
    game = null;
    startMode(m, { network: net });
  }
});
document.getElementById('btn-end-menu').addEventListener('click', () => {
  if (game) { game.destroy(); game = null; }
  if (network) { network.close(); network = null; }
  showScreen(menu);
  hud.classList.add('hidden');
});
