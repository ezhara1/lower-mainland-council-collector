import argparse

import numpy as np
import soundfile as sf


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("parts", nargs="+")
    args = parser.parse_args()

    audio_parts = []
    sample_rate = None
    for part in args.parts:
        audio, rate = sf.read(part, dtype="float32")
        if sample_rate is None:
            sample_rate = rate
        elif rate != sample_rate:
            raise RuntimeError(
                f"Audio part sample rate {rate} does not match {sample_rate}: {part}"
            )
        audio_parts.append(audio)

    if not audio_parts or sample_rate is None:
        raise RuntimeError("No audio parts were supplied.")
    sf.write(args.output, np.concatenate(audio_parts), sample_rate)


if __name__ == "__main__":
    main()
