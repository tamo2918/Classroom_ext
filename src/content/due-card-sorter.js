(() => {
  const { severityRank } = globalThis.CLT.dueWork;
  const SORT_ORDER_ATTR = "data-clt-due-sort-order";
  const ORIGINAL_ORDER_ATTR = "data-clt-due-original-order";
  const ORIGINAL_ORDER_PRIORITY_ATTR = "data-clt-due-original-order-priority";
  const MAX_SORT_HOURS = Number.MAX_SAFE_INTEGER;

  function applyDueCardSort(cardStates) {
    const plans = buildDueCardSortPlan(cardStates);
    for (const plan of plans) {
      plan.states.forEach((state, index) => {
        rememberOriginalOrder(state.card);
        state.card.style.setProperty("order", String(index), "important");
        state.card.setAttribute(SORT_ORDER_ATTR, String(index + 1));
      });
    }
    return plans;
  }

  function clearDueCardSort(root = document) {
    root.querySelectorAll(`[${SORT_ORDER_ATTR}]`).forEach((card) => {
      if ((typeof HTMLElement === "undefined" || card instanceof HTMLElement) && card.style) {
        restoreOriginalOrder(card);
      }
      card.removeAttribute(SORT_ORDER_ATTR);
      card.removeAttribute(ORIGINAL_ORDER_ATTR);
      card.removeAttribute(ORIGINAL_ORDER_PRIORITY_ATTR);
    });
  }

  function rememberOriginalOrder(card) {
    if (!card.hasAttribute(ORIGINAL_ORDER_ATTR)) {
      card.setAttribute(ORIGINAL_ORDER_ATTR, card.style.getPropertyValue("order") || "");
      card.setAttribute(ORIGINAL_ORDER_PRIORITY_ATTR, card.style.getPropertyPriority("order") || "");
    }
  }

  function restoreOriginalOrder(card) {
    const original = card.getAttribute(ORIGINAL_ORDER_ATTR) || "";
    const priority = card.getAttribute(ORIGINAL_ORDER_PRIORITY_ATTR) || "";
    if (original) {
      card.style.setProperty("order", original, priority);
    } else {
      card.style.removeProperty("order");
    }
  }

  function buildDueCardSortPlan(cardStates) {
    const groups = collectSortableGroups(cardStates);
    return groups.map((states) => ({
      parent: states[0].card.parentElement,
      states: rankDueCardStates(states)
    }));
  }

  function collectSortableGroups(cardStates) {
    const groups = [];
    const parentToGroup = new Map();

    for (const state of cardStates || []) {
      const card = state?.card;
      const parent = card?.parentElement;
      if (!card || !parent) {
        continue;
      }
      if (!parentToGroup.has(parent)) {
        const group = [];
        parentToGroup.set(parent, group);
        groups.push(group);
      }
      parentToGroup.get(parent).push(state);
    }

    return groups
      .filter((states) => states.length > 1)
      .filter((states) => isCompleteDirectChildGroup(states));
  }

  function isCompleteDirectChildGroup(states) {
    const parent = states[0]?.card?.parentElement;
    if (!parent?.children) {
      return false;
    }

    const cards = new Set(states.map((state) => state.card));
    return Array.from(parent.children).every((child) => cards.has(child));
  }

  function rankDueCardStates(states) {
    return (states || []).slice().sort(compareDueCardStates);
  }

  function compareDueCardStates(a, b) {
    const metaA = getCardSortMeta(a);
    const metaB = getCardSortMeta(b);

    if (metaA.hasDue !== metaB.hasDue) {
      return metaA.hasDue ? -1 : 1;
    }

    if (metaA.hasDue && metaB.hasDue) {
      return metaA.soonestHours - metaB.soonestHours ||
        metaB.severity - metaA.severity ||
        metaB.itemCount - metaA.itemCount ||
        metaA.originalIndex - metaB.originalIndex;
    }

    return metaA.originalIndex - metaB.originalIndex;
  }

  function getCardSortMeta(state) {
    const dueItems = Array.isArray(state?.dueItems) ? state.dueItems : [];
    return {
      hasDue: dueItems.length > 0,
      itemCount: dueItems.length,
      originalIndex: numericValue(state?.originalIndex),
      severity: dueItems.reduce((rank, item) => Math.max(rank, severityRank(item?.severity)), 0),
      soonestHours: dueItems.reduce((hours, item) => Math.min(hours, numericValue(item?.hoursUntil)), MAX_SORT_HOURS)
    };
  }

  function numericValue(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : MAX_SORT_HOURS;
  }

  globalThis.CLT = globalThis.CLT || {};
  globalThis.CLT.dueCardSorter = Object.freeze({
    applyDueCardSort,
    buildDueCardSortPlan,
    clearDueCardSort,
    compareDueCardStates,
    rankDueCardStates
  });
})();
