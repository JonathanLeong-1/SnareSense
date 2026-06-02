import {
  DrumHitDetector,
  DrumTriggerSimulator,
  calculateBpmFromHits,
  formatElapsedTime,
} from "./detector-core.mjs";
import {
  buildExerciseClickEvents,
  matchExercisePerformance,
  parseMusicXmlText,
  withExerciseTempo,
} from "./exercise-core.mjs";
import {
  aggregateExerciseHeatmap,
  buildTargetTimingResults,
} from "./heatmap-core.mjs";

const SIMULATION_CHUNK_SIZE = 256;
const TIMELINE_BASE_PX_PER_BEAT = 64;
const TIMELINE_MIN_BEATS = 8;
const TIMELINE_HEIGHT = 320;
const TIMELINE_FULLSCREEN_HEIGHT = 720;
const TIMELINE_FOLLOW_VIEWPORT_RATIO = 0.72;
const TIMELINE_LEFT_PADDING = 72;
const TIMELINE_RIGHT_PADDING = 36;
const TIMELINE_ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6];
const TIMELINE_WIDTH_CHUNK_BEATS = 64;
const TIMELINE_LIVE_FOLLOW_BUFFER_BEATS = 96;
const FULLSCREEN_SIDEBAR_COLLAPSED_WIDTH = 34;
const METRONOME_START_OFFSET_SECONDS = 0.06;
const METRONOME_MIN_TEMPO = 40;
const METRONOME_MAX_TEMPO = 240;
const METRONOME_LOOKAHEAD_SECONDS = 0.18;
const METRONOME_SCHEDULER_INTERVAL_MS = 25;
const CALIBRATION_TEMPO = 120;
const CALIBRATION_SUBDIVISION = "eighth";
const CALIBRATION_NUMERATOR = 4;
const CALIBRATION_DENOMINATOR = 4;
const CALIBRATION_INTRO_BARS = 2;
const CALIBRATION_CAPTURE_BARS = 4;
const CALIBRATION_MATCH_WINDOW_MS = 160;
const CALIBRATION_MIN_USABLE_HITS = 8;
const CALIBRATION_OVERLAY_CLOSE_MS = 190;
const CALIBRATION_TAP_OFF_PATTERN = [2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 2, 1, 2, 2, 2, null];
const TRIPLET_TAP_OFF_EXERCISE_IDS = new Set(["triplet-rolls", "triplet-grid", "pats"]);
const TRIPLET_TAP_OFF_PATTERN = [
  2, 1, 1, 1, 1, 1,
  2, 1, 1, 1, 1, 1,
  2, 1, 1,
  2, 1, 1,
  2, 2, 2, 2,
  null, null,
];
const CALIBRATION_OFFSET_SEARCH_MIN_MS = -40;
const CALIBRATION_OFFSET_SEARCH_MAX_MS = 220;
const MODE_INFO_COPY = {
  settings: {
    eyebrow: "Calibration",
    title: "Calibrate your input before reps",
    copy: "Tune timing, dynamics, noise floor, and fast-stroke detection from one guided test.",
  },
  live: {
    eyebrow: "Live Timeline",
    title: "Monitor clicks and detected hits",
    copy: "Watch incoming audio, metronome timing, and detector response in real time.",
  },
  exercise: {
    eyebrow: "Exercise Analysis",
    title: "Written snare reps with timing feedback",
    copy: "Load an exercise, play the rep, then review rushing, dragging, and dynamics.",
  },
  stats: {
    eyebrow: "Stats",
    title: "Track progress across sessions",
    copy: "Review lifetime totals, exercise rankings, tendencies, and locally saved history.",
  },
};
const SINGLE_CALIBRATION_PHASES = [
  {
    id: "noise",
    label: "Silent tap-off",
    circleText: "Get ready to play 3 inch eighths",
    instruction: "Stay silent through the tap-off. This measures the room and trigger noise floor.",
    bars: 2,
    metronome: "tap-off",
    collectNoise: true,
  },
  {
    id: "height-3",
    label: "3 inch eighths",
    circleText: "Play 3 inch eighths",
    instruction: "Play steady eighth notes from a 3 inch stick height with the metronome.",
    bars: 2,
    metronome: "eighths",
    dynamicLevel: "3in",
    targetHeightInches: 3,
  },
  {
    id: "height-6",
    label: "6 inch eighths",
    circleText: "Play 6 inch eighths",
    instruction: "Keep the same eighth-note timing, now from a 6 inch stick height.",
    bars: 2,
    metronome: "eighths",
    dynamicLevel: "6in",
    targetHeightInches: 6,
  },
  {
    id: "height-9",
    label: "9 inch eighths",
    circleText: "Play 9 inch eighths",
    instruction: "Keep the same eighth-note timing, now from a 9 inch stick height.",
    bars: 2,
    metronome: "eighths",
    dynamicLevel: "9in",
    targetHeightInches: 9,
  },
  {
    id: "height-12",
    label: "12 inch eighths",
    circleText: "Play 12 inch eighths",
    instruction: "Keep playing eighth notes, now from a 12 inch stick height for your loud range.",
    bars: 2,
    metronome: "eighths",
    dynamicLevel: "12in",
    targetHeightInches: 12,
  },
  {
    id: "roll-prep",
    label: "Roll prep",
    circleText: "Get ready to play a quiet double-stroke roll",
    instruction: "Stay silent and get ready to play a quiet double-stroke roll, out of time.",
    durationSeconds: 3,
    metronome: "off",
    collectNoise: true,
  },
  {
    id: "fast-soft",
    label: "Minimum-volume roll",
    circleText: "Very quiet double-stroke roll",
    instruction: "Metronome off: play a very quiet double-stroke roll, out of time.",
    durationSeconds: 4,
    metronome: "off",
    dynamicLevel: "fastSoft",
  },
  {
    id: "fast-loud",
    label: "Full-volume speed",
    circleText: "Play fast at full volume",
    instruction: "Metronome off: play fast at full volume with clean separation.",
    durationSeconds: 4,
    metronome: "off",
    dynamicLevel: "fastLoud",
  },
];
const AUTO_DETECTION_PHASES = [
  {
    id: "noise",
    label: "Quiet noise",
    durationSeconds: 2.2,
    circleText: "don't play anything",
    instruction: "Stay silent and keep the drum still so the app can measure the noise floor.",
  },
  {
    id: "soft",
    label: "Soft fast taps",
    durationSeconds: 5,
    circleText: "play fast pianissimo taps",
    instruction: "Play very fast pianissimo taps. Use the softest hits you still want detected.",
  },
  {
    id: "loud",
    label: "Loud taps",
    durationSeconds: 3,
    circleText: "play loud hits",
    instruction: "Play several loud taps or accents so the app can measure your upper range.",
  },
];
const AUTO_DETECTION_MIN_SOFT_HITS = 5;
const EXERCISE_TIMELINE_HEIGHT = 380;
const EXERCISE_OFFSET_GRAPH_HEIGHT = 380;
const EXERCISE_DYNAMICS_GRAPH_HEIGHT = 300;
const EXERCISE_START_DELAY_SECONDS = 0.6;
const EXERCISE_LISTEN_START_DELAY_SECONDS = 0.25;
const EXERCISE_GUIDE_LOOKAHEAD_SECONDS = 0.2;
const EXERCISE_GUIDE_INTERVAL_MS = 25;
const HEATMAP_MAX_REPS_PER_EXERCISE = 100;
const EXERCISE_STORAGE_KEY = "snareExerciseHighScores";
const EXERCISE_REP_HISTORY_KEY = "snareExerciseRepHistory";
const APP_STATS_STORAGE_KEY = "snareAppStats";
const DETECTION_SETTINGS_STORAGE_KEY = "snareDetectionSettings";
const PERSISTENCE_KEYS = [
  DETECTION_SETTINGS_STORAGE_KEY,
  EXERCISE_STORAGE_KEY,
  EXERCISE_REP_HISTORY_KEY,
  APP_STATS_STORAGE_KEY,
];
const PERSISTENCE_API_BASE = "/api/storage";
const PERSISTENCE_TIMEOUT_MS = 800;
const SUBDIVISION_CONFIGS = {
  whole: { label: "Whole", noteDenominator: 1 },
  half: { label: "Half", noteDenominator: 2 },
  quarter: { label: "Quarter", noteDenominator: 4 },
  eighth: { label: "Eighth", noteDenominator: 8 },
  triplet: { label: "Triplet", triplet: true },
  sixteenth: { label: "Sixteenth", noteDenominator: 16 },
  thirtysecond: { label: "32nd", noteDenominator: 32 },
};

const elements = {
  deviceSelect: document.getElementById("deviceSelect"),
  calibrationDeviceSelect: document.getElementById("calibrationDeviceSelect"),
  autoTuneDeviceSelect: document.getElementById("autoTuneDeviceSelect"),
  refreshDevicesButton: document.getElementById("refreshDevicesButton"),
  startButton: document.getElementById("startButton"),
  stopButton: document.getElementById("stopButton"),
  exportButton: document.getElementById("exportButton"),
  clearLogButton: document.getElementById("clearLogButton"),
  metronomeEnabledInput: document.getElementById("metronomeEnabledInput"),
  metronomeTempoInput: document.getElementById("metronomeTempoInput"),
  metronomeTempoNumber: document.getElementById("metronomeTempoNumber"),
  metronomeTempoValue: document.getElementById("metronomeTempoValue"),
  metronomeVolumeInput: document.getElementById("metronomeVolumeInput"),
  metronomeVolumeValue: document.getElementById("metronomeVolumeValue"),
  metronomeSubdivisionSelect: document.getElementById("metronomeSubdivisionSelect"),
  metronomeSubdivisionValue: document.getElementById("metronomeSubdivisionValue"),
  metronomeNumeratorInput: document.getElementById("metronomeNumeratorInput"),
  metronomeDenominatorSelect: document.getElementById("metronomeDenominatorSelect"),
  metronomeTimeSignatureValue: document.getElementById("metronomeTimeSignatureValue"),
  accentPatternButton: document.getElementById("accentPatternButton"),
  accentPatternPopover: document.getElementById("accentPatternPopover"),
  metronomeAccentButtons: document.getElementById("metronomeAccentButtons"),
  thresholdInput: document.getElementById("thresholdInput"),
  refractoryInput: document.getElementById("refractoryInput"),
  smoothingInput: document.getElementById("smoothingInput"),
  calibrationSourceGate: document.getElementById("calibrationSourceGate"),
  thresholdValue: document.getElementById("thresholdValue"),
  refractoryValue: document.getElementById("refractoryValue"),
  smoothingValue: document.getElementById("smoothingValue"),
  captureStatus: document.getElementById("captureStatus"),
  metronomeStatus: document.getElementById("metronomeStatus"),
  hitIndicator: document.getElementById("hitIndicator"),
  metronomeIndicator: document.getElementById("metronomeIndicator"),
  hitCount: document.getElementById("hitCount"),
  bpmValue: document.getElementById("bpmValue"),
  lastHitValue: document.getElementById("lastHitValue"),
  sampleRateValue: document.getElementById("sampleRateValue"),
  rawAmplitudeValue: document.getElementById("rawAmplitudeValue"),
  filteredAmplitudeValue: document.getElementById("filteredAmplitudeValue"),
  thresholdLineValue: document.getElementById("thresholdLineValue"),
  triggeredValue: document.getElementById("triggeredValue"),
  settingsRawAmplitudeValue: document.getElementById("settingsRawAmplitudeValue"),
  settingsFilteredAmplitudeValue: document.getElementById("settingsFilteredAmplitudeValue"),
  settingsThresholdLineValue: document.getElementById("settingsThresholdLineValue"),
  settingsTriggeredValue: document.getElementById("settingsTriggeredValue"),
  messageBanner: document.getElementById("messageBanner"),
  debugCanvas: document.getElementById("debugCanvas"),
  settingsDebugCanvas: document.getElementById("settingsDebugCanvas"),
  timelineWorkspace: document.getElementById("timelineWorkspace"),
  fullscreenTransportHost: document.getElementById("fullscreenTransportHost"),
  transportStrip: document.querySelector(".transport-strip"),
  timelineLayout: document.querySelector(".timeline-layout"),
  timelinePanel: document.querySelector(".timeline-panel"),
  timelineHeader: document.querySelector(".timeline-header"),
  timelineFooter: document.querySelector(".timeline-footer"),
  metronomePanel: document.getElementById("metronomePanel"),
  metronomeCard: document.querySelector(".metronome-card"),
  exerciseMetronomeHost: document.getElementById("exerciseMetronomeHost"),
  exerciseGuideEnabledInput: document.getElementById("exerciseGuideEnabledInput"),
  exerciseGuideToggleButton: document.getElementById("exerciseGuideToggleButton"),
  exerciseDynamicsToggleButton: document.getElementById("exerciseDynamicsToggleButton"),
  debugHomeHost: document.getElementById("debugHomeHost"),
  debugPanel: document.getElementById("debugPanel"),
  settingsDebugPanel: document.getElementById("settingsDebugPanel"),
  timelineCanvas: document.getElementById("timelineCanvas"),
  timelineVirtualWidth: document.getElementById("timelineVirtualWidth"),
  timelineScroll: document.getElementById("timelineScroll"),
  zoomButtonRow: document.getElementById("zoomButtonRow"),
  timelineActions: document.querySelector(".timeline-actions"),
  jumpToLiveButton: document.getElementById("jumpToLiveButton"),
  timelineZoomOutButton: document.getElementById("timelineZoomOutButton"),
  timelineZoomValue: document.getElementById("timelineZoomValue"),
  timelineZoomInButton: document.getElementById("timelineZoomInButton"),
  timelineFullscreenButton: document.getElementById("timelineFullscreenButton"),
  metronomeResizeHandle: document.getElementById("metronomeResizeHandle"),
  metronomeCollapseButton: document.getElementById("metronomeCollapseButton"),
  startCalibrationButton: document.getElementById("startCalibrationButton"),
  acceptCalibrationButton: document.getElementById("acceptCalibrationButton"),
  discardCalibrationButton: document.getElementById("discardCalibrationButton"),
  resetCalibrationButton: document.getElementById("resetCalibrationButton"),
  nudgeCalibrationBackButton: document.getElementById("nudgeCalibrationBackButton"),
  nudgeCalibrationForwardButton: document.getElementById("nudgeCalibrationForwardButton"),
  resetDetectionDefaultsButton: document.getElementById("resetDetectionDefaultsButton"),
  latencyCompensationValue: document.getElementById("latencyCompensationValue"),
  calibrationStatusValue: document.getElementById("calibrationStatusValue"),
  calibrationPanelStageValue: document.getElementById("calibrationPanelStageValue"),
  calibrationInstructionText: document.getElementById("calibrationInstructionText"),
  calibrationOffsetValue: document.getElementById("calibrationOffsetValue"),
  calibrationUsableHitsValue: document.getElementById("calibrationUsableHitsValue"),
  calibrationJitterValue: document.getElementById("calibrationJitterValue"),
  calibrationQualityValue: document.getElementById("calibrationQualityValue"),
  startAutoTuneButton: document.getElementById("startAutoTuneButton"),
  cancelAutoTuneButton: document.getElementById("cancelAutoTuneButton"),
  acceptAutoTuneButton: document.getElementById("acceptAutoTuneButton"),
  discardAutoTuneButton: document.getElementById("discardAutoTuneButton"),
  autoTunePhaseValue: document.getElementById("autoTunePhaseValue"),
  autoTuneProgressValue: document.getElementById("autoTuneProgressValue"),
  autoTuneQualityValue: document.getElementById("autoTuneQualityValue"),
  autoTuneInstructionText: document.getElementById("autoTuneInstructionText"),
  autoTuneProposals: document.getElementById("autoTuneProposals"),
  autoTuneThresholdValue: document.getElementById("autoTuneThresholdValue"),
  autoTuneRefractoryValue: document.getElementById("autoTuneRefractoryValue"),
  autoTuneSmoothingValue: document.getElementById("autoTuneSmoothingValue"),
  calibrationOverlay: document.getElementById("calibrationOverlay"),
  calibrationScreen: document.getElementById("calibrationScreen"),
  calibrationScreenBody: document.getElementById("calibrationScreenBody"),
  calibrationScreenSide: document.getElementById("calibrationScreenSide"),
  calibrationScreenBackButton: document.getElementById("calibrationScreenBackButton"),
  calibrationScreenInstructionText: document.getElementById("calibrationScreenInstructionText"),
  calibrationScreenStartButton: document.getElementById("calibrationScreenStartButton"),
  calibrationScreenResults: document.getElementById("calibrationScreenResults"),
  calibrationProgressRing: document.getElementById("calibrationProgressRing"),
  calibrationProgressValue: document.getElementById("calibrationProgressValue"),
  calibrationPhaseValue: document.getElementById("calibrationPhaseValue"),
  calibrationSegmentValue: document.getElementById("calibrationSegmentValue"),
  autoTuneOverlay: document.getElementById("autoTuneOverlay"),
  autoTuneScreenStartButton: document.getElementById("autoTuneScreenStartButton"),
  autoTuneScreenIdleActions: document.getElementById("autoTuneScreenIdleActions"),
  autoTuneScreenResults: document.getElementById("autoTuneScreenResults"),
  autoTuneProgressRing: document.getElementById("autoTuneProgressRing"),
  autoTuneStatusValue: document.getElementById("autoTuneStatusValue"),
  liveModeButton: document.getElementById("liveModeButton"),
  exerciseModeButton: document.getElementById("exerciseModeButton"),
  settingsModeButton: document.getElementById("settingsModeButton"),
  statsModeButton: document.getElementById("statsModeButton"),
  modeInfoEyebrow: document.getElementById("modeInfoEyebrow"),
  modeInfoTitle: document.getElementById("modeInfoTitle"),
  modeInfoCopy: document.getElementById("modeInfoCopy"),
  exerciseModeSection: document.getElementById("exerciseModeSection"),
  settingsModeSection: document.getElementById("settingsModeSection"),
  statsModeSection: document.getElementById("statsModeSection"),
  exerciseSelect: document.getElementById("exerciseSelect"),
  exerciseDeviceSelect: document.getElementById("exerciseDeviceSelect"),
  exerciseUploadInput: document.getElementById("exerciseUploadInput"),
  exerciseTempoInput: document.getElementById("exerciseTempoInput"),
  exerciseListenButton: document.getElementById("exerciseListenButton"),
  exerciseStartButton: document.getElementById("exerciseStartButton"),
  exerciseStopButton: document.getElementById("exerciseStopButton"),
  exerciseTitle: document.getElementById("exerciseTitle"),
  exerciseMetadata: document.getElementById("exerciseMetadata"),
  exerciseHitTargetValue: document.getElementById("exerciseHitTargetValue"),
  exerciseDurationValue: document.getElementById("exerciseDurationValue"),
  sheetMusicContainer: document.getElementById("sheetMusicContainer"),
  exerciseWarnings: document.getElementById("exerciseWarnings"),
  exerciseRepStatus: document.getElementById("exerciseRepStatus"),
  exerciseHighScores: document.getElementById("exerciseHighScores"),
  exerciseReviewGrid: document.getElementById("exerciseReviewGrid"),
  exerciseTimelinePanel: document.getElementById("exerciseTimelinePanel"),
  exerciseTimelineBody: document.getElementById("exerciseTimelineBody"),
  exerciseTimelineScroll: document.getElementById("exerciseTimelineScroll"),
  exerciseTimelineCanvas: document.getElementById("exerciseTimelineCanvas"),
  exerciseTimelineVirtualWidth: document.getElementById("exerciseTimelineVirtualWidth"),
  exerciseOffsetPanel: document.getElementById("exerciseOffsetPanel"),
  exerciseOffsetBody: document.getElementById("exerciseOffsetBody"),
  exerciseOffsetCanvas: document.getElementById("exerciseOffsetCanvas"),
  exerciseDynamicsPanel: document.getElementById("exerciseDynamicsPanel"),
  exerciseDynamicsBody: document.getElementById("exerciseDynamicsBody"),
  exerciseDynamicsCanvas: document.getElementById("exerciseDynamicsCanvas"),
  exerciseResultOverlay: document.getElementById("exerciseResultOverlay"),
  exerciseResultCloseButton: document.getElementById("exerciseResultCloseButton"),
  exerciseResultTitle: document.getElementById("exerciseResultTitle"),
  exerciseResultScore: document.getElementById("exerciseResultScore"),
  exerciseResultMatched: document.getElementById("exerciseResultMatched"),
  exerciseResultMeanOffset: document.getElementById("exerciseResultMeanOffset"),
  exerciseResultMeanAbs: document.getElementById("exerciseResultMeanAbs"),
  exerciseResultJitter: document.getElementById("exerciseResultJitter"),
  exerciseResultFeedbackList: document.getElementById("exerciseResultFeedbackList"),
  exerciseTendenciesButton: document.getElementById("exerciseTendenciesButton"),
  exerciseHeatmapOverlay: document.getElementById("exerciseHeatmapOverlay"),
  exerciseHeatmapCloseButton: document.getElementById("exerciseHeatmapCloseButton"),
  exerciseHeatmapTitle: document.getElementById("exerciseHeatmapTitle"),
  exerciseHeatmapSummary: document.getElementById("exerciseHeatmapSummary"),
  exerciseHeatmapSheetStage: document.getElementById("exerciseHeatmapSheetStage"),
  exerciseHeatmapGraphLayer: document.getElementById("exerciseHeatmapGraphLayer"),
  exerciseHeatmapSheetClone: document.getElementById("exerciseHeatmapSheetClone"),
  exerciseHeatmapMarkerLayer: document.getElementById("exerciseHeatmapMarkerLayer"),
  exerciseHeatmapDetails: document.getElementById("exerciseHeatmapDetails"),
  autoTuneDebugPanel: document.getElementById("autoTuneDebugPanel"),
  autoTuneDebugCanvas: document.getElementById("autoTuneDebugCanvas"),
  autoTuneRawAmplitudeValue: document.getElementById("autoTuneRawAmplitudeValue"),
  autoTuneFilteredAmplitudeValue: document.getElementById("autoTuneFilteredAmplitudeValue"),
  autoTuneThresholdLineValue: document.getElementById("autoTuneThresholdLineValue"),
  autoTuneTriggeredValue: document.getElementById("autoTuneTriggeredValue"),
  lifetimeStatsGrid: document.getElementById("lifetimeStatsGrid"),
  exerciseStatsList: document.getElementById("exerciseStatsList"),
  sessionHistoryList: document.getElementById("sessionHistoryList"),
  clearRepHistoryButton: document.getElementById("clearRepHistoryButton"),
  repGraphOverlay: document.getElementById("repGraphOverlay"),
  repGraphCloseButton: document.getElementById("repGraphCloseButton"),
  repGraphTitle: document.getElementById("repGraphTitle"),
  repGraphCanvas: document.getElementById("repGraphCanvas"),
};

const state = {
  audioContext: null,
  stream: null,
  sourceNode: null,
  processorNode: null,
  muteNode: null,
  simulationTimer: null,
  simulator: null,
  detector: null,
  running: false,
  usingSimulation: false,
  hits: [],
  metronomeClicks: [],
  sampleRate: null,
  sessionStartedAtDate: null,
  sessionStartPerformanceMs: null,
  lastMetrics: {
    rawPeak: 0,
    filteredPeak: 0,
    threshold: Number(elements.thresholdInput.value),
    triggered: false,
  },
  metronomeContext: null,
  metronomeTimer: null,
  metronomeRunning: false,
  metronomeNextAudioTime: 0,
  metronomeNextSessionTime: 0,
  metronomeNextBeatPosition: 0,
  metronomePatternIndex: 0,
  metronomeMeasureIndex: 0,
  metronomeAudioZeroTime: null,
  metronomeElapsedBaseSeconds: 0,
  metronomeAccentLevels: [],
  metronomeFlashTimeout: null,
  metronomeFlashVersion: 0,
  hitIndicatorTimeout: null,
  animationFrameId: 0,
  timelineFollowLive: true,
  timelineZoom: 1,
  tempoSegments: [],
  metronomeResyncVersion: 0,
  latencyCompensationMs: 0,
  dynamicCalibration: null,
  calibration: {
    token: 0,
    overlayOpen: false,
    overlayCloseTimer: null,
    active: false,
    finishing: false,
    statusText: "Ready",
    instructions:
      "Press Start Calibration to choose an audio source and begin.",
    savedSettings: null,
    startHitIndex: 0,
    firstClickTimeSeconds: null,
    collectStartTimeSeconds: null,
    collectEndTimeSeconds: null,
    progressStartTimeSeconds: null,
    progressEndTimeSeconds: null,
    phases: [],
    phaseSamples: null,
    targetTimesSeconds: [],
    pendingResult: null,
    startedCaptureForCalibration: false,
    overlaySourceSelected: false,
  },
  autoDetection: {
    token: 0,
    overlayOpen: false,
    overlayCloseTimer: null,
    active: false,
    startedCaptureForAutoTune: false,
    phaseIndex: 0,
    phaseStartTimeSeconds: null,
    progressStartTimeSeconds: null,
    progressEndTimeSeconds: null,
    collector: null,
    samples: null,
    pendingResult: null,
    statusText: "Ready",
    instructions:
      "Press start, stay silent for the noise check, play soft fast taps, then play loud taps.",
  },
  fullscreen: {
    active: false,
    sidebarCollapsed: false,
    sidebarWidth: 360,
    dragType: null,
    dragStartX: 0,
    dragStartY: 0,
    dragStartSize: 0,
  },
  appMode: "live",
  exercise: {
    builtInExercises: [
      {
        id: "8ts",
        title: "8ts · Eighth Notes",
        path: "exercises/8ts.mxl",
      },
      {
        id: "accent-tap",
        title: "Accent Tap",
        path: "exercises/accent-tap.mxl",
      },
      {
        id: "16th-note-grid",
        title: "16th Note Grid",
        path: "exercises/16th-note-grid.mxl",
      },
      {
        id: "triplet-rolls",
        title: "Triplet Rolls",
        path: "exercises/triplet-rolls.mxl",
      },
      {
        id: "triplet-grid",
        title: "Triplet Grid",
        path: "exercises/triplet-grid.mxl",
      },
      {
        id: "pats",
        title: "Pats",
        path: "exercises/pats.mxl",
      },
      {
        id: "paradiddles",
        title: "Paradiddles",
        path: "exercises/paradiddles.mxl",
      },
    ],
    uploadedExercises: new Map(),
    osmd: null,
    loaded: null,
    sourceXmlText: "",
    sourceFileName: "",
    selectedExerciseId: "8ts",
    selectionRequestId: "8ts",
    starting: false,
    stopping: false,
    sessionId: 0,
    activeSessionId: null,
    completedSessionIds: new Set(),
    completionTimer: null,
    resultSessionId: null,
    running: false,
    scoreStartTimeSeconds: 0,
    sessionEndTimeSeconds: 0,
    guideEvents: [],
    guideNextIndex: 0,
    guideTimer: null,
    guideToken: 0,
    guideAudioStartTime: null,
    listening: false,
    listenEvents: [],
    listenNextIndex: 0,
    listenTimer: null,
    listenStartPerformanceMs: null,
    listenScoreStartTimeSeconds: 0,
    listenEndTimeSeconds: 0,
    sheetCursorIndex: -1,
    sheetCursorPositions: [],
    latestAnalysis: null,
    latestScoreRecord: null,
    pendingScoreRecord: null,
    pendingScoreAnalysis: null,
    tendenciesVisible: false,
    dynamicsVisible: false,
    offscreenRenderActive: false,
    offscreenRenderPreviousHidden: true,
    offscreenRenderPreviousStyle: "",
    resultOverlayOpen: false,
    highScores: [],
    repHistory: [],
    timelineFollowLive: true,
    suppressTimelineScrollEvent: false,
    simulator: null,
  },
  appStats: {
    totalHits: 0,
    totalCalibrationsCompleted: 0,
  },
  activeRepGraphRecord: null,
  activeRepGraphType: "offset",
  activeHeatmap: null,
  suppressTimelineScrollEvent: false,
};

const transportOriginalPlacement = {
  parent: elements.transportStrip.parentElement,
  nextSibling: elements.transportStrip.nextElementSibling,
};

const metronomePanelOriginalPlacement = {
  parent: elements.metronomePanel.parentElement,
  nextSibling: elements.metronomePanel.nextElementSibling,
};

const debugPanelOriginalPlacement = {
  parent: elements.debugPanel.parentElement,
  nextSibling: elements.debugPanel.nextElementSibling,
};

let persistenceBackendAvailable = false;

function readStoredJson(key, fallbackValue) {
  try {
    const rawValue = localStorage.getItem(key);
    return rawValue === null ? fallbackValue : JSON.parse(rawValue);
  } catch {
    return fallbackValue;
  }
}

function writeStoredJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Browser storage can fail in private/restricted contexts; keep runtime state active.
  }

  if (persistenceBackendAvailable) {
    void persistStoredJson(key, value);
  }
}

async function fetchPersistenceApi(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), PERSISTENCE_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.headers ?? {}),
      },
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function persistStoredJson(key, value) {
  try {
    const response = await fetchPersistenceApi(
      `${PERSISTENCE_API_BASE}/${encodeURIComponent(key)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ value, updatedAt: Date.now() }),
      }
    );
    persistenceBackendAvailable = response.ok;
  } catch {
    persistenceBackendAvailable = false;
  }
}

async function hydratePersistentStorage() {
  try {
    const response = await fetchPersistenceApi(PERSISTENCE_API_BASE, {
      cache: "no-store",
    });
    if (!response.ok) {
      persistenceBackendAvailable = false;
      return;
    }

    const payload = await response.json();
    const serverData =
      payload && typeof payload.data === "object" && payload.data !== null ? payload.data : {};
    persistenceBackendAvailable = true;

    for (const key of PERSISTENCE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(serverData, key)) {
        try {
          localStorage.setItem(key, JSON.stringify(serverData[key]));
        } catch {
          // The app can still read the server-backed value on the next run.
        }
        continue;
      }

      const localValue = readStoredJson(key, null);
      if (localValue !== null) {
        void persistStoredJson(key, localValue);
      }
    }
  } catch {
    persistenceBackendAvailable = false;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getRangeBounds(input) {
  return {
    min: Number(input.min),
    max: Number(input.max),
  };
}

function getPersistableDetectionSettings() {
  return {
    threshold: Number(elements.thresholdInput.value),
    refractoryMs: Number(elements.refractoryInput.value),
    smoothing: Number(elements.smoothingInput.value),
    latencyCompensationMs: state.latencyCompensationMs,
    metronomeVolume: Number(elements.metronomeVolumeInput.value),
    dynamicCalibration: state.dynamicCalibration,
  };
}

function setRangeValueFromSaved(input, value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return;
  }

  const { min, max } = getRangeBounds(input);
  input.value = String(clamp(numericValue, min, max));
}

function loadDetectionSettings() {
  const storedSettings = readStoredJson(DETECTION_SETTINGS_STORAGE_KEY, {});
  const parsed =
    storedSettings && typeof storedSettings === "object" && !Array.isArray(storedSettings)
      ? storedSettings
      : {};
  setRangeValueFromSaved(elements.thresholdInput, parsed.threshold);
  setRangeValueFromSaved(elements.refractoryInput, parsed.refractoryMs);
  setRangeValueFromSaved(elements.smoothingInput, parsed.smoothing);
  setRangeValueFromSaved(elements.metronomeVolumeInput, parsed.metronomeVolume);
  if (Number.isFinite(Number(parsed.latencyCompensationMs))) {
    state.latencyCompensationMs = Number(Number(parsed.latencyCompensationMs).toFixed(3));
  }
  state.dynamicCalibration =
    parsed.dynamicCalibration &&
    typeof parsed.dynamicCalibration === "object" &&
    !Array.isArray(parsed.dynamicCalibration)
      ? parsed.dynamicCalibration
      : null;
}

function saveDetectionSettings() {
  writeStoredJson(DETECTION_SETTINGS_STORAGE_KEY, getPersistableDetectionSettings());
}

function syncAudioDeviceSelection(deviceId) {
  elements.deviceSelect.value = deviceId;
  elements.exerciseDeviceSelect.value = deviceId;
  elements.calibrationDeviceSelect.value = deviceId;
  elements.autoTuneDeviceSelect.value = deviceId;
}

function getFirstRealAudioInputValue(selectElement) {
  return Array.from(selectElement.options).find((option) => option.value !== "simulated")?.value ?? null;
}

function median(values) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middleIndex - 1] + sorted[middleIndex]) / 2;
  }
  return sorted[middleIndex];
}

function percentile(values, fraction) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = clamp((sorted.length - 1) * fraction, 0, sorted.length - 1);
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }

  return sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * (index - lowerIndex);
}

function formatMilliseconds(value, fallback = "--") {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return fallback;
  }

  const safeValue = Number(value);
  return `${safeValue >= 0 ? "+" : ""}${safeValue.toFixed(1)} ms`;
}

function getCalibrationProgressCircumference() {
  const radius = Number(elements.calibrationProgressRing?.getAttribute("r") || 92);
  return 2 * Math.PI * radius;
}

function resetCalibrationOverlayAnimation() {
  window.clearTimeout(state.calibration.overlayCloseTimer);
  state.calibration.overlayCloseTimer = null;
}

function openCalibrationOverlay() {
  resetCalibrationOverlayAnimation();
  if (!state.calibration.active && !state.calibration.pendingResult) {
    state.calibration.overlaySourceSelected = false;
    if (Array.from(elements.calibrationDeviceSelect.options).some((option) => option.value === "")) {
      elements.calibrationDeviceSelect.value = "";
    }
  }
  state.calibration.overlayOpen = true;
  elements.calibrationOverlay.hidden = false;
  elements.calibrationOverlay.classList.remove("is-closing");
  window.requestAnimationFrame(() => {
    elements.calibrationOverlay.classList.add("is-open");
  });
  updateCalibrationUi();
}

function closeCalibrationOverlay() {
  if (!state.calibration.overlayOpen && elements.calibrationOverlay.hidden) {
    return;
  }

  resetCalibrationOverlayAnimation();
  state.calibration.overlayOpen = false;
  elements.calibrationOverlay.classList.remove("is-open");
  elements.calibrationOverlay.classList.add("is-closing");
  state.calibration.overlayCloseTimer = window.setTimeout(() => {
    elements.calibrationOverlay.hidden = true;
    elements.calibrationOverlay.classList.remove("is-closing");
    state.calibration.overlayCloseTimer = null;
  }, CALIBRATION_OVERLAY_CLOSE_MS);
}

function resetAutoTuneOverlayAnimation() {
  window.clearTimeout(state.autoDetection.overlayCloseTimer);
  state.autoDetection.overlayCloseTimer = null;
}

function openAutoTuneOverlay() {
  resetAutoTuneOverlayAnimation();
  state.autoDetection.overlayOpen = true;
  elements.autoTuneOverlay.hidden = false;
  elements.autoTuneOverlay.classList.remove("is-closing");
  window.requestAnimationFrame(() => {
    elements.autoTuneOverlay.classList.add("is-open");
  });
  updateAutoDetectionUi();
  requestRender();
}

function closeAutoTuneOverlay() {
  if (!state.autoDetection.overlayOpen && elements.autoTuneOverlay.hidden) {
    return;
  }

  resetAutoTuneOverlayAnimation();
  state.autoDetection.overlayOpen = false;
  elements.autoTuneOverlay.classList.remove("is-open");
  elements.autoTuneOverlay.classList.add("is-closing");
  state.autoDetection.overlayCloseTimer = window.setTimeout(() => {
    elements.autoTuneOverlay.hidden = true;
    elements.autoTuneOverlay.classList.remove("is-closing");
    state.autoDetection.overlayCloseTimer = null;
  }, CALIBRATION_OVERLAY_CLOSE_MS);
}

function getCalibrationProgressFraction() {
  const calibration = state.calibration;

  if (calibration.pendingResult) {
    return 1;
  }

  if (!calibration.active || calibration.phases.length === 0) {
    return 0;
  }

  const currentElapsed = getCurrentSessionElapsedSeconds();
  const phase = getCurrentCalibrationPhaseAtTime(currentElapsed);
  if (!phase) {
    const finalPhase = calibration.phases[calibration.phases.length - 1];
    return finalPhase && currentElapsed >= finalPhase.endTimeSeconds ? 1 : 0;
  }

  const phaseDuration = phase.endTimeSeconds - phase.startTimeSeconds;
  if (phaseDuration <= 0) {
    return 0;
  }

  return clamp((currentElapsed - phase.startTimeSeconds) / phaseDuration, 0, 1);
}

function getAudioContextClass() {
  return window.AudioContext || window.webkitAudioContext;
}

function getDetectorParameters() {
  return {
    threshold: Number(elements.thresholdInput.value),
    refractoryMs: Number(elements.refractoryInput.value),
    smoothing: Number(elements.smoothingInput.value),
  };
}

function getMetronomeTempo() {
  return clamp(
    Number(elements.metronomeTempoNumber.value || elements.metronomeTempoInput.value || 120),
    METRONOME_MIN_TEMPO,
    METRONOME_MAX_TEMPO
  );
}

function getMetronomeVolume() {
  return clamp(Number(elements.metronomeVolumeInput?.value) || 0, 0, 100) / 100;
}

function getSubdivisionConfig() {
  return (
    SUBDIVISION_CONFIGS[elements.metronomeSubdivisionSelect?.value] ??
    SUBDIVISION_CONFIGS.quarter
  );
}

function getTimeSignature() {
  return {
    numerator: clamp(Number(elements.metronomeNumeratorInput?.value) || 4, 1, 16),
    denominator: clamp(Number(elements.metronomeDenominatorSelect?.value) || 4, 2, 8),
  };
}

function getSubdivisionStepBeats(subdivision = getSubdivisionConfig(), timeSignature = getTimeSignature()) {
  if (subdivision.triplet) {
    return 1 / 3;
  }

  return timeSignature.denominator / subdivision.noteDenominator;
}

function sanitizeMetronomeControls() {
  const timeSignature = getTimeSignature();
  elements.metronomeNumeratorInput.value = String(timeSignature.numerator);
  elements.metronomeDenominatorSelect.value = String(timeSignature.denominator);
  return timeSignature;
}

function getMeasureSubdivisionPositions(
  subdivision = getSubdivisionConfig(),
  timeSignature = getTimeSignature()
) {
  const stepBeats = getSubdivisionStepBeats(subdivision, timeSignature);
  const positions = [];
  const maxIndex = Math.max(1, Math.ceil(timeSignature.numerator / stepBeats));

  for (let index = 0; index < maxIndex; index += 1) {
    const position = index * stepBeats;
    if (position > timeSignature.numerator - 0.0001) {
      break;
    }
    positions.push(Number(position.toFixed(6)));
  }

  if (positions.length === 0) {
    positions.push(0);
  }

  return positions;
}

function getCalibrationMeasureDurationSeconds() {
  return (60 / CALIBRATION_TEMPO) * CALIBRATION_NUMERATOR;
}

function getLatencyCompensationSeconds() {
  return state.latencyCompensationMs / 1000;
}

function getCorrectedHitTimeSeconds(rawTimeSeconds) {
  return Math.max(0, rawTimeSeconds - getLatencyCompensationSeconds());
}

function updateHitDerivedTiming(hit) {
  hit.timeSeconds = getCorrectedHitTimeSeconds(hit.rawTimeSeconds);
  hit.beatPosition = getBeatPositionAtTime(hit.timeSeconds);
  hit.elapsed = formatElapsedTime(hit.timeSeconds);
  if (state.sessionStartedAtDate instanceof Date) {
    hit.absoluteIso = new Date(
      state.sessionStartedAtDate.getTime() + hit.timeSeconds * 1000
    ).toISOString();
  }
  return hit;
}

function recomputeHitTiming() {
  for (const hit of state.hits) {
    updateHitDerivedTiming(hit);
  }

  updateStats();
}

function getBeatSubdivisionLabels(stepsPerBeat, beatNumber) {
  switch (stepsPerBeat) {
    case 1:
      return [String(beatNumber)];
    case 2:
      return [String(beatNumber), "&"];
    case 3:
      return [String(beatNumber), "trip", "let"];
    case 4:
      return [String(beatNumber), "e", "&", "a"];
    case 8:
      return [String(beatNumber), "ta", "e", "ta", "&", "ta", "a", "ta"];
    default:
      return Array.from({ length: stepsPerBeat }, (_, index) =>
        index === 0 ? String(beatNumber) : String(index + 1)
      );
  }
}

function getSubdivisionButtonLayout() {
  const positions = getMeasureSubdivisionPositions();
  const stepBeats = getSubdivisionStepBeats();
  const rows = [];

  if (stepBeats >= 1 - 0.0001) {
    return positions.map((position, index) => ({
      beatIndex: Math.floor(position),
      buttons: [
        {
          stepIndex: index,
          label: String(Math.floor(position) + 1),
          position,
        },
      ],
    }));
  }

  const stepsPerBeat = Math.round(1 / stepBeats);
  const rowsByBeat = new Map();

  positions.forEach((position, stepIndex) => {
    const beatIndex = Math.floor(position + 0.0001);
    const positionInBeat = position - beatIndex;
    const subIndex = clamp(Math.round(positionInBeat / stepBeats), 0, stepsPerBeat - 1);
    const labels = getBeatSubdivisionLabels(stepsPerBeat, beatIndex + 1);

    if (!rowsByBeat.has(beatIndex)) {
      rowsByBeat.set(beatIndex, []);
    }

    rowsByBeat.get(beatIndex).push({
      stepIndex,
      label: labels[subIndex] ?? String(subIndex + 1),
      position,
    });
  });

  for (const [beatIndex, buttons] of rowsByBeat.entries()) {
    rows.push({ beatIndex, buttons });
  }

  return rows;
}

function getDefaultAccentLevels(
  subdivision = getSubdivisionConfig(),
  timeSignature = getTimeSignature()
) {
  const positions = getMeasureSubdivisionPositions(subdivision, timeSignature);
  const stepBeats = getSubdivisionStepBeats(subdivision, timeSignature);

  return positions.map((position, index) => {
    if (stepBeats <= 1 + 0.0001 && Math.abs(position - Math.round(position)) < 0.0001) {
      return 1;
    }

    return index === 0 ? 1 : 0;
  });
}

function ensureAccentLevels() {
  const defaultLevels = getDefaultAccentLevels();
  if (state.metronomeAccentLevels.length !== defaultLevels.length) {
    state.metronomeAccentLevels = defaultLevels;
    return;
  }

  state.metronomeAccentLevels = defaultLevels.map(
    (_, index) => clamp(state.metronomeAccentLevels[index] ?? 0, 0, 2)
  );
}

function getPixelsPerBeat() {
  return TIMELINE_BASE_PX_PER_BEAT * state.timelineZoom;
}

function formatZoomLabel(zoom) {
  return `${Number(zoom).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}x`;
}

function getTimelineZoomIndex() {
  return Math.max(0, TIMELINE_ZOOM_LEVELS.indexOf(state.timelineZoom));
}

function updateTimelineZoomControls() {
  const zoomIndex = getTimelineZoomIndex();
  elements.timelineZoomValue.textContent = formatZoomLabel(state.timelineZoom);
  elements.timelineZoomOutButton.disabled = zoomIndex <= 0;
  elements.timelineZoomInButton.disabled = zoomIndex >= TIMELINE_ZOOM_LEVELS.length - 1;
}

function resetTempoSegments() {
  sanitizeMetronomeControls();
  state.tempoSegments = [
    {
      startTimeSeconds: METRONOME_START_OFFSET_SECONDS,
      startBeat: 0,
      bpm: getMetronomeTempo(),
    },
  ];
}

function getBeatPositionAtTime(timeSeconds) {
  const safeTime = Math.max(0, timeSeconds);
  if (state.tempoSegments.length === 0) {
    return ((safeTime - METRONOME_START_OFFSET_SECONDS) * getMetronomeTempo()) / 60;
  }

  let activeSegment = state.tempoSegments[0];
  for (let index = 1; index < state.tempoSegments.length; index += 1) {
    if (state.tempoSegments[index].startTimeSeconds <= safeTime) {
      activeSegment = state.tempoSegments[index];
    } else {
      break;
    }
  }

  return activeSegment.startBeat + ((safeTime - activeSegment.startTimeSeconds) * activeSegment.bpm) / 60;
}

function addTempoSegment(timeSeconds, bpm) {
  const safeTime = Math.max(0, timeSeconds);
  const nextBpm = clamp(bpm, METRONOME_MIN_TEMPO, METRONOME_MAX_TEMPO);

  if (state.tempoSegments.length === 0) {
    state.tempoSegments = [
      {
        startTimeSeconds: safeTime,
        startBeat: 0,
        bpm: nextBpm,
      },
    ];
    return;
  }

  const lastSegment = state.tempoSegments[state.tempoSegments.length - 1];
  const segmentBeat = getBeatPositionAtTime(safeTime);

  if (Math.abs(lastSegment.startTimeSeconds - safeTime) < 0.0005) {
    lastSegment.startBeat = segmentBeat;
    lastSegment.bpm = nextBpm;
    return;
  }

  if (Math.abs(lastSegment.bpm - nextBpm) < 0.0005) {
    return;
  }

  state.tempoSegments.push({
    startTimeSeconds: safeTime,
    startBeat: segmentBeat,
    bpm: nextBpm,
  });
}

function getTimelineCanvasCssWidth() {
  return (
    parseFloat(elements.timelineVirtualWidth?.style.width) ||
    elements.timelineScroll.scrollWidth ||
    parseFloat(elements.timelineCanvas.style.width) ||
    elements.timelineCanvas.clientWidth ||
    elements.timelineCanvas.width / (window.devicePixelRatio || 1)
  );
}

function isTimelineFullscreen() {
  return state.fullscreen.active;
}

function syncFullscreenTransportPlacement() {
  if (isTimelineFullscreen()) {
    if (elements.transportStrip.parentElement !== elements.fullscreenTransportHost) {
      elements.fullscreenTransportHost.append(elements.transportStrip);
    }
    return;
  }

  if (elements.transportStrip.parentElement === elements.fullscreenTransportHost) {
    transportOriginalPlacement.parent.insertBefore(
      elements.transportStrip,
      transportOriginalPlacement.nextSibling
    );
  }
}

function syncFullscreenButtonPlacement() {
  if (isTimelineFullscreen()) {
    if (elements.timelineFullscreenButton.parentElement !== elements.timelineActions) {
      elements.timelineActions.append(elements.timelineFullscreenButton);
    }
    return;
  }

  if (elements.timelineFullscreenButton.parentElement !== elements.zoomButtonRow) {
    elements.zoomButtonRow.append(elements.timelineFullscreenButton);
  }
}

function syncMetronomePanelPlacement() {
  const exerciseMode = state.appMode === "exercise" && !isTimelineFullscreen();
  if (exerciseMode) {
    if (elements.metronomePanel.parentElement !== elements.exerciseMetronomeHost) {
      elements.exerciseMetronomeHost.append(elements.metronomePanel);
    }
    elements.metronomePanel.classList.add("exercise-metronome-panel");
    return;
  }

  if (elements.metronomePanel.parentElement !== metronomePanelOriginalPlacement.parent) {
    metronomePanelOriginalPlacement.parent.insertBefore(
      elements.metronomePanel,
      metronomePanelOriginalPlacement.nextSibling
    );
  }
  elements.metronomePanel.classList.remove("exercise-metronome-panel");
}

function syncDebugPanelPlacement() {
  if (isTimelineFullscreen()) {
    if (elements.debugPanel.parentElement !== elements.metronomeCard) {
      elements.metronomeCard.append(elements.debugPanel);
    }
    elements.debugPanel.classList.add("metronome-debug");
    elements.debugPanel.classList.remove("panel", "collapsible-panel", "detector-debug-panel");
    return;
  }

  if (elements.debugPanel.parentElement !== debugPanelOriginalPlacement.parent) {
    debugPanelOriginalPlacement.parent.insertBefore(
      elements.debugPanel,
      debugPanelOriginalPlacement.nextSibling
    );
  }
  elements.debugPanel.classList.remove("metronome-debug");
  elements.debugPanel.classList.add("panel", "collapsible-panel", "detector-debug-panel");
}

function applyFullscreenWorkspaceState() {
  const fullscreenActive = isTimelineFullscreen();
  const workspace = elements.timelineWorkspace;
  const sidebarWidth =
    fullscreenActive && state.fullscreen.sidebarCollapsed
      ? FULLSCREEN_SIDEBAR_COLLAPSED_WIDTH
      : state.fullscreen.sidebarWidth;
  workspace.classList.toggle("is-fullscreen-workspace", fullscreenActive);
  workspace.classList.toggle("sidebar-collapsed", fullscreenActive && state.fullscreen.sidebarCollapsed);
  document.body.classList.toggle("app-fullscreen-active", fullscreenActive);
  workspace.style.setProperty("--fullscreen-sidebar-width", `${sidebarWidth}px`);
  elements.metronomeCollapseButton.textContent =
    state.fullscreen.sidebarCollapsed ? "▶" : "◀";
  elements.metronomeCollapseButton.setAttribute(
    "aria-expanded",
    String(fullscreenActive && !state.fullscreen.sidebarCollapsed)
  );
}

function updateTimelineFullscreenButton() {
  if (!elements.timelineFullscreenButton) {
    return;
  }

  const fullscreenActive = isTimelineFullscreen();
  syncMetronomePanelPlacement();
  elements.timelineFullscreenButton.textContent = fullscreenActive ? "Exit Fullscreen" : "Fullscreen";
  elements.timelineFullscreenButton.classList.toggle("is-exit-fullscreen", fullscreenActive);
  syncFullscreenTransportPlacement();
  syncFullscreenButtonPlacement();
  syncDebugPanelPlacement();
  applyFullscreenWorkspaceState();
  requestRenderAfterLayoutTransition();
}

function shouldContinuouslyRender() {
  return Boolean(
      state.running ||
      state.calibration.active ||
      state.autoDetection.active ||
      state.fullscreen.dragType ||
      state.exercise.running ||
      state.exercise.listening
  );
}

function requestRender() {
  if (state.animationFrameId) {
    return;
  }

  state.animationFrameId = window.requestAnimationFrame(renderFrame);
}

function requestRenderAfterLayoutTransition() {
  requestRender();
  for (const delayMs of [90, 190, 290]) {
    window.setTimeout(requestRender, delayMs);
  }
}

function positionAccentPatternPopover() {
  const popover = elements.accentPatternPopover;
  const button = elements.accentPatternButton;
  if (!popover || !button || popover.hidden) {
    return;
  }

  const rect = button.getBoundingClientRect();
  const popoverWidth = Math.min(420, Math.max(300, rect.width));
  const availableAbove = Math.max(112, rect.top - 24);
  popover.style.width = `${popoverWidth}px`;
  popover.style.maxHeight = `${availableAbove}px`;
  const popoverHeight = Math.min(popover.scrollHeight || popover.offsetHeight || 260, availableAbove);
  popover.style.left = `${clamp(rect.left, 12, window.innerWidth - popoverWidth - 12)}px`;
  popover.style.top = `${clamp(rect.top - popoverHeight - 10, 12, window.innerHeight - popoverHeight - 12)}px`;
}

function closeAccentPatternPopover() {
  elements.accentPatternPopover.hidden = true;
  elements.accentPatternButton.setAttribute("aria-expanded", "false");
}

function toggleAccentPatternPopover() {
  const shouldOpen = elements.accentPatternPopover.hidden;
  elements.accentPatternPopover.hidden = !shouldOpen;
  elements.accentPatternButton.setAttribute("aria-expanded", String(shouldOpen));
  if (shouldOpen) {
    positionAccentPatternPopover();
  }
}

function renderAccentButtons() {
  const subdivision = getSubdivisionConfig();
  const timeSignature = sanitizeMetronomeControls();
  const rows = getSubdivisionButtonLayout();
  ensureAccentLevels();
  elements.metronomeSubdivisionValue.textContent = subdivision.label;
  elements.metronomeTimeSignatureValue.textContent = `${timeSignature.numerator}/${timeSignature.denominator}`;

  elements.metronomeAccentButtons.innerHTML = "";
  for (const rowConfig of rows) {
    const row = document.createElement("div");
    row.className = "accent-row";
    row.style.gridTemplateColumns = `repeat(${rowConfig.buttons.length}, minmax(0, 1fr))`;

    rowConfig.buttons.forEach(({ label, stepIndex }) => {
      const accentLevel = clamp(state.metronomeAccentLevels[stepIndex] ?? 0, 0, 2);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `accent-button level-${accentLevel}`;
      button.textContent = label;
      button.dataset.stepIndex = String(stepIndex);
      button.dataset.accentLevel = String(accentLevel);
      button.setAttribute("aria-pressed", accentLevel > 0 ? "true" : "false");
      row.append(button);
    });

    elements.metronomeAccentButtons.append(row);
  }
  positionAccentPatternPopover();
}

function getCurrentSessionElapsedSeconds() {
  if (!state.sessionStartPerformanceMs && !state.detector) {
    return 0;
  }

  const detectorElapsedSeconds =
    state.detector && state.sampleRate
      ? state.detector.samplesProcessed / state.sampleRate
      : null;

  const metronomeElapsedSeconds =
    state.metronomeRunning &&
    state.usingSimulation &&
    state.metronomeContext &&
    state.metronomeAudioZeroTime !== null
      ? state.metronomeElapsedBaseSeconds +
        (state.metronomeContext.currentTime - state.metronomeAudioZeroTime)
      : null;

  if (state.running && metronomeElapsedSeconds !== null) {
    return Math.max(0, metronomeElapsedSeconds);
  }

  if (state.running && detectorElapsedSeconds !== null) {
    return Math.max(0, detectorElapsedSeconds);
  }

  if (!state.running) {
    const lastHitTime = state.hits[state.hits.length - 1]?.timeSeconds ?? 0;
    const lastClickTime = state.metronomeClicks[state.metronomeClicks.length - 1]?.timeSeconds ?? 0;
    return Math.max(detectorElapsedSeconds ?? 0, lastHitTime, lastClickTime);
  }

  return Math.max(0, (performance.now() - state.sessionStartPerformanceMs) / 1000);
}

function syncTempoInputs(rawValue) {
  const value = clamp(Number(rawValue) || 120, METRONOME_MIN_TEMPO, METRONOME_MAX_TEMPO);
  elements.metronomeTempoInput.value = String(value);
  elements.metronomeTempoNumber.value = String(value);
  elements.metronomeTempoValue.textContent = `${value} BPM`;
}

async function commitMetronomeTempo(rawValue) {
  if (state.appMode === "exercise" && (state.exercise.running || state.exercise.listening)) {
    syncTempoInputs(getMetronomeTempo());
    return;
  }

  await handleTempoChange(rawValue);
}

function commitExerciseTempo(rawValue) {
  if (state.exercise.running || state.exercise.listening) {
    elements.exerciseTempoInput.value = String(state.exercise.loaded?.tempoBpm ?? getMetronomeTempo());
    return;
  }

  syncTempoInputs(rawValue);
  if (state.exercise.loaded) {
    elements.exerciseTempoInput.value = elements.metronomeTempoNumber.value;
    updateExerciseFromTempoInput();
  }
  updateMetronomeStatus();
}

function updateControlLabels() {
  elements.thresholdValue.textContent = Number(elements.thresholdInput.value).toFixed(3);
  elements.refractoryValue.textContent = `${Number(elements.refractoryInput.value)} ms`;
  elements.smoothingValue.textContent = Number(elements.smoothingInput.value).toFixed(2);
  elements.metronomeVolumeValue.textContent = `${Math.round(getMetronomeVolume() * 100)}%`;
  syncTempoInputs(getMetronomeTempo());
  elements.metronomeSubdivisionValue.textContent = getSubdivisionConfig().label;
  elements.metronomeTimeSignatureValue.textContent = `${getTimeSignature().numerator}/${getTimeSignature().denominator}`;
  updateTimelineZoomControls();
}

function setMessage(message, isError = true) {
  if (!message) {
    elements.messageBanner.hidden = true;
    elements.messageBanner.textContent = "";
    return;
  }

  elements.messageBanner.hidden = false;
  elements.messageBanner.textContent = message;
  elements.messageBanner.style.background = isError
    ? "rgba(255, 127, 115, 0.12)"
    : "rgba(115, 224, 169, 0.12)";
  elements.messageBanner.style.borderColor = isError
    ? "rgba(255, 127, 115, 0.24)"
    : "rgba(115, 224, 169, 0.24)";
  elements.messageBanner.style.color = isError ? "#ffd9d4" : "#d4ffe8";
}

function updateCaptureStatus(text) {
  elements.captureStatus.textContent = text;
}

function updateMetronomeStatus() {
  const tempo = getMetronomeTempo();
  const subdivisionLabel = getSubdivisionConfig().label.toLowerCase();
  const timeSignature = getTimeSignature();
  if (!elements.metronomeEnabledInput.checked) {
    elements.metronomeStatus.textContent = "Disabled";
    return;
  }

  if (state.metronomeRunning) {
    elements.metronomeStatus.textContent = `${tempo} BPM · ${subdivisionLabel} · ${timeSignature.numerator}/${timeSignature.denominator}`;
    return;
  }

  elements.metronomeStatus.textContent = `${tempo} BPM · ${subdivisionLabel} · ${timeSignature.numerator}/${timeSignature.denominator}`;
}

function setRunningUi(isRunning) {
  elements.startButton.disabled = isRunning;
  elements.stopButton.disabled = !isRunning;
  elements.deviceSelect.disabled = isRunning;
  elements.calibrationDeviceSelect.disabled = isRunning;
  elements.autoTuneDeviceSelect.disabled = isRunning;
  elements.exerciseDeviceSelect.disabled = isRunning || state.exercise.running;
  elements.refreshDevicesButton.disabled = isRunning;
  updateCalibrationUi();
  updateAutoDetectionUi();
  updateExerciseCaptureUi();
}

function initializeSessionClock() {
  state.sessionStartedAtDate = new Date();
  state.sessionStartPerformanceMs = performance.now();
}

function flashHitIndicator() {
  elements.hitIndicator.classList.add("active");
  window.clearTimeout(state.hitIndicatorTimeout);
  state.hitIndicatorTimeout = window.setTimeout(() => {
    elements.hitIndicator.classList.remove("active");
  }, 100);
}

function resetMetronomeIndicatorFlash() {
  state.metronomeFlashVersion += 1;
  window.clearTimeout(state.metronomeFlashTimeout);
  state.metronomeFlashTimeout = null;
  elements.metronomeIndicator.classList.remove("active");
}

function flashMetronomeIndicator(delayMs = 0) {
  const safeDelay = Math.max(0, delayMs);
  const flashVersion = state.metronomeFlashVersion;
  window.setTimeout(() => {
    if (flashVersion !== state.metronomeFlashVersion || !state.metronomeRunning) {
      return;
    }

    elements.metronomeIndicator.classList.add("active");
    window.clearTimeout(state.metronomeFlashTimeout);
    state.metronomeFlashTimeout = window.setTimeout(() => {
      if (flashVersion !== state.metronomeFlashVersion) {
        return;
      }
      elements.metronomeIndicator.classList.remove("active");
    }, 90);
  }, safeDelay);
}

function createDetector(sampleRate) {
  state.detector = new DrumHitDetector({
    sampleRate,
    ...getDetectorParameters(),
  });
}

function updateDebugReadoutGroup(rawElement, filteredElement, thresholdElement, triggeredElement) {
  if (!rawElement || !filteredElement || !thresholdElement || !triggeredElement) {
    return;
  }

  rawElement.textContent = state.lastMetrics.rawPeak.toFixed(3);
  filteredElement.textContent = state.lastMetrics.filteredPeak.toFixed(3);
  thresholdElement.textContent = state.lastMetrics.threshold.toFixed(3);
  triggeredElement.textContent = state.lastMetrics.triggered ? "Yes" : "No";
}

function updateDebugReadouts() {
  updateDebugReadoutGroup(
    elements.rawAmplitudeValue,
    elements.filteredAmplitudeValue,
    elements.thresholdLineValue,
    elements.triggeredValue
  );
  updateDebugReadoutGroup(
    elements.settingsRawAmplitudeValue,
    elements.settingsFilteredAmplitudeValue,
    elements.settingsThresholdLineValue,
    elements.settingsTriggeredValue
  );
  updateDebugReadoutGroup(
    elements.autoTuneRawAmplitudeValue,
    elements.autoTuneFilteredAmplitudeValue,
    elements.autoTuneThresholdLineValue,
    elements.autoTuneTriggeredValue
  );
}

function updateStats() {
  elements.hitCount.textContent = String(state.hits.length);
  elements.lastHitValue.textContent =
    state.hits.length > 0 ? state.hits[state.hits.length - 1].elapsed : "--";

  const bpm = calculateBpmFromHits(state.hits.map((hit) => hit.timeSeconds));
  elements.bpmValue.textContent = bpm ? bpm.toFixed(1) : "--";
  elements.exportButton.disabled = state.hits.length === 0;
}

function formatPlainMilliseconds(value, fallback = "--") {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return fallback;
  }

  const safeValue = Number(value);
  return `${safeValue >= 0 ? "+" : ""}${safeValue.toFixed(1)} ms`;
}

function formatRushDragMilliseconds(offsetMs, fallback = "--") {
  if (offsetMs === null || offsetMs === undefined || Number.isNaN(offsetMs)) {
    return fallback;
  }

  return formatPlainMilliseconds(-offsetMs, fallback);
}

function formatExerciseDuration(seconds) {
  if (!Number.isFinite(seconds)) {
    return "--";
  }

  return `${seconds.toFixed(1)} sec`;
}

function normalizeExerciseScore(score) {
  const numericScore = Number(score);
  if (!Number.isFinite(numericScore)) {
    return 0;
  }

  // Older prototype builds stored scores on a larger integer scale; keep
  // existing browser history readable after moving the UI to percentages.
  const percentageScore = numericScore > 100 ? numericScore / 16 : numericScore;
  return clamp(Math.round(percentageScore), 0, 100);
}

function getRecordGraphDomainBeats(record) {
  const storedTotal = Number(record?.totalQuarterBeats);
  if (Number.isFinite(storedTotal) && storedTotal > 0) {
    return storedTotal;
  }

  if (state.exercise.loaded?.id === record?.exerciseId) {
    return Math.max(1, Number(state.exercise.loaded.totalQuarterBeats) || 1);
  }

  return Math.max(
    1,
    ...(record?.targetResults ?? []).map((point) => Number(point.beatPosition) || 0),
    ...(record?.offsets ?? []).map((point) => Number(point.beatPosition) || 0)
  );
}

function formatExerciseScore(score) {
  return `${normalizeExerciseScore(score)}%`;
}

function setAppMode(mode) {
  const nextMode =
    mode === "exercise" ? "exercise" : mode === "settings" ? "settings" : mode === "stats" ? "stats" : "live";
  const modeChanged = state.appMode !== nextMode;
  if (modeChanged && state.running) {
    void stopCapture({ finalizeExercise: false });
  }
  if (modeChanged) {
    stopExerciseListen();
  }
  if (nextMode !== "live" && isTimelineFullscreen()) {
    state.fullscreen.active = false;
    state.fullscreen.dragType = null;
    state.fullscreen.sidebarCollapsed = false;
    updateTimelineFullscreenButton();
  }

  state.appMode = nextMode;
  if (nextMode === "exercise") {
    restoreOffscreenExerciseRender();
  }
  document.body.classList.toggle("app-mode-exercise", nextMode === "exercise");
  document.body.classList.toggle("app-mode-settings", nextMode === "settings");
  document.body.classList.toggle("app-mode-stats", nextMode === "stats");
  elements.liveModeButton.classList.toggle("is-active", nextMode === "live");
  elements.exerciseModeButton.classList.toggle("is-active", nextMode === "exercise");
  elements.settingsModeButton.classList.toggle("is-active", nextMode === "settings");
  elements.statsModeButton.classList.toggle("is-active", nextMode === "stats");
  const modeInfo = MODE_INFO_COPY[nextMode] ?? MODE_INFO_COPY.settings;
  elements.modeInfoEyebrow.textContent = modeInfo.eyebrow;
  elements.modeInfoTitle.textContent = modeInfo.title;
  elements.modeInfoCopy.textContent = modeInfo.copy;
  elements.timelineWorkspace.hidden = nextMode !== "live";
  elements.debugHomeHost.hidden = nextMode !== "live";
  elements.exerciseModeSection.hidden = nextMode !== "exercise";
  elements.settingsModeSection.hidden = nextMode !== "settings";
  elements.statsModeSection.hidden = nextMode !== "stats";
  syncMetronomePanelPlacement();
  updateExerciseCaptureUi();
  if (nextMode === "exercise") {
    window.requestAnimationFrame(() => {
      void ensureExerciseSheetRendered();
    });
  }
  if (nextMode === "stats") {
    renderStatsPage();
  }
  requestRenderAfterLayoutTransition();
}

function getOsmdClass() {
  return (
    window.opensheetmusicdisplay?.OpenSheetMusicDisplay ??
    window.OpenSheetMusicDisplay ??
    null
  );
}

function getRenderedExerciseSheetSvg() {
  return elements.sheetMusicContainer.querySelector(
    "svg:not(.sheet-tendency-graph-layer):not(.sheet-dynamics-graph-layer)"
  );
}

function getJsZipClass() {
  return window.JSZip ?? null;
}

async function getMusicXmlTextFromFile(file) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".xml") || lowerName.endsWith(".musicxml")) {
    return file.text();
  }

  const JSZipClass = getJsZipClass();
  if (!JSZipClass) {
    throw new Error("JSZip is not loaded, so .mxl files cannot be unzipped.");
  }

  const zip = await JSZipClass.loadAsync(await file.arrayBuffer());
  const containerFile = zip.file("META-INF/container.xml");
  if (containerFile) {
    const containerXml = await containerFile.async("string");
    const containerDocument = new DOMParser().parseFromString(containerXml, "application/xml");
    const rootFile = containerDocument.getElementsByTagName("rootfile")[0];
    const rootPath = rootFile?.getAttribute("full-path");
    if (rootPath && zip.file(rootPath)) {
      return zip.file(rootPath).async("string");
    }
  }

  const scoreFile = Object.values(zip.files).find(
    (entry) => !entry.dir && entry.name.toLowerCase().endsWith(".xml")
  );
  if (!scoreFile) {
    throw new Error("No MusicXML score file was found inside the .mxl archive.");
  }

  return scoreFile.async("string");
}

async function getMusicXmlTextFromUrl(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Could not load ${path}.`);
  }

  const blob = await response.blob();
  return getMusicXmlTextFromFile(new File([blob], path.split("/").pop() || "exercise.mxl"));
}

async function renderExerciseSheet(xmlText) {
  const OsmdClass = getOsmdClass();
  elements.sheetMusicContainer.innerHTML = "";

  if (!OsmdClass) {
    elements.sheetMusicContainer.innerHTML =
      '<div class="sheet-placeholder">Sheet display library failed to load, but analysis still works.</div>';
    return;
  }

  const osmd = new OsmdClass(elements.sheetMusicContainer, {
    autoResize: false,
    backend: "svg",
    disableCursor: false,
    drawTitle: true,
    drawingParameters: "compact",
    followCursor: false,
    cursorsOptions: [
      {
        type: 1,
        color: "#ffb86b",
        alpha: 0.95,
        follow: false,
      },
    ],
  });
  state.exercise.osmd = osmd;
  await osmd.load(xmlText);
  osmd.zoom = 0.82;
  osmd.render();
  normalizeExerciseSheetSvg();
  cacheExerciseSheetCursorPositions();
  hideExerciseSheetCursor();
}

async function ensureExerciseSheetRendered() {
  if (elements.exerciseModeSection.hidden || !state.exercise.sourceXmlText) {
    return;
  }

  if (!state.exercise.osmd) {
    await renderExerciseSheet(state.exercise.sourceXmlText);
    return;
  }

  rerenderExerciseSheet();
}

function normalizeExerciseSheetSvg() {
  const svg = getRenderedExerciseSheetSvg();
  if (!svg) {
    return;
  }

  svg.style.display = "block";
  svg.style.width = "100%";
  svg.style.height = "auto";
  svg.style.minHeight = "280px";
  svg.style.background = "transparent";

  for (const element of svg.querySelectorAll("path, text, line, polyline, polygon, circle, ellipse")) {
    const fill = element.getAttribute("fill");
    const stroke = element.getAttribute("stroke");
    if (fill && fill !== "none") {
      element.setAttribute("fill", "#06131d");
    }
    if (stroke && stroke !== "none") {
      element.setAttribute("stroke", "#06131d");
    }
    element.style.opacity = "1";
    element.style.visibility = "visible";
  }

  normalizeExerciseStickingRows(svg);
}

function normalizeExerciseStickingRows(svg) {
  const stickingElements = [...svg.querySelectorAll("text")]
    .filter((element) => /^[LR]$/.test(element.textContent.trim()))
    .map((element) => {
      try {
        const box = element.getBBox();
        const centerY = box.y + box.height / 2;
        return Number.isFinite(centerY) ? { element, centerY } : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.centerY - right.centerY);

  if (stickingElements.length < 2) {
    return;
  }

  const systemRows = [];
  stickingElements.forEach((entry) => {
    const row = systemRows.find((candidate) =>
      Math.abs(candidate.centerY - entry.centerY) <= 56
    );
    if (row) {
      row.entries.push(entry);
      row.centerY =
        row.entries.reduce((sum, item) => sum + item.centerY, 0) / row.entries.length;
      return;
    }

    systemRows.push({ centerY: entry.centerY, entries: [entry] });
  });

  systemRows.forEach((row) => {
    if (row.entries.length < 2) {
      return;
    }

    const targetCenterY = getStickingBaselineCenter(row.entries);
    row.entries.forEach(({ element, centerY }) => {
      const deltaY = targetCenterY - centerY;
      if (Math.abs(deltaY) < 0.5) {
        return;
      }

      const currentY = Number.parseFloat(element.getAttribute("y"));
      if (Number.isFinite(currentY)) {
        element.setAttribute("y", String(currentY + deltaY));
        return;
      }

      const transform = element.getAttribute("transform") || "";
      element.setAttribute("transform", `${transform} translate(0 ${deltaY})`.trim());
    });
  });
}

function getStickingBaselineCenter(entries) {
  const clusters = [];
  entries.forEach((entry) => {
    const cluster = clusters.find((candidate) =>
      Math.abs(candidate.centerY - entry.centerY) <= 8
    );
    if (cluster) {
      cluster.entries.push(entry);
      cluster.centerY =
        cluster.entries.reduce((sum, item) => sum + item.centerY, 0) /
        cluster.entries.length;
      return;
    }

    clusters.push({ centerY: entry.centerY, entries: [entry] });
  });

  return clusters.sort(
    (left, right) => right.entries.length - left.entries.length || left.centerY - right.centerY
  )[0].centerY;
}

function getExerciseCursor() {
  return state.exercise.osmd?.cursor ?? null;
}

function getNativeExerciseCursorElement() {
  const cursor = getExerciseCursor();
  if (!cursor) {
    return null;
  }

  return (
    cursor.cursorElement ??
    (cursor.cursorElementId ? document.getElementById(cursor.cursorElementId) : null) ??
    elements.sheetMusicContainer.querySelector('img[id*="cursor"], img[src*="cursor"]')
  );
}

function getSheetProgressCursorElement() {
  let progressCursor = elements.sheetMusicContainer.querySelector(".sheet-progress-cursor");
  if (!progressCursor) {
    progressCursor = document.createElement("div");
    progressCursor.className = "sheet-progress-cursor";
    progressCursor.setAttribute("aria-hidden", "true");
    elements.sheetMusicContainer.append(progressCursor);
  }

  return progressCursor;
}

function getExerciseReadyPromptElement() {
  let prompt = elements.sheetMusicContainer.querySelector(".sheet-ready-prompt");
  if (!prompt) {
    prompt = document.createElement("div");
    prompt.className = "sheet-ready-prompt";
    prompt.hidden = true;
    prompt.setAttribute("aria-live", "polite");
    prompt.innerHTML = "<span>Get ready to play!</span>";
    elements.sheetMusicContainer.append(prompt);
  }

  return prompt;
}

function hideExerciseReadyPrompt() {
  const prompt = elements.sheetMusicContainer.querySelector(".sheet-ready-prompt");
  if (prompt) {
    prompt.hidden = true;
  }
}

function updateExerciseReadyPrompt() {
  if (state.appMode !== "exercise" || !state.exercise.running) {
    hideExerciseReadyPrompt();
    return;
  }

  const prompt = getExerciseReadyPromptElement();
  const currentElapsed = getCurrentSessionElapsedSeconds();
  prompt.hidden = currentElapsed >= state.exercise.scoreStartTimeSeconds;
}

function syncSheetProgressCursorFromOsmd() {
  const position = getNativeExerciseCursorPosition();
  if (!position) {
    hideExerciseSheetCursor();
    return false;
  }

  applySheetProgressCursorPosition(position);
  return true;
}

function getNativeExerciseCursorPosition() {
  const nativeCursor = getNativeExerciseCursorElement();
  if (!nativeCursor) {
    return null;
  }

  const nativeStyle = nativeCursor.style;
  const left = Number.parseFloat(nativeStyle.left);
  const top = Number.parseFloat(nativeStyle.top);
  const nativeHeight =
    Number.parseFloat(nativeStyle.height) || nativeCursor.getBoundingClientRect().height || 132;
  const nativeWidth =
    Number.parseFloat(nativeStyle.width) || nativeCursor.getBoundingClientRect().width || 4;

  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    return null;
  }

  const cursorHeight = clamp(nativeHeight * 0.5, 48, 88);
  return {
    left: left + nativeWidth / 2,
    top: Math.max(12, top + (nativeHeight - cursorHeight) / 2),
    height: cursorHeight,
  };
}

function applySheetProgressCursorPosition(position) {
  const progressCursor = getSheetProgressCursorElement();
  progressCursor.style.left = `${position.left}px`;
  progressCursor.style.top = `${position.top}px`;
  progressCursor.style.height = `${position.height}px`;
  progressCursor.classList.add("is-visible");
}

function showExerciseSheetCursor() {
  const cursor = getExerciseCursor();
  if (!cursor) {
    return false;
  }

  try {
    cursor.show();
    return syncSheetProgressCursorFromOsmd();
  } catch {
    return false;
  }
}

function hideExerciseSheetCursor() {
  const cursor = getExerciseCursor();
  const progressCursor = elements.sheetMusicContainer.querySelector(".sheet-progress-cursor");

  if (cursor) {
    try {
      cursor.hide();
    } catch {
      // The score can still render without cursor support.
    }
  }

  progressCursor?.classList.remove("is-visible");
  state.exercise.sheetCursorIndex = -1;
}

function cacheExerciseSheetCursorPositions() {
  const cursor = getExerciseCursor();
  if (!cursor || !state.exercise.loaded?.expectedHits?.length) {
    state.exercise.sheetCursorPositions = [];
    return;
  }

  const visualHitAnchors = getExerciseSheetCursorAnchors();
  const positions = [];
  try {
    cursor.reset();
    for (let index = 0; index < visualHitAnchors.length; index += 1) {
      if (index > 0) {
        cursor.next();
      }
      cursor.show();
      const position = getNativeExerciseCursorPosition();
      if (position) {
        positions[index] = {
          ...position,
          hitIndex: visualHitAnchors[index].index,
          timeSeconds: visualHitAnchors[index].timeSeconds,
        };
      }
    }
  } catch {
    state.exercise.sheetCursorPositions = [];
    return;
  } finally {
    try {
      cursor.reset();
      cursor.hide();
    } catch {
      // Keep the custom cursor cache if OSMD cleanup fails.
    }
  }

  state.exercise.sheetCursorPositions = positions;
  state.exercise.sheetCursorIndex = -1;
}

function getExerciseSheetCursorAnchors() {
  const exercise = state.exercise.loaded;
  if (!exercise) {
    return [];
  }

  if (exercise.writtenNoteAnchors?.length) {
    return exercise.writtenNoteAnchors;
  }

  return exercise.expectedHits.filter((hit) => !hit.isDiddleContinuation);
}

function refreshExerciseCursorPositionTimes() {
  if (!state.exercise.loaded || !state.exercise.sheetCursorPositions.length) {
    return;
  }

  const visualHitAnchors = getExerciseSheetCursorAnchors();
  state.exercise.sheetCursorPositions.forEach((position, index) => {
    if (position && visualHitAnchors[index]) {
      position.hitIndex = visualHitAnchors[index].index;
      position.timeSeconds = visualHitAnchors[index].timeSeconds;
    }
  });
}

function getInterpolatedExerciseCursorPosition(exerciseTimeSeconds) {
  const positions = state.exercise.sheetCursorPositions.filter(Boolean);
  if (!positions?.length || exerciseTimeSeconds < -0.02) {
    return null;
  }

  const lastPosition = positions[positions.length - 1];
  if (exerciseTimeSeconds >= lastPosition.timeSeconds) {
    return lastPosition;
  }

  const startIndex = findSheetCursorPositionIndexAtTime(positions, exerciseTimeSeconds);
  const startPosition = positions[startIndex];
  const endPosition = positions[startIndex + 1] ?? startPosition;
  if (!startPosition || !endPosition) {
    return null;
  }

  const duration = endPosition.timeSeconds - startPosition.timeSeconds;
  if (duration <= 0.001) {
    return startPosition;
  }

  const progress = clamp((exerciseTimeSeconds - startPosition.timeSeconds) / duration, 0, 1);
  return {
    left: startPosition.left + (endPosition.left - startPosition.left) * progress,
    top: startPosition.top + (endPosition.top - startPosition.top) * progress,
    height: startPosition.height + (endPosition.height - startPosition.height) * progress,
  };
}

function findSheetCursorPositionIndexAtTime(positions, exerciseTimeSeconds) {
  let low = 0;
  let high = positions.length - 1;
  let bestIndex = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if ((positions[middle]?.timeSeconds ?? 0) <= exerciseTimeSeconds + 0.001) {
      bestIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return bestIndex;
}

function getExerciseListenElapsedSeconds() {
  if (!state.exercise.listening || state.exercise.listenStartPerformanceMs === null) {
    return 0;
  }

  return Math.max(0, (performance.now() - state.exercise.listenStartPerformanceMs) / 1000);
}

function getExerciseCursorTimeSeconds() {
  if (state.exercise.running) {
    return getCurrentSessionElapsedSeconds() - state.exercise.scoreStartTimeSeconds;
  }

  if (state.exercise.listening) {
    return getExerciseListenElapsedSeconds() - state.exercise.listenScoreStartTimeSeconds;
  }

  return null;
}

function updateExerciseSheetProgress() {
  if (!state.exercise.loaded || (!state.exercise.running && !state.exercise.listening)) {
    hideExerciseSheetCursor();
    return;
  }

  const exerciseTimeSeconds = getExerciseCursorTimeSeconds();
  if (exerciseTimeSeconds === null) {
    return;
  }

  if (!state.exercise.sheetCursorPositions.length) {
    cacheExerciseSheetCursorPositions();
  }

  const position = getInterpolatedExerciseCursorPosition(exerciseTimeSeconds);
  if (position) {
    applySheetProgressCursorPosition(position);
  } else {
    hideExerciseSheetCursor();
  }
}

function rerenderExerciseSheet() {
  if (!state.exercise.osmd || elements.exerciseModeSection.hidden) {
    return;
  }

  state.exercise.osmd.render();
  normalizeExerciseSheetSvg();
  cacheExerciseSheetCursorPositions();
  if (state.exercise.listening || state.exercise.running) {
    updateExerciseSheetProgress();
  } else {
    hideExerciseSheetCursor();
  }
}

async function loadExerciseXml(xmlText, fileName) {
  stopExerciseListen();
  const parsedExercise = parseMusicXmlText(xmlText, { fileName });
  const tempoExercise = withExerciseTempo(parsedExercise, parsedExercise.defaultTempoBpm);
  state.exercise.loaded = tempoExercise;
  state.exercise.sourceXmlText = xmlText;
  state.exercise.sourceFileName = fileName;
  elements.exerciseTempoInput.value = String(tempoExercise.defaultTempoBpm);
  if (elements.exerciseModeSection.hidden) {
    state.exercise.osmd = null;
    elements.sheetMusicContainer.innerHTML =
      '<div class="sheet-placeholder">Sheet music will render when Exercise Analysis is opened.</div>';
  } else {
    await renderExerciseSheet(xmlText);
  }
  updateExerciseFromTempoInput();
  updateExerciseStaticUi();
  updateExerciseCaptureUi();
  renderExerciseHighScores();
  requestRender();
}

async function loadBuiltInExercise(exerciseId) {
  const exerciseConfig = state.exercise.builtInExercises.find(
    (exercise) => exercise.id === exerciseId
  );
  if (!exerciseConfig) {
    throw new Error("Unknown exercise selection.");
  }

  const xmlText = await getMusicXmlTextFromUrl(exerciseConfig.path);
  await loadExerciseXml(xmlText, `${exerciseConfig.id}.mxl`);
}

function loadSelectedExerciseFromControl() {
  const selectedExercise = elements.exerciseSelect.value;
  if (selectedExercise === state.exercise.selectionRequestId) {
    return;
  }

  state.exercise.selectionRequestId = selectedExercise;
  const uploadedExercise = state.exercise.uploadedExercises.get(selectedExercise);
  const loadPromise = uploadedExercise
    ? loadExerciseXml(uploadedExercise.xmlText, uploadedExercise.fileName)
    : loadBuiltInExercise(selectedExercise);

  void loadPromise
    .then(() => {
      state.exercise.selectedExerciseId = selectedExercise;
    })
    .catch((error) => {
      state.exercise.selectionRequestId = state.exercise.selectedExerciseId;
      setMessage(error.message);
    });
}

function updateExerciseFromTempoInput() {
  if (!state.exercise.loaded) {
    return;
  }

  if (state.exercise.listening) {
    stopExerciseListen();
  }

  state.exercise.loaded = withExerciseTempo(
    state.exercise.loaded,
    clamp(Number(elements.exerciseTempoInput.value) || state.exercise.loaded.defaultTempoBpm, 40, 240)
  );
  elements.exerciseTempoInput.value = String(state.exercise.loaded.tempoBpm);
  refreshExerciseCursorPositionTimes();
  updateExerciseStaticUi();
  updateExerciseLiveAnalysis();
  requestRender();
}

function updateExerciseStaticUi() {
  const exercise = state.exercise.loaded;
  if (!exercise) {
    return;
  }

  elements.exerciseTitle.textContent = exercise.title;
  elements.exerciseMetadata.textContent = `${exercise.tempoBpm} BPM · ${exercise.timeSignature.numerator}/${exercise.timeSignature.denominator} · ${exercise.fileName}`;
  elements.exerciseHitTargetValue.textContent = `Targets: ${exercise.expectedHits.length}`;
  elements.exerciseDurationValue.textContent = `Duration: ${formatExerciseDuration(exercise.durationSeconds)}`;

  if (exercise.warnings?.length) {
    elements.exerciseWarnings.hidden = false;
    elements.exerciseWarnings.innerHTML = "";
    exercise.warnings.forEach((warning) => {
      const warningLine = document.createElement("div");
      warningLine.textContent = warning;
      elements.exerciseWarnings.append(warningLine);
    });
  } else {
    elements.exerciseWarnings.hidden = true;
    elements.exerciseWarnings.textContent = "";
  }
  updateExerciseTendenciesButton();
  updateExerciseDynamicsToggleButton();
}

function updateExerciseCaptureUi() {
  const isStarting = state.exercise.starting;
  const isStopping = state.exercise.stopping;
  const isRunning = state.exercise.running;
  const isListening = state.exercise.listening;
  const isBusy = isStarting || isStopping || isRunning || isListening || state.exercise.resultOverlayOpen;
  const shouldLockExerciseTempoControls = state.appMode === "exercise" && (isRunning || isListening);
  elements.exerciseStartButton.disabled = isBusy || state.running || !state.exercise.loaded;
  elements.exerciseListenButton.disabled = isRunning || !state.exercise.loaded;
  elements.exerciseListenButton.textContent = isListening ? "Stop Listen" : "Listen";
  elements.exerciseStopButton.disabled = !isRunning;
  elements.exerciseSelect.disabled = isBusy;
  elements.exerciseDeviceSelect.disabled = isRunning;
  elements.exerciseUploadInput.disabled = isBusy;
  elements.exerciseTempoInput.disabled = isBusy;
  elements.metronomeTempoInput.disabled = shouldLockExerciseTempoControls;
  elements.metronomeTempoNumber.disabled = shouldLockExerciseTempoControls;
  elements.metronomeSubdivisionSelect.disabled = shouldLockExerciseTempoControls;
  elements.metronomeNumeratorInput.disabled = shouldLockExerciseTempoControls;
  elements.metronomeDenominatorSelect.disabled = shouldLockExerciseTempoControls;
  elements.metronomeVolumeInput.disabled = false;
  elements.metronomeEnabledInput.disabled = shouldLockExerciseTempoControls;
  elements.exerciseGuideEnabledInput.disabled = shouldLockExerciseTempoControls;
  elements.exerciseGuideToggleButton.disabled = shouldLockExerciseTempoControls;
  elements.exerciseTendenciesButton.disabled = !state.exercise.loaded;
  elements.exerciseDynamicsToggleButton.disabled = !state.exercise.loaded;
}

function updateExercisePanelVisibility() {
  const bothGraphsExpanded =
    Boolean(elements.exerciseTimelinePanel.open) && Boolean(elements.exerciseOffsetPanel.open);
  elements.exerciseReviewGrid.classList.toggle("graphs-expanded", bothGraphsExpanded);
  requestRenderAfterLayoutTransition();
}

function updateExerciseGuideToggleUi() {
  const enabled = Boolean(elements.exerciseGuideEnabledInput.checked);
  elements.exerciseGuideToggleButton.textContent = enabled
    ? "Mute exercise during reps"
    : "Play exercise during reps";
  elements.exerciseGuideToggleButton.setAttribute("aria-pressed", String(enabled));
  elements.exerciseGuideToggleButton.classList.toggle("is-active", enabled);
}

function updateExerciseTendenciesButton() {
  if (!elements.exerciseTendenciesButton) {
    return;
  }

  const enabled = Boolean(state.exercise.tendenciesVisible);
  elements.exerciseTendenciesButton.textContent = enabled ? "Hide Tendencies" : "Display Tendencies";
  elements.exerciseTendenciesButton.setAttribute("aria-pressed", String(enabled));
  elements.exerciseTendenciesButton.classList.toggle("is-active", enabled);
  elements.exerciseTendenciesButton.disabled = !state.exercise.loaded;
}

function updateExerciseDynamicsToggleButton() {
  if (!elements.exerciseDynamicsToggleButton) {
    return;
  }

  const enabled = Boolean(state.exercise.dynamicsVisible);
  elements.exerciseDynamicsToggleButton.textContent = enabled ? "Hide Dynamics" : "Display Dynamics";
  elements.exerciseDynamicsToggleButton.setAttribute("aria-pressed", String(enabled));
  elements.exerciseDynamicsToggleButton.classList.toggle("is-active", enabled);
  elements.exerciseDynamicsToggleButton.disabled = !state.exercise.loaded;
}

function loadExerciseHighScores() {
  const parsed = readStoredJson(EXERCISE_STORAGE_KEY, []);
  state.exercise.highScores = Array.isArray(parsed)
    ? parsed.map((score) => ({
        ...score,
        score: normalizeExerciseScore(score.score),
      }))
    : [];
}

function saveExerciseHighScore(record) {
  const normalizedRecord = {
    ...record,
    score: normalizeExerciseScore(record.score),
  };
  const nextScores = [...state.exercise.highScores, normalizedRecord]
    .sort((left, right) => right.score - left.score || Date.parse(right.dateIso) - Date.parse(left.dateIso))
    .slice(0, 25);
  state.exercise.highScores = nextScores;
  writeStoredJson(EXERCISE_STORAGE_KEY, nextScores);
}

function renderExerciseHighScores() {
  if (!elements.exerciseHighScores) {
    return;
  }

  const exercise = state.exercise.loaded;
  const relevantScores = state.exercise.highScores
    .filter((score) => !exercise || score.exerciseId === exercise.id)
    .slice(0, 5);

  elements.exerciseHighScores.innerHTML = "";
  if (relevantScores.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.textContent = "No scores yet";
    elements.exerciseHighScores.append(emptyItem);
    return;
  }

  relevantScores.forEach((score) => {
    const item = document.createElement("li");
    item.textContent = `${formatExerciseScore(score.score)} · ${score.tempoBpm} BPM · ${new Date(score.dateIso).toLocaleDateString()}`;
    elements.exerciseHighScores.append(item);
  });
}

function loadAppStats() {
  const storedStats = readStoredJson(APP_STATS_STORAGE_KEY, {});
  const parsed =
    storedStats && typeof storedStats === "object" && !Array.isArray(storedStats)
      ? storedStats
      : {};
  state.appStats = {
    totalHits: Math.max(0, Number(parsed.totalHits) || 0),
    totalCalibrationsCompleted: Math.max(0, Number(parsed.totalCalibrationsCompleted) || 0),
  };
}

function saveAppStats() {
  writeStoredJson(APP_STATS_STORAGE_KEY, state.appStats);
}

function loadExerciseRepHistory() {
  const parsed = readStoredJson(EXERCISE_REP_HISTORY_KEY, []);
  state.exercise.repHistory = Array.isArray(parsed)
    ? parsed.map((record) => ({
        ...record,
        score: normalizeExerciseScore(record.score),
        offsets: Array.isArray(record.offsets) ? record.offsets : [],
        dynamics: Array.isArray(record.dynamics) ? record.dynamics : [],
        targetResults: Array.isArray(record.targetResults) ? record.targetResults : [],
      }))
    : [];
}

function saveExerciseRepHistory() {
  writeStoredJson(EXERCISE_REP_HISTORY_KEY, state.exercise.repHistory);
}

function averageNumbers(values) {
  const cleanValues = values.filter((value) => Number.isFinite(value));
  if (!cleanValues.length) {
    return null;
  }

  return cleanValues.reduce((sum, value) => sum + value, 0) / cleanValues.length;
}

function getTimingTendency(meanOffsetMs) {
  if (!Number.isFinite(meanOffsetMs) || Math.abs(meanOffsetMs) < 8) {
    return "Balanced";
  }

  return meanOffsetMs < 0 ? "Rushing" : "Dragging";
}

function buildRepRecord(analysis, scoreRecord) {
  const offsets = analysis.matches
    .filter((match) => match.offsetMs !== null)
    .map((match) => ({
      beatPosition: Number(match.expected.beatPosition.toFixed(4)),
      offsetMs: Number(match.offsetMs.toFixed(2)),
    }));
  const exercise = state.exercise.loaded;
  const totalQuarterBeats = Number(exercise?.totalQuarterBeats) || null;
  const dynamics = state.hits
    .map((hit) => {
      const beatPosition = ((hit.timeSeconds - state.exercise.scoreStartTimeSeconds) * exercise.tempoBpm) / 60;
      return {
        beatPosition: Number(beatPosition.toFixed(4)),
        strength: Number((Number(hit.strength) || 0).toFixed(6)),
      };
    })
    .filter(
      (point) =>
        Number.isFinite(point.beatPosition) &&
        point.beatPosition >= -0.001 &&
        (!totalQuarterBeats || point.beatPosition <= totalQuarterBeats + 0.001) &&
        point.strength > 0
    );
  const exerciseHistory = state.exercise.repHistory.filter(
    (record) => record.exerciseId === scoreRecord.exerciseId
  );

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...scoreRecord,
    repNumber: exerciseHistory.length + 1,
    tendency: getTimingTendency(scoreRecord.stats?.meanOffsetMs),
    totalQuarterBeats,
    durationSeconds: Number(exercise?.durationSeconds) || null,
    insights: analysis.insights ?? [],
    offsets,
    dynamics,
    targetResults: buildTargetTimingResults(analysis),
  };
}

function capRepHistoryByExercise(records) {
  const perExerciseCounts = new Map();
  const kept = [];

  for (const record of [...records].reverse()) {
    const count = perExerciseCounts.get(record.exerciseId) ?? 0;
    if (count >= HEATMAP_MAX_REPS_PER_EXERCISE) {
      continue;
    }

    perExerciseCounts.set(record.exerciseId, count + 1);
    kept.push(record);
  }

  return kept.reverse().slice(-500);
}

function saveCompletedRep(analysis, scoreRecord) {
  const repRecord = buildRepRecord(analysis, scoreRecord);
  state.exercise.repHistory = capRepHistoryByExercise([...state.exercise.repHistory, repRecord]);
  saveExerciseRepHistory();
  renderSessionHistory();
  renderStatsPage();
  updateExerciseTendenciesButton();
  updateExerciseDynamicsToggleButton();
  requestRender();
}

function getDefaultExerciseIds() {
  return new Set(state.exercise.builtInExercises.map((exercise) => exercise.id));
}

function getExerciseTitleById(exerciseId) {
  return (
    state.exercise.builtInExercises.find((exercise) => exercise.id === exerciseId)?.title ??
    state.exercise.repHistory.find((record) => record.exerciseId === exerciseId)?.exerciseTitle ??
    exerciseId
  );
}

function getRepBestRecord(records = state.exercise.repHistory) {
  return [...records].sort((left, right) => right.score - left.score || Date.parse(right.dateIso) - Date.parse(left.dateIso))[0] ?? null;
}

function getMostPlayedExercise() {
  const counts = new Map();
  state.exercise.repHistory.forEach((record) => {
    counts.set(record.exerciseId, (counts.get(record.exerciseId) ?? 0) + 1);
  });
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0] ?? null;
}

function makeStatCard(label, value) {
  const card = document.createElement("article");
  card.className = "stat-card";
  const labelElement = document.createElement("span");
  labelElement.textContent = label;
  const valueElement = document.createElement("strong");
  valueElement.textContent = value;
  card.append(labelElement, valueElement);
  return card;
}

function getExerciseStats() {
  const defaultExerciseIds = getDefaultExerciseIds();
  return state.exercise.builtInExercises.map((exercise) => {
    const records = state.exercise.repHistory.filter((record) => record.exerciseId === exercise.id);
    const scores = records.map((record) => record.score);
    const meanOffsets = records
      .map((record) => record.stats?.meanOffsetMs)
      .filter((offset) => Number.isFinite(offset));
    const averageScore = averageNumbers(scores);
    const meanOffset = averageNumbers(meanOffsets);
    return {
      exercise,
      records,
      highScore: scores.length ? Math.max(...scores) : null,
      averageScore,
      repsCompleted: records.length,
      tendency: getTimingTendency(meanOffset),
      meanOffset,
      isDefault: defaultExerciseIds.has(exercise.id),
    };
  }).sort((left, right) => {
    const leftScore = left.averageScore ?? -1;
    const rightScore = right.averageScore ?? -1;
    return rightScore - leftScore || (right.highScore ?? -1) - (left.highScore ?? -1);
  });
}

function renderStatsPage() {
  if (!elements.lifetimeStatsGrid || !elements.exerciseStatsList) {
    return;
  }

  const totalReps = state.exercise.repHistory.length;
  const averageScore = averageNumbers(state.exercise.repHistory.map((record) => record.score));
  const bestRecord = getRepBestRecord();
  const mostPlayed = getMostPlayedExercise();

  elements.lifetimeStatsGrid.innerHTML = "";
  [
    ["Total hits", String(state.appStats.totalHits)],
    ["Total reps completed", String(totalReps)],
    ["Average rep score", averageScore === null ? "--" : formatExerciseScore(averageScore)],
    ["Most played exercise", mostPlayed ? `${getExerciseTitleById(mostPlayed[0])} (${mostPlayed[1]})` : "--"],
    ["Highest score", bestRecord ? `${formatExerciseScore(bestRecord.score)} · ${bestRecord.exerciseTitle}` : "--"],
    ["Calibrations completed", String(state.appStats.totalCalibrationsCompleted)],
  ].forEach(([label, value]) => {
    elements.lifetimeStatsGrid.append(makeStatCard(label, value));
  });

  elements.exerciseStatsList.innerHTML = "";
  getExerciseStats().forEach((stats, index) => {
    const card = document.createElement("article");
    card.className = "exercise-stat-card";
    card.innerHTML = `
      <span class="rank-badge">${index + 1}</span>
      <div class="exercise-stat-meta">
        <strong>${stats.exercise.title}</strong>
        <span>${stats.repsCompleted} reps completed</span>
      </div>
      <div class="exercise-stat-meta"><span>High</span><strong>${stats.highScore === null ? "--" : formatExerciseScore(stats.highScore)}</strong></div>
      <div class="exercise-stat-meta"><span>Average</span><strong>${stats.averageScore === null ? "--" : formatExerciseScore(stats.averageScore)}</strong></div>
      <div class="exercise-stat-meta"><span>Mean offset</span><strong>${Number.isFinite(stats.meanOffset) ? formatRushDragMilliseconds(stats.meanOffset) : "--"}</strong></div>
      <button
        class="ghost-button compact-button view-tendencies-button"
        type="button"
        data-exercise-tendencies-id="${stats.exercise.id}"
      >
        View Tendencies
      </button>
    `;
    elements.exerciseStatsList.append(card);
  });
}

function renderSessionHistory() {
  if (!elements.sessionHistoryList) {
    return;
  }

  const records = [...state.exercise.repHistory].reverse();
  const bestRecord = getRepBestRecord();
  elements.sessionHistoryList.innerHTML = "";
  elements.clearRepHistoryButton.disabled = records.length === 0;
  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "empty-history";
    empty.textContent = "No completed reps yet.";
    elements.sessionHistoryList.append(empty);
    return;
  }

  records.slice(0, 60).forEach((record) => {
    const item = document.createElement("article");
    item.className = `session-history-item${bestRecord?.id === record.id ? " is-best" : ""}`;
    item.innerHTML = `
      <div class="session-history-meta">
        <strong>${record.exerciseTitle}</strong>
        <span>Rep ${record.repNumber ?? "--"} · ${new Date(record.dateIso).toLocaleString()}</span>
      </div>
      <div class="session-history-meta"><span>Score</span><strong>${formatExerciseScore(record.score)}</strong></div>
      <div class="session-history-meta"><span>Tendency</span><strong>${record.tendency ?? getTimingTendency(record.stats?.meanOffsetMs)}</strong></div>
      <div class="session-history-meta"><span>Tempo</span><strong>${record.tempoBpm} BPM</strong></div>
    `;
    const graphActions = document.createElement("div");
    graphActions.className = "mini-rep-graphs";
    const offsetGraphButton = document.createElement("button");
    offsetGraphButton.className = "mini-rep-graph mini-offset-graph";
    offsetGraphButton.type = "button";
    offsetGraphButton.setAttribute("aria-label", `Open rush drag graph for ${record.exerciseTitle}`);
    offsetGraphButton.dataset.repId = record.id;
    offsetGraphButton.dataset.repGraphType = "offset";
    offsetGraphButton.innerHTML = buildOffsetGraphSvg(record.offsets, {
      width: 170,
      height: 58,
      totalQuarterBeats: getRecordGraphDomainBeats(record),
    });
    const dynamicsGraphButton = document.createElement("button");
    dynamicsGraphButton.className = "mini-rep-graph mini-dynamics-graph";
    dynamicsGraphButton.type = "button";
    dynamicsGraphButton.setAttribute("aria-label", `Open dynamics graph for ${record.exerciseTitle}`);
    dynamicsGraphButton.dataset.repId = record.id;
    dynamicsGraphButton.dataset.repGraphType = "dynamics";
    dynamicsGraphButton.innerHTML = buildDynamicsGraphSvg(record.dynamics, {
      width: 170,
      height: 58,
      totalQuarterBeats: getRecordGraphDomainBeats(record),
    });
    graphActions.append(offsetGraphButton, dynamicsGraphButton);
    item.append(graphActions);
    elements.sessionHistoryList.append(item);
  });
}

function buildOffsetGraphSvg(offsets = [], { width = 170, height = 58, totalQuarterBeats = null } = {}) {
  const padding = 7;
  const centerY = height / 2;
  const maxOffset = 70;
  const domainBeats = Math.max(
    1,
    Number(totalQuarterBeats) || 0,
    ...offsets.map((point) => Number(point.beatPosition) || 0)
  );
  const points = offsets.map((point) => {
    const x =
      padding +
      (clamp(Number(point.beatPosition) || 0, 0, domainBeats) / domainBeats) * (width - padding * 2);
    const y = centerY - (clamp(-point.offsetMs, -maxOffset, maxOffset) / maxOffset) * (height / 2 - padding);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const path = points.length > 1 ? points.join(" ") : "";
  return `
    <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">
      <line x1="${padding}" y1="${centerY}" x2="${width - padding}" y2="${centerY}" stroke="rgba(255,255,255,0.18)" stroke-width="1" />
      ${path ? `<polyline points="${path}" fill="none" stroke="#73e0a9" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />` : ""}
      ${points
        .map((point, index) => {
          const offset = offsets[index]?.offsetMs ?? 0;
          const color = offset < -8 ? "#ffb86b" : offset > 8 ? "#8ac7ff" : "#73e0a9";
          const [x, y] = point.split(",");
          return `<circle cx="${x}" cy="${y}" r="2.1" fill="${color}" />`;
        })
        .join("")}
    </svg>
  `;
}

function buildDynamicsGraphSvg(dynamics = [], { width = 170, height = 58, totalQuarterBeats = null } = {}) {
  const padding = 7;
  const domainBeats = Math.max(
    1,
    Number(totalQuarterBeats) || 0,
    ...dynamics.map((point) => Number(point.beatPosition) || 0)
  );
  const strengths = dynamics.map((point) => Number(point.strength) || 0).filter((value) => value > 0);
  const maxStrength = Math.max(0.08, ...strengths);
  const points = dynamics.map((point) => {
    const x =
      padding +
      (clamp(Number(point.beatPosition) || 0, 0, domainBeats) / domainBeats) * (width - padding * 2);
    const y =
      height -
      padding -
      (clamp((Number(point.strength) || 0) / maxStrength, 0, 1) * (height - padding * 2));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const path = points.length > 1 ? points.join(" ") : "";
  return `
    <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="rgba(255,255,255,0.16)" stroke-width="1" />
      ${path ? `<polyline points="${path}" fill="none" stroke="rgba(115,224,169,0.9)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />` : ""}
      ${points
        .map((point) => {
          const [x, y] = point.split(",");
          return `<circle cx="${x}" cy="${y}" r="2.1" fill="rgba(115,224,169,0.94)" stroke="rgba(255,255,255,0.42)" stroke-width="0.8" />`;
        })
        .join("")}
    </svg>
  `;
}

function openRepGraphOverlay(record, graphType = "offset") {
  state.activeRepGraphRecord = record;
  state.activeRepGraphType = graphType === "dynamics" ? "dynamics" : "offset";
  elements.repGraphTitle.textContent = `${record.exerciseTitle} · ${formatExerciseScore(record.score)} · ${
    state.activeRepGraphType === "dynamics" ? "dynamics" : "rush / drag"
  }`;
  elements.repGraphOverlay.hidden = false;
  window.requestAnimationFrame(() => {
    elements.repGraphOverlay.classList.add("is-open");
    drawActiveRepGraph();
  });
}

function closeRepGraphOverlay() {
  state.activeRepGraphRecord = null;
  state.activeRepGraphType = "offset";
  elements.repGraphOverlay.classList.remove("is-open");
  elements.repGraphOverlay.hidden = true;
}

function drawActiveRepGraph() {
  if (!state.activeRepGraphRecord) {
    return;
  }

  if (state.activeRepGraphType === "dynamics") {
    drawStoredDynamicsGraph(state.activeRepGraphRecord);
    return;
  }

  drawStoredRepGraph(state.activeRepGraphRecord);
}

function drawStoredRepGraph(record) {
  const canvas = elements.repGraphCanvas;
  if (!canvas || !record) {
    return;
  }

  const container = canvas.parentElement;
  const width = Math.max(320, getElementContentWidth(container, 900));
  const height = 420;
  const context = resizeCanvasToCssPixels(canvas, width, height);
  const padding = { left: 56, right: 22, top: 22, bottom: 42 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const centerY = padding.top + plotHeight / 2;
  const maxOffsetMs = 80;
  const offsets = record.offsets ?? [];
  const domainBeats = getRecordGraphDomainBeats(record);

  context.clearRect(0, 0, width, height);
  context.fillStyle = "rgba(255,255,255,0.03)";
  context.fillRect(padding.left, padding.top, plotWidth, plotHeight);

  for (const band of [-60, -30, 0, 30, 60]) {
    const y = centerY - (band / maxOffsetMs) * (plotHeight / 2);
    context.strokeStyle = band === 0 ? "rgba(255,255,255,0.26)" : "rgba(255,255,255,0.09)";
    context.lineWidth = band === 0 ? 1.6 : 1;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillStyle = "rgba(243, 247, 251, 0.62)";
    context.font = "12px Avenir Next, sans-serif";
    context.textAlign = "right";
    context.fillText(`${band}`, padding.left - 8, y + 4);
  }

  if (offsets.length > 1) {
    const points = offsets.map((point) => ({
      x: padding.left + (clamp(Number(point.beatPosition) || 0, 0, domainBeats) / domainBeats) * plotWidth,
      y:
        centerY -
        (clamp(-point.offsetMs, -maxOffsetMs, maxOffsetMs) / maxOffsetMs) * (plotHeight / 2),
      offsetMs: point.offsetMs,
    }));

    context.strokeStyle = "rgba(115, 224, 169, 0.78)";
    context.lineWidth = 2.5;
    context.beginPath();
    points.forEach((point, index) => {
      if (index === 0) {
        context.moveTo(point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
      }
    });
    context.stroke();

    points.forEach((point) => {
      context.fillStyle = point.offsetMs < -8 ? "#ffb86b" : point.offsetMs > 8 ? "#8ac7ff" : "#73e0a9";
      context.beginPath();
      context.arc(point.x, point.y, 3.4, 0, Math.PI * 2);
      context.fill();
    });
  }

  context.fillStyle = "rgba(243, 247, 251, 0.72)";
  context.textAlign = "left";
  context.font = "13px Avenir Next, sans-serif";
  context.fillText("Positive = rushing, negative = dragging", padding.left, height - 14);
}

function drawStoredDynamicsGraph(record) {
  const canvas = elements.repGraphCanvas;
  if (!canvas || !record) {
    return;
  }

  const container = canvas.parentElement;
  const width = Math.max(320, getElementContentWidth(container, 900));
  const height = 420;
  const context = resizeCanvasToCssPixels(canvas, width, height);
  const padding = { left: 58, right: 24, top: 28, bottom: 46 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const baselineY = padding.top + plotHeight;
  const dynamics = Array.isArray(record.dynamics) ? record.dynamics : [];
  const targets = Array.isArray(record.targetResults) ? record.targetResults : [];
  const domainBeats = getRecordGraphDomainBeats(record);
  const strengths = dynamics.map((point) => Number(point.strength) || 0).filter((value) => value > 0);
  const maxStrength = Math.max(
    0.08,
    strengths.length ? Math.max(...strengths) * 1.06 : 0,
    (percentile(strengths, 0.92) ?? 0) * 1.18
  );
  const beatToX = (beatPosition) =>
    padding.left + (clamp(Number(beatPosition) || 0, 0, domainBeats) / domainBeats) * plotWidth;
  const strengthToY = (strength) =>
    baselineY - clamp((Number(strength) || 0) / maxStrength, 0, 1) * plotHeight;

  context.clearRect(0, 0, width, height);
  const panelGradient = context.createLinearGradient(0, padding.top, 0, baselineY);
  panelGradient.addColorStop(0, "rgba(255, 184, 107, 0.10)");
  panelGradient.addColorStop(1, "rgba(115, 224, 169, 0.025)");
  context.fillStyle = panelGradient;
  context.fillRect(padding.left, padding.top, plotWidth, plotHeight);

  for (const percent of [0, 0.5, 1]) {
    const y = baselineY - percent * plotHeight;
    context.strokeStyle = percent === 0 ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.08)";
    context.lineWidth = percent === 0 ? 1.5 : 1;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillStyle = "rgba(243, 247, 251, 0.62)";
    context.font = "12px Avenir Next, sans-serif";
    context.textAlign = "right";
    context.fillText(`${Math.round(percent * 100)}%`, padding.left - 8, y + 4);
  }

  for (let beat = 0; beat <= domainBeats + 0.0001; beat += 1) {
    const x = beatToX(beat);
    context.strokeStyle = beat % 4 === 0 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)";
    context.lineWidth = beat % 4 === 0 ? 1.2 : 1;
    context.beginPath();
    context.moveTo(x, padding.top);
    context.lineTo(x, baselineY);
    context.stroke();
  }

  for (const target of targets) {
    const x = beatToX(target.beatPosition);
    const accentLevel = clamp(Number(target.accentLevel) || 0, 0, 2);
    const guideRatio = [0.32, 0.58, 0.9][accentLevel];
    context.strokeStyle = ["rgba(255, 209, 138, 0.10)", "rgba(255, 209, 138, 0.16)", "rgba(255, 184, 107, 0.24)"][accentLevel];
    context.lineWidth = [1, 1.6, 2.2][accentLevel];
    context.beginPath();
    context.moveTo(x, baselineY);
    context.lineTo(x, baselineY - guideRatio * plotHeight);
    context.stroke();
  }

  if (dynamics.length > 0) {
    const points = dynamics.map((point) => ({
      x: beatToX(point.beatPosition),
      y: strengthToY(point.strength),
      strength: Number(point.strength) || 0,
    }));
    const areaGradient = context.createLinearGradient(0, padding.top, 0, baselineY);
    areaGradient.addColorStop(0, "rgba(255, 184, 107, 0.18)");
    areaGradient.addColorStop(1, "rgba(115, 224, 169, 0.025)");
    if (points.length > 1) {
      context.beginPath();
      points.forEach((point, index) => {
        if (index === 0) {
          context.moveTo(point.x, baselineY);
          context.lineTo(point.x, point.y);
        } else {
          context.lineTo(point.x, point.y);
        }
      });
      context.lineTo(points[points.length - 1].x, baselineY);
      context.closePath();
      context.fillStyle = areaGradient;
      context.fill();

      context.strokeStyle = "rgba(115, 224, 169, 0.9)";
      context.lineWidth = 2.7;
      context.shadowColor = "rgba(115, 224, 169, 0.22)";
      context.shadowBlur = 10;
      context.lineJoin = "round";
      context.beginPath();
      points.forEach((point, index) => {
        if (index === 0) {
          context.moveTo(point.x, point.y);
        } else {
          context.lineTo(point.x, point.y);
        }
      });
      context.stroke();
      context.shadowBlur = 0;
    }

    points.forEach((point) => {
      drawTimelineMarker(context, point.x, point.y, 3.8, "rgba(115, 224, 169, 0.95)");
    });
  } else {
    context.fillStyle = "rgba(243, 247, 251, 0.62)";
    context.textAlign = "center";
    context.font = "13px Avenir Next, sans-serif";
    context.fillText("No saved dynamics data for this rep.", width / 2, height / 2);
  }

  context.fillStyle = "rgba(243, 247, 251, 0.72)";
  context.textAlign = "left";
  context.font = "13px Avenir Next, sans-serif";
  context.fillText("Relative hit strength across the rep", padding.left, height - 16);
}

function getCurrentExerciseHeatmap() {
  if (!state.exercise.loaded) {
    return null;
  }

  return aggregateExerciseHeatmap(state.exercise.loaded, state.exercise.repHistory);
}

function summarizeHeatmapTarget(target) {
  const offsetText =
    target.meanOffsetMs === null ? "--" : formatPlainMilliseconds(target.meanOffsetMs);
  const medianText =
    target.medianOffsetMs === null ? "--" : formatPlainMilliseconds(target.medianOffsetMs);
  const absText =
    target.meanAbsoluteOffsetMs === null ? "--" : `${target.meanAbsoluteOffsetMs.toFixed(1)} ms`;
  const jitterText = target.jitterMs === null ? "--" : `${target.jitterMs.toFixed(1)} ms`;
  const measureText = target.measureNumber ? `Measure ${target.measureNumber}` : "Measure --";
  const tendencyText =
    target.tendency === "rush" ? "Rushing" : target.tendency === "drag" ? "Dragging" : "Centered";

  return `
    <strong>${measureText} · target ${target.targetIndex}</strong>
    <span>${tendencyText} · avg ${offsetText} · median ${medianText}</span>
    <span>Matched ${target.matchedCount}/${target.totalCount || 0} reps · missed ${target.missedCount} · mean abs ${absText} · jitter ${jitterText}</span>
  `;
}

function setHeatmapDetails(target = null) {
  if (!elements.exerciseHeatmapDetails) {
    return;
  }

  if (!target) {
    elements.exerciseHeatmapDetails.innerHTML =
      "Select a point on the timing trace to inspect average rush/drag for that written note.";
    return;
  }

  elements.exerciseHeatmapDetails.innerHTML = summarizeHeatmapTarget(target);
}

function getHeatmapTargetExpectedHit(target) {
  const targetIndex = Number(target?.targetIndex);
  return state.exercise.loaded?.expectedHits?.find(
    (hit) => Number(hit.index) === targetIndex
  ) ?? null;
}

function getHeatmapTargetSheetPosition(target, usageCounts) {
  const positions = state.exercise.sheetCursorPositions.filter(Boolean);
  if (!positions.length) {
    return null;
  }

  const expectedHit = getHeatmapTargetExpectedHit(target);
  const directPosition = positions.find(
    (position) => Number(position.hitIndex) === Number(target.targetIndex)
  );
  const expectedTimeSeconds = Number(expectedHit?.timeSeconds);
  const timeMatchedPosition = Number.isFinite(expectedTimeSeconds)
    ? positions.reduce((best, position) => {
        const distance = Math.abs(Number(position.timeSeconds) - expectedTimeSeconds);
        return !best || distance < best.distance ? { position, distance } : best;
      }, null)?.position
    : null;
  const position = directPosition ?? timeMatchedPosition;
  if (!position) {
    return null;
  }

  const bucketKey = `${Math.round(position.left)}:${Math.round(position.top)}:${Math.round(
    position.height
  )}`;
  const usageCount = usageCounts.get(bucketKey) ?? 0;
  usageCounts.set(bucketKey, usageCount + 1);

  const splitIndex = Number(expectedHit?.splitIndex);
  const splitCount = Number(expectedHit?.splitCount);
  const duplicateOffset = Number.isFinite(splitIndex) && Number.isFinite(splitCount) && splitCount > 1
    ? (splitIndex - (splitCount - 1) / 2) * 16
    : usageCount * 14;

  return {
    left: position.left + duplicateOffset,
    top: position.top + position.height * 0.52,
  };
}

function getHeatmapStaffLineCandidates() {
  const sourceContainer = elements.sheetMusicContainer;
  const sourceSvg = getRenderedExerciseSheetSvg();
  if (!sourceSvg) {
    return [];
  }

  const containerRect = sourceContainer.getBoundingClientRect();
  return [...sourceSvg.querySelectorAll("path, line, polyline")]
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const y = rect.top - containerRect.top + sourceContainer.scrollTop + rect.height / 2;
      return {
        y,
        width: rect.width,
        height: rect.height,
      };
    })
    .filter((line) => line.width >= 90 && line.height <= 1.5 && Number.isFinite(line.y))
    .map((line) => line.y)
    .sort((left, right) => left - right);
}

function getNearestStaffLineY(position, staffLineYs) {
  if (!staffLineYs.length) {
    return position.top;
  }

  return staffLineYs.reduce((nearest, candidateY) =>
    Math.abs(candidateY - position.top) < Math.abs(nearest - position.top) ? candidateY : nearest
  );
}

function getHeatmapTraceColor(target) {
  if (target.tendency === "rush") {
    return "#ffb86b";
  }

  if (target.tendency === "drag") {
    return "#6fb6ff";
  }

  return "#55d695";
}

function getHeatmapMarkerLabel(target) {
  const offsetText =
    target.meanOffsetMs === null ? "no timing history" : formatPlainMilliseconds(target.meanOffsetMs);
  const measureText = target.measureNumber ? `measure ${target.measureNumber}` : "unknown measure";
  return `Target ${target.targetIndex}, ${measureText}, ${offsetText}`;
}

function clearHeatmapSheetLayers() {
  elements.exerciseHeatmapGraphLayer.replaceChildren();
  elements.exerciseHeatmapMarkerLayer.replaceChildren();
}

function renderHeatmapSheetClone() {
  const sourceSvg = getRenderedExerciseSheetSvg();
  if (!sourceSvg) {
    elements.exerciseHeatmapSheetClone.innerHTML =
      '<div class="heatmap-empty-sheet">Load an exercise before opening historical performance.</div>';
    clearHeatmapSheetLayers();
    return null;
  }

  const sourceContainer = elements.sheetMusicContainer;
  const sourceRect = sourceSvg.getBoundingClientRect();
  const sourceWidth = Math.max(sourceSvg.scrollWidth, sourceRect.width, 720);
  const sourceHeight = Math.max(sourceSvg.scrollHeight, sourceRect.height, 320);
  const stageWidth = Math.max(sourceContainer.scrollWidth, sourceWidth + 28);
  const stageHeight = Math.max(sourceContainer.scrollHeight, sourceHeight + 28);
  const renderKey = `${state.exercise.loaded?.id ?? "exercise"}:${Math.round(stageWidth)}:${Math.round(
    stageHeight
  )}:${Math.round(sourceWidth)}`;

  elements.exerciseHeatmapSheetStage.style.width = `${stageWidth}px`;
  elements.exerciseHeatmapSheetStage.style.minHeight = `${stageHeight}px`;
  elements.exerciseHeatmapGraphLayer.setAttribute("viewBox", `0 0 ${stageWidth} ${stageHeight}`);
  elements.exerciseHeatmapGraphLayer.setAttribute("width", String(stageWidth));
  elements.exerciseHeatmapGraphLayer.setAttribute("height", String(stageHeight));
  elements.exerciseHeatmapMarkerLayer.style.width = `${stageWidth}px`;
  elements.exerciseHeatmapMarkerLayer.style.height = `${stageHeight}px`;

  if (state.activeHeatmap?.sheetRenderKey !== renderKey) {
    const clone = sourceSvg.cloneNode(true);
    clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
    clone.querySelectorAll(".sheet-progress-cursor, .sheet-ready-prompt").forEach((element) => {
      element.remove();
    });
    clone.style.width = `${sourceWidth}px`;
    clone.style.maxWidth = "none";
    clone.style.height = "auto";
    elements.exerciseHeatmapSheetClone.replaceChildren(clone);
    if (state.activeHeatmap) {
      state.activeHeatmap.sheetRenderKey = renderKey;
    }
  }

  return { stageWidth, stageHeight };
}

function createSvgElement(tagName, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tagName);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
  return element;
}

function getHeatmapTracePoint(target, position, staffLineYs) {
  const maxOffsetMs = 70;
  const maxVerticalOffset = 30;
  const meanOffsetMs = Number(target.meanOffsetMs);
  const offsetMs = Number.isFinite(meanOffsetMs) ? clamp(meanOffsetMs, -maxOffsetMs, maxOffsetMs) : 0;
  const baselineY = getNearestStaffLineY(position, staffLineYs);
  return {
    x: position.left,
    y: baselineY - (offsetMs / maxOffsetMs) * maxVerticalOffset,
    baselineY,
    target,
  };
}

function groupHeatmapTraceRows(points) {
  const rows = [];
  for (const point of points) {
    const row = rows.find((candidate) => Math.abs(candidate.centerY - point.baselineY) <= 62);
    if (row) {
      row.points.push(point);
      row.centerY =
        row.points.reduce((sum, item) => sum + item.baselineY, 0) / row.points.length;
      continue;
    }

    rows.push({ centerY: point.baselineY, points: [point] });
  }

  return rows
    .map((row) => ({
      ...row,
      points: row.points.sort((left, right) => left.x - right.x),
    }))
    .sort((left, right) => left.centerY - right.centerY);
}

function renderHeatmapTrace(svg, points) {
  svg.replaceChildren();

  const rows = groupHeatmapTraceRows(points);
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    for (let index = 1; index < row.points.length; index += 1) {
      const previous = row.points[index - 1];
      const current = row.points[index];
      const distance = Math.abs(current.x - previous.x);
      if (distance > 110) {
        continue;
      }

      const controlOffset = Math.min(24, distance * 0.34);
      const segmentColor = getHeatmapTraceColor(current.target);
      const path = createSvgElement("path", {
        d: `M ${previous.x.toFixed(2)} ${previous.y.toFixed(2)} C ${(previous.x + controlOffset).toFixed(2)} ${previous.y.toFixed(2)}, ${(current.x - controlOffset).toFixed(2)} ${current.y.toFixed(2)}, ${current.x.toFixed(2)} ${current.y.toFixed(2)}`,
        class: "heatmap-trace-segment",
        stroke: segmentColor,
      });
      fragment.append(path);
    }
  }

  svg.append(fragment);
}

function getInlineTendencyGraphLayer() {
  let graphLayer = elements.sheetMusicContainer.querySelector(".sheet-tendency-graph-layer");
  if (!graphLayer) {
    graphLayer = createSvgElement("svg", {
      class: "sheet-tendency-graph-layer",
      "aria-hidden": "true",
    });
    elements.sheetMusicContainer.prepend(graphLayer);
  }

  return graphLayer;
}

function getInlineDynamicsGraphLayer() {
  let graphLayer = elements.sheetMusicContainer.querySelector(".sheet-dynamics-graph-layer");
  if (!graphLayer) {
    graphLayer = createSvgElement("svg", {
      class: "sheet-dynamics-graph-layer",
      "aria-hidden": "true",
    });
    elements.sheetMusicContainer.prepend(graphLayer);
  }

  return graphLayer;
}

function clearInlineExerciseTendencies() {
  elements.sheetMusicContainer.querySelector(".sheet-tendency-graph-layer")?.remove();
}

function clearInlineExerciseDynamics() {
  elements.sheetMusicContainer.querySelector(".sheet-dynamics-graph-layer")?.remove();
}

function buildHeatmapTracePoints(heatmap) {
  if (!state.exercise.sheetCursorPositions.length) {
    cacheExerciseSheetCursorPositions();
  }

  const usageCounts = new Map();
  const staffLineYs = getHeatmapStaffLineCandidates();
  const tracePoints = [];
  for (const target of heatmap.targets) {
    if (target.totalCount === 0) {
      continue;
    }

    const position = getHeatmapTargetSheetPosition(target, usageCounts);
    if (!position) {
      continue;
    }

    tracePoints.push(getHeatmapTracePoint(target, position, staffLineYs));
  }

  return tracePoints;
}

function drawInlineExerciseTendencies() {
  if (!state.exercise.tendenciesVisible || !state.exercise.loaded || elements.exerciseModeSection.hidden) {
    clearInlineExerciseTendencies();
    return;
  }

  const sourceSvg = getRenderedExerciseSheetSvg();
  const heatmap = getCurrentExerciseHeatmap();
  if (!sourceSvg || !heatmap || (heatmap.totalRepCount ?? heatmap.repCount) === 0) {
    clearInlineExerciseTendencies();
    return;
  }

  const graphLayer = getInlineTendencyGraphLayer();
  const width = Math.max(elements.sheetMusicContainer.scrollWidth, sourceSvg.scrollWidth, 720);
  const height = Math.max(elements.sheetMusicContainer.scrollHeight, sourceSvg.scrollHeight, 320);
  graphLayer.setAttribute("viewBox", `0 0 ${width} ${height}`);
  graphLayer.setAttribute("width", String(width));
  graphLayer.setAttribute("height", String(height));
  graphLayer.style.width = `${width}px`;
  graphLayer.style.height = `${height}px`;
  renderHeatmapTrace(graphLayer, buildHeatmapTracePoints(heatmap));
}

function buildInlineDynamicsTracePoints() {
  const exercise = state.exercise.loaded;
  if (!exercise) {
    return [];
  }

  if (!state.exercise.sheetCursorPositions.length) {
    cacheExerciseSheetCursorPositions();
  }

  const dynamicsTargets = getHistoricalDynamicsTargets(exercise);
  if (!dynamicsTargets.length) {
    return [];
  }

  const scaleMax = Math.max(
    0.08,
    ...dynamicsTargets.map((target) => target.meanStrength)
  );
  const staffLineYs = getHeatmapStaffLineCandidates();
  const usageCounts = new Map();
  return dynamicsTargets
    .map((target) => {
      const position = getHeatmapTargetSheetPosition(target, usageCounts);
      if (!position) {
        return null;
      }

      const baselineY = getNearestStaffLineY(position, staffLineYs);
      const y = baselineY - clamp(target.meanStrength / scaleMax, 0, 1) * 34;
      return {
        x: position.left,
        y,
        baselineY,
        strength: target.meanStrength,
        target,
      };
    })
    .filter(Boolean);
}

function getHistoricalDynamicsTargets(exercise) {
  const expectedHits = Array.isArray(exercise?.expectedHits) ? exercise.expectedHits : [];
  if (!expectedHits.length) {
    return [];
  }

  const records = state.exercise.repHistory.filter(
    (record) =>
      record.exerciseId === exercise.id &&
      Array.isArray(record.dynamics) &&
      record.dynamics.length > 0
  );
  if (!records.length) {
    return [];
  }

  const strengthsByTarget = new Map(
    expectedHits.map((hit, index) => [Number(hit.index ?? index + 1), []])
  );
  const sortedExpectedHits = [...expectedHits].sort(
    (left, right) => Number(left.beatPosition) - Number(right.beatPosition)
  );
  const targetWindows = new Map();
  sortedExpectedHits.forEach((hit, index) => {
    const beatPosition = Number(hit.beatPosition) || 0;
    const previousBeat = Number(sortedExpectedHits[index - 1]?.beatPosition);
    const nextBeat = Number(sortedExpectedHits[index + 1]?.beatPosition);
    const neighborDistances = [previousBeat, nextBeat]
      .filter((value) => Number.isFinite(value))
      .map((value) => Math.abs(beatPosition - value))
      .filter((value) => value > 0.0001);
    const nearestDistance = neighborDistances.length ? Math.min(...neighborDistances) : 0.5;
    targetWindows.set(Number(hit.index ?? index + 1), clamp(nearestDistance * 0.45, 0.08, 0.24));
  });

  for (const record of records) {
    const dynamics = record.dynamics
      .map((point) => ({
        beatPosition: Number(point.beatPosition),
        strength: Number(point.strength),
      }))
      .filter(
        (point) =>
          Number.isFinite(point.beatPosition) &&
          Number.isFinite(point.strength) &&
          point.strength > 0
      );
    if (!dynamics.length) {
      continue;
    }

    for (const expected of expectedHits) {
      const targetIndex = Number(expected.index);
      const targetBeat = Number(expected.beatPosition);
      if (!Number.isFinite(targetIndex) || !Number.isFinite(targetBeat)) {
        continue;
      }

      const windowBeats = targetWindows.get(targetIndex) ?? 0.18;
      let bestPoint = null;
      for (const point of dynamics) {
        const distance = Math.abs(point.beatPosition - targetBeat);
        if (distance > windowBeats) {
          continue;
        }
        if (!bestPoint || distance < bestPoint.distance) {
          bestPoint = { point, distance };
        }
      }

      if (bestPoint) {
        strengthsByTarget.get(targetIndex)?.push(bestPoint.point.strength);
      }
    }
  }

  return expectedHits
    .map((expected, index) => {
      const targetIndex = Number(expected.index ?? index + 1);
      const strengths = strengthsByTarget.get(targetIndex) ?? [];
      if (!strengths.length) {
        return null;
      }

      return {
        targetIndex,
        beatPosition: Number(expected.beatPosition) || 0,
        meanStrength: averageNumbers(strengths),
        count: strengths.length,
      };
    })
    .filter(Boolean);
}

function renderDynamicsTrace(svg, points) {
  svg.replaceChildren();

  const rows = groupHeatmapTraceRows(points);
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    for (let index = 1; index < row.points.length; index += 1) {
      const previous = row.points[index - 1];
      const current = row.points[index];
      const distance = Math.abs(current.x - previous.x);
      if (distance > 120) {
        continue;
      }

      const controlOffset = Math.min(24, distance * 0.34);
      const path = createSvgElement("path", {
        d: `M ${previous.x.toFixed(2)} ${previous.y.toFixed(2)} C ${(previous.x + controlOffset).toFixed(2)} ${previous.y.toFixed(2)}, ${(current.x - controlOffset).toFixed(2)} ${current.y.toFixed(2)}, ${current.x.toFixed(2)} ${current.y.toFixed(2)}`,
        class: "dynamics-trace-segment",
      });
      fragment.append(path);
    }

    for (const point of row.points) {
      fragment.append(createSvgElement("circle", {
        class: "dynamics-trace-point",
        cx: point.x.toFixed(2),
        cy: point.y.toFixed(2),
        r: 3.2,
      }));
    }
  }

  svg.append(fragment);
}

function drawInlineExerciseDynamics() {
  if (!state.exercise.dynamicsVisible || !state.exercise.loaded || elements.exerciseModeSection.hidden) {
    clearInlineExerciseDynamics();
    return;
  }

  const sourceSvg = getRenderedExerciseSheetSvg();
  if (!sourceSvg) {
    clearInlineExerciseDynamics();
    return;
  }

  const tracePoints = buildInlineDynamicsTracePoints();
  if (!tracePoints.length) {
    clearInlineExerciseDynamics();
    return;
  }

  const graphLayer = getInlineDynamicsGraphLayer();
  const width = Math.max(elements.sheetMusicContainer.scrollWidth, sourceSvg.scrollWidth, 720);
  const height = Math.max(elements.sheetMusicContainer.scrollHeight, sourceSvg.scrollHeight, 320);
  graphLayer.setAttribute("viewBox", `0 0 ${width} ${height}`);
  graphLayer.setAttribute("width", String(width));
  graphLayer.setAttribute("height", String(height));
  graphLayer.style.width = `${width}px`;
  graphLayer.style.height = `${height}px`;
  renderDynamicsTrace(graphLayer, tracePoints);
}

function drawExerciseHeatmap() {
  const heatmap = state.activeHeatmap;
  if (!heatmap || elements.exerciseHeatmapOverlay.hidden) {
    return;
  }

  const stage = renderHeatmapSheetClone();
  if (!stage) {
    return;
  }

  const tracePoints = buildHeatmapTracePoints(heatmap);
  const hitTargets = [];
  for (const point of tracePoints) {
    const target = point.target;
    const hitTarget = document.createElement("button");
    hitTarget.type = "button";
    hitTarget.className = "heatmap-trace-hit-target";
    hitTarget.dataset.targetIndex = String(target.targetIndex);
    hitTarget.setAttribute("aria-label", getHeatmapMarkerLabel(target));
    hitTarget.style.left = `${point.x}px`;
    hitTarget.style.top = `${point.y}px`;
    hitTargets.push(hitTarget);
  }

  renderHeatmapTrace(elements.exerciseHeatmapGraphLayer, tracePoints);
  elements.exerciseHeatmapMarkerLayer.replaceChildren(...hitTargets);
  state.activeHeatmap.markerPositions = tracePoints.map((point) => ({
    x: point.x,
    y: point.y,
    radius: 16,
    target: point.target,
  }));
}

function activateOffscreenExerciseRender() {
  if (state.appMode === "exercise" || state.exercise.offscreenRenderActive) {
    return;
  }

  state.exercise.offscreenRenderActive = true;
  state.exercise.offscreenRenderPreviousHidden = elements.exerciseModeSection.hidden;
  state.exercise.offscreenRenderPreviousStyle = elements.exerciseModeSection.getAttribute("style") ?? "";
  elements.exerciseModeSection.hidden = false;
  elements.exerciseModeSection.style.cssText = [
    "display: grid",
    "position: fixed",
    "left: -12000px",
    "top: 0",
    "width: 1180px",
    "max-width: 1180px",
    "visibility: hidden",
    "pointer-events: none",
  ].join(";");
}

function restoreOffscreenExerciseRender() {
  if (!state.exercise.offscreenRenderActive) {
    return;
  }

  state.exercise.offscreenRenderActive = false;
  elements.exerciseModeSection.hidden = state.exercise.offscreenRenderPreviousHidden;
  elements.exerciseModeSection.setAttribute("style", state.exercise.offscreenRenderPreviousStyle);
  state.exercise.offscreenRenderPreviousStyle = "";
}

async function ensureExerciseTendenciesSourceRendered(exerciseId) {
  const shouldLoadExercise =
    state.exercise.selectedExerciseId !== exerciseId || state.exercise.loaded?.id !== exerciseId;

  if (state.appMode !== "exercise") {
    activateOffscreenExerciseRender();
  }

  if (shouldLoadExercise) {
    elements.exerciseSelect.value = exerciseId;
    state.exercise.selectionRequestId = exerciseId;
    await loadBuiltInExercise(exerciseId);
    state.exercise.selectedExerciseId = exerciseId;
    return;
  }

  if (!state.exercise.osmd && state.exercise.sourceXmlText) {
    await renderExerciseSheet(state.exercise.sourceXmlText);
  }
}

function openExerciseHeatmapOverlay() {
  const heatmap = getCurrentExerciseHeatmap();
  if (!heatmap || !state.exercise.loaded) {
    return;
  }

  state.activeHeatmap = heatmap;
  elements.exerciseHeatmapTitle.textContent = `${heatmap.exerciseTitle} · historical performance`;
  const excludedText = heatmap.excludedRepCount
    ? ` · ${heatmap.excludedRepCount} outlier rep${heatmap.excludedRepCount === 1 ? "" : "s"} excluded`
    : "";
  elements.exerciseHeatmapSummary.textContent =
    (heatmap.totalRepCount ?? heatmap.repCount) === 0
      ? "Complete a few reps to build a timing heatmap for this exercise."
      : `${heatmap.repCount} of ${heatmap.totalRepCount ?? heatmap.repCount} saved reps used${excludedText} · ${heatmap.matchedTargetCount}/${heatmap.targets.length} written targets have timing history · overall ${formatPlainMilliseconds(heatmap.overallMeanOffsetMs, "--")}`;
  setHeatmapDetails();
  elements.exerciseHeatmapOverlay.hidden = false;
  window.requestAnimationFrame(() => {
    elements.exerciseHeatmapOverlay.classList.add("is-open");
    drawExerciseHeatmap();
  });
}

async function openExerciseHeatmapOverlayForExercise(exerciseId) {
  try {
    await ensureExerciseTendenciesSourceRendered(exerciseId);
    openExerciseHeatmapOverlay();
  } catch (error) {
    restoreOffscreenExerciseRender();
    setMessage(`Could not open tendencies: ${error.message}`);
  }
}

function closeExerciseHeatmapOverlay() {
  state.activeHeatmap = null;
  elements.exerciseHeatmapOverlay.classList.remove("is-open");
  elements.exerciseHeatmapOverlay.hidden = true;
  clearHeatmapSheetLayers();
  restoreOffscreenExerciseRender();
}

function getHeatmapMarkerAtEvent(event) {
  const heatmap = state.activeHeatmap;
  const markerElement = event.target.closest?.(".heatmap-trace-hit-target");
  if (markerElement) {
    const targetIndex = Number(markerElement.dataset.targetIndex);
    const target = heatmap?.targets?.find((candidate) => candidate.targetIndex === targetIndex);
    return target ? { target } : null;
  }

  if (!heatmap?.markerPositions) {
    return null;
  }

  const rect = elements.exerciseHeatmapMarkerLayer.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  return (
    heatmap.markerPositions.find((marker) => {
      const distance = Math.hypot(marker.x - x, marker.y - y);
      return distance <= marker.radius;
    }) ?? null
  );
}

function setExerciseRepStatus(text) {
  if (elements.exerciseRepStatus) {
    elements.exerciseRepStatus.textContent = text;
  }
}

function resetExerciseResultsUi() {
  state.exercise.latestAnalysis = null;
  state.exercise.latestScoreRecord = null;
  state.exercise.pendingScoreRecord = null;
  state.exercise.pendingScoreAnalysis = null;
  closeExerciseResultOverlay({ save: false });
}

function updateExerciseAnalysisUi(analysis = state.exercise.latestAnalysis) {
  if (!analysis) {
    return;
  }
}

function updateExerciseResultOverlay(analysis) {
  if (!analysis || !state.exercise.loaded) {
    return;
  }

  elements.exerciseResultTitle.textContent = state.exercise.loaded.title;
  elements.exerciseResultScore.textContent = formatExerciseScore(analysis.score);
  elements.exerciseResultMatched.textContent = `${analysis.stats.matchedCount}/${analysis.stats.expectedCount}`;
  elements.exerciseResultMeanOffset.textContent = formatRushDragMilliseconds(analysis.stats.meanOffsetMs);
  elements.exerciseResultMeanAbs.textContent =
    analysis.stats.meanAbsoluteOffsetMs === null
      ? "--"
      : `${analysis.stats.meanAbsoluteOffsetMs.toFixed(1)} ms`;
  elements.exerciseResultJitter.textContent =
    analysis.stats.jitterMs === null ? "--" : `${analysis.stats.jitterMs.toFixed(1)} ms`;
  elements.exerciseResultFeedbackList.innerHTML = "";
  const insights = analysis.insights?.length
    ? analysis.insights
    : ["Play a rep to generate category-level timing feedback."];
  insights.forEach((insight) => {
    const item = document.createElement("li");
    item.textContent = insight;
    elements.exerciseResultFeedbackList.append(item);
  });
}

function openExerciseResultOverlay(analysis) {
  if (!analysis || !state.exercise.loaded) {
    return;
  }

  updateExerciseResultOverlay(analysis);
  state.exercise.resultOverlayOpen = true;
  elements.exerciseResultOverlay.hidden = false;
  updateExerciseCaptureUi();
  window.requestAnimationFrame(() => {
    elements.exerciseResultOverlay.classList.add("is-open");
  });
}

function closeExerciseResultOverlay({ save = true } = {}) {
  if (!state.exercise.resultOverlayOpen && elements.exerciseResultOverlay.hidden) {
    return;
  }

  state.exercise.resultOverlayOpen = false;
  elements.exerciseResultOverlay.classList.remove("is-open");
  elements.exerciseResultOverlay.hidden = true;

  if (save && state.exercise.pendingScoreRecord) {
    saveExerciseHighScore(state.exercise.pendingScoreRecord);
    if (state.exercise.pendingScoreAnalysis) {
      saveCompletedRep(state.exercise.pendingScoreAnalysis, state.exercise.pendingScoreRecord);
    }
    state.exercise.latestScoreRecord = state.exercise.pendingScoreRecord;
    state.exercise.pendingScoreRecord = null;
    state.exercise.pendingScoreAnalysis = null;
  }
  state.exercise.resultSessionId = null;
  updateExerciseCaptureUi();
}

function captureCurrentMetronomeSettings() {
  return {
    enabled: elements.metronomeEnabledInput.checked,
    wasRunning: state.metronomeRunning,
    tempo: getMetronomeTempo(),
    subdivision: elements.metronomeSubdivisionSelect.value,
    numerator: getTimeSignature().numerator,
    denominator: getTimeSignature().denominator,
    accentLevels: [...state.metronomeAccentLevels],
  };
}

async function applyMetronomeSettings(settings, { resync = true } = {}) {
  elements.metronomeEnabledInput.checked = settings.enabled;
  syncTempoInputs(settings.tempo);
  elements.metronomeSubdivisionSelect.value = settings.subdivision;
  elements.metronomeNumeratorInput.value = String(settings.numerator);
  elements.metronomeDenominatorSelect.value = String(settings.denominator);
  state.metronomeAccentLevels = [...settings.accentLevels];
  renderAccentButtons();
  updateMetronomeStatus();

  if (!state.running || !resync) {
    return;
  }

  if (state.usingSimulation && state.simulator) {
    state.simulator.baseBpm = settings.tempo;
  }

  if (settings.enabled && settings.wasRunning !== false) {
    if (state.metronomeRunning) {
      await resyncMetronomeSchedule();
    } else {
      await startMetronome();
    }
  } else {
    await stopMetronome({ closeContext: true });
  }
}

function getCalibrationSequenceStart(currentElapsed) {
  const currentBeat = getBeatPositionAtTime(currentElapsed);
  const leadBeats = (METRONOME_START_OFFSET_SECONDS * CALIBRATION_TEMPO) / 60;
  const startBeatPosition = Math.ceil(currentBeat + leadBeats - 0.0001);
  const beatDelta = Math.max(leadBeats, startBeatPosition - currentBeat);
  const startTimeSeconds = currentElapsed + (beatDelta * 60) / CALIBRATION_TEMPO;

  return {
    startBeatPosition,
    startTimeSeconds,
  };
}

function getCalibrationEighthLabel(stepIndex) {
  return stepIndex % 2 === 0 ? String(Math.floor(stepIndex / 2) % 4 + 1) : "&";
}

function buildCalibrationClickSequence(startBeatPosition, startTimeSeconds) {
  const sequence = [];
  const eighthNoteSeconds = 60 / CALIBRATION_TEMPO / 2;
  const beatSeconds = 60 / CALIBRATION_TEMPO;
  const phases = [];
  const targetTimes = [];
  let currentTimeSeconds = startTimeSeconds;
  let currentBeatPosition = startBeatPosition;

  for (const phaseConfig of SINGLE_CALIBRATION_PHASES) {
    const phaseDurationSeconds =
      phaseConfig.metronome === "tap-off"
        ? CALIBRATION_TAP_OFF_PATTERN.length * eighthNoteSeconds
        : phaseConfig.bars
          ? phaseConfig.bars * CALIBRATION_NUMERATOR * beatSeconds
          : phaseConfig.durationSeconds;
    const phase = {
      ...phaseConfig,
      startTimeSeconds: currentTimeSeconds,
      endTimeSeconds: currentTimeSeconds + phaseDurationSeconds,
    };
    phases.push(phase);

    if (phaseConfig.metronome === "tap-off") {
      CALIBRATION_TAP_OFF_PATTERN.forEach((accentLevel, stepIndex) => {
        if (accentLevel === null) {
          return;
        }

        const beatPosition = currentBeatPosition + stepIndex * 0.5;
        sequence.push({
          timeSeconds: currentTimeSeconds + stepIndex * eighthNoteSeconds,
          beatPosition,
          beatNumber: (Math.floor(beatPosition) % CALIBRATION_NUMERATOR) + 1,
          stepInMeasure: stepIndex % (CALIBRATION_NUMERATOR * 2),
          subdivision: CALIBRATION_SUBDIVISION,
          label: getCalibrationEighthLabel(stepIndex),
          accentLevel,
          phaseId: phase.id,
        });
      });
    }

    if (phaseConfig.metronome === "eighths") {
      const captureSteps = Math.max(1, Math.round(phaseDurationSeconds / eighthNoteSeconds));
      for (let stepIndex = 0; stepIndex < captureSteps; stepIndex += 1) {
        const beatPosition = currentBeatPosition + stepIndex * 0.5;
        const timeSeconds = currentTimeSeconds + stepIndex * eighthNoteSeconds;
        const accentLevel = stepIndex % (CALIBRATION_NUMERATOR * 2) === 0
          ? 2
          : stepIndex % 2 === 0
            ? 1
            : 0;
        const click = {
          timeSeconds,
          beatPosition,
          beatNumber: (Math.floor(beatPosition) % CALIBRATION_NUMERATOR) + 1,
          stepInMeasure: stepIndex % (CALIBRATION_NUMERATOR * 2),
          subdivision: CALIBRATION_SUBDIVISION,
          label: getCalibrationEighthLabel(stepIndex),
          accentLevel,
          phaseId: phase.id,
        };
        sequence.push(click);
        targetTimes.push({
          timeSeconds,
          phaseId: phase.id,
          dynamicLevel: phase.dynamicLevel,
          targetHeightInches: phase.targetHeightInches ?? null,
        });
      }
    }

    currentTimeSeconds = phase.endTimeSeconds;
    currentBeatPosition += phaseDurationSeconds / beatSeconds;
  }

  return {
    sequence,
    phases,
    targetTimes,
    captureStartTimeSeconds: phases[0]?.startTimeSeconds ?? startTimeSeconds,
    captureEndTimeSeconds: phases[phases.length - 1]?.endTimeSeconds ?? startTimeSeconds,
  };
}

async function startCalibrationSequence() {
  const context = await ensureMetronomeContext();
  const currentElapsed = getCurrentSessionElapsedSeconds();
  const currentAudioTime = context.currentTime;
  const { startBeatPosition, startTimeSeconds } = getCalibrationSequenceStart(currentElapsed);
  const { sequence, phases, targetTimes, captureStartTimeSeconds, captureEndTimeSeconds } =
    buildCalibrationClickSequence(startBeatPosition, startTimeSeconds);
  const audioOffsetSeconds = Math.max(METRONOME_START_OFFSET_SECONDS, startTimeSeconds - currentElapsed);

  addTempoSegment(currentElapsed, CALIBRATION_TEMPO);
  state.metronomeClicks = state.metronomeClicks.filter(
    (click) => click.timeSeconds <= currentElapsed + 0.002
  );
  resetMetronomeIndicatorFlash();
  state.metronomeRunning = true;
  state.metronomeAudioZeroTime = currentAudioTime;
  state.metronomeElapsedBaseSeconds = currentElapsed;
  state.metronomeTimer = null;

  for (const click of sequence) {
    const audioTime = currentAudioTime + audioOffsetSeconds + (click.timeSeconds - startTimeSeconds);
    scheduleMetronomeClickAudio(context, audioTime, click.accentLevel);
    state.metronomeClicks.push(click);
  }

  updateMetronomeStatus();

  return {
    sequenceStartTimeSeconds: startTimeSeconds,
    collectStartTimeSeconds: captureStartTimeSeconds,
    collectEndTimeSeconds: captureEndTimeSeconds,
    phases,
    targetTimes,
  };
}

function classifyCalibrationQuality(usableHitCount, targetCount, madMs) {
  const coverage = targetCount > 0 ? usableHitCount / targetCount : 0;
  if (usableHitCount < CALIBRATION_MIN_USABLE_HITS || coverage < 0.45) {
    return "retry";
  }

  if (coverage >= 0.75 && madMs <= 18) {
    return "good";
  }

  if (coverage >= 0.6 && madMs <= 32) {
    return "usable";
  }

  return "retry";
}

function getCalibrationBucket(id) {
  return state.calibration.phaseSamples?.[id] ?? {
    rawPeaks: [],
    filteredPeaks: [],
    hits: [],
  };
}

function summarizeCalibrationStrengths(values) {
  const filteredValues = values.filter((value) => Number.isFinite(value) && value > 0);
  return {
    count: filteredValues.length,
    median: median(filteredValues),
    p25: percentile(filteredValues, 0.25),
    p75: percentile(filteredValues, 0.75),
  };
}

function getCalibrationPhaseStrengthCandidates(phaseId, noiseFloor) {
  return getPhasePeakCandidates(getCalibrationBucket(phaseId), noiseFloor)
    .filter((value) => Number.isFinite(value) && value > 0);
}

function evaluateCalibrationDynamicResult() {
  const noise = getCalibrationBucket("noise");
  const noise95 = percentile(noise.filteredPeaks, 0.95) ?? 0;
  const noise99 = percentile(noise.filteredPeaks, 0.99) ?? noise95;
  const height3Peaks = getCalibrationPhaseStrengthCandidates("height-3", noise95);
  const height6Peaks = getCalibrationPhaseStrengthCandidates("height-6", noise95);
  const height9Peaks = getCalibrationPhaseStrengthCandidates("height-9", noise95);
  const height12Peaks = getCalibrationPhaseStrengthCandidates("height-12", noise95);
  const fastSoftPeaks = getCalibrationPhaseStrengthCandidates("fast-soft", noise95);
  const fastLoudPeaks = getCalibrationPhaseStrengthCandidates("fast-loud", noise95);
  const softCandidates = [...height3Peaks, ...fastSoftPeaks];
  const loudCandidates = [...height12Peaks, ...fastLoudPeaks];
  const soft25 = percentile(softCandidates, 0.25);
  const softMedian = median(softCandidates);
  const loudMedian = median(loudCandidates);
  const fastIntervalsMs = [
    ...getAutoDetectionHitIntervalsMs(getCalibrationBucket("fast-soft").hits),
    ...getAutoDetectionHitIntervalsMs(getCalibrationBucket("fast-loud").hits),
  ];
  const fastestUsefulIntervalMs = percentile(fastIntervalsMs, 0.15);
  const { min: thresholdMin, max: thresholdMax } = getRangeBounds(elements.thresholdInput);
  const { min: refractoryMin, max: refractoryMax } = getRangeBounds(elements.refractoryInput);
  const { min: smoothingMin, max: smoothingMax } = getRangeBounds(elements.smoothingInput);

  const thresholdFromNoise = Math.max(noise99 * 2.4, noise95 * 3.2, thresholdMin);
  const thresholdFromSoft = soft25 === null ? null : soft25 * 0.58;
  const threshold = clamp(
    Number(Math.max(thresholdFromNoise, thresholdFromSoft ?? thresholdFromNoise).toFixed(3)),
    thresholdMin,
    thresholdMax
  );
  const refractoryMs = clamp(
    Math.round(
      fastestUsefulIntervalMs === null
        ? Number(elements.refractoryInput.value)
        : Math.max(refractoryMin, fastestUsefulIntervalMs * 0.46)
    ),
    refractoryMin,
    refractoryMax
  );
  const separationRatio =
    softMedian === null || noise95 <= 0 ? Infinity : softMedian / Math.max(noise95, 0.000001);
  const smoothing = clamp(
    Number(
      (
        separationRatio < 3
          ? 0.68
          : separationRatio < 6
            ? 0.5
            : fastestUsefulIntervalMs !== null && fastestUsefulIntervalMs < 70
              ? 0.28
              : 0.38
      ).toFixed(2)
    ),
    smoothingMin,
    smoothingMax
  );
  const dynamicQuality =
    softCandidates.length < 4
      ? "retry"
      : separationRatio < 2.2
        ? "noisy"
        : loudMedian !== null && softMedian !== null && loudMedian < softMedian * 1.25
          ? "usable"
          : "good";

  return {
    threshold,
    refractoryMs,
    smoothing,
    dynamicQuality,
    noiseFloor: noise95,
    fastestUsefulIntervalMs,
    dynamicCalibration: {
      capturedAtIso: new Date().toISOString(),
      noiseFloor: noise95,
      threshold,
      refractoryMs,
      smoothing,
      levels: {
        "3in": summarizeCalibrationStrengths(height3Peaks),
        "6in": summarizeCalibrationStrengths(height6Peaks),
        "9in": summarizeCalibrationStrengths(height9Peaks),
        "12in": summarizeCalibrationStrengths(height12Peaks),
        fastSoft: summarizeCalibrationStrengths(fastSoftPeaks),
        fastLoud: summarizeCalibrationStrengths(fastLoudPeaks),
      },
    },
  };
}

function evaluateCalibrationResult() {
  const targetTimes = state.calibration.targetTimesSeconds;
  const calibrationHits = state.hits
    .slice(state.calibration.startHitIndex)
    .filter(
      (hit) =>
        hit.rawTimeSeconds >= state.calibration.collectStartTimeSeconds - CALIBRATION_MATCH_WINDOW_MS / 1000 &&
        hit.rawTimeSeconds <= state.calibration.collectEndTimeSeconds + CALIBRATION_MATCH_WINDOW_MS / 1000
    );
  const dynamicResult = evaluateCalibrationDynamicResult();

  if (calibrationHits.length === 0) {
    return {
      offsetMs: null,
      madMs: null,
      quality: "retry",
      timingQuality: "retry",
      usableHitCount: 0,
      targetCount: targetTimes.length,
      matches: [],
      ...dynamicResult,
    };
  }

  let bestCandidate = null;

  for (
    let candidateOffsetMs = CALIBRATION_OFFSET_SEARCH_MIN_MS;
    candidateOffsetMs <= CALIBRATION_OFFSET_SEARCH_MAX_MS;
    candidateOffsetMs += 1
  ) {
    const candidateOffsetSeconds = candidateOffsetMs / 1000;
    const matchesByIndex = new Map();

    for (const hit of calibrationHits) {
      const hitTimeSeconds = hit.rawTimeSeconds;
      const correctedTimeSeconds = hitTimeSeconds - candidateOffsetSeconds;
      let nearestIndex = -1;
      let nearestResidualMs = Infinity;
      targetTimes.forEach((target, targetIndex) => {
        const residualMs = (correctedTimeSeconds - target.timeSeconds) * 1000;
        if (Math.abs(residualMs) < Math.abs(nearestResidualMs)) {
          nearestIndex = targetIndex;
          nearestResidualMs = residualMs;
        }
      });

      if (nearestIndex < 0 || Math.abs(nearestResidualMs) > CALIBRATION_MATCH_WINDOW_MS) {
        continue;
      }

      const target = targetTimes[nearestIndex];
      const targetTimeSeconds = target.timeSeconds;
      const errorMs = (hitTimeSeconds - targetTimeSeconds) * 1000;
      const existingMatch = matchesByIndex.get(nearestIndex);
      if (!existingMatch || Math.abs(nearestResidualMs) < Math.abs(existingMatch.residualMs)) {
        matchesByIndex.set(nearestIndex, {
          targetTimeSeconds,
          hitTimeSeconds,
          errorMs,
          residualMs: nearestResidualMs,
          strength: hit.strength,
          phaseId: target.phaseId,
          dynamicLevel: target.dynamicLevel,
          targetHeightInches: target.targetHeightInches,
        });
      }
    }

    const matches = [...matchesByIndex.values()].sort(
      (left, right) => left.targetTimeSeconds - right.targetTimeSeconds
    );
    const residualsMs = matches.map((match) => Math.abs(match.residualMs));
    const medianResidualMs = residualsMs.length > 0 ? median(residualsMs) : Infinity;

    if (
      !bestCandidate ||
      matches.length > bestCandidate.matches.length ||
      (matches.length === bestCandidate.matches.length &&
        medianResidualMs < bestCandidate.medianResidualMs) ||
      (matches.length === bestCandidate.matches.length &&
        medianResidualMs === bestCandidate.medianResidualMs &&
        Math.abs(candidateOffsetMs) < Math.abs(bestCandidate.candidateOffsetMs))
    ) {
      bestCandidate = {
        candidateOffsetMs,
        matches,
        medianResidualMs,
      };
    }
  }

  const matches = bestCandidate?.matches ?? [];

  const errorsMs = matches.map((match) => match.errorMs);
  const offsetMs = median(errorsMs);
  const madMs =
    offsetMs === null ? null : median(errorsMs.map((errorMs) => Math.abs(errorMs - offsetMs)));
  const quality = classifyCalibrationQuality(
    matches.length,
    targetTimes.length,
    madMs ?? Infinity
  );
  const combinedQuality =
    quality === "retry" || dynamicResult.dynamicQuality === "retry"
      ? "retry"
      : quality === "good" && dynamicResult.dynamicQuality === "good"
        ? "good"
        : "usable";

  return {
    offsetMs,
    madMs,
    quality: combinedQuality,
    timingQuality: quality,
    usableHitCount: matches.length,
    targetCount: targetTimes.length,
    matches,
    ...dynamicResult,
  };
}

function getCalibrationProgressUiState() {
  const calibration = state.calibration;
  const pendingResult = calibration.pendingResult;
  const hasPendingResult = pendingResult !== null;
  const progressFraction = getCalibrationProgressFraction();
  const progressCircumference = getCalibrationProgressCircumference();
  const totalSegments =
    calibration.phases.length > 0 ? calibration.phases.length : SINGLE_CALIBRATION_PHASES.length;
  const completedSegments = hasPendingResult
    ? totalSegments
    : calibration.active
      ? calibration.phases.filter((phase) => getCurrentSessionElapsedSeconds() >= phase.endTimeSeconds).length
      : 0;
  let progressLabelText = "Calibration";
  let phaseValueText = "Awaiting start";
  let segmentValueText = `${completedSegments}/${totalSegments}`;

  if (calibration.active && Number.isFinite(calibration.progressEndTimeSeconds)) {
    const phase = getCurrentCalibrationPhaseAtTime();
    progressLabelText = phase?.circleText ?? "Listening";
    phaseValueText = phase ? getCalibrationNextPhaseText(phase) : "Finishing";
  } else if (hasPendingResult) {
    progressLabelText = "Review result";
    phaseValueText = "Review result";
  }

  return {
    hasPendingResult,
    segmentValueText,
    progressCircumference,
    progressFraction,
    progressLabelText,
    phaseValueText,
  };
}

function updateCalibrationProgressUi() {
  const {
    progressCircumference,
    progressFraction,
    progressLabelText,
    segmentValueText,
    phaseValueText,
  } = getCalibrationProgressUiState();

  const visibleProgressLength =
    progressFraction <= 0 ? 0.0001 : progressCircumference * progressFraction;
  elements.calibrationProgressRing.style.strokeDasharray = `${visibleProgressLength} ${progressCircumference}`;
  elements.calibrationProgressRing.style.strokeDashoffset = "0";
  elements.calibrationProgressValue.textContent = progressLabelText;
  elements.calibrationPhaseValue.textContent = phaseValueText;
  elements.calibrationSegmentValue.textContent = segmentValueText;

  if (state.calibration.active) {
    const phase = getCurrentCalibrationPhaseAtTime();
    if (phase) {
      elements.calibrationStatusValue.textContent = phase.label;
      elements.calibrationInstructionText.textContent = phase.instruction;
      elements.calibrationScreenInstructionText.textContent = phase.instruction;
    }
  }
}

function updateCalibrationUi() {
  const calibration = state.calibration;
  const pendingResult = calibration.pendingResult;
  const hasPendingResult = pendingResult !== null;
  const isActive = calibration.active;
  const isSourceStep = calibration.overlayOpen && !isActive && !hasPendingResult;
  const defaultScreenInstruction =
    "Press start, stay silent through the tap-off, then follow the guided 3 inch, 6 inch, 9 inch, 12 inch, minimum-volume roll, and full-volume speed phases. The debug graph stays live below.";

  elements.latencyCompensationValue.textContent =
    Math.abs(state.latencyCompensationMs) < 0.05
      ? "0.0 ms"
      : formatMilliseconds(state.latencyCompensationMs);
  elements.calibrationStatusValue.textContent = calibration.statusText;
  elements.calibrationPanelStageValue.textContent = calibration.statusText;
  elements.calibrationInstructionText.textContent = calibration.instructions;
  elements.calibrationScreenInstructionText.textContent =
    !calibration.active && !hasPendingResult && calibration.statusText === "Ready"
      ? defaultScreenInstruction
      : calibration.instructions;
  elements.calibrationOffsetValue.textContent = hasPendingResult
    ? formatMilliseconds(pendingResult.offsetMs)
    : "--";
  elements.calibrationUsableHitsValue.textContent = hasPendingResult
    ? `${pendingResult.usableHitCount}/${pendingResult.targetCount}`
    : "--";
  elements.calibrationJitterValue.textContent = hasPendingResult
    ? formatMilliseconds(pendingResult.madMs)
    : "--";
  elements.calibrationQualityValue.textContent = hasPendingResult
    ? `${pendingResult.quality} · detection ${pendingResult.dynamicQuality}`
    : "--";
  updateCalibrationProgressUi();

  elements.calibrationScreen.classList.toggle("is-source-step", isSourceStep);
  elements.calibrationScreen.classList.toggle("is-calibrating", isActive);
  elements.calibrationScreen.classList.toggle("is-results", hasPendingResult);
  elements.calibrationSourceGate.hidden = !isSourceStep;
  elements.calibrationScreenBody.hidden = !isActive && !hasPendingResult;
  elements.calibrationScreenBody.classList.toggle("has-results", hasPendingResult);
  elements.calibrationScreenSide.hidden = !hasPendingResult;
  elements.settingsDebugPanel.hidden = !isActive && !hasPendingResult;
  elements.startCalibrationButton.disabled = calibration.active;
  elements.startCalibrationButton.replaceChildren(
    Object.assign(document.createElement("span"), {
      className: "calibration-start-title",
      textContent: hasPendingResult ? "Review Calibration" : "Start Calibration",
    }),
    Object.assign(document.createElement("span"), {
      className: "calibration-start-subtitle",
      textContent: hasPendingResult
        ? "Open the result screen to accept or discard this calibration."
        : "Calibrates timing, dynamics, and detection accuracy.",
    })
  );
  elements.acceptCalibrationButton.disabled = !hasPendingResult || pendingResult.quality === "retry";
  elements.discardCalibrationButton.disabled = !hasPendingResult;
  elements.resetCalibrationButton.disabled =
    calibration.active || Math.abs(state.latencyCompensationMs) < 0.05;
  elements.nudgeCalibrationBackButton.disabled = calibration.active;
  elements.nudgeCalibrationForwardButton.disabled = calibration.active;
  elements.clearLogButton.disabled = calibration.active;
  elements.calibrationScreenStartButton.disabled =
    calibration.active || hasPendingResult || !calibration.overlaySourceSelected;
  elements.calibrationScreenBackButton.disabled = calibration.finishing;
  elements.calibrationScreenResults.hidden = !hasPendingResult;

  const calibrationControlsDisabled = calibration.active;
  elements.metronomeTempoInput.disabled = calibrationControlsDisabled;
  elements.metronomeTempoNumber.disabled = calibrationControlsDisabled;
  elements.metronomeSubdivisionSelect.disabled = calibrationControlsDisabled;
  elements.metronomeNumeratorInput.disabled = calibrationControlsDisabled;
  elements.metronomeDenominatorSelect.disabled = calibrationControlsDisabled;
  elements.metronomeVolumeInput.disabled = calibrationControlsDisabled;
  elements.metronomeEnabledInput.disabled = calibrationControlsDisabled;
  elements.calibrationDeviceSelect.disabled = calibration.active || state.running;
  elements.metronomeAccentButtons.style.pointerEvents = calibrationControlsDisabled ? "none" : "auto";
  elements.metronomeAccentButtons.style.opacity = calibrationControlsDisabled ? "0.6" : "1";
}

function setLatencyCompensationMs(nextValueMs) {
  state.latencyCompensationMs = Number(nextValueMs.toFixed(3));
  saveDetectionSettings();
  recomputeHitTiming();
  updateCalibrationUi();
}

async function restoreCalibrationSettings() {
  if (!state.calibration.savedSettings) {
    return;
  }

  const savedSettings = state.calibration.savedSettings;
  state.calibration.savedSettings = null;
  await applyMetronomeSettings(savedSettings);
}

async function finalizeCalibration() {
  if (!state.calibration.active || state.calibration.finishing) {
    return;
  }

  const calibrationToken = state.calibration.token;
  state.calibration.finishing = true;
  const result = evaluateCalibrationResult();
  await stopMetronome({ closeContext: true });
  await restoreCalibrationSettings();
  if (state.calibration.token !== calibrationToken) {
    return;
  }
  state.calibration.active = false;
  state.calibration.finishing = false;
  state.calibration.pendingResult = result;
  state.calibration.statusText =
    result.quality !== "retry"
      ? "Calibration captured"
      : "Calibration needs retry";
  state.calibration.instructions =
    result.quality !== "retry"
      ? `Review the proposed offset, threshold ${result.threshold.toFixed(3)}, ${result.refractoryMs} ms refractory, and smoothing ${result.smoothing.toFixed(2)}.`
      : "The run did not capture enough clean timing or dynamic data. Discard and try again with clear stick-height contrast.";
  updateCalibrationUi();
}

async function cancelCalibration() {
  const shouldStopCalibrationCapture =
    state.calibration.startedCaptureForCalibration && state.running && !state.exercise.running;
  state.calibration.startedCaptureForCalibration = false;
  if (!state.calibration.active) {
    state.calibration.token += 1;
    state.calibration.pendingResult = null;
    state.calibration.statusText = "Ready";
    state.calibration.instructions =
      "Press start to run calibration with silence, stick heights, and fast taps.";
    state.calibration.progressStartTimeSeconds = null;
    state.calibration.progressEndTimeSeconds = null;
    state.calibration.phases = [];
    state.calibration.phaseSamples = null;
    state.calibration.targetTimesSeconds = [];
    await stopMetronome({ closeContext: true });
    if (shouldStopCalibrationCapture) {
      await stopCapture({ finalizeExercise: false });
    }
    updateCalibrationUi();
    return;
  }

  state.calibration.token += 1;
  state.calibration.active = false;
  state.calibration.finishing = false;
  state.calibration.pendingResult = null;
  state.calibration.startedCaptureForCalibration = false;
  state.calibration.progressStartTimeSeconds = null;
  state.calibration.progressEndTimeSeconds = null;
  state.calibration.phases = [];
  state.calibration.phaseSamples = null;
  state.calibration.targetTimesSeconds = [];
  await stopMetronome({ closeContext: true });
  await restoreCalibrationSettings();
  if (shouldStopCalibrationCapture) {
    await stopCapture({ finalizeExercise: false });
  }
  state.calibration.statusText = "Calibration cancelled";
  state.calibration.instructions =
    "Calibration was cancelled. Press start to run calibration again.";
  updateCalibrationUi();
}

async function acceptCalibration() {
  const pendingResult = state.calibration.pendingResult;
  if (!pendingResult) {
    return;
  }

  const shouldStopCalibrationCapture =
    state.calibration.startedCaptureForCalibration && state.running && !state.exercise.running;
  state.calibration.startedCaptureForCalibration = false;
  if (Number.isFinite(pendingResult.threshold)) {
    elements.thresholdInput.value = String(pendingResult.threshold);
  }
  if (Number.isFinite(pendingResult.refractoryMs)) {
    elements.refractoryInput.value = String(pendingResult.refractoryMs);
  }
  if (Number.isFinite(pendingResult.smoothing)) {
    elements.smoothingInput.value = String(pendingResult.smoothing);
  }
  state.dynamicCalibration = pendingResult.dynamicCalibration ?? null;
  updateDetectorFromControls();
  setLatencyCompensationMs(pendingResult.offsetMs ?? 0);
  state.appStats.totalCalibrationsCompleted += 1;
  saveAppStats();
  state.calibration.pendingResult = null;
  state.calibration.progressStartTimeSeconds = null;
  state.calibration.progressEndTimeSeconds = null;
  state.calibration.phases = [];
  state.calibration.phaseSamples = null;
  state.calibration.targetTimesSeconds = [];
  await stopMetronome({ closeContext: true });
  if (shouldStopCalibrationCapture) {
    await stopCapture({ finalizeExercise: false });
  }
  state.calibration.statusText = "Calibration applied";
  state.calibration.instructions =
    "Latency, detection sensitivity, fast-hit handling, and dynamic level references are active.";
  closeCalibrationOverlay();
  updateCalibrationUi();
}

async function discardCalibration() {
  if (state.calibration.active) {
    await cancelCalibration();
    return;
  }

  const shouldStopCalibrationCapture =
    state.calibration.startedCaptureForCalibration && state.running && !state.exercise.running;
  state.calibration.startedCaptureForCalibration = false;
  state.calibration.pendingResult = null;
  state.calibration.progressStartTimeSeconds = null;
  state.calibration.progressEndTimeSeconds = null;
  state.calibration.phases = [];
  state.calibration.phaseSamples = null;
  state.calibration.targetTimesSeconds = [];
  await stopMetronome({ closeContext: true });
  if (shouldStopCalibrationCapture) {
    await stopCapture({ finalizeExercise: false });
  }
  state.calibration.statusText = "Ready";
  state.calibration.instructions =
    "Press start to run calibration with silence, stick heights, and fast taps.";
  updateCalibrationUi();
}

function resetCalibrationOffset() {
  setLatencyCompensationMs(0);
  state.calibration.pendingResult = null;
  state.calibration.statusText = "Compensation reset";
  state.calibration.instructions =
    "Latency compensation is back at 0 ms. Start calibration again if you want to measure a new full setup.";
  updateCalibrationUi();
}

function nudgeLatencyCompensation(deltaMs) {
  setLatencyCompensationMs(state.latencyCompensationMs + deltaMs);
  state.calibration.statusText = "Manual trim applied";
  state.calibration.instructions =
    "The latency offset was adjusted manually. You can still run calibration later for a fresh measurement.";
  updateCalibrationUi();
}

async function startCalibration() {
  if (state.calibration.active) {
    return;
  }

  let startedCaptureForCalibration = false;
  const calibrationToken = state.calibration.token + 1;
  state.calibration.token = calibrationToken;
  state.calibration.savedSettings = captureCurrentMetronomeSettings();
  state.calibration.pendingResult = null;
  state.calibration.startedCaptureForCalibration = false;
  state.calibration.active = true;
  state.calibration.finishing = false;
  state.calibration.firstClickTimeSeconds = null;
  state.calibration.collectStartTimeSeconds = null;
  state.calibration.collectEndTimeSeconds = Number.POSITIVE_INFINITY;
  state.calibration.progressStartTimeSeconds = null;
  state.calibration.progressEndTimeSeconds = null;
  state.calibration.phases = [];
  state.calibration.phaseSamples = createCalibrationPhaseSamples();
  state.calibration.targetTimesSeconds = [];
  state.calibration.statusText = "Preparing calibration";
    state.calibration.instructions =
      "The tap-off is loading. Stay silent first, then follow each stick-height and fast-tap instruction.";
  updateCalibrationUi();

  try {
    if (state.usingSimulation) {
      throw new Error("Calibration needs a real audio input. Select your Mac microphone input, then try again.");
    }

    if (!state.running) {
      let selectedDevice = elements.calibrationDeviceSelect.value || elements.deviceSelect.value;
      if (selectedDevice === "simulated") {
        const realInputValue = getFirstRealAudioInputValue(elements.calibrationDeviceSelect);
        if (!realInputValue) {
          throw new Error("Calibration needs a real audio input. Select your Mac microphone input, then try again.");
        }
        selectedDevice = realInputValue;
        syncAudioDeviceSelection(selectedDevice);
      }

      await startLiveCapture(selectedDevice, {
        startSessionMetronome: false,
        statusText: "Preparing calibration input",
        messageText: "Calibration input is active. Follow the guided calibration screen.",
      });
      startedCaptureForCalibration = true;
      state.calibration.startedCaptureForCalibration = true;
    }

    const calibrationTimeSignature = {
      numerator: CALIBRATION_NUMERATOR,
      denominator: CALIBRATION_DENOMINATOR,
    };
    const calibrationSubdivision =
      SUBDIVISION_CONFIGS[CALIBRATION_SUBDIVISION] ?? SUBDIVISION_CONFIGS.eighth;
    const calibrationSettings = {
      enabled: true,
      tempo: CALIBRATION_TEMPO,
      subdivision: CALIBRATION_SUBDIVISION,
      numerator: calibrationTimeSignature.numerator,
      denominator: calibrationTimeSignature.denominator,
      accentLevels: getDefaultAccentLevels(calibrationSubdivision, calibrationTimeSignature),
    };

    await stopMetronome({ closeContext: true });
    await applyMetronomeSettings(calibrationSettings, { resync: false });
    if (state.calibration.token !== calibrationToken || !state.calibration.active) {
      return;
    }

    const {
      sequenceStartTimeSeconds,
      collectStartTimeSeconds,
      collectEndTimeSeconds,
      phases,
      targetTimes,
    } = await startCalibrationSequence();

    state.calibration.firstClickTimeSeconds = sequenceStartTimeSeconds;
    state.calibration.collectStartTimeSeconds = collectStartTimeSeconds;
    state.calibration.collectEndTimeSeconds = collectEndTimeSeconds;
    state.calibration.progressStartTimeSeconds = sequenceStartTimeSeconds;
    state.calibration.progressEndTimeSeconds = collectEndTimeSeconds;
    state.calibration.phases = phases;
    state.calibration.targetTimesSeconds = targetTimes;
    state.calibration.startHitIndex = state.hits.length;
    state.calibration.statusText = "Calibration listening";
    state.calibration.instructions =
      "Stay silent through the tap-off, then follow the instruction inside the progress ring.";
    updateCalibrationUi();
  } catch (error) {
    if (state.calibration.token === calibrationToken) {
      state.calibration.token += 1;
      state.calibration.active = false;
      state.calibration.finishing = false;
      state.calibration.pendingResult = null;
      state.calibration.progressStartTimeSeconds = null;
      state.calibration.progressEndTimeSeconds = null;
      state.calibration.phases = [];
      state.calibration.phaseSamples = null;
      state.calibration.targetTimesSeconds = [];
      await restoreCalibrationSettings();
      if (startedCaptureForCalibration) {
        state.calibration.startedCaptureForCalibration = false;
        await stopCapture({ finalizeExercise: false });
      }
      state.calibration.statusText = "Calibration failed";
      state.calibration.instructions =
        "Calibration could not start cleanly. Check the selected audio source, then try again.";
      updateCalibrationUi();
    }
    setMessage(`Calibration could not start: ${error.message}`);
  }
}

function updateCalibrationProgress() {
  if (
    !state.calibration.active ||
    state.calibration.finishing ||
    !Number.isFinite(state.calibration.collectEndTimeSeconds)
  ) {
    return;
  }

  const currentElapsed = getCurrentSessionElapsedSeconds();
  if (currentElapsed >= state.calibration.collectEndTimeSeconds + 0.08) {
    void finalizeCalibration();
  }
}

function createFreshSimulator() {
  state.simulator = new DrumTriggerSimulator({
    sampleRate: state.sampleRate ?? 48_000,
    bpm: getMetronomeTempo(),
    jitterMs: 0,
    graceHitProbability: 0,
    startOffsetSeconds: METRONOME_START_OFFSET_SECONDS,
  });
}

class ExerciseTriggerSimulator {
  constructor({ sampleRate, expectedHits, scoreStartTimeSeconds }) {
    this.sampleRate = sampleRate;
    this.expectedHits = expectedHits.map((hit) => ({
      sample: Math.round((scoreStartTimeSeconds + hit.timeSeconds) * sampleRate),
      strength: hit.accentLevel >= 2 ? 0.95 : hit.accentLevel === 1 ? 0.78 : 0.62,
    }));
    this.generatedSamples = 0;
    this.nextHitIndex = 0;
    this.voices = [];
  }

  scheduleVoice(startSample, strength) {
    this.voices.push({
      startSample,
      strength,
      durationSamples: Math.round(this.sampleRate * 0.045),
    });
  }

  advanceSchedule(targetSample) {
    while (
      this.nextHitIndex < this.expectedHits.length &&
      this.expectedHits[this.nextHitIndex].sample <= targetSample
    ) {
      const hit = this.expectedHits[this.nextHitIndex];
      this.scheduleVoice(hit.sample, hit.strength);
      this.nextHitIndex += 1;
    }
  }

  generateChunk(frameCount) {
    const chunk = new Float32Array(frameCount);
    const lastSample = this.generatedSamples + frameCount;
    this.advanceSchedule(lastSample);

    for (let index = 0; index < frameCount; index += 1) {
      const sampleIndex = this.generatedSamples + index;
      let sample = (Math.random() * 2 - 1) * 0.002;

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

        const ageSeconds = ageSamples / this.sampleRate;
        sample += voice.strength * Math.exp(-ageSeconds / 0.0015);
        sample +=
          voice.strength *
          0.18 *
          Math.sin(2 * Math.PI * 1400 * ageSeconds) *
          Math.exp(-ageSeconds / 0.012);
      }

      chunk[index] = clamp(sample, -1, 1);
    }

    this.generatedSamples += frameCount;
    return chunk;
  }
}

function resetAccentPattern() {
  state.metronomeAccentLevels = getDefaultAccentLevels();
}

async function restartMetronomeForNewSession() {
  state.metronomeClicks = [];
  if (!state.running) {
    updateMetronomeStatus();
    return;
  }

  if (!elements.metronomeEnabledInput.checked) {
    await stopMetronome({ closeContext: true });
    updateMetronomeStatus();
    return;
  }

  await stopMetronome({ closeContext: true });
  await startMetronome();
}

async function resyncMetronomeSchedule() {
  if (!state.running || !elements.metronomeEnabledInput.checked || !state.metronomeRunning) {
    updateMetronomeStatus();
    return;
  }

  const requestVersion = ++state.metronomeResyncVersion;
  const currentElapsed = getCurrentSessionElapsedSeconds();
  state.metronomeClicks = state.metronomeClicks.filter(
    (click) => click.timeSeconds <= currentElapsed + 0.002
  );
  await stopMetronome({ closeContext: true });
  if (
    requestVersion !== state.metronomeResyncVersion ||
    !state.running ||
    !elements.metronomeEnabledInput.checked
  ) {
    return;
  }
  await startMetronome(currentElapsed);
}

function clearSessionData({ resetDetector = true } = {}) {
  if (state.calibration.active) {
    void cancelCalibration();
  }
  state.calibration.pendingResult = null;
  state.calibration.progressStartTimeSeconds = null;
  state.calibration.progressEndTimeSeconds = null;
  state.calibration.phases = [];
  state.calibration.phaseSamples = null;
  state.calibration.targetTimesSeconds = [];
  if (!state.calibration.active) {
    state.calibration.statusText = "Ready";
    state.calibration.instructions =
      "Select an audio source, then open the calibration screen.";
  }
  state.hits = [];
  state.metronomeClicks = [];
  state.timelineFollowLive = true;
  initializeSessionClock();
  resetTempoSegments();
  resetAccentPattern();
  state.lastMetrics = {
    rawPeak: 0,
    filteredPeak: 0,
    threshold: Number(elements.thresholdInput.value),
    triggered: false,
  };

  if (resetDetector && state.detector) {
    state.detector.reset();
    state.detector.setParameters(getDetectorParameters());
  }

  if (state.running && state.usingSimulation) {
    createFreshSimulator();
  }

  updateStats();
  updateDebugReadouts();

  if (state.running) {
    void restartMetronomeForNewSession();
  } else {
    state.suppressTimelineScrollEvent = true;
    elements.timelineScroll.scrollLeft = 0;
    updateMetronomeStatus();
  }

  updateCalibrationUi();
  requestRender();
}

function recordHit(hit, { exerciseSessionId = null } = {}) {
  if (
    state.exercise.running &&
    (exerciseSessionId === null || exerciseSessionId !== state.exercise.activeSessionId)
  ) {
    return;
  }

  const sessionStartedAt = state.sessionStartedAtDate ?? new Date();
  const absoluteTime = new Date(sessionStartedAt.getTime() + hit.timeSeconds * 1000);
  const entry = {
    index: state.hits.length + 1,
    rawTimeSeconds: hit.timeSeconds,
    timeSeconds: hit.timeSeconds,
    beatPosition: getBeatPositionAtTime(hit.timeSeconds),
    elapsed: formatElapsedTime(hit.timeSeconds),
    strength: hit.strength,
    absoluteIso: absoluteTime.toISOString(),
  };

  updateHitDerivedTiming(entry);
  const previousHit = state.hits[state.hits.length - 1];
  if (
    state.exercise.running &&
    previousHit &&
    Math.abs(previousHit.rawTimeSeconds - entry.rawTimeSeconds) < 0.008
  ) {
    return;
  }

  state.hits.push(entry);
  state.appStats.totalHits += 1;
  saveAppStats();
  flashHitIndicator();
  updateStats();
  if (state.exercise.running) {
    updateExerciseLiveAnalysis();
  }
}

function processChunk(samples, { exerciseSessionId = null } = {}) {
  if (!state.detector) {
    return;
  }

  if (
    state.exercise.running &&
    (exerciseSessionId === null || exerciseSessionId !== state.exercise.activeSessionId)
  ) {
    return;
  }

  collectAutoDetectionSamples(samples);
  const result = state.detector.processChunk(samples);
  state.lastMetrics = result.metrics;
  collectCalibrationPhaseSamples(result);

  if (state.autoDetection.active && state.autoDetection.startedCaptureForAutoTune) {
    return;
  }

  for (const hit of result.hits) {
    recordHit(hit, { exerciseSessionId });
  }
}

function createCalibrationPhaseSamples(phases = SINGLE_CALIBRATION_PHASES) {
  return Object.fromEntries(
    phases.map((phase) => [
      phase.id,
      {
        rawPeaks: [],
        filteredPeaks: [],
        hits: [],
      },
    ])
  );
}

function getCurrentCalibrationPhaseAtTime(timeSeconds = getCurrentSessionElapsedSeconds()) {
  return state.calibration.phases.find(
    (phase) => timeSeconds >= phase.startTimeSeconds && timeSeconds < phase.endTimeSeconds
  ) ?? null;
}

function getCalibrationNextPhaseText(currentPhase) {
  const currentIndex = state.calibration.phases.findIndex((phase) => phase.id === currentPhase.id);
  const nextPhase = currentIndex >= 0 ? state.calibration.phases[currentIndex + 1] : null;
  if (!nextPhase) {
    return "Final phase";
  }

  switch (nextPhase.id) {
    case "height-3":
      return "Next: play 3 inch eighths";
    case "height-6":
      return "Next: play 6 inch eighths";
    case "height-9":
      return "Next: play 9 inch eighths";
    case "height-12":
      return "Next: play 12 inch eighths";
    case "roll-prep":
      return "Next: get ready for the quiet double-stroke roll";
    case "fast-soft":
      return "Next: very quiet double-stroke roll";
    case "fast-loud":
      return "Next: play fast at full volume";
    default:
      return `Next: ${nextPhase.label}`;
  }
}

function collectCalibrationPhaseSamples(result) {
  const calibration = state.calibration;
  if (!calibration.active || !calibration.phaseSamples) {
    return;
  }

  const currentElapsed = getCurrentSessionElapsedSeconds();
  const phase = getCurrentCalibrationPhaseAtTime(currentElapsed);
  if (!phase) {
    return;
  }

  const bucket = calibration.phaseSamples[phase.id];
  if (!bucket) {
    return;
  }

  bucket.rawPeaks.push(Number(result.metrics.rawPeak) || 0);
  bucket.filteredPeaks.push(Number(result.metrics.filteredPeak) || 0);
  result.hits.forEach((hit) => {
    const hitPhase = getCurrentCalibrationPhaseAtTime(hit.timeSeconds);
    const hitBucket = hitPhase ? calibration.phaseSamples[hitPhase.id] : null;
    if (!hitBucket) {
      return;
    }

    hitBucket.hits.push({
      timeSeconds: hit.timeSeconds,
      strength: Number(hit.strength) || 0,
    });
  });
}

function updateDetectorFromControls() {
  updateControlLabels();
  state.lastMetrics.threshold = Number(elements.thresholdInput.value);
  saveDetectionSettings();

  if (state.detector) {
    state.detector.setParameters(getDetectorParameters());
  }

  updateDebugReadouts();
  requestRender();
}

function createAutoDetectionSampleBuckets() {
  return Object.fromEntries(
    AUTO_DETECTION_PHASES.map((phase) => [
      phase.id,
      {
        rawPeaks: [],
        filteredPeaks: [],
        hits: [],
      },
    ])
  );
}

function getCurrentAutoDetectionPhase() {
  return AUTO_DETECTION_PHASES[state.autoDetection.phaseIndex] ?? null;
}

function getAutoDetectionProgress() {
  const auto = state.autoDetection;
  if (!auto.active || !Number.isFinite(auto.progressStartTimeSeconds)) {
    return 0;
  }

  const duration = auto.progressEndTimeSeconds - auto.progressStartTimeSeconds;
  if (duration <= 0) {
    return 0;
  }

  return clamp((getCurrentSessionElapsedSeconds() - auto.progressStartTimeSeconds) / duration, 0, 1);
}

function collectAutoDetectionSamples(samples) {
  const auto = state.autoDetection;
  const phase = getCurrentAutoDetectionPhase();
  if (!auto.active || !phase || !auto.samples || !state.sampleRate) {
    return;
  }
  if (
    Number.isFinite(auto.phaseStartTimeSeconds) &&
    getCurrentSessionElapsedSeconds() < auto.phaseStartTimeSeconds
  ) {
    return;
  }

  if (!auto.collector) {
    auto.collector = new DrumHitDetector({
      sampleRate: state.sampleRate,
      threshold: 0.001,
      refractoryMs: 7,
      smoothing: 0.22,
      adaptiveStrength: 0.15,
      highPassHz: 105,
    });
  }

  const bucket = auto.samples[phase.id];
  const result = auto.collector.processChunk(samples);
  bucket.rawPeaks.push(result.metrics.rawPeak);
  bucket.filteredPeaks.push(result.metrics.filteredPeak);
  result.hits.forEach((hit) => {
    bucket.hits.push({
      timeSeconds: hit.timeSeconds,
      strength: hit.strength,
    });
  });
}

function getAutoDetectionHitIntervalsMs(hits) {
  return hits
    .slice(1)
    .map((hit, index) => (hit.timeSeconds - hits[index].timeSeconds) * 1000)
    .filter((intervalMs) => Number.isFinite(intervalMs) && intervalMs > 12 && intervalMs < 500);
}

function getPhasePeakCandidates(bucket, noiseFloor) {
  const hitStrengths = bucket.hits.map((hit) => hit.strength).filter((value) => value > noiseFloor);
  if (hitStrengths.length >= 3) {
    return hitStrengths;
  }

  const floor = Math.max(noiseFloor * 1.35, 0.0005);
  return bucket.filteredPeaks.filter((value) => value > floor);
}

function evaluateAutoDetectionResult() {
  const samples = state.autoDetection.samples;
  const noise = samples?.noise ?? { filteredPeaks: [], rawPeaks: [], hits: [] };
  const soft = samples?.soft ?? { filteredPeaks: [], rawPeaks: [], hits: [] };
  const loud = samples?.loud ?? { filteredPeaks: [], rawPeaks: [], hits: [] };
  const noise95 = percentile(noise.filteredPeaks, 0.95) ?? 0;
  const noise99 = percentile(noise.filteredPeaks, 0.99) ?? noise95;
  const softPeaks = getPhasePeakCandidates(soft, noise95);
  const loudPeaks = getPhasePeakCandidates(loud, noise95);
  const soft25 = percentile(softPeaks, 0.25);
  const softMedian = median(softPeaks);
  const loudMedian = median(loudPeaks);
  const intervalsMs = getAutoDetectionHitIntervalsMs(soft.hits);
  const fastestUsefulIntervalMs = percentile(intervalsMs, 0.15);
  const { min: thresholdMin, max: thresholdMax } = getRangeBounds(elements.thresholdInput);
  const { min: refractoryMin, max: refractoryMax } = getRangeBounds(elements.refractoryInput);
  const { min: smoothingMin, max: smoothingMax } = getRangeBounds(elements.smoothingInput);

  const thresholdFromNoise = Math.max(noise99 * 2.4, noise95 * 3.2, thresholdMin);
  const thresholdFromSoft = soft25 === null ? null : soft25 * 0.58;
  const proposedThreshold = clamp(
    Number((Math.max(thresholdFromNoise, thresholdFromSoft ?? thresholdFromNoise)).toFixed(3)),
    thresholdMin,
    thresholdMax
  );
  const proposedRefractoryMs = clamp(
    Math.round(
      fastestUsefulIntervalMs === null
        ? Number(elements.refractoryInput.value)
        : Math.max(refractoryMin, fastestUsefulIntervalMs * 0.46)
    ),
    refractoryMin,
    refractoryMax
  );
  const separationRatio =
    softMedian === null || noise95 <= 0 ? Infinity : softMedian / Math.max(noise95, 0.000001);
  const proposedSmoothing = clamp(
    Number(
      (
        separationRatio < 3
          ? 0.68
          : separationRatio < 6
            ? 0.5
            : fastestUsefulIntervalMs !== null && fastestUsefulIntervalMs < 70
              ? 0.28
              : 0.38
      ).toFixed(2)
    ),
    smoothingMin,
    smoothingMax
  );
  const softHitCount = soft.hits.length;
  const quality =
    softPeaks.length < AUTO_DETECTION_MIN_SOFT_HITS
      ? "retry"
      : separationRatio < 2.2
        ? "noisy"
        : loudMedian !== null && softMedian !== null && loudMedian < softMedian * 1.25
          ? "usable"
          : "good";

  return {
    threshold: proposedThreshold,
    refractoryMs: proposedRefractoryMs,
    smoothing: proposedSmoothing,
    quality,
    noiseFloor: noise95,
    softHitCount,
    loudHitCount: loud.hits.length,
    softMedian,
    loudMedian,
    fastestUsefulIntervalMs,
  };
}

function updateAutoDetectionUi() {
  const auto = state.autoDetection;
  const phase = getCurrentAutoDetectionPhase();
  const pending = auto.pendingResult;
  const progress = auto.active ? getAutoDetectionProgress() : 0;
  const progressCircumference = getCalibrationProgressCircumference();
  const visibleProgressLength =
    progress <= 0 ? 0.0001 : progressCircumference * (pending ? 1 : progress);
  const statusText = auto.active
    ? phase?.label ?? "Finishing"
    : pending
      ? "Review"
      : auto.statusText;
  const progressText = auto.active
    ? phase?.circleText || "Listening"
    : pending
      ? "Review result"
      : "Detection Setup";

  elements.autoTunePhaseValue.textContent = auto.active
    ? `${Math.round(progress * 100)}%`
    : statusText;
  elements.autoTuneProgressValue.textContent = progressText;
  elements.autoTuneStatusValue.textContent = statusText;
  elements.autoTuneQualityValue.textContent = pending?.quality ?? "--";
  elements.autoTuneInstructionText.textContent = auto.active
    ? phase?.instruction ?? "Analyzing captured signal..."
    : auto.instructions;
  elements.autoTuneProgressRing.style.strokeDasharray = `${visibleProgressLength} ${progressCircumference}`;
  elements.autoTuneProgressRing.style.strokeDashoffset = "0";
  elements.autoTuneThresholdValue.textContent = pending ? pending.threshold.toFixed(3) : "--";
  elements.autoTuneRefractoryValue.textContent = pending ? `${pending.refractoryMs} ms` : "--";
  elements.autoTuneSmoothingValue.textContent = pending ? pending.smoothing.toFixed(2) : "--";
  elements.startAutoTuneButton.disabled = auto.active || state.exercise.running;
  elements.autoTuneScreenStartButton.disabled = auto.active || Boolean(pending);
  elements.cancelAutoTuneButton.disabled = false;
  elements.acceptAutoTuneButton.disabled = !pending || pending.quality === "retry";
  elements.discardAutoTuneButton.disabled = !pending;
  elements.autoTuneDeviceSelect.disabled = auto.active || state.running;
  elements.autoTuneScreenIdleActions.hidden = auto.active || Boolean(pending);
  elements.autoTuneScreenResults.hidden = !pending;
}

async function stopAutoDetectionCaptureIfNeeded() {
  const shouldStopAutoCapture =
    state.autoDetection.startedCaptureForAutoTune && state.running && !state.exercise.running;
  state.autoDetection.startedCaptureForAutoTune = false;
  if (shouldStopAutoCapture) {
    await stopCapture({ finalizeExercise: false });
  }
}

function updateMetronomeVolumeFromControl() {
  updateControlLabels();
  saveDetectionSettings();
}

async function cancelAutoDetectionCalibration() {
  state.autoDetection.token += 1;
  state.autoDetection.active = false;
  state.autoDetection.collector = null;
  state.autoDetection.samples = null;
  state.autoDetection.phaseStartTimeSeconds = null;
  state.autoDetection.progressStartTimeSeconds = null;
  state.autoDetection.progressEndTimeSeconds = null;
  state.autoDetection.statusText = "Cancelled";
  state.autoDetection.instructions =
    "Auto setup was cancelled. Start again when you are ready to measure the trigger signal.";
  await stopAutoDetectionCaptureIfNeeded();
  updateAutoDetectionUi();
}

function completeAutoDetectionCalibration() {
  state.autoDetection.active = false;
  state.autoDetection.collector = null;
  state.autoDetection.phaseStartTimeSeconds = null;
  state.autoDetection.progressStartTimeSeconds = null;
  state.autoDetection.progressEndTimeSeconds = null;
  state.autoDetection.pendingResult = evaluateAutoDetectionResult();
  state.autoDetection.statusText = "Review";
  const result = state.autoDetection.pendingResult;
  state.autoDetection.instructions =
    result.quality === "retry"
      ? "The soft hits were not clear enough. Try again with a quieter room or slightly stronger soft taps."
      : "Review the suggested threshold, refractory period, and smoothing, then apply or discard them.";
  void stopAutoDetectionCaptureIfNeeded();
  updateAutoDetectionUi();
}

function updateAutoDetectionCalibration() {
  const auto = state.autoDetection;
  const phase = getCurrentAutoDetectionPhase();
  if (!auto.active || !phase || !Number.isFinite(auto.phaseStartTimeSeconds)) {
    return;
  }

  const currentElapsed = getCurrentSessionElapsedSeconds();
  if (currentElapsed < auto.phaseStartTimeSeconds + phase.durationSeconds) {
    updateAutoDetectionUi();
    return;
  }

  auto.phaseIndex += 1;
  const nextPhase = getCurrentAutoDetectionPhase();
  if (!nextPhase) {
    completeAutoDetectionCalibration();
    return;
  }

  auto.phaseStartTimeSeconds = currentElapsed;
  auto.statusText = nextPhase.label;
  auto.instructions = nextPhase.instruction;
  updateAutoDetectionUi();
}

async function startAutoDetectionCalibration() {
  if (state.autoDetection.active || state.exercise.running) {
    return;
  }

  let selectedDevice = elements.autoTuneDeviceSelect.value || elements.deviceSelect.value;
  if (selectedDevice === "simulated") {
    const realInputValue = getFirstRealAudioInputValue(elements.autoTuneDeviceSelect);
    if (!realInputValue) {
      state.autoDetection.statusText = "Needs input";
      state.autoDetection.instructions =
        "Auto setup needs a real trigger input. Connect/select your Mac audio input, then try again.";
      state.autoDetection.pendingResult = null;
      updateAutoDetectionUi();
      setMessage("Auto detection setup needs a real trigger input. Select your Mac audio input, then try again.");
      return;
    }

    selectedDevice = realInputValue;
    syncAudioDeviceSelection(selectedDevice);
  }

  const autoToken = state.autoDetection.token + 1;
  state.autoDetection.token = autoToken;
  state.autoDetection.active = true;
  state.autoDetection.startedCaptureForAutoTune = false;
  state.autoDetection.phaseIndex = 0;
  state.autoDetection.collector = null;
  state.autoDetection.samples = createAutoDetectionSampleBuckets();
  state.autoDetection.pendingResult = null;
  state.autoDetection.statusText = "Starting";
  state.autoDetection.instructions = "Requesting the selected audio input. Allow microphone access if prompted.";
  updateAutoDetectionUi();

  try {
    if (!state.running) {
      await startLiveCapture(selectedDevice, {
        startSessionMetronome: false,
        statusText: "Running auto detection setup",
        messageText: "Auto detection setup is listening. Follow the phase instructions.",
      });
      state.autoDetection.startedCaptureForAutoTune = true;
    } else if (state.usingSimulation) {
      throw new Error("Auto detection setup needs a real trigger input, not the simulated stream.");
    }

    if (state.autoDetection.token !== autoToken) {
      return;
    }

    const startTime = getCurrentSessionElapsedSeconds() + 0.15;
    const totalDuration = AUTO_DETECTION_PHASES.reduce(
      (sum, phase) => sum + phase.durationSeconds,
      0
    );
    state.autoDetection.phaseStartTimeSeconds = startTime;
    state.autoDetection.progressStartTimeSeconds = startTime;
    state.autoDetection.progressEndTimeSeconds = startTime + totalDuration;
    state.autoDetection.statusText = AUTO_DETECTION_PHASES[0].label;
    state.autoDetection.instructions = AUTO_DETECTION_PHASES[0].instruction;
    updateAutoDetectionUi();
    requestRender();
  } catch (error) {
    state.autoDetection.active = false;
    state.autoDetection.collector = null;
    state.autoDetection.samples = null;
    state.autoDetection.statusText = "Failed";
    state.autoDetection.instructions = error.message;
    await stopAutoDetectionCaptureIfNeeded();
    updateAutoDetectionUi();
    setMessage(error.message);
  }
}

function applyAutoDetectionResult() {
  const result = state.autoDetection.pendingResult;
  if (!result) {
    return;
  }

  elements.thresholdInput.value = String(result.threshold);
  elements.refractoryInput.value = String(result.refractoryMs);
  elements.smoothingInput.value = String(result.smoothing);
  state.autoDetection.pendingResult = null;
  state.autoDetection.statusText = "Applied";
  state.autoDetection.instructions =
    "Suggested detection settings were applied and will be restored when you reopen the app.";
  updateDetectorFromControls();
  updateAutoDetectionUi();
  closeAutoTuneOverlay();
}

function discardAutoDetectionResult() {
  state.autoDetection.pendingResult = null;
  state.autoDetection.statusText = "Ready";
  state.autoDetection.instructions =
    "Press start, stay silent for the noise check, play soft fast taps, then play loud taps.";
  updateAutoDetectionUi();
}

function resetDetectionDefaults() {
  elements.thresholdInput.value = "0.005";
  elements.refractoryInput.value = "20";
  elements.smoothingInput.value = "0.58";
  elements.metronomeVolumeInput.value = "80";
  updateDetectorFromControls();
  state.autoDetection.pendingResult = null;
  state.autoDetection.statusText = "Defaults restored";
  state.autoDetection.instructions =
    "Detection threshold, refractory period, and smoothing were reset to the prototype defaults.";
  updateAutoDetectionUi();
  setMessage("Detection settings reset to defaults.", false);
}

async function refreshDeviceList() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    setMessage("This browser does not support audio input device enumeration.");
    return;
  }

  const previousSelection =
    state.appMode === "exercise"
      ? elements.exerciseDeviceSelect.value || elements.deviceSelect.value
      : state.appMode === "settings"
        ? elements.autoTuneDeviceSelect.value ||
          elements.calibrationDeviceSelect.value ||
          elements.deviceSelect.value
        : elements.deviceSelect.value || elements.exerciseDeviceSelect.value;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((device) => device.kind === "audioinput");

  elements.deviceSelect.innerHTML = "";
  elements.exerciseDeviceSelect.innerHTML = "";
  elements.calibrationDeviceSelect.innerHTML = "";
  elements.autoTuneDeviceSelect.innerHTML = "";

  const simulatedOption = document.createElement("option");
  simulatedOption.value = "simulated";
  simulatedOption.textContent = "Simulated trigger stream";
  elements.deviceSelect.append(simulatedOption);

  if (inputs.length === 0) {
    const fallbackOption = document.createElement("option");
    fallbackOption.value = "default";
    fallbackOption.textContent = "Default system microphone";
    elements.deviceSelect.append(fallbackOption);
  } else {
    inputs.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId || "default";
      option.textContent = device.label || `Audio input ${index + 1}`;
      elements.deviceSelect.append(option);
    });
  }

  for (const option of Array.from(elements.deviceSelect.options)) {
    elements.exerciseDeviceSelect.append(option.cloneNode(true));
    elements.calibrationDeviceSelect.append(option.cloneNode(true));
    elements.autoTuneDeviceSelect.append(option.cloneNode(true));
  }

  const calibrationPlaceholderOption = document.createElement("option");
  calibrationPlaceholderOption.value = "";
  calibrationPlaceholderOption.textContent = "Select an audio source...";
  calibrationPlaceholderOption.disabled = true;
  elements.calibrationDeviceSelect.prepend(calibrationPlaceholderOption);

  const desiredValue = Array.from(elements.deviceSelect.options).some(
    (option) => option.value === previousSelection
  )
    ? previousSelection
    : "simulated";

  elements.deviceSelect.value = desiredValue;
  elements.exerciseDeviceSelect.value = desiredValue;
  elements.calibrationDeviceSelect.value = desiredValue;
  elements.autoTuneDeviceSelect.value = desiredValue;
  updateCalibrationUi();
}

async function ensureMetronomeContext() {
  if (state.metronomeContext && state.metronomeContext.state !== "closed") {
    await state.metronomeContext.resume();
    return state.metronomeContext;
  }

  const AudioContextClass = getAudioContextClass();
  if (!AudioContextClass) {
    throw new Error("This browser does not support Web Audio metronome playback.");
  }

  state.metronomeContext = new AudioContextClass({ latencyHint: "interactive" });
  await state.metronomeContext.resume();
  return state.metronomeContext;
}

function scheduleMetronomeClickAudio(context, audioTime, accentLevel) {
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  const outputVolume = getMetronomeVolume();
  const tones = [
    { type: "sine", frequency: 1180, gain: 0.11 },
    { type: "triangle", frequency: 1560, gain: 0.18 },
    { type: "triangle", frequency: 1880, gain: 0.28 },
  ];
  const tone = tones[clamp(accentLevel, 0, tones.length - 1)];
  oscillator.type = tone.type;
  oscillator.frequency.setValueAtTime(tone.frequency, audioTime);

  gainNode.gain.setValueAtTime(0.0001, audioTime);
  gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, tone.gain * outputVolume), audioTime + 0.002);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, audioTime + 0.05);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);
  oscillator.start(audioTime);
  oscillator.stop(audioTime + 0.055);

  const delayMs = (audioTime - context.currentTime) * 1000;
  flashMetronomeIndicator(delayMs);
}

function scheduleMetronome() {
  if (!state.metronomeRunning || !state.metronomeContext) {
    return;
  }

  const tempo = getMetronomeTempo();
  const timeSignature = getTimeSignature();
  const positions = getMeasureSubdivisionPositions();
  const rows = getSubdivisionButtonLayout();
  const labels = rows.flatMap((row) => row.buttons.map((button) => button.label));
  const accentLevels = state.metronomeAccentLevels.length === positions.length
    ? state.metronomeAccentLevels
    : getDefaultAccentLevels();
  const measureLengthBeats = timeSignature.numerator;

  while (
    state.metronomeNextAudioTime <
    state.metronomeContext.currentTime + METRONOME_LOOKAHEAD_SECONDS
  ) {
    const accentLevel = clamp(accentLevels[state.metronomePatternIndex] ?? 0, 0, 2);
    scheduleMetronomeClickAudio(state.metronomeContext, state.metronomeNextAudioTime, accentLevel);
    state.metronomeClicks.push({
      timeSeconds: state.metronomeNextSessionTime,
      beatPosition: state.metronomeNextBeatPosition,
      beatNumber: Math.floor(positions[state.metronomePatternIndex] ?? 0) + 1,
      stepInMeasure: state.metronomePatternIndex,
      subdivision: elements.metronomeSubdivisionSelect.value,
      label: labels[state.metronomePatternIndex] ?? String(state.metronomePatternIndex + 1),
      accentLevel,
    });

    const currentPatternIndex = state.metronomePatternIndex;
    state.metronomePatternIndex += 1;
    if (state.metronomePatternIndex >= positions.length) {
      state.metronomePatternIndex = 0;
      state.metronomeMeasureIndex += 1;
    }

    const currentAbsoluteBeat =
      state.metronomeMeasureIndex * measureLengthBeats +
      (positions[state.metronomePatternIndex] ?? 0);
    const previousAbsoluteBeat = state.metronomeNextBeatPosition;
    const nextAbsoluteBeat =
      state.metronomePatternIndex === 0 && currentPatternIndex === positions.length - 1
        ? (state.metronomeMeasureIndex * measureLengthBeats)
        : currentAbsoluteBeat;
    const beatDelta = Math.max(0, nextAbsoluteBeat - previousAbsoluteBeat);
    const intervalSeconds = (beatDelta * 60) / tempo;

    state.metronomeNextBeatPosition = nextAbsoluteBeat;
    state.metronomeNextAudioTime += intervalSeconds;
    state.metronomeNextSessionTime += intervalSeconds;
  }
}

async function startMetronome(startElapsedOverride = null) {
  if (!state.running || !elements.metronomeEnabledInput.checked) {
    updateMetronomeStatus();
    return;
  }

  const context = await ensureMetronomeContext();
  const tempo = getMetronomeTempo();
  const timeSignature = getTimeSignature();
  const positions = getMeasureSubdivisionPositions();
  resetMetronomeIndicatorFlash();
  state.metronomeRunning = true;

  const isFreshSimulatedSession =
    state.usingSimulation && state.hits.length === 0 && state.metronomeClicks.length === 0;
  const currentElapsed =
    startElapsedOverride ??
    (isFreshSimulatedSession ? 0 : getCurrentSessionElapsedSeconds());

  addTempoSegment(currentElapsed, tempo);

  const currentBeat = getBeatPositionAtTime(currentElapsed);
  const minimumLeadBeats = (METRONOME_START_OFFSET_SECONDS * tempo) / 60;
  const earliestBeat = currentBeat + minimumLeadBeats;
  const measureLengthBeats = timeSignature.numerator;
  let measureIndex = Math.floor(earliestBeat / measureLengthBeats);
  let beatInMeasure = earliestBeat - measureIndex * measureLengthBeats;
  let patternIndex = positions.findIndex((position) => position >= beatInMeasure - 0.0001);

  if (patternIndex === -1) {
    measureIndex += 1;
    beatInMeasure = 0;
    patternIndex = 0;
  }

  const nextBeatPosition = measureIndex * measureLengthBeats + positions[patternIndex];
  const nextBeatDeltaSeconds = ((nextBeatPosition - currentBeat) * 60) / tempo;

  state.metronomeNextSessionTime =
    currentElapsed + Math.max(METRONOME_START_OFFSET_SECONDS, nextBeatDeltaSeconds);
  state.metronomeNextAudioTime =
    context.currentTime + Math.max(METRONOME_START_OFFSET_SECONDS, nextBeatDeltaSeconds);
  state.metronomeNextBeatPosition = nextBeatPosition;
  state.metronomePatternIndex = patternIndex;
  state.metronomeMeasureIndex = measureIndex;
  state.metronomeAudioZeroTime = context.currentTime;
  state.metronomeElapsedBaseSeconds = currentElapsed;

  window.clearInterval(state.metronomeTimer);
  state.metronomeTimer = window.setInterval(
    scheduleMetronome,
    METRONOME_SCHEDULER_INTERVAL_MS
  );
  scheduleMetronome();
  updateMetronomeStatus();
}

async function stopMetronome({ closeContext = false } = {}) {
  window.clearInterval(state.metronomeTimer);
  state.metronomeTimer = null;
  state.metronomeRunning = false;
  state.metronomeAudioZeroTime = null;
  state.metronomeElapsedBaseSeconds = 0;
  resetMetronomeIndicatorFlash();

  if (closeContext && state.metronomeContext) {
    const context = state.metronomeContext;
    state.metronomeContext = null;
    await context.close();
  }

  updateMetronomeStatus();
}

function stopExerciseGuide() {
  state.exercise.guideToken += 1;
  window.clearInterval(state.exercise.guideTimer);
  state.exercise.guideTimer = null;
  state.exercise.guideNextIndex = 0;
  state.exercise.guideAudioStartTime = null;
}

function clearExerciseCompletionTimer() {
  window.clearTimeout(state.exercise.completionTimer);
  state.exercise.completionTimer = null;
}

function clearSimulationTimer() {
  window.clearInterval(state.simulationTimer);
  state.simulationTimer = null;
}

function hardResetExerciseRuntime({ advanceSession = false } = {}) {
  if (advanceSession) {
    state.exercise.sessionId += 1;
  }

  clearExerciseCompletionTimer();
  clearSimulationTimer();
  stopExerciseGuide();
  stopExerciseListen();
  state.exercise.starting = false;
  state.exercise.stopping = false;
  state.exercise.running = false;
  state.exercise.activeSessionId = null;
  state.exercise.simulator = null;
}

function stopExerciseListen({ keepCursor = false } = {}) {
  window.clearInterval(state.exercise.listenTimer);
  state.exercise.listenTimer = null;
  state.exercise.listening = false;
  state.exercise.listenEvents = [];
  state.exercise.listenNextIndex = 0;
  state.exercise.listenStartPerformanceMs = null;
  state.exercise.listenScoreStartTimeSeconds = 0;
  state.exercise.listenEndTimeSeconds = 0;
  resetMetronomeIndicatorFlash();
  if (!keepCursor) {
    hideExerciseSheetCursor();
  }
  hideExerciseReadyPrompt();
  updateExerciseCaptureUi();
  requestRender();
}

function scheduleExerciseGuide(expectedGuideToken = state.exercise.guideToken) {
  if (
    expectedGuideToken !== state.exercise.guideToken ||
    !state.exercise.running ||
    !state.metronomeContext
  ) {
    return;
  }

  const guideAudioStartTime = state.exercise.guideAudioStartTime;
  const currentElapsed = Number.isFinite(guideAudioStartTime)
    ? Math.max(0, state.metronomeContext.currentTime - guideAudioStartTime)
    : getCurrentSessionElapsedSeconds();
  const nextEvent = state.exercise.guideEvents[state.exercise.guideNextIndex];
  const isSchedulingCountIn = nextEvent?.type === "count-in";
  const lookaheadSeconds = isSchedulingCountIn
    ? Math.max(EXERCISE_GUIDE_LOOKAHEAD_SECONDS, state.exercise.scoreStartTimeSeconds + 0.08)
    : EXERCISE_GUIDE_LOOKAHEAD_SECONDS;
  while (
    state.exercise.guideNextIndex < state.exercise.guideEvents.length &&
    state.exercise.guideEvents[state.exercise.guideNextIndex].timeSeconds <
      currentElapsed + lookaheadSeconds
  ) {
    const event = state.exercise.guideEvents[state.exercise.guideNextIndex];
    if (isSchedulingCountIn && event.type !== "count-in") {
      break;
    }

    const plannedAudioTime = Number.isFinite(guideAudioStartTime)
      ? guideAudioStartTime + event.timeSeconds
      : state.metronomeContext.currentTime + Math.max(0.004, event.timeSeconds - currentElapsed);
    const audioTime = Math.max(state.metronomeContext.currentTime + 0.004, plannedAudioTime);
    scheduleMetronomeClickAudio(state.metronomeContext, audioTime, event.accentLevel);
    state.exercise.guideNextIndex += 1;
  }
}

async function startExerciseGuide() {
  const guideToken = state.exercise.guideToken + 1;
  state.exercise.guideToken = guideToken;
  window.clearInterval(state.exercise.guideTimer);
  state.exercise.guideTimer = null;

  const context = await ensureMetronomeContext();
  if (guideToken !== state.exercise.guideToken || !state.exercise.running) {
    return;
  }

  state.exercise.guideNextIndex = 0;
  state.exercise.guideTimer = window.setInterval(
    () => scheduleExerciseGuide(guideToken),
    EXERCISE_GUIDE_INTERVAL_MS
  );
  await context.resume();
  if (guideToken !== state.exercise.guideToken || !state.exercise.running) {
    stopExerciseGuide();
    return;
  }
  scheduleExerciseGuide(guideToken);
}

function buildExerciseListenEvents(exercise) {
  const scoreStartTimeSeconds = EXERCISE_LISTEN_START_DELAY_SECONDS;
  return exercise.expectedHits.map((hit) => ({
    timeSeconds: scoreStartTimeSeconds + hit.timeSeconds,
    beatPosition: hit.beatPosition,
    accentLevel: hit.accentLevel,
    type: "listen",
    expectedHitIndex: hit.index,
  }));
}

function buildExerciseMetronomeGuideEvents(exercise, scoreStartTimeSeconds) {
  if (!elements.metronomeEnabledInput.checked) {
    return [];
  }

  const tempo = exercise.tempoBpm;
  const secondsPerBeat = 60 / tempo;
  const positions = getMeasureSubdivisionPositions();
  const accentLevels =
    state.metronomeAccentLevels.length === positions.length
      ? state.metronomeAccentLevels
      : getDefaultAccentLevels(getSubdivisionConfig(), getTimeSignature());
  const measureLengthBeats = getTimeSignature().numerator;
  const totalBeats = Math.max(exercise.totalQuarterBeats, exercise.durationSeconds / secondsPerBeat);
  const events = [];

  for (let measureStartBeat = 0; measureStartBeat <= totalBeats + 0.0001; measureStartBeat += measureLengthBeats) {
    positions.forEach((position, stepIndex) => {
      const beatPosition = measureStartBeat + position;
      if (beatPosition > totalBeats + 0.0001) {
        return;
      }

      events.push({
        timeSeconds: scoreStartTimeSeconds + beatPosition * secondsPerBeat,
        beatPosition,
        accentLevel: clamp(accentLevels[stepIndex] ?? 0, 0, 2),
        type: "metronome",
      });
    });
  }

  return events;
}

function getExerciseTapOffConfig(exercise) {
  if (TRIPLET_TAP_OFF_EXERCISE_IDS.has(exercise?.id)) {
    return {
      pattern: TRIPLET_TAP_OFF_PATTERN,
      stepBeats: 1 / 3,
    };
  }

  return {
    pattern: CALIBRATION_TAP_OFF_PATTERN,
    stepBeats: 0.5,
  };
}

function scheduleExerciseListen() {
  if (!state.exercise.listening) {
    return;
  }

  const currentElapsed = getExerciseListenElapsedSeconds();
  if (state.metronomeContext) {
    while (
      state.exercise.listenNextIndex < state.exercise.listenEvents.length &&
      state.exercise.listenEvents[state.exercise.listenNextIndex].timeSeconds <
        currentElapsed + EXERCISE_GUIDE_LOOKAHEAD_SECONDS
    ) {
      const event = state.exercise.listenEvents[state.exercise.listenNextIndex];
      const audioTime =
        state.metronomeContext.currentTime + Math.max(0.004, event.timeSeconds - currentElapsed);
      scheduleMetronomeClickAudio(state.metronomeContext, audioTime, event.accentLevel);
      state.exercise.listenNextIndex += 1;
    }
  }

  if (currentElapsed > state.exercise.listenEndTimeSeconds + 0.25) {
    stopExerciseListen({ keepCursor: true });
  }
}

async function startExerciseListen() {
  if (state.exercise.running || state.exercise.listening || !state.exercise.loaded) {
    return;
  }

  setMessage("");
  try {
    stopExerciseListen();
    updateExerciseFromTempoInput();
    const exercise = state.exercise.loaded;

    state.exercise.listening = true;
    state.exercise.listenEvents = buildExerciseListenEvents(exercise);
    state.exercise.listenNextIndex = 0;
    state.exercise.listenScoreStartTimeSeconds = EXERCISE_LISTEN_START_DELAY_SECONDS;
    state.exercise.listenEndTimeSeconds =
      EXERCISE_LISTEN_START_DELAY_SECONDS + exercise.durationSeconds;
    state.exercise.listenStartPerformanceMs = performance.now();
    state.exercise.sheetCursorIndex = -1;
    hideExerciseSheetCursor();
    updateExerciseCaptureUi();

    window.clearInterval(state.exercise.listenTimer);
    state.exercise.listenTimer = window.setInterval(
      scheduleExerciseListen,
      EXERCISE_GUIDE_INTERVAL_MS
    );
    scheduleExerciseListen();
    requestRender();

    void ensureMetronomeContext()
      .then(() => {
        if (state.exercise.listening) {
          scheduleExerciseListen();
        }
      })
      .catch((error) => {
        if (state.exercise.listening) {
          stopExerciseListen();
          setMessage(error.message);
        }
      });
  } catch (error) {
    stopExerciseListen();
    setMessage(error.message);
  }
}

function prepareExerciseSession() {
  const exercise = state.exercise.loaded;
  if (!exercise) {
    throw new Error("Load an exercise first.");
  }

  const tapOffConfig = getExerciseTapOffConfig(exercise);
  const clickPlan = buildExerciseClickEvents(exercise, {
    startDelaySeconds: EXERCISE_START_DELAY_SECONDS,
    tapOffPattern: tapOffConfig.pattern,
    tapOffStepBeats: tapOffConfig.stepBeats,
  });
  const exercisePlaybackEvents = elements.exerciseGuideEnabledInput.checked
    ? clickPlan.expectedClicks
    : [];
  const metronomeGuideEvents = buildExerciseMetronomeGuideEvents(
    exercise,
    clickPlan.scoreStartTimeSeconds
  );
  state.exercise.scoreStartTimeSeconds = clickPlan.scoreStartTimeSeconds;
  state.exercise.sessionEndTimeSeconds = clickPlan.sessionEndTimeSeconds;
  state.exercise.guideEvents = [
    ...clickPlan.countInClicks,
    ...metronomeGuideEvents,
    ...exercisePlaybackEvents,
  ].sort((left, right) => left.timeSeconds - right.timeSeconds);
  state.exercise.guideNextIndex = 0;
  state.exercise.latestAnalysis = null;
  state.exercise.latestScoreRecord = null;
  hideExerciseReadyPrompt();
  state.hits = [];
  state.metronomeClicks = [];
  state.timelineFollowLive = true;
  state.exercise.timelineFollowLive = true;
  state.tempoSegments = [
    {
      startTimeSeconds: state.exercise.scoreStartTimeSeconds,
      startBeat: 0,
      bpm: exercise.tempoBpm,
    },
  ];
  updateStats();
  resetExerciseResultsUi();
  setExerciseRepStatus("Count-in");
}

async function startExerciseSimulation() {
  const exercise = state.exercise.loaded;
  const exerciseSessionId = state.exercise.activeSessionId;
  clearSimulationTimer();
  state.usingSimulation = true;
  state.sampleRate = 48_000;
  createDetector(state.sampleRate);
  state.exercise.simulator = new ExerciseTriggerSimulator({
    sampleRate: state.sampleRate,
    expectedHits: exercise.expectedHits,
    scoreStartTimeSeconds: state.exercise.scoreStartTimeSeconds,
  });
  elements.sampleRateValue.textContent = `${state.sampleRate} Hz`;

  const intervalMs = (SIMULATION_CHUNK_SIZE / state.sampleRate) * 1000;
  state.simulationTimer = window.setInterval(() => {
    if (
      exerciseSessionId !== state.exercise.activeSessionId ||
      exerciseSessionId !== state.exercise.sessionId ||
      !state.exercise.running
    ) {
      return;
    }

    const chunk = state.exercise.simulator.generateChunk(SIMULATION_CHUNK_SIZE);
    processChunk(chunk, { exerciseSessionId });
  }, intervalMs);
}

async function startExerciseLiveCapture(deviceId) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support microphone capture.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId && deviceId !== "default" ? { exact: deviceId } : undefined,
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    video: false,
  });

  const AudioContextClass = getAudioContextClass();
  if (!AudioContextClass) {
    throw new Error("This browser does not expose AudioContext.");
  }

  const audioContext = new AudioContextClass({ latencyHint: "interactive" });
  await audioContext.resume();

  if (!audioContext.createScriptProcessor) {
    throw new Error("This browser does not expose ScriptProcessorNode.");
  }

  state.audioContext = audioContext;
  state.stream = stream;
  state.sampleRate = audioContext.sampleRate;
  createDetector(state.sampleRate);
  elements.sampleRateValue.textContent = `${state.sampleRate} Hz`;

  const sourceNode = audioContext.createMediaStreamSource(stream);
  const processorNode = audioContext.createScriptProcessor(256, 1, 1);
  const muteNode = audioContext.createGain();
  muteNode.gain.value = 0;

  const exerciseSessionId = state.exercise.activeSessionId;
  processorNode.onaudioprocess = (event) => {
    if (
      exerciseSessionId !== state.exercise.activeSessionId ||
      exerciseSessionId !== state.exercise.sessionId ||
      !state.exercise.running
    ) {
      event.outputBuffer.getChannelData(0).fill(0);
      return;
    }

    const chunk = new Float32Array(event.inputBuffer.getChannelData(0));
    processChunk(chunk, { exerciseSessionId });
    event.outputBuffer.getChannelData(0).fill(0);
  };

  sourceNode.connect(processorNode);
  processorNode.connect(muteNode);
  muteNode.connect(audioContext.destination);

  state.sourceNode = sourceNode;
  state.processorNode = processorNode;
  state.muteNode = muteNode;
}

async function startExerciseSession() {
  if (
    state.exercise.starting ||
    state.exercise.stopping ||
    state.exercise.resultOverlayOpen ||
    state.running ||
    state.exercise.running
  ) {
    return;
  }

  closeExerciseResultOverlay({ save: true });
  hardResetExerciseRuntime({ advanceSession: true });
  state.exercise.starting = true;
  const exerciseSessionId = state.exercise.sessionId;
  state.exercise.activeSessionId = exerciseSessionId;
  updateExerciseCaptureUi();
  setMessage("");
  try {
    await stopMetronome({ closeContext: true });
    if (exerciseSessionId !== state.exercise.sessionId) {
      state.exercise.starting = false;
      if (state.exercise.activeSessionId === exerciseSessionId) {
        state.exercise.activeSessionId = null;
      }
      updateExerciseCaptureUi();
      return;
    }
    state.exercise.pendingScoreRecord = null;
    state.exercise.latestScoreRecord = null;
    state.exercise.latestAnalysis = null;
    elements.exerciseTempoInput.value = String(getMetronomeTempo());
    updateExerciseFromTempoInput();
    prepareExerciseSession();
    if (exerciseSessionId !== state.exercise.sessionId) {
      state.exercise.starting = false;
      if (state.exercise.activeSessionId === exerciseSessionId) {
        state.exercise.activeSessionId = null;
      }
      updateExerciseCaptureUi();
      return;
    }
    state.suppressTimelineScrollEvent = true;
    state.exercise.suppressTimelineScrollEvent = true;
    elements.timelineScroll.scrollLeft = 0;
    elements.exerciseTimelineScroll.scrollLeft = 0;

    const selectedDevice = elements.exerciseDeviceSelect.value || elements.deviceSelect.value;
    elements.deviceSelect.value = selectedDevice;

    if (selectedDevice === "simulated") {
      await startExerciseSimulation();
    } else {
      await startExerciseLiveCapture(selectedDevice);
      await refreshDeviceList();
    }
    if (exerciseSessionId !== state.exercise.sessionId) {
      await stopCapture({ finalizeExercise: false, exerciseSessionId });
      state.exercise.starting = false;
      if (state.exercise.activeSessionId === exerciseSessionId) {
        state.exercise.activeSessionId = null;
      }
      updateExerciseCaptureUi();
      return;
    }

    const guideContext = await ensureMetronomeContext();
    await guideContext.resume();
    if (exerciseSessionId !== state.exercise.sessionId) {
      await stopCapture({ finalizeExercise: false, exerciseSessionId });
      state.exercise.starting = false;
      if (state.exercise.activeSessionId === exerciseSessionId) {
        state.exercise.activeSessionId = null;
      }
      updateExerciseCaptureUi();
      return;
    }

    initializeSessionClock();
    state.exercise.guideAudioStartTime = guideContext.currentTime;
    state.running = true;
    state.exercise.running = true;
    updateCaptureStatus("Running exercise rep");
    state.exercise.starting = false;
    setRunningUi(true);
    updateExerciseCaptureUi();
    setMessage("Exercise rep is active. Listen to the count-in, then play the written rhythm.", false);
    await startExerciseGuide();
    clearExerciseCompletionTimer();
    const completionDelayMs = Math.max(
      0,
      (state.exercise.sessionEndTimeSeconds + 0.55 - getCurrentSessionElapsedSeconds()) * 1000
    );
    state.exercise.completionTimer = window.setTimeout(() => {
      void completeExerciseSession(exerciseSessionId);
    }, completionDelayMs);
    requestRender();
  } catch (error) {
    clearExerciseCompletionTimer();
    state.exercise.starting = false;
    state.exercise.running = false;
    if (state.exercise.activeSessionId === exerciseSessionId) {
      state.exercise.activeSessionId = null;
    }
    await stopCapture();
    updateExerciseCaptureUi();
    setExerciseRepStatus("Ready");
    setMessage(error.message);
  }
}

function updateExerciseLiveAnalysis() {
  const exercise = state.exercise.loaded;
  if (!exercise) {
    return;
  }

  state.exercise.latestAnalysis = matchExercisePerformance(exercise, state.hits, {
    scoreStartTimeSeconds: state.exercise.scoreStartTimeSeconds,
  });
  updateExerciseAnalysisUi();
}

async function completeExerciseSession(exerciseSessionId = state.exercise.sessionId) {
  if (
    exerciseSessionId !== state.exercise.sessionId ||
    exerciseSessionId !== state.exercise.activeSessionId ||
    state.exercise.completedSessionIds.has(exerciseSessionId) ||
    state.exercise.stopping ||
    (!state.exercise.running && !state.running)
  ) {
    return;
  }

  clearExerciseCompletionTimer();
  state.exercise.completedSessionIds.add(exerciseSessionId);
  state.exercise.stopping = true;
  updateExerciseLiveAnalysis();
  const analysis = state.exercise.latestAnalysis;
  const record = analysis
    ? {
        exerciseId: state.exercise.loaded.id,
        exerciseTitle: state.exercise.loaded.title,
        tempoBpm: state.exercise.loaded.tempoBpm,
        score: analysis.score,
        dateIso: new Date().toISOString(),
        stats: analysis.stats,
      }
    : null;

  state.exercise.running = false;
  state.exercise.simulator = null;
  state.exercise.activeSessionId = null;
  stopExerciseGuide();
  hideExerciseReadyPrompt();
  await stopCapture({ finalizeExercise: false, exerciseSessionId });

  if (exerciseSessionId !== state.exercise.sessionId || state.exercise.starting) {
    return;
  }

  state.exercise.stopping = false;
  if (analysis && record) {
    state.exercise.pendingScoreRecord = record;
    state.exercise.pendingScoreAnalysis = analysis;
    state.exercise.resultSessionId = exerciseSessionId;
    openExerciseResultOverlay(analysis);
    setExerciseRepStatus("Complete");
  } else {
    setExerciseRepStatus("Stopped");
  }
  updateExerciseCaptureUi();
  requestRender();
}

async function stopExerciseSession() {
  if (state.exercise.stopping || (!state.exercise.running && !state.running)) {
    return;
  }

  await completeExerciseSession(state.exercise.sessionId);
}

async function startSimulation() {
  state.usingSimulation = true;
  state.sampleRate = 48_000;
  initializeSessionClock();
  resetTempoSegments();
  resetAccentPattern();
  createFreshSimulator();
  createDetector(state.sampleRate);
  state.hits = [];
  state.metronomeClicks = [];
  updateStats();
  updateDebugReadouts();
  state.suppressTimelineScrollEvent = true;
  elements.timelineScroll.scrollLeft = 0;

  state.running = true;
  state.timelineFollowLive = true;
  elements.sampleRateValue.textContent = `${state.sampleRate} Hz`;
  updateCaptureStatus("Running simulated source");
  setRunningUi(true);
  setMessage("Simulation mode is active. This is useful for timing and detector tuning.", false);
  await startMetronome();
  const intervalMs = (SIMULATION_CHUNK_SIZE / state.sampleRate) * 1000;
  clearSimulationTimer();
  state.simulationTimer = window.setInterval(() => {
    const chunk = state.simulator.generateChunk(SIMULATION_CHUNK_SIZE);
    processChunk(chunk);
  }, intervalMs);
  requestRender();
}

async function startLiveCapture(
  deviceId,
  {
    startSessionMetronome = true,
    statusText = "Listening to live input",
    messageText = "Live capture is active. Compare the hit lane against the metronome lane to judge timing.",
  } = {}
) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support microphone capture.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId && deviceId !== "default" ? { exact: deviceId } : undefined,
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    video: false,
  });

  const AudioContextClass = getAudioContextClass();
  if (!AudioContextClass) {
    throw new Error("This browser does not expose AudioContext.");
  }

  const audioContext = new AudioContextClass({
    latencyHint: "interactive",
  });
  await audioContext.resume();

  if (!audioContext.createScriptProcessor) {
    throw new Error("This browser does not expose ScriptProcessorNode.");
  }

  state.audioContext = audioContext;
  state.stream = stream;
  state.sampleRate = audioContext.sampleRate;
  initializeSessionClock();
  resetTempoSegments();
  resetAccentPattern();
  createDetector(state.sampleRate);
  state.hits = [];
  state.metronomeClicks = [];
  updateStats();
  updateDebugReadouts();
  state.suppressTimelineScrollEvent = true;
  elements.timelineScroll.scrollLeft = 0;

  const sourceNode = audioContext.createMediaStreamSource(stream);
  const processorNode = audioContext.createScriptProcessor(256, 1, 1);
  const muteNode = audioContext.createGain();
  muteNode.gain.value = 0;

  processorNode.onaudioprocess = (event) => {
    const chunk = new Float32Array(event.inputBuffer.getChannelData(0));
    processChunk(chunk);
    event.outputBuffer.getChannelData(0).fill(0);
  };

  sourceNode.connect(processorNode);
  processorNode.connect(muteNode);
  muteNode.connect(audioContext.destination);

  state.sourceNode = sourceNode;
  state.processorNode = processorNode;
  state.muteNode = muteNode;
  state.running = true;
  state.timelineFollowLive = true;

  elements.sampleRateValue.textContent = `${state.sampleRate} Hz`;
  updateCaptureStatus(statusText);
  setRunningUi(true);
  setMessage(messageText, false);

  await refreshDeviceList();
  if (startSessionMetronome) {
    await startMetronome();
  }
  requestRender();
}

async function startCapture() {
  if (state.running) {
    return;
  }

  setMessage("");
  const selectedDevice = elements.deviceSelect.value;

  try {
    stopExerciseListen();
    if (selectedDevice === "simulated") {
      await startSimulation();
    } else {
      await startLiveCapture(selectedDevice);
    }
  } catch (error) {
    await stopCapture();
    updateCaptureStatus("Idle");
    setRunningUi(false);
    setMessage(
      `${error.message} Run the app from http://localhost and allow microphone access when prompted.`
    );
  }
}

async function stopCapture({ finalizeExercise = true, exerciseSessionId = state.exercise.sessionId } = {}) {
  const stopElapsedSeconds = getCurrentSessionElapsedSeconds();
  const wasCalibrationActive = state.calibration.active || state.calibration.finishing;
  const wasAutoDetectionActive = state.autoDetection.active;
  state.calibration.token += 1;
  state.calibration.active = false;
  state.calibration.finishing = false;
  state.autoDetection.token += 1;
  state.autoDetection.active = false;
  state.autoDetection.collector = null;
  state.autoDetection.startedCaptureForAutoTune = false;

  clearExerciseCompletionTimer();
  clearSimulationTimer();
  stopExerciseGuide();
  await stopMetronome({ closeContext: true });
  if (exerciseSessionId !== state.exercise.sessionId && state.exercise.running) {
    return;
  }

  if (state.processorNode) {
    state.processorNode.disconnect();
    state.processorNode.onaudioprocess = null;
    state.processorNode = null;
  }

  if (state.sourceNode) {
    state.sourceNode.disconnect();
    state.sourceNode = null;
  }

  if (state.muteNode) {
    state.muteNode.disconnect();
    state.muteNode = null;
  }

  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }

  if (state.audioContext) {
    const context = state.audioContext;
    state.audioContext = null;
    await context.close();
  }
  if (exerciseSessionId !== state.exercise.sessionId && state.exercise.running) {
    return;
  }

  state.running = false;
  state.usingSimulation = false;
  state.simulator = null;
  state.exercise.starting = false;
  state.exercise.stopping = false;
  if (exerciseSessionId === state.exercise.activeSessionId) {
    state.exercise.activeSessionId = null;
  }
  state.exercise.simulator = null;
  state.metronomeClicks = state.metronomeClicks.filter(
    (click) => click.timeSeconds <= stopElapsedSeconds + 0.002
  );

  elements.hitIndicator.classList.remove("active");
  window.clearTimeout(state.hitIndicatorTimeout);
  updateCaptureStatus(state.hits.length > 0 ? "Stopped" : "Idle");
  setRunningUi(false);

  if (state.calibration.savedSettings) {
    await applyMetronomeSettings(state.calibration.savedSettings, { resync: false });
    state.calibration.savedSettings = null;
  }
  if (wasCalibrationActive) {
    state.calibration.progressStartTimeSeconds = null;
    state.calibration.progressEndTimeSeconds = null;
    state.calibration.statusText = "Calibration cancelled";
    state.calibration.instructions =
      "Calibration ended because capture stopped before enough hits were collected.";
  }
  if (wasAutoDetectionActive) {
    state.autoDetection.phaseStartTimeSeconds = null;
    state.autoDetection.progressStartTimeSeconds = null;
    state.autoDetection.progressEndTimeSeconds = null;
    state.autoDetection.statusText = "Cancelled";
    state.autoDetection.instructions =
      "Auto detection setup ended because capture stopped before the measurement finished.";
  }
  updateMetronomeStatus();
  updateCalibrationUi();
  updateAutoDetectionUi();
  if (state.exercise.running) {
    state.exercise.running = false;
    state.exercise.stopping = false;
    state.exercise.simulator = null;
    hideExerciseSheetCursor();
    hideExerciseReadyPrompt();
    updateExerciseCaptureUi();
  }
  requestRender();
}

function exportCsv() {
  if (state.hits.length === 0) {
    return;
  }

  const rows = [
    [
      "index",
      "elapsed",
      "time_seconds",
      "raw_time_seconds",
      "latency_compensation_ms",
      "strength",
      "absolute_iso",
    ],
    ...state.hits.map((hit) => [
      hit.index,
      hit.elapsed,
      hit.timeSeconds.toFixed(6),
      hit.rawTimeSeconds.toFixed(6),
      state.latencyCompensationMs.toFixed(3),
      hit.strength.toFixed(6),
      hit.absoluteIso,
    ]),
  ];

  const csv = rows
    .map((row) =>
      row
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `snare-hits-${new Date().toISOString().replaceAll(":", "-")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function resizeCanvasToCssPixels(canvas, cssWidth, cssHeight) {
  const ratio = window.devicePixelRatio || 1;
  const safeWidth = Math.max(1, Math.floor(cssWidth));
  const safeHeight = Math.max(1, Math.floor(cssHeight));
  const targetWidth = Math.floor(safeWidth * ratio);
  const targetHeight = Math.floor(safeHeight * ratio);

  canvas.style.width = `${safeWidth}px`;
  canvas.style.height = `${safeHeight}px`;

  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }

  const context = canvas.getContext("2d");
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.scale(ratio, ratio);
  context.imageSmoothingEnabled = true;
  return context;
}

function resizeDebugCanvas(canvas = elements.debugCanvas) {
  if (!canvas) {
    return null;
  }

  const container = canvas.parentElement;
  const cssWidth = Math.max(
    180,
    Math.floor(container?.clientWidth || container?.getBoundingClientRect().width || 320)
  );
  const cssHeight = canvas === elements.debugCanvas && isTimelineFullscreen() ? 124 : 280;
  return resizeCanvasToCssPixels(canvas, cssWidth, cssHeight);
}

function resizeTimelineCanvas(
  canvas,
  viewportWidth,
  height,
  totalWidth,
  virtualWidthElement = elements.timelineVirtualWidth
) {
  const safeViewportWidth = Math.max(1, Math.floor(viewportWidth));
  const safeTotalWidth = Math.max(safeViewportWidth, Math.ceil(totalWidth));

  if (virtualWidthElement) {
    virtualWidthElement.style.width = `${safeTotalWidth}px`;
  }

  return resizeCanvasToCssPixels(canvas, safeViewportWidth, height);
}

function getFullscreenTimelineCanvasHeight(container) {
  const layoutHeight =
    elements.timelineLayout?.clientHeight ||
    elements.timelineLayout?.getBoundingClientRect().height ||
    0;
  if (!layoutHeight) {
    return Math.max(
      TIMELINE_HEIGHT,
      Math.min(TIMELINE_FULLSCREEN_HEIGHT, window.innerHeight - 190)
    );
  }

  const panelStyle = getComputedStyle(elements.timelinePanel);
  const headerStyle = getComputedStyle(elements.timelineHeader);
  const footerStyle = getComputedStyle(elements.timelineFooter);
  const scrollStyle = getComputedStyle(container);
  const fixedVerticalSpace =
    elements.timelineHeader.getBoundingClientRect().height +
    elements.timelineFooter.getBoundingClientRect().height +
    parseFloat(panelStyle.paddingTop || 0) +
    parseFloat(panelStyle.paddingBottom || 0) +
    parseFloat(headerStyle.marginBottom || 0) +
    parseFloat(footerStyle.marginTop || 0) +
    parseFloat(scrollStyle.paddingTop || 0) +
    parseFloat(scrollStyle.paddingBottom || 0);
  const availableHeight = layoutHeight - fixedVerticalSpace;
  return Math.max(1, Math.floor(availableHeight));
}

function drawGrid(context, width, height) {
  context.strokeStyle = "rgba(255, 255, 255, 0.08)";
  context.lineWidth = 1;

  for (let row = 1; row < 4; row += 1) {
    const y = (height / 4) * row;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  for (let column = 1; column < 8; column += 1) {
    const x = (width / 8) * column;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
}

function drawTimelineMarker(context, x, y, radius, color) {
  context.save();
  context.fillStyle = color;
  context.beginPath();
  context.ellipse(Math.round(x), Math.round(y), radius, radius, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawDebugHistory(canvas = elements.debugCanvas) {
  const context = resizeDebugCanvas(canvas);
  if (!context || !canvas) {
    return;
  }

  const width = parseFloat(canvas.style.width) || canvas.clientWidth || 960;
  const height = parseFloat(canvas.style.height) || 280;
  const history = state.detector?.debugHistory ?? [];

  context.clearRect(0, 0, width, height);
  drawGrid(context, width, height);

  if (history.length === 0) {
    return;
  }

  const padding = 18;
  const maxValue = Math.max(
    0.02,
    ...history.flatMap((item) => [item.rawPeak, item.filteredPeak, item.threshold])
  );
  const scaleY = (height - padding * 2) / maxValue;

  const lineForValue = (value) =>
    height - padding - clamp(value * scaleY, 0, height - padding * 2);

  const drawSeries = (getValue, strokeStyle, lineWidth = 2) => {
    context.beginPath();
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth;

    for (let index = 0; index < history.length; index += 1) {
      const x = padding + (index / Math.max(1, history.length - 1)) * (width - padding * 2);
      const y = lineForValue(getValue(history[index]));

      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }

    context.stroke();
  };

  drawSeries((item) => item.threshold, "#ffb86b", 2);
  drawSeries((item) => item.rawPeak, "#88d6ff", 2);
  drawSeries((item) => item.filteredPeak, "#73e0a9", 2.6);

  for (let index = 0; index < history.length; index += 1) {
    if (!history[index].triggered) {
      continue;
    }

    const x = padding + (index / Math.max(1, history.length - 1)) * (width - padding * 2);
    const y = lineForValue(history[index].filteredPeak);

    context.fillStyle = "#a8f2cd";
    context.beginPath();
    context.arc(x, y, 4.5, 0, Math.PI * 2);
    context.fill();
  }
}

function isNearlyMultiple(value, step) {
  return Math.abs(value / step - Math.round(value / step)) < 0.0001;
}

function getBeatLabelStep(pixelsPerBeat) {
  if (pixelsPerBeat >= 88) {
    return 1;
  }

  if (pixelsPerBeat >= 50) {
    return 2;
  }

  return 4;
}

function drawBeatGrid(
  context,
  fullSessionBeats,
  beatToX,
  topLaneTop,
  axisY,
  height,
  pixelsPerBeat,
  visibleStartBeat,
  visibleEndBeat
) {
  const subdivisionSteps = [];
  const selectedSubdivisionStep = getSubdivisionStepBeats();
  const labelStep = getBeatLabelStep(pixelsPerBeat);
  const measureBeats = getTimeSignature().numerator;

  subdivisionSteps.push(0.5);

  if (pixelsPerBeat >= 92) {
    subdivisionSteps.push(0.25);
  }

  if (pixelsPerBeat >= 168) {
    subdivisionSteps.push(0.125);
  }

  if (pixelsPerBeat >= 300) {
    subdivisionSteps.push(0.0625);
  }

  if (pixelsPerBeat >= 520) {
    subdivisionSteps.push(0.03125);
  }

  if (pixelsPerBeat >= 860) {
    subdivisionSteps.push(0.015625);
  }

  if (selectedSubdivisionStep < 0.5 && selectedSubdivisionStep * pixelsPerBeat >= 14) {
    subdivisionSteps.push(selectedSubdivisionStep);
  }

  const uniqueSubdivisionSteps = [...new Set(subdivisionSteps)]
    .filter((step) => step > 0 && step < 1)
    .sort((left, right) => left - right);

  for (const step of uniqueSubdivisionSteps) {
    const minIndex = Math.max(0, Math.floor(visibleStartBeat / step) - 1);
    const maxIndex = Math.min(
      Math.ceil(fullSessionBeats / step),
      Math.ceil(visibleEndBeat / step) + 1
    );
    for (let index = minIndex; index <= maxIndex; index += 1) {
      const beat = index * step;
      if (beat > fullSessionBeats + 0.0001) {
        continue;
      }

      if (isNearlyMultiple(beat, 1)) {
        continue;
      }

      const isEighth = isNearlyMultiple(beat, 0.5);
      const isSixteenth = isNearlyMultiple(beat, 0.25);
      const x = beatToX(beat);
      context.strokeStyle = isEighth
        ? "rgba(255,255,255,0.1)"
        : isSixteenth
          ? "rgba(255,255,255,0.075)"
          : "rgba(255,255,255,0.055)";
      context.lineWidth = isEighth ? 1.65 : isSixteenth ? 1.35 : 1.15;
      context.beginPath();
      context.moveTo(x, topLaneTop - 10);
      context.lineTo(x, axisY);
      context.stroke();
    }
  }

  const minWholeBeat = Math.max(0, Math.floor(visibleStartBeat) - 1);
  const maxWholeBeat = Math.min(Math.ceil(fullSessionBeats), Math.ceil(visibleEndBeat) + 1);
  for (let beat = minWholeBeat; beat <= maxWholeBeat; beat += 1) {
    const x = beatToX(beat);
    const isMeasureLine = beat % measureBeats === 0;
    context.strokeStyle = isMeasureLine ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.12)";
    context.lineWidth = isMeasureLine ? 2.2 : 1.8;
    context.beginPath();
    context.moveTo(x, topLaneTop - 10);
    context.lineTo(x, axisY);
    context.stroke();

    if (beat % labelStep === 0) {
      context.save();
      context.fillStyle = "rgba(243, 247, 251, 0.74)";
      context.font = "12px Avenir Next, sans-serif";
      context.textAlign = "center";
      context.fillText(String(beat), x, height - 8);
      context.restore();
    }
  }
}

function getLatestPastEventBeat(events, cutoffSeconds) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.timeSeconds <= cutoffSeconds) {
      return event.beatPosition ?? getBeatPositionAtTime(event.timeSeconds);
    }
  }

  return 0;
}

function getEventBeatPosition(event) {
  return event.beatPosition ?? getBeatPositionAtTime(event.timeSeconds);
}

function findFirstEventIndexAtOrAfterBeat(events, beatPosition) {
  let low = 0;
  let high = events.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (getEventBeatPosition(events[middle]) < beatPosition) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function getChunkedTimelineWidth(fullSessionBeats, pixelsPerBeat, viewportWidth, includeLiveBuffer) {
  const widthDrivingBeats = includeLiveBuffer
    ? fullSessionBeats + TIMELINE_LIVE_FOLLOW_BUFFER_BEATS
    : fullSessionBeats;
  const chunkedBeats =
    Math.ceil(Math.max(TIMELINE_MIN_BEATS, widthDrivingBeats) / TIMELINE_WIDTH_CHUNK_BEATS) *
    TIMELINE_WIDTH_CHUNK_BEATS;
  return Math.max(
    viewportWidth,
    Math.ceil(chunkedBeats * pixelsPerBeat) + TIMELINE_LEFT_PADDING + TIMELINE_RIGHT_PADDING
  );
}

function isTimelineNearLiveEdge() {
  const container = elements.timelineScroll;
  const remaining = container.scrollWidth - container.clientWidth - container.scrollLeft;
  return remaining < 56;
}

function updateJumpToLiveButton() {
  elements.jumpToLiveButton.hidden = state.timelineFollowLive;
}

function scrollTimelineToLive() {
  state.timelineFollowLive = true;
  const currentBeat = Math.max(0, getBeatPositionAtTime(getCurrentSessionElapsedSeconds()));
  const playheadX = TIMELINE_LEFT_PADDING + currentBeat * getPixelsPerBeat();
  followTimelinePlayhead(playheadX, getTimelineCanvasCssWidth());
  updateJumpToLiveButton();
}

function followTimelinePlayhead(playheadX, totalWidth) {
  state.suppressTimelineScrollEvent = true;
  const container = elements.timelineScroll;
  const viewportWidth = container.clientWidth || 0;
  const maxScrollLeft = Math.max(0, totalWidth - viewportWidth);
  const desiredScrollLeft = clamp(
    playheadX - viewportWidth * TIMELINE_FOLLOW_VIEWPORT_RATIO,
    0,
    maxScrollLeft
  );
  container.scrollLeft = desiredScrollLeft;
  updateJumpToLiveButton();
}

function followExerciseTimelinePlayhead(playheadX, totalWidth) {
  state.exercise.suppressTimelineScrollEvent = true;
  const container = elements.exerciseTimelineScroll;
  const viewportWidth = container.clientWidth || 0;
  const maxScrollLeft = Math.max(0, totalWidth - viewportWidth);
  const desiredScrollLeft = clamp(
    playheadX - viewportWidth * TIMELINE_FOLLOW_VIEWPORT_RATIO,
    0,
    maxScrollLeft
  );
  container.scrollLeft = desiredScrollLeft;
}

function setTimelineZoom(nextZoom) {
  const container = elements.timelineScroll;
  const previousPixelsPerBeat = getPixelsPerBeat();
  const centerBeat = Math.max(
    0,
    (container.scrollLeft + container.clientWidth / 2 - TIMELINE_LEFT_PADDING) / previousPixelsPerBeat
  );

  state.timelineZoom = nextZoom;
  updateTimelineZoomControls();

  window.requestAnimationFrame(() => {
    if (state.timelineFollowLive) {
      scrollTimelineToLive();
      requestRender();
      return;
    }

    const totalWidth = getTimelineCanvasCssWidth();
    const maxScrollLeft = Math.max(0, totalWidth - container.clientWidth);
    const desiredScrollLeft = clamp(
      TIMELINE_LEFT_PADDING + centerBeat * getPixelsPerBeat() - container.clientWidth / 2,
      0,
      maxScrollLeft
    );
    state.suppressTimelineScrollEvent = true;
    container.scrollLeft = desiredScrollLeft;
    updateJumpToLiveButton();
    requestRender();
  });
}

function nudgeTimelineZoom(direction) {
  const currentIndex = getTimelineZoomIndex();
  const nextIndex = clamp(currentIndex + direction, 0, TIMELINE_ZOOM_LEVELS.length - 1);
  if (nextIndex === currentIndex) {
    return;
  }

  setTimelineZoom(TIMELINE_ZOOM_LEVELS[nextIndex]);
}

async function toggleTimelineFullscreen() {
  if (!elements.timelineWorkspace) {
    return;
  }

  state.fullscreen.active = !state.fullscreen.active;
  state.fullscreen.dragType = null;
  if (!state.fullscreen.active) {
    state.fullscreen.sidebarCollapsed = false;
  }
  updateTimelineFullscreenButton();
}

function toggleFullscreenSidebar() {
  if (!isTimelineFullscreen()) {
    return;
  }

  state.fullscreen.sidebarCollapsed = !state.fullscreen.sidebarCollapsed;
  applyFullscreenWorkspaceState();
  requestRenderAfterLayoutTransition();
}

function startFullscreenResize(type, event) {
  if (!isTimelineFullscreen()) {
    return;
  }

  if (type === "sidebar" && state.fullscreen.sidebarCollapsed) {
    return;
  }

  state.fullscreen.dragType = type;
  state.fullscreen.dragStartX = event.clientX;
  state.fullscreen.dragStartY = event.clientY;
  state.fullscreen.dragStartSize =
    state.fullscreen.sidebarWidth;
  event.currentTarget?.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function handleFullscreenResize(event) {
  if (!state.fullscreen.dragType || !isTimelineFullscreen()) {
    return;
  }

  if (state.fullscreen.dragType === "sidebar") {
    const deltaX = state.fullscreen.dragStartX - event.clientX;
    state.fullscreen.sidebarWidth = clamp(state.fullscreen.dragStartSize + deltaX, 260, 760);
  }

  applyFullscreenWorkspaceState();
  requestRender();
}

function stopFullscreenResize() {
  if (state.fullscreen.dragType) {
    requestRender();
  }
  state.fullscreen.dragType = null;
}

function drawBeatTimeline() {
  const canvas = elements.timelineCanvas;
  const container = elements.timelineScroll;
  const viewportWidth = Math.max(320, Math.floor(container.getBoundingClientRect().width || 960));
  const currentElapsed = getCurrentSessionElapsedSeconds();
  const currentBeat = Math.max(0, getBeatPositionAtTime(currentElapsed));
  const renderedEventCutoffSeconds = currentElapsed + 0.002;
  const latestVisibleClickBeat = getLatestPastEventBeat(state.metronomeClicks, renderedEventCutoffSeconds);
  const latestVisibleHitBeat = getLatestPastEventBeat(state.hits, renderedEventCutoffSeconds);
  const widthDrivingHitBeat = state.usingSimulation ? 0 : latestVisibleHitBeat;
  const fullSessionBeats = Math.max(
    TIMELINE_MIN_BEATS,
    currentBeat,
    widthDrivingHitBeat,
    latestVisibleClickBeat
  );
  const pixelsPerBeat = getPixelsPerBeat();

  const totalWidth = getChunkedTimelineWidth(
    fullSessionBeats,
    pixelsPerBeat,
    viewportWidth,
    state.running && state.timelineFollowLive
  );
  const height = isTimelineFullscreen()
    ? getFullscreenTimelineCanvasHeight(container)
    : TIMELINE_HEIGHT;
  const context = resizeTimelineCanvas(canvas, viewportWidth, height, totalWidth);

  const verticalScale = height / TIMELINE_HEIGHT;
  const topLaneTop = 44 * verticalScale;
  const topLaneBottom = 132 * verticalScale;
  const bottomLaneTop = 176 * verticalScale;
  const bottomLaneBottom = 272 * verticalScale;
  const axisY = height - 28;
  const plotRightGlobal = totalWidth - TIMELINE_RIGHT_PADDING;
  const beatToGlobalX = (beatPosition) =>
    TIMELINE_LEFT_PADDING + Math.max(0, beatPosition) * pixelsPerBeat;
  const playheadGlobalX = beatToGlobalX(currentBeat);

  if (state.running && state.timelineFollowLive) {
    followTimelinePlayhead(playheadGlobalX, totalWidth);
  }

  const scrollLeft = clamp(
    container.scrollLeft || 0,
    0,
    Math.max(0, totalWidth - viewportWidth)
  );
  const renderPadding = 32;
  const visibleLeft = Math.max(0, scrollLeft - renderPadding);
  const visibleRight = Math.min(totalWidth, scrollLeft + viewportWidth + renderPadding);
  const visibleStartBeat = Math.max(0, (visibleLeft - TIMELINE_LEFT_PADDING) / pixelsPerBeat);
  const visibleEndBeat = Math.max(visibleStartBeat, (visibleRight - TIMELINE_LEFT_PADDING) / pixelsPerBeat);
  const globalToCanvasX = (globalX) => globalX - scrollLeft;
  const beatToX = (beatPosition) => globalToCanvasX(beatToGlobalX(beatPosition));

  context.clearRect(0, 0, viewportWidth, height);

  context.fillStyle = "rgba(255, 255, 255, 0.025)";
  const laneStartGlobal = Math.max(TIMELINE_LEFT_PADDING, visibleLeft);
  const laneEndGlobal = Math.min(plotRightGlobal, visibleRight);
  const laneWidth = Math.max(0, laneEndGlobal - laneStartGlobal);
  context.fillRect(
    globalToCanvasX(laneStartGlobal),
    topLaneTop,
    laneWidth,
    topLaneBottom - topLaneTop
  );
  context.fillRect(
    globalToCanvasX(laneStartGlobal),
    bottomLaneTop,
    laneWidth,
    bottomLaneBottom - bottomLaneTop
  );

  drawBeatGrid(
    context,
    fullSessionBeats,
    beatToX,
    topLaneTop,
    axisY,
    height,
    pixelsPerBeat,
    visibleStartBeat,
    visibleEndBeat
  );

  context.strokeStyle = "rgba(255,255,255,0.12)";
  context.beginPath();
  context.moveTo(globalToCanvasX(laneStartGlobal), topLaneBottom + 10);
  context.lineTo(globalToCanvasX(laneEndGlobal), topLaneBottom + 10);
  context.moveTo(globalToCanvasX(laneStartGlobal), bottomLaneTop - 12);
  context.lineTo(globalToCanvasX(laneEndGlobal), bottomLaneTop - 12);
  context.moveTo(globalToCanvasX(laneStartGlobal), axisY);
  context.lineTo(globalToCanvasX(laneEndGlobal), axisY);
  context.stroke();

  context.fillStyle = "rgba(243, 247, 251, 0.7)";
  context.font = "13px Avenir Next, sans-serif";
  context.fillText("Clicks", 16, 84 * verticalScale);
  context.fillText("Hits", 16, 228 * verticalScale);
  context.fillText("Beats", 16, height - 8);

  const clickStartIndex = findFirstEventIndexAtOrAfterBeat(
    state.metronomeClicks,
    visibleStartBeat - 0.25
  );
  for (let index = clickStartIndex; index < state.metronomeClicks.length; index += 1) {
    const click = state.metronomeClicks[index];
    if (click.timeSeconds > renderedEventCutoffSeconds) {
      break;
    }

    const globalX = beatToGlobalX(getEventBeatPosition(click));
    if (globalX < visibleLeft - 8) {
      continue;
    }
    if (globalX > visibleRight + 8 || globalX > plotRightGlobal + 1) {
      break;
    }
    const x = globalToCanvasX(globalX);

    const accentLevel = clamp(click.accentLevel ?? 0, 0, 2);
    const clickRadius = [3.6, 4.8, 5.8][accentLevel];
    const clickY = topLaneTop + 12;
    const clickColor = ["#ffb86b", "#ffd18a", "#fff0bf"][accentLevel];
    context.strokeStyle = clickColor;
    context.lineWidth = [1.5, 2.5, 3][accentLevel];
    context.beginPath();
    context.moveTo(x, clickY + clickRadius + 1);
    context.lineTo(x, topLaneBottom - 8);
    context.stroke();

    drawTimelineMarker(context, x, clickY, clickRadius, clickColor);
  }

  const hitStartIndex = findFirstEventIndexAtOrAfterBeat(state.hits, visibleStartBeat - 0.25);
  for (let index = hitStartIndex; index < state.hits.length; index += 1) {
    const hit = state.hits[index];
    if (hit.timeSeconds > renderedEventCutoffSeconds) {
      break;
    }

    const globalX = beatToGlobalX(getEventBeatPosition(hit));
    if (globalX < visibleLeft - 8) {
      continue;
    }
    if (globalX > visibleRight + 8 || globalX > plotRightGlobal + 1) {
      break;
    }
    const x = globalToCanvasX(globalX);

    const strengthHeight = clamp(hit.strength * 220, 22, bottomLaneBottom - bottomLaneTop - 18);
    const topY = bottomLaneBottom - 10 - strengthHeight;
    const hitRadius = 4.6;

    context.strokeStyle = "#73e0a9";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x, bottomLaneBottom - 10);
    context.lineTo(x, topY + hitRadius + 1);
    context.stroke();

    drawTimelineMarker(context, x, topY, hitRadius, "#73e0a9");
  }

  context.strokeStyle = "rgba(136, 214, 255, 0.9)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(globalToCanvasX(playheadGlobalX), topLaneTop - 12);
  context.lineTo(globalToCanvasX(playheadGlobalX), axisY);
  context.stroke();

  updateJumpToLiveButton();
}

function getExerciseCurrentBeat() {
  if (!state.exercise.loaded) {
    return 0;
  }

  const exerciseElapsed = getCurrentSessionElapsedSeconds() - state.exercise.scoreStartTimeSeconds;
  return Math.max(0, (exerciseElapsed * state.exercise.loaded.tempoBpm) / 60);
}

function isExerciseTimelineNearLiveEdge() {
  const container = elements.exerciseTimelineScroll;
  const remaining = container.scrollWidth - container.clientWidth - container.scrollLeft;
  return remaining < 56;
}

function drawExerciseTimeline() {
  const exercise = state.exercise.loaded;
  const canvas = elements.exerciseTimelineCanvas;
  const container = elements.exerciseTimelineScroll;
  if (!elements.exerciseTimelinePanel.open || !exercise || !canvas || !container) {
    return;
  }

  const viewportWidth = Math.max(320, Math.floor(container.getBoundingClientRect().width || 960));
  const pixelsPerBeat = getPixelsPerBeat();
  const currentBeat = getExerciseCurrentBeat();
  const latestHitBeat = state.hits.length
    ? Math.max(
        0,
        ((state.hits[state.hits.length - 1].timeSeconds - state.exercise.scoreStartTimeSeconds) *
          exercise.tempoBpm) /
          60
      )
    : 0;
  const fullBeats = Math.max(
    TIMELINE_MIN_BEATS,
    exercise.totalQuarterBeats,
    currentBeat,
    latestHitBeat
  );
  const totalWidth = getChunkedTimelineWidth(
    fullBeats,
    pixelsPerBeat,
    viewportWidth,
    state.exercise.running && state.exercise.timelineFollowLive
  );
  const height = EXERCISE_TIMELINE_HEIGHT;
  const context = resizeTimelineCanvas(
    canvas,
    viewportWidth,
    height,
    totalWidth,
    elements.exerciseTimelineVirtualWidth
  );
  const topLaneTop = 42;
  const topLaneBottom = 124;
  const bottomLaneTop = 170;
  const bottomLaneBottom = 252;
  const axisY = height - 28;
  const plotRightGlobal = totalWidth - TIMELINE_RIGHT_PADDING;
  const beatToGlobalX = (beatPosition) =>
    TIMELINE_LEFT_PADDING + Math.max(0, beatPosition) * pixelsPerBeat;
  const globalToCanvasX = (globalX) => globalX - (container.scrollLeft || 0);
  const beatToX = (beatPosition) => globalToCanvasX(beatToGlobalX(beatPosition));
  const playheadGlobalX = beatToGlobalX(currentBeat);

  if (state.exercise.running && state.exercise.timelineFollowLive) {
    followExerciseTimelinePlayhead(playheadGlobalX, totalWidth);
  }

  const scrollLeft = clamp(container.scrollLeft || 0, 0, Math.max(0, totalWidth - viewportWidth));
  const visibleLeft = Math.max(0, scrollLeft - 32);
  const visibleRight = Math.min(totalWidth, scrollLeft + viewportWidth + 32);
  const visibleStartBeat = Math.max(0, (visibleLeft - TIMELINE_LEFT_PADDING) / pixelsPerBeat);
  const visibleEndBeat = Math.max(visibleStartBeat, (visibleRight - TIMELINE_LEFT_PADDING) / pixelsPerBeat);
  const laneStartGlobal = Math.max(TIMELINE_LEFT_PADDING, visibleLeft);
  const laneEndGlobal = Math.min(plotRightGlobal, visibleRight);
  const laneWidth = Math.max(0, laneEndGlobal - laneStartGlobal);

  context.clearRect(0, 0, viewportWidth, height);
  context.fillStyle = "rgba(255, 255, 255, 0.025)";
  context.fillRect(globalToCanvasX(laneStartGlobal), topLaneTop, laneWidth, topLaneBottom - topLaneTop);
  context.fillRect(globalToCanvasX(laneStartGlobal), bottomLaneTop, laneWidth, bottomLaneBottom - bottomLaneTop);

  drawBeatGrid(
    context,
    fullBeats,
    beatToX,
    topLaneTop,
    axisY,
    height,
    pixelsPerBeat,
    visibleStartBeat,
    visibleEndBeat
  );

  context.strokeStyle = "rgba(255,255,255,0.12)";
  context.beginPath();
  context.moveTo(globalToCanvasX(laneStartGlobal), topLaneBottom + 10);
  context.lineTo(globalToCanvasX(laneEndGlobal), topLaneBottom + 10);
  context.moveTo(globalToCanvasX(laneStartGlobal), bottomLaneTop - 12);
  context.lineTo(globalToCanvasX(laneEndGlobal), bottomLaneTop - 12);
  context.moveTo(globalToCanvasX(laneStartGlobal), axisY);
  context.lineTo(globalToCanvasX(laneEndGlobal), axisY);
  context.stroke();

  context.fillStyle = "rgba(243, 247, 251, 0.7)";
  context.font = "13px Avenir Next, sans-serif";
  context.fillText("Score", 16, 82);
  context.fillText("You", 16, 220);
  context.fillText("Beats", 16, height - 8);

  const expectedStartIndex = findFirstEventIndexAtOrAfterBeat(
    exercise.expectedHits,
    visibleStartBeat - 0.25
  );
  for (let index = expectedStartIndex; index < exercise.expectedHits.length; index += 1) {
    const expected = exercise.expectedHits[index];
    const globalX = beatToGlobalX(expected.beatPosition);
    if (globalX > visibleRight + 8 || globalX > plotRightGlobal + 1) {
      break;
    }

    const x = globalToCanvasX(globalX);
    const accentLevel = clamp(expected.accentLevel ?? 0, 0, 2);
    const color = ["#ffb86b", "#ffd18a", "#fff0bf"][accentLevel];
    const radius = expected.strokeModifier === "diddle" ? 5.8 : [3.8, 4.8, 5.8][accentLevel];
    context.strokeStyle = color;
    context.lineWidth = expected.strokeModifier === "diddle" ? 3 : [1.6, 2.4, 3][accentLevel];
    context.beginPath();
    context.moveTo(x, topLaneTop + 18);
    context.lineTo(x, topLaneBottom - 8);
    context.stroke();
    drawTimelineMarker(context, x, topLaneTop + 12, radius, color);
  }

  for (const hit of state.hits) {
    const exerciseBeat = ((hit.timeSeconds - state.exercise.scoreStartTimeSeconds) * exercise.tempoBpm) / 60;
    if (exerciseBeat < visibleStartBeat - 0.25) {
      continue;
    }
    if (exerciseBeat > visibleEndBeat + 0.25) {
      break;
    }

    const x = beatToX(exerciseBeat);
    const strengthHeight = clamp(hit.strength * 180, 22, bottomLaneBottom - bottomLaneTop - 14);
    const topY = bottomLaneBottom - 8 - strengthHeight;
    context.strokeStyle = "#73e0a9";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x, bottomLaneBottom - 8);
    context.lineTo(x, topY + 5);
    context.stroke();
    drawTimelineMarker(context, x, topY, 4.8, "#73e0a9");
  }

  context.strokeStyle = "rgba(136, 214, 255, 0.9)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(globalToCanvasX(playheadGlobalX), topLaneTop - 12);
  context.lineTo(globalToCanvasX(playheadGlobalX), axisY);
  context.stroke();
}

function drawExerciseOffsetGraph() {
  const canvas = elements.exerciseOffsetCanvas;
  const exercise = state.exercise.loaded;
  if (!elements.exerciseOffsetPanel.open || !canvas || !exercise) {
    return;
  }

  const container = canvas.parentElement;
  const width = Math.max(320, getElementContentWidth(container, canvas.clientWidth || 720));
  const height = EXERCISE_OFFSET_GRAPH_HEIGHT;
  const context = resizeCanvasToCssPixels(canvas, width, height);
  const padding = { left: 50, right: 18, top: 18, bottom: 34 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const centerY = padding.top + plotHeight / 2;
  const maxOffsetMs = 60;
  const analysis = state.exercise.latestAnalysis;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "rgba(255, 255, 255, 0.025)";
  context.fillRect(padding.left, padding.top, plotWidth, plotHeight);

  for (const band of [-40, -20, 0, 20, 40]) {
    const y = centerY - (band / maxOffsetMs) * (plotHeight / 2);
    context.strokeStyle = band === 0 ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)";
    context.lineWidth = band === 0 ? 1.6 : 1;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillStyle = "rgba(243, 247, 251, 0.58)";
    context.font = "11px Avenir Next, sans-serif";
    context.textAlign = "right";
    context.fillText(`${band}`, padding.left - 8, y + 4);
  }

  if (!analysis) {
    context.fillStyle = "rgba(243, 247, 251, 0.62)";
    context.textAlign = "center";
    context.font = "13px Avenir Next, sans-serif";
    context.fillText("Timing offsets appear here during and after a rep.", width / 2, height / 2);
    return;
  }

  const points = analysis.matches
    .filter((match) => match.offsetMs !== null)
    .map((match) => ({
      x:
        padding.left +
        (match.expected.beatPosition / Math.max(1, exercise.totalQuarterBeats)) * plotWidth,
      y:
        centerY -
        (clamp(-match.offsetMs, -maxOffsetMs, maxOffsetMs) / maxOffsetMs) * (plotHeight / 2),
      displayOffsetMs: -match.offsetMs,
    }));

  if (points.length > 1) {
    context.strokeStyle = "rgba(115, 224, 169, 0.78)";
    context.lineWidth = 2.4;
    context.beginPath();
    points.forEach((point, index) => {
      if (index === 0) {
        context.moveTo(point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
      }
    });
    context.stroke();
  }

  for (const point of points) {
    const color =
      Math.abs(point.displayOffsetMs) <= 20
        ? "#73e0a9"
        : point.displayOffsetMs > 0
          ? "#ffb86b"
          : "#8ae8f3";
    drawTimelineMarker(context, point.x, point.y, 4.5, color);
  }

  context.fillStyle = "rgba(243, 247, 251, 0.66)";
  context.font = "12px Avenir Next, sans-serif";
  context.textAlign = "center";
  context.fillText("Beat position", padding.left + plotWidth / 2, height - 8);
  context.save();
  context.translate(14, padding.top + plotHeight / 2);
  context.rotate(-Math.PI / 2);
  context.fillText("Offset ms", 0, 0);
  context.restore();
}

function drawExerciseDynamicsGraph() {
  const canvas = elements.exerciseDynamicsCanvas;
  const exercise = state.exercise.loaded;
  if (!elements.exerciseDynamicsPanel.open || !canvas || !exercise) {
    return;
  }

  const container = canvas.parentElement;
  const width = Math.max(320, getElementContentWidth(container, canvas.clientWidth || 720));
  const height = EXERCISE_DYNAMICS_GRAPH_HEIGHT;
  const context = resizeCanvasToCssPixels(canvas, width, height);
  const padding = { left: 54, right: 18, top: 22, bottom: 38 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const baselineY = padding.top + plotHeight;
  const totalBeats = Math.max(1, Number(exercise.totalQuarterBeats) || 1);
  const beatToX = (beatPosition) =>
    padding.left + (clamp(Number(beatPosition) || 0, 0, totalBeats) / totalBeats) * plotWidth;

  const dynamicsPoints = state.hits
    .map((hit) => {
      const exerciseBeat =
        ((hit.timeSeconds - state.exercise.scoreStartTimeSeconds) * exercise.tempoBpm) / 60;
      return {
        beatPosition: exerciseBeat,
        strength: Number(hit.strength) || 0,
      };
    })
    .filter(
      (point) =>
        Number.isFinite(point.beatPosition) &&
        point.beatPosition >= -0.001 &&
        point.beatPosition <= totalBeats + 0.001 &&
        point.strength > 0
    )
    .sort((left, right) => left.beatPosition - right.beatPosition);
  const strengths = dynamicsPoints.map((point) => point.strength);
  const maxObservedStrength = strengths.length ? Math.max(...strengths) : 0;
  const scaleMax = Math.max(
    0.08,
    maxObservedStrength * 1.06,
    (percentile(strengths, 0.92) ?? 0) * 1.18
  );
  const strengthToY = (strength) =>
    baselineY - (clamp(strength / scaleMax, 0, 1) * plotHeight);

  context.clearRect(0, 0, width, height);
  const panelGradient = context.createLinearGradient(0, padding.top, 0, baselineY);
  panelGradient.addColorStop(0, "rgba(115, 224, 169, 0.08)");
  panelGradient.addColorStop(1, "rgba(138, 232, 243, 0.025)");
  context.fillStyle = panelGradient;
  context.fillRect(padding.left, padding.top, plotWidth, plotHeight);

  const measureBeats = Math.max(1, exercise.timeSignature?.numerator ?? 4);
  for (let beat = 0; beat <= totalBeats + 0.0001; beat += 1) {
    const x = beatToX(beat);
    const isMeasure = Math.abs(beat % measureBeats) < 0.0001;
    context.strokeStyle = isMeasure ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.055)";
    context.lineWidth = isMeasure ? 1.2 : 1;
    context.beginPath();
    context.moveTo(x, padding.top);
    context.lineTo(x, baselineY);
    context.stroke();
  }

  for (const percent of [0, 0.5, 1]) {
    const y = baselineY - percent * plotHeight;
    context.strokeStyle = percent === 0 ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.08)";
    context.lineWidth = percent === 0 ? 1.5 : 1;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillStyle = "rgba(243, 247, 251, 0.58)";
    context.font = "11px Avenir Next, sans-serif";
    context.textAlign = "right";
    context.fillText(`${Math.round(percent * 100)}%`, padding.left - 8, y + 4);
  }

  for (const expected of exercise.expectedHits) {
    const x = beatToX(expected.beatPosition);
    const accentLevel = clamp(expected.accentLevel ?? 0, 0, 2);
    const guideRatio = [0.32, 0.58, 0.9][accentLevel];
    const guideTopY = baselineY - guideRatio * plotHeight;
    context.strokeStyle = ["rgba(255, 209, 138, 0.10)", "rgba(255, 209, 138, 0.16)", "rgba(255, 184, 107, 0.24)"][accentLevel];
    context.lineWidth = [1, 1.6, 2.2][accentLevel];
    context.beginPath();
    context.moveTo(x, baselineY);
    context.lineTo(x, guideTopY);
    context.stroke();
  }

  if (dynamicsPoints.length === 0) {
    context.fillStyle = "rgba(243, 247, 251, 0.62)";
    context.textAlign = "center";
    context.font = "13px Avenir Next, sans-serif";
    context.fillText("Dynamics appear here as hits are detected during a rep.", width / 2, height / 2);
  } else {
    const plottedPoints = dynamicsPoints.map((point) => ({
      x: beatToX(point.beatPosition),
      y: strengthToY(point.strength),
      strength: point.strength,
    }));
    const areaGradient = context.createLinearGradient(0, padding.top, 0, baselineY);
    areaGradient.addColorStop(0, "rgba(115, 224, 169, 0.24)");
    areaGradient.addColorStop(1, "rgba(115, 224, 169, 0.015)");

    context.beginPath();
    plottedPoints.forEach((point, index) => {
      if (index === 0) {
        context.moveTo(point.x, baselineY);
        context.lineTo(point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
      }
    });
    context.lineTo(plottedPoints[plottedPoints.length - 1].x, baselineY);
    context.closePath();
    context.fillStyle = areaGradient;
    context.fill();

    context.strokeStyle = "rgba(115, 224, 169, 0.9)";
    context.lineWidth = 2.6;
    context.shadowColor = "rgba(115, 224, 169, 0.24)";
    context.shadowBlur = 10;
    context.lineJoin = "round";
    context.beginPath();
    plottedPoints.forEach((point, index) => {
      if (index === 0) {
        context.moveTo(point.x, point.y);
      } else {
        const previous = plottedPoints[index - 1];
        const midX = (previous.x + point.x) / 2;
        context.quadraticCurveTo(previous.x, previous.y, midX, (previous.y + point.y) / 2);
        context.quadraticCurveTo(point.x, point.y, point.x, point.y);
      }
    });
    context.stroke();
    context.shadowBlur = 0;

    const averageStrength =
      strengths.reduce((total, strength) => total + strength, 0) / Math.max(1, strengths.length);
    const averageY = strengthToY(averageStrength);
    context.setLineDash([5, 5]);
    context.strokeStyle = "rgba(138, 232, 243, 0.42)";
    context.lineWidth = 1.4;
    context.beginPath();
    context.moveTo(padding.left, averageY);
    context.lineTo(width - padding.right, averageY);
    context.stroke();
    context.setLineDash([]);

    for (const point of plottedPoints) {
      drawTimelineMarker(context, point.x, point.y, 4.2, "rgba(115, 224, 169, 0.95)");
    }

    context.fillStyle = "rgba(243, 247, 251, 0.64)";
    context.textAlign = "right";
    context.font = "12px Avenir Next, sans-serif";
    context.fillText(
      `Peak ${Math.round((maxObservedStrength / scaleMax) * 100)}% of graph range`,
      width - padding.right,
      padding.top - 6
    );
  }

  context.fillStyle = "rgba(243, 247, 251, 0.66)";
  context.font = "12px Avenir Next, sans-serif";
  context.textAlign = "center";
  context.fillText("Beat position", padding.left + plotWidth / 2, height - 10);
  context.save();
  context.translate(15, padding.top + plotHeight / 2);
  context.rotate(-Math.PI / 2);
  context.fillText("Relative strength", 0, 0);
  context.restore();
}

function renderFrame() {
  state.animationFrameId = 0;
  updateCalibrationProgress();
  updateCalibrationProgressUi();
  updateAutoDetectionCalibration();
  updateExerciseSheetProgress();
  updateExerciseReadyPrompt();
  drawInlineExerciseTendencies();
  drawInlineExerciseDynamics();
  drawBeatTimeline();
  drawExerciseTimeline();
  drawExerciseOffsetGraph();
  drawExerciseDynamicsGraph();
  if (!elements.repGraphOverlay.hidden && state.activeRepGraphRecord) {
    drawActiveRepGraph();
  }
  if (!elements.exerciseHeatmapOverlay.hidden && state.activeHeatmap) {
    drawExerciseHeatmap();
  }
  if (
    elements.debugPanel.open &&
    !elements.debugHomeHost.hidden &&
    !(isTimelineFullscreen() && state.fullscreen.sidebarCollapsed)
  ) {
    drawDebugHistory(elements.debugCanvas);
  }
  if (elements.settingsDebugPanel?.open && !elements.calibrationOverlay.hidden) {
    drawDebugHistory(elements.settingsDebugCanvas);
  }
  if (elements.autoTuneDebugPanel?.open && !elements.autoTuneOverlay.hidden) {
    drawDebugHistory(elements.autoTuneDebugCanvas);
  }
  updateDebugReadouts();

  if (state.exercise.running) {
    const currentElapsed = getCurrentSessionElapsedSeconds();
    if (currentElapsed > state.exercise.sessionEndTimeSeconds + 0.55) {
      void completeExerciseSession(state.exercise.sessionId);
    }
  }

  if (shouldContinuouslyRender()) {
    requestRender();
  }
}

function getElementContentWidth(element, fallbackWidth = 720) {
  if (!element) {
    return fallbackWidth;
  }

  const styles = window.getComputedStyle(element);
  const horizontalPadding =
    (Number.parseFloat(styles.paddingLeft) || 0) + (Number.parseFloat(styles.paddingRight) || 0);
  return Math.max(1, Math.floor((element.clientWidth || fallbackWidth) - horizontalPadding));
}

async function handleTempoChange(rawValue) {
  syncTempoInputs(rawValue);
  const nextTempo = getMetronomeTempo();

  if (state.appMode === "exercise" && !state.exercise.running && !state.exercise.listening) {
    elements.exerciseTempoInput.value = String(nextTempo);
    updateExerciseFromTempoInput();
  }

  if (state.running && state.usingSimulation && state.simulator) {
    state.simulator.baseBpm = nextTempo;
  }

  if (state.running) {
    addTempoSegment(getCurrentSessionElapsedSeconds(), nextTempo);
    if (elements.metronomeEnabledInput.checked) {
      await resyncMetronomeSchedule();
    }
  }

  updateMetronomeStatus();
}

async function handleMetronomePatternChange({ resetAccents = false } = {}) {
  sanitizeMetronomeControls();
  if (resetAccents) {
    resetAccentPattern();
  } else {
    ensureAccentLevels();
  }
  renderAccentButtons();
  updateMetronomeStatus();

  if (state.running && elements.metronomeEnabledInput.checked) {
    await resyncMetronomeSchedule();
  }
}

async function handleCalibrationOverlayBack() {
  if (state.calibration.active || state.calibration.finishing) {
    await cancelCalibration();
  }
  closeCalibrationOverlay();
}

async function handleAutoTuneOverlayBack() {
  if (state.autoDetection.active) {
    await cancelAutoDetectionCalibration();
  }
  closeAutoTuneOverlay();
}

elements.startButton.addEventListener("click", () => {
  void startCapture();
});

elements.stopButton.addEventListener("click", () => {
  void stopCapture();
});

elements.refreshDevicesButton.addEventListener("click", () => {
  void refreshDeviceList();
});

elements.exportButton.addEventListener("click", () => {
  exportCsv();
});

elements.clearLogButton.addEventListener("click", () => {
  clearSessionData();
  if (!state.running) {
    setMessage("Session log cleared.", false);
  }
});

elements.jumpToLiveButton.addEventListener("click", () => {
  scrollTimelineToLive();
});

elements.timelineZoomOutButton.addEventListener("click", () => {
  nudgeTimelineZoom(-1);
});

elements.timelineZoomInButton.addEventListener("click", () => {
  nudgeTimelineZoom(1);
});

elements.timelineFullscreenButton.addEventListener("click", () => {
  void toggleTimelineFullscreen();
});

elements.metronomeCollapseButton.addEventListener("click", () => {
  toggleFullscreenSidebar();
});

elements.startCalibrationButton.addEventListener("click", () => {
  openCalibrationOverlay();
});

elements.startAutoTuneButton.addEventListener("click", () => {
  openCalibrationOverlay();
});

elements.acceptCalibrationButton.addEventListener("click", () => {
  void acceptCalibration();
});

elements.discardCalibrationButton.addEventListener("click", () => {
  void discardCalibration();
});

elements.resetCalibrationButton.addEventListener("click", () => {
  resetCalibrationOffset();
});

elements.nudgeCalibrationBackButton.addEventListener("click", () => {
  nudgeLatencyCompensation(-5);
});

elements.nudgeCalibrationForwardButton.addEventListener("click", () => {
  nudgeLatencyCompensation(5);
});

elements.calibrationScreenBackButton.addEventListener("click", () => {
  void handleCalibrationOverlayBack();
});

elements.calibrationScreenStartButton.addEventListener("click", () => {
  void startCalibration();
});

elements.autoTuneScreenStartButton.addEventListener("click", () => {
  void startAutoDetectionCalibration();
});

elements.cancelAutoTuneButton.addEventListener("click", () => {
  void handleAutoTuneOverlayBack();
});

elements.acceptAutoTuneButton.addEventListener("click", () => {
  applyAutoDetectionResult();
});

elements.discardAutoTuneButton.addEventListener("click", () => {
  discardAutoDetectionResult();
});

elements.resetDetectionDefaultsButton.addEventListener("click", () => {
  resetDetectionDefaults();
});

elements.liveModeButton.addEventListener("click", () => {
  setAppMode("live");
});

elements.exerciseModeButton.addEventListener("click", () => {
  setAppMode("exercise");
});

elements.settingsModeButton.addEventListener("click", () => {
  setAppMode("settings");
});

elements.statsModeButton.addEventListener("click", () => {
  setAppMode("stats");
});

elements.deviceSelect.addEventListener("change", () => {
  syncAudioDeviceSelection(elements.deviceSelect.value);
});

elements.exerciseDeviceSelect.addEventListener("change", () => {
  syncAudioDeviceSelection(elements.exerciseDeviceSelect.value);
});

elements.calibrationDeviceSelect.addEventListener("change", () => {
  state.calibration.overlaySourceSelected = true;
  syncAudioDeviceSelection(elements.calibrationDeviceSelect.value);
  updateCalibrationUi();
});

elements.autoTuneDeviceSelect.addEventListener("change", () => {
  syncAudioDeviceSelection(elements.autoTuneDeviceSelect.value);
});

elements.exerciseSelect.addEventListener("input", loadSelectedExerciseFromControl);
elements.exerciseSelect.addEventListener("change", loadSelectedExerciseFromControl);

elements.exerciseUploadInput.addEventListener("change", () => {
  const file = elements.exerciseUploadInput.files?.[0];
  if (!file) {
    return;
  }

  void getMusicXmlTextFromFile(file)
    .then((xmlText) => loadExerciseXml(xmlText, file.name))
    .then(() => {
      const uploadedId = `uploaded-${Date.now()}`;
      state.exercise.uploadedExercises.set(uploadedId, {
        fileName: file.name,
        xmlText: state.exercise.sourceXmlText,
      });
      const option = document.createElement("option");
      option.value = uploadedId;
      option.textContent = file.name.replace(/\.[^.]+$/, "");
      elements.exerciseSelect.append(option);
      elements.exerciseSelect.value = option.value;
      state.exercise.selectedExerciseId = uploadedId;
      state.exercise.selectionRequestId = uploadedId;
      setMessage(`Loaded ${file.name}.`, false);
    })
    .catch((error) => {
      setMessage(error.message);
    })
    .finally(() => {
      elements.exerciseUploadInput.value = "";
    });
});

elements.exerciseTempoInput.addEventListener("change", () => {
  commitExerciseTempo(elements.exerciseTempoInput.value);
});

elements.exerciseTempoInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  commitExerciseTempo(elements.exerciseTempoInput.value);
  elements.exerciseTempoInput.blur();
});

elements.exerciseStartButton.addEventListener("click", () => {
  void startExerciseSession();
});

elements.exerciseListenButton.addEventListener("click", () => {
  if (state.exercise.listening) {
    stopExerciseListen();
    return;
  }

  void startExerciseListen();
});

elements.exerciseTendenciesButton.addEventListener("click", () => {
  if (elements.exerciseTendenciesButton.disabled) {
    return;
  }

  state.exercise.tendenciesVisible = !state.exercise.tendenciesVisible;
  updateExerciseTendenciesButton();
  if (!state.exercise.tendenciesVisible) {
    clearInlineExerciseTendencies();
  }
  requestRender();
});

elements.exerciseDynamicsToggleButton.addEventListener("click", () => {
  if (elements.exerciseDynamicsToggleButton.disabled) {
    return;
  }

  state.exercise.dynamicsVisible = !state.exercise.dynamicsVisible;
  updateExerciseDynamicsToggleButton();
  if (!state.exercise.dynamicsVisible) {
    clearInlineExerciseDynamics();
  }
  requestRender();
});

elements.exerciseStopButton.addEventListener("click", () => {
  void stopExerciseSession();
});

elements.exerciseTimelinePanel.addEventListener("toggle", () => {
  updateExercisePanelVisibility();
});

elements.exerciseOffsetPanel.addEventListener("toggle", () => {
  updateExercisePanelVisibility();
});

elements.exerciseDynamicsPanel.addEventListener("toggle", () => {
  updateExercisePanelVisibility();
});

elements.exerciseGuideToggleButton.addEventListener("click", () => {
  if (elements.exerciseGuideToggleButton.disabled) {
    return;
  }

  elements.exerciseGuideEnabledInput.checked = !elements.exerciseGuideEnabledInput.checked;
  updateExerciseGuideToggleUi();
});

elements.exerciseStatsList.addEventListener("click", (event) => {
  const tendenciesButton = event.target.closest("button[data-exercise-tendencies-id]");
  if (!tendenciesButton) {
    return;
  }

  void openExerciseHeatmapOverlayForExercise(tendenciesButton.dataset.exerciseTendenciesId);
});

elements.sessionHistoryList.addEventListener("click", (event) => {
  const graphButton = event.target.closest("button[data-rep-id][data-rep-graph-type]");
  if (!graphButton) {
    return;
  }

  const record = state.exercise.repHistory.find((rep) => rep.id === graphButton.dataset.repId);
  if (record) {
    openRepGraphOverlay(record, graphButton.dataset.repGraphType);
  }
});

elements.clearRepHistoryButton.addEventListener("click", () => {
  state.exercise.repHistory = [];
  saveExerciseRepHistory();
  renderSessionHistory();
  renderStatsPage();
  updateExerciseTendenciesButton();
  updateExerciseDynamicsToggleButton();
  requestRender();
});

elements.exerciseResultOverlay.addEventListener("click", () => {
  closeExerciseResultOverlay();
});

elements.exerciseResultCloseButton.addEventListener("click", (event) => {
  event.stopPropagation();
  closeExerciseResultOverlay();
});

elements.repGraphOverlay.addEventListener("click", () => {
  closeRepGraphOverlay();
});

elements.repGraphCloseButton.addEventListener("click", (event) => {
  event.stopPropagation();
  closeRepGraphOverlay();
});

elements.exerciseHeatmapOverlay.addEventListener("click", (event) => {
  if (event.target === elements.exerciseHeatmapOverlay) {
    closeExerciseHeatmapOverlay();
  }
});

elements.exerciseHeatmapCloseButton.addEventListener("click", (event) => {
  event.stopPropagation();
  closeExerciseHeatmapOverlay();
});

elements.exerciseHeatmapMarkerLayer.addEventListener("click", (event) => {
  event.stopPropagation();
  const marker = getHeatmapMarkerAtEvent(event);
  setHeatmapDetails(marker?.target ?? null);
});

elements.exerciseHeatmapMarkerLayer.addEventListener("mousemove", (event) => {
  const marker = getHeatmapMarkerAtEvent(event);
  elements.exerciseHeatmapMarkerLayer.style.cursor = marker ? "pointer" : "default";
});

elements.timelineScroll.addEventListener("scroll", () => {
  if (state.suppressTimelineScrollEvent) {
    state.suppressTimelineScrollEvent = false;
    updateJumpToLiveButton();
    requestRender();
    return;
  }

  state.timelineFollowLive = isTimelineNearLiveEdge();
  updateJumpToLiveButton();
  requestRender();
});

elements.exerciseTimelineScroll.addEventListener("scroll", () => {
  if (state.exercise.suppressTimelineScrollEvent) {
    state.exercise.suppressTimelineScrollEvent = false;
    requestRender();
    return;
  }

  state.exercise.timelineFollowLive = isExerciseTimelineNearLiveEdge();
  requestRender();
});

elements.metronomeResizeHandle.addEventListener("pointerdown", (event) => {
  startFullscreenResize("sidebar", event);
});

window.addEventListener("pointermove", (event) => {
  handleFullscreenResize(event);
});

window.addEventListener("pointerup", () => {
  stopFullscreenResize();
});

window.addEventListener("resize", () => {
  positionAccentPatternPopover();
});

document.addEventListener("click", () => {
  closeAccentPatternPopover();
});

[elements.thresholdInput, elements.refractoryInput, elements.smoothingInput].forEach((control) => {
  control.addEventListener("input", () => {
    updateDetectorFromControls();
  });
});

elements.metronomeVolumeInput.addEventListener("input", () => {
  updateMetronomeVolumeFromControl();
});

elements.metronomeTempoInput.addEventListener("input", () => {
  void handleTempoChange(elements.metronomeTempoInput.value);
});

elements.metronomeTempoNumber.addEventListener("change", () => {
  void commitMetronomeTempo(elements.metronomeTempoNumber.value);
});

elements.metronomeTempoNumber.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  void commitMetronomeTempo(elements.metronomeTempoNumber.value);
  elements.metronomeTempoNumber.blur();
});

elements.metronomeSubdivisionSelect.addEventListener("change", () => {
  void handleMetronomePatternChange({ resetAccents: true });
});

elements.accentPatternButton.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleAccentPatternPopover();
});

elements.accentPatternPopover.addEventListener("click", (event) => {
  event.stopPropagation();
});

elements.metronomeAccentButtons.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-step-index]");
  if (!button) {
    return;
  }

  const stepIndex = Number(button.dataset.stepIndex);
  state.metronomeAccentLevels[stepIndex] = (clamp(state.metronomeAccentLevels[stepIndex] ?? 0, 0, 2) + 1) % 3;
  renderAccentButtons();
  if (state.running && elements.metronomeEnabledInput.checked) {
    void resyncMetronomeSchedule();
  }
});

elements.metronomeNumeratorInput.addEventListener("input", () => {
  void handleMetronomePatternChange({ resetAccents: true });
});

elements.metronomeDenominatorSelect.addEventListener("change", () => {
  void handleMetronomePatternChange({ resetAccents: true });
});

elements.metronomeEnabledInput.addEventListener("change", () => {
  updateMetronomeStatus();
  if (!state.running) {
    return;
  }

  if (elements.metronomeEnabledInput.checked) {
    void startMetronome();
  } else {
    void stopMetronome({ closeContext: true });
  }
});

window.addEventListener("beforeunload", () => {
  window.cancelAnimationFrame(state.animationFrameId);
  state.animationFrameId = 0;
  stopExerciseListen();
  void stopCapture();
});

if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", () => {
    if (!state.running) {
      void refreshDeviceList();
    }
  });
}

window.addEventListener("resize", () => {
  rerenderExerciseSheet();
  drawExerciseHeatmap();
  requestRender();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.accentPatternPopover.hidden) {
    closeAccentPatternPopover();
    return;
  }

  if (!elements.repGraphOverlay.hidden) {
    closeRepGraphOverlay();
    return;
  }

  if (!elements.exerciseHeatmapOverlay.hidden) {
    closeExerciseHeatmapOverlay();
    return;
  }

  if (state.exercise.resultOverlayOpen) {
    closeExerciseResultOverlay();
    return;
  }

  if (event.key !== "Escape" || !isTimelineFullscreen()) {
    return;
  }
  state.fullscreen.active = false;
  state.fullscreen.dragType = null;
  state.fullscreen.sidebarCollapsed = false;
  updateTimelineFullscreenButton();
});

renderAccentButtons();
document.body.append(elements.accentPatternPopover);
closeAccentPatternPopover();
await hydratePersistentStorage();
loadDetectionSettings();
updateControlLabels();
clearSessionData({ resetDetector: false });
updateCalibrationUi();
updateAutoDetectionUi();
updateTimelineFullscreenButton();
applyFullscreenWorkspaceState();
updateExercisePanelVisibility();
updateExerciseGuideToggleUi();
setAppMode("settings");
loadAppStats();
loadExerciseHighScores();
loadExerciseRepHistory();
renderSessionHistory();
renderStatsPage();
resetExerciseResultsUi();
updateExerciseCaptureUi();
void refreshDeviceList();
void loadBuiltInExercise("8ts").catch((error) => {
  elements.sheetMusicContainer.innerHTML =
    '<div class="sheet-placeholder">Could not load bundled exercise.</div>';
  elements.exerciseMetadata.textContent = error.message;
  setMessage(error.message);
});
requestRender();
