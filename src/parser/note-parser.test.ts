import { describe, it, expect } from 'vitest';
import {
  parseNote,
  parseRest,
  isRest,
  parseDuration,
  beatsToSeconds,
  pitchToMidi,
  midiToPitch,
  transposePitch,
  parseNotes,
  getArticulationModifiers,
} from './note-parser.js';

describe('parseNote', () => {
  it('parses basic notes', () => {
    const note = parseNote('C4:q');
    expect(note.pitch).toBe('C4');
    expect(note.noteName).toBe('C');
    expect(note.accidental).toBe('');
    expect(note.octave).toBe(4);
    expect(note.duration).toBe('q');
    expect(note.durationBeats).toBe(1);
    expect(note.dotted).toBe(false);
  });

  it('parses sharp notes', () => {
    const note = parseNote('F#3:h');
    expect(note.pitch).toBe('F#3');
    expect(note.noteName).toBe('F');
    expect(note.accidental).toBe('#');
    expect(note.octave).toBe(3);
    expect(note.durationBeats).toBe(2);
  });

  it('parses flat notes', () => {
    const note = parseNote('Bb5:8');
    expect(note.pitch).toBe('Bb5');
    expect(note.noteName).toBe('B');
    expect(note.accidental).toBe('b');
    expect(note.octave).toBe(5);
    expect(note.durationBeats).toBe(0.5);
  });

  it('parses dotted notes', () => {
    const note = parseNote('A4:h.');
    expect(note.durationBeats).toBe(3); // 2 * 1.5
    expect(note.dotted).toBe(true);
  });

  it('parses whole notes', () => {
    const note = parseNote('D3:w');
    expect(note.durationBeats).toBe(4);
  });

  it('parses sixteenth notes', () => {
    const note = parseNote('E4:16');
    expect(note.durationBeats).toBe(0.25);
  });

  it('handles lowercase note names', () => {
    const note = parseNote('c4:q');
    expect(note.noteName).toBe('C');
    expect(note.pitch).toBe('C4');
  });

  it('defaults octave to 4 when not specified', () => {
    const note = parseNote('G:q');
    expect(note.octave).toBe(4);
    expect(note.pitch).toBe('G4');
  });

  it('throws on invalid format', () => {
    expect(() => parseNote('invalid')).toThrow();
    expect(() => parseNote('C4')).toThrow(); // missing duration
    expect(() => parseNote(':q')).toThrow(); // missing note
  });
});

describe('parseRest', () => {
  it('parses quarter rest', () => {
    expect(parseRest('r:q')).toBe(1);
  });

  it('parses half rest', () => {
    expect(parseRest('r:h')).toBe(2);
  });

  it('parses dotted rest', () => {
    expect(parseRest('r:h.')).toBe(3);
  });

  it('throws on invalid format', () => {
    expect(() => parseRest('x:q')).toThrow();
  });
});

describe('isRest', () => {
  it('identifies rests', () => {
    expect(isRest('r:q')).toBe(true);
    expect(isRest('r:h')).toBe(true);
  });

  it('identifies non-rests', () => {
    expect(isRest('C4:q')).toBe(false);
    expect(isRest('rest')).toBe(false);
  });
});

describe('parseDuration', () => {
  it('parses all durations correctly', () => {
    expect(parseDuration('w')).toBe(4);
    expect(parseDuration('h')).toBe(2);
    expect(parseDuration('q')).toBe(1);
    expect(parseDuration('8')).toBe(0.5);
    expect(parseDuration('16')).toBe(0.25);
    expect(parseDuration('32')).toBe(0.125);
  });

  it('handles dotted durations', () => {
    expect(parseDuration('q', true)).toBe(1.5);
    expect(parseDuration('h', true)).toBe(3);
  });
});

describe('beatsToSeconds', () => {
  it('converts at 120 BPM', () => {
    expect(beatsToSeconds(1, 120)).toBe(0.5);
    expect(beatsToSeconds(4, 120)).toBe(2);
  });

  it('converts at 60 BPM', () => {
    expect(beatsToSeconds(1, 60)).toBe(1);
    expect(beatsToSeconds(2, 60)).toBe(2);
  });
});

describe('pitchToMidi', () => {
  it('converts standard pitches', () => {
    expect(pitchToMidi('C4')).toBe(60);
    expect(pitchToMidi('A4')).toBe(69);
    expect(pitchToMidi('C5')).toBe(72);
  });

  it('handles sharps', () => {
    expect(pitchToMidi('C#4')).toBe(61);
    expect(pitchToMidi('F#3')).toBe(54);
  });

  it('handles flats', () => {
    expect(pitchToMidi('Bb4')).toBe(70);
    expect(pitchToMidi('Eb3')).toBe(51);
  });

  it('handles low octaves', () => {
    expect(pitchToMidi('C2')).toBe(36);
    expect(pitchToMidi('C1')).toBe(24);
  });
});

describe('midiToPitch', () => {
  it('converts MIDI to pitch', () => {
    expect(midiToPitch(60)).toBe('C4');
    expect(midiToPitch(69)).toBe('A4');
    expect(midiToPitch(72)).toBe('C5');
  });

  it('uses sharps for accidentals', () => {
    expect(midiToPitch(61)).toBe('C#4');
    expect(midiToPitch(70)).toBe('A#4');
  });
});

describe('transposePitch', () => {
  it('transposes up', () => {
    expect(transposePitch('C4', 2)).toBe('D4');
    expect(transposePitch('C4', 12)).toBe('C5');
  });

  it('transposes down', () => {
    expect(transposePitch('C4', -2)).toBe('A#3');
    expect(transposePitch('C4', -12)).toBe('C3');
  });

  it('handles accidentals', () => {
    expect(transposePitch('F#3', 1)).toBe('G3');
    expect(transposePitch('Bb4', -1)).toBe('A4');
  });
});

describe('parseNotes', () => {
  it('parses array of notes', () => {
    const notes = parseNotes(['C4:q', 'E4:q', 'G4:h']);
    expect(notes).toHaveLength(3);
    expect(notes[0].pitch).toBe('C4');
    expect(notes[1].pitch).toBe('E4');
    expect(notes[2].pitch).toBe('G4');
    expect(notes[2].durationBeats).toBe(2);
  });
});

describe('articulation (v0.3)', () => {
  it('parses staccato notes', () => {
    const note = parseNote('C4:q*');
    expect(note.pitch).toBe('C4');
    expect(note.durationBeats).toBe(1);
    expect(note.articulation).toBe('*');
  });

  it('parses legato notes', () => {
    const note = parseNote('D4:h~');
    expect(note.pitch).toBe('D4');
    expect(note.durationBeats).toBe(2);
    expect(note.articulation).toBe('~');
  });

  it('parses accent notes', () => {
    const note = parseNote('E4:8>');
    expect(note.pitch).toBe('E4');
    expect(note.durationBeats).toBe(0.5);
    expect(note.articulation).toBe('>');
  });

  it('parses marcato notes', () => {
    const note = parseNote('F#3:q^');
    expect(note.pitch).toBe('F#3');
    expect(note.durationBeats).toBe(1);
    expect(note.articulation).toBe('^');
  });

  it('parses dotted notes with articulation', () => {
    const note = parseNote('A4:h.*');
    expect(note.durationBeats).toBe(3);
    expect(note.dotted).toBe(true);
    expect(note.articulation).toBe('*');
  });

  it('defaults to empty articulation', () => {
    const note = parseNote('C4:q');
    expect(note.articulation).toBe('');
  });
});

describe('getArticulationModifiers', () => {
  it('returns staccato modifiers', () => {
    const mods = getArticulationModifiers('*');
    expect(mods.gate).toBe(0.3);
    expect(mods.velocityBoost).toBe(0);
  });

  it('returns legato modifiers', () => {
    const mods = getArticulationModifiers('~');
    expect(mods.gate).toBe(1.1);
    expect(mods.velocityBoost).toBe(0);
  });

  it('returns accent modifiers', () => {
    const mods = getArticulationModifiers('>');
    expect(mods.gate).toBe(1.0);
    expect(mods.velocityBoost).toBe(0.2);
  });

  it('returns marcato modifiers', () => {
    const mods = getArticulationModifiers('^');
    expect(mods.gate).toBe(0.3);
    expect(mods.velocityBoost).toBe(0.2);
  });

  it('returns default modifiers for no articulation', () => {
    const mods = getArticulationModifiers(undefined);
    expect(mods.gate).toBe(1.0);
    expect(mods.velocityBoost).toBe(0);
  });

  it('returns default modifiers for empty string', () => {
    const mods = getArticulationModifiers('');
    expect(mods.gate).toBe(1.0);
    expect(mods.velocityBoost).toBe(0);
  });
});

describe('v0.4 expression syntax', () => {
  describe('per-note velocity (@)', () => {
    it('parses velocity suffix', () => {
      const note = parseNote('C4:q@0.8');
      expect(note.pitch).toBe('C4');
      expect(note.durationBeats).toBe(1);
      expect(note.velocity).toBe(0.8);
    });

    it('parses velocity of 0', () => {
      const note = parseNote('D4:h@0');
      expect(note.velocity).toBe(0);
    });

    it('parses velocity of 1', () => {
      const note = parseNote('E4:8@1');
      expect(note.velocity).toBe(1);
    });

    it('parses decimal velocities', () => {
      expect(parseNote('C4:q@0.5').velocity).toBe(0.5);
      expect(parseNote('C4:q@.7').velocity).toBe(0.7);
      expect(parseNote('C4:q@1.0').velocity).toBe(1.0);
    });

    it('throws on invalid velocity', () => {
      expect(() => parseNote('C4:q@1.5')).toThrow('Invalid velocity');
      expect(() => parseNote('C4:q@-0.5')).toThrow();
    });

    it('returns undefined when no velocity specified', () => {
      const note = parseNote('C4:q');
      expect(note.velocity).toBeUndefined();
    });
  });

  describe('probability (?)', () => {
    it('parses probability suffix', () => {
      const note = parseNote('C4:q?0.7');
      expect(note.pitch).toBe('C4');
      expect(note.probability).toBe(0.7);
    });

    it('parses probability of 0', () => {
      const note = parseNote('D4:h?0');
      expect(note.probability).toBe(0);
    });

    it('parses probability of 1', () => {
      const note = parseNote('E4:8?1');
      expect(note.probability).toBe(1);
    });

    it('throws on invalid probability', () => {
      expect(() => parseNote('C4:q?1.5')).toThrow('Invalid probability');
    });

    it('returns undefined when no probability specified', () => {
      const note = parseNote('C4:q');
      expect(note.probability).toBeUndefined();
    });
  });

  describe('timing offset (+/-ms)', () => {
    it('parses positive timing offset', () => {
      const note = parseNote('C4:q+10ms');
      expect(note.timingOffset).toBe(10);
    });

    it('parses negative timing offset', () => {
      const note = parseNote('D4:h-5ms');
      expect(note.timingOffset).toBe(-5);
    });

    it('parses zero timing offset', () => {
      const note = parseNote('E4:8+0ms');
      expect(note.timingOffset).toBe(0);
    });

    it('returns undefined when no timing specified', () => {
      const note = parseNote('C4:q');
      expect(note.timingOffset).toBeUndefined();
    });
  });

  describe('portamento (~>)', () => {
    it('parses portamento marker', () => {
      const note = parseNote('C4:q~>');
      expect(note.pitch).toBe('C4');
      expect(note.portamento).toBe(true);
    });

    it('does not confuse legato with portamento', () => {
      const legato = parseNote('C4:q~');
      expect(legato.articulation).toBe('~');
      expect(legato.portamento).toBeUndefined();

      const portamento = parseNote('C4:q~>');
      expect(portamento.articulation).toBe('');
      expect(portamento.portamento).toBe(true);
    });

    it('returns undefined when no portamento specified', () => {
      const note = parseNote('C4:q');
      expect(note.portamento).toBeUndefined();
    });
  });

  describe('sustain pedal (v0.9.4)', () => {
    it('parses :ped suffix for sustain pedal', () => {
      const note = parseNote('C4:q:ped');
      expect(note.pitch).toBe('C4');
      expect(note.durationBeats).toBe(1);
      expect(note.pedal).toBe(true);
    });

    it('parses pedal with velocity', () => {
      const note = parseNote('E4:h@0.8:ped');
      expect(note.velocity).toBe(0.8);
      expect(note.pedal).toBe(true);
    });

    it('parses pedal with all other modifiers', () => {
      const note = parseNote('G4:q*@0.9?0.5:ped');
      expect(note.articulation).toBe('*');
      expect(note.velocity).toBe(0.9);
      expect(note.probability).toBe(0.5);
      expect(note.pedal).toBe(true);
    });

    it('returns undefined when no pedal specified', () => {
      const note = parseNote('C4:q');
      expect(note.pedal).toBeUndefined();
    });
  });

  describe('combined modifiers', () => {
    it('parses velocity with articulation', () => {
      const note = parseNote('C4:q*@0.9');
      expect(note.articulation).toBe('*');
      expect(note.velocity).toBe(0.9);
    });

    it('parses velocity and probability', () => {
      const note = parseNote('D4:h@0.8?0.5');
      expect(note.velocity).toBe(0.8);
      expect(note.probability).toBe(0.5);
    });

    it('parses velocity and timing', () => {
      const note = parseNote('E4:8@0.7+15ms');
      expect(note.velocity).toBe(0.7);
      expect(note.timingOffset).toBe(15);
    });

    it('parses all modifiers together', () => {
      const note = parseNote('F#4:q.>@0.9-10ms?0.8');
      expect(note.pitch).toBe('F#4');
      expect(note.dotted).toBe(true);
      expect(note.articulation).toBe('>');
      expect(note.velocity).toBe(0.9);
      expect(note.timingOffset).toBe(-10);
      expect(note.probability).toBe(0.8);
    });

    it('parses portamento with velocity', () => {
      const note = parseNote('G4:h~>@0.6');
      expect(note.portamento).toBe(true);
      expect(note.velocity).toBe(0.6);
    });

    it('parses dotted note with all v0.4 modifiers', () => {
      const note = parseNote('A4:q.*@0.85+5ms?0.9');
      expect(note.dotted).toBe(true);
      expect(note.durationBeats).toBe(1.5);
      expect(note.articulation).toBe('*');
      expect(note.velocity).toBe(0.85);
      expect(note.timingOffset).toBe(5);
      expect(note.probability).toBe(0.9);
    });
  });
});

// ============================================================================
// v0.9.2: Bracket Chord Notation Tests
// ============================================================================

import { isBracketChord, parseBracketChord } from './note-parser.js';

describe('Bracket Chord Notation (v0.9.2)', () => {
  describe('isBracketChord', () => {
    it('identifies bracket chord notation', () => {
      expect(isBracketChord('[C4,E4,G4]:q')).toBe(true);
      expect(isBracketChord('[A3,C4]:h')).toBe(true);
      expect(isBracketChord('[D2,A2,D3,F#3]:w@0.5')).toBe(true);
    });

    it('rejects non-bracket notation', () => {
      expect(isBracketChord('C4:q')).toBe(false);
      expect(isBracketChord('Cmaj7:w')).toBe(false);
      expect(isBracketChord('r:q')).toBe(false);
    });

    it('rejects malformed bracket notation', () => {
      expect(isBracketChord('[C4]:q')).toBe(false); // Single note
      expect(isBracketChord('[C4,E4,G4]')).toBe(false); // No duration
      expect(isBracketChord('C4,E4,G4:q')).toBe(false); // No brackets
    });
  });

  describe('parseBracketChord', () => {
    it('parses basic bracket chord', () => {
      const chord = parseBracketChord('[C4,E4,G4]:q');
      expect(chord.pitches).toEqual(['C4', 'E4', 'G4']);
      expect(chord.duration).toBe('q');
      expect(chord.durationBeats).toBe(1);
      expect(chord.dotted).toBe(false);
      expect(chord.velocity).toBeUndefined();
    });

    it('parses bracket chord with velocity', () => {
      const chord = parseBracketChord('[A3,C4,E4]:h@0.6');
      expect(chord.pitches).toEqual(['A3', 'C4', 'E4']);
      expect(chord.duration).toBe('h');
      expect(chord.durationBeats).toBe(2);
      expect(chord.velocity).toBe(0.6);
    });

    it('parses bracket chord with dotted duration', () => {
      const chord = parseBracketChord('[D4,F#4]:q.');
      expect(chord.pitches).toEqual(['D4', 'F#4']);
      expect(chord.duration).toBe('q');
      expect(chord.durationBeats).toBe(1.5);
      expect(chord.dotted).toBe(true);
    });

    it('parses bracket chord with sharps and flats', () => {
      const chord = parseBracketChord('[Bb3,D4,F#4]:w');
      expect(chord.pitches).toEqual(['Bb3', 'D4', 'F#4']);
      expect(chord.durationBeats).toBe(4);
    });

    it('parses bracket chord with dynamics marking', () => {
      const chord = parseBracketChord('[C4,E4]:q@mf');
      expect(chord.pitches).toEqual(['C4', 'E4']);
      expect(chord.velocity).toBeCloseTo(0.7, 1);
    });

    it('normalizes lowercase pitch names', () => {
      const chord = parseBracketChord('[c4,e4,g4]:q');
      expect(chord.pitches).toEqual(['C4', 'E4', 'G4']);
    });

    it('throws on invalid bracket chord format', () => {
      expect(() => parseBracketChord('[C4]:q')).toThrow();
      expect(() => parseBracketChord('[C4,E4,G4]')).toThrow();
      expect(() => parseBracketChord('C4,E4:q')).toThrow();
    });

    it('throws on invalid velocity', () => {
      expect(() => parseBracketChord('[C4,E4]:q@1.5')).toThrow();
    });
  });
});

// ============================================================================
// v0.9.13: Measure Duration Notation Tests
// ============================================================================

import { 
  resolveMeasureDuration, 
  parseTimeSignatureBeats, 
  resolveMeasureNote,
  isMeasureDuration 
} from './note-parser.js';

describe('Measure Duration Notation (v0.9.13)', () => {
  describe('parseNote with measure durations', () => {
    it('parses one measure duration (C4:1m)', () => {
      const note = parseNote('C4:1m');
      expect(note.pitch).toBe('C4');
      expect(note.duration).toBe('1m');
      expect(note.measureCount).toBe(1);
      // Default assumes 4/4 time = 4 beats
      expect(note.durationBeats).toBe(4);
    });

    it('parses two measure duration (C4:2m)', () => {
      const note = parseNote('C4:2m');
      expect(note.pitch).toBe('C4');
      expect(note.duration).toBe('2m');
      expect(note.measureCount).toBe(2);
      expect(note.durationBeats).toBe(8); // 2 measures × 4 beats in 4/4
    });

    it('parses multi-measure duration (D4:4m)', () => {
      const note = parseNote('D4:4m');
      expect(note.measureCount).toBe(4);
      expect(note.durationBeats).toBe(16); // 4 measures × 4 beats
    });

    it('parses measure duration with velocity', () => {
      const note = parseNote('E4:1m@0.7');
      expect(note.measureCount).toBe(1);
      expect(note.velocity).toBe(0.7);
    });

    it('parses measure duration with articulation', () => {
      const note = parseNote('F4:1m*');
      expect(note.measureCount).toBe(1);
      expect(note.articulation).toBe('*');
    });

    it('parses measure duration with probability', () => {
      const note = parseNote('G4:1m?0.5');
      expect(note.measureCount).toBe(1);
      expect(note.probability).toBe(0.5);
    });

    it('parses measure duration with pedal', () => {
      const note = parseNote('A4:1m:ped');
      expect(note.measureCount).toBe(1);
      expect(note.pedal).toBe(true);
    });

    it('parses measure duration with all modifiers', () => {
      const note = parseNote('B4:2m*@0.8?0.9:ped');
      expect(note.measureCount).toBe(2);
      expect(note.articulation).toBe('*');
      expect(note.velocity).toBe(0.8);
      expect(note.probability).toBe(0.9);
      expect(note.pedal).toBe(true);
    });

    it('throws on dotted measure duration', () => {
      expect(() => parseNote('C4:1m.')).toThrow('Dotted measure durations are not supported');
    });

    it('throws on tuplet measure duration', () => {
      expect(() => parseNote('C4:1mt3')).toThrow('Tuplet measure durations are not supported');
    });

    it('throws on invalid measure count', () => {
      expect(() => parseNote('C4:0m')).toThrow();
      expect(() => parseNote('C4:100m')).toThrow('Must be 1-99');
    });

    it('returns undefined measureCount for standard durations', () => {
      const note = parseNote('C4:q');
      expect(note.measureCount).toBeUndefined();
    });
  });

  describe('parseRest with measure durations', () => {
    it('parses one measure rest in 4/4', () => {
      const beats = parseRest('r:1m', '4/4');
      expect(beats).toBe(4);
    });

    it('parses one measure rest in 3/4', () => {
      const beats = parseRest('r:1m', '3/4');
      expect(beats).toBe(3);
    });

    it('parses two measure rest in 4/4', () => {
      const beats = parseRest('r:2m', '4/4');
      expect(beats).toBe(8);
    });

    it('parses measure rest in 6/8', () => {
      const beats = parseRest('r:1m', '6/8');
      expect(beats).toBe(3); // 6 eighth notes = 3 quarter note beats
    });

    it('defaults to 4/4 when time signature not provided', () => {
      const beats = parseRest('r:1m');
      expect(beats).toBe(4);
    });

    it('throws on dotted measure rest', () => {
      expect(() => parseRest('r:1m.')).toThrow('Dotted measure durations are not supported');
    });
  });

  describe('parseTimeSignatureBeats', () => {
    it('parses 4/4 time', () => {
      expect(parseTimeSignatureBeats('4/4')).toBe(4);
    });

    it('parses 3/4 time', () => {
      expect(parseTimeSignatureBeats('3/4')).toBe(3);
    });

    it('parses 6/8 time', () => {
      expect(parseTimeSignatureBeats('6/8')).toBe(3); // 6 eighths = 3 quarters
    });

    it('parses 2/4 time', () => {
      expect(parseTimeSignatureBeats('2/4')).toBe(2);
    });

    it('parses 5/4 time', () => {
      expect(parseTimeSignatureBeats('5/4')).toBe(5);
    });

    it('parses 7/8 time', () => {
      expect(parseTimeSignatureBeats('7/8')).toBe(3.5); // 7 eighths = 3.5 quarters
    });

    it('parses 2/2 time (cut time)', () => {
      expect(parseTimeSignatureBeats('2/2')).toBe(4); // 2 half notes = 4 quarter note beats
    });

    it('throws on invalid time signature', () => {
      expect(() => parseTimeSignatureBeats('invalid')).toThrow('Invalid time signature');
      expect(() => parseTimeSignatureBeats('4')).toThrow('Invalid time signature');
    });
  });

  describe('resolveMeasureDuration', () => {
    it('resolves 1 measure in 4/4 to 4 beats', () => {
      expect(resolveMeasureDuration(1, '4/4')).toBe(4);
    });

    it('resolves 1 measure in 3/4 to 3 beats', () => {
      expect(resolveMeasureDuration(1, '3/4')).toBe(3);
    });

    it('resolves 2 measures in 4/4 to 8 beats', () => {
      expect(resolveMeasureDuration(2, '4/4')).toBe(8);
    });

    it('resolves 2 measures in 6/8 to 6 beats', () => {
      expect(resolveMeasureDuration(2, '6/8')).toBe(6); // 2 × 3 quarter note beats
    });
  });

  describe('resolveMeasureNote', () => {
    it('resolves measure duration to actual beats', () => {
      const note = parseNote('C4:1m');
      const resolved = resolveMeasureNote(note, '3/4');
      expect(resolved.durationBeats).toBe(3);
      expect(resolved.measureCount).toBe(1); // Original measureCount preserved
    });

    it('returns unchanged note for standard durations', () => {
      const note = parseNote('C4:q');
      const resolved = resolveMeasureNote(note, '3/4');
      expect(resolved.durationBeats).toBe(1);
      expect(resolved).toEqual(note);
    });

    it('resolves multi-measure in 5/4', () => {
      const note = parseNote('D4:2m');
      const resolved = resolveMeasureNote(note, '5/4');
      expect(resolved.durationBeats).toBe(10); // 2 measures × 5 beats
    });
  });

  describe('isMeasureDuration', () => {
    it('identifies measure durations', () => {
      expect(isMeasureDuration('1m')).toBe(true);
      expect(isMeasureDuration('2m')).toBe(true);
      expect(isMeasureDuration('10m')).toBe(true);
    });

    it('rejects non-measure durations', () => {
      expect(isMeasureDuration('q')).toBe(false);
      expect(isMeasureDuration('h')).toBe(false);
      expect(isMeasureDuration('8')).toBe(false);
      expect(isMeasureDuration('m')).toBe(false); // Just 'm' without number
      expect(isMeasureDuration('1')).toBe(false); // Just number without 'm'
    });
  });

});

// ============================================================================
// v0.9.15: Plus Chord (Dyad/Cluster) Notation Tests
// ============================================================================

import { isPlusChord, parsePlusChord } from './note-parser.js';

describe('Plus Chord (Dyad/Cluster) Notation (v0.9.15)', () => {
  describe('isPlusChord', () => {
    it('identifies plus chord notation', () => {
      expect(isPlusChord('C4+E4:q')).toBe(true);
      expect(isPlusChord('D3+A3:w')).toBe(true);
      expect(isPlusChord('C4+E4+G4:h')).toBe(true);
      expect(isPlusChord('A3+C4+E4+G4:q')).toBe(true);
    });

    it('identifies plus chords with velocity', () => {
      expect(isPlusChord('C4+E4:q@0.5')).toBe(true);
      expect(isPlusChord('D3+A3:h@mf')).toBe(true);
    });

    it('identifies plus chords with articulation', () => {
      expect(isPlusChord('C4+E4:q*')).toBe(true);
      expect(isPlusChord('D3+A3:h~')).toBe(true);
      expect(isPlusChord('E4+G4:q>')).toBe(true);
    });

    it('identifies plus chords with probability', () => {
      expect(isPlusChord('C4+E4:q?0.7')).toBe(true);
    });

    it('identifies plus chords with dotted duration', () => {
      expect(isPlusChord('C4+E4:q.')).toBe(true);
      expect(isPlusChord('D3+A3:h.')).toBe(true);
    });

    it('rejects single notes', () => {
      expect(isPlusChord('C4:q')).toBe(false);
      expect(isPlusChord('D3:w')).toBe(false);
    });

    it('rejects bracket chords', () => {
      expect(isPlusChord('[C4,E4]:q')).toBe(false);
    });

    it('rejects notes without pitch separator', () => {
      expect(isPlusChord('C4E4:q')).toBe(false);
    });
  });

  describe('parsePlusChord', () => {
    it('parses a simple dyad', () => {
      const chord = parsePlusChord('C4+E4:q');
      expect(chord.pitches).toEqual(['C4', 'E4']);
      expect(chord.durationBeats).toBe(1);
      expect(chord.dotted).toBe(false);
    });

    it('parses a triad (3 notes)', () => {
      const chord = parsePlusChord('C4+E4+G4:h');
      expect(chord.pitches).toEqual(['C4', 'E4', 'G4']);
      expect(chord.durationBeats).toBe(2);
    });

    it('parses a cluster (4+ notes)', () => {
      const chord = parsePlusChord('A3+C4+E4+G4:w');
      expect(chord.pitches).toEqual(['A3', 'C4', 'E4', 'G4']);
      expect(chord.durationBeats).toBe(4);
    });

    it('parses whole note duration', () => {
      const chord = parsePlusChord('D3+A3:w');
      expect(chord.durationBeats).toBe(4);
    });

    it('parses eighth note duration', () => {
      const chord = parsePlusChord('C4+G4:8');
      expect(chord.durationBeats).toBe(0.5);
    });

    it('parses dotted duration', () => {
      const chord = parsePlusChord('C4+E4:q.');
      expect(chord.durationBeats).toBe(1.5);
      expect(chord.dotted).toBe(true);
    });

    it('parses numeric velocity', () => {
      const chord = parsePlusChord('C4+E4:q@0.6');
      expect(chord.velocity).toBe(0.6);
    });

    it('parses dynamics velocity', () => {
      const chord = parsePlusChord('C4+E4:h@mf');
      expect(chord.velocity).toBe(0.65); // mf = mezzo-forte
    });

    it('parses staccato articulation', () => {
      const chord = parsePlusChord('C4+E4:q*');
      expect(chord.articulation).toBe('*');
    });

    it('parses legato articulation', () => {
      const chord = parsePlusChord('C4+E4:q~');
      expect(chord.articulation).toBe('~');
    });

    it('parses accent articulation', () => {
      const chord = parsePlusChord('C4+E4:q>');
      expect(chord.articulation).toBe('>');
    });

    it('parses portamento', () => {
      const chord = parsePlusChord('C4+E4:q~>');
      expect(chord.portamento).toBe(true);
    });

    it('parses probability', () => {
      const chord = parsePlusChord('C4+E4:q?0.7');
      expect(chord.probability).toBe(0.7);
    });

    it('parses combined modifiers', () => {
      const chord = parsePlusChord('C4+E4+G4:h@0.8*?0.5');
      expect(chord.pitches).toEqual(['C4', 'E4', 'G4']);
      expect(chord.durationBeats).toBe(2);
      expect(chord.velocity).toBe(0.8);
      expect(chord.articulation).toBe('*');
      expect(chord.probability).toBe(0.5);
    });

    it('normalizes lowercase note names', () => {
      const chord = parsePlusChord('c4+e4:q');
      expect(chord.pitches).toEqual(['C4', 'E4']);
    });

    it('handles accidentals', () => {
      const chord = parsePlusChord('C#4+Eb4+G4:h');
      expect(chord.pitches).toEqual(['C#4', 'Eb4', 'G4']);
    });

    it('handles various octaves', () => {
      const chord = parsePlusChord('C2+E5:w');
      expect(chord.pitches).toEqual(['C2', 'E5']);
    });

    it('throws on single pitch', () => {
      expect(() => parsePlusChord('C4:q')).toThrow();
    });

    it('throws on invalid velocity', () => {
      expect(() => parsePlusChord('C4+E4:q@1.5')).toThrow('Invalid velocity');
    });

    it('throws on invalid probability', () => {
      expect(() => parsePlusChord('C4+E4:q?1.5')).toThrow('Invalid probability');
    });

    it('throws on invalid pitch', () => {
      expect(() => parsePlusChord('X4+E4:q')).toThrow('Invalid plus chord format');
    });
  });
});
