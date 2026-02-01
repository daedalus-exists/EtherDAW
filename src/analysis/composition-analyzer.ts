/**
 * Composition Analyzer for EtherDAW
 * 
 * Analyzes EtherScore documents for musical structure, harmony, melody, and rhythm.
 * Provides insights into composition characteristics.
 * 
 * @module analysis/composition-analyzer
 */

import type { EtherScore, Timeline, TimelineEvent, NoteEvent, Pattern, Section, Track } from '../schema/types.js';
import { compile } from '../engine/compiler.js';
import { parseTimeSignature } from '../theory/rhythm.js';
import { pitchToMidi, midiToPitch } from '../parser/note-parser.js';
import { identifyChord, identifyQuality } from '../theory/chords.js';
import { semitonesToInterval, fullName as intervalFullName } from '../theory/intervals.js';
import { DURATIONS } from '../config/constants.js';

// ============================================================================
// Tone.js Format Types (for autonomy-style compositions)
// ============================================================================

/**
 * Tone.js-style note object used in some compositions
 */
interface ToneJsNoteObject {
  time: string;       // "0:0", "1:2" (bar:beat)
  note?: string;      // "C4", "G#3" (for single notes)
  chord?: string;     // "Cmaj7", "Am" (for chords)
  duration: string;   // "4n", "2n", "1m" (Tone.js duration)
  velocity?: number;  // 0-127 (MIDI style)
}

/**
 * Pattern with embedded tracks (Tone.js format)
 */
interface ToneJsPattern {
  length?: string;    // "2m", "4m" (pattern length in bars)
  tracks: Record<string, ToneJsNoteObject[]>;
}

/**
 * Detect if a score uses Tone.js-style notation
 * Checks if patterns have nested tracks with note objects (exported for testing)
 */
export function isToneJsFormat(score: EtherScore): boolean {
  if (!score.patterns) return false;
  
  for (const pattern of Object.values(score.patterns)) {
    // Skip comment keys
    if (typeof pattern !== 'object' || pattern === null) continue;
    
    // Check if pattern has 'tracks' property with note objects
    const p = pattern as unknown as Record<string, unknown>;
    if (p.tracks && typeof p.tracks === 'object') {
      const tracks = p.tracks as Record<string, unknown>;
      for (const track of Object.values(tracks)) {
        if (Array.isArray(track) && track.length > 0) {
          const firstItem = track[0];
          if (typeof firstItem === 'object' && firstItem !== null) {
            const obj = firstItem as Record<string, unknown>;
            if (typeof obj.time === 'string' && typeof obj.duration === 'string') {
              return true;
            }
          }
        }
      }
    }
  }
  
  // Also check if sections are arrays (Tone.js format uses pattern name arrays)
  for (const section of Object.values(score.sections)) {
    if (Array.isArray(section)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Convert Tone.js time string (bar:beat) to beats
 * "0:0" = 0, "0:2" = 2, "1:0" = 4 (in 4/4)
 */
function parseToneJsTime(time: string, beatsPerBar: number = 4): number {
  const parts = time.split(':');
  if (parts.length === 2) {
    const bar = parseInt(parts[0], 10) || 0;
    const beat = parseInt(parts[1], 10) || 0;
    return bar * beatsPerBar + beat;
  }
  return 0;
}

/**
 * Convert Tone.js duration to beats
 * "4n" = 1 (quarter), "2n" = 2 (half), "1m" = 4 (whole bar)
 */
function parseToneJsDuration(duration: string): number {
  // Handle measure notation (1m, 2m, etc.)
  const measureMatch = duration.match(/^(\d+)m$/);
  if (measureMatch) {
    return parseInt(measureMatch[1], 10) * 4; // 4 beats per bar
  }
  
  // Handle Tone.js notation (4n, 2n, 8n, etc.)
  const toneMatch = duration.match(/^(\d+)n(\.)?$/);
  if (toneMatch) {
    const base = parseInt(toneMatch[1], 10);
    const dotted = !!toneMatch[2];
    const beats = 4 / base; // 4n = 1, 2n = 2, 8n = 0.5
    return dotted ? beats * 1.5 : beats;
  }
  
  // Try standard EtherDAW notation
  const durationMap = DURATIONS as Record<string, number>;
  if (durationMap[duration] !== undefined) {
    return durationMap[duration];
  }
  
  // Handle dotted versions
  if (duration.endsWith('.')) {
    const base = duration.slice(0, -1);
    if (durationMap[base] !== undefined) {
      return durationMap[base] * 1.5;
    }
  }
  
  return 1; // Default to quarter note
}

/**
 * Convert Tone.js velocity (0-127) to normalized (0-1)
 */
function normalizeToneJsVelocity(velocity?: number): number {
  if (velocity === undefined) return 0.8;
  if (velocity <= 1) return velocity; // Already normalized
  return Math.min(1, velocity / 127);
}

/**
 * Convert Tone.js note object to string notation
 * { time: "0:0", note: "C4", duration: "4n", velocity: 80 } -> "C4:q@0.63"
 */
function toneJsNoteToString(obj: ToneJsNoteObject): string {
  const velocity = normalizeToneJsVelocity(obj.velocity);
  
  // Convert duration to EtherDAW format
  let durationCode = 'q'; // default
  const durationBeats = parseToneJsDuration(obj.duration);
  
  // Find closest duration code
  if (durationBeats >= 4) durationCode = 'w';
  else if (durationBeats >= 3) durationCode = 'h.';
  else if (durationBeats >= 2) durationCode = 'h';
  else if (durationBeats >= 1.5) durationCode = 'q.';
  else if (durationBeats >= 1) durationCode = 'q';
  else if (durationBeats >= 0.75) durationCode = '8.';
  else if (durationBeats >= 0.5) durationCode = '8';
  else durationCode = '16';
  
  if (obj.note) {
    return `${obj.note}:${durationCode}@${velocity.toFixed(2)}`;
  } else if (obj.chord) {
    return `${obj.chord}:${durationCode}@${velocity.toFixed(2)}`;
  }
  
  return `r:${durationCode}`;
}

/**
 * Convert pattern length string to bars
 * "2m" -> 2, "4m" -> 4
 */
function parsePatternLength(length: string): number {
  const match = length.match(/^(\d+)m$/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return 1;
}

/**
 * Normalize a Tone.js format score to standard EtherScore format
 */
/**
 * Normalize a score to standard format (exported for testing)
 */
export function normalizeScore(score: EtherScore): EtherScore {
  if (!isToneJsFormat(score)) {
    return score; // Already in standard format
  }
  
  const normalized: EtherScore = {
    meta: score.meta,
    settings: score.settings,
    instruments: score.instruments,
    patterns: {},
    sections: {},
    arrangement: score.arrangement,
  };
  
  const beatsPerBar = 4; // Assume 4/4 for now
  
  // Convert patterns from Tone.js format to standard format
  for (const [patternName, pattern] of Object.entries(score.patterns)) {
    // Skip comment keys
    if (typeof pattern !== 'object' || pattern === null) {
      normalized.patterns[patternName] = pattern;
      continue;
    }
    
    const p = pattern as unknown as ToneJsPattern;
    
    // If pattern has Tone.js-style tracks, convert them
    if (p.tracks && typeof p.tracks === 'object') {
      const patternLength = p.length ? parsePatternLength(p.length) : 1;
      
      // For each track in the pattern, create separate patterns
      // and store metadata for section reconstruction
      for (const [trackName, notes] of Object.entries(p.tracks)) {
        if (!Array.isArray(notes)) continue;
        
        // Convert Tone.js note objects to string notation
        const sortedNotes = [...notes].sort((a, b) => {
          const timeA = parseToneJsTime(a.time, beatsPerBar);
          const timeB = parseToneJsTime(b.time, beatsPerBar);
          return timeA - timeB;
        });
        
        // Group notes by time to create proper note sequence
        const noteStrings: string[] = [];
        let lastTime = 0;
        
        for (const noteObj of sortedNotes) {
          const noteTime = parseToneJsTime(noteObj.time, beatsPerBar);
          
          // Add rest if there's a gap
          if (noteTime > lastTime) {
            const gap = noteTime - lastTime;
            if (gap >= 4) noteStrings.push(`r:w`);
            else if (gap >= 2) noteStrings.push(`r:h`);
            else if (gap >= 1) noteStrings.push(`r:q`);
            else if (gap >= 0.5) noteStrings.push(`r:8`);
            // Small gaps are ignored
          }
          
          // Add the note
          if (noteObj.chord) {
            // For chords, we'll use the chord pattern
            const velocity = normalizeToneJsVelocity(noteObj.velocity);
            let durationCode = 'q';
            const durationBeats = parseToneJsDuration(noteObj.duration);
            if (durationBeats >= 4) durationCode = 'w';
            else if (durationBeats >= 2) durationCode = 'h';
            else if (durationBeats >= 1) durationCode = 'q';
            noteStrings.push(`${noteObj.chord}:${durationCode}`);
          } else if (noteObj.note) {
            noteStrings.push(toneJsNoteToString(noteObj));
          }
          
          const noteDuration = parseToneJsDuration(noteObj.duration);
          lastTime = noteTime + noteDuration;
        }
        
        // Create pattern for this track
        const subPatternName = `${patternName}_${trackName}`;
        
        // Check if notes contain chords
        const hasChords = sortedNotes.some(n => n.chord);
        
        if (hasChords) {
          // Split into chords array
          const chordStrings = sortedNotes
            .filter(n => n.chord)
            .map(n => {
              let durationCode = 'q';
              const durationBeats = parseToneJsDuration(n.duration);
              if (durationBeats >= 4) durationCode = 'w';
              else if (durationBeats >= 2) durationCode = 'h';
              else if (durationBeats >= 1) durationCode = 'q';
              return `${n.chord}:${durationCode}`;
            });
          normalized.patterns[subPatternName] = {
            chords: chordStrings,
          };
        } else {
          // All notes
          const noteOnlyStrings = sortedNotes
            .filter(n => n.note)
            .map(n => toneJsNoteToString(n));
          normalized.patterns[subPatternName] = {
            notes: noteOnlyStrings.length > 0 ? noteOnlyStrings : ['r:w'],
          };
        }
      }
    } else {
      // Pattern is already in standard format
      normalized.patterns[patternName] = pattern;
    }
  }
  
  // Convert sections from array format to standard format
  for (const [sectionName, section] of Object.entries(score.sections)) {
    // Skip comment keys
    if (typeof sectionName === 'string' && sectionName.startsWith('//')) {
      normalized.sections[sectionName] = section as unknown as Section;
      continue;
    }
    
    if (Array.isArray(section)) {
      // Section is an array of pattern names
      // Calculate total bars from referenced patterns
      let totalBars = 0;
      const tracks: Record<string, Track> = {};
      
      for (const patternName of section) {
        const pattern = score.patterns[patternName] as unknown as ToneJsPattern;
        if (pattern && pattern.length) {
          totalBars += parsePatternLength(pattern.length);
        } else {
          totalBars += 1; // Default 1 bar
        }
        
        // Collect track patterns
        if (pattern && pattern.tracks) {
          for (const trackName of Object.keys(pattern.tracks)) {
            const subPatternName = `${patternName}_${trackName}`;
            if (!tracks[trackName]) {
              tracks[trackName] = { patterns: [] };
            }
            (tracks[trackName].patterns as string[]).push(subPatternName);
          }
        }
      }
      
      normalized.sections[sectionName] = {
        bars: totalBars,
        tracks,
      };
    } else {
      // Section is already in standard format
      normalized.sections[sectionName] = section as Section;
    }
  }
  
  return normalized;
}

// ============================================================================
// Types
// ============================================================================

export interface DurationStats {
  totalSeconds: number;
  totalBars: number;
  totalBeats: number;
  sections: Array<{
    name: string;
    bars: number;
    seconds: number;
    percentage: number;
  }>;
}

export interface PitchRange {
  instrument: string;
  lowest: {
    pitch: string;
    midi: number;
  };
  highest: {
    pitch: string;
    midi: number;
  };
  range: number; // in semitones
  rangeOctaves: number;
}

export interface NoteDensity {
  overall: number; // notes per bar
  perInstrument: Record<string, number>;
  perSection: Record<string, number>;
  busiestSection: string;
  sparsestSection: string;
}

export interface ChordInfo {
  symbol: string;
  quality: string;
  startBeat: number;
  durationBeats: number;
  occurrences: number;
}

export interface HarmonicVocabulary {
  uniqueChords: string[];
  chordCount: number;
  chordChanges: number;
  changesPerBar: number;
  mostCommonChords: Array<{ chord: string; count: number; percentage: number }>;
  chordProgression: string[]; // simplified representation
  chordQualities: Record<string, number>; // count of each quality type
}

export interface IntervalDistribution {
  intervals: Record<string, number>; // interval name -> count
  totalIntervals: number;
  mostCommon: Array<{ interval: string; fullName: string; count: number; percentage: number }>;
  averageIntervalSize: number; // in semitones
  leapVsStepRatio: number; // ratio of leaps (>2 semitones) to steps
  contour: 'ascending' | 'descending' | 'static' | 'varied';
}

export interface MelodicAnalysis {
  instrument: string;
  intervalDistribution: IntervalDistribution;
  phraseCount: number;
  averagePhraseLength: number; // in beats
}

export interface CompositionAnalysis {
  title: string;
  composer: string;
  key: string;
  tempo: number;
  timeSignature: string;
  duration: DurationStats;
  pitchRanges: PitchRange[];
  noteDensity: NoteDensity;
  harmonicVocabulary: HarmonicVocabulary;
  melodicAnalysis: MelodicAnalysis[];
  summary: string[];
}

// ============================================================================
// Analysis Functions
// ============================================================================

/**
 * Analyze an EtherScore document
 * Supports both standard EtherScore format and Tone.js-style object notation
 */
export function analyzeComposition(score: EtherScore): CompositionAnalysis {
  // Normalize score if it uses Tone.js format
  const normalizedScore = normalizeScore(score);
  
  const { timeline, stats } = compile(normalizedScore);
  const timeSignature = normalizedScore.settings.timeSignature || '4/4';
  const { beatsPerBar } = parseTimeSignature(timeSignature);
  const tempo = normalizedScore.settings.tempo;
  
  // Group events by instrument
  const eventsByInstrument = groupEventsByInstrument(timeline);
  
  // Calculate duration stats
  const duration = analyzeDuration(normalizedScore, stats.durationSeconds, tempo, beatsPerBar);
  
  // Calculate pitch ranges per instrument
  const pitchRanges = analyzePitchRanges(eventsByInstrument);
  
  // Calculate note density
  const noteDensity = analyzeNoteDensity(normalizedScore, timeline, beatsPerBar);
  
  // Analyze harmonic content
  const harmonicVocabulary = analyzeHarmony(timeline, beatsPerBar);
  
  // Analyze melodic content (for melody/lead instruments)
  const melodicAnalysis = analyzeMelody(eventsByInstrument, beatsPerBar);
  
  // Generate summary
  const summary = generateSummary({
    duration,
    pitchRanges,
    noteDensity,
    harmonicVocabulary,
    melodicAnalysis,
    tempo,
    key: normalizedScore.settings.key || 'unknown',
  });
  
  // Use original score metadata (preserving original titles etc.)
  return {
    title: score.meta?.title || 'Untitled',
    composer: score.meta?.composer || 'Unknown',
    key: normalizedScore.settings.key || 'Not specified',
    tempo: normalizedScore.settings.tempo,
    timeSignature,
    duration,
    pitchRanges,
    noteDensity,
    harmonicVocabulary,
    melodicAnalysis,
    summary,
  };
}

/**
 * Group timeline events by instrument
 */
function groupEventsByInstrument(timeline: Timeline): Map<string, NoteEvent[]> {
  const groups = new Map<string, NoteEvent[]>();
  
  for (const event of timeline.events) {
    if (event.type === 'note') {
      const instrument = event.instrument || 'unknown';
      if (!groups.has(instrument)) {
        groups.set(instrument, []);
      }
      groups.get(instrument)!.push(event);
    }
  }
  
  return groups;
}

/**
 * Analyze duration statistics
 */
function analyzeDuration(
  score: EtherScore,
  totalSeconds: number,
  tempo: number,
  beatsPerBar: number
): DurationStats {
  const totalBeats = (totalSeconds * tempo) / 60;
  const totalBars = totalBeats / beatsPerBar;
  
  const sections: DurationStats['sections'] = [];
  let accumulatedBars = 0;
  
  for (const sectionName of score.arrangement) {
    const section = score.sections[sectionName];
    if (!section) continue;
    
    const sectionBars = section.bars;
    const sectionBeats = sectionBars * beatsPerBar;
    const sectionSeconds = (sectionBeats * 60) / (section.tempo || tempo);
    const percentage = (sectionBars / totalBars) * 100;
    
    sections.push({
      name: sectionName,
      bars: sectionBars,
      seconds: sectionSeconds,
      percentage,
    });
    
    accumulatedBars += sectionBars;
  }
  
  return {
    totalSeconds,
    totalBars: Math.round(totalBars * 100) / 100,
    totalBeats: Math.round(totalBeats * 100) / 100,
    sections,
  };
}

/**
 * Analyze pitch ranges for each instrument
 */
function analyzePitchRanges(eventsByInstrument: Map<string, NoteEvent[]>): PitchRange[] {
  const ranges: PitchRange[] = [];
  
  for (const [instrument, events] of eventsByInstrument) {
    const midiValues = events
      .filter(e => e.pitch)
      .map(e => pitchToMidi(e.pitch));
    
    if (midiValues.length === 0) continue;
    
    const lowestMidi = Math.min(...midiValues);
    const highestMidi = Math.max(...midiValues);
    const range = highestMidi - lowestMidi;
    
    ranges.push({
      instrument,
      lowest: {
        pitch: midiToPitch(lowestMidi),
        midi: lowestMidi,
      },
      highest: {
        pitch: midiToPitch(highestMidi),
        midi: highestMidi,
      },
      range,
      rangeOctaves: Math.round((range / 12) * 10) / 10,
    });
  }
  
  return ranges.sort((a, b) => a.instrument.localeCompare(b.instrument));
}

/**
 * Analyze note density (notes per bar)
 */
function analyzeNoteDensity(
  score: EtherScore,
  timeline: Timeline,
  beatsPerBar: number
): NoteDensity {
  const noteEvents = timeline.events.filter(e => e.type === 'note') as NoteEvent[];
  const totalBars = timeline.totalBeats / beatsPerBar;
  
  // Overall density
  const overall = noteEvents.length / totalBars;
  
  // Per instrument
  const instrumentCounts: Record<string, number> = {};
  for (const event of noteEvents) {
    const instrument = event.instrument || 'unknown';
    instrumentCounts[instrument] = (instrumentCounts[instrument] || 0) + 1;
  }
  
  const perInstrument: Record<string, number> = {};
  for (const [instrument, count] of Object.entries(instrumentCounts)) {
    perInstrument[instrument] = Math.round((count / totalBars) * 100) / 100;
  }
  
  // Per section
  const perSection: Record<string, number> = {};
  let currentBeat = 0;
  
  for (const sectionName of score.arrangement) {
    const section = score.sections[sectionName];
    if (!section) continue;
    
    const sectionBars = section.bars;
    const sectionEndBeat = currentBeat + (sectionBars * beatsPerBar);
    
    const sectionNotes = noteEvents.filter(
      e => e.time >= currentBeat && e.time < sectionEndBeat
    ).length;
    
    perSection[sectionName] = Math.round((sectionNotes / sectionBars) * 100) / 100;
    currentBeat = sectionEndBeat;
  }
  
  // Find busiest and sparsest sections
  const sectionEntries = Object.entries(perSection);
  const busiestSection = sectionEntries.reduce((a, b) => a[1] > b[1] ? a : b, ['', 0])[0];
  const sparsestSection = sectionEntries.reduce((a, b) => a[1] < b[1] ? a : b, ['', Infinity])[0];
  
  return {
    overall: Math.round(overall * 100) / 100,
    perInstrument,
    perSection,
    busiestSection: busiestSection || 'N/A',
    sparsestSection: sparsestSection || 'N/A',
  };
}

/**
 * Analyze harmonic content (chords)
 */
function analyzeHarmony(timeline: Timeline, beatsPerBar: number): HarmonicVocabulary {
  const noteEvents = timeline.events.filter(e => e.type === 'note') as NoteEvent[];
  const totalBars = timeline.totalBeats / beatsPerBar;
  
  // Find simultaneous notes (within 0.1 beat) to identify chords
  const chordSnapshots: Array<{ beat: number; notes: string[] }> = [];
  const beatResolution = 0.5; // analyze every half beat
  
  for (let beat = 0; beat < timeline.totalBeats; beat += beatResolution) {
    const activeNotes = noteEvents.filter(e => {
      return e.time <= beat && (e.time + e.duration) > beat && e.pitch;
    }).map(e => e.pitch);
    
    if (activeNotes.length >= 2) {
      // Only add if different from previous
      const lastSnapshot = chordSnapshots[chordSnapshots.length - 1];
      const notesKey = [...activeNotes].sort().join(',');
      const lastNotesKey = lastSnapshot ? [...lastSnapshot.notes].sort().join(',') : '';
      
      if (notesKey !== lastNotesKey) {
        chordSnapshots.push({ beat, notes: activeNotes });
      }
    }
  }
  
  // Identify chords
  const chordCounts: Record<string, number> = {};
  const chordProgression: string[] = [];
  let lastChord = '';
  
  for (const snapshot of chordSnapshots) {
    try {
      const chord = identifyChord(snapshot.notes);
      if (chord && chord !== lastChord) {
        chordCounts[chord] = (chordCounts[chord] || 0) + 1;
        chordProgression.push(chord);
        lastChord = chord;
      }
    } catch {
      // Ignore unidentifiable chord clusters
    }
  }
  
  // Analyze chord qualities
  const chordQualities: Record<string, number> = {};
  for (const chord of Object.keys(chordCounts)) {
    // Extract quality from chord symbol
    const quality = getChordQualityFromSymbol(chord);
    chordQualities[quality] = (chordQualities[quality] || 0) + chordCounts[chord];
  }
  
  // Sort chords by frequency
  const sortedChords = Object.entries(chordCounts)
    .sort((a, b) => b[1] - a[1]);
  
  const totalChordOccurrences = sortedChords.reduce((sum, [, count]) => sum + count, 0);
  
  const mostCommonChords = sortedChords.slice(0, 5).map(([chord, count]) => ({
    chord,
    count,
    percentage: Math.round((count / totalChordOccurrences) * 1000) / 10,
  }));
  
  return {
    uniqueChords: Object.keys(chordCounts),
    chordCount: Object.keys(chordCounts).length,
    chordChanges: chordProgression.length,
    changesPerBar: Math.round((chordProgression.length / totalBars) * 100) / 100,
    mostCommonChords,
    chordProgression: chordProgression.slice(0, 20), // First 20 chord changes
    chordQualities,
  };
}

/**
 * Extract quality from chord symbol
 */
function getChordQualityFromSymbol(symbol: string): string {
  // Remove root note and bass note
  const withoutRoot = symbol.replace(/^[A-G][#b]?/, '');
  const withoutBass = withoutRoot.replace(/\/[A-G][#b]?$/, '');
  
  if (!withoutBass || withoutBass === '') return 'major';
  if (withoutBass.startsWith('m') && !withoutBass.startsWith('maj')) return 'minor';
  if (withoutBass.includes('dim')) return 'diminished';
  if (withoutBass.includes('aug') || withoutBass.includes('+')) return 'augmented';
  if (withoutBass.includes('sus')) return 'suspended';
  if (withoutBass.match(/^7|dom/)) return 'dominant';
  if (withoutBass.includes('maj7') || withoutBass.includes('M7')) return 'major 7th';
  if (withoutBass.match(/m7|min7/)) return 'minor 7th';
  
  return withoutBass;
}

/**
 * Analyze melodic content
 */
function analyzeMelody(
  eventsByInstrument: Map<string, NoteEvent[]>,
  beatsPerBar: number
): MelodicAnalysis[] {
  const analyses: MelodicAnalysis[] = [];
  
  // Analyze instruments that might be melodic (synth, lead, melody, piano, voice)
  const melodicPatterns = ['synth', 'lead', 'melody', 'piano', 'voice', 'guitar', 'sax', 'trumpet', 'flute'];
  
  for (const [instrument, events] of eventsByInstrument) {
    const isLikelyMelodic = melodicPatterns.some(p => 
      instrument.toLowerCase().includes(p)
    );
    
    // Also analyze if it's mostly single notes (monophonic)
    const sortedEvents = [...events].sort((a, b) => a.time - b.time);
    const noteCount = sortedEvents.length;
    
    // Skip if too few notes
    if (noteCount < 4) continue;
    
    // Calculate intervals between consecutive notes
    const intervalDistribution = analyzeIntervals(sortedEvents);
    
    // Estimate phrase boundaries (rest > 1 beat or large leap)
    let phraseCount = 1;
    let currentPhraseLength = 0;
    let totalPhraseLength = 0;
    
    for (let i = 1; i < sortedEvents.length; i++) {
      const prev = sortedEvents[i - 1];
      const curr = sortedEvents[i];
      const gap = curr.time - (prev.time + prev.duration);
      
      if (gap > beatsPerBar * 0.5) {
        // New phrase
        if (currentPhraseLength > 0) {
          totalPhraseLength += currentPhraseLength;
          phraseCount++;
        }
        currentPhraseLength = curr.duration;
      } else {
        currentPhraseLength += curr.duration;
      }
    }
    totalPhraseLength += currentPhraseLength;
    
    if (isLikelyMelodic || intervalDistribution.totalIntervals > 10) {
      analyses.push({
        instrument,
        intervalDistribution,
        phraseCount,
        averagePhraseLength: Math.round((totalPhraseLength / phraseCount) * 100) / 100,
      });
    }
  }
  
  return analyses;
}

/**
 * Analyze interval distribution in a sequence of notes
 */
function analyzeIntervals(events: NoteEvent[]): IntervalDistribution {
  const intervals: Record<string, number> = {};
  let totalSemitones = 0;
  let leaps = 0;
  let steps = 0;
  let ascending = 0;
  let descending = 0;
  
  for (let i = 1; i < events.length; i++) {
    const prevPitch = events[i - 1].pitch;
    const currPitch = events[i].pitch;
    
    if (!prevPitch || !currPitch) continue;
    
    const prevMidi = pitchToMidi(prevPitch);
    const currMidi = pitchToMidi(currPitch);
    const semitones = currMidi - prevMidi;
    const absSemitones = Math.abs(semitones);
    
    // Track direction
    if (semitones > 0) ascending++;
    else if (semitones < 0) descending++;
    
    // Track step vs leap
    if (absSemitones <= 2) steps++;
    else leaps++;
    
    totalSemitones += absSemitones;
    
    // Convert to interval name
    try {
      const intervalName = semitonesToInterval(semitones);
      intervals[intervalName] = (intervals[intervalName] || 0) + 1;
    } catch {
      // Skip unrecognized intervals
    }
  }
  
  const totalIntervals = Object.values(intervals).reduce((a, b) => a + b, 0);
  
  // Sort by frequency
  const sortedIntervals = Object.entries(intervals)
    .sort((a, b) => b[1] - a[1]);
  
  const mostCommon = sortedIntervals.slice(0, 5).map(([interval, count]) => ({
    interval,
    fullName: getIntervalFullName(interval),
    count,
    percentage: Math.round((count / totalIntervals) * 1000) / 10,
  }));
  
  // Determine contour
  let contour: 'ascending' | 'descending' | 'static' | 'varied';
  if (ascending > descending * 1.5) contour = 'ascending';
  else if (descending > ascending * 1.5) contour = 'descending';
  else if (ascending === 0 && descending === 0) contour = 'static';
  else contour = 'varied';
  
  return {
    intervals,
    totalIntervals,
    mostCommon,
    averageIntervalSize: totalIntervals > 0 
      ? Math.round((totalSemitones / totalIntervals) * 100) / 100 
      : 0,
    leapVsStepRatio: steps > 0 
      ? Math.round((leaps / steps) * 100) / 100 
      : leaps,
    contour,
  };
}

/**
 * Get full interval name safely
 */
function getIntervalFullName(interval: string): string {
  try {
    return intervalFullName(interval);
  } catch {
    return interval;
  }
}

/**
 * Generate human-readable summary
 */
function generateSummary(analysis: {
  duration: DurationStats;
  pitchRanges: PitchRange[];
  noteDensity: NoteDensity;
  harmonicVocabulary: HarmonicVocabulary;
  melodicAnalysis: MelodicAnalysis[];
  tempo: number;
  key: string;
}): string[] {
  const summary: string[] = [];
  
  // Duration summary
  const mins = Math.floor(analysis.duration.totalSeconds / 60);
  const secs = Math.round(analysis.duration.totalSeconds % 60);
  summary.push(`Duration: ${mins}:${secs.toString().padStart(2, '0')} (${analysis.duration.totalBars} bars)`);
  
  // Tempo and key
  summary.push(`Tempo: ${analysis.tempo} BPM, Key: ${analysis.key}`);
  
  // Density
  const densityDesc = analysis.noteDensity.overall > 10 
    ? 'dense' 
    : analysis.noteDensity.overall > 5 
      ? 'moderate' 
      : 'sparse';
  summary.push(`Note density: ${densityDesc} (${analysis.noteDensity.overall} notes/bar average)`);
  
  // Harmonic vocabulary
  if (analysis.harmonicVocabulary.chordCount > 0) {
    summary.push(`Harmonic vocabulary: ${analysis.harmonicVocabulary.chordCount} unique chords, ${analysis.harmonicVocabulary.changesPerBar} changes/bar`);
    
    if (analysis.harmonicVocabulary.mostCommonChords.length > 0) {
      const topChords = analysis.harmonicVocabulary.mostCommonChords.slice(0, 3)
        .map(c => c.chord)
        .join(', ');
      summary.push(`Most common chords: ${topChords}`);
    }
  }
  
  // Melodic character
  if (analysis.melodicAnalysis.length > 0) {
    const mainMelody = analysis.melodicAnalysis[0];
    if (mainMelody.intervalDistribution.mostCommon.length > 0) {
      const steppy = mainMelody.intervalDistribution.leapVsStepRatio < 0.5;
      const melodicDesc = steppy ? 'stepwise/conjunct' : 'leaping/disjunct';
      summary.push(`Melodic character: ${melodicDesc} (${mainMelody.intervalDistribution.contour} contour)`);
    }
  }
  
  // Pitch range
  if (analysis.pitchRanges.length > 0) {
    const widest = analysis.pitchRanges.reduce((a, b) => a.range > b.range ? a : b);
    summary.push(`Widest range: ${widest.instrument} (${widest.lowest.pitch} to ${widest.highest.pitch}, ${widest.rangeOctaves} octaves)`);
  }
  
  return summary;
}

// ============================================================================
// Output Formatters
// ============================================================================

/**
 * Format analysis as clean terminal output
 */
export function formatAnalysisTerminal(analysis: CompositionAnalysis): string {
  const lines: string[] = [];
  const divider = '═'.repeat(60);
  const thinDivider = '─'.repeat(60);
  
  // Header
  lines.push(divider);
  lines.push(`  COMPOSITION ANALYSIS: ${analysis.title}`);
  lines.push(divider);
  lines.push('');
  
  // Basic info
  lines.push('📋 BASIC INFO');
  lines.push(thinDivider);
  lines.push(`  Composer:       ${analysis.composer}`);
  lines.push(`  Key:            ${analysis.key}`);
  lines.push(`  Tempo:          ${analysis.tempo} BPM`);
  lines.push(`  Time Signature: ${analysis.timeSignature}`);
  lines.push('');
  
  // Duration
  lines.push('⏱️  DURATION');
  lines.push(thinDivider);
  const mins = Math.floor(analysis.duration.totalSeconds / 60);
  const secs = Math.round(analysis.duration.totalSeconds % 60);
  lines.push(`  Total:          ${mins}:${secs.toString().padStart(2, '0')}`);
  lines.push(`  Bars:           ${analysis.duration.totalBars}`);
  lines.push(`  Beats:          ${analysis.duration.totalBeats}`);
  lines.push('');
  
  if (analysis.duration.sections.length > 0) {
    lines.push('  Sections:');
    for (const section of analysis.duration.sections) {
      const pct = section.percentage.toFixed(1).padStart(5);
      lines.push(`    ${section.name.padEnd(15)} ${section.bars.toString().padStart(3)} bars  (${pct}%)`);
    }
    lines.push('');
  }
  
  // Pitch Ranges
  if (analysis.pitchRanges.length > 0) {
    lines.push('🎹 PITCH RANGES');
    lines.push(thinDivider);
    for (const range of analysis.pitchRanges) {
      lines.push(`  ${range.instrument.padEnd(15)} ${range.lowest.pitch.padEnd(4)} → ${range.highest.pitch.padEnd(4)} (${range.rangeOctaves} oct)`);
    }
    lines.push('');
  }
  
  // Note Density
  lines.push('📊 NOTE DENSITY');
  lines.push(thinDivider);
  lines.push(`  Overall:        ${analysis.noteDensity.overall} notes/bar`);
  lines.push(`  Busiest:        ${analysis.noteDensity.busiestSection} (${analysis.noteDensity.perSection[analysis.noteDensity.busiestSection] || 0} notes/bar)`);
  lines.push(`  Sparsest:       ${analysis.noteDensity.sparsestSection} (${analysis.noteDensity.perSection[analysis.noteDensity.sparsestSection] || 0} notes/bar)`);
  lines.push('');
  lines.push('  Per instrument:');
  for (const [instrument, density] of Object.entries(analysis.noteDensity.perInstrument)) {
    lines.push(`    ${instrument.padEnd(15)} ${density.toString().padStart(6)} notes/bar`);
  }
  lines.push('');
  
  // Harmonic Vocabulary
  if (analysis.harmonicVocabulary.chordCount > 0) {
    lines.push('🎵 HARMONIC VOCABULARY');
    lines.push(thinDivider);
    lines.push(`  Unique chords:  ${analysis.harmonicVocabulary.chordCount}`);
    lines.push(`  Chord changes:  ${analysis.harmonicVocabulary.chordChanges}`);
    lines.push(`  Changes/bar:    ${analysis.harmonicVocabulary.changesPerBar}`);
    lines.push('');
    
    if (analysis.harmonicVocabulary.mostCommonChords.length > 0) {
      lines.push('  Most common chords:');
      for (const { chord, count, percentage } of analysis.harmonicVocabulary.mostCommonChords) {
        lines.push(`    ${chord.padEnd(10)} ${count.toString().padStart(3)}× (${percentage.toFixed(1)}%)`);
      }
      lines.push('');
    }
    
    if (Object.keys(analysis.harmonicVocabulary.chordQualities).length > 0) {
      lines.push('  Chord qualities:');
      const sortedQualities = Object.entries(analysis.harmonicVocabulary.chordQualities)
        .sort((a, b) => b[1] - a[1]);
      for (const [quality, count] of sortedQualities) {
        lines.push(`    ${quality.padEnd(15)} ${count.toString().padStart(3)}×`);
      }
      lines.push('');
    }
    
    if (analysis.harmonicVocabulary.chordProgression.length > 0) {
      lines.push('  Chord progression (first 20):');
      const chunkedProgression = [];
      for (let i = 0; i < analysis.harmonicVocabulary.chordProgression.length; i += 4) {
        chunkedProgression.push(
          analysis.harmonicVocabulary.chordProgression.slice(i, i + 4).join(' → ')
        );
      }
      for (const chunk of chunkedProgression) {
        lines.push(`    ${chunk}`);
      }
      lines.push('');
    }
  }
  
  // Melodic Analysis
  if (analysis.melodicAnalysis.length > 0) {
    lines.push('🎼 MELODIC INTERVALS');
    lines.push(thinDivider);
    
    for (const melody of analysis.melodicAnalysis) {
      lines.push(`  ${melody.instrument}:`);
      lines.push(`    Contour:      ${melody.intervalDistribution.contour}`);
      lines.push(`    Avg interval: ${melody.intervalDistribution.averageIntervalSize} semitones`);
      lines.push(`    Leap/step:    ${melody.intervalDistribution.leapVsStepRatio} (${melody.intervalDistribution.leapVsStepRatio < 0.5 ? 'stepwise' : 'leaping'})`);
      lines.push(`    Phrases:      ~${melody.phraseCount} (avg ${melody.averagePhraseLength} beats)`);
      
      if (melody.intervalDistribution.mostCommon.length > 0) {
        lines.push('    Most common intervals:');
        for (const { interval, fullName, count, percentage } of melody.intervalDistribution.mostCommon.slice(0, 5)) {
          lines.push(`      ${interval.padEnd(4)} ${fullName.padEnd(20)} ${count.toString().padStart(3)}× (${percentage.toFixed(1)}%)`);
        }
      }
      lines.push('');
    }
  }
  
  // Summary
  lines.push('📝 SUMMARY');
  lines.push(thinDivider);
  for (const line of analysis.summary) {
    lines.push(`  • ${line}`);
  }
  lines.push('');
  lines.push(divider);
  
  return lines.join('\n');
}

/**
 * Format analysis as JSON
 */
export function formatAnalysisJSON(analysis: CompositionAnalysis): string {
  return JSON.stringify(analysis, null, 2);
}
