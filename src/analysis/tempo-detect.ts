/**
 * Tempo detection from audio files
 * Uses onset detection and autocorrelation to estimate BPM
 */

import { readFileSync } from 'fs';

interface TempoResult {
  bpm: number;
  confidence: number;
  method: string;
  candidates: number[];
}

/**
 * Load WAV file and return sample data
 */
function loadWav(path: string): { sampleRate: number; data: Float32Array } {
  const buffer = readFileSync(path);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  
  // Parse WAV header
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riff !== 'RIFF') {
    throw new Error('Not a valid WAV file');
  }
  
  const format = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (format !== 'WAVE') {
    throw new Error('Not a valid WAV file');
  }
  
  // Find fmt chunk
  let offset = 12;
  let sampleRate = 44100;
  let bitsPerSample = 16;
  let numChannels = 2;
  
  while (offset < buffer.length - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset), view.getUint8(offset + 1),
      view.getUint8(offset + 2), view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, true);
    
    if (chunkId === 'fmt ') {
      numChannels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 'data') {
      // Read audio data
      const dataOffset = offset + 8;
      const dataLength = chunkSize;
      const bytesPerSample = bitsPerSample / 8;
      const numSamples = Math.floor(dataLength / (bytesPerSample * numChannels));
      
      const data = new Float32Array(numSamples);
      
      for (let i = 0; i < numSamples; i++) {
        let sample = 0;
        for (let ch = 0; ch < numChannels; ch++) {
          const sampleOffset = dataOffset + i * bytesPerSample * numChannels + ch * bytesPerSample;
          if (bitsPerSample === 16) {
            sample += view.getInt16(sampleOffset, true) / 32768;
          } else if (bitsPerSample === 24) {
            const b0 = view.getUint8(sampleOffset);
            const b1 = view.getUint8(sampleOffset + 1);
            const b2 = view.getInt8(sampleOffset + 2);
            sample += ((b2 << 16) | (b1 << 8) | b0) / 8388608;
          }
        }
        data[i] = sample / numChannels;
      }
      
      return { sampleRate, data };
    }
    
    offset += 8 + chunkSize;
    if (chunkSize % 2 === 1) offset++; // Pad byte
  }
  
  throw new Error('No audio data found in WAV file');
}

/**
 * Compute RMS energy envelope
 */
function computeEnvelope(data: Float32Array, frameSize: number, hopSize: number): Float32Array {
  const numFrames = Math.floor((data.length - frameSize) / hopSize);
  const envelope = new Float32Array(numFrames);
  
  for (let i = 0; i < numFrames; i++) {
    const start = i * hopSize;
    let sum = 0;
    for (let j = 0; j < frameSize; j++) {
      sum += data[start + j] ** 2;
    }
    envelope[i] = Math.sqrt(sum / frameSize);
  }
  
  return envelope;
}

/**
 * Compute onset strength (positive first derivative)
 */
function computeOnsetStrength(envelope: Float32Array): Float32Array {
  const onset = new Float32Array(envelope.length - 1);
  for (let i = 0; i < onset.length; i++) {
    onset[i] = Math.max(0, envelope[i + 1] - envelope[i]);
  }
  return onset;
}

/**
 * Find peaks in array
 */
function findPeaks(data: Float32Array, threshold: number, minDistance: number): number[] {
  const peaks: number[] = [];
  const maxVal = Math.max(...data);
  const thresh = threshold * maxVal;
  
  for (let i = 1; i < data.length - 1; i++) {
    if (data[i] > thresh && data[i] > data[i - 1] && data[i] > data[i + 1]) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minDistance) {
        peaks.push(i);
      }
    }
  }
  
  return peaks;
}

/**
 * Simple autocorrelation
 */
function autocorrelate(x: Float32Array, maxLag: number): Float32Array {
  const result = new Float32Array(maxLag);
  const n = x.length;
  
  for (let lag = 0; lag < maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) {
      sum += x[i] * x[i + lag];
    }
    result[lag] = sum;
  }
  
  return result;
}

/**
 * Detect tempo from audio file
 */
export function detectTempo(path: string): TempoResult {
  const { sampleRate, data } = loadWav(path);
  const duration = data.length / sampleRate;
  
  // Parameters
  const frameSize = 2048;
  const hopSize = 512;
  const framesPerSec = sampleRate / hopSize;
  
  // Compute onset strength
  const envelope = computeEnvelope(data, frameSize, hopSize);
  const onsetStrength = computeOnsetStrength(envelope);
  
  // Normalize
  const mean = onsetStrength.reduce((a, b) => a + b, 0) / onsetStrength.length;
  const std = Math.sqrt(
    onsetStrength.reduce((a, b) => a + (b - mean) ** 2, 0) / onsetStrength.length
  );
  
  const normalized = new Float32Array(onsetStrength.length);
  for (let i = 0; i < onsetStrength.length; i++) {
    normalized[i] = std > 0 ? (onsetStrength[i] - mean) / std : 0;
  }
  
  // Autocorrelation for tempo estimation
  const minBpm = 40;
  const maxBpm = 180;
  const minLag = Math.floor(framesPerSec * 60 / maxBpm);
  const maxLag = Math.floor(framesPerSec * 60 / minBpm);
  
  const acf = autocorrelate(normalized, Math.min(maxLag + 1, normalized.length));
  
  // Find peak in valid range
  let bestLag = minLag;
  let bestVal = -Infinity;
  
  for (let lag = minLag; lag <= Math.min(maxLag, acf.length - 1); lag++) {
    if (acf[lag] > bestVal) {
      bestVal = acf[lag];
      bestLag = lag;
    }
  }
  
  const bpmAcf = (framesPerSec * 60) / bestLag;
  const confidence = acf[0] > 0 ? bestVal / acf[0] : 0;
  
  // Also estimate from onset intervals
  const peaks = findPeaks(onsetStrength, 0.2, 5);
  const onsetTimes = peaks.map(p => p * hopSize / sampleRate);
  
  const intervals: number[] = [];
  for (let i = 1; i < onsetTimes.length; i++) {
    const interval = onsetTimes[i] - onsetTimes[i - 1];
    if (interval > 0.1 && interval < 2.0) {
      intervals.push(interval);
    }
  }
  
  // Find median interval
  const sortedIntervals = [...intervals].sort((a, b) => a - b);
  const medianInterval = sortedIntervals[Math.floor(sortedIntervals.length / 2)] || 0.5;
  
  // Generate candidate BPMs
  const candidates: number[] = [];
  for (const divisor of [1, 2, 4]) {
    const bpm = 60 / (medianInterval * divisor);
    if (bpm >= 40 && bpm <= 180) {
      candidates.push(Math.round(bpm));
    }
  }
  
  // Add autocorrelation result
  if (bpmAcf >= 40 && bpmAcf <= 180) {
    candidates.push(Math.round(bpmAcf));
  }
  
  // Choose best candidate (prefer 50-80 range for classical)
  const scoredCandidates = candidates.map(bpm => ({
    bpm,
    score: Math.abs(bpm - 65) + (bpm >= 50 && bpm <= 80 ? 0 : 20)
  }));
  
  scoredCandidates.sort((a, b) => a.score - b.score);
  const bestBpm = scoredCandidates[0]?.bpm || Math.round(bpmAcf);
  
  // Round to nearest 5
  const roundedBpm = Math.round(bestBpm / 5) * 5;
  
  return {
    bpm: roundedBpm,
    confidence,
    method: 'autocorrelation + interval analysis',
    candidates: [...new Set(candidates)].sort((a, b) => a - b)
  };
}

/**
 * Get audio file info
 */
export function getAudioInfo(path: string): { duration: number; sampleRate: number; samples: number } {
  const { sampleRate, data } = loadWav(path);
  return {
    duration: data.length / sampleRate,
    sampleRate,
    samples: data.length
  };
}
