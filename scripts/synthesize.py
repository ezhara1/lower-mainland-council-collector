import argparse
import re
from pathlib import Path


def segments(text):
    parsed = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        match = re.match(r"HOST_([AB]):\s*(.+)", line, re.IGNORECASE)
        if match:
            parsed.append((match.group(1).upper(), match.group(2)))
        elif line and not line.startswith("#"):
            parsed.append(("A", line))
    return parsed


def synthesize_kokoro(items, output, voice_a, voice_b):
    import numpy as np
    import soundfile as sf
    from kokoro import KPipeline

    pipeline = KPipeline(lang_code="a")
    audio_parts = []
    silence = np.zeros(int(0.25 * 24000), dtype=np.float32)
    for speaker, text in items:
        voice = voice_a if speaker == "A" else voice_b
        for _, _, audio in pipeline(text, voice=voice):
            audio_parts.extend([audio, silence])
    if not audio_parts:
        raise RuntimeError("No speakable podcast lines were found.")
    sf.write(output, np.concatenate(audio_parts), 24000)


def synthesize_chatterbox(items, output, voice_a, voice_b):
    import numpy as np
    import soundfile as sf
    import torch
    from chatterbox.tts import ChatterboxTTS

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = ChatterboxTTS.from_pretrained(device=device)
    audio_parts = []
    silence = np.zeros(int(0.25 * model.sr), dtype=np.float32)
    for speaker, text in items:
        prompt = voice_a if speaker == "A" else voice_b
        kwargs = {"audio_prompt_path": prompt} if prompt else {}
        wav = model.generate(text, **kwargs).squeeze().cpu().numpy()
        audio_parts.extend([wav, silence])
    if not audio_parts:
        raise RuntimeError("No speakable podcast lines were found.")
    sf.write(output, np.concatenate(audio_parts), model.sr)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", choices=["kokoro", "chatterbox"], required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--host-a-voice", default="af_heart")
    parser.add_argument("--host-b-voice", default="am_michael")
    args = parser.parse_args()
    text = Path(args.input).read_text()
    items = segments(text)
    if args.provider == "kokoro":
        synthesize_kokoro(items, args.output, args.host_a_voice, args.host_b_voice)
    else:
        synthesize_chatterbox(items, args.output, args.host_a_voice, args.host_b_voice)


if __name__ == "__main__":
    main()
