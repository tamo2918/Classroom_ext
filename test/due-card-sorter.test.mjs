import assert from "node:assert/strict";

await import("../src/content/due-parser.js");
await import("../src/content/due-card-sorter.js");

const {
  applyDueCardSort,
  clearDueCardSort,
  rankDueCardStates
} = globalThis.CLT.dueCardSorter;

const rankedNames = rankDueCardStates([
  {
    name: "no due first",
    originalIndex: 0,
    dueItems: []
  },
  {
    name: "upcoming known",
    originalIndex: 1,
    dueItems: [{ hoursUntil: 72, severity: "upcoming" }]
  },
  {
    name: "soon",
    originalIndex: 2,
    dueItems: [{ hoursUntil: 30, severity: "soon" }]
  },
  {
    name: "urgent",
    originalIndex: 3,
    dueItems: [{ hoursUntil: 4, severity: "urgent" }]
  },
  {
    name: "upcoming unknown",
    originalIndex: 4,
    dueItems: [{ hoursUntil: null, severity: "upcoming" }]
  },
  {
    name: "no due second",
    originalIndex: 5,
    dueItems: []
  }
]).map((state) => state.name);

assert.deepEqual(rankedNames, [
  "urgent",
  "soon",
  "upcoming known",
  "upcoming unknown",
  "no due first",
  "no due second"
]);

const tiedNames = rankDueCardStates([
  {
    name: "first tie",
    originalIndex: 0,
    dueItems: [{ hoursUntil: 24, severity: "soon" }]
  },
  {
    name: "second tie with more work",
    originalIndex: 1,
    dueItems: [
      { hoursUntil: 24, severity: "soon" },
      { hoursUntil: 48, severity: "soon" }
    ]
  },
  {
    name: "third tie",
    originalIndex: 2,
    dueItems: [{ hoursUntil: 24, severity: "soon" }]
  }
]).map((state) => state.name);

assert.deepEqual(tiedNames, [
  "second tie with more work",
  "first tie",
  "third tie"
]);

const cardA = makeCard();
const cardB = makeCard();
const cardC = makeCard();
const parent = { children: [cardA, cardB, cardC] };
for (const card of parent.children) {
  card.parentElement = parent;
}
cardA.style.setProperty("order", "12", "");

applyDueCardSort([
  {
    card: cardA,
    originalIndex: 0,
    dueItems: []
  },
  {
    card: cardB,
    originalIndex: 1,
    dueItems: [{ hoursUntil: 6, severity: "urgent" }]
  },
  {
    card: cardC,
    originalIndex: 2,
    dueItems: [{ hoursUntil: 36, severity: "soon" }]
  }
]);

assert.equal(cardB.style.getPropertyValue("order"), "0");
assert.equal(cardC.style.getPropertyValue("order"), "1");
assert.equal(cardA.style.getPropertyValue("order"), "2");
assert.equal(cardB.style.getPropertyPriority("order"), "important");

clearDueCardSort({
  querySelectorAll() {
    return [cardA, cardB, cardC].filter((card) => card.hasAttribute("data-clt-due-sort-order"));
  }
});

assert.equal(cardA.style.getPropertyValue("order"), "12");
assert.equal(cardB.style.getPropertyValue("order"), "");
assert.equal(cardC.style.getPropertyValue("order"), "");

function makeCard() {
  const attributes = new Map();
  const style = makeStyle();
  return {
    parentElement: null,
    style,
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    }
  };
}

function makeStyle() {
  const properties = new Map();
  const priorities = new Map();
  return {
    getPropertyPriority(name) {
      return priorities.get(name) || "";
    },
    getPropertyValue(name) {
      return properties.get(name) || "";
    },
    removeProperty(name) {
      properties.delete(name);
      priorities.delete(name);
    },
    setProperty(name, value, priority = "") {
      properties.set(name, String(value));
      priorities.set(name, priority);
    }
  };
}
