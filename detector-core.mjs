const DEFAULT_SAMPLE_RATE = 48_000;
const HISTORY_LIMIT = 240;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function coefficientFromMs(milliseconds, sampleRate) {
  const safeMs = Math.max(0.001, milliseconds);
  return Math.exp(-1 / (safeMs * 0.001 * sampleRate));
}

function updateEnvelope(current, input, attackCoeff, releaseCoeff) {
  const coeff = input > current ? attackCoeff : releaseCoeff;
  return coeff * current + (1 - coeff) * input;
}

export function formatElapsedTime(totalSeconds) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = Math.floor(safeSeconds % 60);
  const milliseconds = Math.floor((safeSeconds - Math.floor(safeSeconds)) * 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(
    milliseconds
  ).padStart(3, "0")}`;
}

export function calculateBpmFromHits(hitTimesSeconds) {
  if (hitTimesSeconds.length < 2) {
    return null;
  }

  const recentIntervals = [];
  const startIndex = Math.max(1, hitTimesSeconds.length - 9);
  for (let index = startIndex; index < hitTimesSeconds.length; index += 1) {
    const interval = hitTimesSeconds[index] - hitTimesSeconds[index - 1];
    if (interval >= 0.08 && interval <= 2) {
      recentIntervals.push(interval);
    }
  }

  if (recentIntervals.length === 0) {
    return null;
  }

  recentIntervals.sort((left, right) => left - right);
  const medianInterval = recentIntervals[Math.floor(recentIntervals.length / 2)];
  return 60 / medianInterval;
}

export class DrumHitDetector {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
    this.samplesProcessed = 0;
    this.prevInput = 0;
    this.prevHighPassed = 0;
    this.fastEnvelope = 0;
    this.slowEnvelope = 0;
    this.transientEnvelope = 0;
    this.prevTransientEnvelope = 0;
    this.lastHitSample = -Infinity;
    this.candidateActive = false;
    this.candidatePeak = 0;
    this.candidatePeakSample = 0;
    this.pendingReset = false;
    this.debugHistory = [];
    this.setParameters({
      threshold: options.threshold ?? 0.085,
      refractoryMs: options.refractoryMs ?? 72,
      smoothing: options.smoothing ?? 0.58,
      adaptiveStrength: options.adaptiveStrength ?? 0.5,
      highPassHz: options.highPassHz ?? 105,
    });
  }

  setParameters(parameters = {}) {
    this.threshold = parameters.threshold ?? this.threshold ?? 0.085;
    this.refractoryMs = parameters.refractoryMs ?? this.refractoryMs ?? 72;
    this.smoothing = clamp(parameters.smoothing ?? this.smoothing ?? 0.58, 0, 1);
    this.adaptiveStrength = parameters.adaptiveStrength ?? this.adaptiveStrength ?? 0.5;
    this.highPassHz = parameters.highPassHz ?? this.highPassHz ?? 105;

    const dt = 1 / this.sampleRate;
    const rc = 1 / (2 * Math.PI * this.highPassHz);
    this.highPassAlpha = rc / (rc + dt);
    this.refractorySamples = Math.max(1, Math.round((this.refractoryMs / 1000) * this.sampleRate));

    this.fastAttackCoeff = coefficientFromMs(0.2, this.sampleRate);
    this.fastReleaseCoeff = coefficientFromMs(3 + this.smoothing * 8, this.sampleRate);
    this.slowAttackCoeff = coefficientFromMs(10 + this.smoothing * 18, this.sampleRate);
    this.slowReleaseCoeff = coefficientFromMs(85 + this.smoothing * 160, this.sampleRate);
    this.transientAttackCoeff = coefficientFromMs(0.25, this.sampleRate);
    this.transientReleaseCoeff = coefficientFromMs(2 + this.smoothing * 10, this.sampleRate);
  }

  processChunk(samples) {
    const hits = [];
    let rawPeak = 0;
    let filteredPeak = 0;
    let effectiveThresholdPeak = 0;
    let chunkTriggered = false;

    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const absoluteSample = Math.abs(sample);
      rawPeak = Math.max(rawPeak, absoluteSample);

      const highPassed =
        this.highPassAlpha * (this.prevHighPassed + sample - this.prevInput);
      this.prevInput = sample;
      this.prevHighPassed = highPassed;

      const rectified = Math.abs(highPassed);
      this.fastEnvelope = updateEnvelope(
        this.fastEnvelope,
        rectified,
        this.fastAttackCoeff,
        this.fastReleaseCoeff
      );
      this.slowEnvelope = updateEnvelope(
        this.slowEnvelope,
        rectified,
        this.slowAttackCoeff,
        this.slowReleaseCoeff
      );

      const transient = Math.max(
        0,
        this.fastEnvelope - this.slowEnvelope * (1 + this.adaptiveStrength)
      );
      this.transientEnvelope = updateEnvelope(
        this.transientEnvelope,
        transient,
        this.transientAttackCoeff,
        this.transientReleaseCoeff
      );

      filteredPeak = Math.max(filteredPeak, this.transientEnvelope);
      const effectiveThreshold =
        this.threshold + this.slowEnvelope * (0.12 + this.adaptiveStrength * 0.35);
      effectiveThresholdPeak = Math.max(effectiveThresholdPeak, effectiveThreshold);

      const samplePosition = this.samplesProcessed + index;
      const canTrigger = samplePosition - this.lastHitSample >= this.refractorySamples;
      const rising = this.transientEnvelope >= this.prevTransientEnvelope;
      const startLevel = effectiveThreshold * 0.82;
      const resetLevel = effectiveThreshold * 0.28;

      if (canTrigger) {
        if (!this.candidateActive && rising && this.transientEnvelope >= startLevel) {
          this.candidateActive = true;
          this.candidatePeak = this.transientEnvelope;
          this.candidatePeakSample = samplePosition;
        } else if (this.candidateActive) {
          if (this.transientEnvelope >= this.candidatePeak) {
            this.candidatePeak = this.transientEnvelope;
            this.candidatePeakSample = samplePosition;
          }

          const falling = this.transientEnvelope < this.prevTransientEnvelope * 0.998;
          if (falling && this.candidatePeak >= effectiveThreshold) {
            this.lastHitSample = this.candidatePeakSample;
            this.pendingReset = true;
            this.candidateActive = false;
            chunkTriggered = true;

            hits.push({
              timeSeconds: this.candidatePeakSample / this.sampleRate,
              strength: this.candidatePeak,
            });
          }
        }
      }

      if ((this.pendingReset || this.candidateActive) && this.transientEnvelope <= resetLevel) {
        this.pendingReset = false;
        this.candidateActive = false;
        this.candidatePeak = 0;
      }

      this.prevTransientEnvelope = this.transientEnvelope;
    }

    this.samplesProcessed += samples.length;

    const metrics = {
      rawPeak,
      filteredPeak,
      threshold: effectiveThresholdPeak || this.threshold,
      triggered: chunkTriggered,
    };

    this.debugHistory.push(metrics);
    if (this.debugHistory.length > HISTORY_LIMIT) {
      this.debugHistory.shift();
    }

    return {
      hits,
      metrics,
    };
  }

  reset() {
    this.samplesProcessed = 0;
    this.prevInput = 0;
    this.prevHighPassed = 0;
    this.fastEnvelope = 0;
    this.slowEnvelope = 0;
    this.transientEnvelope = 0;
    this.prevTransientEnvelope = 0;
    this.lastHitSample = -Infinity;
    this.candidateActive = false;
    this.candidatePeak = 0;
    this.candidatePeakSample = 0;
    this.pendingReset = false;
    this.debugHistory = [];
  }
}

export class DrumTriggerSimulator {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
    this.baseBpm = options.bpm ?? 116;
    this.jitterMs = options.jitterMs ?? 16;
    this.noiseAmount = options.noiseAmount ?? 0.003;
    this.graceHitProbability = options.graceHitProbability ?? 0.45;
    this.generatedSamples = 0;
    this.hitIndex = 0;
    this.nextHitSample = Math.round(
      this.sampleRate * (options.startOffsetSeconds ?? 0.45)
    );
    this.voices = [];
    this.scheduledHitTimes = [];
  }

  scheduleHit(startSample, amplitude) {
    const decaySeconds = 0.065;
    this.voices.push({
      startSample,
      amplitude,
      durationSamples: Math.round(this.sampleRate * decaySeconds),
    });
  }

  advanceSchedule(targetSample) {
    while (this.nextHitSample <= targetSample) {
      const accentPattern = [1, 0.62, 0.82, 0.7];
      const amplitude =
        accentPattern[this.hitIndex % accentPattern.length] * (0.88 + Math.random() * 0.22);

      this.scheduleHit(this.nextHitSample, amplitude);
      this.scheduledHitTimes.push(this.nextHitSample / this.sampleRate);
      if (Math.random() < this.graceHitProbability) {
        this.scheduleHit(
          this.nextHitSample + Math.round(this.sampleRate * 0.018),
          amplitude * 0.17
        );
      }

      const jitterSamples =
        ((Math.random() * 2 - 1) * this.jitterMs * this.sampleRate) / 1000;
      const baseInterval = (60 / this.baseBpm) * this.sampleRate;
      this.nextHitSample += Math.round(baseInterval + jitterSamples);
      this.hitIndex += 1;
    }
  }

  sampleVoice(voice, ageSamples) {
    const ageSeconds = ageSamples / this.sampleRate;
    const impulse = voice.amplitude * Math.exp(-ageSeconds / 0.0013);
    const upperRing =
      voice.amplitude *
      0.27 *
      Math.sin(2 * Math.PI * 1_650 * ageSeconds) *
      Math.exp(-ageSeconds / 0.01);
    const lowerRing =
      voice.amplitude *
      0.1 *
      Math.sin(2 * Math.PI * 320 * ageSeconds) *
      Math.exp(-ageSeconds / 0.028);
    return impulse + upperRing + lowerRing;
  }

  generateChunk(frameCount) {
    const chunk = new Float32Array(frameCount);
    const lastSampleInChunk = this.generatedSamples + frameCount;
    this.advanceSchedule(lastSampleInChunk);

    for (let index = 0; index < frameCount; index += 1) {
      const sampleIndex = this.generatedSamples + index;
      let sample = (Math.random() * 2 - 1) * this.noiseAmount;

      for (let voiceIndex = this.voices.length - 1; voiceIndex >= 0; voiceIndex -= 1) {
        const voice = this.voices[voiceIndex];
        const ageSamples = sampleIndex - voice.startSample;

        if (ageSamples < 0) {
          continue;
        }

        if (ageSamples > voice.durationSamples) {
          this.voices.splice(voiceIndex, 1);
          continue;
        }

        sample += this.sampleVoice(voice, ageSamples);
      }

      chunk[index] = clamp(sample * 0.72, -1, 1);
    }

    this.generatedSamples += frameCount;
    return chunk;
  }
}
