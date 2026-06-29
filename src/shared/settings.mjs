export const DEFAULT_SETTINGS = Object.freeze({
  settingsVersion: 4,
  autoCopy: true,
  includeTimestamps: true,
  openTranscriptPanel: true,
  showAttachmentDownloadButtons: true,
  showDueSoonHighlights: true,
  notifyDueSoonAssignments: true,
  dueNotificationMinIntervalHours: 12,
  showToast: true,
  preferredLanguages: ["ja", "en"],
  minTranscriptChars: 40
});

export function mergeSettings(rawSettings = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...rawSettings };
  const migrated = {
    ...DEFAULT_SETTINGS,
    ...settings,
    preferredLanguages: normalizePreferredLanguages(settings.preferredLanguages)
  };

  if (Number(rawSettings?.settingsVersion || 0) < DEFAULT_SETTINGS.settingsVersion) {
    migrated.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
    migrated.includeTimestamps = true;
  }

  return migrated;
}

export function normalizePreferredLanguages(value, fallbackLanguage = "") {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  return [...values, fallbackLanguage, "ja", "en"]
    .map((language) => String(language || "").trim().toLowerCase().replaceAll("_", "-"))
    .filter(Boolean)
    .filter((language, index, all) => all.indexOf(language) === index);
}
