# EtherDAW Friction Report

**Session:** Deep Dive Exploration (2026-01-31)
**Composer:** Daedalus
**Goal:** Explore unexplored features, identify friction, improve the tool

---

## Bugs Fixed ✅

### 1. Preset Validation Out of Sync (v0.9.12)

**Problem:** `getAllPresetNames()` only returned legacy `PRESET_DEFINITIONS` keys, missing orchestral presets (trumpet, french_horn, string_ensemble, etc.) that exist in `PRESET_REGISTRY`.

**Symptom:** Validation failed with "Unknown preset 'trumpet'" even though `list presets` showed it exists.

**Fix:** Updated `getAllPresetNames()` to merge both sources:
```typescript
export function getAllPresetNames(): string[] {
  const legacyNames = Object.keys(PRESET_DEFINITIONS);
  const registryNames = Object.keys(PRESET_REGISTRY);
  return [...new Set([...legacyNames, ...registryNames])];
}
```

**File:** `src/synthesis/presets.ts`

### 2. Bracket Chord Notation Not Validated (v0.9.12)

**Problem:** Bracket chord notation `[C4,E4,G4]:q` was supported in the pattern expander but the semantic validator didn't recognize it.

**Symptom:** Valid bracket chords flagged as "Invalid note syntax" during validation.

**Fix:** Added bracket chord handling to `validateNoteString()`:
```typescript
if (isBracketChord(trimmed)) {
  try {
    parseBracketChord(trimmed);
    return null;
  } catch (e: any) {
    // error handling
  }
}
```

**File:** `src/schema/semantic-validator.ts`

### 3. Comment Patterns Flagged as Unused (v0.9.12)

**Problem:** JSON comment convention patterns (`"// Section Name": "---"`) were flagged as "pattern defined but never used".

**Symptom:** Linter showed 11 false positive warnings for documentation patterns.

**Fix:** Added check to skip comment patterns in linter:
```typescript
if (patternName.startsWith('//')) continue;
```

**File:** `src/validation/linter.ts`

---

## Features Tested ✓

| Feature | Status | Notes |
|---------|--------|-------|
| Jazz articulations (.fall, .doit, .scoop, .bend) | ✅ Works | Exports to MIDI correctly |
| Voice leading (Bach style) | ✅ Works | Generates proper 4-voice chorales |
| Markov chain patterns | ✅ Works | Produces interesting walking bass |
| Pattern transforms (invert, retrograde) | ✅ Works | Transforms applied correctly |
| Ornaments (.tr, .mord, .turn) | ✅ Works | Trill and mordent export |
| Tuplets (t3) | ✅ Works | Triplets render correctly |
| Euclidean rhythms | ✅ Works | 5-in-8 rim pattern |
| Bracket chord notation | ✅ Works (after fix) | [C4,E4,G4]:q syntax |
| Orchestral presets | ✅ Works (after fix) | trumpet, french_horn, strings |
| Expression presets | ✅ Works | jazzy, romantic, natural |
| Groove templates | ✅ Works | dilla groove applied |
| Velocity automation | ✅ Works | crescendo in finale |
| Density curves | ✅ Works | exponential density build |
| Automation curves | ✅ Works | brightness automation |

---

## Friction Points Remaining

### 1. Easy to Create Timing Mismatches

**Problem:** It's very easy to create patterns that don't fit evenly into sections. Linter catches this, but it would be better to catch earlier or suggest fixes.

**Suggestion:** Add a `check-patterns` command that calculates expected durations and suggests alignment fixes.

### 2. WAV Export Only in Browser

**Problem:** `export -f wav` fails with "WAV export requires browser environment with Tone.js."

**Impact:** Can't listen to compositions without external MIDI player or browser.

**Suggestion:** Add Node.js WAV export using a headless Tone.js or alternative synthesis.

### 3. Docs vs Implementation Mismatch

**Problem:** PRESETS.md documents features (orchestral, samples) that weren't in the validator's preset list.

**Suggestion:** Generate preset docs from actual registry to ensure sync.

---

## Composition Created

**"Deep Dive Exploration v2"** (43 seconds, 16 bars)
- 4 sections: intro_jazz, chorale, ornamental, finale
- Uses 14+ EtherDAW features
- Demonstrates: jazz articulations, voice leading, Markov chains, transforms, ornaments, tuplets, Euclidean rhythms, bracket chords, orchestral presets, expression presets, groove templates, automation

**Files:**
- `compositions/exploration-v2.etherscore.json`
- `output/exploration-v2.mid`

---

## Summary

Started with a composition that used many unexplored features. Found 3 bugs that were blocking validation. Fixed all 3. Now all features work as documented.

The tool is powerful — the friction was mostly about validation not keeping up with features. After fixes, the composition workflow feels much smoother.

**Tests:** 703 passing (no regressions)
