(() => {
  const {
    detectProvider,
    getSettings,
    isElementVisible,
    isExtensionContextInvalidated
  } = globalThis.CLT.content;
  const {
    buildDueItem,
    severityRank,
    summarizeDueItem
  } = globalThis.CLT.dueWork;
  const {
    applyDueCardSort,
    clearDueCardSort
  } = globalThis.CLT.dueCardSorter;

  const PROVIDER = detectProvider();
  const HOME_PATH_PATTERN = /^\/(?:u\/\d+\/)?h\/?$/;
  const CARD_SELECTOR = "li";
  const ASSIGNMENT_LINK_SELECTOR = "a[href*='/a/'][href*='/details']";
  const COURSE_LINK_SELECTOR = "a[href*='/c/']";
  const NO_DUE_TEXT_PATTERN = /提出期限の近い課題はありません|no work due soon/i;
  const state = {
    contextInvalidated: false,
    lastUrl: location.href,
    notifyFingerprint: "",
    scanTimer: 0
  };

  init();

  function init() {
    if (PROVIDER !== "classroom" || window.top !== window) {
      return;
    }

    injectDueHighlightStyles();
    scheduleScan("initial");
    window.addEventListener("pageshow", () => scheduleScan("pageshow"));

    window.setInterval(() => {
      if (state.lastUrl !== location.href) {
        state.lastUrl = location.href;
        clearDueHighlights();
        clearDueCardSort();
      }
      scheduleScan("interval");
    }, 60000);

    installMutationObserver();
  }

  function installMutationObserver() {
    if (!document.documentElement || typeof MutationObserver === "undefined") {
      return;
    }

    const observer = new MutationObserver((mutations) => {
      if (!isClassroomHome() || !mutations.some(isDueRelatedMutation)) {
        return;
      }
      scheduleScan("mutation");
    });

    observer.observe(document.documentElement, {
      attributeFilter: ["aria-label", "class", "href"],
      attributes: true,
      childList: true,
      subtree: true
    });
  }

  function scheduleScan(_reason) {
    if (state.contextInvalidated) {
      return;
    }
    window.clearTimeout(state.scanTimer);
    state.scanTimer = window.setTimeout(() => {
      scanDueCards().catch((error) => {
        if (handleExtensionContextError(error)) {
          return;
        }
        console.warn("[CLT] due scan failed", error);
      });
    }, 250);
  }

  function handleExtensionContextError(error) {
    if (!isExtensionContextInvalidated(error)) {
      return false;
    }
    state.contextInvalidated = true;
    window.clearTimeout(state.scanTimer);
    clearDueHighlights();
    clearDueCardSort();
    return true;
  }

  async function scanDueCards() {
    injectDueHighlightStyles();

    if (!isClassroomHome()) {
      clearDueHighlights();
      clearDueCardSort();
      return;
    }

    const settings = await getSettings();
    if (!shouldScanDueWork(settings)) {
      clearDueHighlights();
      clearDueCardSort();
      return;
    }

    const cards = findCourseCards();
    const cardStates = [];
    const dueItems = [];

    for (const [index, card] of cards.entries()) {
      const course = getCourseInfo(card);
      const items = extractDueItems(card, course);
      if (settings.showDueSoonHighlights) {
        applyCardState(card, items);
      } else {
        clearCardState(card);
      }
      cardStates.push({
        card,
        course,
        dueItems: items,
        originalIndex: index
      });
      dueItems.push(...items);
    }

    if (settings.autoSortDueSoonClasses) {
      applyDueCardSort(cardStates);
    } else {
      clearDueCardSort();
    }

    if (settings.notifyDueSoonAssignments) {
      await notifyDueItems(dueItems, settings);
    }
  }

  function shouldScanDueWork(settings) {
    return Boolean(
      settings.showDueSoonHighlights ||
      settings.autoSortDueSoonClasses ||
      settings.notifyDueSoonAssignments
    );
  }

  function findCourseCards() {
    return [...document.querySelectorAll(CARD_SELECTOR)]
      .filter((card) => card instanceof HTMLElement)
      .filter((card) => card.querySelector(COURSE_LINK_SELECTOR))
      .filter((card) => {
        const rect = card.getBoundingClientRect();
        return rect.width >= 240 && rect.height >= 180;
      });
  }

  function getCourseInfo(card) {
    const courseLink = [...card.querySelectorAll(COURSE_LINK_SELECTOR)]
      .filter((anchor) => anchor instanceof HTMLAnchorElement)
      .find((anchor) => normalizeText(anchor.innerText || anchor.textContent).length > 0) ||
      card.querySelector(COURSE_LINK_SELECTOR);
    const lines = String(courseLink?.innerText || courseLink?.textContent || "")
      .split(/\n+/)
      .map(normalizeText)
      .filter(Boolean);

    return {
      title: lines[0] || extractCourseTitleFromAria(card) || "Classroom",
      url: courseLink?.href || ""
    };
  }

  function extractCourseTitleFromAria(card) {
    const courseAction = [...card.querySelectorAll("[aria-label]")]
      .map((element) => element.getAttribute("aria-label") || "")
      .find((label) => /^「.+」の課題を開く$/.test(label));
    const match = courseAction?.match(/^「(.+)」の課題を開く$/);
    return match?.[1] || "";
  }

  function extractDueItems(card, course) {
    if (NO_DUE_TEXT_PATTERN.test(card.innerText || "")) {
      return [];
    }

    return [...card.querySelectorAll(ASSIGNMENT_LINK_SELECTOR)]
      .filter((anchor) => anchor instanceof HTMLAnchorElement)
      .filter((anchor) => isElementVisible(anchor))
      .map((anchor) => {
        const heading = findDueHeading(anchor);
        if (!heading) {
          return null;
        }

        return buildDueItem({
          courseTitle: course.title,
          courseUrl: course.url,
          heading,
          assignmentText: anchor.innerText || anchor.textContent || "",
          assignmentUrl: anchor.href,
          ariaLabel: anchor.getAttribute("aria-label") || ""
        });
      })
      .filter(Boolean);
  }

  function findDueHeading(anchor) {
    let node = anchor.parentElement;
    for (let depth = 0; node && depth < 5; depth += 1) {
      let previous = node.previousElementSibling;
      while (previous) {
        const text = normalizeText(previous.innerText || previous.textContent || "");
        if (isDueHeadingText(text)) {
          return text;
        }
        previous = previous.previousElementSibling;
      }
      node = node.parentElement;
    }

    const aria = anchor.getAttribute("aria-label") || "";
    const ariaMatch = aria.match(/、(.+?まで)$/);
    return ariaMatch ? ariaMatch[1] : "";
  }

  function isDueHeadingText(text) {
    return /^(今日|本日|明日|期限\s*[:：]|due|today|tomorrow)/i.test(text);
  }

  function applyCardState(card, dueItems) {
    clearCardState(card);

    if (!dueItems.length) {
      return;
    }

    const severity = dueItems
      .map((item) => item.severity)
      .sort((a, b) => severityRank(b) - severityRank(a))[0] || "upcoming";
    const soonest = dueItems
      .slice()
      .sort((a, b) => numericHours(a.hoursUntil) - numericHours(b.hoursUntil))[0];

    card.classList.add("clt-due-card", `clt-due-${severity}`);
    card.dataset.cltDueLabel = dueItems.length === 1 ? "期限間近" : `期限間近 ${dueItems.length}件`;
    card.dataset.cltDueSummary = soonest ? summarizeDueItem(soonest) : "";
  }

  function clearCardState(card) {
    card.classList.remove("clt-due-card", "clt-due-urgent", "clt-due-soon", "clt-due-upcoming");
    delete card.dataset.cltDueLabel;
    delete card.dataset.cltDueSummary;
  }

  async function notifyDueItems(dueItems, settings) {
    if (!dueItems.length) {
      state.notifyFingerprint = "";
      return;
    }

    const fingerprint = dueItems
      .map((item) => item.id)
      .sort()
      .join("|");
    if (fingerprint === state.notifyFingerprint) {
      return;
    }
    state.notifyFingerprint = fingerprint;

    await chrome.runtime.sendMessage({
      type: "CLT_NOTIFY_DUE_WORK",
      pageUrl: location.href,
      minIntervalHours: Number(settings.dueNotificationMinIntervalHours || 12),
      items: dueItems.map((item) => ({
        id: item.id,
        courseTitle: item.courseTitle,
        assignmentTitle: item.assignmentTitle,
        assignmentUrl: item.assignmentUrl,
        dueLabel: item.dueLabel,
        dueAt: item.dueAt,
        severity: item.severity,
        summary: summarizeDueItem(item)
      }))
    });
  }

  function clearDueHighlights() {
    document.querySelectorAll(".clt-due-card").forEach((card) => {
      clearCardState(card);
    });
  }

  function isClassroomHome() {
    return location.hostname === "classroom.google.com" && HOME_PATH_PATTERN.test(location.pathname);
  }

  function isDueRelatedMutation(mutation) {
    if (mutation.type === "attributes") {
      return nodeLooksDueRelated(mutation.target);
    }
    for (const node of mutation.addedNodes || []) {
      if (nodeLooksDueRelated(node)) {
        return true;
      }
    }
    return false;
  }

  function nodeLooksDueRelated(node) {
    if (!(node instanceof Element)) {
      return false;
    }

    const signal = [
      node.getAttribute("aria-label"),
      node.textContent
    ].filter(Boolean).join(" ").slice(0, 800);

    return /(提出期限|期限|明日|今日|課題|assignment|due)/i.test(signal);
  }

  function numericHours(value) {
    return typeof value === "number" ? value : Number.MAX_SAFE_INTEGER;
  }

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function injectDueHighlightStyles() {
    let style = document.getElementById("clt-due-highlight-styles");
    if (!style) {
      style = document.createElement("style");
      style.id = "clt-due-highlight-styles";
      document.documentElement.appendChild(style);
    }

    style.textContent = `
      li.clt-due-card {
        position: relative !important;
        isolation: isolate !important;
        border-color: var(--clt-due-border, #1a73e8) !important;
        outline: 2px solid var(--clt-due-border, #1a73e8) !important;
        outline-offset: 3px !important;
        box-shadow:
          inset 0 0 0 2px var(--clt-due-inner, rgba(26, 115, 232, .34)),
          0 0 0 5px var(--clt-due-outline, rgba(26, 115, 232, .14)),
          0 0 18px var(--clt-due-glow, rgba(26, 115, 232, .28)) !important;
      }

      li.clt-due-card::after {
        content: attr(data-clt-due-label) !important;
        position: absolute !important;
        right: 10px !important;
        top: 10px !important;
        z-index: 3 !important;
        max-width: calc(100% - 20px) !important;
        padding: 4px 9px !important;
        border-radius: 999px !important;
        border: 1px solid var(--clt-due-border, #1a73e8) !important;
        background: rgba(255, 255, 255, .96) !important;
        color: var(--clt-due-text, #174ea6) !important;
        box-shadow: 0 2px 8px rgba(60, 64, 67, .18) !important;
        font: 700 12px/1.3 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        letter-spacing: 0 !important;
        white-space: nowrap !important;
        pointer-events: none !important;
      }

      li.clt-due-urgent {
        --clt-due-border: #d93025;
        --clt-due-inner: rgba(217, 48, 37, .38);
        --clt-due-outline: rgba(217, 48, 37, .16);
        --clt-due-glow: rgba(217, 48, 37, .36);
        --clt-due-text: #a50e0e;
      }

      li.clt-due-soon {
        --clt-due-border: #f29900;
        --clt-due-inner: rgba(242, 153, 0, .42);
        --clt-due-outline: rgba(242, 153, 0, .18);
        --clt-due-glow: rgba(242, 153, 0, .38);
        --clt-due-text: #9a5500;
      }

      li.clt-due-upcoming {
        --clt-due-border: #1a73e8;
        --clt-due-inner: rgba(26, 115, 232, .34);
        --clt-due-outline: rgba(26, 115, 232, .14);
        --clt-due-glow: rgba(26, 115, 232, .28);
        --clt-due-text: #174ea6;
      }
    `;
  }
})();
