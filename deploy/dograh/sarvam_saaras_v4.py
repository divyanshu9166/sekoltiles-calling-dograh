"""Compatibility shim for Saaras v4 in the pinned Dograh/Pipecat image.

Sarvam documents Saaras v4 as protocol-compatible with Saaras v3 for live
speech-to-text.  The bundled Pipecat version predates that model identifier,
so it needs the same streaming capabilities registered before a call starts.
"""

from pipecat.services.sarvam.stt import MODEL_CONFIGS, ModelConfig


def install_saaras_v4() -> None:
    """Register Saaras v4 once, retaining v3's streaming/VAD settings."""

    if "saaras:v4" in MODEL_CONFIGS:
        return

    MODEL_CONFIGS["saaras:v4"] = ModelConfig(
        supports_prompt=False,
        supports_mode=True,
        supports_language=True,
        supports_vad_params=True,
        default_language="unknown",
        default_mode="transcribe",
        use_translate_endpoint=False,
        use_translate_method=False,
    )
