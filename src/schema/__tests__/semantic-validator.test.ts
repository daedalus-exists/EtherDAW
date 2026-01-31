import { describe, it, expect } from 'vitest';
import type { EtherScore } from '../types.js';
import { validateSemantic } from '../semantic-validator.js';

function buildBaseScore(): EtherScore {
  return {
    settings: { tempo: 120 },
    instruments: {
      lead: { preset: 'sine' },
    },
    patterns: {
      motif: { notes: ['C4:q'] },
    },
    sections: {
      intro: {
        tracks: {
          lead: { pattern: 'motif' },
        },
      },
    },
    arrangement: ['intro'],
  };
}

describe('semantic validator', () => {
  it('detects a valid preset', () => {
    const result = validateSemantic(buildBaseScore());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('flags invalid presets with suggestions', () => {
    const score = buildBaseScore();
    score.instruments = {
      lead: { preset: 'sinee' },
    };

    const result = validateSemantic(score);
    expect(result.valid).toBe(false);

    const presetError = result.errors.find((err) => err.code === 'E004');
    expect(presetError).toBeTruthy();
    expect(presetError?.help).toContain('Did you mean');
    expect(presetError?.help).toContain('sine');
  });

  it('accepts tied durations like C4:w+h', () => {
    const score = buildBaseScore();
    score.patterns = {
      motif: { notes: ['C4:w+h'] },
    };

    const result = validateSemantic(score);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects invalid durations', () => {
    const score = buildBaseScore();
    score.patterns = {
      motif: { notes: ['C4:64'] },
    };

    const result = validateSemantic(score);
    expect(result.valid).toBe(false);

    const durationError = result.errors.find((err) => err.code === 'E001');
    expect(durationError).toBeTruthy();
    expect(durationError?.message).toContain('unknown duration');
  });

  it('validates velocity ranges', () => {
    const score = buildBaseScore();
    score.patterns = {
      motif: { notes: ['C4:q@1.2'] },
    };

    const result = validateSemantic(score);
    expect(result.valid).toBe(false);

    const velocityError = result.errors.find((err) => err.code === 'E011');
    expect(velocityError).toBeTruthy();
  });

  it('validates pattern and section references', () => {
    const score = buildBaseScore();
    score.sections = {
      intro: {
        tracks: {
          lead: { pattern: 'missing' },
        },
      },
    };
    score.arrangement = ['intro', 'chorus'];

    const result = validateSemantic(score);
    expect(result.valid).toBe(false);

    const patternError = result.errors.find((err) => err.code === 'E007');
    const sectionError = result.errors.find((err) => err.code === 'E008');
    expect(patternError).toBeTruthy();
    expect(sectionError).toBeTruthy();
  });
});
