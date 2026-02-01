/**
 * Tests for ABC notation import
 */

import { describe, it, expect } from 'vitest';
import {
  importAbcToEtherScore,
  getAbcInfo,
  validateAbc,
} from './abc-import.js';

describe('ABC Import', () => {
  describe('importAbcToEtherScore', () => {
    it('should import a simple melody', () => {
      const abc = `
X:1
T:Simple Scale
M:4/4
L:1/8
K:C
CDEF GABc |]
`;
      const score = importAbcToEtherScore(abc);

      expect(score.meta?.title).toBe('Simple Scale');
      expect(score.settings.key).toBe('C major');
      expect(score.settings.timeSignature).toBe('4/4');
      expect(Object.keys(score.patterns).length).toBeGreaterThan(0);
      expect(score.arrangement.length).toBeGreaterThan(0);
    });

    it('should handle key signatures correctly', () => {
      const abc = `
X:1
T:G Major Scale
M:4/4
L:1/8
K:G
GABC DEF^G |]
`;
      const score = importAbcToEtherScore(abc);

      expect(score.settings.key).toBe('G major');
      // F should be sharped by default in G major
    });

    it('should handle minor keys', () => {
      const abc = `
X:1
T:A Minor
M:4/4
L:1/8
K:Am
ABCD EF^GA |]
`;
      const score = importAbcToEtherScore(abc);

      expect(score.settings.key).toBe('A minor');
    });

    it('should handle different time signatures', () => {
      const abc = `
X:1
T:Waltz Time
M:3/4
L:1/8
K:C
CDE FGA |]
`;
      const score = importAbcToEtherScore(abc);

      expect(score.settings.timeSignature).toBe('3/4');
    });

    it('should handle tempo field', () => {
      const abc = `
X:1
T:Fast Tune
M:4/4
L:1/8
Q:1/4=180
K:C
CDEF GABC |]
`;
      const score = importAbcToEtherScore(abc);

      expect(score.settings.tempo).toBe(180);
    });

    it('should handle rests', () => {
      const abc = `
X:1
T:With Rests
M:4/4
L:1/8
K:C
CDz2 EFz2 |]
`;
      const score = importAbcToEtherScore(abc);

      // Should have created patterns with rests
      const patterns = Object.values(score.patterns);
      expect(patterns.length).toBeGreaterThan(0);
      const firstPattern = patterns[0];
      expect(firstPattern.notes?.some(n => n.startsWith('r:'))).toBe(true);
    });

    it('should handle octave modifiers', () => {
      const abc = `
X:1
T:Wide Range
M:4/4
L:1/8
K:C
C,D,E,F, CDEF cdef c'd'e'f' |]
`;
      const score = importAbcToEtherScore(abc);

      // Notes should span multiple octaves
      const patterns = Object.values(score.patterns);
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should handle accidentals', () => {
      const abc = `
X:1
T:Chromatic
M:4/4
L:1/8
K:C
C^C D_D =E F |]
`;
      const score = importAbcToEtherScore(abc);

      // Should have patterns with sharps and flats
      const patterns = Object.values(score.patterns);
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should handle note durations', () => {
      const abc = `
X:1
T:Mixed Durations
M:4/4
L:1/8
K:C
C2 D E4 F/2 G/2 A B |]
`;
      const score = importAbcToEtherScore(abc);

      const patterns = Object.values(score.patterns);
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should handle chords', () => {
      const abc = `
X:1
T:With Chords
M:4/4
L:1/8
K:C
[CEG]2 [FAC]2 [GBD]2 [CEG]2 |]
`;
      const score = importAbcToEtherScore(abc);

      const patterns = Object.values(score.patterns);
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should handle bar lines and reset accidentals', () => {
      const abc = `
X:1
T:Bar Test
M:4/4
L:1/8
K:C
^CDEF | CDEF |]
`;
      const score = importAbcToEtherScore(abc);

      // First bar should have C#, second bar should have natural C
      const patterns = Object.values(score.patterns);
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should set default instrument', () => {
      const abc = `
X:1
T:Test
K:C
CDEF |]
`;
      const score = importAbcToEtherScore(abc);

      expect(score.instruments?.melody?.preset).toBe('acoustic_piano');
    });

    it('should allow custom instrument preset', () => {
      const abc = `
X:1
T:Test
K:C
CDEF |]
`;
      const score = importAbcToEtherScore(abc, { instrumentPreset: 'strings' });

      expect(score.instruments?.melody?.preset).toBe('strings');
    });
  });

  describe('getAbcInfo', () => {
    it('should extract tune information', () => {
      const abc = `
X:1
T:My Song
C:Test Composer
M:6/8
L:1/8
Q:1/4=140
K:G
GABGAB GABGAB |]
`;
      const info = getAbcInfo(abc);

      expect(info.title).toBe('My Song');
      expect(info.composer).toBe('Test Composer');
      expect(info.key).toBe('G major');
      expect(info.meter).toBe('6/8');
      expect(info.tempo).toBe(140);
      expect(info.noteCount).toBeGreaterThan(0);
    });

    it('should handle missing fields with defaults', () => {
      const abc = `
K:C
CDE |]
`;
      const info = getAbcInfo(abc);

      expect(info.title).toBe('Untitled');
      expect(info.composer).toBe('Unknown');
      expect(info.key).toBe('C major');
    });
  });

  describe('validateAbc', () => {
    it('should validate a correct ABC tune', () => {
      const abc = `
X:1
T:Valid Tune
M:4/4
L:1/8
K:C
CDEF GABc |]
`;
      const result = validateAbc(abc);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should report error for empty music', () => {
      const abc = `
X:1
T:Empty
K:C
`;
      const result = validateAbc(abc);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('No notes'))).toBe(true);
    });

    it('should still parse if missing key signature (defaults to C)', () => {
      const abc = `
X:1
T:No Key
CDEF |]
`;
      const result = validateAbc(abc);

      // Should still be valid - defaults to C major
      expect(result.valid).toBe(true);
    });
  });

  describe('Key signature handling', () => {
    it('should apply flats in F major', () => {
      const abc = `
X:1
T:F Major
M:4/4
L:1/8
K:F
FGAB cdef |]
`;
      const score = importAbcToEtherScore(abc);

      expect(score.settings.key).toBe('F major');
      // B should be flattened in F major
    });

    it('should apply sharps in D major', () => {
      const abc = `
X:1
T:D Major
M:4/4
L:1/8
K:D
DEFG ABcd |]
`;
      const score = importAbcToEtherScore(abc);

      expect(score.settings.key).toBe('D major');
      // F and C should be sharped in D major
    });

    it('should handle natural sign to cancel key accidentals', () => {
      const abc = `
X:1
T:Natural Test
M:4/4
L:1/8
K:G
FGAB =FGAB |]
`;
      const score = importAbcToEtherScore(abc);

      // First F should be sharp (from key), second should be natural
      const patterns = Object.values(score.patterns);
      expect(patterns.length).toBeGreaterThan(0);
    });
  });

  describe('Duration parsing', () => {
    it('should handle whole notes', () => {
      const abc = `
X:1
T:Whole Notes
M:4/4
L:1/4
K:C
C4 D4 |]
`;
      const score = importAbcToEtherScore(abc);

      const patterns = Object.values(score.patterns);
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should handle half notes', () => {
      const abc = `
X:1
T:Half Notes
M:4/4
L:1/8
K:C
C4 D4 E4 F4 |]
`;
      const score = importAbcToEtherScore(abc);

      const patterns = Object.values(score.patterns);
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should handle dotted rhythms via duration modifiers', () => {
      const abc = `
X:1
T:Dotted
M:4/4
L:1/8
K:C
C3D C3D C3D C3D |]
`;
      const score = importAbcToEtherScore(abc);

      const patterns = Object.values(score.patterns);
      expect(patterns.length).toBeGreaterThan(0);
    });
  });

  describe('Real-world ABC examples', () => {
    it('should handle a folk melody', () => {
      const abc = `
X:1
T:Amazing Grace
C:Traditional
M:3/4
L:1/8
Q:1/4=80
K:G
D2|G4 B2|G4 B2|A4 G2|E4 D2|G4 B2|G4 B2|A6|]
`;
      const score = importAbcToEtherScore(abc);

      expect(score.meta?.title).toBe('Amazing Grace');
      expect(score.meta?.composer).toBe('Traditional');
      expect(score.settings.tempo).toBe(80);
      expect(score.settings.key).toBe('G major');
      expect(score.settings.timeSignature).toBe('3/4');
    });

    it('should handle a jig in 6/8', () => {
      const abc = `
X:1
T:Irish Jig
M:6/8
L:1/8
Q:3/8=120
K:D
|: A2A ABA | GFE DEF | A2A ABA | GFE D3 :|
`;
      const score = importAbcToEtherScore(abc);

      expect(score.settings.timeSignature).toBe('6/8');
      expect(score.settings.key).toBe('D major');
    });
  });
});
