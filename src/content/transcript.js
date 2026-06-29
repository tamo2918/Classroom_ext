(() => {
  const DEFAULT_SETTINGS = Object.freeze({
    settingsVersion: 4,
    autoCopy: true,
    includeTimestamps: true,
    openTranscriptPanel: true,
    showAttachmentDownloadButtons: true,
    showToast: true,
    preferredLanguages: ["ja", "en"],
    minTranscriptChars: 40
  });

  const SCAN_TIMEOUT_MS = 30000;
  const SCAN_INTERVAL_MS = 1000;
  const RETRY_REASONS = new Set(["initial", "url-change", "manual", "mutation"]);
  const PROVIDER = detectProvider();
  const state = {
    didPrimeDrivePlayback: false,
    lastFingerprint: "",
    lastUrl: location.href,
    mutationTimer: 0,
    pendingRetryTimer: 0,
    scanTimer: 0,
    toastTimer: 0
  };

  init();

  function init() {
    window.addEventListener("pageshow", () => scheduleScan("initial"));
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "CLT_SCAN_NOW") {
        return false;
      }

      scanAndCopy("manual")
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    });

    installUrlObserver();
    installTranscriptMutationObserver();
    scheduleScan("initial");
  }

  function scheduleScan(reason) {
    window.clearTimeout(state.scanTimer);
    state.scanTimer = window.setTimeout(() => {
      scanAndCopy(reason).catch((error) => console.warn("[CLT] transcript scan failed", error));
    }, reason === "manual" ? 0 : 400);
  }

  async function scanAndCopy(reason) {
    const settings = await getSettings();
    if (!settings.autoCopy && reason !== "manual") {
      return { status: "disabled" };
    }

    if (!isLikelyVideoContext()) {
      return { status: "ignored" };
    }

    const startedAt = Date.now();
    let extraction = null;
    let didOpenPanel = false;

    while (Date.now() - startedAt < SCAN_TIMEOUT_MS) {
      extraction = await extractTranscript(settings);
      if (isUsableTranscript(extraction?.text, settings)) {
        break;
      }

      if (!didOpenPanel && settings.openTranscriptPanel) {
        maybePrimeDrivePlaybackForTranscript();
        didOpenPanel = maybeOpenTranscriptPanel();
      }

      if (!RETRY_REASONS.has(reason)) {
        break;
      }
      await sleep(SCAN_INTERVAL_MS);
    }

    if (!isUsableTranscript(extraction?.text, settings)) {
      if (isTranscriptPending()) {
        schedulePendingRetry();
        await recordStatus(false, "pending", "文字起こしの準備を待っています。Drive では再生後に有効化されることがあります。", 0);
        if (settings.showToast && reason === "manual") {
          showToast("文字起こしの準備を待っています", true);
        }
        return { status: "pending" };
      }

      await recordStatus(false, "not_found", "文字起こしを検出できませんでした。", 0);
      if (settings.showToast && reason === "manual") {
        showToast("文字起こしを検出できませんでした", false);
      }
      return { status: "not_found" };
    }

    const text = normalizeTranscript(extraction.text);
    const fingerprint = await fingerprintText(`${PROVIDER}:${location.href}:${text}`);
    if (fingerprint === state.lastFingerprint && reason !== "manual") {
      return { status: "duplicate" };
    }
    state.lastFingerprint = fingerprint;

    const meta = {
      provider: extraction.provider || PROVIDER,
      source: extraction.source || "",
      language: extraction.language || "",
      url: location.href,
      title: getPageTitle(),
      frameUrl: location.href,
      isTopFrame: window.top === window,
      includeTimestamps: Boolean(settings.includeTimestamps)
    };

    const response = await chrome.runtime.sendMessage({
      type: "CLT_COPY_TRANSCRIPT",
      text,
      meta
    });

    if (response?.ok) {
      if (settings.showToast) {
        showToast(`文字起こしをコピーしました (${text.length.toLocaleString()}文字)`, true);
      }
      return { status: "copied", textLength: text.length };
    }

    const error = response?.error || "Clipboard copy failed.";
    await recordStatus(false, "copy_failed", error, text.length, meta);
    if (settings.showToast) {
      showToast("文字起こしのコピーに失敗しました", false);
    }
    return { status: "copy_failed", error };
  }

  async function extractTranscript(settings) {
    const driveTranscript = extractGoogleDriveTranscript(settings);
    if (driveTranscript) {
      return driveTranscript;
    }

    const textTrackTranscript = await extractTextTrackTranscript(settings);
    if (textTrackTranscript) {
      return textTrackTranscript;
    }

    if (PROVIDER !== "drive") {
      const visibleTranscript = extractVisibleTranscript(settings);
      if (visibleTranscript) {
        return visibleTranscript;
      }
    }

    return null;
  }

  function extractGoogleDriveTranscript(settings) {
    if (PROVIDER !== "drive" && PROVIDER !== "docs") {
      return null;
    }

    const segments = [...document.querySelectorAll("[role='button'][aria-label]")]
      .map(parseGoogleDriveTranscriptSegment)
      .filter(Boolean)
      .sort((a, b) => a.startMs - b.startMs);

    const uniqueSegments = [];
    const seen = new Set();
    for (const segment of segments) {
      const key = `${segment.startMs}:${segment.text}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueSegments.push(segment);
      }
    }

    if (uniqueSegments.length < 2) {
      return null;
    }

    return {
      provider: "drive",
      source: "google-drive-transcript-sidebar",
      language: "",
      text: formatSegments(uniqueSegments, true)
    };
  }

  function parseGoogleDriveTranscriptSegment(node) {
    const aria = node.getAttribute("aria-label") || "";
    const ariaMatch = aria.match(/^\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*(?:に始まるセグメント|から始まるセグメント|starts?\s+at|segment\s+starting\s+at)?[、,:-]?\s*(.+)$/i);
    if (ariaMatch) {
      const text = cleanCaptionText(removeTranscriptUiPhrases(ariaMatch[2]));
      return text ? { startMs: parsePlainTimestamp(ariaMatch[1]), text } : null;
    }

    const lines = String(node.innerText || node.textContent || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !isTranscriptUiLine(line));

    const timestampIndex = lines.findIndex((line) => parsePlainTimestamp(line) >= 0);
    if (timestampIndex === -1) {
      return null;
    }

    const text = lines
      .slice(timestampIndex + 1)
      .filter((line) => parsePlainTimestamp(line) === -1)
      .map(removeTranscriptUiPhrases)
      .map(cleanCaptionText)
      .filter(Boolean)
      .join(" ");

    return text ? { startMs: parsePlainTimestamp(lines[timestampIndex]), text } : null;
  }

  async function extractTextTrackTranscript(settings) {
    const videos = [...document.querySelectorAll("video")];
    if (!videos.length) {
      return null;
    }

    for (const video of videos) {
      for (const track of [...video.textTracks || []]) {
        try {
          track.mode = "hidden";
        } catch (_error) {
          continue;
        }
      }
    }

    await sleep(500);

    const segments = [];
    for (const video of videos) {
      for (const track of [...video.textTracks || []]) {
        for (const cue of [...track.cues || []]) {
          const text = cleanCaptionText(cue.text || "");
          if (text) {
            segments.push({ startMs: Math.round(Number(cue.startTime || 0) * 1000), text });
          }
        }
      }
    }

    if (segments.length < 2) {
      return null;
    }

    return {
      provider: PROVIDER,
      source: "html-text-track",
      language: "",
      text: formatSegments(segments, settings.includeTimestamps)
    };
  }

  function extractVisibleTranscript(settings) {
    const candidates = [...document.querySelectorAll("[aria-label], [title], [id], [class], [role='list'], [role='region']")]
      .filter(isElementVisible)
      .map((element) => ({
        element,
        text: cleanVisibleTranscript(element.innerText || "", settings.includeTimestamps),
        score: scoreVisibleTranscript(element.innerText || "")
      }))
      .filter((candidate) => candidate.text.length >= settings.minTranscriptChars && candidate.score > 0)
      .sort((a, b) => b.score - a.score || b.text.length - a.text.length);

    const best = candidates[0];
    if (!best) {
      return null;
    }

    return {
      provider: PROVIDER,
      source: "visible-transcript",
      language: "",
      text: best.text
    };
  }

  function maybeOpenTranscriptPanel() {
    const button = [...document.querySelectorAll("button, [role='button'], a")]
      .filter((element) => isElementVisible(element) && isControlEnabled(element))
      .find((element) => {
        const label = getControlLabel(element);
        return /(show transcript|open transcript|view transcript|transcript|文字起こし|文字おこし)/i.test(label) &&
          !/(hide transcript|close transcript|文字起こしを閉じる|サイドシートを閉じる|戻る)/i.test(label);
      });

    if (!button) {
      return false;
    }

    button.click();
    return true;
  }

  function maybePrimeDrivePlaybackForTranscript() {
    if (PROVIDER !== "drive" || state.didPrimeDrivePlayback || window.top !== window) {
      return false;
    }

    const transcriptControl = findTranscriptControl();
    if (!transcriptControl || isControlEnabled(transcriptControl)) {
      return false;
    }

    const playControl = [...document.querySelectorAll("button, [role='button']")]
      .filter((element) => isElementVisible(element) && isControlEnabled(element))
      .find((element) => {
        const label = getControlLabel(element);
        return /(play|再生)/i.test(label) && !/(speed|速度)/i.test(label);
      });

    if (!playControl) {
      return false;
    }

    state.didPrimeDrivePlayback = true;
    playControl.click();

    window.setTimeout(() => {
      const pauseControl = [...document.querySelectorAll("button, [role='button']")]
        .filter((element) => isElementVisible(element) && isControlEnabled(element))
        .find((element) => /(pause|一時停止)/i.test(getControlLabel(element)));
      pauseControl?.click();
      scheduleScan("mutation");
    }, 1800);

    return true;
  }

  function findTranscriptControl() {
    return [...document.querySelectorAll("button, [role='button'], [aria-label]")]
      .filter(isElementVisible)
      .find((element) => /(transcript|文字起こし|文字おこし)/i.test(getControlLabel(element)));
  }

  function isTranscriptPending() {
    if (PROVIDER !== "drive") {
      return false;
    }

    const transcriptControl = findTranscriptControl();
    if (transcriptControl && !isControlEnabled(transcriptControl)) {
      return true;
    }

    const bodyText = document.body?.innerText || "";
    if (/読み込んでいます|loading/i.test(bodyText)) {
      return true;
    }

    return Boolean(document.querySelector("iframe[src*='youtube.googleapis.com/embed'], iframe[title*='YouTube']"));
  }

  function schedulePendingRetry() {
    window.clearTimeout(state.pendingRetryTimer);
    state.pendingRetryTimer = window.setTimeout(() => scheduleScan("mutation"), 5000);
  }

  function cleanVisibleTranscript(raw, includeTimestamps) {
    const lines = String(raw || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !isTranscriptUiLine(line));

    const result = [];
    for (const line of lines) {
      const timestamp = parsePlainTimestamp(line);
      if (timestamp >= 0 && !includeTimestamps) {
        continue;
      }

      const cleaned = timestamp >= 0
        ? `[${formatTimestamp(timestamp)}]`
        : cleanCaptionText(removeTranscriptUiPhrases(line));
      if (cleaned && cleaned !== result[result.length - 1]) {
        result.push(cleaned);
      }
    }

    return result.join("\n").trim();
  }

  function scoreVisibleTranscript(raw) {
    const text = String(raw || "");
    const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const timecodes = lines.filter((line) => parsePlainTimestamp(line) >= 0).length;
    const shortTextLines = lines.filter((line) => line.length >= 2 && line.length <= 180).length;
    return (timecodes >= 2 ? timecodes * 4 : 0) + (shortTextLines >= 4 ? shortTextLines : 0);
  }

  function formatSegments(segments, includeTimestamps) {
    const normalized = [];
    for (const segment of segments) {
      const text = cleanCaptionText(segment.text);
      if (!text || text === normalized[normalized.length - 1]?.text) {
        continue;
      }
      normalized.push({ startMs: Number(segment.startMs || 0), text });
    }

    return normalized.map((segment) => (
      includeTimestamps
        ? `[${formatTimestamp(segment.startMs)}] ${segment.text}`
        : segment.text
    )).join("\n").trim();
  }

  function isTranscriptUiLine(line) {
    return /^(show transcript|open transcript|view transcript|transcript|search transcript|no transcript|copy link to this transcript|copy transcript link|文字起こし|文字おこし|文字起こしサイドバー|検索|字幕|閉じる|戻る|サイドシートを閉じる|再生|一時停止|その他|設定|この文字起こしへのリンクをコピーします)$/i.test(String(line || "").trim());
  }

  function removeTranscriptUiPhrases(text) {
    return String(text || "")
      .replace(/この文字起こしへのリンクをコピーします/g, "")
      .replace(/copy link to this transcript/gi, "")
      .replace(/copy transcript link/gi, "")
      .trim();
  }

  function cleanCaptionText(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeTranscript(text) {
    return String(text || "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function isUsableTranscript(text, settings) {
    return typeof text === "string" && normalizeTranscript(text).length >= Number(settings.minTranscriptChars || 40);
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

  function isLikelyVideoContext() {
    if (PROVIDER === "drive") {
      return /\/file\/d\/|\/open\b|\/preview\b/.test(location.pathname) ||
        Boolean(document.querySelector("iframe[src*='youtube.googleapis.com/embed'], video"));
    }

    if (PROVIDER === "classroom") {
      return Boolean(document.querySelector("video, iframe[src*='youtube'], iframe[src*='drive.google.com'], a[href*='drive.google.com/file'][href*='/view']"));
    }

    return Boolean(document.querySelector("video"));
  }

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

  function getPageTitle() {
    return document.querySelector("meta[property='og:title']")?.content ||
      document.querySelector("h1")?.textContent?.trim() ||
      document.title ||
      "";
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

  async function recordStatus(ok, status, error, textLength = 0, meta = {}) {
    await chrome.runtime.sendMessage({
      type: "CLT_RECORD_STATUS",
      ok,
      status,
      error,
      meta: {
        provider: PROVIDER,
        url: location.href,
        title: getPageTitle(),
        ...meta
      },
      textLength
    });
  }

  function getControlLabel(element) {
    return [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.textContent
    ].filter(Boolean).join(" ").trim();
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

  function installUrlObserver() {
    window.setInterval(() => {
      if (state.lastUrl === location.href) {
        return;
      }
      state.lastUrl = location.href;
      state.didPrimeDrivePlayback = false;
      window.clearTimeout(state.pendingRetryTimer);
      scheduleScan("url-change");
    }, 800);
  }

  function installTranscriptMutationObserver() {
    if (!document.documentElement || typeof MutationObserver === "undefined") {
      return;
    }

    const observer = new MutationObserver((mutations) => {
      if (!isLikelyVideoContext() || !mutations.some(isTranscriptMutation)) {
        return;
      }

      window.clearTimeout(state.mutationTimer);
      state.mutationTimer = window.setTimeout(() => scheduleScan("mutation"), 650);
    });

    observer.observe(document.documentElement, {
      attributeFilter: ["aria-label", "aria-disabled", "class", "disabled"],
      attributes: true,
      childList: true,
      subtree: true
    });
  }

  function isTranscriptMutation(mutation) {
    if (mutation.type === "attributes") {
      return nodeLooksTranscriptRelated(mutation.target);
    }

    for (const node of mutation.addedNodes || []) {
      if (nodeLooksTranscriptRelated(node)) {
        return true;
      }
    }
    return false;
  }

  function nodeLooksTranscriptRelated(node) {
    if (!(node instanceof Element)) {
      return false;
    }

    const signal = [
      node.getAttribute("aria-label"),
      node.getAttribute("title"),
      node.id,
      typeof node.className === "string" ? node.className : "",
      node.textContent
    ].filter(Boolean).join(" ").slice(0, 1200);

    return /(transcript|caption|subtitle|文字起こし|字幕|に始まるセグメント|segment starting|copy link to this transcript|この文字起こしへのリンク|\d{1,2}:\d{2})/i.test(signal);
  }

  async function fingerprintText(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function showToast(message, ok) {
    if (window.top !== window) {
      return;
    }

    let toast = document.getElementById("clt-transcript-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "clt-transcript-toast";
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

    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      toast.style.opacity = "0";
    }, 3600);
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
})();
