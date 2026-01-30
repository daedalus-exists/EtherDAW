/**
 * ABC notation export for EtherDAW
 * ABC is a text-based music notation format widely used for folk music
 * and increasingly for LLM music interoperability (ChatMusician, etc.)
 *
 * v0.9.12: Added voice separation and melody extraction options
 */

import type { Timeline, NoteEvent, EtherScore } from '../schema/types.js';
import { getAllNotes } from '../engine/timeline.js';
import { parseTimeSignature } from '../theory/rhythm.js';

/**
 * Options for ABC export
 */
export interface AbcExportOptions {
  /** Title of the tune */
  title?: string;
  /** Composer name */
  composer?: string;
  /** Reference number */
  referenceNumber?: number;
  /** Include chord symbols */
  includeChords?: boolean;
  /** Line width in notes before wrapping */
  lineWidth?: number;
  /**
   * Voice mode (v0.9.12):
   * - 'combined': All voices as chords (default, original behavior)
   * - 'separate': Each instrument as separate ABC tune
   * - 'melody': Extract only the highest-pitched voice
   */
  voiceMode?: 'combined' | 'separate' | 'melody';
  /** When voiceMode='separate', limit to specific instruments */
  instruments?: string[];
}

/** Store timeline reference for noteToAbc duration calculations */
let currentTimeline: Timeline;

/**
 * Export a timeline to ABC notation
 */
export function exportToAbc(
  timeline: Timeline,
  options: AbcExportOptions = {}
): string {
  const {
    title = 'Untitled',
    composer,
    referenceNumber = 1,
    lineWidth = 8,
    voiceMode = 'combined',
    instruments,
  } = options;

  // Store timeline for duration calculations
  currentTimeline = timeline;

  // Get all notes
  const allNotes = getAllNotes(timeline);

  // Handle different voice modes
  if (voiceMode === 'separate') {
    return exportSeparateVoices(timeline, allNotes, options);
  } else if (voiceMode === 'melody') {
    return exportMelodyOnly(timeline, allNotes, options);
  }

  // Default: combined mode (original behavior)
  return exportCombinedVoices(timeline, allNotes, options);
}

/**
 * Export all voices combined as chords (original behavior)
 */
function exportCombinedVoices(
  timeline: Timeline,
  notes: NoteEvent[],
  options: AbcExportOptions
): string {
  const {
    title = 'Untitled',
    composer,
    referenceNumber = 1,
    lineWidth = 8,
  } = options;

  const lines: string[] = [];

  // Header
  lines.push(`X:${referenceNumber}`);
  lines.push(`T:${title}`);
  if (composer) {
    lines.push(`C:${composer}`);
  }

  // Meter, default note length, key, tempo
  const timeSignature = timeline.settings.timeSignature || '4/4';
  lines.push(`M:${timeSignature}`);
  lines.push('L:1/8');
  const key = timeline.settings.key || 'C major';
  lines.push(`K:${keyToAbc(key)}`);
  lines.push(`Q:1/4=${timeline.settings.tempo}`);
  lines.push('');

  // Convert notes to ABC
  const notesByTime = groupNotesByTime(notes);
  const musicLines = generateMusicLines(notesByTime, timeSignature, lineWidth);
  lines.push(...musicLines);

  return lines.join('\n');
}

/**
 * Export each instrument as a separate ABC tune (v0.9.12)
 */
function exportSeparateVoices(
  timeline: Timeline,
  allNotes: NoteEvent[],
  options: AbcExportOptions
): string {
  const {
    title = 'Untitled',
    composer,
    lineWidth = 8,
    instruments: filterInstruments,
  } = options;

  // Group notes by instrument
  const notesByInstrument = new Map<string, NoteEvent[]>();
  for (const note of allNotes) {
    const inst = note.instrument;
    if (!notesByInstrument.has(inst)) {
      notesByInstrument.set(inst, []);
    }
    notesByInstrument.get(inst)!.push(note);
  }

  // Filter to specific instruments if requested
  const instrumentList = filterInstruments || [...notesByInstrument.keys()];

  const tunes: string[] = [];
  let refNum = 1;

  for (const instrument of instrumentList) {
    const notes = notesByInstrument.get(instrument);
    if (!notes || notes.length === 0) continue;

    const lines: string[] = [];

    // Header for this voice
    lines.push(`X:${refNum}`);
    lines.push(`T:${title} - ${instrument}`);
    if (composer) {
      lines.push(`C:${composer}`);
    }

    const timeSignature = timeline.settings.timeSignature || '4/4';
    lines.push(`M:${timeSignature}`);
    lines.push('L:1/8');
    const key = timeline.settings.key || 'C major';
    lines.push(`K:${keyToAbc(key)}`);
    lines.push(`Q:1/4=${timeline.settings.tempo}`);
    lines.push(`%%voice ${instrument}`);
    lines.push('');

    // Convert notes to ABC (no chord grouping for single voice)
    const notesByTime = groupNotesByTime(notes);
    const musicLines = generateMusicLines(notesByTime, timeSignature, lineWidth);
    lines.push(...musicLines);

    tunes.push(lines.join('\n'));
    refNum++;
  }

  return tunes.join('\n\n');
}

/**
 * Export only the melody (highest-pitched notes) (v0.9.12)
 */
function exportMelodyOnly(
  timeline: Timeline,
  allNotes: NoteEvent[],
  options: AbcExportOptions
): string {
  const {
    title = 'Untitled',
    composer,
    referenceNumber = 1,
    lineWidth = 8,
  } = options;

  // Group notes by time and extract highest pitch at each time
  const notesByTime = groupNotesByTime(allNotes);
  const melodyNotes: NoteEvent[] = [];

  for (const [time, noteGroup] of notesByTime) {
    // Find the highest pitched note
    const highest = noteGroup.reduce((a, b) => {
      return pitchToMidi(a.pitch) > pitchToMidi(b.pitch) ? a : b;
    });
    melodyNotes.push(highest);
  }

  const lines: string[] = [];

  // Header
  lines.push(`X:${referenceNumber}`);
  lines.push(`T:${title} (Melody)`);
  if (composer) {
    lines.push(`C:${composer}`);
  }

  const timeSignature = timeline.settings.timeSignature || '4/4';
  lines.push(`M:${timeSignature}`);
  lines.push('L:1/8');
  const key = timeline.settings.key || 'C major';
  lines.push(`K:${keyToAbc(key)}`);
  lines.push(`Q:1/4=${timeline.settings.tempo}`);
  lines.push('');

  // Convert melody notes (no chords)
  const melodyByTime = new Map<number, NoteEvent[]>();
  for (const note of melodyNotes) {
    const quantizedTime = Math.round(note.time * 8) / 8;
    melodyByTime.set(quantizedTime, [note]);
  }

  const musicLines = generateMusicLines(melodyByTime, timeSignature, lineWidth);
  lines.push(...musicLines);

  return lines.join('\n');
}

/**
 * Generate ABC music lines from grouped notes
 */
function generateMusicLines(
  notesByTime: Map<number, NoteEvent[]>,
  timeSignature: string,
  lineWidth: number
): string[] {
  const lines: string[] = [];
  const ts = parseTimeSignature(timeSignature);

  let currentBar = 0;
  let notesInLine = 0;
  let musicLine = '';

  for (const [time, noteGroup] of notesByTime) {
    const bar = Math.floor(time / ts.beatsPerBar);

    // Add bar line if needed
    if (bar > currentBar) {
      musicLine += ' |';
      currentBar = bar;
      notesInLine++;

      // Line break
      if (notesInLine >= lineWidth) {
        lines.push(musicLine);
        musicLine = '';
        notesInLine = 0;
      }
    }

    // Convert notes
    if (noteGroup.length === 1) {
      musicLine += ' ' + noteToAbc(noteGroup[0]);
    } else {
      // Chord notation
      musicLine += ' [' + noteGroup.map(noteToAbc).join('') + ']';
    }

    notesInLine++;
  }

  // Final bar line
  if (musicLine) {
    lines.push(musicLine + ' |]');
  }

  return lines;
}

/**
 * Convert EtherScore key to ABC key signature
 */
function keyToAbc(key: string): string {
  const match = key.match(/^([A-G][#b]?)\s*(major|minor|maj|min|m)?$/i);
  if (!match) return 'C';

  const [, root, mode] = match;

  // Convert accidentals for ABC
  let abcRoot = root.charAt(0).toUpperCase();
  if (root.length > 1) {
    if (root.charAt(1) === '#') abcRoot += '#';
    if (root.charAt(1) === 'b') abcRoot += 'b';
  }

  // Add mode
  if (mode && mode.toLowerCase().startsWith('min')) {
    abcRoot += 'm';
  }

  return abcRoot;
}

/**
 * Convert a note event to ABC notation
 */
function noteToAbc(note: NoteEvent): string {
  const match = note.pitch.match(/^([A-G])([#b]?)(-?\d+)$/);
  if (!match) return 'z'; // rest

  const [, noteName, accidental, octaveStr] = match;
  const octave = parseInt(octaveStr, 10);

  // ABC uses different notation for octaves:
  // C, D, E, F, G, A, B = C4 to B4
  // c, d, e, f, g, a, b = C5 to B5
  // C, = C3, C,, = C2
  // c' = C6, c'' = C7

  let abcNote = '';

  // Accidentals
  if (accidental === '#') abcNote += '^';
  if (accidental === 'b') abcNote += '_';

  // Note name and octave
  if (octave < 4) {
    abcNote += noteName;
    abcNote += ','.repeat(4 - octave);
  } else if (octave === 4) {
    abcNote += noteName;
  } else if (octave === 5) {
    abcNote += noteName.toLowerCase();
  } else {
    abcNote += noteName.toLowerCase();
    abcNote += "'".repeat(octave - 5);
  }

  // Duration
  // ABC uses: 1 = eighth, 2 = quarter, 4 = half, 8 = whole
  // (when L:1/8 is set)
  const durationMultiplier = note.durationSeconds * (currentTimeline.settings.tempo / 60) * 2;
  if (durationMultiplier !== 1) {
    if (durationMultiplier === Math.floor(durationMultiplier)) {
      abcNote += Math.floor(durationMultiplier);
    } else if (durationMultiplier === 0.5) {
      abcNote += '/2';
    } else if (durationMultiplier === 0.25) {
      abcNote += '/4';
    } else if (durationMultiplier === 1.5) {
      abcNote += '3/2';
    } else if (durationMultiplier === 0.75) {
      abcNote += '3/4';
    }
  }

  return abcNote;
}

/**
 * Convert pitch string to MIDI number for comparison
 */
function pitchToMidi(pitch: string): number {
  const match = pitch.match(/^([A-G])([#b]?)(-?\d+)$/);
  if (!match) return 60; // default to middle C

  const [, noteName, accidental, octaveStr] = match;
  const noteValues: Record<string, number> = {
    'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11
  };

  let midi = noteValues[noteName] || 0;
  if (accidental === '#') midi += 1;
  if (accidental === 'b') midi -= 1;

  const octave = parseInt(octaveStr, 10);
  midi += (octave + 1) * 12;

  return midi;
}

/**
 * Group notes that occur at the same time (for chords)
 */
function groupNotesByTime(notes: NoteEvent[]): Map<number, NoteEvent[]> {
  const groups = new Map<number, NoteEvent[]>();

  for (const note of notes) {
    // Round to nearest 32nd note to handle timing variations
    const quantizedTime = Math.round(note.time * 8) / 8;

    if (!groups.has(quantizedTime)) {
      groups.set(quantizedTime, []);
    }
    groups.get(quantizedTime)!.push(note);
  }

  // Sort by time
  return new Map([...groups.entries()].sort((a, b) => a[0] - b[0]));
}

/**
 * Export EtherScore to ABC notation
 */
export function exportScoreToAbc(
  score: EtherScore,
  scoreTimeline: Timeline,
  options: AbcExportOptions = {}
): string {
  // Store timeline reference for duration calculations
  currentTimeline = scoreTimeline;

  return exportToAbc(scoreTimeline, {
    title: score.meta?.title || options.title,
    composer: score.meta?.composer || options.composer,
    ...options,
  });
}

/**
 * Generate a simple ABC tune for testing
 */
export function generateSimpleAbc(
  notes: string[],
  key = 'C',
  meter = '4/4',
  tempo = 120
): string {
  const lines = [
    'X:1',
    'T:Generated Tune',
    `M:${meter}`,
    'L:1/8',
    `K:${key}`,
    `Q:1/4=${tempo}`,
    '',
    notes.join(' ') + ' |]',
  ];

  return lines.join('\n');
}
