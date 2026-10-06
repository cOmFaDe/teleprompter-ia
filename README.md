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

## Instalação em outra máquina Windows

### Pré-requisitos

- Windows 10 ou Windows 11 de 64 bits;
- Python 3.11 recomendado;
- microfone funcionando e acesso ao microfone permitido pelo Windows;
- conexão com a internet no primeiro carregamento do modelo;
- pelo menos 10 GB livres para as dependências e o modelo;
- GPU NVIDIA/CUDA é opcional. Sem GPU, a transcrição pode ser mais lenta.

Instale o Python em <https://www.python.org/downloads/windows/> e marque
`Add Python to PATH` durante a instalação. Confirme no PowerShell:

```powershell
python --version
```

### Instalação pelo instalador

O instalador gerado pelo projeto é:

```text
dist/Jornal IA Teleprompter-0.1.0-x64.exe
```

Execute o arquivo, escolha o diretório de instalação e mantenha a opção de
criar atalhos. O instalador atual inclui o aplicativo Electron e o worker
Python, mas não inclui um interpretador Python nem todas as dependências do
Parakeet. Para habilitar a transcrição real, copie também a pasta `python/`
para a máquina de teste, por exemplo em `C:\TeleprompterIA`.

Abra o PowerShell e execute:

```powershell
cd C:\TeleprompterIA
python -m venv .venv-parakeet
.\.venv-parakeet\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r .\python\requirements.txt
```

Se a ativação for bloqueada pelo PowerShell, execute uma vez:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Depois, ative o ambiente novamente e configure o Python usado pelo aplicativo:

```powershell
.\.venv-parakeet\Scripts\Activate.ps1
$pythonPath = "C:\TeleprompterIA\.venv-parakeet\Scripts\python.exe"
[Environment]::SetEnvironmentVariable("PARAKEET_PYTHON", $pythonPath, "User")
```

Feche e abra o aplicativo novamente depois de configurar a variável. Na
primeira inicialização do Parakeet, o modelo
`yuriyvnv/parakeet-tdt-0.6b-portuguese` será baixado automaticamente.

Em **Configurações > Privacidade e segurança > Microfone**, habilite o acesso
ao microfone para aplicativos e para aplicativos da área de trabalho.

### Instalação pelo código-fonte

Copie o projeto para a máquina de teste e execute:

```powershell
cd C:\TeleprompterIA
npm install
python -m venv .venv-parakeet
.\.venv-parakeet\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r .\python\requirements.txt
$env:PARAKEET_PYTHON = "C:\TeleprompterIA\.venv-parakeet\Scripts\python.exe"
npm start
```

### Verificação e teste completo

Com o aplicativo aberto, confirme o backend e os microfones:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
Invoke-RestMethod http://127.0.0.1:3000/status
Invoke-RestMethod http://127.0.0.1:3000/audio/devices
```

Depois teste o dashboard do operador, a janela do apresentador, a seleção e
captura do microfone, a transcrição em português, a sincronização automática,
os controles manuais, a alteração de fonte e velocidade e o funcionamento com
um ou dois monitores.

Para testar um arquivo WAV:

```powershell
$body = @{ path = "C:\TeleprompterIA\teste.wav" } | ConvertTo-Json
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:3000/parakeet/test-audio `
  -ContentType "application/json" -Body $body
```

O arquivo deve existir e o modelo precisa estar carregado.

### Problemas comuns

- **Parakeet offline:** confira `$env:PARAKEET_PYTHON` e reinstale
  `python/requirements.txt`.
- **Nenhum microfone:** confirme as permissões do Windows e teste
  `python -c "import sounddevice as sd; print(sd.query_devices())"`.
- **Modelo não baixa:** verifique internet, firewall, espaço em disco e acesso
  ao Hugging Face.
- **Transcrição lenta:** sem GPU NVIDIA/CUDA, o processamento usa CPU e pode
  demorar mais.

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
