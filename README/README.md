# Teleprompter IA — Documentação completa

## 1. Visão geral

Este projeto é um teleprompter desktop para Windows construído com Electron.
Ele possui quatro responsabilidades principais:

1. Exibir o painel do operador.
2. Exibir o texto em uma janela de apresentador, normalmente em um segundo monitor.
3. Capturar áudio do microfone e transcrever a fala com o Parakeet TDT.
4. Comparar a transcrição com o roteiro e avançar automaticamente o bloco atual.

O processamento é local. O áudio, o roteiro e a transcrição são tratados no
computador do usuário. O modelo permitido pelo worker é o modelo de português
brasileiro:

```text
yuriyvnv/parakeet-tdt-0.6b-portuguese
```

## 2. Instalação em outra máquina Windows

### 2.1 Pré-requisitos

- Windows 10 ou Windows 11 de 64 bits;
- Python 3.11 recomendado;
- microfone funcionando e acesso ao microfone permitido pelo Windows;
- conexão com a internet no primeiro carregamento do modelo;
- pelo menos 10 GB livres para as dependências e o modelo;
- GPU NVIDIA/CUDA opcional; sem GPU, a transcrição pode ser mais lenta.

Instale o Python em <https://www.python.org/downloads/windows/> e marque
`Add Python to PATH`. Confirme no PowerShell:

```powershell
python --version
```

### 2.2 Instalação pelo instalador

O instalador gerado pelo projeto é:

```text
dist/Jornal IA Teleprompter-0.1.0-x64.exe
```

Execute o instalador, escolha o diretório e mantenha a criação de atalhos. O
artefato atual inclui o Electron e o worker `python/worker.py`, mas não inclui
um interpretador Python nem as dependências do Parakeet. Copie a pasta `python/`
para a máquina de teste, por exemplo em `C:\TeleprompterIA`, e execute:

```powershell
cd C:\TeleprompterIA
python -m venv .venv-parakeet
.\.venv-parakeet\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r .\python\requirements.txt
```

Se o PowerShell bloquear a ativação:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Ative o ambiente novamente e configure o interpretador do aplicativo:

```powershell
.\.venv-parakeet\Scripts\Activate.ps1
$pythonPath = "C:\TeleprompterIA\.venv-parakeet\Scripts\python.exe"
[Environment]::SetEnvironmentVariable("PARAKEET_PYTHON", $pythonPath, "User")
```

Feche e abra o aplicativo novamente. No primeiro carregamento, o modelo
`yuriyvnv/parakeet-tdt-0.6b-portuguese` será baixado automaticamente.

No Windows, habilite o microfone em **Configurações > Privacidade e segurança >
Microfone**, incluindo o acesso para aplicativos da área de trabalho.

### 2.3 Instalação pelo código-fonte

Com o projeto copiado para a máquina de teste:

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

### 2.4 Verificação e teste completo

Com o aplicativo aberto, verifique o backend e os microfones:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
Invoke-RestMethod http://127.0.0.1:3000/status
Invoke-RestMethod http://127.0.0.1:3000/audio/devices
```

Teste o dashboard do operador, a janela do apresentador, a seleção e captura
do microfone, a transcrição em português, a sincronização automática, os
controles manuais, a fonte, a velocidade e um ou dois monitores.

Para testar um arquivo WAV:

```powershell
$body = @{ path = "C:\TeleprompterIA\teste.wav" } | ConvertTo-Json
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:3000/parakeet/test-audio `
  -ContentType "application/json" -Body $body
```

O arquivo precisa existir e o modelo precisa estar carregado.

### 2.5 Problemas comuns

- **Parakeet offline:** confira `$env:PARAKEET_PYTHON` e reinstale as
  dependências de `python/requirements.txt`.
- **Nenhum microfone:** confira as permissões do Windows e execute
  `python -c "import sounddevice as sd; print(sd.query_devices())"`.
- **Modelo não baixa:** verifique internet, firewall, espaço em disco e acesso
  ao Hugging Face.
- **Transcrição lenta:** sem GPU NVIDIA/CUDA, o processamento usa CPU.

## 3. Fluxo completo da aplicação

```text
Electron
  ├─ janela Operador
  │    └─ index.html + app.js
  ├─ janela Apresentador
  │    └─ presenter.html + presenter.js
  ├─ preload.js
  │    └─ expõe operações seguras para as telas
  └─ backend/server.js
       ├─ HTTP em 127.0.0.1:3000
       ├─ WebSocket em 127.0.0.1:3000
       ├─ script-tracker.js
       └─ python/worker.py
            ├─ carrega o Parakeet
            ├─ lista microfones
            ├─ captura áudio
            └─ devolve transcrições por JSON
```

### Fluxo de inicialização

1. `npm start` inicia o Electron.
2. `src/main/main.js` cria a janela do operador e a janela do apresentador.
3. O operador conecta ao WebSocket do backend.
4. Ao clicar em **Inicializar back-end**, o Electron verifica se a porta
   `3000` já está respondendo.
5. Se necessário, ele inicia `src/main/backend/server.js`.
6. O backend inicia o worker Python somente quando precisa executar um comando.
7. O worker carrega o Parakeet em CPU ou CUDA.
8. O worker inicia o microfone e envia eventos de transcrição.
9. O backend acumula os fragmentos, atualiza o rastreador e transmite o bloco
   atual por WebSocket.
10. O operador e o apresentador atualizam a interface ao mesmo tempo.

### Fluxo de uma fala

```text
Microfone
  -> sounddevice
  -> buffer de áudio do worker.py
  -> normalise_audio()
  -> Parakeet TDT
  -> evento JSON "transcription"
  -> queueTranscription()
  -> mergeTranscript()
  -> ScriptTracker.update()
  -> evento WebSocket "teleprompter_update"
  -> app.js e presenter.js
```

## 4. Estrutura dos arquivos próprios

```text
teleprompter-ia-electron/
├─ package.json
├─ package-lock.json
├─ python/
│  ├─ worker.py
│  └─ requirements.txt
├─ src/
│  ├─ main/
│  │  ├─ main.js
│  │  └─ backend/
│  │     ├─ server.js
│  │     └─ script-tracker.js
│  ├─ preload/
│  │  └─ preload.js
│  └─ renderer/
│     ├─ index.html
│     ├─ presenter.html
│     ├─ css/
│     │  └─ styles.css
│     └─ js/
│        ├─ app.js
│        └─ presenter.js
├─ README/
│  └─ README.md
├─ node_modules/
├─ .venv/
└─ .venv-parakeet/
```

`node_modules`, `.venv`, `.venv-parakeet` e `python/__pycache__` são
dependências, ambientes ou arquivos gerados. Eles não fazem parte da lógica
autoral do projeto e não devem ser editados manualmente.

## 5. Arquivos de configuração e dependências

### `package.json`

Define o projeto Node/Electron:

- `main`: aponta para `src/main/main.js`, o processo principal do Electron.
- `scripts.start`: executa `electron .`.
- `electron`: fornece as janelas desktop.
- `ws`: fornece o servidor WebSocket usado pelo backend e pelos renderers.

### `package-lock.json`

Registra as versões exatas das dependências Node instaladas. Ele deve ser
atualizado pelo npm, e não editado manualmente.

### `python/requirements.txt`

Lista as dependências Python:

- `numpy`: arrays e operações numéricas;
- `scipy`: reamostragem do áudio;
- `soundfile`: leitura de arquivos de áudio;
- `sounddevice`: acesso ao microfone;
- `nemo_toolkit[asr]`: carregamento e inferência do Parakeet.

`torch` e o suporte a CUDA vêm pelo ambiente usado pelo NeMo/PyTorch.

## 6. Processo principal do Electron

Arquivo: `src/main/main.js`

Este arquivo tem acesso às APIs do sistema operacional e não deve ser
substituído pelo código de uma tela. Ele cria janelas, abre arquivos, inicia o
backend e faz chamadas HTTP locais.

### Variáveis principais

- `operatorWindow`: referência para a janela de controle.
- `presenterWindow`: referência para a janela que mostra o roteiro.
- `backendProcess`: processo Node do backend iniciado pelo Electron.
- `backendOwned`: indica se o processo foi iniciado por esta instância do
  Electron.

### `createOperatorWindow()`

Cria a janela principal:

- tamanho inicial de 1440 × 900;
- tamanho mínimo de 1180 × 720;
- carrega `src/renderer/index.html`;
- usa `preload.js`;
- habilita `contextIsolation`;
- mantém `nodeIntegration` desabilitado.

Quando a janela é fechada, a janela do apresentador também é fechada.

### `createPresenterWindow()`

Cria a janela fullscreen do apresentador.

O código procura uma tela diferente da principal. Se houver um segundo monitor,
usa-o; caso contrário, usa o monitor principal. A janela é criada invisível e
só aparece quando o operador solicita.

### `app.whenReady()`

É executado quando o Electron termina de inicializar. Nesse ponto:

- cria as duas janelas;
- registra os handlers IPC de janelas;
- registra o diálogo de importação do roteiro;
- registra o evento `activate` para recriar janelas no macOS.

### Handlers de janela

#### `window:show-presenter`

Cria a janela se necessário, mostra e coloca o foco nela.

#### `window:hide-presenter`

Esconde a janela do apresentador sem destruí-la.

#### `window:toggle-presenter`

Alterna entre mostrar e esconder a janela. Retorna `true` quando a janela
ficou visível e `false` quando foi escondida.

#### `window:presenter-display-info`

Retorna a quantidade de monitores e as dimensões do monitor principal e do
monitor usado pelo apresentador.

#### `script:open`

Abre uma caixa de seleção de arquivo. Depois que o usuário escolhe um arquivo:

1. lê o conteúdo com `fs.readFile`;
2. retorna `{ path, content }` para o renderer;
3. permite que o `app.js` transforme as linhas em blocos.

### `isBackendOnline()`

Faz uma requisição para `GET /health`. Serve para não iniciar uma segunda
instância do backend quando a porta `3000` já está ocupada por um backend
saudável.

### `startBackend()`

Inicia o backend com `spawn("node", [backendPath])`.

O método:

1. evita iniciar o backend duas vezes na mesma janela;
2. verifica se outra instância já está online;
3. escuta stdout e stderr para exibir logs;
4. espera até `/health` responder;
5. falha explicitamente se o processo encerrar ou não responder em 10 segundos.

### `stopBackend()`

Encerra o backend controlado pelo Electron usando `taskkill` no Windows.
Quando não há processo gerenciado, retorna sucesso sem tentar encerrar um
processo externo.

### `backendRequest(route, options)`

Centraliza as chamadas HTTP do Electron para `127.0.0.1:3000`.

Converte o corpo para JSON, interpreta a resposta e transforma respostas HTTP
de erro em exceções com a mensagem retornada pelo backend.

### Handlers IPC de backend e áudio

- `backend:status` chama `GET /status`.
- `audio:devices` chama `GET /audio/devices`.
- `audio:select` chama `POST /audio/select`.
- `parakeet:start` chama `POST /parakeet/start`.
- `parakeet:stop` chama `POST /parakeet/stop`.
- `recognition:start` chama `POST /recognition/start`.
- `recognition:stop` chama `POST /recognition/stop`.

## 7. Ponte segura entre Electron e interface

Arquivo: `src/preload/preload.js`

O preload roda com acesso controlado ao Electron. Ele usa
`contextBridge.exposeInMainWorld` para publicar somente a API necessária em
`window.teleprompter`.

### Funções expostas

- `showPresenter()`: mostra o apresentador.
- `hidePresenter()`: esconde o apresentador.
- `togglePresenter()`: alterna o apresentador.
- `getDisplayInfo()`: consulta os monitores.
- `openScript()`: abre e lê um roteiro.
- `startBackend()`: inicia o backend.
- `stopBackend()`: encerra o backend.
- `startParakeet(options)`: carrega o modelo.
- `stopParakeet()`: descarrega o modelo.
- `startRecognition(options)`: inicia a captura.
- `stopRecognition()`: para a captura.
- `getBackendStatus()`: consulta o estado.
- `getAudioDevices()`: lista microfones.
- `selectAudioDevice(device)`: seleciona um dispositivo.

Cada função chama `ipcRenderer.invoke`, evitando que o HTML tenha acesso
direto a `require`, `fs`, `child_process` ou outras APIs sensíveis.

## 8. Backend HTTP e WebSocket

Arquivo: `src/main/backend/server.js`

O backend é um servidor HTTP e WebSocket local na porta `3000`.

### Estado global

O objeto `state` mantém:

- estado do backend;
- estado do Parakeet;
- reconhecimento ativo ou parado;
- dispositivo de áudio;
- blocos atuais do roteiro;
- sincronização automática;
- bloco atual;
- configurações de fonte e velocidade;
- buffer de transcrição;
- processo Python;
- requisições pendentes ao worker.

`clients` contém todos os sockets WebSocket conectados.
`tracker` é uma instância de `ScriptTracker`.

### `json(res, status, body)`

Define o cabeçalho JSON, o status HTTP e envia o objeto serializado.

### `broadcast(message)`

Serializa uma mensagem e envia para todos os clientes WebSocket conectados.
É como operador e apresentador recebem as mesmas atualizações.

### `log(scope, message)`

Padroniza logs no terminal, por exemplo `[SYNC]` ou `[PARAKEET]`.

### `normalise(text)` e `tokens(text)`

São utilitários locais do backend para normalizar texto e separar palavras.
Eles removem acentos, convertem para minúsculas, removem pontuação e eliminam
espaços duplicados.

### `mergeTranscript(previous, incoming)`

Une fragmentos consecutivos do reconhecimento:

- elimina duplicações quando um fragmento contém o outro;
- detecta sobreposição entre o fim do fragmento anterior e o começo do novo;
- mantém somente uma janela de até 24 palavras;
- corrige casos como `"vamos a"` seguido de `"aos detalhes"`.

### `queueTranscription(text, confidence)`

Recebe uma transcrição do worker, junta o fragmento ao buffer e aguarda
650 ms após a última mensagem. Esse pequeno atraso permite que respostas
parciais sejam combinadas antes do algoritmo tomar uma decisão.

Depois do timer:

1. envia `transcription` para as telas;
2. chama `updateFromTranscription`.

### `updateFromTranscription(text, confidence)`

Envia o texto acumulado ao `ScriptTracker`.

Quando o rastreador confirma avanço:

- cria `teleprompter_update`;
- preserva avanço automático somente para frente;
- inclui bloco, progresso, confiança, fonte e configurações;
- transmite a atualização por WebSocket se `autoSync` estiver ligado.

### `failPending(error)`

Rejeita todas as Promises de comandos que ainda aguardavam resposta do worker.
É usado quando o processo Python falha ou encerra.

### `startWorker()`

Inicia `python/worker.py` com `spawn`.

O protocolo usa:

- stdin do worker para enviar comandos JSON;
- stdout para receber respostas JSON;
- stderr para logs de bibliotecas e diagnóstico.

O método também:

- processa respostas delimitadas por newline;
- encaminha eventos de transcrição;
- atualiza o estado do Parakeet;
- resolve ou rejeita comandos pendentes;
- informa falhas do processo.

### `workerCommand(cmd, args)`

Cria um ID incremental, registra uma Promise pendente e envia um comando JSON
para o worker.

Exemplo de mensagem enviada:

```json
{
  "id": 4,
  "cmd": "start_capture",
  "device": 2,
  "bufferSeconds": 0.5
}
```

### `readBody(req)`

Lê o corpo de uma requisição HTTP e o transforma em objeto JSON. Corpos vazios
viram `{}` e JSON inválido gera erro.

### Rotas HTTP

| Método | Rota | Função |
|---|---|---|
| GET | `/health` | Confirma que o servidor está online. |
| GET | `/status` | Retorna backend, Parakeet, captura e dispositivo. |
| GET | `/audio/devices` | Consulta os microfones pelo worker. |
| POST | `/parakeet/start` | Carrega o modelo pt-BR. |
| POST | `/parakeet/stop` | Para captura e descarrega o modelo. |
| POST | `/parakeet/test` | Retorna ambiente Python, Torch, CUDA e NeMo. |
| POST | `/parakeet/test-audio` | Transcreve um arquivo de áudio. |
| POST | `/audio/select` | Seleciona o dispositivo de entrada. |
| POST | `/recognition/start` | Inicia captura contínua. |
| POST | `/recognition/stop` | Para captura contínua. |
| POST | `/script` | Atualiza o roteiro por HTTP. |

### Eventos WebSocket recebidos

#### `script`

Substitui o roteiro, limpa o buffer, reseta o tracker e define se a sincronização
automática está ativa.

#### `auto_sync`

Liga ou desliga a emissão de avanços automáticos.

#### `presenter_settings`

Atualiza tamanho da fonte e velocidade e retransmite `presenter_state`.

#### `manual_update`

Move o cursor manualmente para um bloco. Diferentemente do avanço automático,
pode voltar para trás. Também reposiciona o tracker para que a fala seguinte
seja interpretada a partir do novo bloco.

### Eventos WebSocket enviados

- `backend_status`: backend online ou reconhecimento ativo.
- `parakeet_status`: carregando, pronto, capturando ou offline.
- `transcription`: texto reconhecido e confiança.
- `teleprompter_update`: bloco e progresso atual.
- `presenter_state`: fonte e velocidade.
- `script_state`: roteiro vigente.
- `error`: erro com código e mensagem.

### `shutdown()`

Encerra o worker, fecha WebSocket e servidor HTTP e finaliza o processo.
É registrado para `SIGTERM` e `SIGINT`.

## 9. Algoritmo de reconhecimento do roteiro

Arquivo: `src/main/backend/script-tracker.js`

O rastreador recebe blocos do roteiro e mantém um cursor global de tokens.
Ele não compara somente uma frase inteira. Em vez disso, faz uma comparação
local com tolerância a erros e palavras faltantes.

### `STOPWORDS`

Conjunto de palavras curtas e frequentes, como `a`, `o`, `de`, `e` e `para`.
Essas palavras recebem menor peso para não dominarem a decisão do algoritmo.

### `normalise(text)`

Remove acentos, converte para minúsculas, troca pontuação por espaço e
normaliza espaços.

Exemplo:

```text
"Começamos agora!" -> "comecamos agora"
```

### `tokenize(text)`

Normaliza o texto e devolve um array de palavras.

### `weightOf(token)`

Calcula o peso de uma palavra:

- stopwords e palavras muito curtas recebem peso `0.35`;
- palavras relevantes recebem peso proporcional ao tamanho, limitado para
  evitar que palavras muito longas dominem tudo.

### `levenshtein(a, b)`

Calcula a distância de edição entre duas palavras. É usada para tolerar erros
pequenos do reconhecimento de voz.

### `similarity(a, b)`

Retorna uma similaridade de `0` a `1`:

- `1` para palavras iguais;
- similaridade fuzzy para palavras com poucas diferenças;
- correspondência por prefixo para flexões;
- cache para evitar recalcular os mesmos pares.

### `ScriptTracker.constructor()`

Inicializa:

- blocos;
- tokens;
- índices de início dos blocos;
- posição atual;
- confiança;
- contagem de falhas;
- alvo pendente de salto;
- última janela processada.

### `setScript(blocks)`

Carrega um novo roteiro. Para cada bloco, cria tokens com:

- texto normalizado;
- peso;
- índice do bloco;
- índice da palavra original.

Ao terminar, reseta o cursor para o começo.

### `reset(blockIndex)`

Limpa falhas, salto pendente, última janela e confiança. Depois posiciona o
cursor no bloco solicitado.

### `setBlock(blockIndex)`

Move o cursor para o início de um bloco específico. É usado pelos controles
manuais e não impõe a regra de avanço somente para frente.

### `getState()`

Retorna:

- posição global;
- bloco atual;
- palavra atual;
- progresso dentro do bloco;
- confiança;
- total de tokens.

### `align(spoken, lo, hi)`

Executa o alinhamento local entre palavras faladas e uma região do roteiro.

O método usa uma matriz de pontuação semelhante a Smith-Waterman:

- diagonal: palavra falada corresponde à palavra do roteiro;
- movimento para cima: palavra extra ou improvisada;
- movimento para a esquerda: palavra omitida;
- reinício local: evita penalizar a janela inteira por trechos sem relação.

Também aplica penalização para saltos distantes e para correspondências atrás
do cursor. O resultado contém posição inicial, posição final, quantidade de
matches, pontuação e confiança.

### `update(text)`

É o método principal do rastreador:

1. tokeniza as últimas 32 palavras;
2. ignora a mesma janela repetida;
3. procura primeiro numa janela local de 8 palavras para trás e 45 para frente;
4. aceita avanço com evidência suficiente;
5. se não encontrar, aguarda pelo menos duas falhas;
6. somente então tenta uma busca global forte;
7. exige confirmação em duas ocorrências para um salto grande;
8. nunca move automaticamente para trás.

Esse comportamento evita que uma frase curta repetida, como `"boa noite"`,
faça o roteiro saltar para outra ocorrência distante.

## 10. Tela do operador

### `src/renderer/index.html`

Define a estrutura visual do operador:

- barra lateral;
- cartões de status;
- transcrição ao vivo;
- lista do roteiro;
- botões avançar, voltar, pausar e reiniciar;
- alternância de sincronização;
- controles de velocidade e fonte;
- preview;
- tela de configurações;
- botão de inicialização do backend.

O Content Security Policy permite apenas recursos locais e conexão com
`127.0.0.1:3000`.

### `src/renderer/js/app.js`

Controla a interface do operador.

#### Estado do renderer

- `scriptBlocks`: blocos atuais;
- `currentBlock`: bloco selecionado;
- `paused`: estado da pausa visual;
- `autoSync`: sincronização automática;
- `presenterFontSize`: tamanho da fonte;
- `presenterSpeed`: velocidade;
- `transcriptionText`: última transcrição;
- `socket`: WebSocket do backend.

#### `$ (selector)`

Atalho para `document.querySelector`.

#### `sendScript()`

Envia o roteiro atual e o estado de sincronização ao backend pelo WebSocket.

#### `setScript(blocks, label)`

Substitui o roteiro no operador:

1. remove linhas vazias;
2. zera o bloco atual;
3. limpa a transcrição;
4. redesenha a lista;
5. envia o novo roteiro ao backend;
6. atualiza o rótulo do arquivo.

#### `renderScript()`

Redesenha todos os blocos na lista:

- marca blocos anteriores como concluídos;
- marca o bloco atual;
- adiciona número, texto e indicador visual;
- registra clique para seleção manual;
- atualiza o contador.

#### `updateUI()`

Atualiza transcrição, confiança, status ao vivo, indicador de pausa e dispara
o evento local `teleprompter-state`.

Esse evento permite que outros componentes da mesma janela reajam ao estado
do teleprompter.

#### `sendManualBlock()`

Envia `manual_update` para o backend. Esse caminho permite voltar no roteiro.

#### `sendPresenterSettings()`

Envia tamanho de fonte e velocidade ao backend.

#### `setSection(section)`

Alterna entre painel principal e configurações e atualiza o botão ativo da
barra lateral.

#### `tickClock()`

Atualiza o relógio no padrão local `pt-BR`.

#### `initDisplays()`

Consulta o Electron e mostra quantos monitores foram detectados.

#### `importScript()`

Solicita um arquivo ao Electron, divide o conteúdo por linhas, remove vazios e
chama `setScript`.

#### Eventos dos controles

- `pauseBtn`: alterna pausa visual.
- `advanceBtn`: avança um bloco.
- `backBtn`: volta um bloco.
- `resetBtn`: retorna ao primeiro bloco.
- `autoSyncToggle`: liga ou desliga a sincronização automática.
- `speedRange`: atualiza velocidade.
- `fontRange`: atualiza fonte.
- `openPresenterBtn` e `presenterNav`: mostram o apresentador.
- `importScriptBtn`: abre o importador.

#### Atalhos de teclado

- `Espaço`: pausa ou continua.
- `Seta direita`: avança.
- `Seta esquerda`: volta.
- `P`: alterna a janela do apresentador.

#### `connectBackendSocket()`

Abre o WebSocket do operador. Ao conectar:

- envia o roteiro;
- envia as configurações do apresentador.

Ao receber:

- `transcription`: atualiza a fala e a confiança;
- `teleprompter_update`: atualiza o bloco;
- `error`: exibe o erro no status.

Se o socket fechar, tenta reconectar após um segundo.

#### Inicialização do backend

O listener de `btnInicializar` controla o ciclo:

- inicia o backend;
- carrega o Parakeet;
- consulta microfones;
- inicia captura;
- ou para Parakeet e backend ao clicar novamente.

## 11. Tela do apresentador

### `src/renderer/presenter.html`

Define a janela fullscreen:

- cabeçalho escuro;
- indicador de conexão;
- quatro linhas de contexto;
- contador de bloco;
- barra de progresso;
- rodapé com modo automático e latência.

### `src/renderer/js/presenter.js`

É uma tela leve que recebe o estado por WebSocket.

#### Estado

- `currentBlock`: bloco exibido;
- `totalBlocks`: total de blocos;
- `fontSize`: tamanho da linha principal;
- `speed`: configuração recebida;
- `progress`: progresso do bloco;
- `scriptBlocks`: roteiro recebido.

#### `render()`

Preenche:

- linha anterior;
- linha atual;
- próxima linha;
- linha futura;
- contador;
- porcentagem;
- largura da barra de progresso.

#### Mensagem `script_state`

Substitui o roteiro do apresentador quando o operador importa um novo arquivo.

#### Mensagem `teleprompter_update`

Atualiza o bloco e o progresso. Atualizações manuais podem ir para trás;
atualizações automáticas usam `Math.max` para permanecer monotônicas.

#### Mensagem `presenter_state`

Atualiza tamanho de fonte e velocidade.

#### Teclado do apresentador

- `ArrowDown` e `ArrowRight`: avançam;
- `ArrowUp` e `ArrowLeft`: voltam;
- cada ação manual é enviada ao backend.

## 12. Estilos visuais

Arquivo: `src/renderer/css/styles.css`

O CSS atende as duas telas.

### Variáveis `:root`

Centralizam cores, bordas, sombras, textos e cores de estado.

### Estilos do operador

Definem:

- layout com sidebar;
- cartões;
- painéis;
- botões;
- lista de roteiro;
- waveform animada;
- controles de range;
- preview;
- tela de configurações.

### Estilos do apresentador

Usam fundo preto, texto centralizado e hierarquia visual:

- linha anterior em cinza;
- linha atual em azul;
- próxima linha em branco;
- linha futura em cinza escuro.

### Animação `wave`

Anima as barras do indicador de áudio para representar escuta ativa.

### Classes de estado

- `.current`: bloco atual;
- `.done`: bloco concluído;
- `.active`: navegação e toggle ligados;
- `.hidden`: esconde seções;
- `.success`: estado online ou ativo.

### Media queries

Adaptam o layout para telas menores:

- reduzem sidebar;
- empilham colunas;
- transformam grids em uma única coluna.

## 13. Worker Python e Parakeet

Arquivo: `python/worker.py`

O worker é um processo separado. Ele conversa com o Node através de JSON por
linhas:

```text
Node stdin  -> worker.py
Node stdout <- worker.py
worker logs -> stderr
```

O código redireciona `stdout` comum para `stderr`, reservando stdout para o
protocolo da aplicação.

### Constantes

- `TARGET_SR = 16000`: taxa de amostragem usada pelo modelo.
- `PORTUGUESE_MODEL`: modelo pt-BR permitido.
- `LANGUAGE = "pt-BR"`: idioma informado nas respostas.

### `send(payload)`

Envia uma resposta JSON por linha com lock para evitar mensagens misturadas
quando há threads concorrentes.

### `event(name, **payload)`

Envia um evento assíncrono com a propriedade `event`.

### `WorkerError`

Exceção própria com `code` e mensagem adequada para o backend.

### `error_from(exc)`

Converte exceções comuns para `WorkerError`.

### `normalise_audio(data, sample_rate)`

Prepara o áudio:

- converte estéreo para mono;
- converte inteiros para float;
- remove offset DC;
- normaliza variações excessivas de volume;
- aplica uma redução conservadora de ruído;
- reamostra para 16 kHz;
- limita amplitude entre -1 e 1.

### `read_audio(path)`

Lê arquivo de áudio com `soundfile`. Se ele não estiver disponível, aceita WAV
PCM 16-bit usando o módulo `wave`.

### `hypothesis_text(result)`

Aceita diferentes formatos de retorno do NeMo e extrai somente o texto da
hipótese.

### `resolve_nemo_file(model_name)`

Resolve o arquivo `.nemo`:

1. aceita somente o modelo português permitido;
2. aceita um caminho local para arquivo `.nemo`;
3. procura um `.nemo` dentro de uma pasta;
4. procura cache legado do NeMo;
5. tenta baixar somente arquivos `.nemo` do Hugging Face;
6. rejeita repositório sem modelo válido.

### `list_devices()`

Consulta `sounddevice`, filtra entradas com canais de gravação e retorna:

- ID;
- nome;
- canais;
- taxa padrão;
- indicação de dispositivo padrão.

### `Engine`

Controla modelo, dispositivo, stream, thread e locks de transcrição.

#### `Engine.__init__()`

Inicializa referências vazias para modelo e captura.

#### `environment()`

Retorna versões e capacidades de Python, Torch, CUDA, GPU, NeMo e
sounddevice.

#### `load(model_name, device_pref)`

Carrega o modelo pt-BR:

- valida CUDA quando solicitada;
- escolhe CPU ou CUDA;
- resolve o `.nemo`;
- restaura o modelo com NeMo;
- move o modelo para o dispositivo escolhido;
- informa status `loading` e `ready`.

#### `status()`

Retorna modelo carregado, idioma, dispositivo e captura ativa.

#### `transcribe(path)`

Lê um arquivo, normaliza o áudio e executa uma transcrição única.

#### `start_capture(device, buffer_seconds)`

Inicia `sounddevice.InputStream` em 16 kHz mono.

O callback:

1. copia pequenos blocos;
2. acumula a quantidade definida pelo buffer;
3. concatena os blocos;
4. cria thread de transcrição;
5. envia o evento quando há texto.

`transcription_lock` impede inferências simultâneas sobre o mesmo modelo.

#### `stop_capture()`

Para e fecha o stream, limpa a referência e informa que o worker voltou ao
estado pronto.

### `handle(command)`

Despacha comandos JSON:

- `ping`;
- `environment`;
- `devices`;
- `load`;
- `status`;
- `unload`;
- `transcribe`;
- `start_capture`;
- `stop_capture`.

Comandos desconhecidos geram `UNKNOWN_COMMAND`.

### Loop final do worker

Lê stdin linha a linha, interpreta JSON, executa `handle` e devolve:

```json
{
  "id": 1,
  "ok": true,
  "result": {}
}
```

Em caso de erro:

```json
{
  "id": 1,
  "ok": false,
  "code": "CODIGO",
  "error": "mensagem"
}
```

## 14. Modelo de dados das mensagens principais

### Atualização do roteiro

```json
{
  "type": "script",
  "blocks": [
    "Boa noite.",
    "Começamos agora o nosso jornal."
  ],
  "autoSync": true
}
```

### Transcrição

```json
{
  "type": "transcription",
  "text": "começamos agora",
  "confidence": null
}
```

### Atualização do teleprompter

```json
{
  "type": "teleprompter_update",
  "blockIndex": 1,
  "progress": 0.4,
  "confidence": 0.92,
  "source": "auto",
  "fontSize": 72,
  "speed": 1
}
```

`source` pode ser:

- `auto`: veio da voz;
- `manual`: veio de botão ou teclado;
- `state`: estado enviado ao conectar.

## 15. Como usar

### Instalação Node

```powershell
npm install
```

### Instalação Python

Use o ambiente destinado ao Parakeet:

```powershell
python -m venv .venv-parakeet
.venv-parakeet\Scripts\python.exe -m pip install -r python\requirements.txt
```

O ambiente existente também pode ser usado, desde que contenha PyTorch,
NeMo, sounddevice e as demais dependências.

### Executar

```powershell
npm start
```

### Sequência recomendada

1. Abra o projeto.
2. Clique em **Importar roteiro**.
3. Selecione um arquivo `.txt`.
4. Abra a tela **Configurações**.
5. Selecione o dispositivo de processamento.
6. Clique em **Inicializar back-end**.
7. Aguarde o Parakeet ficar pronto.
8. Abra o apresentador.
9. Ative ou desative a sincronização automática conforme necessário.

## 16. Formato recomendado de roteiro

Use um arquivo `.txt` UTF-8. Cada linha não vazia vira um bloco:

```text
Boa noite.
Começamos agora o nosso jornal.
Entre os principais assuntos desta quarta-feira.
Vamos aos detalhes.
```

Linhas vazias são removidas. O texto inteiro não deve conter código
JavaScript, HTML ou comandos: ele é tratado como conteúdo literal do roteiro.

## 17. Diagnóstico

### Backend não inicia

Verifique se a porta `3000` está ocupada. O backend expõe:

```text
http://127.0.0.1:3000/health
```

Uma resposta válida é:

```json
{"status":"online","backend":"online"}
```

### `EADDRINUSE`

Significa que a porta já tem outro processo. Feche a instância anterior ou
inicie com outra porta, lembrando que o Electron e os renderers também
precisam usar a mesma porta.

### Parakeet não carrega

Confira:

- ambiente Python correto;
- `nemo_toolkit` e `torch` instalados;
- arquivo `.nemo` disponível;
- espaço em disco;
- GPU e CUDA, se `cuda` foi selecionado;
- modelo exatamente igual ao modelo pt-BR permitido.

### Nenhum microfone

Confira:

- permissão do Windows;
- microfone conectado;
- dispositivo com `max_input_channels > 0`;
- dispositivo selecionado no painel;
- instalação de `sounddevice`.

### Roteiro não avança

Confira:

- backend online;
- Parakeet pronto;
- reconhecimento iniciado;
- sincronização automática ligada;
- transcrição aparecendo no painel;
- texto falado semelhante ao roteiro.

O tracker aguarda evidência para evitar saltos errados. Frases muito curtas ou
fora da região do cursor podem não mover o roteiro imediatamente.

### Apresentador não acompanha

Confira se:

- o WebSocket está em `ws://127.0.0.1:3000`;
- o backend está online;
- o apresentador foi aberto depois do Electron;
- o roteiro foi enviado após a importação.

## 18. Pontos importantes de manutenção

- Não coloque funções JavaScript dentro de strings usadas em `innerHTML`.
- Não altere o modelo do worker para outro idioma sem atualizar a regra
  explícita de pt-BR.
- Mudanças no formato das mensagens precisam ser aplicadas no backend, no
  operador e no apresentador.
- Alterações no algoritmo devem preservar a regra: sincronização automática
  avança, mas controles manuais podem voltar.
- O stdout do worker é um protocolo; logs devem continuar no stderr.
- Não edite `node_modules`, `.venv`, `.venv-parakeet` ou `__pycache__`.
- Ao mudar a porta, atualize o backend, o Electron e o Content Security Policy.

## 19. Validação rápida

Com o projeto parado, valide a sintaxe JavaScript:

```powershell
node --check src\main\main.js
node --check src\main\backend\server.js
node --check src\main\backend\script-tracker.js
node --check src\preload\preload.js
node --check src\renderer\js\app.js
node --check src\renderer\js\presenter.js
```

Teste o tracker:

```powershell
node -e "const {ScriptTracker}=require('./src/main/backend/script-tracker'); const t=new ScriptTracker(); t.setScript(['Boa noite.','Começamos agora o jornal.']); console.log(t.update('boa noite')); console.log(t.update('comecamos agora'));"
```

Teste a saúde do backend:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/health
```

## 20. Resumo por arquivo

| Arquivo | Responsabilidade |
|---|---|
| `package.json` | Configuração do Electron e dependências Node. |
| `package-lock.json` | Versões exatas das dependências Node. |
| `python/requirements.txt` | Dependências Python do reconhecimento. |
| `python/worker.py` | Modelo Parakeet, microfone e protocolo JSON. |
| `src/main/main.js` | Processo principal, janelas, IPC e backend. |
| `src/main/backend/server.js` | HTTP, WebSocket, estado e integração com worker. |
| `src/main/backend/script-tracker.js` | Alinhamento fuzzy e avanço do roteiro. |
| `src/preload/preload.js` | API segura para os renderers. |
| `src/renderer/index.html` | Estrutura HTML do operador. |
| `src/renderer/js/app.js` | Estado e eventos do operador. |
| `src/renderer/presenter.html` | Estrutura HTML do apresentador. |
| `src/renderer/js/presenter.js` | Sincronização visual do apresentador. |
| `src/renderer/css/styles.css` | Aparência, layout, animações e responsividade. |
| `README/README.md` | Esta documentação técnica. |

## 21. Empacotamento Windows

O projeto agora possui scripts de empacotamento:

```powershell
npm.cmd run dist
npm.cmd run dist:portable
```

O primeiro gera um instalador NSIS. O segundo gera uma versão portátil. A
configuração está no `package.json` e usa `electron-builder`.

### O que é empacotado automaticamente

- Electron;
- Node.js usado pelo Electron;
- código JavaScript e HTML;
- backend HTTP/WebSocket;
- worker Python (`python/worker.py`);
- arquivos de dependência listados na configuração de recursos.

### Python e modelo de IA

Para o `.exe` funcionar em uma máquina sem Python instalado, é necessário
preparar uma distribuição Python própria em:

```text
python/runtime/
```

Ela deve conter:

```text
python/runtime/Scripts/python.exe
python/runtime/Lib/
python/runtime/DLLs/
```

O backend procura primeiro esse Python empacotado. Em desenvolvimento, ele
continua usando `.venv-parakeet/Scripts/python.exe`.

O modelo Parakeet também precisa estar disponível dentro do pacote ou ser
baixado previamente. Como o modelo e as bibliotecas de `torch`/NeMo são
grandes, o ambiente atual `.venv-parakeet` ocupa aproximadamente 1,55 GB.
Copiar esse ambiente inteiro para o instalador produziria um pacote muito
grande.

### Recomendação de distribuição

Há duas opções:

1. **Instalador completo offline**: incluir Python, dependências, PyTorch,
   NeMo e modelo. Funciona sem internet, mas pode ocupar vários gigabytes.
2. **Instalador leve com primeira configuração**: incluir o Electron, backend e
   worker; instalar ou baixar o ambiente/modelo na primeira execução. O
   instalador fica menor, mas exige internet ou um pacote de dependências
   separado.

Um único arquivo `.exe` pode ser o instalador, mas internamente o Windows
precisará extrair os recursos Python e o modelo para uma pasta de instalação.
Não é recomendável tentar transformar PyTorch, NeMo e o modelo em um único
binário nativo, pois essas bibliotecas carregam DLLs e arquivos auxiliares.

### Checklist antes de gerar a versão final

1. Preparar `python/runtime` com uma instalação Python redistribuível.
2. Instalar as dependências Python dentro desse runtime.
3. Colocar o modelo `.nemo` em uma pasta de recursos definida.
4. Ajustar `worker.py` para procurar esse modelo empacotado.
5. Executar `npm.cmd run dist`.
6. Testar o instalador em um Windows limpo, sem Node, Electron ou Python.
7. Testar microfone, GPU/CPU, importação de roteiro e segundo monitor.
