import { aggregateExerciseHeatmap, buildTargetTimingResults } from "./heatmap-core.mjs";

const exercise = {
  id: "heatmap-demo",
  title: "Heatmap Demo",
  expectedHits: Array.from({ length: 4 }, (_, index) => ({
    index: index + 1,
    beatPosition: index * 0.5,
    measureNumber: 1,
    rhythmFamily: "eighth notes",
    strokeModifier: "single",
    accentLevel: 0,
  })),
};

const firstAnalysis = {
  matches: [
    { expected: exercise.expectedHits[0], offsetMs: -18, status: "early" },
    { expected: exercise.expectedHits[1], offsetMs: -20, status: "early" },
    { expected: exercise.expectedHits[2], offsetMs: 22, status: "late" },
    { expected: exercise.expectedHits[3], offsetMs: null, status: "missed" },
  ],
};

const secondAnalysis = {
  matches: [
    { expected: exercise.expectedHits[0], offsetMs: -12, status: "early" },
    { expected: exercise.expectedHits[1], offsetMs: -16, status: "early" },
    { expected: exercise.expectedHits[2], offsetMs: 28, status: "late" },
    { expected: exercise.expectedHits[3], offsetMs: 4, status: "accurate" },
  ],
};

const repHistory = [
  {
    exerciseId: exercise.id,
    targetResults: buildTargetTimingResults(firstAnalysis),
  },
  {
    exerciseId: exercise.id,
    targetResults: buildTargetTimingResults(secondAnalysis),
  },
];

const heatmap = aggregateExerciseHeatmap(exercise, repHistory);

console.log("Heatmap demo");
console.log(`Reps       : ${heatmap.repCount}`);
console.log(`Target 1   : ${heatmap.targets[0].tendency} ${heatmap.targets[0].meanOffsetMs.toFixed(1)} ms`);
console.log(`Target 3   : ${heatmap.targets[2].tendency} ${heatmap.targets[2].meanOffsetMs.toFixed(1)} ms`);
console.log(`Target 4 misses: ${heatmap.targets[3].missedCount}/${heatmap.targets[3].totalCount}`);

if (heatmap.targets[0].tendency !== "rush") {
  throw new Error("Expected target 1 to aggregate as rushing.");
}

if (heatmap.targets[2].tendency !== "drag") {
  throw new Error("Expected target 3 to aggregate as dragging.");
}

if (heatmap.targets[3].missedCount !== 1 || heatmap.targets[3].matchedCount !== 1) {
  throw new Error("Expected missed notes to be tracked without breaking later targets.");
}
