# EtherDAW Transcription Workflow Guide

*Created by Daedalus during the Masterworks Transcription Project (Feb 2026)*

## Overview

This guide documents a workflow for transcribing existing piano pieces to EtherScore format and verifying accuracy against reference recordings.

## Prerequisites

- EtherDAW installed (`npm install -g etherdaw`)
- FluidSynth for rendering (`brew install fluid-synth`)
- A quality SoundFont (recommended: YDP-GrandPiano.sf2)
- ffmpeg for audio processing
- Python 3 with numpy for analysis tools

## Workflow Steps

### 1. Prepare Reference

```bash
# Download reference from YouTube
yt-dlp -x --audio-format wav -o "reference.wav" "URL"

# Check duration and find music start point
ffprobe reference.wav

# Generate spectrogram to find where music starts
ffmpeg -i reference.wav -lavfi showspectrumpic=s=1600x400:legend=1 reference-spectrogram.png

# Trim to extract just the music portion
ffmpeg -i reference.wav -ss START_TIME -t DURATION reference-trimmed.wav
```

### 2. Analyze Tempo

Use the tempo detection tool to estimate BPM:

```bash
python3 tools/tempo-detect.py reference-trimmed.wav
```

Or manually calculate:
- Count bars in the reference section
- Duration / (bars × 4) × 60 = BPM (for 4/4 time)

### 3. Create EtherScore

Start with the basic structure:

```json
{
  "meta": {
    "title": "Piece Name",
    "composer": "Composer Name",
    "transcribedBy": "Your Name"
  },
  "settings": {
    "tempo": 60,
    "key": "C major",
    "timeSignature": "4/4"
  },
  "instruments": {
    "piano": {
      "preset": "acoustic_piano",
      "volume": -6
    }
  },
  "patterns": {
    "pattern_name": {
      "notes": ["C4:q", "E4:q", "G4:q", "C5:q"]
    }
  },
  "sections": {
    "section_name": {
      "bars": 4,
      "tracks": {
        "piano": {
          "patterns": ["pattern_name"],
          "velocity": 0.75
        }
      }
    }
  },
  "arrangement": ["section_name"]
}
```

### 4. Validate and Export

```bash
# Validate
etherdaw validate input.etherscore.json

# Export to MIDI
etherdaw export input.etherscore.json --output output.mid
```

### 5. Render Audio

```bash
# Render with FluidSynth
fluidsynth -ni -r 44100 -F output.wav /path/to/soundfont.sf2 output.mid

# Convert to MP3 for listening
ffmpeg -i output.wav -b:a 192k output.mp3
```

### 6. Generate Spectrogram and Compare

```bash
# Generate spectrogram
ffmpeg -i output.wav -lavfi showspectrumpic=s=1600x400:legend=0 output-spectrogram.png

# Compare with reference (requires spectro-diff.py)
python3 spectro-diff.py reference-spectrogram.png output-spectrogram.png --output diff.png
```

## Interpreting Spectro-Diff Results

- **WHITE/GRAY**: Matching regions ✓
- **GREEN**: Present in reference, missing in test → add these notes/frequencies
- **RED**: Present in test, missing in reference → remove or adjust these
- **Similarity > 95%**: Generally acceptable for soundfont vs. real piano

## Common Issues and Solutions

### Tempo Mismatch
**Symptom**: Vertical lines don't align in diff; diagonal patterns
**Solution**: Adjust tempo in EtherScore settings

### Missing Bass
**Symptom**: Green band at bottom of diff
**Solution**: Add left hand / bass part to transcription

### Wrong Octave
**Symptom**: Horizontal offset in frequency content
**Solution**: Transpose notes up or down an octave

### Timing Drift
**Symptom**: Good match at start, increasing red/green towards end
**Solution**: Check tempo precision; may need fractional BPM

## Results Achieved

| Piece | Similarity | Notes |
|-------|------------|-------|
| Mary Had a Little Lamb | 95.5% | Melody only |
| Ode to Joy | 96.1% | Melody + bass |
| Bach Prelude in C | 97.0% | 8 bars, arpeggiated |

## Tools Created

- `tempo-detect.py` - Estimates BPM from audio
- `spectro-diff.py` - Visual spectrogram comparison
- `transcribe.sh` - Unified workflow script

## Tips

1. **Start simple**: Transcribe melody first, verify, then add accompaniment
2. **Match duration first**: Ensure your render is the same length as reference
3. **Use visual comparison**: Spectrograms reveal issues faster than listening
4. **95-97% is the ceiling**: Soundfont synthesis vs real piano has physical limitations
5. **Document as you go**: Track what tempo/voicing worked

---

*This workflow was developed during a project to transcribe classical piano works and verify accuracy objectively using spectrogram analysis.*
