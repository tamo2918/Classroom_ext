const DEFAULT_SETTINGS = Object.freeze({
  settingsVersion: 3,
  autoCopy: true,
  includeTimestamps: true,
  openTranscriptPanel: true,
  showToast: true,
  preferredLanguages: ["ja", "en"],
  minTranscriptChars: 40
});

const elements = {
  statusText: document.getElementById("statusText"),
  lastStatus: document.getElementById("lastStatus"),
  lastTitle: document.getElementById("lastTitle"),
  lastLength: document.getElementById("lastLength"),
  lastTime: document.getElementById("lastTime"),
  scanButton: document.getElementById("scanButton"),
  copyButton: document.getElementById("copyButton"),
  clearButton: document.getElementById("clearButton"),
  autoCopy: document.getElementById("autoCopy"),
  openTranscriptPanel: document.getElementById("openTranscriptPanel"),
  includeTimestamps: document.getElementById("includeTimestamps"),
  showToast: document.getElementById("showToast"),
  preferredLanguages: document.getElementById("preferredLanguages")
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  await loadSettings();
  await loadLastStatus();
  bindEvents();
}

function bindEvents() {
  for (const key of ["autoCopy", "openTranscriptPanel", "includeTimestamps", "showToast"]) {
    elements[key].addEventListener("change", saveSettings);
  }
  elements.preferredLanguages.addEventListener("change", saveSettings);

  elements.scanButton.addEventListener("click", async () => {
    setStatusText("再スキャン中...");
    elements.scanButton.disabled = true;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        throw new Error("Active tab was not found.");
      }
      await chrome.tabs.sendMessage(tab.id, { type: "CLT_SCAN_NOW" });
      await sleep(500);
      await loadLastStatus();
      setStatusText("再スキャンしました");
    } catch (error) {
      setStatusText(error.message || String(error));
    } finally {
      elements.scanButton.disabled = false;
    }
  });

  elements.copyButton.addEventListener("click", async () => {
    setStatusText("コピー中...");
    elements.copyButton.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: "CLT_GET_LAST_TRANSCRIPT" });
      const transcript = result?.lastTranscript?.text || "";
      if (!transcript) {
        throw new Error("保存された文字起こしがありません。");
      }
      const copyResult = await chrome.runtime.sendMessage({
        type: "CLT_COPY_TEXT",
        text: transcript,
        meta: result.lastTranscript.meta || {}
      });
      if (!copyResult?.ok) {
        throw new Error(copyResult?.error || "Copy failed.");
      }
      setStatusText("再コピーしました");
      await loadLastStatus();
    } catch (error) {
      setStatusText(error.message || String(error));
    } finally {
      elements.copyButton.disabled = false;
    }
  });

  elements.clearButton.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "CLT_CLEAR_LAST" });
    await loadLastStatus();
    setStatusText("履歴を消去しました");
  });
}

async function loadSettings() {
  const rawSettings = await chrome.storage.sync.get(null);
  const settings = { ...DEFAULT_SETTINGS, ...rawSettings };
  if (Number(rawSettings?.settingsVersion || 0) < DEFAULT_SETTINGS.settingsVersion) {
    settings.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
    settings.includeTimestamps = true;
    await chrome.storage.sync.set({
      settingsVersion: settings.settingsVersion,
      includeTimestamps: settings.includeTimestamps
    });
  }
  elements.autoCopy.checked = Boolean(settings.autoCopy);
  elements.openTranscriptPanel.checked = Boolean(settings.openTranscriptPanel);
  elements.includeTimestamps.checked = Boolean(settings.includeTimestamps);
  elements.includeTimestamps.disabled = true;
  elements.showToast.checked = Boolean(settings.showToast);
  elements.preferredLanguages.value = Array.isArray(settings.preferredLanguages)
    ? settings.preferredLanguages.join(",")
    : String(settings.preferredLanguages || "ja,en");
}

async function saveSettings() {
  elements.includeTimestamps.checked = true;
  await chrome.storage.sync.set({
    settingsVersion: DEFAULT_SETTINGS.settingsVersion,
    autoCopy: elements.autoCopy.checked,
    openTranscriptPanel: elements.openTranscriptPanel.checked,
    includeTimestamps: true,
    showToast: elements.showToast.checked,
    preferredLanguages: elements.preferredLanguages.value
      .split(",")
      .map((language) => language.trim())
      .filter(Boolean),
    minTranscriptChars: DEFAULT_SETTINGS.minTranscriptChars
  });
  setStatusText("設定を保存しました");
}

async function loadLastStatus() {
  const [{ lastStatus }, transcriptResult] = await Promise.all([
    chrome.storage.local.get("lastStatus"),
    chrome.runtime.sendMessage({ type: "CLT_GET_LAST_TRANSCRIPT" })
  ]);
  const lastTranscript = transcriptResult?.lastTranscript;

  if (!lastStatus && !lastTranscript) {
    elements.lastStatus.textContent = "-";
    elements.lastTitle.textContent = "-";
    elements.lastLength.textContent = "-";
    elements.lastTime.textContent = "-";
    elements.copyButton.disabled = true;
    setStatusText("動画ページで文字起こしを検出すると自動コピーします");
    return;
  }

  elements.lastStatus.textContent = lastStatus?.ok ? "コピー済み" : statusLabel(lastStatus?.status);
  elements.lastTitle.textContent = lastStatus?.meta?.title || lastTranscript?.meta?.title || "-";
  elements.lastLength.textContent = String(lastStatus?.textLength || lastTranscript?.textLength || "-");
  elements.lastTime.textContent = formatTime(lastStatus?.recordedAt || lastTranscript?.savedAt);
  elements.copyButton.disabled = !lastTranscript?.text;
  setStatusText(lastStatus?.error || "待機中");
}

function statusLabel(status) {
  const labels = {
    copied: "コピー済み",
    not_found: "未検出",
    pending: "待機中",
    copy_failed: "コピー失敗",
    empty: "空",
    found: "検出"
  };
  return labels[status] || "-";
}

function formatTime(value) {
  if (!value) {
    return "-";
  }
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  } catch (_error) {
    return value;
  }
}

function setStatusText(text) {
  elements.statusText.textContent = text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
