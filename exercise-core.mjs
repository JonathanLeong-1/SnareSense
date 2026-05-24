export const EXERCISE_SCORE_MAX = 100;
export const EXERCISE_MATCH_WINDOW_MS = 150;

const NOTE_TYPE_TO_QUARTER_BEATS = {
  "1024th": 1 / 256,
  "512th": 1 / 128,
  "256th": 1 / 64,
  "128th": 1 / 32,
  "64th": 1 / 16,
  "32nd": 1 / 8,
  "16th": 1 / 4,
  eighth: 1 / 2,
  quarter: 1,
  half: 2,
  whole: 4,
  breve: 8,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function median(values) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function average(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length < 2) {
    return null;
  }

  const mean = average(values);
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function parseNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function getElementText(parent, tagName, fallback = "") {
  const element = parent?.getElementsByTagName(tagName)?.[0];
  return element?.textContent?.trim() || fallback;
}

function getDirectChildren(parent, tagName = null) {
  if (!parent?.children) {
    return [];
  }

  return Array.from(parent.children).filter(
    (child) => tagName === null || child.tagName === tagName
  );
}

function getDirectChild(parent, tagName) {
  return getDirectChildren(parent, tagName)[0] ?? null;
}

function getDirectChildText(parent, tagName, fallback = "") {
  return getDirectChild(parent, tagName)?.textContent?.trim() || fallback;
}

function hasDescendant(parent, tagName) {
  return Boolean(parent?.getElementsByTagName(tagName)?.length);
}

function getTitle(documentRoot) {
  const titleCredit = Array.from(documentRoot.getElementsByTagName("credit")).find(
    (credit) => getElementText(credit, "credit-type").toLowerCase() === "title"
  );
  const creditTitle = getElementText(titleCredit, "credit-words");
  return creditTitle || getElementText(documentRoot, "work-title", "Untitled exercise");
}

function getDefaultTempo(documentRoot) {
  const soundTempo = Array.from(documentRoot.getElementsByTagName("sound"))
    .map((sound) => parseNumber(sound.getAttribute("tempo"), null))
    .find((tempo) => Number.isFinite(tempo) && tempo > 0);

  if (soundTempo) {
    return Math.round(soundTempo);
  }

  const perMinute = Array.from(documentRoot.getElementsByTagName("per-minute"))
    .map((element) => parseNumber(element.textContent, null))
    .find((tempo) => Number.isFinite(tempo) && tempo > 0);

  return Math.round(perMinute || 120);
}

function getScoreParts(documentRoot) {
  return Array.from(documentRoot.getElementsByTagName("score-part")).map((part) => ({
    id: part.getAttribute("id"),
    name: getElementText(part, "part-name", part.getAttribute("id") || "Part"),
  }));
}

function getPartElement(documentRoot, partId) {
  return Array.from(documentRoot.getElementsByTagName("part")).find(
    (part) => part.getAttribute("id") === partId
  );
}

function getNoteDurationInQuarterBeats(note, divisions) {
  const duration = parseNumber(getDirectChildText(note, "duration"), null);
  if (Number.isFinite(duration) && duration > 0 && divisions > 0) {
    return duration / divisions;
  }

  const type = getDirectChildText(note, "type");
  return NOTE_TYPE_TO_QUARTER_BEATS[type] ?? 0;
}

function getAccentLevel(note) {
  const notations = getDirectChild(note, "notations");
  if (!notations) {
    return 0;
  }

  if (hasDescendant(notations, "strong-accent")) {
    return 2;
  }

  if (hasDescendant(notations, "accent")) {
    return 1;
  }

  return 0;
}

function getStrokeModifier(note) {
  const notations = getDirectChild(note, "notations");
  if (!notations) {
    return "single";
  }

  const tremolo = notations.getElementsByTagName("tremolo")?.[0];
  if (tremolo && tremolo.getAttribute("type") !== "stop") {
    return "diddle";
  }

  const notationText = notations.textContent?.toLowerCase() || "";
  if (notationText.includes("buzz") || /\bz\b/.test(notationText)) {
    return "buzz";
  }

  return "single";
}

function getTupletRatio(note) {
  const timeModification = getDirectChild(note, "time-modification");
  if (!timeModification) {
    return null;
  }

  const actualNotes = parseNumber(getDirectChildText(timeModification, "actual-notes"), null);
  const normalNotes = parseNumber(getDirectChildText(timeModification, "normal-notes"), null);
  if (!Number.isFinite(actualNotes) || !Number.isFinite(normalNotes) || normalNotes <= 0) {
    return null;
  }

  return { actualNotes, normalNotes };
}

function getRhythmFamily(note, durationQuarterBeats) {
  const tupletRatio = getTupletRatio(note);
  if (tupletRatio?.actualNotes === 3) {
    return "triplets";
  }

  const noteType = getDirectChildText(note, "type");
  if (noteType) {
    return `${noteType} notes`;
  }

  const closestType = Object.entries(NOTE_TYPE_TO_QUARTER_BEATS).find(
    ([, beats]) => Math.abs(beats - durationQuarterBeats) < 0.0001
  )?.[0];
  return closestType ? `${closestType} notes` : "unclassified notes";
}

function getMeasureTimeSignature(measure, currentTimeSignature) {
  const attributes = getDirectChild(measure, "attributes");
  const time = attributes ? getDirectChild(attributes, "time") : null;
  if (!time) {
    return currentTimeSignature;
  }

  return {
    numerator: clamp(parseNumber(getDirectChildText(time, "beats"), currentTimeSignature.numerator), 1, 64),
    denominator: clamp(
      parseNumber(getDirectChildText(time, "beat-type"), currentTimeSignature.denominator),
      1,
      64
    ),
  };
}

function extractPartEvents(documentRoot, partInfo) {
  const part = getPartElement(documentRoot, partInfo.id);
  if (!part) {
    return {
      ...partInfo,
      expectedHits: [],
      timeSignature: { numerator: 4, denominator: 4 },
      totalQuarterBeats: 0,
    };
  }

  let divisions = 1;
  let timeSignature = { numerator: 4, denominator: 4 };
  let firstTimeSignature = null;
  let measureStartBeat = 0;
  let lastAttackEndBeat = 0;
  const expectedHits = [];
  const writtenNoteAnchors = [];

  for (const measure of getDirectChildren(part, "measure")) {
    const attributes = getDirectChild(measure, "attributes");
    const divisionsText = attributes ? getDirectChildText(attributes, "divisions") : "";
    if (divisionsText) {
      divisions = Math.max(1, parseNumber(divisionsText, divisions));
    }

    timeSignature = getMeasureTimeSignature(measure, timeSignature);
    if (!firstTimeSignature) {
      firstTimeSignature = { ...timeSignature };
    }

    let cursorBeat = measureStartBeat;
    const measureLengthQuarterBeats = timeSignature.numerator * (4 / timeSignature.denominator);

    for (const child of getDirectChildren(measure)) {
      if (child.tagName === "backup") {
        cursorBeat -= parseNumber(getDirectChildText(child, "duration"), 0) / divisions;
        continue;
      }

      if (child.tagName === "forward") {
        cursorBeat += parseNumber(getDirectChildText(child, "duration"), 0) / divisions;
        continue;
      }

      if (child.tagName !== "note") {
        continue;
      }

      const durationQuarterBeats = getNoteDurationInQuarterBeats(child, divisions);
      const isChord = Boolean(getDirectChild(child, "chord"));
      const isGrace = Boolean(getDirectChild(child, "grace"));
      const isRest = Boolean(getDirectChild(child, "rest"));

      if (!isRest && !isChord && !isGrace) {
        const strokeModifier = getStrokeModifier(child);
        const hitSplits = strokeModifier === "diddle" ? 2 : 1;
        const splitDurationBeats = durationQuarterBeats / hitSplits;
        const measureNumber = parseNumber(measure.getAttribute("number"), expectedHits.length + 1);
        const accentLevel = getAccentLevel(child);
        const rhythmFamily = getRhythmFamily(child, durationQuarterBeats);
        const noteType = getDirectChildText(child, "type") || rhythmFamily.replace(/ notes$/, "");
        const beatInMeasure = Number((cursorBeat - measureStartBeat).toFixed(6));
        writtenNoteAnchors.push({
          index: writtenNoteAnchors.length + 1,
          beatPosition: Number(cursorBeat.toFixed(6)),
          timeSeconds: 0,
          durationBeats: Number(durationQuarterBeats.toFixed(6)),
          measureNumber,
          strokeModifier,
          rhythmFamily,
          noteType,
          beatInMeasure,
        });

        for (let splitIndex = 0; splitIndex < hitSplits; splitIndex += 1) {
          const beatPosition = Number((cursorBeat + splitDurationBeats * splitIndex).toFixed(6));
          const durationBeats = Number(splitDurationBeats.toFixed(6));
          expectedHits.push({
            index: expectedHits.length + 1,
            beatPosition,
            timeSeconds: 0,
            durationBeats,
            measureNumber,
            label: `M${measureNumber} · ${beatPosition.toFixed(2)}`,
            accentLevel: splitIndex === 0 ? accentLevel : Math.max(0, accentLevel - 1),
            strokeModifier,
            rhythmFamily,
            noteType,
            splitIndex,
            splitCount: hitSplits,
            beatInMeasure: Number((beatInMeasure + splitDurationBeats * splitIndex).toFixed(6)),
            isDiddleContinuation: strokeModifier === "diddle" && splitIndex > 0,
          });
          lastAttackEndBeat = Math.max(lastAttackEndBeat, beatPosition + durationBeats);
        }
      }

      if (!isChord && !isGrace) {
        cursorBeat += durationQuarterBeats;
      }
    }

    measureStartBeat += measureLengthQuarterBeats;
  }

  return {
    ...partInfo,
    expectedHits,
    writtenNoteAnchors,
    timeSignature: firstTimeSignature ?? timeSignature,
    totalQuarterBeats: Math.max(lastAttackEndBeat, expectedHits.at(-1)?.beatPosition ?? 0),
  };
}

export function parseMusicXmlText(xmlText, { fileName = "uploaded.mxl" } = {}) {
  if (typeof DOMParser === "undefined") {
    throw new Error("MusicXML parsing requires a browser DOMParser.");
  }

  const documentRoot = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = documentRoot.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new Error("The MusicXML file could not be parsed.");
  }

  const root = documentRoot.documentElement;
  const parts = getScoreParts(root).map((partInfo) => extractPartEvents(root, partInfo));
  const selectedPart = [...parts].sort(
    (left, right) => right.expectedHits.length - left.expectedHits.length
  )[0];

  if (!selectedPart || selectedPart.expectedHits.length === 0) {
    throw new Error("No playable snare hits were found in this MusicXML file.");
  }

  const defaultTempoBpm = clamp(getDefaultTempo(root), 30, 300);
  const title = getTitle(root);

  return withExerciseTempo({
    id: fileName.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-") || "exercise",
    title,
    fileName,
    defaultTempoBpm,
    tempoBpm: defaultTempoBpm,
    timeSignature: selectedPart.timeSignature,
    selectedPartId: selectedPart.id,
    selectedPartName: selectedPart.name,
    parts: parts.map((part) => ({
      id: part.id,
      name: part.name,
      hitCount: part.expectedHits.length,
    })),
    expectedHits: selectedPart.expectedHits,
    writtenNoteAnchors: selectedPart.writtenNoteAnchors,
    totalQuarterBeats: selectedPart.totalQuarterBeats,
    warnings: buildExerciseWarnings(parts, selectedPart),
  }, defaultTempoBpm);
}

function buildExerciseWarnings(parts, selectedPart) {
  const warnings = [];
  if (parts.length > 1) {
    warnings.push(
      `Multiple parts found. Using ${selectedPart.name} because it has ${selectedPart.expectedHits.length} attacks.`
    );
  }

  const emptyParts = parts.filter((part) => part.expectedHits.length === 0);
  if (emptyParts.length > 0) {
    warnings.push(`${emptyParts.length} part(s) contain only rests and were ignored.`);
  }

  return warnings;
}

export function withExerciseTempo(exercise, tempoBpm) {
  const safeTempo = clamp(Number(tempoBpm) || exercise.defaultTempoBpm || 120, 30, 300);
  const secondsPerBeat = 60 / safeTempo;
  const expectedHits = exercise.expectedHits.map((hit) => ({
    ...hit,
    timeSeconds: hit.beatPosition * secondsPerBeat,
  }));
  const writtenNoteAnchors = (exercise.writtenNoteAnchors ?? []).map((anchor) => ({
    ...anchor,
    timeSeconds: anchor.beatPosition * secondsPerBeat,
  }));

  return {
    ...exercise,
    tempoBpm: safeTempo,
    expectedHits,
    writtenNoteAnchors,
    durationSeconds: Math.max(
      0,
      ...expectedHits.map((hit) => hit.timeSeconds + hit.durationBeats * secondsPerBeat)
    ),
  };
}

export function buildExerciseClickEvents(
  exercise,
  { countInBeats = null, startDelaySeconds = 0.6, tapOffPattern = null } = {}
) {
  const secondsPerBeat = 60 / exercise.tempoBpm;
  const countInClicks = [];
  let countInDurationSeconds = 0;

  if (Array.isArray(tapOffPattern) && tapOffPattern.length > 0) {
    const tapOffStepBeats = 0.5;
    countInDurationSeconds = tapOffPattern.length * tapOffStepBeats * secondsPerBeat;
    tapOffPattern.forEach((accentLevel, index) => {
      if (accentLevel === null || accentLevel === undefined) {
        return;
      }

      countInClicks.push({
        timeSeconds: startDelaySeconds + index * tapOffStepBeats * secondsPerBeat,
        beatPosition: index * tapOffStepBeats,
        accentLevel: clamp(Number(accentLevel) || 0, 0, 2),
        type: "count-in",
      });
    });
  } else {
    const beatsInCountIn = countInBeats ?? exercise.timeSignature.numerator;
    countInDurationSeconds = beatsInCountIn * secondsPerBeat;
    for (let index = 0; index < beatsInCountIn; index += 1) {
      countInClicks.push({
        timeSeconds: startDelaySeconds + index * secondsPerBeat,
        beatPosition: index,
        accentLevel: index === 0 ? 2 : 1,
        type: "count-in",
      });
    }
  }

  const scoreStartTimeSeconds = startDelaySeconds + countInDurationSeconds;

  const expectedClicks = exercise.expectedHits.map((hit) => ({
    timeSeconds: scoreStartTimeSeconds + hit.timeSeconds,
    beatPosition: hit.beatPosition,
    accentLevel: hit.accentLevel,
    type: "expected",
    expectedHitIndex: hit.index,
  }));

  return {
    countInClicks,
    expectedClicks,
    scoreStartTimeSeconds,
    sessionEndTimeSeconds: scoreStartTimeSeconds + exercise.durationSeconds,
  };
}

export function matchExercisePerformance(
  exercise,
  hits,
  {
    scoreStartTimeSeconds = 0,
    matchWindowMs = EXERCISE_MATCH_WINDOW_MS,
    includeEarlyLeadInMs = 250,
    includeTailMs = 400,
  } = {}
) {
  const windowSeconds = matchWindowMs / 1000;
  const sessionStart = scoreStartTimeSeconds - includeEarlyLeadInMs / 1000;
  const sessionEnd = scoreStartTimeSeconds + exercise.durationSeconds + includeTailMs / 1000;
  const candidateHits = hits
    .map((hit, index) => ({
      ...hit,
      originalIndex: index,
      exerciseTimeSeconds: hit.timeSeconds - scoreStartTimeSeconds,
      exerciseBeatPosition: (hit.timeSeconds - scoreStartTimeSeconds) * exercise.tempoBpm / 60,
    }))
    .filter((hit) => hit.timeSeconds >= sessionStart && hit.timeSeconds <= sessionEnd)
    .sort((left, right) => left.timeSeconds - right.timeSeconds);

  const expectedHits = exercise.expectedHits;
  const expectedCount = expectedHits.length;
  const hitCount = candidateHits.length;
  const missCost = 1.05;
  const extraCost = 0.45;
  const dp = Array.from({ length: expectedCount + 1 }, () =>
    Array.from({ length: hitCount + 1 }, () => ({ cost: Infinity, action: null }))
  );
  dp[0][0] = { cost: 0, action: null };

  for (let expectedIndex = 0; expectedIndex <= expectedCount; expectedIndex += 1) {
    for (let hitIndex = 0; hitIndex <= hitCount; hitIndex += 1) {
      const current = dp[expectedIndex][hitIndex];
      if (!Number.isFinite(current.cost)) {
        continue;
      }

      if (expectedIndex < expectedCount) {
        const nextCost = current.cost + missCost;
        if (nextCost < dp[expectedIndex + 1][hitIndex].cost) {
          dp[expectedIndex + 1][hitIndex] = { cost: nextCost, action: "miss" };
        }
      }

      if (hitIndex < hitCount) {
        const nextCost = current.cost + extraCost;
        if (nextCost < dp[expectedIndex][hitIndex + 1].cost) {
          dp[expectedIndex][hitIndex + 1] = { cost: nextCost, action: "extra" };
        }
      }

      if (expectedIndex < expectedCount && hitIndex < hitCount) {
        const expected = expectedHits[expectedIndex];
        const hit = candidateHits[hitIndex];
        const offsetSeconds = hit.exerciseTimeSeconds - expected.timeSeconds;
        const absOffset = Math.abs(offsetSeconds);
        if (absOffset <= windowSeconds) {
          const normalizedOffset = absOffset / windowSeconds;
          const matchCost = 0.04 + normalizedOffset ** 1.35;
          const nextCost = current.cost + matchCost;
          if (nextCost < dp[expectedIndex + 1][hitIndex + 1].cost) {
            dp[expectedIndex + 1][hitIndex + 1] = { cost: nextCost, action: "match" };
          }
        }
      }
    }
  }

  const matches = [];
  const extraHitIndexes = new Set();
  let expectedIndex = expectedCount;
  let hitIndex = hitCount;

  while (expectedIndex > 0 || hitIndex > 0) {
    const action = dp[expectedIndex][hitIndex].action;
    if (action === "match") {
      const expected = expectedHits[expectedIndex - 1];
      const hit = {
        ...candidateHits[hitIndex - 1],
        candidateIndex: hitIndex - 1,
      };
      const offsetMs = (hit.exerciseTimeSeconds - expected.timeSeconds) * 1000;
      matches.push({
        expected,
        hit,
        offsetMs,
        status: Math.abs(offsetMs) <= 20 ? "accurate" : offsetMs < 0 ? "early" : "late",
      });
      expectedIndex -= 1;
      hitIndex -= 1;
      continue;
    }

    if (action === "miss") {
      matches.push({
        expected: expectedHits[expectedIndex - 1],
        hit: null,
        offsetMs: null,
        status: "missed",
      });
      expectedIndex -= 1;
      continue;
    }

    if (action === "extra") {
      extraHitIndexes.add(hitIndex - 1);
      hitIndex -= 1;
      continue;
    }

    break;
  }

  matches.reverse();
  const extraHits = candidateHits.filter((_, index) => extraHitIndexes.has(index));
  return scoreExercisePerformance(exercise, matches, extraHits);
}

export function scoreExercisePerformance(exercise, matches, extraHits = []) {
  const expectedCount = Math.max(1, exercise.expectedHits.length);
  const pointValue = EXERCISE_SCORE_MAX / expectedCount;
  let score = 0;
  const offsetsMs = [];

  for (const match of matches) {
    if (match.offsetMs === null) {
      continue;
    }

    const absOffset = Math.abs(match.offsetMs);
    offsetsMs.push(match.offsetMs);
    const timingAccuracy = Math.max(0, 1 - absOffset / 120);
    score += pointValue * timingAccuracy ** 1.35;
  }

  const extraPenalty = Math.min(EXERCISE_SCORE_MAX * 0.2, extraHits.length * pointValue * 0.35);
  const finalScore = clamp(Math.round(score - extraPenalty), 0, EXERCISE_SCORE_MAX);
  const absoluteOffsets = offsetsMs.map((offset) => Math.abs(offset));
  const earlyCount = offsetsMs.filter((offset) => offset < -20).length;
  const lateCount = offsetsMs.filter((offset) => offset > 20).length;

  const contextAnalysis = analyzeExerciseContexts(matches);

  return {
    score: finalScore,
    matches,
    extraHits,
    contextStats: contextAnalysis.contextStats,
    insights: contextAnalysis.insights,
    stats: {
      expectedCount: exercise.expectedHits.length,
      matchedCount: offsetsMs.length,
      missedCount: matches.filter((match) => match.status === "missed").length,
      extraCount: extraHits.length,
      meanOffsetMs: average(offsetsMs),
      medianOffsetMs: median(offsetsMs),
      meanAbsoluteOffsetMs: average(absoluteOffsets),
      jitterMs: standardDeviation(offsetsMs),
      earlyCount,
      lateCount,
    },
  };
}

function addContextOffset(groups, id, label, offsetMs, options = {}) {
  if (!Number.isFinite(offsetMs)) {
    return;
  }

  const existing = groups.get(id) ?? {
    id,
    label,
    offsetsMs: [],
    kind: options.kind ?? "category",
    minCount: options.minCount ?? 3,
  };
  existing.offsetsMs.push(offsetMs);
  groups.set(id, existing);
}

function summarizeContextGroup(group) {
  const meanOffsetMs = average(group.offsetsMs);
  const meanAbsoluteOffsetMs = average(group.offsetsMs.map((offset) => Math.abs(offset)));
  const jitterMs = standardDeviation(group.offsetsMs);
  return {
    id: group.id,
    label: group.label,
    kind: group.kind,
    count: group.offsetsMs.length,
    minCount: group.minCount,
    meanOffsetMs,
    meanAbsoluteOffsetMs,
    jitterMs,
    tendency:
      Math.abs(meanOffsetMs ?? 0) < 8
        ? "centered"
        : meanOffsetMs > 0
          ? "rush"
          : "drag",
  };
}

function formatContextOffset(valueMs) {
  return `${Math.abs(valueMs).toFixed(0)} ms`;
}

function buildContextInsight(stat) {
  if (stat.tendency === "centered") {
    return `${stat.label} are centered overall.`;
  }

  const verb = stat.tendency === "rush" ? "rush" : "drag";
  if (stat.kind === "transition") {
    return `Your ${stat.label} tends to ${verb} by ${formatContextOffset(stat.meanOffsetMs)}.`;
  }

  if (stat.kind === "post-accent") {
    return `You tend to ${verb} by ${formatContextOffset(stat.meanOffsetMs)} right after accents.`;
  }

  return `Your ${stat.label} tend to ${verb} by ${formatContextOffset(stat.meanOffsetMs)}.`;
}

function analyzeExerciseContexts(matches) {
  const groups = new Map();
  const matched = matches.filter((match) => match.offsetMs !== null);

  for (const match of matched) {
    const expected = match.expected;
    const performanceOffsetMs = -match.offsetMs;
    const rhythmFamily = expected.rhythmFamily || "unclassified notes";
    const strokeModifier = expected.strokeModifier || "single";

    addContextOffset(groups, `rhythm:${rhythmFamily}`, rhythmFamily, performanceOffsetMs);
    addContextOffset(
      groups,
      `stroke:${strokeModifier}`,
      strokeModifier === "diddle" ? "diddles" : strokeModifier === "buzz" ? "buzzes" : "single taps",
      performanceOffsetMs
    );

    if (expected.isDiddleContinuation) {
      addContextOffset(groups, "diddle-continuations", "diddle second notes", performanceOffsetMs, {
        minCount: 2,
      });
    }

    if (expected.accentLevel > 0) {
      addContextOffset(groups, "accents", "accented notes", performanceOffsetMs, { minCount: 2 });
    } else {
      addContextOffset(groups, "taps", "unaccented taps", performanceOffsetMs);
    }
  }

  for (let index = 1; index < matches.length; index += 1) {
    const previous = matches[index - 1];
    const current = matches[index];
    if (previous.offsetMs === null || current.offsetMs === null) {
      continue;
    }

    const currentPerformanceOffsetMs = -current.offsetMs;
    if (previous.expected.accentLevel > 0) {
      addContextOffset(groups, "post-accent", "post-accent notes", currentPerformanceOffsetMs, {
        kind: "post-accent",
        minCount: 2,
      });
    }

    const previousRhythm = previous.expected.rhythmFamily || "unclassified notes";
    const currentRhythm = current.expected.rhythmFamily || "unclassified notes";
    if (previousRhythm !== currentRhythm) {
      addContextOffset(
        groups,
        `transition:${previousRhythm}->${currentRhythm}`,
        `transition from ${previousRhythm} to ${currentRhythm}`,
        currentPerformanceOffsetMs,
        { kind: "transition", minCount: 2 }
      );
    }
  }

  const contextStats = [...groups.values()]
    .map(summarizeContextGroup)
    .filter((stat) => stat.count >= stat.minCount)
    .sort(
      (left, right) =>
        Math.abs(right.meanOffsetMs ?? 0) - Math.abs(left.meanOffsetMs ?? 0) ||
        (right.meanAbsoluteOffsetMs ?? 0) - (left.meanAbsoluteOffsetMs ?? 0)
    );

  const actionableStats = contextStats.filter(
    (stat) => Math.abs(stat.meanOffsetMs ?? 0) >= 10 || (stat.meanAbsoluteOffsetMs ?? 0) >= 28
  );
  const insights = actionableStats.slice(0, 5).map(buildContextInsight);

  if (matched.length > 0 && insights.length === 0) {
    insights.push("Timing is broadly centered across the analyzed categories.");
  }

  return { contextStats, insights };
}
