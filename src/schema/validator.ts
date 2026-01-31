import Ajv, { ErrorObject } from 'ajv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { EtherScore } from './types.js';
import { validateSemantic, formatSemanticResult, type SemanticValidationResult } from './semantic-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const schema = JSON.parse(readFileSync(join(__dirname, 'etherscore.schema.json'), 'utf-8'));

const ajv = new Ajv.default({ allErrors: true });
const validateSchema = ajv.compile(schema);

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validate an EtherScore document against the JSON schema
 */
export function validate(score: unknown): ValidationResult {
  const valid = validateSchema(score);

  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors: ValidationError[] = (validateSchema.errors || []).map((err: ErrorObject) => ({
    path: err.instancePath || '/',
    message: err.message || 'Unknown validation error',
  }));

  return { valid: false, errors };
}

/**
 * Validate and return typed EtherScore or throw
 */
export function validateOrThrow(score: unknown): EtherScore {
  const result = validate(score);

  if (!result.valid) {
    const errorMessages = result.errors
      .map(e => `  ${e.path}: ${e.message}`)
      .join('\n');
    throw new Error(`Invalid EtherScore:\n${errorMessages}`);
  }

  return score as EtherScore;
}

// Helper to check if a key is a comment
function isComment(key: string): boolean {
  return key.startsWith('//');
}

/**
 * Check if arrangement references valid sections
 */
export function validateArrangement(score: EtherScore): ValidationResult {
  const errors: ValidationError[] = [];
  const sectionNames = new Set(Object.keys(score.sections).filter(k => !isComment(k)));

  for (let i = 0; i < score.arrangement.length; i++) {
    const sectionName = score.arrangement[i];
    if (!sectionNames.has(sectionName)) {
      errors.push({
        path: `/arrangement/${i}`,
        message: `Section "${sectionName}" not found in sections`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check if tracks reference valid patterns and instruments
 */
export function validateReferences(score: EtherScore): ValidationResult {
  const errors: ValidationError[] = [];
  const patternNames = new Set(Object.keys(score.patterns).filter(k => !isComment(k)));
  const instrumentNames = new Set(Object.keys(score.instruments || {}).filter(k => !isComment(k)));

  for (const [sectionName, section] of Object.entries(score.sections)) {
    // Skip comment keys
    if (isComment(sectionName)) continue;
    if (!section || typeof section !== 'object' || !section.tracks) continue;

    for (const [trackName, track] of Object.entries(section.tracks)) {
      // Skip comment keys
      if (isComment(trackName)) continue;
      if (!track || typeof track !== 'object') continue;

      // Check pattern reference
      if (track.pattern && !patternNames.has(track.pattern)) {
        errors.push({
          path: `/sections/${sectionName}/tracks/${trackName}/pattern`,
          message: `Pattern "${track.pattern}" not found`,
        });
      }

      // Check patterns array
      if (track.patterns) {
        for (let i = 0; i < track.patterns.length; i++) {
          if (!patternNames.has(track.patterns[i])) {
            errors.push({
              path: `/sections/${sectionName}/tracks/${trackName}/patterns/${i}`,
              message: `Pattern "${track.patterns[i]}" not found`,
            });
          }
        }
      }

      // Check instrument reference (track name should match instrument)
      if (instrumentNames.size > 0 && !instrumentNames.has(trackName)) {
        errors.push({
          path: `/sections/${sectionName}/tracks/${trackName}`,
          message: `No instrument defined for track "${trackName}"`,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Run all validations (schema + structural + semantic)
 */
export function validateFull(score: unknown): ValidationResult {
  const schemaResult = validate(score);
  if (!schemaResult.valid) {
    return schemaResult;
  }

  const etherScore = score as EtherScore;
  const allErrors: ValidationError[] = [];

  // Structural validation (arrangement, references)
  const arrangementResult = validateArrangement(etherScore);
  allErrors.push(...arrangementResult.errors);

  const referencesResult = validateReferences(etherScore);
  allErrors.push(...referencesResult.errors);

  // Semantic validation (note syntax, chord syntax, preset existence)
  const semanticResult = validateSemantic(etherScore);
  for (const err of semanticResult.errors) {
    allErrors.push({
      path: err.path,
      message: `${err.message}${err.help ? ` (${err.help})` : ''}`
    });
  }

  return { valid: allErrors.length === 0, errors: allErrors };
}

/**
 * Run full validation with detailed semantic output
 */
export function validateFullWithDetails(score: unknown): {
  schemaResult: ValidationResult;
  structuralResult: ValidationResult;
  semanticResult: SemanticValidationResult;
  valid: boolean;
} {
  const schemaResult = validate(score);
  if (!schemaResult.valid) {
    return {
      schemaResult,
      structuralResult: { valid: true, errors: [] },
      semanticResult: { valid: true, errors: [], warnings: [] },
      valid: false
    };
  }

  const etherScore = score as EtherScore;

  // Structural validation
  const structuralErrors: ValidationError[] = [];
  const arrangementResult = validateArrangement(etherScore);
  structuralErrors.push(...arrangementResult.errors);
  const referencesResult = validateReferences(etherScore);
  structuralErrors.push(...referencesResult.errors);
  const structuralResult = { valid: structuralErrors.length === 0, errors: structuralErrors };

  // Semantic validation
  const semanticResult = validateSemantic(etherScore);

  return {
    schemaResult,
    structuralResult,
    semanticResult,
    valid: schemaResult.valid && structuralResult.valid && semanticResult.valid
  };
}

// Re-export semantic validation utilities
export { validateSemantic, formatSemanticResult, type SemanticValidationResult };
