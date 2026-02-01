#!/bin/bash
# Generate the complete Morphogenesis album
# Each track uses bioelectric simulation with specific parameters

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BIOELECTRIC="$SCRIPT_DIR/../../../bioelectric-music/bioelectric.py"
VENV="$SCRIPT_DIR/../../../bioelectric-music/venv/bin/activate"
MIDI2WAV="$SCRIPT_DIR/../../../../tools/midi2wav"

# Activate virtual environment
source "$VENV"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     MORPHOGENESIS: An Album of Emergent Music               ║"
echo "║     Generating 7 tracks from bioelectric simulation...      ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

cd "$SCRIPT_DIR"

# Track 1: Primordium (4:00)
echo "🌱 Track 1: Primordium (4:00)"
echo "   Single pacemaker, minimal coupling, meditative"
python3 "$BIOELECTRIC" \
    --grid-size 6 \
    --duration 240 \
    --pacemakers 1 \
    --coupling 0.05 \
    --scale japanese \
    --base-note 48 \
    --tempo 55 \
    --pattern uniform \
    --seed 1001 \
    --output primordium.mid

# Track 2: Gap Junction (3:30)
echo "🔗 Track 2: Gap Junction (3:30)"
echo "   Learning to listen, coupling begins"
python3 "$BIOELECTRIC" \
    --grid-size 8 \
    --duration 210 \
    --pacemakers 2 \
    --coupling 0.12 \
    --scale pentatonic \
    --base-note 48 \
    --tempo 72 \
    --pattern gradient \
    --seed 2002 \
    --output gap-junction.mid

# Track 3: Wave Front (4:00)
echo "🌊 Track 3: Wave Front (4:00)"
echo "   The tissue awakens, propagating waves"
python3 "$BIOELECTRIC" \
    --grid-size 10 \
    --duration 240 \
    --pacemakers 3 \
    --coupling 0.22 \
    --scale dorian \
    --base-note 45 \
    --tempo 90 \
    --pattern uniform \
    --seed 3003 \
    --output wave-front.mid

# Track 4: Barrier Islands (5:00)
echo "🏝️ Track 4: Barrier Islands (5:00)"
echo "   Echoes and reflections, complex interplay"
python3 "$BIOELECTRIC" \
    --grid-size 12 \
    --duration 300 \
    --pacemakers 4 \
    --coupling 0.20 \
    --scale blues \
    --base-note 42 \
    --tempo 95 \
    --pattern islands \
    --seed 4004 \
    --output barrier-islands.mid

# Track 5: Spiral Dynamics (4:30)
echo "🌀 Track 5: Spiral Dynamics (4:30)"
echo "   The dance of form, rotational waves"
python3 "$BIOELECTRIC" \
    --grid-size 12 \
    --duration 270 \
    --pacemakers 5 \
    --coupling 0.25 \
    --scale harmonic_minor \
    --base-note 43 \
    --tempo 108 \
    --pattern spiral \
    --seed 5005 \
    --output spiral-dynamics.mid

# Track 6: Hyperpolarization (3:30)
echo "🌙 Track 6: Hyperpolarization (3:30)"
echo "   The return to rest, fragments remain"
python3 "$BIOELECTRIC" \
    --grid-size 8 \
    --duration 210 \
    --pacemakers 2 \
    --coupling 0.08 \
    --scale whole_tone \
    --base-note 50 \
    --tempo 66 \
    --pattern gradient \
    --seed 6006 \
    --output hyperpolarization.mid

# Track 7: Memory (4:30)
echo "💭 Track 7: Memory (4:30)"
echo "   What patterns remain, echoes of emergence"
python3 "$BIOELECTRIC" \
    --grid-size 6 \
    --duration 270 \
    --pacemakers 1 \
    --coupling 0.03 \
    --scale japanese \
    --base-note 52 \
    --tempo 50 \
    --pattern uniform \
    --seed 7007 \
    --output memory.mid

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "MIDI generation complete. Rendering to WAV..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Render each track to WAV
for midi in primordium.mid gap-junction.mid wave-front.mid barrier-islands.mid spiral-dynamics.mid hyperpolarization.mid memory.mid; do
    wav="${midi%.mid}.wav"
    echo "🔊 Rendering $midi → $wav"
    "$MIDI2WAV" "$midi" "$wav"
done

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     MORPHOGENESIS album complete!                           ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Track listing:"
ls -lh *.wav 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'

# Calculate total duration
echo ""
echo "Total runtime: ~29 minutes"
