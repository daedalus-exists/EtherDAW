# Proposed EtherDAW Features

*Based on learnings from the Masterworks Transcription Project*

## 1. Tempo Detection Command

**Problem**: When transcribing existing pieces, determining the correct tempo requires manual calculation or guesswork.

**Proposed Solution**: Add `etherdaw tempo-detect <audio.wav>` command

```bash
$ etherdaw tempo-detect reference.wav
Analyzing: reference.wav (32.00s)
Detected 61 onsets

=== Tempo Analysis ===
Autocorrelation: 65 BPM (confidence: 0.72)
Interval analysis: [65, 130]

Suggested tempo: 65 BPM
```

**Implementation**: Port the `tempo-detect.py` tool to TypeScript in `src/analysis/tempo.ts`

---

## 2. Compare Command

**Problem**: Verifying transcription accuracy requires multiple tools (ffmpeg, Python scripts).

**Proposed Solution**: Add `etherdaw compare <rendered.wav> <reference.wav>` command

```bash
$ etherdaw compare output.wav reference.wav --output diff.png

=== Comparison Results ===
Overall similarity: 97.0%
Duration match: 32.34s vs 32.00s (98.9%)
Frequency alignment: Good
Problem regions: row 7, col 7 (bass frequencies)

Diff image saved to: diff.png
```

**Implementation**: 
- Add `src/analysis/compare.ts`
- Use Web Audio API or native FFT for spectrogram generation
- Output visual diff as PNG

---

## 3. Transcription Templates

**Problem**: Common musical patterns (arpeggios, Alberti bass) are tedious to write note-by-note.

**Proposed Solution**: Add pattern generators

```json
{
  "patterns": {
    "alberti": {
      "type": "alberti",
      "chord": ["C3", "E3", "G3"],
      "bars": 4
    },
    "arpeggio": {
      "type": "arpeggio",
      "chord": ["C3", "E4", "G4", "C5", "E5"],
      "direction": "up",
      "rhythm": "16"
    }
  }
}
```

**Implementation**: Add `src/generative/templates.ts` with common classical patterns

---

## 4. Better Error Messages with Suggestions

**Current**:
```
Schema validation failed:
  /instruments/piano/preset: Unknown preset 'acoustic_grand_piano'
```

**Proposed**:
```
Schema validation failed:
  /instruments/piano/preset: Unknown preset 'acoustic_grand_piano'
  
  Did you mean one of these?
    - acoustic_piano (96% match)
    - sample_piano (71% match)
  
  Run 'etherdaw list presets' to see all available presets.
```

**Implementation**: Add fuzzy matching in `src/validation/suggestions.ts`

---

## 5. Duration Calculation Helper

**Problem**: Calculating expected duration from bars/tempo requires manual math.

**Proposed Solution**: Add `etherdaw info <file>` command

```bash
$ etherdaw info composition.etherscore.json

=== Composition Info ===
Title: Bach Prelude in C Major
Tempo: 65 BPM
Time Signature: 4/4
Key: C major

Sections:
  - opening: 8 bars
  
Total: 8 bars = 32 beats
Expected duration: 29.54s (at 65 BPM)
```

---

## 6. MIDI Import for Transcription

**Problem**: Many reference recordings have MIDI versions available, which would be easier to start from than audio.

**Proposed Solution**: Improve `etherdaw import` to create clean EtherScore from MIDI

```bash
$ etherdaw import reference.mid --output transcription.etherscore.json --quantize 16
```

**Features**:
- Quantize to nearest note value
- Detect chord voicings
- Suggest pattern groupings
- Preserve dynamics

---

## Priority Order

1. **Compare command** - Most impactful for verification workflow
2. **Tempo detection** - Saves significant time
3. **Better error messages** - Quality of life improvement
4. **Duration helper** - Simple to implement
5. **Transcription templates** - Nice to have
6. **MIDI import improvements** - Larger effort

---

*These proposals are based on practical experience transcribing classical piano works. Each addresses a real friction point encountered during the workflow.*
