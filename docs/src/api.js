import { getNextRound } from "./config.js";
import { saveLocalConfigOverride } from "./config.js";

const RECORDS_KEY = "sruds_records_v1";
const PENDING_KEY = "sruds_pending_v1";

export function createApi(config) {
  const appsScriptUrl = String(config.api?.appsScriptUrl || "").trim();
  const useLocalMock = !appsScriptUrl && config.api?.localMockWhenEmpty !== false;

  return {
    isLocalMock: useLocalMock,
    appsScriptUrl,
    async ping() {
      if (useLocalMock) return { ok: true, mode: "local" };
      return postAppsScript(appsScriptUrl, "ping", {});
    },
    async initialize(adminPin) {
      if (useLocalMock) return { ok: true, mode: "local", initialized: true };
      return postAppsScript(appsScriptUrl, "initialize", { adminPin });
    },
    async getStatus(recruitNo, cohort = "") {
      if (useLocalMock) return mockGetStatus(config, recruitNo, cohort);
      const result = await postAppsScript(appsScriptUrl, "getStatus", {
        cohort,
        recruitNo,
        roundIds: config.rounds.map((round) => round.roundId)
      });
      if (!result.nextRoundId) {
        const next = getNextRound(config, result);
        return { ...result, nextRoundId: next?.roundId || null };
      }
      return result;
    },
    async submitIssue(payload) {
      if (useLocalMock) return mockSubmitIssue(config, payload);
      try {
        return await postAppsScript(appsScriptUrl, "submitIssue", payload);
      } catch (error) {
        savePending(payload);
        error.pendingSaved = true;
        throw error;
      }
    },
    async adminSummary(adminPin) {
      if (useLocalMock) return mockAdminSummary(config, adminPin);
      return postAppsScript(appsScriptUrl, "adminSummary", { adminPin });
    },
    async saveConfig(adminPin, nextConfig) {
      if (useLocalMock) {
        saveLocalConfigOverride(nextConfig);
        return { ok: true, config: nextConfig, message: "로컬 설정이 저장되었습니다." };
      }
      return postAppsScript(appsScriptUrl, "saveConfig", { adminPin, config: nextConfig });
    },
    async changeAdminPin(currentPin, nextPin) {
      if (useLocalMock) return { ok: true, message: "로컬 모드에서는 PIN 변경을 저장하지 않습니다." };
      return postAppsScript(appsScriptUrl, "changeAdminPin", { adminPin: currentPin, nextPin });
    },
    async resetAllData(adminPin) {
      if (useLocalMock) return mockResetAllData();
      return postAppsScript(appsScriptUrl, "resetAllData", { adminPin });
    },
    listPending() {
      return readJson(PENDING_KEY, []);
    },
    clearPending(submissionId) {
      const pending = readJson(PENDING_KEY, []).filter((entry) => entry.submissionId !== submissionId);
      writeJson(PENDING_KEY, pending);
    }
  };
}

export function buildSubmissionPayload({ config, round, profile, issueItems }) {
  const submissionId = `${profile.cohort || "cohort"}-${profile.recruitNo}-${round.roundId}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  return {
    submissionId,
    cohort: profile.cohort,
    recruitNo: profile.recruitNo,
    height: "",
    weight: "",
    bmi: "",
    footSize: "",
    headSize: "",
    configVersion: config.configVersion,
    roundId: round.roundId,
    roundName: round.label,
    items: issueItems.map((item) => ({
      itemId: item.itemId,
      itemName: item.label,
      recommendedSize: item.recommendation.recommendedSize,
      finalSize: item.finalSize,
      changed: item.recommendation.inputMode !== "direct" && item.finalSize !== item.recommendation.recommendedSize,
      changeReason: item.changeReason || ""
    })),
    learningItems: issueItems
      .filter((item) => item.recommendation.inputMode !== "direct")
      .map((item) => buildLearningItem(item, profile, config, round))
  };
}

async function postAppsScript(url, action, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify({ action, ...payload })
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("서버 응답을 해석하지 못했습니다.");
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || "서버 요청에 실패했습니다.");
  }
  return data;
}

function mockGetStatus(config, recruitNo, cohort = "") {
  const rows = readRecords(config).filter((row) =>
    String(row.recruit_no) === String(recruitNo) &&
    String(row.cohort || "") === String(cohort || "")
  );
  const completedRoundIds = [...new Set(rows.map((row) => row.round_id))];
  const next = getNextRound(config, { completedRoundIds });
  return {
    ok: true,
    recruitNo: String(recruitNo),
    completedRoundIds,
    nextRoundId: next?.roundId || null,
    records: rows
  };
}

function mockSubmitIssue(config, payload) {
  const records = readRecords(config);
  const duplicate = records.some((row) => row.submission_id === payload.submissionId);
  if (duplicate) {
    return { ok: true, duplicate: true, records: records.filter((row) => row.submission_id === payload.submissionId) };
  }

  const duplicateRoundRows = records.filter((row) =>
    String(row.recruit_no) === String(payload.recruitNo) &&
    String(row.cohort || "") === String(payload.cohort || "") &&
    String(row.round_id) === String(payload.roundId)
  );
  if (duplicateRoundRows.length) {
    return { ok: true, duplicate: true, records: duplicateRoundRows };
  }

  const timestamp = new Date().toISOString();
  const rows = payload.items.map((item) => ({
    submission_id: payload.submissionId,
    timestamp,
    cohort: String(payload.cohort || ""),
    recruit_no: String(payload.recruitNo),
    height_cm: "",
    weight_kg: "",
    bmi: "",
    round_id: payload.roundId,
    round_name: payload.roundName,
    item_id: item.itemId,
    item_name: item.itemName,
    recommended_size: item.recommendedSize,
    final_size: item.finalSize,
    changed: item.changed ? "Y" : "N",
    change_reason: item.changeReason || "",
    config_version: config.configVersion,
    foot_size: Number(payload.footSize) || "",
    head_size: Number(payload.headSize) || ""
  }));
  writeRecords([...records, ...rows]);
  writeJson("sruds_learning_v1", [
    ...readJson("sruds_learning_v1", []),
    ...(payload.learningItems || []).map((item) => ({
      timestamp,
      cohort: String(payload.cohort || ""),
      round_id: payload.roundId,
      round_name: payload.roundName,
      item_id: item.itemId,
      item_name: item.itemName,
      recommendation_type: item.recommendationType,
      recommended_size: item.recommendedSize,
      final_size: item.finalSize,
      changed: item.changed ? "Y" : "N",
      size_delta: item.sizeDelta,
      bmi_bucket: item.bmiBucket,
      dis_bucket: item.disBucket,
      config_version: item.configVersion || config.configVersion
    }))
  ]);
  return { ok: true, duplicate: false, records: rows };
}

function mockAdminSummary(config, adminPin) {
  if (!String(adminPin || "").trim()) {
    return { ok: false, message: "관리자 PIN을 입력해 주세요." };
  }
  return { ok: true, ...buildSummary(config, readRecords(config)) };
}

function mockResetAllData() {
  writeJson(RECORDS_KEY, []);
  writeJson("sruds_learning_v1", []);
  writeJson(PENDING_KEY, []);
  return { ok: true, message: "전체 초기화가 완료되었습니다." };
}

function buildSummary(config, records) {
  const bySize = new Map();
  const byPerson = new Map();
  const completedPeopleByRound = new Map();
  let changedItems = 0;

  records.forEach((row) => {
    if (row.changed === "Y" || row.changed === true) changedItems += 1;
    const sizeKey = [row.round_id, row.item_id, row.final_size].join("|");
    const sizeEntry = bySize.get(sizeKey) || {
      roundId: row.round_id,
      roundName: row.round_name,
      itemId: row.item_id,
      itemName: row.item_name,
      size: row.final_size,
      count: 0,
      changedCount: 0
    };
    sizeEntry.count += 1;
    if (row.changed === "Y" || row.changed === true) sizeEntry.changedCount += 1;
    bySize.set(sizeKey, sizeEntry);

    const personKey = [row.cohort || "", row.recruit_no, row.round_id].join("|");
    const person = byPerson.get(personKey) || {
      cohort: row.cohort || "",
      recruitNo: row.recruit_no,
      roundId: row.round_id,
      roundName: row.round_name,
      changedCount: 0,
      items: {}
    };
    person.items[row.item_name] = row.final_size;
    if (row.changed === "Y" || row.changed === true) person.changedCount += 1;
    byPerson.set(personKey, person);

    const roundPeople = completedPeopleByRound.get(row.round_id) || new Set();
    roundPeople.add(`${row.cohort || ""}|${row.recruit_no}`);
    completedPeopleByRound.set(row.round_id, roundPeople);
  });

  const personColumns = config.items.map((item) => item.label);
  const completedRounds = config.rounds.map((round) => ({
    roundId: round.roundId,
    roundName: round.label,
    peopleCount: completedPeopleByRound.get(round.roundId)?.size || 0
  }));

  return {
    overview: {
      totalItems: records.length,
      totalPeople: new Set(records.map((row) => `${row.cohort || ""}|${row.recruit_no}`)).size,
      changedItems,
      exchangeRate: records.length ? Number(((changedItems / records.length) * 100).toFixed(1)) : 0,
      completedRounds
    },
    sizeSummary: [...bySize.values()].sort(summarySorter),
    personColumns,
    personSummary: [...byPerson.values()].sort((a, b) => String(a.cohort || "").localeCompare(String(b.cohort || ""), "ko") || String(a.recruitNo).localeCompare(String(b.recruitNo), "ko") || String(a.roundId).localeCompare(String(b.roundId), "ko")),
    learningSummary: buildLearningSummary(readJson("sruds_learning_v1", [])),
    records
  };
}

function buildLearningItem(item, profile, config, round) {
  const recommended = String(item.recommendation.recommendedSize || "");
  const finalSize = String(item.finalSize || "");
  return {
    cohort: profile.cohort,
    roundId: round.roundId,
    itemId: item.itemId,
    itemName: item.label,
    recommendationType: item.recommendationType || "manual",
    recommendedSize: recommended,
    finalSize,
    changed: item.recommendation.inputMode !== "direct" && recommended && finalSize && recommended !== finalSize,
    sizeDelta: sizeDelta(recommended, finalSize),
    bmiBucket: bucket(profile.bmi, 0.5),
    disBucket: bucket(profile.weight - expectedWeight(profile.height), 5),
    configVersion: config.configVersion
  };
}

function sizeDelta(recommended, finalSize) {
  const recommendedWidth = Number(String(recommended).split("-")[0]);
  const finalWidth = Number(String(finalSize).split("-")[0]);
  if (!Number.isFinite(recommendedWidth) || !Number.isFinite(finalWidth)) return 0;
  return finalWidth - recommendedWidth;
}

function expectedWeight(height) {
  const meters = Math.max(Number(height) / 100, 0.1);
  return 24 * meters * meters;
}

function bucket(value, step) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return Math.round(numeric / step) * step;
}

function buildLearningSummary(rows) {
  const byDate = new Map();
  (rows || []).forEach((row) => {
    const date = String(row.timestamp || "").slice(0, 10) || "-";
    const entry = byDate.get(date) || { date, count: 0, changed: 0, deltaSum: 0 };
    entry.count += 1;
    if (row.changed === "Y" || row.changed === true) entry.changed += 1;
    entry.deltaSum += Number(row.size_delta || row.sizeDelta || 0);
    byDate.set(date, entry);
  });
  const history = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date), "ko"));
  let adjustment = 0;
  return {
    totalRows: rows.length,
    changedRows: rows.filter((row) => row.changed === "Y" || row.changed === true).length,
    baselineA: 24,
    currentA: 24 + history.reduce((sum, row) => sum + Math.sign(row.deltaSum) * 0.02, 0),
    history: history.map((row) => {
      adjustment += Math.sign(row.deltaSum) * 0.02;
      return {
        date: row.date,
        count: row.count,
        changeRate: row.count ? Number(((row.changed / row.count) * 100).toFixed(1)) : 0,
        aValue: Number((24 + adjustment).toFixed(2))
      };
    })
  };
}

function summarySorter(a, b) {
  return String(a.roundName).localeCompare(String(b.roundName), "ko") || String(a.itemName).localeCompare(String(b.itemName), "ko") || String(a.size).localeCompare(String(b.size), "ko");
}

function savePending(payload) {
  const pending = readJson(PENDING_KEY, []);
  pending.push({ ...payload, savedAt: new Date().toISOString() });
  writeJson(PENDING_KEY, pending);
}

function readRecords(config) {
  const stored = readJson(RECORDS_KEY, null);
  if (Array.isArray(stored)) return stored;
  if (config?.api?.demoDataWhenEmpty === true) return buildDemoRecords(config);
  return [];
}

function writeRecords(records) {
  writeJson(RECORDS_KEY, records);
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function buildDemoRecords(config) {
  const people = [
    { cohort: "26-1기", recruitNo: "2401", height: 171, weight: 66 },
    { cohort: "26-1기", recruitNo: "2402", height: 178, weight: 75 },
    { cohort: "26-2기", recruitNo: "2401", height: 184, weight: 83 },
    { cohort: "26-2기", recruitNo: "2402", height: 169, weight: 59 }
  ];
  const today = new Date();
  const rows = [];

  config.rounds.forEach((round, roundIndex) => {
    const items = (round.itemIds || []).map((itemId) => config.itemMap?.[itemId] || config.items.find((item) => item.itemId === itemId)).filter(Boolean);
    people.forEach((person, personIndex) => {
      if (roundIndex === config.rounds.length - 1 && personIndex > 1) return;
      const timestamp = new Date(today);
      timestamp.setDate(today.getDate() - ((personIndex + roundIndex) % 4));
      timestamp.setHours(9 + roundIndex, 10 + personIndex, 0, 0);
      const submissionId = `demo-${person.recruitNo}-${round.roundId}`;
      items.forEach((item, itemIndex) => {
        const recommended = demoSize(item, personIndex + roundIndex + itemIndex);
        const changed = (personIndex + roundIndex + itemIndex) % 5 === 0;
        const finalSize = changed ? demoSize(item, personIndex + roundIndex + itemIndex + 1) : recommended;
        rows.push({
          submission_id: submissionId,
          timestamp: timestamp.toISOString(),
          cohort: person.cohort,
          recruit_no: person.recruitNo,
          height_cm: "",
          weight_kg: "",
          bmi: "",
          round_id: round.roundId,
          round_name: round.label,
          item_id: item.itemId,
          item_name: item.label,
          recommended_size: recommended,
          final_size: finalSize,
          changed: changed ? "Y" : "N",
          change_reason: changed ? "현장 교체" : "",
          config_version: config.configVersion
        });
      });
    });
  });

  return rows;
}

function demoSize(item, seed) {
  const sizes = item.sizes || [];
  if (!sizes.length) return "-";
  return sizes[Math.abs(seed) % sizes.length];
}
