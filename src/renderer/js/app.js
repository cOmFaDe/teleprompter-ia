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

let currentBlock = 0;
let paused = false;
let autoSync = true;
let presenterFontSize = 72;
let presenterSpeed = 1;
let transcriptionText = "";
let socket = null;

const $ = (selector) => document.querySelector(selector);

function sendScript() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "script", blocks: scriptBlocks, autoSync }));
  }
}

function setScript(blocks, label) {
  const next = blocks.map((block) => String(block).trim()).filter(Boolean);
  if (!next.length) return;
  scriptBlocks = next;
  currentBlock = 0;
  transcriptionText = "";
  renderScript();
  updateUI();
  sendScript();
  if (label) $("#dateLabel").textContent = label;
}

function renderScript() {
  const list = $("#scriptList");
  list.innerHTML = "";

  scriptBlocks.forEach((text, index) => {
    const row = document.createElement("div");
    row.className = "script-row";

    if (index < currentBlock) row.classList.add("done");
    if (index === currentBlock) row.classList.add("current");

    row.innerHTML = `
      <span class="script-number">${String(index + 1).padStart(2, "0")}</span>
      <span>${text}</span>
      ${
        index < currentBlock
          ? '<span class="script-check">✓</span>'
          : index === currentBlock
            ? '<span class="script-current">Atual</span>'
            : '<span>○</span>'
      }
    `;

    row.addEventListener("click", () => {
      currentBlock = index;
      updateUI();
      sendManualBlock();
    });

    list.appendChild(row);
  });

  $("#scriptCounter").textContent = `${currentBlock + 1} / ${scriptBlocks.length}`;
}

function updateUI() {
  renderScript();

  const current = scriptBlocks[currentBlock] || "";
  $("#transcriptionText").textContent = transcriptionText || "Aguardando transcrição real...";

  $("#confidence").textContent = paused ? "—" : "94%";
  $("#transcriptionStatus").textContent = paused ? "Pausada" : "Ao vivo";
  $("#livePill").textContent = paused ? "PAUSED" : "LIVE";

  if (paused) {
    $("#livePill").classList.remove("success");
  } else {
    $("#livePill").classList.add("success");
  }

  window.dispatchEvent(new CustomEvent("teleprompter-state", {
    detail: {
      currentBlock,
      totalBlocks: scriptBlocks.length,
      currentText: current,
      fontSize: presenterFontSize,
      speed: presenterSpeed,
      autoSync
    }
  }));
}

function sendManualBlock() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "manual_update", blockIndex: currentBlock }));
  }
}

function sendPresenterSettings() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "presenter_settings",
      fontSize: presenterFontSize,
      speed: presenterSpeed
    }));
  }
}

function setSection(section) {
  const dashboard = document.querySelector(".dashboard");
  const settingsView = $("#settingsView");

  document.querySelectorAll(".nav-item").forEach(item => {
    item.classList.remove("active");
  });

  const clicked = document.querySelector(`[data-section="${section}"]`);
  if (clicked) clicked.classList.add("active");

  if (section === "settings") {
    dashboard.classList.add("hidden");
    settingsView.classList.remove("hidden");
  } else {
    dashboard.classList.remove("hidden");
    settingsView.classList.add("hidden");
  }
}

function tickClock() {
  const now = new Date();
  $("#clock").textContent = now.toLocaleTimeString("pt-BR");
}

async function initDisplays() {
  try {
    const info = await window.teleprompter.getDisplayInfo();

    if (info.count > 1) {
      $("#displayInfo").textContent =
        `${info.count} monitores detectados`;
    } else {
      $("#displayInfo").textContent = "1 monitor detectado";
    }
  } catch {
    $("#displayInfo").textContent = "Informação indisponível";
  }
}

async function importScript() {
  const file = await window.teleprompter.openScript();

  if (!file) return;
  const blocks = file.content
    .split(/\r?\n\s*\r?\n|\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  setScript(blocks, `Roteiro: ${file.path}`);
}

$("#pauseBtn").addEventListener("click", () => {
  paused = !paused;
  $("#pauseBtn").innerHTML = paused ? "▶&nbsp; Continuar" : "Ⅱ&nbsp; Pausar";
  updateUI();
});

$("#advanceBtn").addEventListener("click", () => {
  currentBlock = Math.min(currentBlock + 1, scriptBlocks.length - 1);
  updateUI();
  sendManualBlock();
});

$("#backBtn").addEventListener("click", () => {
  currentBlock = Math.max(currentBlock - 1, 0);
  updateUI();
  sendManualBlock();
});

$("#resetBtn").addEventListener("click", () => {
  currentBlock = 0;
  paused = false;
  $("#pauseBtn").innerHTML = "Ⅱ&nbsp; Pausar";
  updateUI();
  sendManualBlock();
});

$("#autoSyncToggle").addEventListener("click", () => {
  autoSync = !autoSync;
  $("#autoSyncToggle").classList.toggle("active", autoSync);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "auto_sync", enabled: autoSync }));
  }
});

$("#speedRange").addEventListener("input", (event) => {
  presenterSpeed = Number(event.target.value);
  $("#speedValue").textContent = `${presenterSpeed.toFixed(1)}x`;
  updateUI();
  sendPresenterSettings();
});

$("#fontRange").addEventListener("input", (event) => {
  presenterFontSize = Number(event.target.value);
  $("#fontValue").textContent = `${presenterFontSize}px`;
  updateUI();
  sendPresenterSettings();
});

$("#openPresenterBtn").addEventListener("click", async () => {
  await window.teleprompter.showPresenter();
});

$("#presenterNav").addEventListener("click", async () => {
  await window.teleprompter.showPresenter();
});

$("#importScriptBtn").addEventListener("click", importScript);

document.querySelectorAll(".nav-item[data-section]").forEach(button => {
  button.addEventListener("click", () => {
    setSection(button.dataset.section);
  });
});

window.addEventListener("keydown", async (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    $("#pauseBtn").click();
  }

  if (event.key === "ArrowRight") {
    $("#advanceBtn").click();
  }

  if (event.key === "ArrowLeft") {
    $("#backBtn").click();
  }

  if (event.key.toLowerCase() === "p") {
    await window.teleprompter.togglePresenter();
  }
});

setInterval(tickClock, 1000);
tickClock();
initDisplays();
renderScript();
updateUI();
connectBackendSocket();

function connectBackendSocket() {
  socket = new WebSocket("ws://127.0.0.1:3000");
  socket.addEventListener("open", () => {
    sendScript();
    sendPresenterSettings();
  });
  socket.addEventListener("message", (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === "transcription") {
      transcriptionText = message.text || "";
      $("#transcriptionText").textContent = transcriptionText || "Aguardando áudio...";
      $("#confidence").textContent = typeof message.confidence === "number"
        ? `${Math.round(message.confidence * 100)}%` : "—";
      $("#transcriptionStatus").textContent = "Ao vivo";
      updateUI();
    }
    if (message.type === "teleprompter_update" && (autoSync || message.source === "manual")) {
      currentBlock = message.source === "manual" || message.source === "state"
        ? Math.max(0, Math.min(message.blockIndex, scriptBlocks.length - 1))
        : Math.max(currentBlock, Math.min(message.blockIndex, scriptBlocks.length - 1));
      updateUI();
    }
    if (message.type === "error") {
      $("#transcriptionStatus").textContent = message.message || "Erro";
      console.error("[BACKEND]", message.code, message.message);
    }

  });
  socket.addEventListener("close", () => {
    setTimeout(() => {
      if (!socket || socket.readyState === WebSocket.CLOSED) connectBackendSocket();
    }, 1000);
  });
  socket.addEventListener("error", () => {
    $("#transcriptionStatus").textContent = "Backend desconectado";
  });
}

const btn = document.getElementById("btnInicializar");

let backendOnline = false;

btn.addEventListener("click", async () => {

    btn.disabled = true;

    try {

        // =========================
        // INICIAR
        // =========================

        if (!backendOnline) {

            btn.textContent = "Inicializando...";

            const resposta =
                await window.teleprompter.startBackend();

            if (resposta.success) {

                backendOnline = true;

                btn.textContent = "🟢 Backend Online";

                console.log("[FRONTEND] Backend iniciado.");
                try {
                  await window.teleprompter.startParakeet({
                    device: $("#processingDevice").value
                  });
                  const audio = await window.teleprompter.getAudioDevices();
                  if (audio.devices && audio.devices.length > 0) {
                    await window.teleprompter.startRecognition({
                      bufferSeconds: Number($("#bufferSelect").value)
                    });
                  } else {
                    $("#transcriptionStatus").textContent = "Nenhum microfone encontrado";
                  }
                } catch (error) {
                  console.error("[FRONTEND] Parakeet:", error);
                  $("#transcriptionStatus").textContent = error.message;
                }

            } else {

                btn.textContent = "🔴 Inicializar Backend";

                console.error(resposta.message);
            }

        }

        // =========================
        // PARAR
        // =========================

        else {

            btn.textContent = "Parando...";

            try { await window.teleprompter.stopParakeet(); } catch (error) {
              console.error("[FRONTEND] Parakeet:", error);
            }
            const resposta =
                await window.teleprompter.stopBackend();

            if (resposta.success) {

                backendOnline = false;

                btn.textContent = "🔴 Inicializar Backend";

                console.log("[FRONTEND] Backend encerrado.");

            } else {

                console.error(resposta.message);
            }
        }

    } catch (error) {

        console.error("[FRONTEND] Erro:", error);

        backendOnline = false;

        btn.textContent = "🔴 Inicializar Backend";

    } finally {

        btn.disabled = false;

    }
});