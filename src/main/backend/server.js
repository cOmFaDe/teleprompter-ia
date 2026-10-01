const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { ScriptTracker } = require("./script-tracker");

const PORT = Number(process.env.PORT || 3000);
const WORKER = path.resolve(__dirname, "../../../python/worker.py");
const VENV_PYTHON = path.resolve(__dirname, "../../../.venv-parakeet/Scripts/python.exe");
const PYTHON = process.env.PARAKEET_PYTHON
  || (fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : "python");
const state = {
  backend: "starting",
  parakeet: "offline",
  recognition: false,
  device: null,
  script: [],
  autoSync: true,
  currentBlock: 0,
  autoSyncBlock: 0,
  processingDevice: "auto",
  presenter: { fontSize: 72, speed: 1 },
  transcriptBuffer: "",
  transcriptTimer: null,
  worker: null,
  sequence: 0,
  pending: new Map()
};
const tracker = new ScriptTracker();

const clients = new Set();
let shuttingDown = false;
const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};
const broadcast = (message) => {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
};
const log = (scope, message) => console.log(`[${scope}] ${message}`);

function normalise(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text) {
  return normalise(text).split(" ").filter(Boolean);
}

function mergeTranscript(previous, incoming) {
  const next = String(incoming || "").trim();
  if (!next) return previous;
  if (!previous) return next;
  const previousWords = previous.split(/\s+/);
  const nextWords = next.split(/\s+/);
  const previousNormal = previousWords.map((word) => normalise(word));
  const nextNormal = nextWords.map((word) => normalise(word));

  if (normalise(previous).includes(normalise(next))) return previous;
  if (normalise(next).includes(normalise(previous))) return next;

  let overlap = 0;
  const maxOverlap = Math.min(previousWords.length, nextWords.length, 8);
  for (let size = 1; size <= maxOverlap; size += 1) {
    const left = previousNormal.slice(-size).join(" ");
    const right = nextNormal.slice(0, size).join(" ");
    if (left === right) overlap = size;
  }

  const joined = previousWords.concat(nextWords.slice(overlap));
  // ASR pode quebrar artigos entre duas janelas: "vamos a" + "aos detalhes".
  for (let index = 1; index < joined.length; index += 1) {
    const left = normalise(joined[index - 1]);
    const right = normalise(joined[index]);
    if (left.length <= 3 && right.startsWith(left) && right.length > left.length) {
      joined.splice(index - 1, 1);
      index -= 1;
    }
  }
  return joined.slice(-24).join(" ");
}

function queueTranscription(text, confidence) {
  state.transcriptBuffer = mergeTranscript(state.transcriptBuffer, text);
  clearTimeout(state.transcriptTimer);
  state.transcriptTimer = setTimeout(() => {
    const accumulated = state.transcriptBuffer;
    if (!accumulated) return;
    broadcast({
      type: "transcription",
      text: accumulated,
      confidence
    });
    updateFromTranscription(accumulated, confidence);
  }, 650);
}

function updateFromTranscription(text, confidence) {
  if (!state.script.length) return;
  const result = tracker.update(text);
  if (!result || !result.changed) return;
  const current = result.state;
  const update = {
    type: "teleprompter_update",
    blockIndex: current.blockIndex,
    progress: current.progress,
    confidence: typeof confidence === "number"
      ? Math.min(1, confidence)
      : current.confidence,
    source: "auto",
    fontSize: state.presenter.fontSize,
    speed: state.presenter.speed
  };
  state.autoSyncBlock = Math.max(state.autoSyncBlock || 0, current.blockIndex);
  state.currentBlock = Math.max(state.currentBlock || 0, current.blockIndex);
  log("SYNC", `Bloco ${current.blockIndex + 1}, progresso: ${current.progress.toFixed(2)}`);
  if (state.autoSync) broadcast(update);
}

function failPending(error) {
  for (const [id, pending] of state.pending) {
    pending.reject(error);
    state.pending.delete(id);
  }
}

function startWorker() {
  if (state.worker) return;
  state.worker = spawn(PYTHON, [WORKER], {
    cwd: path.dirname(WORKER),
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });
  state.worker.stdout.setEncoding("utf8");
  let buffer = "";
  state.worker.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch (error) {
        log("PARAKEET", `Resposta inválida do worker: ${error.message}`);
        continue;
      }
      if (message.event) {
        if (message.event === "transcription") {
          queueTranscription(message.text, message.confidence);
        } else if (message.event === "status") {
          state.parakeet = message.status === "capturing" ? "ready" : message.status;
          broadcast({ type: "parakeet_status", status: message.status, ...message });
        } else if (message.event === "error") {
          broadcast({ type: "error", code: message.code, message: message.message });
        } else if (message.event === "log") log("PARAKEET", message.message);
        continue;
      }
      const pending = state.pending.get(message.id);
      if (!pending) continue;
      state.pending.delete(message.id);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(Object.assign(new Error(message.error), { code: message.code }));
    }
  });
  state.worker.stderr.on("data", (chunk) => log("PARAKEET", chunk.toString().trim()));
  state.worker.on("error", (error) => {
    state.worker = null;
    state.parakeet = "offline";
    failPending(error);
    broadcast({ type: "error", code: "PYTHON_PROCESS", message: error.message });
  });
  state.worker.on("close", (code) => {
    state.worker = null;
    state.parakeet = "offline";
    state.recognition = false;
    failPending(new Error(`Python worker encerrou com código ${code}`));
    broadcast({ type: "parakeet_status", status: "offline" });
  });
}

function workerCommand(cmd, args = {}) {
  startWorker();
  const id = ++state.sequence;
  return new Promise((resolve, reject) => {
    state.pending.set(id, { resolve, reject });
    state.worker.stdin.write(`${JSON.stringify({ id, cmd, ...args })}\n`);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

async function route(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { status: "online", backend: state.backend });
    }
    if (req.method === "GET" && url.pathname === "/status") {
      return json(res, 200, {
        backend: state.backend, parakeet: state.parakeet,
        recognition: state.recognition, device: state.device
      });
    }
    if (req.method === "GET" && url.pathname === "/audio/devices") {
      return json(res, 200, await workerCommand("devices"));
    }
    const body = await readBody(req);
    if (req.method === "POST" && url.pathname === "/parakeet/start") {
      if (state.parakeet === "ready") {
        return json(res, 200, { success: true, status: "ready", alreadyLoaded: true });
      }
      if (state.parakeet === "loading") {
        return json(res, 409, {
          success: false,
          code: "PARAKEET_LOADING",
          error: "O Parakeet já está sendo carregado."
        });
      }

      state.parakeet = "loading";
      broadcast({ type: "parakeet_status", status: "loading" });
      try {
        state.processingDevice = body.device || "auto";
        const result = await workerCommand("load", body);
        state.parakeet = "ready";
        broadcast({ type: "parakeet_status", status: "ready", ...result });
        log("PARAKEET", "Modelo carregado e pronto.");
        return json(res, 200, { success: true, status: "ready", ...result });
      } catch (error) {
        state.parakeet = "offline";
        broadcast({
          type: "error",
          code: error.code || "PARAKEET_LOAD",
          message: error.message
        });
        log("PARAKEET", `Erro ao carregar: ${error.message}`);
        return json(res, 500, {
          success: false,
          code: error.code || "PARAKEET_LOAD",
          error: error.message
        });
      }
    }

    if (req.method === "POST" && url.pathname === "/parakeet/stop") {
      const result = await workerCommand("unload");
      state.parakeet = "offline";
      state.recognition = false;
      broadcast({ type: "parakeet_status", status: "offline" });
      return json(res, 200, { success: true, ...result });
    }
    if (req.method === "POST" && url.pathname === "/parakeet/test") {
      return json(res, 200, { success: true, environment: await workerCommand("environment") });
    }
    if (req.method === "POST" && url.pathname === "/parakeet/test-audio") {
      return json(res, 200, { success: true, ...(await workerCommand("transcribe", { path: body.path })) });
    }
    if (req.method === "POST" && url.pathname === "/audio/select") {
      state.device = body.device;
      return json(res, 200, { success: true, device: state.device });
    }
    if (req.method === "POST" && url.pathname === "/recognition/start") {
      if (state.parakeet !== "ready") {
        return json(res, 409, {
          success: false,
          code: "PARAKEET_NOT_READY",
          error: "O Parakeet não está pronto. Aguarde o carregamento do modelo."
        });
      }
      const result = await workerCommand("start_capture", {
        device: state.device,
        bufferSeconds: body.bufferSeconds
      });
      state.recognition = true;
      broadcast({ type: "backend_status", recognition: true });
      return json(res, 200, { success: true, ...result });
    }
    if (req.method === "POST" && url.pathname === "/recognition/stop") {
      const result = await workerCommand("stop_capture");
      state.recognition = false;
      broadcast({ type: "backend_status", recognition: false });
      return json(res, 200, { success: true, ...result });
    }
    if (req.method === "POST" && url.pathname === "/script") {
      state.script = Array.isArray(body.blocks) ? body.blocks : [];
      state.autoSync = body.autoSync !== false;
      tracker.setScript(state.script);
      state.currentBlock = 0;
      state.autoSyncBlock = 0;
      return json(res, 200, { success: true, blocks: state.script.length });
    }
    return json(res, 404, { error: "Endpoint não encontrado" });
  } catch (error) {
    log("BACKEND", error.stack || error.message);
    return json(res, 500, { success: false, code: error.code || "BACKEND_ERROR", error: error.message });
  }
}

const server = http.createServer(route);
const wss = new WebSocket.Server({ server });
wss.on("connection", (socket) => {
  clients.add(socket);
  socket.send(JSON.stringify({ type: "backend_status", status: state.backend }));
  socket.send(JSON.stringify({
    type: "teleprompter_update",
    blockIndex: state.currentBlock,
    progress: 0,
    confidence: null,
    source: "state",
    fontSize: state.presenter.fontSize,
    speed: state.presenter.speed
  }));
  socket.send(JSON.stringify({
    type: "presenter_state",
    fontSize: state.presenter.fontSize,
    speed: state.presenter.speed
  }));
  socket.send(JSON.stringify({ type: "script_state", blocks: state.script }));
  socket.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === "script") {
        const nextScript = Array.isArray(message.blocks) ? message.blocks : [];
        if (JSON.stringify(nextScript) !== JSON.stringify(state.script)) {
          state.script = nextScript;
          state.currentBlock = 0;
          state.autoSyncBlock = 0;
          tracker.setScript(state.script);
        }
        state.transcriptBuffer = "";
        clearTimeout(state.transcriptTimer);
        state.autoSync = message.autoSync !== false;
        broadcast({ type: "script_state", blocks: state.script });
      }
      if (message.type === "auto_sync") state.autoSync = message.enabled === true;
      if (message.type === "presenter_settings") {
        if (Number.isFinite(message.fontSize)) state.presenter.fontSize = message.fontSize;
        if (Number.isFinite(message.speed)) state.presenter.speed = message.speed;
        broadcast({
          type: "presenter_state",
          fontSize: state.presenter.fontSize,
          speed: state.presenter.speed
        });
      }
      if (message.type === "manual_update" && Number.isInteger(message.blockIndex)) {
        state.currentBlock = Math.max(
          0,
          Math.min(message.blockIndex, Math.max(0, state.script.length - 1))
        );
        state.autoSyncBlock = state.currentBlock;
        tracker.setBlock(state.currentBlock);
        broadcast({
          type: "teleprompter_update",
          blockIndex: state.currentBlock,
          progress: 0,
          confidence: null,
          source: "manual",
          fontSize: state.presenter.fontSize,
          speed: state.presenter.speed
        });
      }
    } catch (error) {
      socket.send(JSON.stringify({ type: "error", code: "INVALID_JSON", message: error.message }));
    }
  });
  socket.on("close", () => clients.delete(socket));
});
server.on("listening", () => {
  state.backend = "online";
  log("BACKEND", `HTTP http://127.0.0.1:${PORT}`);
  broadcast({ type: "backend_status", status: "online" });
});
server.on("error", (error) => {
  state.backend = "error";
  broadcast({ type: "error", code: error.code || "SERVER_ERROR", message: error.message });
  log("BACKEND", error.stack || error.message);
  if (error.code === "EADDRINUSE") {
    log("BACKEND", `A porta ${PORT} já está em uso. Encerre a instância anterior ou use PORT=...`);
    process.exitCode = 1;
  }
});
 wss.on("error", (error) => {
  log("BACKEND", `WebSocket indisponível: ${error.message}`);
});
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  state.worker?.kill();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
server.listen(PORT, "127.0.0.1");
