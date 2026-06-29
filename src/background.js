import { buildAttachmentDownloadInfo } from "./background/attachment-downloads.mjs";
import { createMessageRouter } from "./background/router.mjs";
import { mergeSettings } from "./shared/settings.mjs";

const OFFSCREEN_DOCUMENT_PATH = "offscreen/offscreen.html";

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
  CLT_GET_LAST_TRANSCRIPT: async () => ({ ok: true, ...(await getLastTranscript()) }),
  CLT_COPY_TEXT: (message) => copyText(message.text, message.meta || {}),
  CLT_CLEAR_LAST: async () => {
    await clearLast();
    return { ok: true };
  }
}));

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

function normalizeTranscriptForCopy(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
