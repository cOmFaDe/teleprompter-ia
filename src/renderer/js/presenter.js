let currentBlock = 0;
let totalBlocks = 8;
let fontSize = 72;
let speed = 1;
let progress = 0;

let scriptBlocks = [
  "Boa noite.",
  "Começamos agora o nosso jornal.",
  "Entre os principais assuntos desta quarta-feira...",
  "A previsão do tempo para Santa Catarina...",
  "E ainda, acompanhe a entrevista exclusiva...",
  "Vamos aos detalhes do esporte...",
  "E mais informações ao longo da nossa programação.",
  "Boa noite e até mais!"
];

function render() {
  const lines = document.querySelectorAll(".presenter-line");
  lines[0].textContent = scriptBlocks[currentBlock - 1] || "";
  lines[1].textContent = scriptBlocks[currentBlock] || "";
  lines[2].textContent = scriptBlocks[currentBlock + 1] || "";
  lines[3].textContent = scriptBlocks[currentBlock + 2] || "";
  lines[1].style.fontSize = `${fontSize}px`;
  document.querySelector("#presenterCounter").textContent =
    `${currentBlock + 1} / ${totalBlocks}`;
  document.querySelector("#presenterPercent").textContent =
    `${Math.round(progress * 100)}%`;
  document.querySelector("#presenterProgress").style.width =
    `${Math.max(progress * 100, ((currentBlock + 1) / totalBlocks) * 100)}%`;
}

const socket = new WebSocket("ws://127.0.0.1:3000");
socket.addEventListener("open", () => {
});
socket.addEventListener("message", (event) => {
  let message;
  try { message = JSON.parse(event.data); } catch { return; }
  if (message.type === "script_state" && Array.isArray(message.blocks)) {
    scriptBlocks = message.blocks.map((block) => String(block));
    totalBlocks = scriptBlocks.length;
    currentBlock = Math.min(currentBlock, Math.max(0, totalBlocks - 1));
    render();
  }
  if (message.type === "teleprompter_update") {
    currentBlock = message.source === "manual" || message.source === "state"
      ? Math.max(0, Math.min(message.blockIndex, totalBlocks - 1))
      : Math.max(currentBlock, Math.min(message.blockIndex, totalBlocks - 1));
    progress = Number.isFinite(message.progress) ? message.progress : progress;
    render();
  }
  if (message.type === "presenter_state") {
    if (Number.isFinite(message.fontSize)) fontSize = message.fontSize;
    if (Number.isFinite(message.speed)) speed = message.speed;
    render();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowRight") {
    currentBlock = Math.min(currentBlock + 1, totalBlocks - 1);
    progress = 0;
    render();
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "manual_update", blockIndex: currentBlock }));
    }
  }
  if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
    currentBlock = Math.max(currentBlock - 1, 0);
    progress = 0;
    render();
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "manual_update", blockIndex: currentBlock }));
    }
  }
});

render();
