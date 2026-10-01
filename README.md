# Teleprompter IA — Electron + Parakeet

Aplicação local para Windows com backend Node.js, worker Python e transcrição
real pelo NVIDIA Parakeet TDT.

## Stack

- Electron
- HTML
- CSS
- Vanilla JavaScript
- Python 3.11+ (3.14 pode ser usado quando houver wheels disponíveis)
- NVIDIA NeMo ASR / Parakeet TDT
- WebSocket local (`ws://127.0.0.1:3000`)

O Electron e o pacote Node `ws` são instalados com npm. As dependências de
áudio e do modelo são instaladas separadamente no Python.

## Structure

```text
teleprompter-ia/
├── package.json
├── README.md
└── src/
    ├── main/
    │   ├── main.js
    │   └── backend/server.js
    ├── preload/
    │   └── preload.js
    ├── renderer/
    │   └── ...
    └── ...
python/
    ├── worker.py
    └── requirements.txt
npm start
```

Em outro terminal, para instalar o worker:

```bash
python -m pip install -r python/requirements.txt
```

O caminho do interpretador pode ser definido em `PARAKEET_PYTHON`. O padrão
usado neste projeto é `c:/python314/python.exe` quando essa instalação existe.

## Run

```bash
npm install
npm start
```

The app creates:

- Monitor 1: Operator
- Monitor 2: Presenter

If only one monitor is available, the presenter window is created hidden and can be opened from the operator screen.

## Integração implementada

- Operator dashboard
- Presenter fullscreen window
- Preview-style presenter layout
- Script blocks
- Transcrição real via worker Python e Parakeet TDT
- Captura/listagem/seleção de microfone com `sounddevice`
- Endpoints HTTP e WebSocket locais
- Manual controls
- Automatic synchronization toggle
- Presenter typography controls
- Multi-monitor detection
- IPC bridge ready for future backend integration

## Endpoints

- `GET /health`, `GET /status`, `GET /audio/devices`
- `POST /parakeet/start`, `/parakeet/stop`, `/parakeet/test`
- `POST /parakeet/test-audio` com `{ "path": "arquivo.wav" }`
- `POST /audio/select`, `/recognition/start`, `/recognition/stop`
- WebSocket em `ws://127.0.0.1:3000`

O teste de WAV exige um arquivo real e um modelo carregado; o sistema retorna o
erro original caso PyTorch, NeMo, CUDA ou o modelo não estejam disponíveis.
