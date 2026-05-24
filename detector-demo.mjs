import {
  DrumHitDetector,
  DrumTriggerSimulator,
  calculateBpmFromHits,
  formatElapsedTime,
} from "./detector-core.mjs";

const sampleRate = 48_000;
const chunkSize = 256;
const durationSeconds = 10;

const detector = new DrumHitDetector({
  sampleRate,
  threshold: 0.085,
  refractoryMs: 72,
  smoothing: 0.58,
});

const simulator = new DrumTriggerSimulator({
  sampleRate,
  bpm: 116,
  jitterMs: 14,
  noiseAmount: 0.003,
});

const detectedHitTimes = [];
const totalChunks = Math.ceil((durationSeconds * sampleRate) / chunkSize);

for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
  const chunk = simulator.generateChunk(chunkSize);
  const { hits } = detector.processChunk(chunk);
  for (const hit of hits) {
    detectedHitTimes.push(hit.timeSeconds);
  }
}

const matchedGroundTruth = [];
for (const detectedTime of detectedHitTimes) {
  const groundTruth = simulator.scheduledHitTimes.find(
    (truthTime) =>
      !matchedGroundTruth.includes(truthTime) && Math.abs(truthTime - detectedTime) <= 0.05
  );
  if (groundTruth !== undefined) {
    matchedGroundTruth.push(groundTruth);
  }
}

const precision = detectedHitTimes.length > 0 ? matchedGroundTruth.length / detectedHitTimes.length : 0;
const recall =
  simulator.scheduledHitTimes.length > 0
    ? matchedGroundTruth.length / simulator.scheduledHitTimes.length
    : 0;

console.log("Detector demo");
console.log(`Simulated hits: ${simulator.scheduledHitTimes.length}`);
console.log(`Detected hits : ${detectedHitTimes.length}`);
console.log(`Precision     : ${(precision * 100).toFixed(1)}%`);
console.log(`Recall        : ${(recall * 100).toFixed(1)}%`);

const bpm = calculateBpmFromHits(detectedHitTimes);
console.log(`Estimated BPM : ${bpm ? bpm.toFixed(1) : "--"}`);

console.log("\nFirst 10 detected hits");
detectedHitTimes.slice(0, 10).forEach((timeSeconds, index) => {
  console.log(`${String(index + 1).padStart(2, " ")}. ${formatElapsedTime(timeSeconds)}`);
});

if (precision < 0.75 || recall < 0.75) {
  process.exitCode = 1;
}
