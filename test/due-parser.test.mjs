import assert from "node:assert/strict";

await import("../src/content/due-parser.js");

const { buildDueItem, parseAssignmentText, parseDueDay } = globalThis.CLT.dueWork;
const monday = new Date("2026-06-29T12:00:00+09:00");

assert.deepEqual(
  parseAssignmentText("23:59 – 授業課題", "課題: 授業課題、明日まで"),
  {
    timeLabel: "23:59",
    title: "授業課題"
  }
);

assert.equal(parseDueDay("明日まで", monday).toISOString(), "2026-06-29T15:00:00.000Z");
assert.equal(parseDueDay("期限: 日曜日", monday).toISOString(), "2026-07-04T15:00:00.000Z");
assert.equal(parseDueDay("期限: 木曜日", monday).toISOString(), "2026-07-01T15:00:00.000Z");

const tomorrowItem = buildDueItem({
  courseTitle: "2026_総合英語1_月水4",
  courseUrl: "https://classroom.google.com/u/0/c/course-id",
  heading: "明日まで",
  assignmentText: "23:59 – 授業課題",
  assignmentUrl: "https://classroom.google.com/u/0/c/course-id/a/work-id/details",
  ariaLabel: "課題: 授業課題、明日まで"
}, monday);

assert.equal(tomorrowItem.assignmentTitle, "授業課題");
assert.equal(tomorrowItem.dueLabel, "明日まで 23:59");
assert.equal(tomorrowItem.severity, "soon");
assert.equal(tomorrowItem.dueAt, "2026-06-30T14:59:00.000Z");
