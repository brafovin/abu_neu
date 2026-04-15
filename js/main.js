import { Game } from './game.js';

const menu     = document.getElementById('menu');
const pause    = document.getElementById('pause');
const endScr   = document.getElementById('end');
const hud      = document.getElementById('hud');
const canvas   = document.getElementById('game-canvas');

let game = null;

function startMode(mode) {
  menu.classList.add('hidden');
  endScr.classList.add('hidden');
  pause.classList.add('hidden');
  hud.classList.remove('hidden');

  if (game) { game.destroy(); }
  game = new Game(canvas, mode, {
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

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => startMode(btn.dataset.mode));
});

document.getElementById('btn-resume').addEventListener('click', () => {
  if (game) game.resume();
});
document.getElementById('btn-menu').addEventListener('click', () => {
  if (game) { game.destroy(); game = null; }
  pause.classList.add('hidden');
  hud.classList.add('hidden');
  menu.classList.remove('hidden');
});
document.getElementById('btn-again').addEventListener('click', () => {
  if (game) startMode(game.mode);
});
document.getElementById('btn-end-menu').addEventListener('click', () => {
  if (game) { game.destroy(); game = null; }
  endScr.classList.add('hidden');
  hud.classList.add('hidden');
  menu.classList.remove('hidden');
});
