(() => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const WEEKDAY_INDEX = new Map([
    ["日曜日", 0],
    ["日曜", 0],
    ["日", 0],
    ["sunday", 0],
    ["sun", 0],
    ["月曜日", 1],
    ["月曜", 1],
    ["月", 1],
    ["monday", 1],
    ["mon", 1],
    ["火曜日", 2],
    ["火曜", 2],
    ["火", 2],
    ["tuesday", 2],
    ["tue", 2],
    ["水曜日", 3],
    ["水曜", 3],
    ["水", 3],
    ["wednesday", 3],
    ["wed", 3],
    ["木曜日", 4],
    ["木曜", 4],
    ["木", 4],
    ["thursday", 4],
    ["thu", 4],
    ["金曜日", 5],
    ["金曜", 5],
    ["金", 5],
    ["friday", 5],
    ["fri", 5],
    ["土曜日", 6],
    ["土曜", 6],
    ["土", 6],
    ["saturday", 6],
    ["sat", 6]
  ]);

  function buildDueItem(input, now = new Date()) {
    const heading = cleanText(input.heading);
    const assignment = parseAssignmentText(input.assignmentText, input.ariaLabel);
    const due = parseDueDate(heading, assignment.timeLabel, now);
    const dueLabel = buildDueLabel(heading, assignment.timeLabel);
    const title = assignment.title || cleanText(input.assignmentText) || "課題";
    const url = input.assignmentUrl || "";
    const courseTitle = cleanText(input.courseTitle) || "Classroom";

    return {
      id: url || `${courseTitle}:${dueLabel}:${title}`,
      courseTitle,
      courseUrl: input.courseUrl || "",
      assignmentTitle: title,
      assignmentUrl: url,
      dueLabel,
      dueAt: due.dueAt ? due.dueAt.toISOString() : "",
      daysUntil: due.daysUntil,
      hoursUntil: due.hoursUntil,
      severity: classifyDue(due)
    };
  }

  function parseAssignmentText(text, ariaLabel = "") {
    const clean = cleanText(text);
    const match = clean.match(/^(\d{1,2}:\d{2})\s*[–—-]\s*(.+)$/);
    const ariaTitle = parseTitleFromAria(ariaLabel);
    if (!match) {
      return {
        timeLabel: "",
        title: ariaTitle || clean
      };
    }

    return {
      timeLabel: match[1],
      title: ariaTitle || cleanText(match[2])
    };
  }

  function parseTitleFromAria(ariaLabel) {
    const match = cleanText(ariaLabel).match(/^(?:課題|assignment)\s*[:：]\s*(.+?)(?:、|,\s*).+$/i);
    return match ? cleanText(match[1]) : "";
  }

  function parseDueDate(heading, timeLabel, now = new Date()) {
    const date = parseDueDay(heading, now);
    if (!date) {
      return { dueAt: null, daysUntil: null, hoursUntil: null };
    }

    const time = parseTimeLabel(timeLabel);
    if (time) {
      date.setHours(time.hours, time.minutes, 0, 0);
    } else {
      date.setHours(23, 59, 0, 0);
    }

    const diffMs = date.getTime() - now.getTime();
    return {
      dueAt: date,
      daysUntil: Math.max(0, Math.ceil(diffMs / DAY_MS)),
      hoursUntil: Math.ceil(diffMs / (60 * 60 * 1000))
    };
  }

  function parseDueDay(rawHeading, now = new Date()) {
    const heading = cleanHeading(rawHeading);
    const today = startOfDay(now);

    if (/(今日|本日|today)/i.test(heading)) {
      return today;
    }
    if (/(明日|tomorrow)/i.test(heading)) {
      return addDays(today, 1);
    }

    const monthDay = heading.match(/(\d{1,2})月\s*(\d{1,2})日/);
    if (monthDay) {
      const month = Number(monthDay[1]) - 1;
      const day = Number(monthDay[2]);
      const candidate = new Date(now.getFullYear(), month, day);
      if (candidate.getTime() + DAY_MS < today.getTime()) {
        candidate.setFullYear(candidate.getFullYear() + 1);
      }
      return candidate;
    }

    const weekdayKey = [...WEEKDAY_INDEX.keys()].find((key) => new RegExp(`(^|\\s|:|：)${escapeRegExp(key)}($|\\s|まで)`, "i").test(heading));
    if (weekdayKey) {
      const target = WEEKDAY_INDEX.get(weekdayKey);
      const offset = (target - today.getDay() + 7) % 7;
      return addDays(today, offset);
    }

    return null;
  }

  function cleanHeading(heading) {
    return cleanText(heading)
      .replace(/^期限\s*[:：]\s*/i, "")
      .replace(/\s*まで$/i, "")
      .trim();
  }

  function parseTimeLabel(timeLabel) {
    const match = cleanText(timeLabel).match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      return null;
    }
    return {
      hours: Number(match[1]),
      minutes: Number(match[2])
    };
  }

  function buildDueLabel(heading, timeLabel) {
    const parts = [cleanText(heading), cleanText(timeLabel)].filter(Boolean);
    return parts.join(" ");
  }

  function classifyDue(due) {
    if (typeof due.hoursUntil !== "number") {
      return "upcoming";
    }
    if (due.hoursUntil <= 24) {
      return "urgent";
    }
    if (due.hoursUntil <= 48) {
      return "soon";
    }
    return "upcoming";
  }

  function summarizeDueItem(item) {
    return `${item.courseTitle}: ${item.dueLabel} - ${item.assignmentTitle}`;
  }

  function severityRank(severity) {
    if (severity === "urgent") {
      return 3;
    }
    if (severity === "soon") {
      return 2;
    }
    return 1;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  globalThis.CLT = globalThis.CLT || {};
  globalThis.CLT.dueWork = Object.freeze({
    buildDueItem,
    parseAssignmentText,
    parseDueDate,
    parseDueDay,
    severityRank,
    summarizeDueItem
  });
})();
