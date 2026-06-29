(() => {
  const DEFAULT_SETTINGS = Object.freeze({
    settingsVersion: 5,
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

  const toastTimers = new Map();

  function detectProvider() {
    const host = location.hostname;
    if (host === "drive.google.com") {
      return "drive";
    }
    if (host === "docs.google.com") {
      return "docs";
    }
    if (host === "classroom.google.com") {
      return "classroom";
    }
    if (host.includes("youtube.com") || host.includes("youtube-nocookie.com") || host === "youtube.googleapis.com") {
      return "youtube";
    }
    return "unknown";
  }

  async function getSettings() {
    const rawSettings = await chrome.storage.sync.get(null);
    const settings = { ...DEFAULT_SETTINGS, ...rawSettings };
    const migrated = {
      ...DEFAULT_SETTINGS,
      ...settings,
      preferredLanguages: normalizePreferredLanguages(settings.preferredLanguages)
    };

    if (Number(rawSettings?.settingsVersion || 0) < DEFAULT_SETTINGS.settingsVersion) {
      migrated.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
      migrated.includeTimestamps = true;
      await chrome.storage.sync.set({
        settingsVersion: migrated.settingsVersion,
        includeTimestamps: migrated.includeTimestamps
      });
    }

    return migrated;
  }

  function normalizePreferredLanguages(value) {
    const values = Array.isArray(value) ? value : String(value || "").split(",");
    return [...values, navigator.language || "", "ja", "en"]
      .map((language) => String(language || "").trim().toLowerCase().replaceAll("_", "-"))
      .filter(Boolean)
      .filter((language, index, all) => all.indexOf(language) === index);
  }

  function getControlLabel(element) {
    return [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.textContent
    ].filter(Boolean).join(" ").trim();
  }

  function getPageTitle() {
    return document.querySelector("meta[property='og:title']")?.content ||
      document.querySelector("h1")?.textContent?.trim() ||
      document.title ||
      "";
  }

  function isControlEnabled(element) {
    return element instanceof HTMLElement &&
      !element.disabled &&
      element.getAttribute("aria-disabled") !== "true";
  }

  function isElementVisible(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      Number(style.opacity || 1) > 0;
  }

  function parsePlainTimestamp(value) {
    const text = String(value || "").trim();
    if (!/^(\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?$/.test(text)) {
      return -1;
    }

    const parts = text.replace(",", ".").split(":").map(Number);
    if (parts.some(Number.isNaN)) {
      return -1;
    }

    if (parts.length === 3) {
      return Math.round(((parts[0] * 3600) + (parts[1] * 60) + parts[2]) * 1000);
    }
    return Math.round(((parts[0] * 60) + parts[1]) * 1000);
  }

  function formatTimestamp(ms) {
    const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  async function fingerprintText(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function showToast(id, message, ok, options = {}) {
    if (options.topFrameOnly && window.top !== window) {
      return;
    }

    let toast = document.getElementById(id);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = id;
      toast.setAttribute("role", "status");
      toast.style.cssText = [
        "position:fixed",
        "right:16px",
        "bottom:16px",
        "z-index:2147483647",
        "max-width:min(360px,calc(100vw - 32px))",
        "padding:10px 12px",
        "border-radius:8px",
        "box-shadow:0 8px 24px rgba(0,0,0,.22)",
        "font:13px/1.45 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        "color:#fff",
        "word-break:break-word",
        "transition:opacity .18s ease",
        "opacity:0"
      ].join(";");
      document.documentElement.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.background = ok ? "#176c3a" : "#9f2c2c";
    toast.style.opacity = "1";

    window.clearTimeout(toastTimers.get(id));
    toastTimers.set(id, window.setTimeout(() => {
      toast.style.opacity = "0";
    }, options.durationMs || 3600));
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  globalThis.CLT = globalThis.CLT || {};
  globalThis.CLT.content = Object.freeze({
    DEFAULT_SETTINGS,
    detectProvider,
    fingerprintText,
    formatTimestamp,
    getControlLabel,
    getPageTitle,
    getSettings,
    isControlEnabled,
    isElementVisible,
    parsePlainTimestamp,
    showToast,
    sleep
  });
})();
