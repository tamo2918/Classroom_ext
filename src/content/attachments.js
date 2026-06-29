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

  const BUTTON_WIDTH = 108;
  const PROVIDER = detectProvider();
  const state = {
    entries: [],
    enhanceTimer: 0,
    lastUrl: location.href,
    toastTimer: 0
  };

  init();

  function init() {
    if (PROVIDER !== "classroom" || window.top !== window) {
      return;
    }

    injectAttachmentDownloadStyles();
    scheduleEnhancement("initial");
    window.addEventListener("pageshow", () => scheduleEnhancement("pageshow"));
    window.addEventListener("resize", () => scheduleEnhancement("resize"), { passive: true });
    window.addEventListener("scroll", () => scheduleEnhancement("scroll"), { capture: true, passive: true });

    window.setInterval(() => {
      if (state.lastUrl !== location.href) {
        state.lastUrl = location.href;
        clearOverlayButtons();
      }
      scheduleEnhancement("interval");
    }, 1500);

    installMutationObserver();
  }

  function installMutationObserver() {
    if (!document.documentElement || typeof MutationObserver === "undefined") {
      return;
    }

    const observer = new MutationObserver((mutations) => {
      if (mutations.some(isAttachmentRelatedMutation)) {
        scheduleEnhancement("mutation");
      }
    });

    observer.observe(document.documentElement, {
      attributeFilter: ["aria-label", "class", "href", "target"],
      attributes: true,
      childList: true,
      subtree: true
    });
  }

  function scheduleEnhancement(_reason) {
    window.clearTimeout(state.enhanceTimer);
    state.enhanceTimer = window.setTimeout(() => {
      enhanceAttachmentButtons().catch((error) => console.warn("[CLT] attachment enhancement failed", error));
    }, 180);
  }

  async function enhanceAttachmentButtons() {
    const settings = await getSettings();
    cleanupLegacyInlineState();
    injectAttachmentDownloadStyles();

    if (!settings.showAttachmentDownloadButtons) {
      clearOverlayButtons();
      return;
    }

    const anchors = findClassroomAttachmentLinks();
    const nextEntries = [];
    for (const anchor of anchors) {
      const existing = state.entries.find((entry) => entry.anchor === anchor);
      const entry = existing || createAttachmentButtonEntry(anchor);
      updateAttachmentButton(entry);
      nextEntries.push(entry);
    }

    for (const entry of state.entries) {
      if (!nextEntries.includes(entry)) {
        entry.button.remove();
      }
    }
    state.entries = nextEntries;
  }

  function findClassroomAttachmentLinks() {
    return [...document.querySelectorAll("a[href]")]
      .filter((anchor) => anchor instanceof HTMLAnchorElement)
      .filter(isVisibleAttachmentAnchor)
      .filter(isLikelyClassroomAttachment)
      .filter((anchor) => Boolean(buildAttachmentDownloadPreview(anchor.href)));
  }

  function isLikelyClassroomAttachment(anchor) {
    const label = getControlLabel(anchor);
    if (/^\s*(添付ファイル|attachment|attached file)\s*[:：]/i.test(label)) {
      return true;
    }

    const text = getAttachmentCardText(anchor);
    const opensExternally = anchor.target === "_blank" || anchor.rel.includes("noopener");
    const hasFileText = /\.(pdf|docx?|xlsx?|pptx?|zip|csv|txt|mp4|mov|m4a)\b/i.test(text) ||
      /(PDF|動画|Google ドキュメント|Google スプレッドシート|Google スライド|Microsoft Word|Microsoft Excel|Microsoft PowerPoint|Document|Spreadsheet|Presentation)/i.test(text);

    return opensExternally && hasFileText;
  }

  function isVisibleAttachmentAnchor(anchor) {
    const rect = anchor.getBoundingClientRect();
    const style = getComputedStyle(anchor);
    return rect.width >= 120 &&
      rect.height >= 36 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      Number(style.opacity || 1) > 0;
  }

  function createAttachmentButtonEntry(anchor) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "clt-attachment-download-button";
    button.dataset.cltOverlayButton = "1";
    button.textContent = "ダウンロード";

    const entry = { anchor, button };
    for (const eventName of ["pointerdown", "mousedown", "mouseup"]) {
      button.addEventListener(eventName, stopAttachmentEvent, true);
    }
    button.addEventListener("click", (event) => {
      stopAttachmentEvent(event);
      downloadClassroomAttachment(entry).catch((error) => {
        console.warn("[CLT] attachment download failed", error);
        showToast(error.message || "添付資料のダウンロードに失敗しました", false);
      });
    }, true);

    getOverlayRoot().appendChild(button);
    return entry;
  }

  function updateAttachmentButton(entry) {
    const title = getAttachmentTitle(entry.anchor);
    const rect = entry.anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(
      rect.right - BUTTON_WIDTH - 8,
      window.innerWidth - BUTTON_WIDTH - 8
    ));
    const top = Math.max(18, Math.min(
      rect.top + (rect.height / 2),
      window.innerHeight - 18
    ));

    entry.button.title = `${title || "添付資料"}をダウンロード`;
    entry.button.setAttribute("aria-label", entry.button.title);
    entry.button.dataset.cltHref = entry.anchor.href;
    entry.button.style.left = `${left}px`;
    entry.button.style.top = `${top}px`;
  }

  async function downloadClassroomAttachment(entry) {
    const anchor = entry.anchor;
    const button = entry.button;
    const title = getAttachmentTitle(anchor);
    const previousText = button.textContent;
    button.disabled = true;
    button.textContent = "準備中";

    try {
      const response = await chrome.runtime.sendMessage({
        type: "CLT_DOWNLOAD_ATTACHMENT",
        href: anchor.href,
        title,
        pageUrl: location.href
      });

      if (!response?.ok) {
        throw new Error(response?.error || "添付資料のダウンロードに失敗しました。");
      }

      showToast(`${title || "添付資料"}のダウンロードを開始しました`, true);
    } finally {
      button.disabled = false;
      button.textContent = previousText;
    }
  }

  function clearOverlayButtons() {
    for (const entry of state.entries) {
      entry.button.remove();
    }
    state.entries = [];
  }

  function cleanupLegacyInlineState() {
    document.querySelectorAll(".clt-attachment-download-source").forEach((anchor) => {
      anchor.classList.remove("clt-attachment-download-source");
      delete anchor.dataset.cltAttachmentDownloadReady;
    });
    document.querySelectorAll(".clt-attachment-download-host").forEach((host) => {
      host.classList.remove("clt-attachment-download-host");
    });
    document.querySelectorAll(".clt-attachment-download-button:not([data-clt-overlay-button='1'])").forEach((button) => {
      button.remove();
    });
  }

  function getOverlayRoot() {
    let root = document.getElementById("clt-attachment-download-overlay");
    if (!root) {
      root = document.createElement("div");
      root.id = "clt-attachment-download-overlay";
      document.documentElement.appendChild(root);
    }
    return root;
  }

  function stopAttachmentEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function getAttachmentTitle(anchor) {
    const label = getControlLabel(anchor);
    const labelParts = label.split(/\s*[:：]\s*/).filter(Boolean);
    if (/^(添付ファイル|attachment|attached file)$/i.test(labelParts[0] || "") && labelParts.length >= 3) {
      return cleanAttachmentTitle(labelParts.slice(2).join(" "));
    }
    if (/^(添付ファイル|attachment|attached file)$/i.test(labelParts[0] || "") && labelParts.length >= 2) {
      return cleanAttachmentTitle(labelParts.slice(1).join(" "));
    }
    return cleanAttachmentTitle(anchor.innerText || anchor.textContent || anchor.title || "");
  }

  function cleanAttachmentTitle(rawTitle) {
    return String(rawTitle || "")
      .replace(/\s+/g, " ")
      .replace(/\s+(Google ドキュメント|Google スプレッドシート|Google スライド|Google 図形描画|PDF|動画|Microsoft Word|Microsoft Excel|Microsoft PowerPoint)$/i, "")
      .trim();
  }

  function getAttachmentCardText(anchor) {
    const parts = [
      getControlLabel(anchor),
      anchor.innerText || anchor.textContent || "",
      anchor.parentElement?.innerText || "",
      anchor.parentElement?.parentElement?.innerText || ""
    ];
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function isAttachmentRelatedMutation(mutation) {
    if (mutation.target instanceof Element && mutation.target.closest("#clt-attachment-download-overlay")) {
      return false;
    }

    if (mutation.type === "childList") {
      return true;
    }

    return nodeLooksAttachmentRelated(mutation.target);
  }

  function nodeLooksAttachmentRelated(node) {
    if (!(node instanceof Element)) {
      return false;
    }

    if (node.matches?.("a[href]")) {
      return true;
    }

    const signal = [
      node.getAttribute("aria-label"),
      node.getAttribute("href"),
      node.textContent
    ].filter(Boolean).join(" ").slice(0, 800);

    return /(添付ファイル|attachment|drive\.google\.com\/file|docs\.google\.com\/(document|spreadsheets|presentation|drawings)|\.pdf\b)/i.test(signal);
  }

  function buildAttachmentDownloadPreview(rawHref) {
    const url = parseUrl(rawHref);
    if (!url) {
      return null;
    }

    const unwrapped = unwrapGoogleRedirect(url) || url;
    if (extractDriveFileId(unwrapped) && !isDriveFolderUrl(unwrapped)) {
      return { type: "drive-file" };
    }

    if (/(^|\.)docs\.google\.com$/i.test(unwrapped.hostname) &&
      /^\/(document|spreadsheets|presentation|drawings)\/d\/[^/]+/.test(unwrapped.pathname)) {
      return { type: "google-native-file" };
    }

    return null;
  }

  function parseUrl(rawHref) {
    try {
      return new URL(String(rawHref || ""), location.href);
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
    return parseUrl(nested);
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

  async function getSettings() {
    const rawSettings = await chrome.storage.sync.get(null);
    return {
      ...DEFAULT_SETTINGS,
      ...rawSettings
    };
  }

  function getControlLabel(element) {
    return [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.textContent
    ].filter(Boolean).join(" ").trim();
  }

  function detectProvider() {
    return location.hostname === "classroom.google.com" ? "classroom" : "unknown";
  }

  function injectAttachmentDownloadStyles() {
    let style = document.getElementById("clt-attachment-download-styles");
    if (!style) {
      style = document.createElement("style");
      style.id = "clt-attachment-download-styles";
      document.documentElement.appendChild(style);
    }

    style.textContent = `
      #clt-attachment-download-overlay {
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483646 !important;
        pointer-events: none !important;
      }

      .clt-attachment-download-button {
        position: fixed !important;
        z-index: 2147483647 !important;
        width: ${BUTTON_WIDTH}px !important;
        min-height: 32px !important;
        padding: 0 10px !important;
        border: 1px solid #1a73e8 !important;
        border-radius: 6px !important;
        color: #fff !important;
        background: #1a73e8 !important;
        box-shadow: 0 1px 3px rgba(60, 64, 67, .24) !important;
        font: 600 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        letter-spacing: 0 !important;
        text-align: center !important;
        white-space: nowrap !important;
        cursor: pointer !important;
        pointer-events: auto !important;
        transform: translateY(-50%) !important;
      }

      .clt-attachment-download-button:hover {
        background: #1558b0 !important;
        border-color: #1558b0 !important;
      }

      .clt-attachment-download-button:disabled {
        cursor: default !important;
        opacity: .72 !important;
      }
    `;
  }

  function showToast(message, ok) {
    let toast = document.getElementById("clt-helper-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "clt-helper-toast";
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
})();
