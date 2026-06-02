function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function average(values) {
  const cleanValues = values.filter((value) => Number.isFinite(value));
  if (!cleanValues.length) {
    return null;
  }

  return cleanValues.reduce((sum, value) => sum + value, 0) / cleanValues.length;
}

function median(values) {
  const cleanValues = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (!cleanValues.length) {
    return null;
  }

  const middle = Math.floor(cleanValues.length / 2);
  return cleanValues.length % 2 === 0
    ? (cleanValues[middle - 1] + cleanValues[middle]) / 2
    : cleanValues[middle];
}

function standardDeviation(values) {
  const cleanValues = values.filter((value) => Number.isFinite(value));
  if (cleanValues.length < 2) {
    return null;
  }

  const mean = average(cleanValues);
  const variance =
    cleanValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (cleanValues.length - 1);
  return Math.sqrt(variance);
}

function getLegacyTargetResults(record, exercise) {
  if (!Array.isArray(record.offsets) || !Array.isArray(exercise?.expectedHits)) {
    return [];
  }

  return record.offsets.map((offset, index) => {
    const expected =
      exercise.expectedHits.find(
        (hit) => Math.abs(Number(hit.beatPosition) - Number(offset.beatPosition)) < 0.0001
      ) ?? exercise.expectedHits[index];
    if (!expected) {
      return null;
    }

    return {
      targetIndex: expected.index ?? index + 1,
      beatPosition: expected.beatPosition,
      measureNumber: expected.measureNumber,
      rhythmFamily: expected.rhythmFamily,
      strokeModifier: expected.strokeModifier,
      accentLevel: expected.accentLevel,
      offsetMs: Number(offset.offsetMs),
      matched: Number.isFinite(Number(offset.offsetMs)),
      missed: false,
    };
  }).filter(Boolean);
}

function getRecordTargetResults(record, exercise) {
  return Array.isArray(record.targetResults) && record.targetResults.length
    ? record.targetResults
    : getLegacyTargetResults(record, exercise);
}

function getRecordTimingStats(record, exercise) {
  const offsetsMs = getRecordTargetResults(record, exercise)
    .filter((result) => !result.missed && Number.isFinite(Number(result.offsetMs)))
    .map((result) => -Number(result.offsetMs));

  if (!offsetsMs.length) {
    return {
      matchedCount: 0,
      medianOffsetMs: null,
      meanOffsetMs: null,
      sameDirectionRatio: 0,
    };
  }

  const medianOffsetMs = median(offsetsMs);
  const meanOffsetMs = average(offsetsMs);
  const direction = Math.sign(medianOffsetMs || meanOffsetMs || 0);
  const sameDirectionCount =
    direction === 0
      ? 0
      : offsetsMs.filter((offset) => Math.sign(offset) === direction).length;

  return {
    matchedCount: offsetsMs.length,
    medianOffsetMs,
    meanOffsetMs,
    sameDirectionRatio: sameDirectionCount / offsetsMs.length,
  };
}

function isWholeRepTimingOutlier(stats, expectedCount) {
  const minimumMatchedCount = Math.max(4, Math.ceil(expectedCount * 0.4));
  const medianOffsetMs = Number(stats.medianOffsetMs);
  const meanOffsetMs = Number(stats.meanOffsetMs);
  const globalBiasMs = Math.max(Math.abs(medianOffsetMs), Math.abs(meanOffsetMs));

  return (
    stats.matchedCount >= minimumMatchedCount &&
    stats.sameDirectionRatio >= 0.8 &&
    globalBiasMs >= 65
  );
}

function filterOutlierRecords(records, exercise) {
  if (records.length < 3) {
    return { includedRecords: records, excludedRecords: [] };
  }

  const expectedCount = Array.isArray(exercise?.expectedHits) ? exercise.expectedHits.length : 0;
  const annotatedRecords = records.map((record) => ({
    record,
    stats: getRecordTimingStats(record, exercise),
  }));
  const includedRecords = annotatedRecords
    .filter(({ stats }) => !isWholeRepTimingOutlier(stats, expectedCount))
    .map(({ record }) => record);
  const excludedRecords = annotatedRecords
    .filter(({ stats }) => isWholeRepTimingOutlier(stats, expectedCount))
    .map(({ record }) => record);

  if (includedRecords.length === 0) {
    return { includedRecords: records, excludedRecords: [] };
  }

  return { includedRecords, excludedRecords };
}

export function buildTargetTimingResults(analysis) {
  if (!analysis?.matches) {
    return [];
  }

  return analysis.matches.map((match) => {
    const expected = match.expected ?? {};
    const offsetMs = Number(match.offsetMs);
    const matched = Number.isFinite(offsetMs);
    return {
      targetIndex: expected.index,
      beatPosition: Number(Number(expected.beatPosition ?? 0).toFixed(4)),
      measureNumber: expected.measureNumber ?? null,
      rhythmFamily: expected.rhythmFamily ?? "unclassified notes",
      strokeModifier: expected.strokeModifier ?? "single",
      accentLevel: Number(expected.accentLevel) || 0,
      offsetMs: matched ? Number(offsetMs.toFixed(2)) : null,
      matched,
      missed: !matched || match.status === "missed",
    };
  });
}

export function aggregateExerciseHeatmap(exercise, repHistory) {
  const expectedHits = Array.isArray(exercise?.expectedHits) ? exercise.expectedHits : [];
  const records = Array.isArray(repHistory)
    ? repHistory.filter((record) => record.exerciseId === exercise?.id)
    : [];
  const { includedRecords, excludedRecords } = filterOutlierRecords(records, exercise);

  const resultMap = new Map();
  for (const record of includedRecords) {
    for (const result of getRecordTargetResults(record, exercise)) {
      const targetIndex = Number(result.targetIndex);
      if (!Number.isFinite(targetIndex)) {
        continue;
      }

      const aggregate = resultMap.get(targetIndex) ?? {
        matchedOffsetsMs: [],
        missedCount: 0,
        totalCount: 0,
      };
      aggregate.totalCount += 1;
      if (result.missed || !Number.isFinite(Number(result.offsetMs))) {
        aggregate.missedCount += 1;
      } else {
        aggregate.matchedOffsetsMs.push(Number(result.offsetMs));
      }
      resultMap.set(targetIndex, aggregate);
    }
  }

  const targets = expectedHits.map((expected, index) => {
    const targetIndex = Number(expected.index ?? index + 1);
    const aggregate = resultMap.get(targetIndex) ?? {
      matchedOffsetsMs: [],
      missedCount: 0,
      totalCount: 0,
    };
    const performanceOffsetsMs = aggregate.matchedOffsetsMs.map((offset) => -offset);
    const meanOffsetMs = average(performanceOffsetsMs);
    const medianOffsetMs = median(performanceOffsetsMs);
    const meanAbsoluteOffsetMs = average(performanceOffsetsMs.map((offset) => Math.abs(offset)));
    const jitterMs = standardDeviation(performanceOffsetsMs);
    const matchedCount = aggregate.matchedOffsetsMs.length;
    const totalCount = aggregate.totalCount;
    const missRate = totalCount > 0 ? aggregate.missedCount / totalCount : 0;
    const tendency =
      meanOffsetMs === null || Math.abs(meanOffsetMs) < 10
        ? "neutral"
        : meanOffsetMs > 0
          ? "rush"
          : "drag";

    return {
      targetIndex,
      beatPosition: expected.beatPosition ?? 0,
      measureNumber: expected.measureNumber ?? null,
      rhythmFamily: expected.rhythmFamily ?? "unclassified notes",
      strokeModifier: expected.strokeModifier ?? "single",
      accentLevel: Number(expected.accentLevel) || 0,
      matchedCount,
      missedCount: aggregate.missedCount,
      totalCount,
      missRate,
      meanOffsetMs,
      medianOffsetMs,
      meanAbsoluteOffsetMs,
      jitterMs,
      tendency,
      intensity:
        meanOffsetMs === null
          ? 0
          : clamp(Math.abs(meanOffsetMs) / 60, 0.12, 1),
    };
  });

  const matchedTargets = targets.filter((target) => target.matchedCount > 0);
  const meanOffsets = matchedTargets
    .map((target) => target.meanOffsetMs)
    .filter((offset) => Number.isFinite(offset));

  return {
    exerciseId: exercise?.id ?? null,
    exerciseTitle: exercise?.title ?? "Exercise",
    repCount: includedRecords.length,
    totalRepCount: records.length,
    excludedRepCount: excludedRecords.length,
    targets,
    matchedTargetCount: matchedTargets.length,
    overallMeanOffsetMs: average(meanOffsets),
    overallMeanAbsoluteOffsetMs: average(meanOffsets.map((offset) => Math.abs(offset))),
  };
}
