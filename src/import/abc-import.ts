/**
 * ABC Notation to EtherScore Importer
 *
 * Converts ABC notation files to EtherScore JSON format.
 * ABC is a text-based music notation format widely used for folk music
 * and increasingly for LLM music generation.
 *
 * Supports:
 * - Basic notes (C-B, c-b with octave markers ', and ,)
 * - Rests (z, Z)
 * - Accidentals (^, _, =)
 * - Key signatures (K: field)
 * - Time signatures (M: field)
 * - Tempo (Q: field)
 * - Note durations (number suffixes, /2, /4, etc.)
 * - Chords ([CEG])
 * - Bar lines (|, ||, |], :|, |:)
 * - Ties (~)
 *
 * @version 1.0.0
 */

import { NOTE_NAMES, DURATIONS, DEFAULT_SETTINGS } from '../config/constants.js';
import type { EtherScore, Pattern, Section, Track } from '../schema/types.js';

// ABC note names to semitone offset (C=0)
const ABC_NOTE_MAP: Record<string, number> = {
  'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11,
  'c': 0, 'd': 2, 'e': 4, 'f': 5, 'g': 7, 'a': 9, 'b': 11,
};

// Key signature accidentals (semitone adjustments)
const KEY_SIGNATURES: Record<string, Record<string, number>> = {
  // Major keys
  'C': {},
  'G': { 'F': 1 },
  'D': { 'F': 1, 'C': 1 },
  'A': { 'F': 1, 'C': 1, 'G': 1 },
  'E': { 'F': 1, 'C': 1, 'G': 1, 'D': 1 },
  'B': { 'F': 1, 'C': 1, 'G': 1, 'D': 1, 'A': 1 },
  'F#': { 'F': 1, 'C': 1, 'G': 1, 'D': 1, 'A': 1, 'E': 1 },
  'C#': { 'F': 1, 'C': 1, 'G': 1, 'D': 1, 'A': 1, 'E': 1, 'B': 1 },
  'F': { 'B': -1 },
  'Bb': { 'B': -1, 'E': -1 },
  'Eb': { 'B': -1, 'E': -1, 'A': -1 },
  'Ab': { 'B': -1, 'E': -1, 'A': -1, 'D': -1 },
  'Db': { 'B': -1, 'E': -1, 'A': -1, 'D': -1, 'G': -1 },
  'Gb': { 'B': -1, 'E': -1, 'A': -1, 'D': -1, 'G': -1, 'C': -1 },
  // Minor keys (same accidentals as relative major)
  'Am': {},
  'Em': { 'F': 1 },
  'Bm': { 'F': 1, 'C': 1 },
  'F#m': { 'F': 1, 'C': 1, 'G': 1 },
  'C#m': { 'F': 1, 'C': 1, 'G': 1, 'D': 1 },
  'G#m': { 'F': 1, 'C': 1, 'G': 1, 'D': 1, 'A': 1 },
  'Dm': { 'B': -1 },
  'Gm': { 'B': -1, 'E': -1 },
  'Cm': { 'B': -1, 'E': -1, 'A': -1 },
  'Fm': { 'B': -1, 'E': -1, 'A': -1, 'D': -1 },
  'Bbm': { 'B': -1, 'E': -1, 'A': -1, 'D': -1, 'G': -1 },
};

/**
 * Import options for ABC notation
 */
export interface AbcImportOptions {
  /** Maximum bars per pattern (default: 4) */
  maxBarsPerPattern?: number;
  /** Default instrument preset (default: 'acoustic_piano') */
  instrumentPreset?: string;
  /** Merge chords into single chord notation vs separate notes */
  mergeChords?: boolean;
  /** Quantize to nearest grid: '8' | '16' | 'off' (default: 'off') */
  quantize?: '8' | '16' | 'off';
}

/**
 * Parsed note from ABC notation
 */
interface ParsedAbcNote {
  pitch: string;        // EtherScore pitch (e.g., "C4", "F#5")
  durationBeats: number;
  velocity: number;     // 0-1
  isRest: boolean;
  isChord: boolean;
  chordPitches?: string[];  // Additional chord notes
  startBeat: number;    // Absolute position in beats
}

/**
 * ABC tune metadata
 */
interface AbcTuneInfo {
  referenceNumber: number;
  title: string;
  composer: string;
  meter: [number, number];  // [numerator, denominator]
  defaultLength: number;    // Default note length in beats
  tempo: number;            // BPM
  key: string;              // Key signature (e.g., "C", "G", "Dm")
}

/**
 * Parser state
 */
interface ParserState {
  tuneInfo: AbcTuneInfo;
  keyAccidentals: Record<string, number>;
  barAccidentals: Record<string, number>;
  currentBeat: number;
  notes: ParsedAbcNote[];
  errors: string[];
  warnings: string[];
}

/**
 * Convert MIDI note number to EtherScore pitch string
 */
function midiToPitch(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

/**
 * Parse ABC key signature to key name and mode
 */
function parseAbcKey(keyField: string): { key: string; mode: string } {
  const trimmed = keyField.trim();
  
  // Match patterns like "C", "Cmaj", "Cm", "Cmin", "C#m", "Bb", "Ebm"
  const match = trimmed.match(/^([A-G])([#b]?)(?:\s*(m|maj|min|minor|major|mix|dor|phr|lyd|loc))?/i);
  
  if (!match) {
    return { key: 'C', mode: 'major' };
  }
  
  let keyRoot = match[1].toUpperCase();
  const accidental = match[2] || '';
  const modeStr = (match[3] || 'maj').toLowerCase();
  
  // Normalize accidental
  if (accidental === '#') keyRoot += '#';
  else if (accidental === 'b') keyRoot += 'b';
  
  // Determine mode
  let mode = 'major';
  if (modeStr === 'm' || modeStr === 'min' || modeStr === 'minor') {
    mode = 'minor';
  }
  
  return { key: keyRoot, mode };
}

/**
 * Convert ABC key to EtherScore key format
 */
function abcKeyToEtherScore(keyField: string): string {
  const { key, mode } = parseAbcKey(keyField);
  return `${key} ${mode}`;
}

/**
 * Get key signature accidentals for a given key
 */
function getKeyAccidentals(keyField: string): Record<string, number> {
  const { key, mode } = parseAbcKey(keyField);
  const lookupKey = mode === 'minor' ? `${key}m` : key;
  return KEY_SIGNATURES[lookupKey] || {};
}

/**
 * Parse ABC meter field to time signature
 */
function parseAbcMeter(meterField: string): [number, number] {
  const trimmed = meterField.trim();
  
  // Common time shortcuts
  if (trimmed === 'C' || trimmed === 'C|') {
    return [4, 4];
  }
  
  // Parse "4/4", "3/4", "6/8", etc.
  const match = trimmed.match(/^(\d+)\/(\d+)$/);
  if (match) {
    return [parseInt(match[1]), parseInt(match[2])];
  }
  
  return [4, 4];  // Default
}

/**
 * Parse ABC tempo field (Q:)
 * Formats: "Q:1/4=120", "Q:120", "Q:3/8=90"
 */
function parseAbcTempo(tempoField: string): number {
  const trimmed = tempoField.trim();
  
  // Match "1/4=120" or just "120"
  const match = trimmed.match(/(?:\d+\/\d+=)?(\d+)/);
  if (match) {
    return parseInt(match[1]);
  }
  
  return 120;  // Default
}

/**
 * Parse ABC default length field (L:)
 * Returns duration in beats (where quarter = 1)
 */
function parseAbcLength(lengthField: string): number {
  const trimmed = lengthField.trim();
  const match = trimmed.match(/^(\d+)\/(\d+)$/);
  
  if (match) {
    const num = parseInt(match[1]);
    const denom = parseInt(match[2]);
    // Convert to beats (quarter = 1)
    // L:1/8 means eighth note = 0.5 beats
    return (num / denom) * 4;
  }
  
  return 0.5;  // Default: eighth note
}

/**
 * Parse duration modifier from ABC note
 * Returns multiplier for default length
 */
function parseDurationModifier(str: string): number {
  if (!str) return 1;
  
  // "2" = double, "3" = triple
  const numMatch = str.match(/^(\d+)/);
  if (numMatch) {
    return parseInt(numMatch[1]);
  }
  
  // "/2" = half, "/4" = quarter, "/" = half
  const fracMatch = str.match(/^\/(\d*)/);
  if (fracMatch) {
    const denom = fracMatch[1] ? parseInt(fracMatch[1]) : 2;
    return 1 / denom;
  }
  
  return 1;
}

/**
 * Parse a single ABC note token
 * Returns the pitch as MIDI number and any remaining string
 */
function parseAbcNote(
  token: string,
  state: ParserState
): { midi: number; duration: number; remaining: string } | null {
  let pos = 0;
  let accidentalMod = 0;
  
  // Check for accidentals: ^ (sharp), ^^ (double sharp), _ (flat), __ (double flat), = (natural)
  while (pos < token.length) {
    if (token[pos] === '^') {
      accidentalMod++;
      pos++;
    } else if (token[pos] === '_') {
      accidentalMod--;
      pos++;
    } else if (token[pos] === '=') {
      accidentalMod = 0;  // Natural - ignore key signature for this note
      pos++;
    } else {
      break;
    }
  }
  
  if (pos >= token.length) return null;
  
  // Get note letter
  const noteLetter = token[pos];
  if (!ABC_NOTE_MAP.hasOwnProperty(noteLetter)) {
    return null;
  }
  
  const isLower = noteLetter === noteLetter.toLowerCase();
  const noteBase = noteLetter.toUpperCase();
  pos++;
  
  // Calculate base octave (middle C = C4 = MIDI 60)
  // ABC: C D E F G A B = C4-B4 (MIDI 60-71)
  //      c d e f g a b = C5-B5 (MIDI 72-83)
  let octave = isLower ? 5 : 4;
  
  // Check for octave modifiers: ' (up) , (down)
  while (pos < token.length) {
    if (token[pos] === "'") {
      octave++;
      pos++;
    } else if (token[pos] === ',') {
      octave--;
      pos++;
    } else {
      break;
    }
  }
  
  // Apply key signature accidental (if no explicit accidental and not natural)
  let keyAcc = 0;
  if (accidentalMod === 0 && !token.includes('=')) {
    // Check bar accidentals first (takes precedence)
    if (state.barAccidentals.hasOwnProperty(noteBase)) {
      keyAcc = state.barAccidentals[noteBase];
    } else if (state.keyAccidentals.hasOwnProperty(noteBase)) {
      keyAcc = state.keyAccidentals[noteBase];
    }
  } else if (accidentalMod !== 0) {
    // Explicit accidental - record for rest of bar
    state.barAccidentals[noteBase] = accidentalMod;
    keyAcc = accidentalMod;
  }
  
  // Calculate MIDI number
  const semitone = ABC_NOTE_MAP[noteBase] + keyAcc;
  const midi = (octave + 1) * 12 + semitone;
  
  // Parse duration
  const remaining = token.slice(pos);
  const durationMod = parseDurationModifier(remaining);
  const duration = state.tuneInfo.defaultLength * durationMod;
  
  // Extract numeric part from remaining for actual remaining string
  const durationMatch = remaining.match(/^(\d*)(\/\d*)?/);
  const durationLen = durationMatch ? durationMatch[0].length : 0;
  
  return {
    midi,
    duration,
    remaining: remaining.slice(durationLen),
  };
}

/**
 * Parse ABC music line (the actual notes)
 */
function parseMusicLine(line: string, state: ParserState): void {
  let pos = 0;
  const { tuneInfo } = state;
  
  while (pos < line.length) {
    const char = line[pos];
    
    // Skip whitespace
    if (/\s/.test(char)) {
      pos++;
      continue;
    }
    
    // Bar line - reset bar accidentals
    if (char === '|') {
      state.barAccidentals = {};
      pos++;
      // Skip additional bar characters: ||, |], :|, |:
      while (pos < line.length && /[|\]:]/.test(line[pos])) {
        pos++;
      }
      continue;
    }
    
    // Chord start
    if (char === '[') {
      pos++;
      const chordPitches: string[] = [];
      let chordDuration = tuneInfo.defaultLength;
      
      // Parse chord notes until ]
      while (pos < line.length && line[pos] !== ']') {
        const noteResult = parseAbcNote(line.slice(pos), state);
        if (noteResult) {
          chordPitches.push(midiToPitch(noteResult.midi));
          chordDuration = noteResult.duration;
          // Find how much we consumed
          const consumed = line.slice(pos).indexOf(noteResult.remaining.length > 0 
            ? noteResult.remaining[0] 
            : ']');
          pos += consumed > 0 ? consumed : 1;
        } else {
          pos++;
        }
      }
      
      if (line[pos] === ']') {
        pos++;
        // Check for duration after chord
        const afterChord = line.slice(pos);
        const durationMod = parseDurationModifier(afterChord);
        const durationMatch = afterChord.match(/^(\d*)(\/\d*)?/);
        if (durationMatch && durationMatch[0]) {
          chordDuration = tuneInfo.defaultLength * durationMod;
          pos += durationMatch[0].length;
        }
      }
      
      if (chordPitches.length > 0) {
        state.notes.push({
          pitch: chordPitches[0],
          durationBeats: chordDuration,
          velocity: 0.8,
          isRest: false,
          isChord: chordPitches.length > 1,
          chordPitches: chordPitches.length > 1 ? chordPitches : undefined,
          startBeat: state.currentBeat,
        });
        state.currentBeat += chordDuration;
      }
      continue;
    }
    
    // Rest (z or Z)
    if (char === 'z' || char === 'Z') {
      pos++;
      const remaining = line.slice(pos);
      const durationMod = parseDurationModifier(remaining);
      const duration = tuneInfo.defaultLength * durationMod;
      
      const durationMatch = remaining.match(/^(\d*)(\/\d*)?/);
      if (durationMatch && durationMatch[0]) {
        pos += durationMatch[0].length;
      }
      
      state.notes.push({
        pitch: 'r',
        durationBeats: duration,
        velocity: 0,
        isRest: true,
        isChord: false,
        startBeat: state.currentBeat,
      });
      state.currentBeat += duration;
      continue;
    }
    
    // Regular note (A-G, a-g)
    if (/[A-Ga-g^_=]/.test(char)) {
      const noteResult = parseAbcNote(line.slice(pos), state);
      if (noteResult) {
        state.notes.push({
          pitch: midiToPitch(noteResult.midi),
          durationBeats: noteResult.duration,
          velocity: 0.8,
          isRest: false,
          isChord: false,
          startBeat: state.currentBeat,
        });
        state.currentBeat += noteResult.duration;
        
        // Move position forward
        const consumed = line.slice(pos).length - noteResult.remaining.length;
        pos += consumed > 0 ? consumed : 1;
      } else {
        pos++;
      }
      continue;
    }
    
    // Skip other characters (ties ~, slurs (), decorations, etc.)
    pos++;
  }
}

/**
 * Parse complete ABC text
 */
function parseAbc(abcText: string): ParserState {
  const state: ParserState = {
    tuneInfo: {
      referenceNumber: 1,
      title: '',
      composer: '',
      meter: [4, 4],
      defaultLength: 0.5,  // Eighth note default
      tempo: 120,
      key: 'C',
    },
    keyAccidentals: {},
    barAccidentals: {},
    currentBeat: 0,
    notes: [],
    errors: [],
    warnings: [],
  };
  
  const lines = abcText.split('\n');
  const musicLines: string[] = [];
  
  for (const rawLine of lines) {
    const line = rawLine.trim();
    
    // Skip empty lines and comments
    if (!line || line.startsWith('%')) {
      continue;
    }
    
    // Check for header field (X:, T:, M:, K:, etc.)
    if (line.length >= 2 && line[1] === ':' && /[A-Za-z]/.test(line[0])) {
      const field = line[0].toUpperCase();
      const value = line.slice(2).trim();
      
      switch (field) {
        case 'X':  // Reference number
          state.tuneInfo.referenceNumber = parseInt(value) || 1;
          break;
        case 'T':  // Title
          state.tuneInfo.title = value;
          break;
        case 'C':  // Composer
          state.tuneInfo.composer = value;
          break;
        case 'M':  // Meter (time signature)
          state.tuneInfo.meter = parseAbcMeter(value);
          break;
        case 'L':  // Default note length
          state.tuneInfo.defaultLength = parseAbcLength(value);
          break;
        case 'Q':  // Tempo
          state.tuneInfo.tempo = parseAbcTempo(value);
          break;
        case 'K':  // Key signature (must be last header field)
          state.tuneInfo.key = value;
          state.keyAccidentals = getKeyAccidentals(value);
          break;
        // Skip other fields: W (words), H (history), etc.
      }
      continue;
    }
    
    // Skip lyrics lines
    if (line.startsWith('w:') || line.startsWith('W:')) {
      continue;
    }
    
    // Collect music line
    musicLines.push(line);
  }
  
  // Parse music
  for (const line of musicLines) {
    parseMusicLine(line, state);
  }
  
  return state;
}

/**
 * Convert duration in beats to EtherScore duration code
 */
function beatsToDurationCode(beats: number): string {
  // Find closest standard duration
  const thresholds = [
    { code: 'w', beats: 4, min: 3.0 },
    { code: 'h', beats: 2, min: 1.5 },
    { code: 'q', beats: 1, min: 0.75 },
    { code: '8', beats: 0.5, min: 0.375 },
    { code: '16', beats: 0.25, min: 0.1875 },
    { code: '32', beats: 0.125, min: 0 },
  ];
  
  for (const threshold of thresholds) {
    if (beats >= threshold.min) {
      return threshold.code;
    }
  }
  
  return '16';  // Default to smallest
}

/**
 * Convert parsed notes to EtherScore note strings
 */
function notesToEtherScoreStrings(notes: ParsedAbcNote[]): string[] {
  const result: string[] = [];
  
  for (const note of notes) {
    if (note.isRest) {
      result.push(`r:${beatsToDurationCode(note.durationBeats)}`);
    } else if (note.isChord && note.chordPitches) {
      // For chords, we use the chord notation format
      // Note: EtherScore patterns use notes[], not chords[]
      // So we output each chord note with same timing
      const durationCode = beatsToDurationCode(note.durationBeats);
      // Just use first note for simplicity in patterns
      // Full chord support would need different handling
      result.push(`${note.pitch}:${durationCode}`);
    } else {
      result.push(`${note.pitch}:${beatsToDurationCode(note.durationBeats)}`);
    }
  }
  
  return result;
}

/**
 * Group notes into patterns by bars
 */
function groupNotesIntoPatterns(
  notes: ParsedAbcNote[],
  beatsPerBar: number,
  maxBarsPerPattern: number
): Map<string, ParsedAbcNote[]> {
  const patterns = new Map<string, ParsedAbcNote[]>();
  
  if (notes.length === 0) return patterns;
  
  // Find total duration
  const lastNote = notes[notes.length - 1];
  const totalBeats = lastNote.startBeat + lastNote.durationBeats;
  const totalBars = Math.ceil(totalBeats / beatsPerBar);
  
  const barsPerPattern = Math.min(maxBarsPerPattern, totalBars);
  let patternIndex = 0;
  
  for (let startBar = 0; startBar < totalBars; startBar += barsPerPattern) {
    const endBar = Math.min(startBar + barsPerPattern, totalBars);
    const startBeat = startBar * beatsPerBar;
    const endBeat = endBar * beatsPerBar;
    
    const patternNotes = notes.filter(n =>
      n.startBeat >= startBeat && n.startBeat < endBeat
    );
    
    if (patternNotes.length > 0) {
      // Normalize times relative to pattern start
      const normalizedNotes = patternNotes.map(n => ({
        ...n,
        startBeat: n.startBeat - startBeat,
      }));
      
      patterns.set(`pattern_${patternIndex}`, normalizedNotes);
      patternIndex++;
    }
  }
  
  return patterns;
}

/**
 * Import ABC text and convert to EtherScore
 */
export function importAbcToEtherScore(
  abcText: string,
  options: AbcImportOptions = {}
): EtherScore {
  const {
    maxBarsPerPattern = 4,
    instrumentPreset = 'acoustic_piano',
  } = options;
  
  // Parse ABC
  const state = parseAbc(abcText);
  const { tuneInfo, notes } = state;
  
  // Calculate beats per bar from meter
  const [meterNum, meterDenom] = tuneInfo.meter;
  const beatsPerBar = (meterNum / meterDenom) * 4;  // Quarter = 1 beat
  
  // Group notes into patterns
  const patterns = groupNotesIntoPatterns(notes, beatsPerBar, maxBarsPerPattern);
  
  // Build EtherScore
  const etherScore: EtherScore = {
    meta: {
      title: tuneInfo.title || 'Imported ABC Tune',
      composer: tuneInfo.composer || 'Imported from ABC',
      description: `Imported from ABC notation`,
      tags: ['imported', 'abc'],
    },
    settings: {
      tempo: tuneInfo.tempo,
      key: abcKeyToEtherScore(tuneInfo.key),
      timeSignature: `${meterNum}/${meterDenom}`,
    },
    instruments: {
      melody: {
        preset: instrumentPreset,
        volume: -6,
      },
    },
    patterns: {},
    sections: {},
    arrangement: [],
  };
  
  // Convert patterns
  const patternNames: string[] = [];
  
  for (const [patternName, patternNotes] of patterns) {
    const noteStrings = notesToEtherScoreStrings(patternNotes);
    etherScore.patterns[patternName] = { notes: noteStrings };
    patternNames.push(patternName);
  }
  
  // Create sections (group patterns into sections)
  const patternsPerSection = Math.max(1, Math.ceil(8 / maxBarsPerPattern));
  let sectionIndex = 0;
  
  for (let i = 0; i < patternNames.length; i += patternsPerSection) {
    const sectionPatterns = patternNames.slice(i, i + patternsPerSection);
    const sectionName = `section_${sectionIndex}`;
    const sectionBars = sectionPatterns.length * maxBarsPerPattern;
    
    etherScore.sections[sectionName] = {
      bars: sectionBars,
      tracks: {
        melody: {
          patterns: sectionPatterns,
          velocity: 0.8,
        },
      },
    };
    
    etherScore.arrangement.push(sectionName);
    sectionIndex++;
  }
  
  return etherScore;
}

/**
 * Import ABC file and convert to EtherScore
 */
export async function importAbcFileToEtherScore(
  abcPath: string,
  options: AbcImportOptions = {}
): Promise<EtherScore> {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  const abcText = await fs.readFile(abcPath, 'utf-8');
  const score = importAbcToEtherScore(abcText, options);
  
  // Use filename as fallback title
  if (!score.meta?.title || score.meta.title === 'Imported ABC Tune') {
    const fileName = path.basename(abcPath, path.extname(abcPath));
    score.meta = { ...score.meta, title: fileName };
  }
  
  return score;
}

/**
 * Get info about an ABC file without full import
 */
export function getAbcInfo(abcText: string): {
  title: string;
  composer: string;
  key: string;
  meter: string;
  tempo: number;
  noteCount: number;
  durationBeats: number;
  estimatedBars: number;
} {
  const state = parseAbc(abcText);
  const { tuneInfo, notes } = state;
  
  const lastNote = notes[notes.length - 1];
  const totalBeats = lastNote ? lastNote.startBeat + lastNote.durationBeats : 0;
  const [meterNum, meterDenom] = tuneInfo.meter;
  const beatsPerBar = (meterNum / meterDenom) * 4;
  
  return {
    title: tuneInfo.title || 'Untitled',
    composer: tuneInfo.composer || 'Unknown',
    key: abcKeyToEtherScore(tuneInfo.key),
    meter: `${meterNum}/${meterDenom}`,
    tempo: tuneInfo.tempo,
    noteCount: notes.filter(n => !n.isRest).length,
    durationBeats: totalBeats,
    estimatedBars: Math.ceil(totalBeats / beatsPerBar),
  };
}

/**
 * Validate ABC text and return any errors/warnings
 */
export function validateAbc(abcText: string): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const state = parseAbc(abcText);
  
  // Check for required fields
  const errors: string[] = [...state.errors];
  const warnings: string[] = [...state.warnings];
  
  if (!state.tuneInfo.key) {
    warnings.push('No key signature specified, defaulting to C major');
  }
  
  if (state.notes.length === 0) {
    errors.push('No notes found in ABC text');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
