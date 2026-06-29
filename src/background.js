import { buildAttachmentDownloadInfo } from "./background/attachment-downloads.mjs";
import { createMessageRouter } from "./background/router.mjs";
import { mergeSettings } from "./shared/settings.mjs";

const OFFSCREEN_DOCUMENT_PATH = "offscreen/offscreen.html";
const DUE_NOTIFICATION_STATE_KEY = "dueWorkNotificationState";
const DUE_NOTIFICATION_URL = "https://classroom.google.com/u/0/h";
const DUE_NOTIFICATION_ICON = "icons/notification.svg";

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(null);
  await chrome.storage.sync.set(mergeSettings(existing));
});

chrome.runtime.onMessage.addListener(createMessageRouter({
  CLT_COPY_TRANSCRIPT: handleCopyTranscript,
  CLT_RECORD_STATUS: (message, sender) => (
    recordStatus({
      ok: Boolean(message.ok),
      status: message.status || (message.ok ? "found" : "not_found"),
      error: message.error || "",
      meta: message.meta || {},
      textLength: Number(message.textLength || 0),
      tabId: sender.tab?.id,
      frameId: sender.frameId
    })
      .then(() => ({ ok: true }))
  ),
  CLT_DOWNLOAD_ATTACHMENT: handleDownloadAttachment,
  CLT_NOTIFY_DUE_WORK: handleDueWorkNotification,
  CLT_GET_LAST_TRANSCRIPT: async () => ({ ok: true, ...(await getLastTranscript()) }),
  CLT_COPY_TEXT: (message) => copyText(message.text, message.meta || {}),
  CLT_CLEAR_LAST: async () => {
    await clearLast();
    return { ok: true };
  }
}));

chrome.notifications.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith("clt-due-work")) {
    return;
  }
  chrome.tabs.create({ url: DUE_NOTIFICATION_URL });
  chrome.notifications.clear(notificationId);
});

async function handleDownloadAttachment(message, sender) {
  const downloadInfo = buildAttachmentDownloadInfo(message.href || message.url, message.title || "");
  if (!downloadInfo) {
    return {
      ok: false,
      error: "この添付資料は直接ダウンロード URL を作成できません。"
    };
  }

  const options = {
    url: downloadInfo.downloadUrl,
    conflictAction: "uniquify",
    saveAs: false
  };
  if (downloadInfo.filename) {
    options.filename = downloadInfo.filename;
  }

  const downloadId = await chrome.downloads.download(options);
  await recordAttachmentDownload({
    ok: true,
    downloadId,
    href: message.href || message.url || "",
    downloadUrl: downloadInfo.downloadUrl,
    filename: downloadInfo.filename || "",
    title: message.title || "",
    pageUrl: message.pageUrl || sender.tab?.url || "",
    tabId: sender.tab?.id,
    frameId: sender.frameId
  });

  return {
    ok: true,
    downloadId,
    filename: downloadInfo.filename || ""
  };
}

async function handleCopyTranscript(message, sender) {
  const text = normalizeTranscriptForCopy(message.text);
  const meta = {
    ...(message.meta || {}),
    copiedFromUrl: message.meta?.url || sender.tab?.url || "",
    copiedAt: new Date().toISOString()
  };

  if (!text) {
    const response = { ok: false, error: "Transcript text is empty." };
    await recordStatus({
      ok: false,
      status: "empty",
      error: response.error,
      meta,
      textLength: 0,
      tabId: sender.tab?.id,
      frameId: sender.frameId
    });
    return response;
  }

  const result = await copyText(text, meta);
  await setLastTranscript(text, meta);
  await recordStatus({
    ok: true,
    status: "copied",
    error: "",
    meta,
    textLength: text.length,
    tabId: sender.tab?.id,
    frameId: sender.frameId
  });
  return result;
}

async function handleDueWorkNotification(message, sender) {
  const items = normalizeDueItems(message.items || []);
  if (!items.length) {
    return { ok: true, status: "empty" };
  }

  const minIntervalHours = Math.max(1, Number(message.minIntervalHours || 12));
  const permissionLevel = await chrome.notifications.getPermissionLevel();
  if (permissionLevel !== "granted") {
    return { ok: true, status: "permission_denied" };
  }

  const fingerprint = await fingerprintDueItems(items);
  const state = await getDueNotificationState();
  const now = Date.now();
  const minIntervalMs = minIntervalHours * 60 * 60 * 1000;
  if (state.fingerprint === fingerprint && now - Number(state.notifiedAt || 0) < minIntervalMs) {
    return { ok: true, status: "skipped_duplicate" };
  }

  const notificationId = `clt-due-work-${now}`;
  await chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: chrome.runtime.getURL(DUE_NOTIFICATION_ICON),
    title: buildDueNotificationTitle(items),
    message: buildDueNotificationMessage(items),
    contextMessage: "Classroom Helper",
    priority: 0
  });

  await chrome.storage.local.set({
    [DUE_NOTIFICATION_STATE_KEY]: {
      fingerprint,
      notifiedAt: now,
      pageUrl: message.pageUrl || sender.tab?.url || DUE_NOTIFICATION_URL,
      count: items.length
    }
  });

  return { ok: true, status: "notified", count: items.length };
}

function normalizeDueItems(items) {
  return [...items]
    .filter((item) => item && (item.assignmentTitle || item.summary))
    .map((item) => ({
      id: String(item.id || item.assignmentUrl || item.summary || ""),
      courseTitle: cleanNotificationText(item.courseTitle || "Classroom"),
      assignmentTitle: cleanNotificationText(item.assignmentTitle || "課題"),
      assignmentUrl: String(item.assignmentUrl || ""),
      dueLabel: cleanNotificationText(item.dueLabel || ""),
      severity: String(item.severity || "upcoming"),
      summary: cleanNotificationText(item.summary || "")
    }))
    .filter((item) => item.id || item.summary);
}

async function getDueNotificationState() {
  const result = await chrome.storage.local.get(DUE_NOTIFICATION_STATE_KEY);
  return result[DUE_NOTIFICATION_STATE_KEY] || {};
}

async function fingerprintDueItems(items) {
  const normalized = items
    .map((item) => item.id || item.summary)
    .sort()
    .join("|");
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildDueNotificationTitle(items) {
  return items.length === 1
    ? "提出期限が近い課題があります"
    : `提出期限が近い課題が${items.length}件あります`;
}

function buildDueNotificationMessage(items) {
  const lines = items
    .slice()
    .sort(compareDueNotificationItems)
    .slice(0, 4)
    .map((item) => `${item.courseTitle}: ${[item.dueLabel, item.assignmentTitle].filter(Boolean).join(" - ")}`);
  if (items.length > lines.length) {
    lines.push(`ほか${items.length - lines.length}件`);
  }
  return truncateNotificationMessage(lines.join("\n"));
}

function compareDueNotificationItems(a, b) {
  return dueSeverityRank(b.severity) - dueSeverityRank(a.severity) ||
    a.courseTitle.localeCompare(b.courseTitle, "ja");
}

function dueSeverityRank(severity) {
  if (severity === "urgent") {
    return 3;
  }
  if (severity === "soon") {
    return 2;
  }
  return 1;
}

function cleanNotificationText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function truncateNotificationMessage(message) {
  const text = cleanNotificationText(message);
  return text.length > 360 ? `${text.slice(0, 357)}...` : text;
}

async function copyText(text, meta = {}) {
  const normalized = normalizeTranscriptForCopy(text);
  if (!normalized) {
    return { ok: false, error: "Clipboard text is empty." };
  }

  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "CLT_WRITE_CLIPBOARD",
    text: normalized
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Clipboard write failed.");
  }

  await setLastTranscript(normalized, {
    ...meta,
    copiedAt: meta.copiedAt || new Date().toISOString()
  });

  return { ok: true, textLength: normalized.length };
}

async function ensureOffscreenDocument() {
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [documentUrl]
  });

  if (existingContexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["CLIPBOARD"],
    justification: "Copy detected video transcripts to the clipboard."
  });
}

async function setLastTranscript(text, meta = {}) {
  const payload = {
    text,
    meta,
    textLength: text.length,
    savedAt: new Date().toISOString()
  };

  if (chrome.storage.session) {
    await chrome.storage.session.set({ lastTranscript: payload });
  } else {
    await chrome.storage.local.set({ lastTranscript: payload });
  }
}

async function getLastTranscript() {
  if (chrome.storage.session) {
    const sessionResult = await chrome.storage.session.get("lastTranscript");
    if (sessionResult.lastTranscript) {
      return { lastTranscript: sessionResult.lastTranscript };
    }
  }

  const localResult = await chrome.storage.local.get("lastTranscript");
  return { lastTranscript: localResult.lastTranscript || null };
}

async function clearLast() {
  await chrome.storage.local.remove(["lastStatus", "lastTranscript"]);
  if (chrome.storage.session) {
    await chrome.storage.session.remove("lastTranscript");
  }
}

async function recordStatus(status) {
  const lastStatus = {
    ...status,
    recordedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ lastStatus });
}

async function recordAttachmentDownload(payload) {
  await chrome.storage.local.set({
    lastAttachmentDownload: {
      ...payload,
      downloadedAt: new Date().toISOString()
    }
  });
}

function normalizeTranscriptForCopy(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
