#!/bin/bash
# render.sh - Export EtherScore to WAV via MIDI + FluidSynth
# Usage: ./scripts/render.sh <composition.etherscore.json> [output.wav]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SOUNDFONT="${SOUNDFONT:-$HOME/soundfonts/FluidR3_GM.sf2}"

# Convert input to absolute path if relative
INPUT="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
BASENAME=$(basename "$INPUT" .etherscore.json)
MIDI_OUT="${PROJECT_DIR}/output/${BASENAME}.mid"
WAV_OUT="${2:-${PROJECT_DIR}/output/${BASENAME}.wav}"

if [[ -z "$INPUT" ]]; then
    echo "Usage: $0 <composition.etherscore.json> [output.wav]"
    echo ""
    echo "Exports EtherScore to MIDI, then renders to WAV using FluidSynth."
    echo ""
    echo "Requirements:"
    echo "  - fluidsynth installed (brew install fluid-synth)"
    echo "  - Soundfont at \$SOUNDFONT or ~/soundfonts/FluidR3_GM.sf2"
    exit 1
fi

if [[ ! -f "$INPUT" ]]; then
    echo "Error: Input file not found: $INPUT" >&2
    exit 1
fi

if ! command -v fluidsynth &>/dev/null; then
    echo "Error: fluidsynth not found. Install with: brew install fluid-synth" >&2
    exit 1
fi

if [[ ! -f "$SOUNDFONT" ]]; then
    echo "Error: Soundfont not found at $SOUNDFONT" >&2
    echo "Download: curl -L -o ~/soundfonts/FluidR3_GM.sf2 'https://keymusician01.s3.amazonaws.com/FluidR3_GM.sf2'"
    exit 1
fi

echo "📝 Exporting to MIDI..."
cd "$PROJECT_DIR"
npx etherdaw export "$INPUT" -o "$MIDI_OUT" -f midi

echo "🎹 Rendering to WAV..."
fluidsynth -F "$WAV_OUT" -r 44100 "$SOUNDFONT" "$MIDI_OUT" 2>/dev/null

if [[ -f "$WAV_OUT" ]]; then
    SIZE=$(ls -lh "$WAV_OUT" | awk '{print $5}')
    DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$WAV_OUT" 2>/dev/null | xargs printf "%.1f" 2>/dev/null || echo "?")
    echo "✅ Created: $WAV_OUT ($SIZE, ${DURATION}s)"
else
    echo "❌ Failed to create WAV" >&2
    exit 1
fi
