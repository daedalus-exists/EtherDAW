/**
 * MIDI to EtherScore Importer
 *
 * Converts MIDI files to EtherScore JSON format for analysis and rendering.
 * Focuses on piano/melodic MIDI files.
 *
 * @version 0.9.16
 */

import MidiModule from '@tonejs/midi';
const { Midi } = MidiModule;
type MidiType = InstanceType<typeof Midi>;

import { NOTE_NAMES, DURATIONS, MIDI as MIDI_CONST, DEFAULT_SETTINGS } from '../config/constants.js';
import type { EtherScore, Pattern, Section, Track, Instrument } from '../schema/types.js';

// Duration thresholds for quantization (in beats)
// Note: Using only standard durations that EtherScore parser supports
const DURATION_THRESHOLDS = [
  { name: 'w', beats: 4, min: 3.0 },
  { name: 'h', beats: 2, min: 1.5 },
  { name: 'q', beats: 1, min: 0.75 },
  { name: '8', beats: 0.5, min: 0.375 },
  { name: '16', beats: 0.25, min: 0.1875 },
  { name: '32', beats: 0.125, min: 0.0 },
];

/**
 * Import options
 */
export interface MidiImportOptions {
  /** Quantize note timings to nearest grid (default: '16' for 16th notes) */
  quantize?: '8' | '16' | '32' | 'off';
  /** Minimum velocity to include (0-1, default: 0.1) */
  minVelocity?: number;
  /** Skip drum tracks (channel 10) */
  skipDrums?: boolean;
  /** Maximum bars per pattern (default: 8) */
  maxBarsPerPattern?: number;
  /** Merge all tracks into single piano instrument */
  mergeToSingleInstrument?: boolean;
  /** Include pedal marks if detected */
  includePedal?: boolean;
}

/**
 * Parsed note for internal processing
 */
interface ParsedMidiNote {
  pitch: string;       // e.g., "C4"
  startBeat: number;   // Start time in beats
  durationBeats: number;
  velocity: number;    // 0-1
  channel: number;
  trackIndex: number;
}

/**
 * Convert MIDI note number to pitch string
 */
function midiToPitch(midiNote: number): string {
  const octave = Math.floor(midiNote / MIDI_CONST.SEMITONES_PER_OCTAVE) - 1;
  const noteIndex = midiNote % MIDI_CONST.SEMITONES_PER_OCTAVE;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

/**
 * Quantize beat position to grid
 */
function quantizeBeat(beat: number, gridSize: number): number {
  return Math.round(beat / gridSize) * gridSize;
}

/**
 * Convert duration in beats to EtherScore duration code
 */
function beatsToDuration(beats: number): string {
  // Find closest standard duration
  for (const threshold of DURATION_THRESHOLDS) {
    if (beats >= threshold.min) {
      return threshold.name;
    }
  }
  return '32'; // Fallback to smallest
}

/**
 * Detect time signature from MIDI (if present)
 */
function detectTimeSignature(midi: MidiType): string {
  const timeSigs = midi.header.timeSignatures;
  if (timeSigs && timeSigs.length > 0) {
    const ts = timeSigs[0];
    return `${ts.timeSignature[0]}/${ts.timeSignature[1]}`;
  }
  return '4/4'; // Default
}

/**
 * Detect key signature from MIDI (if present)
 */
function detectKeySignature(midi: MidiType): string {
  const keySigs = midi.header.keySignatures;
  if (keySigs && keySigs.length > 0) {
    const key = keySigs[0].key;
    const scale = keySigs[0].scale;
    return `${key} ${scale === 'major' ? 'major' : 'minor'}`;
  }
  return 'C major'; // Default
}

/**
 * Choose appropriate instrument preset based on channel/track info
 */
function chooseInstrumentPreset(trackName: string, channel: number): string {
  const nameLower = trackName.toLowerCase();

  // Piano-related names
  if (nameLower.includes('piano') || nameLower.includes('keys') || nameLower.includes('keyboard')) {
    return 'acoustic_piano';
  }

  // Bass
  if (nameLower.includes('bass')) {
    return 'analog_bass';
  }

  // Strings
  if (nameLower.includes('string') || nameLower.includes('violin') || nameLower.includes('cello')) {
    return 'warm_pad';
  }

  // Lead/melody
  if (nameLower.includes('lead') || nameLower.includes('melody')) {
    return 'bright_lead';
  }

  // Default to piano for most MIDI files (especially classical)
  return 'acoustic_piano';
}

/**
 * Group notes into measures and create patterns
 */
function groupNotesIntoPatterns(
  notes: ParsedMidiNote[],
  beatsPerBar: number,
  maxBarsPerPattern: number
): Map<string, ParsedMidiNote[]> {
  const patterns = new Map<string, ParsedMidiNote[]>();

  if (notes.length === 0) return patterns;

  // Sort by start time
  const sortedNotes = [...notes].sort((a, b) => a.startBeat - b.startBeat);

  // Find total duration
  const lastNote = sortedNotes[sortedNotes.length - 1];
  const totalBeats = lastNote.startBeat + lastNote.durationBeats;
  const totalBars = Math.ceil(totalBeats / beatsPerBar);

  // Create patterns for each segment
  const barsPerPattern = Math.min(maxBarsPerPattern, totalBars);
  let patternIndex = 0;

  for (let startBar = 0; startBar < totalBars; startBar += barsPerPattern) {
    const endBar = Math.min(startBar + barsPerPattern, totalBars);
    const startBeat = startBar * beatsPerBar;
    const endBeat = endBar * beatsPerBar;

    const patternNotes = sortedNotes.filter(n =>
      n.startBeat >= startBeat && n.startBeat < endBeat
    );

    if (patternNotes.length > 0) {
      // Normalize times relative to pattern start
      const normalizedNotes = patternNotes.map(n => ({
        ...n,
        startBeat: n.startBeat - startBeat,
      }));

      const patternName = `pattern_${patternIndex}`;
      patterns.set(patternName, normalizedNotes);
      patternIndex++;
    }
  }

  return patterns;
}

/**
 * Check if notes array has overlapping notes (polyphonic content)
 */
function checkIfPolyphonic(notes: ParsedMidiNote[]): boolean {
  if (notes.length < 2) return false;

  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat);

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];

    // Check if next note starts before current ends
    if (next.startBeat < current.startBeat + current.durationBeats - 0.01) {
      return true;
    }
  }

  return false;
}

/**
 * Split notes into voice lines (high/low for piano-like polyphony)
 * Returns separate arrays for each voice
 */
function splitIntoVoices(notes: ParsedMidiNote[], splitPoint: number = 60): {
  high: ParsedMidiNote[];
  low: ParsedMidiNote[];
} {
  const high: ParsedMidiNote[] = [];
  const low: ParsedMidiNote[] = [];

  for (const note of notes) {
    // Parse MIDI number from pitch
    const match = note.pitch.match(/([A-G]#?)(\d+)/);
    if (match) {
      const noteName = match[1] as typeof NOTE_NAMES[number];
      const octave = parseInt(match[2]);
      const noteIndex = NOTE_NAMES.indexOf(noteName);
      const midiNote = (octave + 1) * 12 + noteIndex;

      if (midiNote >= splitPoint) {
        high.push(note);
      } else {
        low.push(note);
      }
    } else {
      high.push(note); // Default to high voice
    }
  }

  return { high, low };
}

/**
 * Convert a single voice line to EtherScore note strings
 * Notes are sequential, with rests to fill gaps
 */
function voiceToNoteStrings(notes: ParsedMidiNote[]): string[] {
  if (notes.length === 0) return [];

  // Sort by start time
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat);

  const result: string[] = [];
  let currentBeat = 0;

  for (const note of sorted) {
    // Add rest if there's a gap
    const gap = note.startBeat - currentBeat;
    if (gap >= 0.125) { // At least a 32nd note gap
      const restDuration = beatsToDuration(gap);
      result.push(`r:${restDuration}`);
      currentBeat += getBeatsForDuration(restDuration);
    }

    // Add the note
    const durationCode = beatsToDuration(note.durationBeats);
    const velocitySuffix = note.velocity < 0.5 ? `@${note.velocity.toFixed(2)}` : '';
    result.push(`${note.pitch}:${durationCode}${velocitySuffix}`);

    currentBeat = note.startBeat + getBeatsForDuration(durationCode);
  }

  return result;
}

/**
 * Get duration in beats for a duration code
 */
function getBeatsForDuration(code: string): number {
  const lookup: Record<string, number> = {
    'w': 4, 'h': 2, 'q': 1, '8': 0.5, '16': 0.25, '32': 0.125
  };
  return lookup[code] || 1;
}

/**
 * Legacy function: Convert parsed notes to EtherScore note strings
 * Used when not splitting into voices
 */
function notesToEtherScoreStrings(notes: ParsedMidiNote[]): string[] {
  // For simple melodies, just use the high voice approach
  return voiceToNoteStrings(notes);
}

/**
 * Import MIDI file and convert to EtherScore
 */
export async function importMidiToEtherScore(
  midiPath: string,
  options: MidiImportOptions = {}
): Promise<EtherScore> {
  const fs = await import('fs');
  const path = await import('path');

  const {
    quantize = '16',
    minVelocity = 0.1,
    skipDrums = true,
    maxBarsPerPattern = 8,
    mergeToSingleInstrument = true,
    includePedal = false,
  } = options;

  // Read MIDI file
  const midiData = fs.readFileSync(midiPath);
  const midi = new Midi(midiData);

  // Extract metadata
  const fileName = path.basename(midiPath, path.extname(midiPath));
  const tempo = midi.header.tempos[0]?.bpm ?? DEFAULT_SETTINGS.tempo;
  const timeSignature = detectTimeSignature(midi);
  const keySignature = detectKeySignature(midi);
  const [beatsPerBarStr] = timeSignature.split('/');
  const beatsPerBar = parseInt(beatsPerBarStr) || 4;

  // Calculate quantization grid
  const quantizeGrid = quantize === 'off' ? 0 :
    quantize === '8' ? 0.5 :
    quantize === '16' ? 0.25 :
    0.125; // '32'

  // Parse all notes from all tracks
  const allNotes: ParsedMidiNote[] = [];

  midi.tracks.forEach((track, trackIndex) => {
    // Skip drum track (channel 10, index 9)
    if (skipDrums && track.channel === 9) {
      return;
    }

    track.notes.forEach(note => {
      if (note.velocity < minVelocity) return;

      // Convert time from seconds to beats
      const secondsPerBeat = 60 / tempo;
      let startBeat = note.time / secondsPerBeat;
      let durationBeats = note.duration / secondsPerBeat;

      // Apply quantization
      if (quantizeGrid > 0) {
        startBeat = quantizeBeat(startBeat, quantizeGrid);
        durationBeats = Math.max(quantizeGrid, quantizeBeat(durationBeats, quantizeGrid));
      }

      allNotes.push({
        pitch: midiToPitch(note.midi),
        startBeat,
        durationBeats,
        velocity: note.velocity,
        channel: track.channel,
        trackIndex,
      });
    });
  });

  // Group notes into patterns
  const patterns = groupNotesIntoPatterns(allNotes, beatsPerBar, maxBarsPerPattern);

  // Build EtherScore structure
  const etherScore: EtherScore = {
    meta: {
      title: midi.header.name || fileName,
      composer: 'Imported from MIDI',
      genre: 'classical',
      description: `Imported from ${path.basename(midiPath)}`,
      tags: ['imported', 'midi'],
    },
    settings: {
      tempo: Math.round(tempo),
      key: keySignature,
      timeSignature,
    },
    instruments: {},
    patterns: {},
    sections: {},
    arrangement: [],
  };

  // Create instrument
  const instrumentName = 'piano';
  etherScore.instruments![instrumentName] = {
    preset: 'acoustic_piano',
    volume: -6,
  };

  // Check if content is polyphonic (notes overlapping)
  const isPolyphonic = checkIfPolyphonic(allNotes);

  // Convert patterns
  const highPatternNames: string[] = [];
  const lowPatternNames: string[] = [];
  let sectionIndex = 0;

  if (isPolyphonic) {
    // Split into high/low voices (like piano right/left hand)
    for (const [patternName, notes] of patterns) {
      const { high, low } = splitIntoVoices(notes);

      if (high.length > 0) {
        const highNotes = voiceToNoteStrings(high);
        etherScore.patterns[`${patternName}_high`] = { notes: highNotes };
        highPatternNames.push(`${patternName}_high`);
      }

      if (low.length > 0) {
        const lowNotes = voiceToNoteStrings(low);
        etherScore.patterns[`${patternName}_low`] = { notes: lowNotes };
        lowPatternNames.push(`${patternName}_low`);
      }
    }

    // Create sections with parallel voices
    const maxPatterns = Math.max(highPatternNames.length, lowPatternNames.length);
    const patternsPerSection = Math.ceil(32 / maxBarsPerPattern);

    for (let i = 0; i < maxPatterns; i += patternsPerSection) {
      const sectionHighPatterns = highPatternNames.slice(i, i + patternsPerSection);
      const sectionLowPatterns = lowPatternNames.slice(i, i + patternsPerSection);
      const sectionName = `section_${sectionIndex}`;
      const sectionBars = Math.max(sectionHighPatterns.length, sectionLowPatterns.length) * maxBarsPerPattern;

      const tracks: Record<string, Track> = {};

      if (sectionHighPatterns.length > 0) {
        tracks['piano_high'] = {
          patterns: sectionHighPatterns,
          velocity: 0.8,
        };
      }

      if (sectionLowPatterns.length > 0) {
        tracks['piano_low'] = {
          patterns: sectionLowPatterns,
          velocity: 0.75,
        };
      }

      etherScore.sections[sectionName] = {
        bars: sectionBars,
        tracks,
      };

      etherScore.arrangement.push(sectionName);
      sectionIndex++;
    }

    // Add second instrument for low voice
    etherScore.instruments!['piano_high'] = {
      preset: 'acoustic_piano',
      volume: -6,
    };
    etherScore.instruments!['piano_low'] = {
      preset: 'acoustic_piano',
      volume: -8,
    };
    delete etherScore.instruments![instrumentName];
  } else {
    // Simple monophonic - just use single voice
    for (const [patternName, notes] of patterns) {
      const noteStrings = notesToEtherScoreStrings(notes);
      etherScore.patterns[patternName] = { notes: noteStrings };
      highPatternNames.push(patternName);
    }

    // Create sections
    const patternsPerSection = Math.ceil(32 / maxBarsPerPattern);
    for (let i = 0; i < highPatternNames.length; i += patternsPerSection) {
      const sectionPatterns = highPatternNames.slice(i, i + patternsPerSection);
      const sectionName = `section_${sectionIndex}`;
      const sectionBars = sectionPatterns.length * maxBarsPerPattern;

      etherScore.sections[sectionName] = {
        bars: sectionBars,
        tracks: {
          [instrumentName]: {
            patterns: sectionPatterns,
            velocity: 0.8,
          },
        },
      };

      etherScore.arrangement.push(sectionName);
      sectionIndex++;
    }
  }

  return etherScore;
}

/**
 * Import from buffer (for programmatic use)
 * Uses same logic as file-based import with voice splitting for polyphonic content
 */
export function importMidiBufferToEtherScore(
  buffer: Buffer | ArrayBuffer,
  options: MidiImportOptions & { filename?: string } = {}
): EtherScore {
  const midi = new Midi(buffer);

  const {
    quantize = '16',
    minVelocity = 0.1,
    skipDrums = true,
    maxBarsPerPattern = 8,
    filename = 'untitled',
  } = options;

  // Extract metadata
  const tempo = midi.header.tempos[0]?.bpm ?? DEFAULT_SETTINGS.tempo;
  const timeSignature = detectTimeSignature(midi);
  const keySignature = detectKeySignature(midi);
  const [beatsPerBarStr] = timeSignature.split('/');
  const beatsPerBar = parseInt(beatsPerBarStr) || 4;

  // Quantization grid
  const quantizeGrid = quantize === 'off' ? 0 :
    quantize === '8' ? 0.5 :
    quantize === '16' ? 0.25 :
    0.125;

  // Parse notes
  const allNotes: ParsedMidiNote[] = [];

  midi.tracks.forEach((track, trackIndex) => {
    if (skipDrums && track.channel === 9) return;

    track.notes.forEach(note => {
      if (note.velocity < minVelocity) return;

      const secondsPerBeat = 60 / tempo;
      let startBeat = note.time / secondsPerBeat;
      let durationBeats = note.duration / secondsPerBeat;

      if (quantizeGrid > 0) {
        startBeat = quantizeBeat(startBeat, quantizeGrid);
        durationBeats = Math.max(quantizeGrid, quantizeBeat(durationBeats, quantizeGrid));
      }

      allNotes.push({
        pitch: midiToPitch(note.midi),
        startBeat,
        durationBeats,
        velocity: note.velocity,
        channel: track.channel,
        trackIndex,
      });
    });
  });

  const patterns = groupNotesIntoPatterns(allNotes, beatsPerBar, maxBarsPerPattern);

  const etherScore: EtherScore = {
    meta: {
      title: midi.header.name || filename,
      composer: 'Imported from MIDI',
      description: `Imported from ${filename}.mid`,
      tags: ['imported', 'midi'],
    },
    settings: {
      tempo: Math.round(tempo),
      key: keySignature,
      timeSignature,
    },
    instruments: {
      piano: {
        preset: 'acoustic_piano',
        volume: -6,
      },
    },
    patterns: {},
    sections: {},
    arrangement: [],
  };

  // Check if content is polyphonic
  const isPolyphonic = checkIfPolyphonic(allNotes);
  const highPatternNames: string[] = [];
  const lowPatternNames: string[] = [];
  let sectionIndex = 0;

  if (isPolyphonic) {
    // Split into high/low voices
    for (const [patternName, notes] of patterns) {
      const { high, low } = splitIntoVoices(notes);

      if (high.length > 0) {
        etherScore.patterns[`${patternName}_high`] = { notes: voiceToNoteStrings(high) };
        highPatternNames.push(`${patternName}_high`);
      }

      if (low.length > 0) {
        etherScore.patterns[`${patternName}_low`] = { notes: voiceToNoteStrings(low) };
        lowPatternNames.push(`${patternName}_low`);
      }
    }

    // Create sections with parallel voices
    const maxPatterns = Math.max(highPatternNames.length, lowPatternNames.length);
    const patternsPerSection = Math.ceil(32 / maxBarsPerPattern);

    for (let i = 0; i < maxPatterns; i += patternsPerSection) {
      const sectionHighPatterns = highPatternNames.slice(i, i + patternsPerSection);
      const sectionLowPatterns = lowPatternNames.slice(i, i + patternsPerSection);
      const sectionName = `section_${sectionIndex}`;

      const tracks: Record<string, Track> = {};
      if (sectionHighPatterns.length > 0) {
        tracks['piano_high'] = { patterns: sectionHighPatterns, velocity: 0.8 };
      }
      if (sectionLowPatterns.length > 0) {
        tracks['piano_low'] = { patterns: sectionLowPatterns, velocity: 0.75 };
      }

      etherScore.sections[sectionName] = {
        bars: Math.max(sectionHighPatterns.length, sectionLowPatterns.length) * maxBarsPerPattern,
        tracks,
      };

      etherScore.arrangement.push(sectionName);
      sectionIndex++;
    }

    // Set up instruments for split voices
    etherScore.instruments = {
      piano_high: { preset: 'acoustic_piano', volume: -6 },
      piano_low: { preset: 'acoustic_piano', volume: -8 },
    };
  } else {
    // Simple monophonic
    for (const [patternName, notes] of patterns) {
      etherScore.patterns[patternName] = { notes: notesToEtherScoreStrings(notes) };
      highPatternNames.push(patternName);
    }

    const patternsPerSection = Math.ceil(32 / maxBarsPerPattern);
    for (let i = 0; i < highPatternNames.length; i += patternsPerSection) {
      const sectionPatterns = highPatternNames.slice(i, i + patternsPerSection);
      const sectionName = `section_${sectionIndex}`;

      etherScore.sections[sectionName] = {
        bars: sectionPatterns.length * maxBarsPerPattern,
        tracks: {
          piano: { patterns: sectionPatterns, velocity: 0.8 },
        },
      };

      etherScore.arrangement.push(sectionName);
      sectionIndex++;
    }
  }

  return etherScore;
}

/**
 * Get MIDI file info without full import
 */
export async function getMidiFileInfo(midiPath: string): Promise<{
  name: string;
  duration: number;
  tempo: number;
  timeSignature: string;
  key: string;
  trackCount: number;
  noteCount: number;
  tracks: Array<{ name: string; channel: number; noteCount: number }>;
}> {
  const fs = await import('fs');
  const midiData = fs.readFileSync(midiPath);
  const midi = new Midi(midiData);

  return {
    name: midi.header.name || 'Untitled',
    duration: midi.duration,
    tempo: midi.header.tempos[0]?.bpm ?? DEFAULT_SETTINGS.tempo,
    timeSignature: detectTimeSignature(midi),
    key: detectKeySignature(midi),
    trackCount: midi.tracks.length,
    noteCount: midi.tracks.reduce((sum, t) => sum + t.notes.length, 0),
    tracks: midi.tracks.map(t => ({
      name: t.name || 'Untitled',
      channel: t.channel,
      noteCount: t.notes.length,
    })),
  };
}
