(() => {
  const {
    detectProvider,
    getControlLabel,
    getSettings,
    showToast: showSharedToast
  } = globalThis.CLT.content;
  const BUTTON_SIZE = 32;
  const FILE_TYPE_LABEL_PATTERN = [
    "Google ドキュメント",
    "Google スプレッドシート",
    "Google スライド",
    "Google 図形描画",
    "Microsoft Word",
    "Microsoft Excel",
    "Microsoft PowerPoint",
    "Document",
    "Spreadsheet",
    "Presentation",
    "PDF",
    "動画"
  ].join("|");
  const FILE_EXTENSION_PATTERN = "pdf|docx?|xlsx?|pptx?|zip|csv|txt|mp4|mov|m4a";
  const PROVIDER = detectProvider();
  const showToast = (message, ok) => showSharedToast("clt-helper-toast", message, ok);
  const state = {
    entries: [],
    enhanceTimer: 0,
    lastUrl: location.href
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
      .filter(isRenderableAttachmentAnchor)
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

  function isRenderableAttachmentAnchor(anchor) {
    const rect = anchor.getBoundingClientRect();
    const style = getComputedStyle(anchor);
    return rect.width >= 120 &&
      rect.height >= 36 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      Number(style.opacity || 1) > 0 &&
      isAttachmentAnchorAvailable(anchor, rect);
  }

  function isAttachmentAnchorAvailable(anchor, rect) {
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) {
      return true;
    }

    const sampleX = clamp(rect.left + Math.min(40, rect.width / 2), 0, window.innerWidth - 1);
    const sampleY = clamp(rect.top + rect.height / 2, 0, window.innerHeight - 1);
    const topElement = document.elementFromPoint(sampleX, sampleY);
    if (!topElement) {
      return false;
    }

    if (topElement === anchor || anchor.contains(topElement)) {
      return true;
    }

    const topAnchor = topElement.closest?.("a[href]");
    if (topAnchor) {
      return topAnchor === anchor;
    }

    let parent = anchor.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      if (parent === topElement) {
        return true;
      }
      parent = parent.parentElement;
    }

    return false;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function createAttachmentButtonEntry(anchor) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "clt-attachment-download-button";
    button.dataset.cltOverlayButton = "1";
    button.innerHTML = `
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M5 20h14v-2H5v2Zm7-18v10.17l3.59-3.58L17 10l-5 5-5-5 1.41-1.41L11 12.17V2h1Z"></path>
      </svg>
    `;

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
    const pageLeft = rect.left + window.scrollX;
    const pageRight = rect.right + window.scrollX;
    const pageTop = rect.top + window.scrollY;
    const left = Math.max(pageLeft + 8, pageRight - BUTTON_SIZE - 8);
    const top = pageTop + 8;

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
    const previousLabel = button.getAttribute("aria-label");
    const previousTitle = button.title;
    button.disabled = true;
    button.title = `${title || "添付資料"}のダウンロードを準備中`;
    button.setAttribute("aria-label", button.title);

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
      button.title = previousTitle;
      if (previousLabel) {
        button.setAttribute("aria-label", previousLabel);
      }
    }
  }

  function clearOverlayButtons() {
    for (const entry of state.entries) {
      entry.anchor.classList.remove("clt-attachment-download-source");
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
    document.querySelectorAll(".clt-attachment-download-button:not([data-clt-overlay-button='1'])").forEach((button) => button.remove());
    document.querySelectorAll(".clt-attachment-download-slot").forEach((slot) => slot.remove());
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
    const title = String(rawTitle || "")
      .replace(/\s+/g, " ")
      .trim();
    return stripTrailingFileTypeLabel(title);
  }

  function stripTrailingFileTypeLabel(rawTitle) {
    let title = String(rawTitle || "").trim();
    for (let index = 0; index < 3; index += 1) {
      const nextTitle = title
        .replace(new RegExp(`\\.(${FILE_EXTENSION_PATTERN})\\s*(?:${FILE_TYPE_LABEL_PATTERN})$`, "i"), ".$1")
        .replace(new RegExp(`\\s+(?:${FILE_TYPE_LABEL_PATTERN})$`, "i"), "")
        .trim();
      if (nextTitle === title) {
        return title;
      }
      title = nextTitle;
    }
    return title;
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

  function injectAttachmentDownloadStyles() {
    let style = document.getElementById("clt-attachment-download-styles");
    if (!style) {
      style = document.createElement("style");
      style.id = "clt-attachment-download-styles";
      document.documentElement.appendChild(style);
    }

    style.textContent = `
      #clt-attachment-download-overlay {
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
        width: 100% !important;
        height: 0 !important;
        z-index: 2147483646 !important;
        pointer-events: none !important;
      }

      .clt-attachment-download-button {
        position: absolute !important;
        z-index: 2147483647 !important;
        display: inline-grid !important;
        place-items: center !important;
        width: ${BUTTON_SIZE}px !important;
        height: ${BUTTON_SIZE}px !important;
        min-width: ${BUTTON_SIZE}px !important;
        min-height: ${BUTTON_SIZE}px !important;
        padding: 0 !important;
        border: 1px solid #dadce0 !important;
        border-radius: 50% !important;
        color: #1a73e8 !important;
        background: rgba(255, 255, 255, .96) !important;
        box-shadow: 0 1px 2px rgba(60, 64, 67, .18) !important;
        font: inherit !important;
        letter-spacing: 0 !important;
        text-align: center !important;
        white-space: nowrap !important;
        cursor: pointer !important;
        pointer-events: auto !important;
      }

      .clt-attachment-download-button:hover {
        background: #e8f0fe !important;
        border-color: #c6dafc !important;
        box-shadow: 0 1px 3px rgba(60, 64, 67, .26) !important;
      }

      .clt-attachment-download-button svg {
        width: 18px !important;
        height: 18px !important;
        fill: currentColor !important;
        pointer-events: none !important;
      }

      .clt-attachment-download-button:disabled {
        cursor: default !important;
        opacity: .72 !important;
      }
    `;
  }

})();
