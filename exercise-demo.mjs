import {
  matchExercisePerformance,
  withExerciseTempo,
} from "./exercise-core.mjs";

const exercise = withExerciseTempo(
  {
    id: "demo-eighths",
    title: "Demo Eighth Notes",
    defaultTempoBpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    expectedHits: Array.from({ length: 16 }, (_, index) => ({
      index: index + 1,
      beatPosition: index * 0.5,
      durationBeats: 0.5,
      measureNumber: Math.floor(index / 8) + 1,
      label: `Hit ${index + 1}`,
      accentLevel: 0,
      strokeModifier: "single",
    })),
  },
  120
);

const scoreStartTimeSeconds = 2.6;
const offsetsMs = [4, -8, 14, -18, 22, -28, 9, -6, 11, 16, -12, 7, 0, 19, -25, 10];
const hits = exercise.expectedHits.map((hit, index) => ({
  index: index + 1,
  timeSeconds: scoreStartTimeSeconds + hit.timeSeconds + offsetsMs[index] / 1000,
  strength: 0.6,
}));

const result = matchExercisePerformance(exercise, hits, { scoreStartTimeSeconds });

console.log("Exercise demo");
console.log(`Expected hits : ${result.stats.expectedCount}`);
console.log(`Matched hits  : ${result.stats.matchedCount}`);
console.log(`Missed hits   : ${result.stats.missedCount}`);
console.log(`Extra hits    : ${result.stats.extraCount}`);
console.log(`Score         : ${result.score}%`);
console.log(`Mean offset   : ${result.stats.meanOffsetMs.toFixed(1)} ms`);
console.log(`Mean abs      : ${result.stats.meanAbsoluteOffsetMs.toFixed(1)} ms`);

if (result.stats.matchedCount !== exercise.expectedHits.length || result.score < 75) {
  throw new Error("Exercise scoring demo produced an unexpected result.");
}

const fastExercise = withExerciseTempo(exercise, 240);
const missedFastHits = fastExercise.expectedHits
  .filter((_, index) => index !== 5)
  .map((hit, index) => ({
    index: index + 1,
    timeSeconds: scoreStartTimeSeconds + hit.timeSeconds,
    strength: 0.6,
  }));
const missedFastResult = matchExercisePerformance(fastExercise, missedFastHits, {
  scoreStartTimeSeconds,
});
const postMissOffsets = missedFastResult.matches
  .slice(6)
  .filter((match) => match.offsetMs !== null)
  .map((match) => Math.abs(match.offsetMs));

if (
  missedFastResult.stats.missedCount !== 1 ||
  postMissOffsets.some((offset) => offset > 5)
) {
  throw new Error("Exercise matching cascaded after a missed fast note.");
}
