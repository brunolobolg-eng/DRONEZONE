// Loop de exemplo: um drone controlado pelas setas do teclado.
// Substitua por a lógica real do jogo conforme ela for sendo construída.

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const drone = { x: 640, y: 360, size: 40, speed: 240 };
const keys = new Set();
let lastTime = performance.now();

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

window.addEventListener('resize', resize);
window.addEventListener('keydown', (e) => keys.add(e.key));
window.addEventListener('keyup', (e) => keys.delete(e.key));

function update(dt) {
  const dir = { x: 0, y: 0 };
  if (keys.has('ArrowLeft')) dir.x -= 1;
  if (keys.has('ArrowRight')) dir.x += 1;
  if (keys.has('ArrowUp')) dir.y -= 1;
  if (keys.has('ArrowDown')) dir.y += 1;

  drone.x += dir.x * drone.speed * dt;
  drone.y += dir.y * drone.speed * dt;

  drone.x = Math.max(drone.size / 2, Math.min(canvas.width - drone.size / 2, drone.x));
  drone.y = Math.max(drone.size / 2, Math.min(canvas.height - drone.size / 2, drone.y));
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#4fc3f7';
  ctx.fillRect(drone.x - drone.size / 2, drone.y - drone.size / 2, drone.size, drone.size);
}

function frame(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

resize();
requestAnimationFrame(frame);
