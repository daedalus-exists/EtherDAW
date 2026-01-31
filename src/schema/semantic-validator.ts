/**
 * Semantic Validator (v0.9.12)
 * 
 * Deep validation of EtherScore beyond JSON schema.
 * Catches musical/semantic errors that the schema can't express.
 * 
 * Goals:
 * - Catch errors early (at validate time, not export time)
 * - Provide helpful suggestions
 * - Validate all patterns, not just the first error
 */

import type { EtherScore, Pattern, DrumPattern } from './types.js';
import { parseNote, parseRest } from '../parser/note-parser.js';
import { parseChord } from '../parser/chord-parser.js';
import { errors, formatError, findSimilar, formatSuggestion, VALID_DURATIONS, DRUM_NAMES } from '../errors/messages.js';
import { getAllPresetNames } from '../synthesis/presets.js';

export interface SemanticError {
  code: string;
  path: string;
  message: string;
  help?: string;
  docs?: string;
}

export interface SemanticValidationResult {
  valid: boolean;
  errors: SemanticError[];
  warnings: SemanticError[];
}

// Get list of available preset names (lazily evaluated)
let _presetNames: string[] | null = null;
function getPresetNames(): string[] {
  if (_presetNames === null) {
    _presetNames = getAllPresetNames();
  }
  return _presetNames;
}

/**
 * Validate a single note string
 */
function validateNoteString(note: string, path: string): SemanticError | null {
  const trimmed = note.trim();
  
  // Skip empty
  if (!trimmed) return null;
  
  // Check for rest
  if (trimmed.toLowerCase().startsWith('r:')) {
    try {
      parseRest(trimmed);
      return null;
    } catch (e: any) {
      return {
        code: 'E003',
        path,
        message: e.message || `Invalid rest: '${trimmed}'`,
        help: 'Rest format: r:<duration>. Examples: r:q (quarter rest), r:h (half rest)',
        docs: 'docs/ETHERSCORE_FORMAT.md#notes'
      };
    }
  }
  
  // Check for simultaneous notes (space-separated)
  if (trimmed.includes(' ')) {
    const parts = trimmed.split(/\s+/);
    for (let i = 0; i < parts.length; i++) {
      const err = validateNoteString(parts[i], `${path}[${i}]`);
      if (err) return err;
    }
    return null;
  }
  
  // Parse note
  try {
    parseNote(trimmed);
    return null;
  } catch (e: any) {
    return {
      code: e.code || 'E003',
      path,
      message: e.message || `Invalid note: '${trimmed}'`,
      help: e.help || 'Note format: <pitch>:<duration>. Examples: C4:q, F#5:h, Bb3:8',
      docs: e.docs || 'docs/ETHERSCORE_FORMAT.md#notes'
    };
  }
}

/**
 * Validate a chord string
 */
function validateChordString(chord: string, path: string): SemanticError | null {
  const trimmed = chord.trim();
  if (!trimmed) return null;
  
  try {
    parseChord(trimmed);
    return null;
  } catch (e: any) {
    return {
      code: e.code || 'E005',
      path,
      message: e.message || `Invalid chord: '${trimmed}'`,
      help: e.help || 'Chord format: <root>[quality][:<duration>]. Examples: C, Am7, Dm:h',
      docs: e.docs || 'docs/ETHERSCORE_FORMAT.md#chords'
    };
  }
}

/**
 * Validate notes array in a pattern
 */
function validateNotesPattern(notes: string[], patternPath: string): SemanticError[] {
  const errors: SemanticError[] = [];
  
  for (let i = 0; i < notes.length; i++) {
    const err = validateNoteString(notes[i], `${patternPath}/notes/${i}`);
    if (err) errors.push(err);
  }
  
  return errors;
}

/**
 * Validate chords array in a pattern
 */
function validateChordsPattern(chords: string[], patternPath: string): SemanticError[] {
  const errors: SemanticError[] = [];
  
  for (let i = 0; i < chords.length; i++) {
    const err = validateChordString(chords[i], `${patternPath}/chords/${i}`);
    if (err) errors.push(err);
  }
  
  return errors;
}

/**
 * Validate drum pattern
 */
function validateDrumPattern(drums: DrumPattern, patternPath: string): SemanticError[] {
  const errors: SemanticError[] = [];
  
  // Validate kit name
  const validKits = ['808', '909', 'acoustic', 'lofi', 'world'];
  if (drums.kit && !validKits.includes(drums.kit)) {
    const similar = findSimilar(drums.kit, validKits);
    errors.push({
      code: 'E020',
      path: `${patternPath}/drums/kit`,
      message: `Unknown drum kit: '${drums.kit}'`,
      help: similar.length > 0 ? formatSuggestion(similar) : `Available kits: ${validKits.join(', ')}`,
    });
  }
  
  // Validate drum hits
  if (drums.hits) {
    for (let i = 0; i < drums.hits.length; i++) {
      const hit = drums.hits[i];
      if (hit.drum && !DRUM_NAMES.includes(hit.drum)) {
        const similar = findSimilar(hit.drum, DRUM_NAMES);
        errors.push({
          code: 'E006',
          path: `${patternPath}/drums/hits/${i}/drum`,
          message: `Unknown drum: '${hit.drum}'`,
          help: similar.length > 0 ? formatSuggestion(similar) : `Available drums: kick, snare, hihat, clap, tom1, crash, ride`,
        });
      }
    }
  }
  
  return errors;
}

/**
 * Validate a single pattern
 */
function validatePattern(pattern: Pattern, name: string, patternPath: string): SemanticError[] {
  const errors: SemanticError[] = [];
  
  // Notes pattern
  if ('notes' in pattern && Array.isArray(pattern.notes)) {
    errors.push(...validateNotesPattern(pattern.notes, patternPath));
  }
  
  // Chords pattern
  if ('chords' in pattern && Array.isArray(pattern.chords)) {
    errors.push(...validateChordsPattern(pattern.chords, patternPath));
  }
  
  // Drums pattern
  if ('drums' in pattern && pattern.drums) {
    errors.push(...validateDrumPattern(pattern.drums as DrumPattern, patternPath));
  }
  
  // Degrees pattern (scale degrees)
  if ('degrees' in pattern && Array.isArray(pattern.degrees)) {
    // Degrees have simpler syntax but still need validation
    for (let i = 0; i < pattern.degrees.length; i++) {
      const deg = pattern.degrees[i];
      // Basic format check: should be number:duration or r:duration
      if (typeof deg === 'string' && !deg.match(/^(r|\d+[#b]?[+-]?):\w+\.?$/i)) {
        errors.push({
          code: 'E003',
          path: `${patternPath}/degrees/${i}`,
          message: `Invalid scale degree: '${deg}'`,
          help: 'Degree format: <degree>:<duration>. Examples: 1:q, 5:h, 7#:8, r:q',
          docs: 'docs/ETHERSCORE_FORMAT.md#scale-degrees'
        });
      }
    }
  }
  
  return errors;
}

/**
 * Validate all patterns in the score
 */
function validateAllPatterns(patterns: Record<string, Pattern>): SemanticError[] {
  const errors: SemanticError[] = [];
  
  for (const [name, pattern] of Object.entries(patterns)) {
    // Skip comment keys
    if (name.startsWith('//')) continue;
    
    if (pattern && typeof pattern === 'object') {
      errors.push(...validatePattern(pattern, name, `/patterns/${name}`));
    }
  }
  
  return errors;
}

/**
 * Validate instrument definitions
 */
function validateInstruments(instruments: Record<string, any>): SemanticError[] {
  const errors: SemanticError[] = [];
  
  for (const [name, inst] of Object.entries(instruments)) {
    // Skip comment keys
    if (name.startsWith('//')) continue;
    
    if (inst && typeof inst === 'object' && inst.preset) {
      const preset = inst.preset;
      
      // Check if preset exists
      const presetNames = getPresetNames();
      if (!presetNames.includes(preset) && !preset.startsWith('drums:')) {
        const similar = findSimilar(preset, presetNames);
        errors.push({
          code: 'E004',
          path: `/instruments/${name}/preset`,
          message: `Unknown preset '${preset}' for instrument '${name}'`,
          help: similar.length > 0 
            ? formatSuggestion(similar) 
            : `Run 'npx etherdaw list presets' to see available presets`,
          docs: 'docs/PRESETS.md'
        });
      }
    }
  }
  
  return errors;
}

/**
 * Validate section track references
 */
function validateSections(
  sections: Record<string, any>,
  patterns: Record<string, Pattern>,
  instruments: Record<string, any>
): SemanticError[] {
  const errors: SemanticError[] = [];
  const patternNames = Object.keys(patterns).filter(k => !k.startsWith('//'));
  const instrumentNames = Object.keys(instruments || {}).filter(k => !k.startsWith('//'));
  
  for (const [sectionName, section] of Object.entries(sections)) {
    if (sectionName.startsWith('//')) continue;
    if (!section || typeof section !== 'object' || !section.tracks) continue;
    
    for (const [trackName, track] of Object.entries(section.tracks)) {
      if (trackName.startsWith('//')) continue;
      if (!track || typeof track !== 'object') continue;
      
      const trackObj = track as Record<string, any>;
      
      // Check instrument reference
      if (instrumentNames.length > 0 && !instrumentNames.includes(trackName)) {
        const similar = findSimilar(trackName, instrumentNames);
        errors.push({
          code: 'E013',
          path: `/sections/${sectionName}/tracks/${trackName}`,
          message: `Track '${trackName}' has no matching instrument definition`,
          help: similar.length > 0 
            ? formatSuggestion(similar)
            : `Add "${trackName}" to instruments or use existing: ${instrumentNames.slice(0, 5).join(', ')}`,
        });
      }
      
      // Check pattern references
      const patternsToCheck: string[] = [];
      if (trackObj.pattern) patternsToCheck.push(trackObj.pattern);
      if (trackObj.patterns) patternsToCheck.push(...trackObj.patterns);
      
      for (const patternRef of patternsToCheck) {
        if (!patternNames.includes(patternRef)) {
          const similar = findSimilar(patternRef, patternNames);
          errors.push({
            code: 'E007',
            path: `/sections/${sectionName}/tracks/${trackName}`,
            message: `Pattern '${patternRef}' not found`,
            help: similar.length > 0 
              ? formatSuggestion(similar)
              : `Define pattern '${patternRef}' in patterns`,
          });
        }
      }
    }
  }
  
  return errors;
}

/**
 * Validate arrangement references
 */
function validateArrangementRefs(
  arrangement: string[],
  sections: Record<string, any>
): SemanticError[] {
  const errors: SemanticError[] = [];
  const sectionNames = Object.keys(sections).filter(k => !k.startsWith('//'));
  
  if (arrangement.length === 0) {
    errors.push({
      code: 'E014',
      path: '/arrangement',
      message: 'Arrangement is empty',
      help: 'Add section names to the arrangement array',
    });
    return errors;
  }
  
  for (let i = 0; i < arrangement.length; i++) {
    const sectionRef = arrangement[i];
    if (!sectionNames.includes(sectionRef)) {
      const similar = findSimilar(sectionRef, sectionNames);
      errors.push({
        code: 'E008',
        path: `/arrangement/${i}`,
        message: `Section '${sectionRef}' not found`,
        help: similar.length > 0 
          ? formatSuggestion(similar)
          : `Define section '${sectionRef}' in sections`,
      });
    }
  }
  
  return errors;
}

/**
 * Perform deep semantic validation beyond JSON schema checks.
 *
 * Validates note/chord syntax, drum kits/hits, preset references,
 * track-to-instrument mapping, pattern references, and arrangement section
 * references. Returns all discovered errors (and warnings, if any) without
 * short-circuiting on the first issue.
 *
 * @param score - Full EtherScore document to validate.
 * @returns Validation result containing validity flag, errors, and warnings.
 *
 * @example
 * const result = validateSemantic(score);
 * if (!result.valid) {
 *   console.error(result.errors);
 * }
 */
export function validateSemantic(score: EtherScore): SemanticValidationResult {
  const errors: SemanticError[] = [];
  const warnings: SemanticError[] = [];
  
  // Validate patterns (note/chord syntax)
  if (score.patterns) {
    errors.push(...validateAllPatterns(score.patterns));
  }
  
  // Validate instruments (preset references)
  if (score.instruments) {
    errors.push(...validateInstruments(score.instruments));
  }
  
  // Validate sections (pattern/instrument references)
  if (score.sections) {
    errors.push(...validateSections(
      score.sections,
      score.patterns || {},
      score.instruments || {}
    ));
  }
  
  // Validate arrangement (section references)
  if (score.arrangement) {
    errors.push(...validateArrangementRefs(score.arrangement, score.sections || {}));
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Format a semantic validation result for human-readable display.
 *
 * The output is a multi-line string that includes counts, error details,
 * locations, and helpful hints when available. If no errors or warnings are
 * present, a short success message is returned.
 *
 * @param result - Result returned from {@link validateSemantic}.
 * @returns Formatted string suitable for CLI or log output.
 *
 * @example
 * const message = formatSemanticResult(result);
 * console.log(message);
 */
export function formatSemanticResult(result: SemanticValidationResult): string {
  if (result.valid && result.warnings.length === 0) {
    return '✓ Semantic validation passed';
  }
  
  const lines: string[] = [];
  
  if (result.errors.length > 0) {
    lines.push(`✗ ${result.errors.length} error(s):`);
    for (const err of result.errors) {
      lines.push(`  ${err.code}: ${err.message}`);
      lines.push(`    at ${err.path}`);
      if (err.help) lines.push(`    ${err.help}`);
    }
  }
  
  if (result.warnings.length > 0) {
    lines.push(`⚠ ${result.warnings.length} warning(s):`);
    for (const warn of result.warnings) {
      lines.push(`  ${warn.message}`);
      if (warn.help) lines.push(`    ${warn.help}`);
    }
  }
  
  return lines.join('\n');
}
