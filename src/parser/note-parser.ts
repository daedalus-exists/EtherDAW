import type { ParsedNote, NoteName, Accidental, Articulation, ArticulationModifiers, JazzArticulation, Ornament, DynamicsMarking } from '../schema/types.js';
import { DURATION_MAP } from '../schema/types.js';
import { ARTICULATION, DOTTED_MULTIPLIER, NOTE_VALUES, NOTE_NAMES, MIDI, DYNAMICS } from '../config/constants.js';
import { errors, createError, VALID_DURATIONS } from '../errors/messages.js';

/**
 * Regular expression for parsing note notation
 * Format: {pitch}{octave}:{duration}[.][tN][articulation][~>][jazzArt][ornament][velocity][timing][probability]
 *
 * v0.3 Examples: C4:q, Eb3:8, F#5:h., Bb2:16, C4:q*, D4:8>, E4:h~
 * v0.4 Examples: C4:q@0.8, D4:8?0.7, E4:h+10ms, F4:q~>, G4:q*@0.9?0.5-5ms
 * v0.7 Examples: C4:8t3 (triplet), D4:qt3, E4:16t5 (quintuplet)
 * v0.8 Examples: C4:q.fall, D4:h.doit, E4:q.tr, F4:q@mf, G4:q.bend+2
 * v0.9.4 Examples: C4:q:ped (sustain pedal)
 * v0.9.13 Examples: C4:1m (one measure), C4:2m (two measures)
 *
 * Articulations: * (staccato), ~ (legato), > (accent), ^ (marcato)
 * Portamento: ~> (glide to next note)
 * Tuplets: tN where N is the tuplet ratio (e.g., t3 for triplet, t5 for quintuplet)
 * Jazz Articulations (v0.8): .fall, .doit, .scoop, .bend+N
 * Ornaments (v0.8): .tr, .mord, .turn
 * Velocity: @0.0-1.0 or @ppp/@pp/@p/@mp/@mf/@f/@ff/@fff (per-note velocity)
 * Timing: +/-Nms (timing offset in milliseconds)
 * Probability: ?0.0-1.0 (chance of note playing)
 * Sustain Pedal (v0.9.4): :ped (note sustains until pedal lifts)
 * Measure Duration (v0.9.13): Nm (duration in measures, e.g., 1m, 2m)
 *
 * Capture groups:
 * 1: Note name (A-G)
 * 2: Accidental (#, b, or empty)
 * 3: Octave (optional, default 4)
 * 4: Duration code (includes measure notation like "1m", "2m")
 * 5: Dot (optional)
 * 6: Tuplet ratio (number after 't')
 * 7: Articulation (*>^) - staccato, accent, marcato
 * 8: Portamento (~>)
 * 9: Legato (~)
 * 10: Jazz articulation (fall, doit, scoop, bend)
 * 11: Bend amount for .bend+N
 * 12: Ornament (tr, mord, turn)
 * 13: Velocity (number or dynamics marking after @)
 * 14: Timing offset (signed number before ms)
 * 15: Probability (number after ?)
 * 16: Portamento trailing (~>) - alternate position after modifiers
 * 17: Sustain pedal (:ped)
 */
// Note: Portamento (~>) can appear either before or after velocity/timing modifiers
// Duration can be: standard (w, h, q, 8, 16, 32, 2, 4) or measure-based (1m, 2m, etc.)
const NOTE_REGEX = /^([A-Ga-g])([#b]?)(-?\d)?:(\d+m?|[whq])(\.?)(?:t(\d+))?(?:([*>^])|(~>)|(~))?(?:\.(fall|doit|scoop|bend)(?:\+(\d+))?)?(?:\.(tr|mord|turn))?(?:@((?:0|1)?\.?\d+|ppp|pp|p|mp|mf|f|ff|fff))?(?:([+-]\d+)ms)?(?:\?((?:0|1)?\.?\d+))?(~>)?(:ped)?$/;

/**
 * Regular expression for parsing rest notation
 * Format: r:{duration}
 * Examples: r:q, r:h, r:8, r:1m (one measure rest)
 */
const REST_REGEX = /^r:(\d+m?|[whq])(\.?)$/i;

/**
 * v0.9.9: Check for common syntax order mistakes and throw helpful errors
 * Articulation order should be: duration[articulation][@velocity]
 * Common mistake: @velocity before articulation (e.g., C4:q@pp~ instead of C4:q~@pp)
 */
function checkSyntaxOrderHints(noteStr: string): void {
  // Check for velocity before articulation: @<velocity><articulation>
  // Correct order is: articulation before velocity
  const velocityBeforeArticulation = /@((?:0|1)?\.?\d+|ppp|pp|p|mp|mf|f|ff|fff)([*~>^])/.exec(noteStr);
  if (velocityBeforeArticulation) {
    const [, velocity, articulation] = velocityBeforeArticulation;
    const articulationName =
      articulation === '~' ? 'legato' :
      articulation === '*' ? 'staccato' :
      articulation === '>' ? 'accent' :
      articulation === '^' ? 'marcato' : 'articulation';

    // Suggest the correct order
    const corrected = noteStr.replace('@' + velocity + articulation, articulation + '@' + velocity);
    throw new Error(
      'Syntax order error in "' + noteStr + '": ' + articulationName + ' (' + articulation + ') must come BEFORE velocity (@' + velocity + ').\n' +
      'Try: ' + corrected
    );
  }

  // Check for missing colon between pitch and duration
  const missingColon = /^([A-Ga-g][#b]?\d?)([whq]|\d+)/.exec(noteStr);
  if (missingColon && !noteStr.includes(':')) {
    const [, pitch, duration] = missingColon;
    throw new Error(
      'Missing colon in "' + noteStr + '": Note format requires a colon between pitch and duration.\n' +
      'Try: ' + pitch + ':' + duration
    );
  }

  // Check for portamento (~>) after velocity (should be before)
  const portamentoAfterVelocity = /@((?:0|1)?\.?\d+|ppp|pp|p|mp|mf|f|ff|fff)(~>)/.exec(noteStr);
  if (portamentoAfterVelocity) {
    const [, velocity] = portamentoAfterVelocity;
    const corrected = noteStr.replace('@' + velocity + '~>', '~>@' + velocity);
    throw new Error(
      'Syntax order error in "' + noteStr + '": Portamento (~>) should come BEFORE velocity (@' + velocity + ').\n' +
      'Try: ' + corrected
    );
  }
}

/**
 * Parse tied durations from a string like "w+h" or "q+q+8"
 * Returns total beats and the combined duration code
 */
function parseTiedDurations(durationPart: string): { totalBeats: number; durationCode: string } {
  // Split by + but only for duration ties (not timing offsets)
  // Duration codes: w, h, q, 8, 16, 32, 2, 4
  const durationRegex = /^([whq]|\d{1,2})(\.?)$/;
  
  // Split on + that's followed by a duration code (not ms)
  const parts = durationPart.split(/\+(?=[whq\d])/);
  
  if (parts.length === 1) {
    // No ties
    const m = parts[0].match(durationRegex);
    if (m) {
      const [, code, dot] = m;
      const base = DURATION_MAP[code];
      if (base !== undefined) {
        const beats = dot ? base * DOTTED_MULTIPLIER : base;
        return { totalBeats: beats, durationCode: parts[0] };
      }
    }
    return { totalBeats: 0, durationCode: durationPart }; // Will fail later
  }
  
  // Multiple tied durations
  let totalBeats = 0;
  const codes: string[] = [];
  
  for (const part of parts) {
    const m = part.match(durationRegex);
    if (!m) {
      // Invalid duration part
      return { totalBeats: 0, durationCode: durationPart };
    }
    const [, code, dot] = m;
    const base = DURATION_MAP[code];
    if (base === undefined) {
      return { totalBeats: 0, durationCode: durationPart };
    }
    const beats = dot ? base * DOTTED_MULTIPLIER : base;
    totalBeats += beats;
    codes.push(part);
  }
  
  return { totalBeats, durationCode: codes.join('+') };
}

/**
 * Check if a note string contains tied durations (e.g., C4:w+h)
 */
function hasTiedDurations(noteStr: string): boolean {
  const colonIdx = noteStr.indexOf(':');
  if (colonIdx === -1) return false;

  const afterColon = noteStr.slice(colonIdx + 1);

  // Timing offsets like +10ms are not tied durations
  if (/[+-]\d+ms/.test(afterColon)) return false;

  const durationMatch = afterColon.match(/^([whq\d.+]+)/);
  if (!durationMatch) return false;

  const durationPart = durationMatch[1];
  if (!durationPart.includes('+')) return false;

  const parts = durationPart.split('+');
  return parts.every((part) => /^([whq]|\d{1,2})\.?$/.test(part));
}

/**
 * Parse a note string in the format "pitch:duration[tN][articulation][~>][.jazzArt][.ornament][@velocity][+/-ms][?probability]"
 * v0.9.12: Also supports tied durations like "C4:w+h" (whole + half = 6 beats)
 * @param noteStr - Note string (e.g., "C4:q", "Eb3:8", "F#5:h.", "C4:q*", "D4:8>", "C4:q@0.8", "D4:8?0.7", "C4:8t3", "C4:q.fall", "D4:h.tr", "C4:w+h")
 * @returns Parsed note object
 */
export function parseNote(noteStr: string): ParsedNote {
  const trimmed = noteStr.trim();
  
  // v0.9.12: Handle tied durations (e.g., C4:w+h)
  if (hasTiedDurations(trimmed)) {
    return parseTiedNote(trimmed);
  }
  
  const match = trimmed.match(NOTE_REGEX);

  if (!match) {
    // v0.9.9: Check for common syntax order mistakes before giving generic error
    checkSyntaxOrderHints(trimmed);
    throw createError(errors.invalidNoteSyntax(noteStr));
  }

  const [
    ,
    noteNameRaw,      // 1: Note name
    accidentalRaw,    // 2: Accidental
    octaveStr,        // 3: Octave
    durationCode,     // 4: Duration
    dotted,           // 5: Dot
    tupletRaw,        // 6: Tuplet ratio
    articulationRaw,  // 7: Articulation (*>^)
    portamentoRaw,    // 8: Portamento (~>) - before modifiers
    legatoRaw,        // 9: Legato (~)
    jazzArtRaw,       // 10: Jazz articulation (fall, doit, scoop, bend)
    bendAmountRaw,    // 11: Bend amount for .bend+N
    ornamentRaw,      // 12: Ornament (tr, mord, turn)
    velocityRaw,      // 13: Velocity
    timingRaw,        // 14: Timing offset
    probabilityRaw,   // 15: Probability
    portamentoTrailing, // 16: Portamento (~>) - after modifiers (alternate position)
    pedalRaw,         // 17: Sustain pedal (:ped)
  ] = match;

  const noteName = noteNameRaw.toUpperCase() as NoteName;
  const accidental = (accidentalRaw || '') as Accidental;
  const octave = octaveStr ? parseInt(octaveStr, 10) : 4;
  const isDotted = dotted === '.';
  const tupletRatio = tupletRaw ? parseInt(tupletRaw, 10) : undefined;

  // Handle articulation: regular articulations (*>^), legato (~), or none
  let articulation: Articulation = '';
  if (articulationRaw) {
    articulation = articulationRaw as Articulation;
  } else if (legatoRaw) {
    articulation = '~';
  }

  // Portamento (~>) can appear in either position
  const portamento = portamentoRaw === '~>' || portamentoTrailing === '~>';

  // NEW v0.8: Jazz articulations
  const jazzArticulation = jazzArtRaw as JazzArticulation | undefined;
  const bendAmount = bendAmountRaw ? parseInt(bendAmountRaw, 10) : undefined;

  // NEW v0.8: Ornaments
  const ornament = ornamentRaw as Ornament | undefined;

  // Parse optional v0.4 expression modifiers
  // v0.8: Support both numeric velocity and dynamics markings
  let velocity: number | undefined;
  let dynamics: DynamicsMarking | undefined;
  if (velocityRaw) {
    // Check if it's a dynamics marking
    if (velocityRaw in DYNAMICS) {
      dynamics = velocityRaw as DynamicsMarking;
      velocity = DYNAMICS[dynamics];
    } else {
      velocity = parseFloat(velocityRaw);
    }
  }

  const timingOffset = timingRaw ? parseInt(timingRaw, 10) : undefined;
  const probability = probabilityRaw ? parseFloat(probabilityRaw) : undefined;

  // Validate ranges
  if (velocity !== undefined && (velocity < 0 || velocity > 1)) {
    throw createError(errors.invalidVelocity(velocity));
  }
  if (probability !== undefined && (probability < 0 || probability > 1)) {
    throw new Error(`Invalid probability ${probability} in "${noteStr}". Must be 0.0-1.0`);
  }
  if (tupletRatio !== undefined && (tupletRatio < 2 || tupletRatio > 9)) {
    throw new Error(`Invalid tuplet ratio ${tupletRatio} in "${noteStr}". Must be 2-9 (e.g., t3 for triplet, t5 for quintuplet)`);
  }
  if (bendAmount !== undefined && (bendAmount < 1 || bendAmount > 12)) {
    throw new Error(`Invalid bend amount ${bendAmount} in "${noteStr}". Must be 1-12 semitones`);
  }

  // v0.9.13: Check for measure-based duration (e.g., "1m", "2m")
  const measureMatch = durationCode.match(/^(\d+)m$/);
  let durationBeats: number;
  let measureCount: number | undefined;
  
  if (measureMatch) {
    // Measure-based duration: store the measure count, durationBeats will be resolved later
    measureCount = parseInt(measureMatch[1], 10);
    if (measureCount < 1 || measureCount > 99) {
      throw new Error(`Invalid measure count ${measureCount} in "${noteStr}". Must be 1-99`);
    }
    // Default to 4/4 time (4 beats per measure) for initial calculation
    // This will be resolved properly when time signature context is available
    durationBeats = measureCount * 4;
    if (isDotted) {
      throw new Error(`Dotted measure durations are not supported in "${noteStr}". Use tied durations instead (e.g., C4:1m+h)`);
    }
    if (tupletRatio) {
      throw new Error(`Tuplet measure durations are not supported in "${noteStr}"`);
    }
  } else {
    // Standard duration lookup
    const baseDuration = DURATION_MAP[durationCode];
    if (baseDuration === undefined) {
      throw createError(errors.invalidDuration(noteStr, durationCode));
    }

    // Calculate duration with dotted and tuplet adjustments
    // Tuplet: duration * (base/ratio) where base is typically 2 for standard tuplets
    // e.g., triplet (t3): 3 notes in the space of 2, so each note is 2/3 the duration
    durationBeats = isDotted ? baseDuration * DOTTED_MULTIPLIER : baseDuration;
    if (tupletRatio) {
      // Standard tuplet: N notes in the space of (N-1) for odd ratios, or N in space of (N/2*2) for even
      // Simplified: for common tuplets, use 2/N scaling (triplet = 2/3, quintuplet = 2/5, etc.)
      const tupletBase = tupletRatio % 2 === 0 ? tupletRatio / 2 : Math.floor(tupletRatio / 2) + 1;
      durationBeats = durationBeats * tupletBase / tupletRatio;
    }
  }
  
  const pitch = `${noteName}${accidental}${octave}`;

  // Build result object, only including optional fields if they were specified
  const result: ParsedNote = {
    pitch,
    noteName,
    accidental,
    octave,
    duration: durationCode,
    durationBeats,
    dotted: isDotted,
    articulation,
  };

  // Add v0.4 expression fields only when present
  if (velocity !== undefined) result.velocity = velocity;
  if (probability !== undefined) result.probability = probability;
  if (timingOffset !== undefined) result.timingOffset = timingOffset;
  if (portamento) result.portamento = true;
  // Add v0.7 tuplet field only when present
  if (tupletRatio !== undefined) result.tupletRatio = tupletRatio;
  // Add v0.8 jazz articulation and ornament fields only when present
  if (jazzArticulation) result.jazzArticulation = jazzArticulation;
  if (bendAmount !== undefined) result.bendAmount = bendAmount;
  if (ornament) result.ornament = ornament;
  if (dynamics) result.dynamics = dynamics;
  // v0.9.4: Sustain pedal
  if (pedalRaw === ':ped') result.pedal = true;
  // v0.9.13: Measure-based duration
  if (measureCount !== undefined) result.measureCount = measureCount;

  return result;
}

/**
 * v0.9.12: Parse a tied note string like "C4:w+h" into a single note
 * Tied notes extend the duration without re-striking
 */
function parseTiedNote(noteStr: string): ParsedNote {
  // Extract pitch and duration parts
  // Format: pitch:duration+duration+...[@velocity][?probability][etc]
  const colonIdx = noteStr.indexOf(':');
  if (colonIdx === -1) {
    throw createError(errors.invalidNoteSyntax(noteStr));
  }
  
  const pitchPart = noteStr.slice(0, colonIdx);
  const afterColon = noteStr.slice(colonIdx + 1);
  
  // Find where durations end and modifiers begin
  // Modifiers start with @, ?, ~>, *, ^, >, etc.
  const modifierMatch = afterColon.match(/^([whq\d.+]+)(.*)/);
  if (!modifierMatch) {
    throw createError(errors.invalidNoteSyntax(noteStr));
  }
  
  const [, durationPart, modifiers] = modifierMatch;
  
  // Parse the tied durations
  const { totalBeats, durationCode } = parseTiedDurations(durationPart);
  if (totalBeats === 0) {
    throw createError(errors.invalidNoteSyntax(noteStr));
  }
  
  // Parse pitch using a simpler regex
  const pitchMatch = pitchPart.match(/^([A-Ga-g])([#b]?)(-?\d)?$/);
  if (!pitchMatch) {
    throw createError(errors.invalidNoteSyntax(noteStr));
  }
  
  const [, noteNameRaw, accidentalRaw, octaveStr] = pitchMatch;
  const noteName = noteNameRaw.toUpperCase() as NoteName;
  const accidental = (accidentalRaw || '') as Accidental;
  const octave = octaveStr ? parseInt(octaveStr, 10) : 4;
  const pitch = `${noteName}${accidental}${octave}`;
  
  // Build the result with tied duration
  const result: ParsedNote = {
    pitch,
    noteName,
    accidental,
    octave,
    duration: durationCode,
    durationBeats: totalBeats,
    dotted: false,
    articulation: '',
    tied: true,  // Mark as tied note
  };
  
  // Parse any modifiers (velocity, probability, etc.)
  if (modifiers) {
    // Velocity: @number or @dynamics
    const velocityMatch = modifiers.match(/@((?:0|1)?\.?\d+|ppp|pp|p|mp|mf|f|ff|fff)/);
    if (velocityMatch) {
      const velStr = velocityMatch[1];
      // Check if it's a dynamics marking
      const dynamicsVelocities: Record<string, number> = {
        ppp: 0.15, pp: 0.25, p: 0.4, mp: 0.55, mf: 0.7, f: 0.85, ff: 0.95, fff: 1.0
      };
      if (dynamicsVelocities[velStr]) {
        result.velocity = dynamicsVelocities[velStr];
        result.dynamics = velStr as any;
      } else {
        result.velocity = parseFloat(velStr);
      }
    }
    
    // Probability: ?number
    const probMatch = modifiers.match(/\?((?:0|1)?\.?\d+)/);
    if (probMatch) {
      result.probability = parseFloat(probMatch[1]);
    }
    
    // Articulation: *, ~, >, ^
    if (modifiers.includes('*')) result.articulation = '*';
    else if (modifiers.includes('^')) result.articulation = '^';
    else if (modifiers.includes('>')) result.articulation = '>';
    else if (modifiers.includes('~') && !modifiers.includes('~>')) result.articulation = '~';
    
    // Portamento: ~>
    if (modifiers.includes('~>')) result.portamento = true;
  }
  
  return result;
}

/**
 * Get articulation modifiers (gate and velocity) for a given articulation
 * @param articulation - Articulation marker (*, ~, >, ^, or empty)
 * @returns Modifiers for gate (duration multiplier) and velocity boost
 */
export function getArticulationModifiers(articulation: Articulation | undefined): ArticulationModifiers {
  switch (articulation) {
    case '*': // Staccato: short note
      return { ...ARTICULATION.staccato };
    case '~': // Legato: slightly longer note
      return { ...ARTICULATION.legato };
    case '>': // Accent: louder
      return { ...ARTICULATION.accent };
    case '^': // Marcato: accent + staccato
      return { ...ARTICULATION.marcato };
    default:
      return { ...ARTICULATION.normal };
  }
}

/**
 * Parse a rest string in the format "r:duration"
 * @param restStr - Rest string (e.g., "r:q", "r:h", "r:1m")
 * @param timeSignature - Optional time signature for measure-based rests (default: "4/4")
 * @returns Duration in beats
 */
export function parseRest(restStr: string, timeSignature = '4/4'): number {
  const match = restStr.trim().match(REST_REGEX);

  if (!match) {
    throw new Error(`Invalid rest format: "${restStr}". Expected format: r:{duration} (e.g., "r:q", "r:h", "r:1m")`);
  }

  const [, durationCode, dotted] = match;
  
  // v0.9.13: Check for measure-based duration
  const measureMatch = durationCode.match(/^(\d+)m$/);
  if (measureMatch) {
    const measureCount = parseInt(measureMatch[1], 10);
    if (measureCount < 1 || measureCount > 99) {
      throw new Error(`Invalid measure count ${measureCount} in "${restStr}". Must be 1-99`);
    }
    if (dotted === '.') {
      throw new Error(`Dotted measure durations are not supported in "${restStr}"`);
    }
    // Parse time signature to get beats per measure
    const tsMatch = timeSignature.match(/^(\d+)\/(\d+)$/);
    if (!tsMatch) {
      throw new Error(`Invalid time signature: "${timeSignature}"`);
    }
    const numerator = parseInt(tsMatch[1], 10);
    const denominator = parseInt(tsMatch[2], 10);
    const beatsPerMeasure = numerator * (4 / denominator);
    return measureCount * beatsPerMeasure;
  }
  
  const baseDuration = DURATION_MAP[durationCode];

  if (baseDuration === undefined) {
    throw new Error(`Invalid duration code: "${durationCode}"`);
  }

  return dotted === '.' ? baseDuration * DOTTED_MULTIPLIER : baseDuration;
}

/**
 * Check if a string is a rest notation
 */
export function isRest(str: string): boolean {
  const lower = str.trim().toLowerCase();
  return lower.startsWith('r:');
}

/**
 * Parse duration string to beats
 * @param durationStr - Duration code (e.g., "q", "h", "8", "16")
 * @param dotted - Whether the note is dotted
 * @returns Duration in beats
 */
export function parseDuration(durationStr: string, dotted = false): number {
  const baseDuration = DURATION_MAP[durationStr];

  if (baseDuration === undefined) {
    throw new Error(`Invalid duration: "${durationStr}". Valid durations: ${Object.keys(DURATION_MAP).join(', ')}`);
  }

  return dotted ? baseDuration * DOTTED_MULTIPLIER : baseDuration;
}

/**
 * Convert beats to seconds given a tempo
 * @param beats - Duration in beats
 * @param tempo - Tempo in BPM
 * @returns Duration in seconds
 */
export function beatsToSeconds(beats: number, tempo: number): number {
  return (beats / tempo) * 60;
}

/**
 * Convert a pitch string to MIDI note number
 * @param pitch - Pitch string (e.g., "C4", "F#3")
 * @returns MIDI note number (0-127)
 */
export function pitchToMidi(pitch: string): number {
  const match = pitch.match(/^([A-G])([#b]?)(-?\d+)$/);
  if (!match) {
    throw new Error(`Invalid pitch: "${pitch}"`);
  }

  const [, noteName, accidental, octaveStr] = match;
  const octave = parseInt(octaveStr, 10);

  let noteValue = NOTE_VALUES[noteName];
  if (accidental === '#') noteValue += 1;
  if (accidental === 'b') noteValue -= 1;

  // MIDI: C4 = 60 (octave + 1) * 12
  return (octave + 1) * MIDI.SEMITONES_PER_OCTAVE + noteValue;
}

/**
 * Convert MIDI note number to pitch string
 * @param midi - MIDI note number (0-127)
 * @returns Pitch string (e.g., "C4", "F#3")
 */
export function midiToPitch(midi: number): string {
  const octave = Math.floor(midi / MIDI.SEMITONES_PER_OCTAVE) - 1;
  const noteIndex = midi % MIDI.SEMITONES_PER_OCTAVE;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

/**
 * Transpose a pitch by semitones
 * @param pitch - Original pitch string
 * @param semitones - Number of semitones to transpose (positive = up, negative = down)
 * @returns Transposed pitch string
 */
export function transposePitch(pitch: string, semitones: number): string {
  const midi = pitchToMidi(pitch);
  return midiToPitch(midi + semitones);
}

/**
 * Parse multiple notes from an array of note strings
 * @param noteStrings - Array of note strings
 * @returns Array of parsed notes
 */
export function parseNotes(noteStrings: string[]): ParsedNote[] {
  return noteStrings.map(parseNote);
}

// ============================================================================
// NEW v0.8: Compact Note Syntax
// ============================================================================

/**
 * Check if a string contains compact notation (space-separated notes)
 * @param str - String to check
 * @returns true if string contains spaces (indicating compact notation)
 */
export function isCompactNotation(str: string): boolean {
  return str.trim().includes(' ') || str.includes('|');
}

/**
 * Parse compact note notation into individual note strings
 * Format: "C4:q E4:q G4:h | A4:q F4:q D4:h"
 * The pipe | is a bar separator (optional, for readability)
 *
 * @param compactStr - Space-separated note string
 * @returns Array of individual note strings
 *
 * @example
 * parseCompactNotes("C4:q E4:q G4:h") // ["C4:q", "E4:q", "G4:h"]
 * parseCompactNotes("C4:q E4:q | F4:q G4:q") // ["C4:q", "E4:q", "F4:q", "G4:q"]
 */
export function parseCompactNotes(compactStr: string): string[] {
  // Remove bar separators (they're just for readability)
  const withoutBars = compactStr.replace(/\|/g, ' ');

  // Split by whitespace and filter empty strings
  return withoutBars
    .split(/\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Expand note strings, handling both regular and compact notation
 * @param noteStrings - Array of note strings (may include compact notation)
 * @returns Array of individual note strings
 *
 * @example
 * expandNoteStrings(["C4:q", "D4:q E4:q F4:q", "G4:h"])
 * // Returns: ["C4:q", "D4:q", "E4:q", "F4:q", "G4:h"]
 */
export function expandNoteStrings(noteStrings: string[]): string[] {
  return noteStrings.flatMap(str => {
    if (isCompactNotation(str)) {
      return parseCompactNotes(str);
    }
    return [str];
  });
}

/**
 * Get dynamics velocity value
 * @param marking - Dynamics marking (pp, p, mp, mf, f, ff)
 * @returns Velocity value 0-1
 */
export function getDynamicsVelocity(marking: DynamicsMarking): number {
  return DYNAMICS[marking] ?? 0.8;
}

// ============================================================================
// NEW v0.9.2: Bracket Chord Notation
// ============================================================================

/**
 * Bracket chord notation regex
 * Format: [pitch1,pitch2,...]:duration[@velocity]
 * Examples: [C4,E4,G4]:q, [A3,C4,E4]:h@0.6, [D2,A2,D3,F#3]:w@0.4
 */
const BRACKET_CHORD_REGEX = /^\[([A-Ga-g][#b]?\d+(?:,[A-Ga-g][#b]?\d+)+)\]:(\d+|[whq])(\.?)(?:@((?:0|1)?\.?\d+|ppp|pp|p|mp|mf|f|ff|fff))?$/;

/**
 * Check if a string is bracket chord notation
 */
export function isBracketChord(str: string): boolean {
  return BRACKET_CHORD_REGEX.test(str.trim());
}

/**
 * Parsed bracket chord result
 */
export interface ParsedBracketChord {
  pitches: string[];
  duration: string;
  durationBeats: number;
  dotted: boolean;
  velocity?: number;
}

/**
 * Parse bracket chord notation
 * @param chordStr - Bracket chord string (e.g., "[C4,E4,G4]:q@0.5")
 * @returns Parsed bracket chord object
 */
export function parseBracketChord(chordStr: string): ParsedBracketChord {
  const match = chordStr.trim().match(BRACKET_CHORD_REGEX);

  if (!match) {
    throw new Error(`Invalid bracket chord format: "${chordStr}". Expected format: [pitch1,pitch2,...]:duration[@velocity] (e.g., "[C4,E4,G4]:q", "[A3,C4]:h@0.6")`);
  }

  const [, pitchesRaw, durationCode, dotted, velocityRaw] = match;

  // Parse pitches
  const pitches = pitchesRaw.split(',').map(p => {
    // Normalize pitch: uppercase note name
    const normalized = p.trim().replace(/^([a-g])/, (_, note) => note.toUpperCase());
    // Validate pitch
    if (!/^[A-G][#b]?\d+$/.test(normalized)) {
      throw new Error(`Invalid pitch "${p}" in bracket chord "${chordStr}"`);
    }
    return normalized;
  });

  // Parse duration
  const baseDuration = DURATION_MAP[durationCode];
  if (baseDuration === undefined) {
    throw new Error(`Invalid duration code: "${durationCode}" in bracket chord "${chordStr}"`);
  }

  const isDotted = dotted === '.';
  const durationBeats = isDotted ? baseDuration * DOTTED_MULTIPLIER : baseDuration;

  // Parse velocity
  let velocity: number | undefined;
  if (velocityRaw) {
    if (velocityRaw in DYNAMICS) {
      velocity = DYNAMICS[velocityRaw as DynamicsMarking];
    } else {
      velocity = parseFloat(velocityRaw);
      if (velocity < 0 || velocity > 1) {
        throw new Error(`Invalid velocity ${velocity} in "${chordStr}". Must be 0.0-1.0`);
      }
    }
  }

  return {
    pitches,
    duration: durationCode,
    durationBeats,
    dotted: isDotted,
    velocity,
  };
}

// ============================================================================
// NEW v0.9.13: Measure Duration Resolution
// ============================================================================

/**
 * Parse a time signature string into beats per measure
 * @param timeSignature - Time signature string (e.g., "4/4", "3/4", "6/8")
 * @returns Number of beats per measure (numerator value, adjusted for compound meters)
 */
export function parseTimeSignatureBeats(timeSignature: string): number {
  const match = timeSignature.match(/^(\d+)\/(\d+)$/);
  if (!match) {
    throw new Error(`Invalid time signature: "${timeSignature}". Expected format: numerator/denominator (e.g., "4/4", "3/4")`);
  }
  
  const [, numeratorStr, denominatorStr] = match;
  const numerator = parseInt(numeratorStr, 10);
  const denominator = parseInt(denominatorStr, 10);
  
  // For compound meters (6/8, 9/8, 12/8), beats are grouped
  // But for duration purposes, we count actual beats where quarter = 1
  // In 6/8: 6 eighth notes = 3 quarter note beats
  // In 4/4: 4 quarter notes = 4 quarter note beats
  
  // Convert to quarter note beats
  // denominator 4 = quarter notes, so multiply by 1
  // denominator 8 = eighth notes, so multiply by 0.5
  // denominator 2 = half notes, so multiply by 2
  const beatMultiplier = 4 / denominator;
  return numerator * beatMultiplier;
}

/**
 * Resolve a measure-based duration to actual beats
 * @param measureCount - Number of measures
 * @param timeSignature - Time signature string (e.g., "4/4", "3/4")
 * @returns Duration in beats
 * 
 * @example
 * resolveMeasureDuration(1, "4/4") // 4 beats
 * resolveMeasureDuration(1, "3/4") // 3 beats
 * resolveMeasureDuration(2, "6/8") // 6 beats (2 measures × 3 quarter-note beats per measure)
 */
export function resolveMeasureDuration(measureCount: number, timeSignature: string): number {
  const beatsPerMeasure = parseTimeSignatureBeats(timeSignature);
  return measureCount * beatsPerMeasure;
}

/**
 * Resolve measure-based durations in a parsed note
 * Creates a new ParsedNote with durationBeats calculated from the time signature
 * @param note - Parsed note (may have measureCount set)
 * @param timeSignature - Time signature string (e.g., "4/4", "3/4")
 * @returns ParsedNote with resolved durationBeats
 */
export function resolveMeasureNote(note: ParsedNote, timeSignature: string): ParsedNote {
  if (note.measureCount === undefined) {
    return note; // Not a measure-based duration, return unchanged
  }
  
  const resolvedBeats = resolveMeasureDuration(note.measureCount, timeSignature);
  return {
    ...note,
    durationBeats: resolvedBeats,
  };
}

/**
 * Check if a duration string is a measure-based duration
 * @param duration - Duration string (e.g., "q", "h", "1m", "2m")
 * @returns true if duration is measure-based
 */
export function isMeasureDuration(duration: string): boolean {
  return /^\d+m$/.test(duration);
}
