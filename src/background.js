const OFFSCREEN_DOCUMENT_PATH = "offscreen/offscreen.html";
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

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(null);
  const next = { ...DEFAULT_SETTINGS, ...existing };
  if (Number(existing?.settingsVersion || 0) < DEFAULT_SETTINGS.settingsVersion) {
    next.includeTimestamps = true;
    next.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
  }
  await chrome.storage.sync.set(next);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target === "offscreen") {
    return false;
  }

  if (message.type === "CLT_COPY_TRANSCRIPT") {
    handleCopyTranscript(message, sender)
      .then(sendResponse)
      .catch((error) => sendResponse(toErrorResponse(error)));
    return true;
  }

  if (message.type === "CLT_RECORD_STATUS") {
    recordStatus({
      ok: Boolean(message.ok),
      status: message.status || (message.ok ? "found" : "not_found"),
      error: message.error || "",
      meta: message.meta || {},
      textLength: Number(message.textLength || 0),
      tabId: sender.tab?.id,
      frameId: sender.frameId
    })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse(toErrorResponse(error)));
    return true;
  }

  if (message.type === "CLT_DOWNLOAD_ATTACHMENT") {
    handleDownloadAttachment(message, sender)
      .then(sendResponse)
      .catch((error) => sendResponse(toErrorResponse(error)));
    return true;
  }

  if (message.type === "CLT_GET_LAST_TRANSCRIPT") {
    getLastTranscript()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse(toErrorResponse(error)));
    return true;
  }

  if (message.type === "CLT_COPY_TEXT") {
    copyText(message.text, message.meta || {})
      .then(sendResponse)
      .catch((error) => sendResponse(toErrorResponse(error)));
    return true;
  }

  if (message.type === "CLT_CLEAR_LAST") {
    clearLast()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse(toErrorResponse(error)));
    return true;
  }

  return false;
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

function buildAttachmentDownloadInfo(rawHref, rawTitle = "") {
  const url = parseAbsoluteUrl(rawHref);
  if (!url) {
    return null;
  }

  const unwrapped = unwrapGoogleRedirect(url) || url;
  const driveFileId = extractDriveFileId(unwrapped);
  if (driveFileId && !isDriveFolderUrl(unwrapped)) {
    return {
      downloadUrl: buildDriveDownloadUrl(driveFileId, unwrapped),
      filename: filenameOnlyWhenExtensionExists(rawTitle)
    };
  }

  const native = buildGoogleNativeExport(unwrapped, rawTitle);
  if (native) {
    return native;
  }

  return null;
}

function parseAbsoluteUrl(rawHref) {
  try {
    return new URL(String(rawHref || ""));
  } catch (_error) {
    return null;
  }
}

function unwrapGoogleRedirect(url) {
  if (!/(^|\.)google\./i.test(url.hostname) && url.hostname !== "classroom.google.com") {
    return null;
  }

  const nested = url.searchParams.get("url") || url.searchParams.get("q");
  if (!nested) {
    return null;
  }
  return parseAbsoluteUrl(nested);
}

function extractDriveFileId(url) {
  const pathMatch = url.pathname.match(/\/file\/(?:u\/\d+\/)?d\/([^/]+)/);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }

  const queryId = url.searchParams.get("id");
  if (queryId && /(^|\.)drive\.google\.com$/i.test(url.hostname)) {
    return queryId;
  }

  return "";
}

function isDriveFolderUrl(url) {
  return /\/folders\//.test(url.pathname) || url.pathname.includes("/drive/folders");
}

function buildDriveDownloadUrl(fileId, sourceUrl) {
  const downloadUrl = new URL("https://drive.google.com/uc");
  downloadUrl.searchParams.set("export", "download");
  downloadUrl.searchParams.set("id", fileId);
  downloadUrl.searchParams.set("confirm", "t");
  copySearchParam(sourceUrl, downloadUrl, "resourcekey");
  copySearchParam(sourceUrl, downloadUrl, "authuser");
  return downloadUrl.toString();
}

function buildGoogleNativeExport(url, rawTitle) {
  if (!/(^|\.)docs\.google\.com$/i.test(url.hostname)) {
    return null;
  }

  const match = url.pathname.match(/^\/(document|spreadsheets|presentation|drawings)\/d\/([^/]+)/);
  if (!match) {
    return null;
  }

  const [, kind, fileId] = match;
  const exportUrl = new URL(`https://docs.google.com/${kind}/d/${fileId}/export`);
  let extension = "pdf";
  if (kind === "spreadsheets") {
    exportUrl.searchParams.set("format", "xlsx");
    extension = "xlsx";
  } else if (kind === "presentation" || kind === "drawings") {
    exportUrl.pathname = `/${kind}/d/${fileId}/export/pdf`;
  } else {
    exportUrl.searchParams.set("format", "pdf");
  }

  copySearchParam(url, exportUrl, "resourcekey");
  copySearchParam(url, exportUrl, "authuser");

  return {
    downloadUrl: exportUrl.toString(),
    filename: filenameWithExtension(rawTitle, extension)
  };
}

function copySearchParam(sourceUrl, targetUrl, key) {
  const value = sourceUrl.searchParams.get(key);
  if (value) {
    targetUrl.searchParams.set(key, value);
  }
}

function filenameOnlyWhenExtensionExists(rawTitle) {
  const filename = sanitizeFilename(cleanAttachmentTitle(rawTitle));
  return /\.[a-z0-9]{2,8}$/i.test(filename) ? filename : "";
}

function filenameWithExtension(rawTitle, extension) {
  const base = sanitizeFilename(cleanAttachmentTitle(rawTitle)).replace(/\.[a-z0-9]{2,8}$/i, "");
  return base ? `${base}.${extension}` : "";
}

function cleanAttachmentTitle(rawTitle) {
  const title = String(rawTitle || "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = title.split(/\s*[:：]\s*/).filter(Boolean);
  if (/^(添付ファイル|attachment|attached file)$/i.test(parts[0] || "") && parts.length >= 3) {
    return parts.slice(2).join(" ");
  }
  if (/^(添付ファイル|attachment|attached file)$/i.test(parts[0] || "") && parts.length >= 2) {
    return parts.slice(1).join(" ");
  }
  return title
    .replace(/\s+(Google ドキュメント|Google スプレッドシート|Google スライド|Google 図形描画|PDF|Microsoft Word|Microsoft Excel|Microsoft PowerPoint)$/i, "")
    .trim();
}

function sanitizeFilename(filename) {
  return String(filename || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function normalizeTranscriptForCopy(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toErrorResponse(error) {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  };
}
