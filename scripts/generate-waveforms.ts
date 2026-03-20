/**
 * generate-waveforms.ts
 *
 * Analyzes WAV files and produces per-track waveform JSON files with 3 frequency
 * bands (low / mid / high) for DJ-style colored waveform display.
 *
 * Each output file is stored alongside the source audio as `<name>.waveform.json`
 * and gets synced to R2 with the regular upload script.
 *
 * Usage:
 *   pnpm waveforms            # generate missing waveforms
 *   pnpm waveforms --force    # regenerate all waveforms
 */

import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';
import cliProgress from 'cli-progress';

// ── Constants ──────────────────────────────────────────────────────────────────

const DATA_DIR = 'data';
const SAMPLE_RATE = 48000;
const FFT_SIZE = 2048; // ~42.7ms window → 23.4 Hz/bin at 48kHz
const HOP_SIZE = FFT_SIZE; // non-overlapping for speed
const OUTPUT_POINTS = 800; // stored in JSON; downsampled on client
const CONCURRENCY = Math.max(1, os.cpus().length - 1);

// Band boundaries in Hz (industry standard DJ crossover points)
const LOW_MAX_HZ = 200;
const MID_MAX_HZ = 2000;

// Derived bin boundaries
const BIN_HZ = SAMPLE_RATE / FFT_SIZE;
const LOW_MAX_BIN = Math.round(LOW_MAX_HZ / BIN_HZ);
const MID_MAX_BIN = Math.round(MID_MAX_HZ / BIN_HZ);
const NYQUIST_BIN = FFT_SIZE / 2;

// ── FFT ────────────────────────────────────────────────────────────────────────

/** Pre-compute Hann window */
const hannWindow = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
  hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
}

/** In-place radix-2 Cooley-Tukey FFT. real/imag are length-N arrays. */
function fft(real: Float64Array, imag: Float64Array): void {
  const N = real.length;

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  // Butterfly stages
  for (let len = 2; len <= N; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wR = Math.cos(angle);
    const wI = Math.sin(angle);

    for (let i = 0; i < N; i += len) {
      let curR = 1;
      let curI = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j;
        const b = a + half;
        const tR = curR * real[b] - curI * imag[b];
        const tI = curR * imag[b] + curI * real[b];
        real[b] = real[a] - tR;
        imag[b] = imag[a] - tI;
        real[a] += tR;
        imag[a] += tI;
        const tmpR = curR * wR - curI * wI;
        curI = curR * wI + curI * wR;
        curR = tmpR;
      }
    }
  }
}

/** Compute band energies (RMS) for one FFT window. */
function bandEnergies(
  real: Float64Array,
  imag: Float64Array,
): { low: number; mid: number; high: number } {
  let lowSum = 0;
  let midSum = 0;
  let highSum = 0;
  let lowCount = 0;
  let midCount = 0;
  let highCount = 0;

  for (let bin = 1; bin < NYQUIST_BIN; bin++) {
    const mag = real[bin] * real[bin] + imag[bin] * imag[bin];
    if (bin < LOW_MAX_BIN) {
      lowSum += mag;
      lowCount++;
    } else if (bin < MID_MAX_BIN) {
      midSum += mag;
      midCount++;
    } else {
      highSum += mag;
      highCount++;
    }
  }

  return {
    low: lowCount > 0 ? Math.sqrt(lowSum / lowCount) : 0,
    mid: midCount > 0 ? Math.sqrt(midSum / midCount) : 0,
    high: highCount > 0 ? Math.sqrt(highSum / highCount) : 0,
  };
}

// ── Waveform analysis ──────────────────────────────────────────────────────────

type WaveformData = {
  v: 1;
  sampleRate: number;
  fftSize: number;
  pointCount: number;
  duration: number;
  low: number[];
  mid: number[];
  high: number[];
};

/**
 * Analyze a WAV file and return waveform data.
 * Uses ffmpeg to decode to mono f32le PCM, then runs FFT in JS.
 */
function analyzeWav(wavPath: string): Promise<WaveformData> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'ffmpeg',
      [
        '-i', wavPath,
        '-ac', '1',           // mono
        '-ar', String(SAMPLE_RATE),
        '-f', 'f32le',        // 32-bit float little-endian
        '-v', 'error',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    // Collect all FFT frames
    const allLow: number[] = [];
    const allMid: number[] = [];
    const allHigh: number[] = [];

    let leftover = Buffer.alloc(0);
    const bytesPerSample = 4; // f32le
    const windowBytes = FFT_SIZE * bytesPerSample;

    const realBuf = new Float64Array(FFT_SIZE);
    const imagBuf = new Float64Array(FFT_SIZE);

    proc.stdout.on('data', (chunk: Buffer) => {
      leftover = Buffer.concat([leftover, chunk]);

      while (leftover.length >= windowBytes) {
        // Read samples into real buffer, apply Hann window
        for (let i = 0; i < FFT_SIZE; i++) {
          realBuf[i] = leftover.readFloatLE(i * bytesPerSample) * hannWindow[i];
          imagBuf[i] = 0;
        }
        leftover = leftover.subarray(windowBytes);

        fft(realBuf, imagBuf);
        const e = bandEnergies(realBuf, imagBuf);
        allLow.push(e.low);
        allMid.push(e.mid);
        allHigh.push(e.high);
      }
    });

    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 200)}`));
      }

      const totalFrames = allLow.length;
      if (totalFrames === 0) {
        return reject(new Error('No audio frames decoded'));
      }

      const duration = (totalFrames * HOP_SIZE) / SAMPLE_RATE;

      // Downsample to OUTPUT_POINTS
      const pointCount = Math.min(OUTPUT_POINTS, totalFrames);
      const low: number[] = [];
      const mid: number[] = [];
      const high: number[] = [];

      for (let p = 0; p < pointCount; p++) {
        const start = Math.floor((p / pointCount) * totalFrames);
        const end = Math.floor(((p + 1) / pointCount) * totalFrames);
        let lSum = 0, mSum = 0, hSum = 0;
        for (let i = start; i < end; i++) {
          lSum += allLow[i];
          mSum += allMid[i];
          hSum += allHigh[i];
        }
        const count = end - start || 1;
        low.push(lSum / count);
        mid.push(mSum / count);
        high.push(hSum / count);
      }

      // Peak-normalize each band independently (0-1)
      const peakLow = Math.max(...low) || 1;
      const peakMid = Math.max(...mid) || 1;
      const peakHigh = Math.max(...high) || 1;

      for (let i = 0; i < pointCount; i++) {
        low[i] = round3(low[i] / peakLow);
        mid[i] = round3(mid[i] / peakMid);
        high[i] = round3(high[i] / peakHigh);
      }

      resolve({
        v: 1,
        sampleRate: SAMPLE_RATE,
        fftSize: FFT_SIZE,
        pointCount,
        duration: Math.round(duration * 100) / 100,
        low,
        mid,
        high,
      });
    });

    proc.on('error', reject);
  });
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ── Concurrency limiter ────────────────────────────────────────────────────────

function createPool(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function next() {
    if (queue.length > 0 && active < limit) {
      active++;
      const run = queue.shift()!;
      run();
    }
  }

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push(async () => {
          try {
            resolve(await fn());
          } catch (err) {
            reject(err);
          } finally {
            active--;
            next();
          }
        });
        next();
      });
    },
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');

  console.log(chalk.bold.cyan('\n=== Generate Waveforms ==='));
  console.log(chalk.gray(`  FFT: ${FFT_SIZE} samples, Bands: ${LOW_MAX_HZ}/${MID_MAX_HZ} Hz, Output: ${OUTPUT_POINTS} points`));
  console.log(chalk.gray(`  Concurrency: ${CONCURRENCY}\n`));

  // Find all WAV files
  const entries = await fs.readdir(DATA_DIR);
  const wavFiles = entries.filter((f) => f.endsWith('.wav'));

  // Filter to those needing waveform generation
  const pending: string[] = [];
  for (const wav of wavFiles) {
    const waveformFile = wav + '.waveform.json';
    if (!force) {
      try {
        await fs.access(path.join(DATA_DIR, waveformFile));
        continue; // already exists
      } catch {
        // needs generation
      }
    }
    pending.push(wav);
  }

  console.log(
    chalk.cyan(
      `  ${wavFiles.length} WAV files, ${wavFiles.length - pending.length} already have waveforms, ${pending.length} to generate`,
    ),
  );

  if (pending.length === 0) {
    console.log(chalk.green('  Nothing to do.\n'));
    return;
  }

  const bar = new cliProgress.SingleBar(
    {
      format: `${chalk.yellow('Waveform'.padEnd(11))} [{bar}] {percentage}% | {value}/{total} | {file}`,
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic,
  );
  bar.start(pending.length, 0, { file: '' });

  const pool = createPool(CONCURRENCY);
  let succeeded = 0;
  let failed = 0;

  const tasks = pending.map((wav) =>
    pool.run(async () => {
      const wavPath = path.join(DATA_DIR, wav);
      const outPath = path.join(DATA_DIR, wav + '.waveform.json');
      try {
        const data = await analyzeWav(wavPath);
        await fs.writeFile(outPath, JSON.stringify(data));
        succeeded++;
      } catch (err) {
        failed++;
        // Log error after progress bar finishes
        console.error(
          chalk.red(`\n  Error: ${wav}: ${err instanceof Error ? err.message : String(err)}`),
        );
      }
      bar.increment({ file: wav.slice(0, 50) });
    }),
  );

  await Promise.all(tasks);
  bar.stop();

  console.log(chalk.green(`  Succeeded: ${succeeded}`));
  if (failed > 0) console.log(chalk.red(`  Failed:    ${failed}`));
  console.log();
}

main().catch((err) => {
  console.error(chalk.red(`Waveform generation failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
