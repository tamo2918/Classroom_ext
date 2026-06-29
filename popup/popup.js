const DEFAULT_SETTINGS = Object.freeze({
  settingsVersion: 6,
  autoCopy: true,
  includeTimestamps: true,
  openTranscriptPanel: true,
  showAttachmentDownloadButtons: true,
  showDueSoonHighlights: true,
  autoSortDueSoonClasses: true,
  notifyDueSoonAssignments: true,
  dueNotificationMinIntervalHours: 12,
  showToast: true,
  preferredLanguages: ["ja", "en"],
  minTranscriptChars: 40
});

const FEATURE_KEYS = Object.freeze([
  "autoCopy",
  "showAttachmentDownloadButtons",
  "showDueSoonHighlights",
  "autoSortDueSoonClasses",
  "notifyDueSoonAssignments"
]);

const elements = {
  statusText: document.getElementById("statusText"),
  autoCopy: document.getElementById("autoCopy"),
  showAttachmentDownloadButtons: document.getElementById("showAttachmentDownloadButtons"),
  showDueSoonHighlights: document.getElementById("showDueSoonHighlights"),
  autoSortDueSoonClasses: document.getElementById("autoSortDueSoonClasses"),
  notifyDueSoonAssignments: document.getElementById("notifyDueSoonAssignments")
};
let currentSettings = { ...DEFAULT_SETTINGS };

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  await loadSettings();
}

function bindEvents() {
  for (const key of FEATURE_KEYS) {
    elements[key].addEventListener("change", saveSettings);
  }
}

async function loadSettings() {
  const rawSettings = await chrome.storage.sync.get(null);
  const settings = mergeSettings(rawSettings);
  currentSettings = settings;

  for (const key of FEATURE_KEYS) {
    elements[key].checked = Boolean(settings[key]);
  }

  if (needsMigration(rawSettings)) {
    await chrome.storage.sync.set(buildStoredSettings(settings));
  }

  setStatusText("機能ごとにオン / オフできます");
}

async function saveSettings() {
  const nextSettings = mergeSettings({
    ...currentSettings,
    ...readFeatureSettings()
  });
  await chrome.storage.sync.set(buildStoredSettings(nextSettings));
  currentSettings = nextSettings;
  setStatusText("設定を保存しました");
}

function readFeatureSettings() {
  return FEATURE_KEYS.reduce((settings, key) => {
    settings[key] = elements[key].checked;
    return settings;
  }, {});
}

function buildStoredSettings(settings) {
  return {
    settingsVersion: DEFAULT_SETTINGS.settingsVersion,
    autoCopy: Boolean(settings.autoCopy),
    includeTimestamps: true,
    openTranscriptPanel: true,
    showAttachmentDownloadButtons: Boolean(settings.showAttachmentDownloadButtons),
    showDueSoonHighlights: Boolean(settings.showDueSoonHighlights),
    autoSortDueSoonClasses: Boolean(settings.autoSortDueSoonClasses),
    notifyDueSoonAssignments: Boolean(settings.notifyDueSoonAssignments),
    dueNotificationMinIntervalHours: normalizePositiveNumber(
      settings.dueNotificationMinIntervalHours,
      DEFAULT_SETTINGS.dueNotificationMinIntervalHours
    ),
    showToast: typeof settings.showToast === "boolean" ? settings.showToast : DEFAULT_SETTINGS.showToast,
    preferredLanguages: normalizePreferredLanguages(settings.preferredLanguages),
    minTranscriptChars: normalizePositiveNumber(settings.minTranscriptChars, DEFAULT_SETTINGS.minTranscriptChars)
  };
}

function mergeSettings(rawSettings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
    includeTimestamps: true,
    openTranscriptPanel: true
  };
}

function needsMigration(rawSettings) {
  return Number(rawSettings?.settingsVersion || 0) < DEFAULT_SETTINGS.settingsVersion ||
    rawSettings?.includeTimestamps !== true ||
    rawSettings?.openTranscriptPanel !== true;
}

function setStatusText(text) {
  elements.statusText.textContent = text;
}

function normalizePreferredLanguages(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  const normalized = values
    .map((language) => String(language || "").trim().toLowerCase().replaceAll("_", "-"))
    .filter(Boolean)
    .filter((language, index, all) => all.indexOf(language) === index);
  return normalized.length ? normalized : DEFAULT_SETTINGS.preferredLanguages;
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
