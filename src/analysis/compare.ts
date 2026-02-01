/**
 * Audio comparison using spectrogram analysis
 * Compares two audio files and generates a visual diff
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';

interface CompareResult {
  similarity: number;
  pixelsWithinThreshold: number;
  maxSectionDifference: number;
  mostDifferentRegion: { row: number; col: number };
  diffImagePath?: string;
}

/**
 * Generate spectrogram PNG using ffmpeg
 */
function generateSpectrogram(audioPath: string, outputPath: string, width = 1600, height = 400): void {
  try {
    execSync(
      `ffmpeg -y -i "${audioPath}" -lavfi showspectrumpic=s=${width}x${height}:legend=0 "${outputPath}" 2>/dev/null`,
      { stdio: 'pipe' }
    );
  } catch (error) {
    throw new Error(`Failed to generate spectrogram for ${audioPath}`);
  }
}

/**
 * Load PNG image as raw pixel data (simplified - reads RGB values)
 */
function loadPng(path: string): { width: number; height: number; data: Uint8Array } {
  // Use ffmpeg to convert PNG to raw RGB
  const rawPath = path.replace('.png', '.raw');
  
  try {
    // Get dimensions
    const info = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${path}"`, { encoding: 'utf8' });
    const [widthStr, heightStr] = info.trim().split(',');
    const width = parseInt(widthStr);
    const height = parseInt(heightStr);
    
    // Convert to raw RGB
    execSync(`ffmpeg -y -i "${path}" -f rawvideo -pix_fmt rgb24 "${rawPath}" 2>/dev/null`, { stdio: 'pipe' });
    
    const data = readFileSync(rawPath);
    
    // Clean up
    try { execSync(`rm "${rawPath}"`, { stdio: 'pipe' }); } catch {}
    
    return { width, height, data: new Uint8Array(data) };
  } catch (error) {
    throw new Error(`Failed to load PNG: ${path}`);
  }
}

/**
 * Resize image data to target dimensions (simple nearest-neighbor)
 */
function resizeImage(
  data: Uint8Array, srcWidth: number, srcHeight: number,
  dstWidth: number, dstHeight: number
): Uint8Array {
  const result = new Uint8Array(dstWidth * dstHeight * 3);
  
  for (let y = 0; y < dstHeight; y++) {
    for (let x = 0; x < dstWidth; x++) {
      const srcX = Math.floor(x * srcWidth / dstWidth);
      const srcY = Math.floor(y * srcHeight / dstHeight);
      
      const srcIdx = (srcY * srcWidth + srcX) * 3;
      const dstIdx = (y * dstWidth + x) * 3;
      
      result[dstIdx] = data[srcIdx];
      result[dstIdx + 1] = data[srcIdx + 1];
      result[dstIdx + 2] = data[srcIdx + 2];
    }
  }
  
  return result;
}

/**
 * Compute similarity between two spectrograms
 */
function computeSimilarity(
  ref: Uint8Array, test: Uint8Array, width: number, height: number, threshold = 0.15
): CompareResult {
  const totalPixels = width * height;
  let matchingPixels = 0;
  let totalDiff = 0;
  
  // Grid analysis (8x8)
  const gridSize = 8;
  const cellWidth = Math.floor(width / gridSize);
  const cellHeight = Math.floor(height / gridSize);
  const cellDiffs = new Array(gridSize * gridSize).fill(0);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      
      // Convert RGB to luminance
      const refLum = (ref[idx] * 0.299 + ref[idx + 1] * 0.587 + ref[idx + 2] * 0.114) / 255;
      const testLum = (test[idx] * 0.299 + test[idx + 1] * 0.587 + test[idx + 2] * 0.114) / 255;
      
      const diff = Math.abs(refLum - testLum);
      totalDiff += diff;
      
      if (diff <= threshold) {
        matchingPixels++;
      }
      
      // Track grid cell differences
      const cellX = Math.min(Math.floor(x / cellWidth), gridSize - 1);
      const cellY = Math.min(Math.floor(y / cellHeight), gridSize - 1);
      cellDiffs[cellY * gridSize + cellX] += diff;
    }
  }
  
  // Find most different region
  let maxCellDiff = 0;
  let maxCellIdx = 0;
  for (let i = 0; i < cellDiffs.length; i++) {
    if (cellDiffs[i] > maxCellDiff) {
      maxCellDiff = cellDiffs[i];
      maxCellIdx = i;
    }
  }
  
  const similarity = 1 - (totalDiff / totalPixels);
  const pixelsWithinThreshold = matchingPixels / totalPixels;
  const maxSectionDifference = maxCellDiff / (cellWidth * cellHeight);
  
  return {
    similarity: Math.round(similarity * 1000) / 10,
    pixelsWithinThreshold: Math.round(pixelsWithinThreshold * 1000) / 10,
    maxSectionDifference: Math.round(maxSectionDifference * 1000) / 10,
    mostDifferentRegion: {
      row: Math.floor(maxCellIdx / gridSize),
      col: maxCellIdx % gridSize
    }
  };
}

/**
 * Generate diff image
 */
function generateDiffImage(
  ref: Uint8Array, test: Uint8Array, width: number, height: number, outputPath: string, threshold = 0.15
): void {
  const diff = new Uint8Array(width * height * 3);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      
      const refLum = (ref[idx] * 0.299 + ref[idx + 1] * 0.587 + ref[idx + 2] * 0.114) / 255;
      const testLum = (test[idx] * 0.299 + test[idx + 1] * 0.587 + test[idx + 2] * 0.114) / 255;
      
      const diffVal = testLum - refLum;
      
      if (Math.abs(diffVal) <= threshold) {
        // Matching - grayscale
        const gray = Math.round(refLum * 128);
        diff[idx] = gray;
        diff[idx + 1] = gray;
        diff[idx + 2] = gray;
      } else if (diffVal > 0) {
        // Extra in test - red
        const intensity = Math.min(255, Math.round(Math.abs(diffVal) * 512));
        diff[idx] = intensity;
        diff[idx + 1] = 0;
        diff[idx + 2] = 0;
      } else {
        // Missing in test - green
        const intensity = Math.min(255, Math.round(Math.abs(diffVal) * 512));
        diff[idx] = 0;
        diff[idx + 1] = intensity;
        diff[idx + 2] = 0;
      }
    }
  }
  
  // Write raw to temp file and convert to PNG
  const rawPath = join(tmpdir(), 'diff.raw');
  writeFileSync(rawPath, diff);
  
  execSync(
    `ffmpeg -y -f rawvideo -pix_fmt rgb24 -s ${width}x${height} -i "${rawPath}" "${outputPath}" 2>/dev/null`,
    { stdio: 'pipe' }
  );
  
  try { execSync(`rm "${rawPath}"`, { stdio: 'pipe' }); } catch {}
}

/**
 * Compare two audio files
 */
export function compareAudio(
  referencePath: string,
  testPath: string,
  options: { output?: string; threshold?: number } = {}
): CompareResult {
  const threshold = options.threshold || 0.15;
  const tmpDir = tmpdir();
  
  // Generate spectrograms
  const refSpecPath = join(tmpDir, 'ref-spec.png');
  const testSpecPath = join(tmpDir, 'test-spec.png');
  
  generateSpectrogram(referencePath, refSpecPath);
  generateSpectrogram(testPath, testSpecPath);
  
  // Load and compare
  const refImg = loadPng(refSpecPath);
  let testImg = loadPng(testSpecPath);
  
  // Resize test to match reference if needed
  if (testImg.width !== refImg.width || testImg.height !== refImg.height) {
    testImg.data = resizeImage(
      testImg.data, testImg.width, testImg.height,
      refImg.width, refImg.height
    );
    testImg.width = refImg.width;
    testImg.height = refImg.height;
  }
  
  // Compute similarity
  const result = computeSimilarity(refImg.data, testImg.data, refImg.width, refImg.height, threshold);
  
  // Generate diff image if output path provided
  if (options.output) {
    generateDiffImage(refImg.data, testImg.data, refImg.width, refImg.height, options.output, threshold);
    result.diffImagePath = options.output;
  }
  
  // Cleanup
  try { execSync(`rm "${refSpecPath}" "${testSpecPath}"`, { stdio: 'pipe' }); } catch {}
  
  return result;
}

/**
 * Compare spectrogram images directly
 */
export function compareSpectrograms(
  referencePath: string,
  testPath: string,
  options: { output?: string; threshold?: number } = {}
): CompareResult {
  const threshold = options.threshold || 0.15;
  
  // Load images
  const refImg = loadPng(referencePath);
  let testImg = loadPng(testPath);
  
  // Resize test to match reference if needed
  if (testImg.width !== refImg.width || testImg.height !== refImg.height) {
    testImg.data = resizeImage(
      testImg.data, testImg.width, testImg.height,
      refImg.width, refImg.height
    );
    testImg.width = refImg.width;
    testImg.height = refImg.height;
  }
  
  // Compute similarity
  const result = computeSimilarity(refImg.data, testImg.data, refImg.width, refImg.height, threshold);
  
  // Generate diff image if output path provided
  if (options.output) {
    generateDiffImage(refImg.data, testImg.data, refImg.width, refImg.height, options.output, threshold);
    result.diffImagePath = options.output;
  }
  
  return result;
}
