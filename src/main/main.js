const { app, BrowserWindow, screen, ipcMain, dialog } = require("electron");
const fs = require("fs/promises");
const { spawn, exec } = require("child_process");
const path = require("path");

let operatorWindow = null;
let presenterWindow = null;

function createOperatorWindow() {
  operatorWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    title: "Teleprompter IA — Operador",
    backgroundColor: "#07101d",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  operatorWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  operatorWindow.on("closed", () => {
    operatorWindow = null;
    if (presenterWindow && !presenterWindow.isDestroyed()) {
      presenterWindow.close();
    }
  });
}

function createPresenterWindow() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const presenterDisplay = displays.find(d => d.id !== primary.id) || primary;

  const { x, y, width, height } = presenterDisplay.bounds;

  presenterWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    fullscreen: true,
    backgroundColor: "#000000",
    title: "Teleprompter IA — Apresentador",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  presenterWindow.loadFile(path.join(__dirname, "../renderer/presenter.html"));

  presenterWindow.on("closed", () => {
    presenterWindow = null;
  });
}

app.whenReady().then(() => {
  createOperatorWindow();
  createPresenterWindow();

  ipcMain.handle("window:show-presenter", () => {
    if (!presenterWindow || presenterWindow.isDestroyed()) {
      createPresenterWindow();
    }

    presenterWindow.show();
    presenterWindow.focus();
    return true;
  });

  ipcMain.handle("window:hide-presenter", () => {
    if (presenterWindow && !presenterWindow.isDestroyed()) {
      presenterWindow.hide();
    }
    return true;
  });

  ipcMain.handle("window:toggle-presenter", () => {
    if (!presenterWindow || presenterWindow.isDestroyed()) {
      createPresenterWindow();
    }

    if (presenterWindow.isVisible()) {
      presenterWindow.hide();
      return false;
    }

    presenterWindow.show();
    presenterWindow.focus();
    return true;
  });

  ipcMain.handle("window:presenter-display-info", () => {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const secondary = displays.find(d => d.id !== primary.id);

    return {
      count: displays.length,
      primary: {
        width: primary.bounds.width,
        height: primary.bounds.height
      },
      presenter: secondary
        ? {
            width: secondary.bounds.width,
            height: secondary.bounds.height
          }
        : null
    };
  });

  ipcMain.handle("script:open", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: "Roteiro", extensions: ["txt"] },
        { name: "Todos os arquivos", extensions: ["*"] }
      ]
    });

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    const filePath = result.filePaths[0];
    const content = await fs.readFile(filePath, "utf8");
    return { path: filePath, content };
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createOperatorWindow();
      createPresenterWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

let backendProcess = null;
let backendOwned = false;

async function isBackendOnline() {
    try {
        const response = await fetch("http://127.0.0.1:3000/health");
        return response.ok;
    } catch {
        return false;
    }
}

async function startBackend() {
    if (backendProcess) {
        return {
            success: true,
            message: "Backend já está rodando."
        };
    }

    if (await isBackendOnline()) {
        console.log("[BACKEND] Uma instância já está online em http://127.0.0.1:3000.");
        backendOwned = false;
        return {
            success: true,
            message: "Backend já estava online."
        };
    }

    const backendPath = path.join(
        __dirname,
        "backend",
        "server.js"
    );

    console.log("[BACKEND] Server:", backendPath);

    backendProcess = spawn(
        "node",
        [backendPath],
        {
            cwd: path.dirname(backendPath),
            windowsHide: true
        }
    );
    backendOwned = true;

    backendProcess.stdout.on("data", (data) => {
        console.log(`[BACKEND] ${data.toString()}`);
    });

    backendProcess.stderr.on("data", (data) => {
        console.error(`[BACKEND ERROR] ${data.toString()}`);
    });

    backendProcess.on("error", (error) => {
        console.error("[BACKEND PROCESS ERROR]", error);
        backendProcess = null;
        backendOwned = false;
    });

    backendProcess.on("close", (code) => {
        console.log(`[BACKEND] Encerrado. Código: ${code}`);
        backendProcess = null;
        backendOwned = false;
    });

    return new Promise((resolve) => {
        const startedAt = Date.now();
        const check = () => {
            if (!backendProcess) {
                resolve({ success: false, message: "O processo do backend encerrou antes de ficar online." });
                return;
            }
            fetch("http://127.0.0.1:3000/health")
                .then((response) => {
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    return response.json();
                })
                .then(() => resolve({ success: true, message: "Backend online." }))
                .catch((error) => {
                    if (Date.now() - startedAt > 10000) {
                        resolve({ success: false, message: `Backend não respondeu: ${error.message}` });
                    } else {
                        setTimeout(check, 150);
                    }
                });
        };
        check();
    });
}


function stopBackend() {
    if (!backendProcess) {
        console.log("[BACKEND] Nenhum processo do backend gerenciado por esta janela.");

        return {
            success: true,
            message: "Nenhum processo do backend gerenciado por esta janela."
        };
    }

    const pid = backendProcess.pid;

    console.log(`[BACKEND] Encerrando PID ${pid}...`);

    return new Promise((resolve) => {

        exec(`taskkill /PID ${pid} /T /F`, (error, stdout, stderr) => {

            if (error) {
                console.error(
                    "[BACKEND] Erro ao encerrar:",
                    error
                );

                resolve({
                    success: false,
                    message: "Não foi possível encerrar o backend."
                });

                return;
            }

            console.log("[BACKEND] Processo encerrado.");
            console.log(stdout);

            backendProcess = null;
            backendOwned = false;

            resolve({
                success: true,
                message: "Backend encerrado."
            });
        });

    });
}
ipcMain.handle("start-backend", () => {
    return startBackend();
});
ipcMain.handle("stop-backend", () => {
    return stopBackend();
});

async function backendRequest(route, options = {}) {
    const response = await fetch(`http://127.0.0.1:3000${route}`, {
        method: options.method || "GET",
        headers: { "Content-Type": "application/json" },
        body: options.body ? JSON.stringify(options.body) : undefined
    });

    const result = await response.json();

    if (!response.ok) {
        throw new Error(
            result.error ||
            result.message ||
            `HTTP ${response.status}`
        );
    }

    return result;
}



ipcMain.handle("backend:status", () => backendRequest("/status"));
ipcMain.handle("audio:devices", () => backendRequest("/audio/devices"));
ipcMain.handle("audio:select", (_event, device) =>
    backendRequest("/audio/select", { method: "POST", body: { device } })
);
ipcMain.handle("parakeet:start", (_event, options) =>
    backendRequest("/parakeet/start", { method: "POST", body: options || {} })
);
ipcMain.handle("parakeet:stop", () =>
    backendRequest("/parakeet/stop", { method: "POST" })
);
ipcMain.handle("recognition:start", (_event, options) =>
    backendRequest("/recognition/start", { method: "POST", body: options || {} })
);
ipcMain.handle("recognition:stop", () =>
    backendRequest("/recognition/stop", { method: "POST" })
);