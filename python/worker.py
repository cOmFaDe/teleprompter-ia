#!/usr/bin/env python
"""Worker local do Parakeet TDT.

O processo Node conversa com este worker por JSON delimitado por newline.
stdout contém somente respostas/eventos do protocolo; logs de bibliotecas vão
para stderr para não corromper o canal.
"""
from __future__ import annotations

import json
import os
import sys
import threading
from typing import Any

PROTO = sys.stdout
sys.stdout = sys.stderr
LOCK = threading.Lock()
TARGET_SR = 16_000
PORTUGUESE_MODEL = "yuriyvnv/parakeet-tdt-0.6b-portuguese"
DEFAULT_MODEL = PORTUGUESE_MODEL
LANGUAGE = "pt-BR"



def send(payload: dict[str, Any]) -> None:
    with LOCK:
        PROTO.write(json.dumps(payload, ensure_ascii=False) + "\n")
        PROTO.flush()


def event(name: str, **payload: Any) -> None:
    send({"event": name, **payload})


class WorkerError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def error_from(exc: Exception) -> WorkerError:
    if isinstance(exc, WorkerError):
        return exc
    return WorkerError(type(exc).__name__.upper(), str(exc))


def normalise_audio(data: Any, sample_rate: int):
    import numpy as np

    data = np.asarray(data)
    if data.ndim > 1:
        data = data.mean(axis=1)
    if data.dtype.kind in "iu":
        info = np.iinfo(data.dtype)
        data = data.astype("float32") / max(abs(info.min), info.max)
    else:
        data = data.astype("float32")
    if data.size:
        # Remove DC offset and normalize only excessive level variation. A
        # conservative gate avoids amplifying keyboard/fan noise into speech.
        data = data - float(data.mean())
        peak = float(np.max(np.abs(data)))
        rms = float(np.sqrt(np.mean(data * data)))
        if rms > 1e-4 and peak > 0.02:
            target_rms = 0.12
            gain = min(4.0, max(0.5, target_rms / rms))
            data = data * gain
        noise_floor = max(0.003, float(np.percentile(np.abs(data), 20)))
        data[np.abs(data) < noise_floor * 0.65] = 0.0
    if sample_rate != TARGET_SR:
        from scipy.signal import resample_poly
        from math import gcd

        divisor = gcd(int(sample_rate), TARGET_SR)
        data = resample_poly(
            data, TARGET_SR // divisor, int(sample_rate) // divisor
        ).astype("float32")
    return np.clip(data, -1.0, 1.0)


def read_audio(path: str):
    if not os.path.isfile(path):
        raise WorkerError("FILE_NOT_FOUND", f"Arquivo de áudio não encontrado: {path}")
    try:
        import soundfile as sf

        data, sample_rate = sf.read(path, dtype="float32", always_2d=False)
    except ImportError:
        import wave
        import numpy as np

        with wave.open(path, "rb") as wav:
            sample_rate = wav.getframerate()
            channels = wav.getnchannels()
            width = wav.getsampwidth()
            raw = wav.readframes(wav.getnframes())
        if width != 2:
            raise WorkerError("AUDIO_FORMAT", "Sem soundfile, somente WAV PCM 16-bit é suportado.")
        data = np.frombuffer(raw, dtype="<i2").reshape(-1, channels)
    except Exception as exc:
        raise WorkerError("AUDIO_READ", f"Não foi possível ler o áudio: {exc}") from exc
    return normalise_audio(data, sample_rate)


def hypothesis_text(result: Any) -> str:
    """Aceita os formatos de retorno das versões do NeMo."""
    hypotheses = result[0] if isinstance(result, tuple) else result
    hypothesis = hypotheses[0] if isinstance(hypotheses, (list, tuple)) else hypotheses
    return getattr(hypothesis, "text", str(hypothesis)).strip()


def resolve_nemo_file(model_name: str) -> str | None:
    """Resolve um repo Hugging Face ou caminho local para um arquivo .nemo."""
    if model_name != PORTUGUESE_MODEL:
        raise WorkerError(
            "UNSUPPORTED_LANGUAGE_MODEL",
            f"Somente o modelo de português do Brasil é permitido: {PORTUGUESE_MODEL}",
        )
    if os.path.isfile(model_name):
        if not model_name.lower().endswith(".nemo"):
            raise WorkerError("MODEL_FORMAT", f"O arquivo do modelo não é .nemo: {model_name}")
        return model_name

    if os.path.isdir(model_name):
        candidates = [
            os.path.join(model_name, name)
            for name in os.listdir(model_name)
            if name.lower().endswith(".nemo")
        ]
        if candidates:
            return max(candidates, key=os.path.getsize)

    if "/" not in model_name:
        return None

    # NeMo 3 pode ter deixado o .nemo no cache legado mesmo quando o
    # snapshot do Hugging Face contém somente metadados auxiliares.
    legacy_cache = os.path.expanduser("~/.cache/torch/NeMo")
    if os.path.isdir(legacy_cache):
        cached = []
        model_hint = model_name.replace("/", os.sep)
        for root, _, files in os.walk(legacy_cache):
            if model_hint.lower() not in root.lower():
                continue
            cached.extend(
                os.path.join(root, name)
                for name in files
                if name.lower().endswith(".nemo") and os.path.getsize(os.path.join(root, name)) > 0
            )
        if cached:
            return max(cached, key=os.path.getsize)

    try:
        from huggingface_hub import snapshot_download

        snapshot = snapshot_download(
            repo_id=model_name,
            allow_patterns=["*.nemo"],
        )
    except Exception as exc:
        raise WorkerError(
            "MODEL_DOWNLOAD",
            f"Não foi possível baixar o modelo {model_name}: {exc}",
        ) from exc

    candidates = []
    for root, _, files in os.walk(snapshot):
        candidates.extend(
            os.path.join(root, name)
            for name in files
            if name.lower().endswith(".nemo")
        )
    if not candidates:
        raise WorkerError(
            "MODEL_FILE_MISSING",
            f"O repositório {model_name} não contém arquivo .nemo.",
        )
    model_path = max(candidates, key=os.path.getsize)
    if os.path.getsize(model_path) == 0:
        raise WorkerError("MODEL_INCOMPLETE", f"O arquivo do modelo está vazio: {model_path}")
    return model_path


def list_devices():
    try:
        import sounddevice as sd
        devices = sd.query_devices()
        default_input = sd.default.device[0]
    except ImportError as exc:
        raise WorkerError("SOUNDDEVICE_MISSING", "Instale sounddevice para usar o microfone.") from exc
    except Exception as exc:
        raise WorkerError("AUDIO_QUERY", f"Falha ao consultar dispositivos: {exc}") from exc
    return [
        {
            "id": index,
            "name": device["name"],
            "channels": device["max_input_channels"],
            "defaultSampleRate": device["default_samplerate"],
            "isDefault": index == default_input,
        }
        for index, device in enumerate(devices)
        if device["max_input_channels"] > 0
    ]


class Engine:
    def __init__(self):
        self.model = None
        self.model_name = None
        self.device = None
        self.stream = None
        self.capture_thread = None
        self.capture_stop = threading.Event()
        self.selected_device = None
        self.transcription_lock = threading.Lock()

    def environment(self):
        result = {"python": sys.version.split()[0], "platform": sys.platform}
        try:
            import torch
            result.update({
                "torch": torch.__version__,
                "cuda": bool(torch.cuda.is_available()),
                "cudaVersion": torch.version.cuda,
                "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
            })
        except Exception as exc:
            result["torchError"] = str(exc)
        try:
            import nemo
            result["nemo"] = getattr(nemo, "__version__", "installed")
        except Exception as exc:
            result["nemoError"] = str(exc)
        try:
            import sounddevice
            result["sounddevice"] = getattr(sounddevice, "__version__", "installed")
        except Exception as exc:
            result["sounddeviceError"] = str(exc)
        return result

    def load(self, model_name: str | None = None, device_pref: str = "auto"):
        if self.model is not None:
            return self.status()
        try:
            import torch
            import nemo.collections.asr as nemo_asr
        except ImportError as exc:
            raise WorkerError("NEMO_OR_TORCH_MISSING", str(exc)) from exc
        requested = (device_pref or "auto").lower()
        if requested == "cuda" and not torch.cuda.is_available():
            raise WorkerError("CUDA_MISSING", "CUDA foi solicitada, mas não está disponível.")
        self.device = "cuda" if requested == "cuda" or (
            requested == "auto" and torch.cuda.is_available()
        ) else "cpu"
        name = model_name or DEFAULT_MODEL
        if name != PORTUGUESE_MODEL:
            raise WorkerError(
                "UNSUPPORTED_LANGUAGE_MODEL",
                f"Somente pt-BR está disponível. Modelo permitido: {PORTUGUESE_MODEL}",
            )
        event("status", status="loading", model=name, device=self.device)
        try:
            nemo_file = resolve_nemo_file(name)
            if nemo_file:
                event("log", message=f"Carregando arquivo NeMo: {nemo_file}")
                self.model = nemo_asr.models.ASRModel.restore_from(
                    restore_path=nemo_file,
                    map_location=self.device,
                )
            else:
                raise WorkerError(
                    "MODEL_FILE_MISSING",
                    f"Arquivo .nemo do modelo pt-BR não encontrado para {name}.",
                )
            self.model = self.model.to(self.device)
            self.model_name = name
        except Exception as exc:
            self.model = None
            raise WorkerError("MODEL_LOAD", f"Não foi possível carregar {name}: {exc}") from exc
        event("status", status="ready", model=name, device=self.device)
        return self.status()

    def status(self):
        return {
            "loaded": self.model is not None,
            "model": self.model_name,
            "language": LANGUAGE,
            "device": self.device,
            "capturing": self.stream is not None,
        }

    def transcribe(self, path: str):
        if self.model is None:
            raise WorkerError("PARAKEET_NOT_INITIALIZED", "Inicialize o Parakeet antes de transcrever.")
        audio = read_audio(path)
        try:
            text = hypothesis_text(self.model.transcribe([audio], batch_size=1))
        except Exception as exc:
            raise WorkerError("TRANSCRIPTION", f"Falha na transcrição: {exc}") from exc
        return {"text": text, "confidence": None, "language": LANGUAGE}

    def start_capture(
        self, device: int | None = None, buffer_seconds: float | None = None
    ):
        if self.model is None:
            raise WorkerError("PARAKEET_NOT_INITIALIZED", "Inicialize o Parakeet antes do microfone.")
        if self.stream is not None:
            return {"capturing": True}
        try:
            import numpy as np
            import sounddevice as sd
        except ImportError as exc:
            raise WorkerError("SOUNDDEVICE_MISSING", "Instale sounddevice para capturar áudio.") from exc
        try:
            available = [
                (index, info)
                for index, info in enumerate(sd.query_devices())
                if info["max_input_channels"] > 0
            ]
        except Exception as exc:
            raise WorkerError("AUDIO_QUERY", f"Falha ao consultar o microfone: {exc}") from exc
        if not available:
            raise WorkerError(
                "AUDIO_DEVICE_NOT_FOUND",
                "Nenhum microfone com canal de entrada foi encontrado.",
            )
        if device is not None and not any(index == device for index, _ in available):
            raise WorkerError(
                "AUDIO_DEVICE_NOT_FOUND",
                f"O dispositivo de áudio {device} não está disponível.",
            )
        chunks: list[Any] = []
        chunk_count = max(1, round((buffer_seconds or 0.5) * 10))
        self.capture_stop.clear()

        def transcribe_chunk(batch):
            if not self.transcription_lock.acquire(blocking=False):
                return
            try:
                text = hypothesis_text(
                    self.model.transcribe(
                        [normalise_audio(batch, TARGET_SR)], batch_size=1
                    )
                )
                if text:
                    event(
                        "transcription",
                        text=text,
                        confidence=None,
                        language=LANGUAGE,
                    )
            except Exception as exc:
                event("error", code="TRANSCRIPTION", message=str(exc))
            finally:
                self.transcription_lock.release()

        def callback(indata, frames, time_info, status):
            if status:
                event("log", level="warn", message=f"Áudio: {status}")
            chunks.append(indata.copy())
            if len(chunks) >= chunk_count:
                batch = np.concatenate(chunks)
                chunks.clear()
                threading.Thread(
                    target=transcribe_chunk, args=(batch,), daemon=True
                ).start()

        try:
            self.stream = sd.InputStream(
                samplerate=TARGET_SR, channels=1, dtype="float32",
                device=device, blocksize=TARGET_SR // 10, callback=callback
            )
            self.stream.start()
            self.selected_device = device
        except Exception as exc:
            self.stream = None
            raise WorkerError("AUDIO_START", f"Falha ao iniciar microfone: {exc}") from exc
        event("status", status="capturing", device=device)
        return {"capturing": True, "device": device}

    def stop_capture(self):
        if self.stream is not None:
            self.stream.stop()
            self.stream.close()
            self.stream = None
        event("status", status="ready")
        return {"capturing": False}


engine = Engine()


def handle(command: dict[str, Any]):
    cmd = command.get("cmd")
    if cmd == "ping":
        return {"pong": True}
    if cmd == "environment":
        return engine.environment()
    if cmd == "devices":
        return {"devices": list_devices()}
    if cmd == "load":
        return engine.load(command.get("model"), command.get("device", "auto"))
    if cmd == "status":
        return engine.status()
    if cmd == "unload":
        engine.stop_capture()
        engine.model = None
        engine.model_name = None
        engine.device = None
        return engine.status()
    if cmd == "transcribe":
        return engine.transcribe(command["path"])
    if cmd == "start_capture":
        return engine.start_capture(
            command.get("device"), command.get("bufferSeconds")
        )
    if cmd == "stop_capture":
        return engine.stop_capture()
    raise WorkerError("UNKNOWN_COMMAND", f"Comando desconhecido: {cmd}")


for line in sys.stdin:
    try:
        request = json.loads(line)
        request_id = request.get("id")
        try:
            send({"id": request_id, "ok": True, "result": handle(request)})
        except Exception as exc:
            failure = error_from(exc)
            send({"id": request_id, "ok": False, "code": failure.code, "error": str(failure)})
    except Exception as exc:
        send({"ok": False, "code": "INVALID_JSON", "error": str(exc)})
