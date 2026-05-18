const RAW_SHEET = "raw_records";
const SIZE_SHEET = "summary_by_size";
const PERSON_SHEET = "summary_by_person";
const EXCHANGE_SHEET = "exchange_summary";
const CONFIG_SHEET = "runtime_config";
const ML_SHEET = "ml_training";
const CONFIG_CHUNK_SIZE = 45000;
const SCRIPT_CODE_VERSION = "2026-05-18-personal-history-v4";

const RAW_HEADERS = [
  "submission_id",
  "timestamp",
  "recruit_no",
  "height_cm",
  "weight_kg",
  "bmi",
  "round_id",
  "round_name",
  "item_id",
  "item_name",
  "recommended_size",
  "final_size",
  "changed",
  "change_reason",
  "config_version",
  "foot_size",
  "head_size",
  "cohort",
  "personal_pin"
];

const ML_HEADERS = [
  "timestamp",
  "cohort",
  "round_id",
  "round_name",
  "item_id",
  "item_name",
  "recommendation_type",
  "recommended_size",
  "final_size",
  "changed",
  "size_delta",
  "bmi_bucket",
  "dis_bucket",
  "config_version"
];

function json_(value, callback) {
  const text = JSON.stringify(value);
  if (callback) {
    return ContentService
      .createTextOutput(String(callback) + "(" + text + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const payload = JSON.parse((e.postData && e.postData.contents) || "{}");
    const action = String(payload.action || "");

    if (action === "ping") {
      return json_(ping_());
    }
    if (action === "initialize") {
      return json_(initialize_(payload));
    }
    if (action === "getStatus") {
      return json_(getStatus_(payload));
    }
    if (action === "submitIssue") {
      return json_(submitIssue_(payload));
    }
    if (action === "adminSummary") {
      return json_(adminSummary_(payload));
    }
    if (action === "getConfig") {
      return json_(getConfig_());
    }
    if (action === "saveConfig") {
      return json_(saveConfig_(payload));
    }
    if (action === "changeAdminPin") {
      return json_(changeAdminPin_(payload));
    }
    if (action === "resetAllData") {
      return json_(resetAllData_(payload));
    }
    if (action === "getPersonalRecords") {
      return json_(getPersonalRecords_(payload));
    }
    if (action === "updatePersonalIssueRecords") {
      return json_(updatePersonalIssueRecords_(payload));
    }
    if (action === "updateIssueRecords") {
      return json_(updateIssueRecords_(payload));
    }
    if (action === "deleteIssueRecords") {
      return json_(deleteIssueRecords_(payload));
    }

    return json_({ ok: false, message: "알 수 없는 action입니다." });
  } catch (error) {
    return json_({ ok: false, message: error.message || String(error) });
  }
}

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = String(params.action || "ping");
    if (action === "ping") {
      return json_(ping_(), params.callback);
    }
    return json_({ ok: false, message: "GET은 ping만 지원합니다." }, params.callback);
  } catch (error) {
    return json_({ ok: false, message: error.message || String(error) });
  }
}

function setup() {
  ensureSheets_();
  refreshSummaries_();
}

function ping_() {
  const result = {
    ok: true,
    service: "Smart Recruit Uniform Distribution System",
    codeVersion: SCRIPT_CODE_VERSION,
    duplicatePolicy: "submission_id_and_recruit_round",
    spreadsheetOk: false,
    spreadsheetName: "",
    sheets: []
  };
  try {
    const spreadsheet = getSpreadsheet_();
    result.spreadsheetOk = true;
    result.spreadsheetName = spreadsheet.getName();
    result.sheets = spreadsheet.getSheets().map(function(sheet) {
      return sheet.getName();
    });
  } catch (error) {
    result.spreadsheetMessage = error.message || String(error);
  }
  return result;
}

function initialize_(payload) {
  assertAdmin_(payload.adminPin);
  ensureSheets_();
  refreshSummaries_();
  return Object.assign({ initialized: true }, ping_());
}

function getStatus_(payload) {
  ensureSheets_();
  const cohort = String(payload.cohort || "").trim();
  const recruitNo = String(payload.recruitNo || "").trim();
  if (!cohort) return { ok: false, message: "기수가 없습니다." };
  if (!recruitNo) return { ok: false, message: "교번이 없습니다." };

  const rows = readRawRecords_().filter(function(row) {
    return String(row.recruit_no) === recruitNo && String(row.cohort || "") === cohort;
  });
  const completedRoundIds = unique_(rows.map(function(row) {
    return String(row.round_id || "");
  }).filter(Boolean));
  const roundIds = payload.roundIds || [];
  const nextRoundId = roundIds.find(function(roundId) {
    return completedRoundIds.indexOf(String(roundId)) === -1;
  }) || null;

  return {
    ok: true,
    cohort: cohort,
    recruitNo: recruitNo,
    completedRoundIds: completedRoundIds,
    nextRoundId: nextRoundId,
    records: sanitizeRawRecordsForResponse_(rows)
  };
}

function submitIssue_(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ensureSheets_();
    validateSubmission_(payload);

    const rawSheet = getSheet_(RAW_SHEET);
    const existingRows = readRawRecords_();
    const duplicateRows = existingRows.filter(function(row) {
      return String(row.submission_id) === String(payload.submissionId);
    });
    if (duplicateRows.length) {
      const pinPatch = attachPersonalPinToRows_(existingRows, function(row) {
        return String(row.submission_id) === String(payload.submissionId);
      }, payload.personalPin);
      if (pinPatch.updatedCount) {
        writeSheet_(RAW_SHEET, RAW_HEADERS, pinPatch.rows.map(function(row) { return objectToRow_(RAW_HEADERS, row); }));
        const patchedRows = pinPatch.rows.filter(function(row) {
          return String(row.submission_id) === String(payload.submissionId);
        });
        return { ok: true, duplicate: true, pinAttached: true, records: sanitizeRawRecordsForResponse_(patchedRows) };
      }
      return { ok: true, duplicate: true, records: sanitizeRawRecordsForResponse_(duplicateRows) };
    }

    const existingRoundRows = existingRows.filter(function(row) {
      return String(row.recruit_no) === String(payload.recruitNo) &&
        String(row.cohort || "") === String(payload.cohort || "") &&
        String(row.round_id) === String(payload.roundId);
    });
    if (existingRoundRows.length) {
      const pinPatch = attachPersonalPinToRows_(existingRows, function(row) {
        return String(row.recruit_no) === String(payload.recruitNo) &&
          String(row.cohort || "") === String(payload.cohort || "") &&
          String(row.round_id) === String(payload.roundId);
      }, payload.personalPin);
      if (pinPatch.updatedCount) {
        writeSheet_(RAW_SHEET, RAW_HEADERS, pinPatch.rows.map(function(row) { return objectToRow_(RAW_HEADERS, row); }));
        const patchedRows = pinPatch.rows.filter(function(row) {
          return String(row.recruit_no) === String(payload.recruitNo) &&
            String(row.cohort || "") === String(payload.cohort || "") &&
            String(row.round_id) === String(payload.roundId);
        });
        return { ok: true, duplicate: true, pinAttached: true, records: sanitizeRawRecordsForResponse_(patchedRows) };
      }
      return { ok: true, duplicate: true, records: sanitizeRawRecordsForResponse_(existingRoundRows) };
    }

    const timestamp = new Date().toISOString();
    const values = payload.items.map(function(item) {
      return [
        payload.submissionId,
        timestamp,
        String(payload.recruitNo),
        "",
        "",
        "",
        payload.roundId,
        payload.roundName,
        item.itemId,
        item.itemName,
        item.recommendedSize,
        item.finalSize,
        item.changed ? "Y" : "N",
        item.changeReason || "",
        payload.configVersion || "",
        Number(payload.footSize) || "",
        Number(payload.headSize) || "",
        String(payload.cohort || ""),
        String(payload.personalPin || "")
      ];
    });

    rawSheet.getRange(rawSheet.getLastRow() + 1, 1, values.length, RAW_HEADERS.length).setValues(values);
    appendLearningRows_(payload, timestamp);
    refreshSummaries_();

    const records = values.map(function(row) {
      return rowToObject_(RAW_HEADERS, row);
    });
    return { ok: true, duplicate: false, records: sanitizeRawRecordsForResponse_(records) };
  } finally {
    lock.releaseLock();
  }
}

function adminSummary_(payload) {
  ensureSheets_();
  assertAdmin_(payload.adminPin);
  const summary = buildSummary_(readRawRecords_());
  summary.records = sanitizeRawRecordsForResponse_(summary.records);
  return Object.assign({ ok: true }, summary);
}

function getConfig_() {
  const config = readRuntimeConfig_();
  return { ok: true, config: config };
}

function saveConfig_(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    assertAdmin_(payload.adminPin);
    const config = normalizeConfigForStorage_(payload.config);
    writeRuntimeConfig_(config);
    return { ok: true, config: config };
  } finally {
    lock.releaseLock();
  }
}

function changeAdminPin_(payload) {
  assertAdmin_(payload.adminPin);
  const nextPin = String(payload.nextPin || "").trim();
  if (!/^[0-9]{4,12}$/.test(nextPin)) {
    throw new Error("새 PIN은 숫자 4~12자리로 설정해 주세요.");
  }
  PropertiesService.getScriptProperties().setProperty("ADMIN_PIN", nextPin);
  return { ok: true, message: "관리자 PIN을 변경했습니다." };
}

function resetAllData_(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    assertAdmin_(payload.adminPin);
    ensureSheets_();
    writeSheet_(RAW_SHEET, RAW_HEADERS, []);
    writeSheet_(ML_SHEET, ML_HEADERS, []);
    refreshSummaries_();
    return { ok: true, message: "전체 초기화가 완료되었습니다." };
  } finally {
    lock.releaseLock();
  }
}

function getPersonalRecords_(payload) {
  ensureSheets_();
  const cohort = String(payload.cohort || "").trim();
  const recruitNo = String(payload.recruitNo || "").trim();
  const personalPin = String(payload.personalPin || "").trim();
  if (!cohort || !recruitNo || !personalPin) {
    throw new Error("기수, 교번, 개인 PIN을 모두 입력해 주세요.");
  }
  if (!/^[0-9]{4}$/.test(personalPin)) {
    throw new Error("개인 PIN은 숫자 4자리로 입력해 주세요.");
  }

  const rows = readRawRecords_().filter(function(row) {
    return String(row.cohort || "") === cohort &&
      String(row.recruit_no || "") === recruitNo;
  });
  if (!rows.length) return { ok: true, records: [] };

  const rowsWithPin = rows.filter(function(row) {
    return String(row.personal_pin || "") === personalPin;
  });
  if (!rowsWithPin.length) {
    const hasLegacyRows = rows.some(function(row) { return !String(row.personal_pin || ""); });
    if (hasLegacyRows) throw new Error("개인 PIN이 설정되지 않은 기존 기록입니다. 관리자에게 문의해 주세요.");
    throw new Error("개인 PIN이 일치하지 않습니다.");
  }
  return { ok: true, records: sanitizeRawRecordsForResponse_(rowsWithPin) };
}

function updatePersonalIssueRecords_(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ensureSheets_();
    const cohort = String(payload.cohort || "").trim();
    const recruitNo = String(payload.recruitNo || "").trim();
    const roundId = String(payload.roundId || "").trim();
    const personalPin = String(payload.personalPin || "").trim();
    if (!cohort || !recruitNo || !roundId || !personalPin) {
      throw new Error("기수, 교번, 차수, 개인 PIN이 필요합니다.");
    }
    if (!/^[0-9]{4}$/.test(personalPin)) {
      throw new Error("개인 PIN은 숫자 4자리로 입력해 주세요.");
    }

    const rowsBefore = readRawRecords_();
    const hasOwnedRows = rowsBefore.some(function(row) {
      return String(row.cohort || "") === cohort &&
        String(row.recruit_no || "") === recruitNo &&
        String(row.personal_pin || "") === personalPin;
    });
    if (!hasOwnedRows) throw new Error("개인 PIN이 일치하지 않습니다.");

    const result = updateIssueRows_(rowsBefore, {
      cohort: cohort,
      recruitNo: recruitNo,
      roundId: roundId,
      items: payload.items || [],
      changeReason: "본인 수정",
      personalPin: personalPin
    });
    writeSheet_(RAW_SHEET, RAW_HEADERS, result.rows.map(function(row) { return objectToRow_(RAW_HEADERS, row); }));
    refreshSummaries_();
    return { ok: true, updatedCount: result.updatedCount, message: "불출 내역을 수정했습니다." };
  } finally {
    lock.releaseLock();
  }
}

function sanitizeRawRecordsForResponse_(records) {
  return records.map(function(row) {
    return sanitizeRawRecordForResponse_(row);
  });
}

function sanitizeRawRecordForResponse_(row) {
  const safeRow = Object.assign({}, row);
  delete safeRow.personal_pin;
  return safeRow;
}

function attachPersonalPinToRows_(rows, matcher, personalPin) {
  const pin = String(personalPin || "").trim();
  if (!/^[0-9]{4}$/.test(pin)) return { rows: rows, updatedCount: 0 };
  var updatedCount = 0;
  const nextRows = rows.map(function(row) {
    if (matcher(row) && !String(row.personal_pin || "").trim()) {
      row.personal_pin = pin;
      updatedCount += 1;
    }
    return row;
  });
  return { rows: nextRows, updatedCount: updatedCount };
}

function assertAdmin_(adminPin) {
  const savedPin = PropertiesService.getScriptProperties().getProperty("ADMIN_PIN");
  if (!savedPin) {
    throw new Error("ADMIN_PIN 스크립트 속성이 설정되지 않았습니다.");
  }
  if (String(adminPin || "") !== String(savedPin)) {
    throw new Error("관리자 PIN이 올바르지 않습니다.");
  }
}

function normalizeConfigForStorage_(config) {
  if (!config || typeof config !== "object") throw new Error("저장할 설정이 없습니다.");
  if (!Array.isArray(config.rounds) || !config.rounds.length) throw new Error("불출 차수 설정이 없습니다.");
  if (!Array.isArray(config.items) || !config.items.length) throw new Error("품목 설정이 없습니다.");

  const itemIds = {};
  const items = config.items.map(function(item, index) {
    const itemId = String(item.itemId || "").trim();
    if (!itemId) throw new Error("품목 ID가 비어 있습니다.");
    if (itemIds[itemId]) throw new Error("품목 ID가 중복되었습니다: " + itemId);
    itemIds[itemId] = true;
    return {
      itemId: itemId,
      label: String(item.label || itemId).trim(),
      image: String(item.image || "").trim(),
      imagePosition: String(item.imagePosition || "center").trim(),
      imageSize: String(item.imageSize || "contain").trim(),
      sizes: Array.isArray(item.sizes) ? item.sizes.map(function(size) { return String(size).trim(); }).filter(Boolean) : [],
      recommendationType: String(item.recommendationType || "manual").trim(),
      order: Number(item.order || index * 10)
    };
  });

  const rounds = config.rounds.map(function(round, index) {
    const roundId = String(round.roundId || "").trim();
    if (!roundId) throw new Error("차수 ID가 비어 있습니다.");
    return {
      roundId: roundId,
      label: String(round.label || roundId).trim(),
      order: Number(round.order || index * 10),
      itemIds: (round.itemIds || []).map(function(itemId) { return String(itemId).trim(); }).filter(function(itemId) {
        return Boolean(itemId && itemIds[itemId]);
      })
    };
  });

  return Object.assign({}, config, {
    configVersion: String(config.configVersion || new Date().toISOString()),
    rounds: rounds,
    items: items,
    cohorts: normalizeCohortsForStorage_(config.cohorts),
    metadata: Object.assign({}, config.metadata || {}, {
      creators: normalizeCreatorsForStorage_(config.metadata && config.metadata.creators)
    })
  });
}

function normalizeCohortsForStorage_(cohorts) {
  const source = Array.isArray(cohorts) ? cohorts : [];
  const seen = {};
  const normalized = source.map(function(cohort, index) {
    const rawLabel = typeof cohort === "string" ? cohort : cohort && cohort.label;
    const label = String(rawLabel || "").trim().replace(/\s+/g, "");
    if (!label) return null;
    if (seen[label]) throw new Error("기수가 중복되었습니다: " + label);
    seen[label] = true;
    return {
      cohortId: sanitizeConfigId_(typeof cohort === "object" && cohort ? cohort.cohortId : label) || sanitizeConfigId_(label),
      label: label,
      order: Number(typeof cohort === "object" && cohort ? cohort.order : index + 1) || index + 1,
      active: typeof cohort === "object" && cohort && cohort.active === false ? false : true
    };
  }).filter(Boolean).sort(function(a, b) {
    return Number(a.order || 0) - Number(b.order || 0);
  });
  if (!normalized.length) throw new Error("기수는 최소 1개 이상 필요합니다.");
  return normalized;
}

function normalizeCreatorsForStorage_(creators) {
  return (Array.isArray(creators) ? creators : [])
    .map(function(creator) { return String(creator || "").trim(); })
    .filter(Boolean);
}

function sanitizeConfigId_(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/^_+|_+$/g, "");
}

function validateSubmission_(payload) {
  if (!String(payload.submissionId || "").trim()) throw new Error("submissionId가 없습니다.");
  if (!String(payload.cohort || "").trim()) throw new Error("기수가 없습니다.");
  if (!String(payload.recruitNo || "").trim()) throw new Error("교번이 없습니다.");
  if (!String(payload.roundId || "").trim()) throw new Error("불출 차수가 없습니다.");
  if (!/^[0-9]{4}$/.test(String(payload.personalPin || "").trim())) throw new Error("개인 PIN은 숫자 4자리로 설정해 주세요.");
  if (!Array.isArray(payload.items) || payload.items.length === 0) throw new Error("불출 품목이 없습니다.");
}

function refreshSummaries_() {
  const records = readRawRecords_();
  const summary = buildSummary_(records);

  writeSheet_(SIZE_SHEET, ["round_id", "round_name", "item_id", "item_name", "final_size", "count", "changed_count"], summary.sizeSummary.map(function(row) {
    return [row.roundId, row.roundName, row.itemId, row.itemName, row.size, row.count, row.changedCount];
  }));

  const personHeaders = ["cohort", "recruit_no", "round_id", "round_name"].concat(summary.personColumns).concat(["changed_count"]);
  writeSheet_(PERSON_SHEET, personHeaders, summary.personSummary.map(function(row) {
    return [row.cohort, row.recruitNo, row.roundId, row.roundName]
      .concat(summary.personColumns.map(function(column) { return row.items[column] || ""; }))
      .concat([row.changedCount]);
  }));

  writeSheet_(EXCHANGE_SHEET, ["round_id", "round_name", "item_id", "item_name", "total_count", "changed_count", "change_rate"], summary.exchangeSummary.map(function(row) {
    return [row.roundId, row.roundName, row.itemId, row.itemName, row.totalCount, row.changedCount, row.changeRate];
  }));

  writeSheet_("ml_summary", ["date", "event_count", "changed_count", "change_rate", "estimated_a"], summary.learningSummary.history.map(function(row) {
    return [row.date, row.count, row.changed, row.changeRate, row.aValue];
  }));
}

function buildSummary_(records) {
  const bySize = {};
  const byPerson = {};
  const byExchange = {};
  const completedPeopleByRound = {};
  const itemColumns = [];
  let changedItems = 0;

  records.forEach(function(row) {
    const changed = row.changed === "Y" || row.changed === true;
    if (changed) changedItems += 1;
    if (itemColumns.indexOf(row.item_name) === -1) itemColumns.push(row.item_name);

    const sizeKey = [row.round_id, row.item_id, row.final_size].join("|");
    bySize[sizeKey] = bySize[sizeKey] || {
      roundId: row.round_id,
      roundName: row.round_name,
      itemId: row.item_id,
      itemName: row.item_name,
      size: row.final_size,
      count: 0,
      changedCount: 0
    };
    bySize[sizeKey].count += 1;
    if (changed) bySize[sizeKey].changedCount += 1;

    const personKey = [row.cohort || "", row.recruit_no, row.round_id].join("|");
    byPerson[personKey] = byPerson[personKey] || {
      cohort: row.cohort || "",
      recruitNo: row.recruit_no,
      roundId: row.round_id,
      roundName: row.round_name,
      changedCount: 0,
      items: {}
    };
    byPerson[personKey].items[row.item_name] = row.final_size;
    if (changed) byPerson[personKey].changedCount += 1;

    const exchangeKey = [row.round_id, row.item_id].join("|");
    byExchange[exchangeKey] = byExchange[exchangeKey] || {
      roundId: row.round_id,
      roundName: row.round_name,
      itemId: row.item_id,
      itemName: row.item_name,
      totalCount: 0,
      changedCount: 0,
      changeRate: 0
    };
    byExchange[exchangeKey].totalCount += 1;
    if (changed) byExchange[exchangeKey].changedCount += 1;

    completedPeopleByRound[row.round_id] = completedPeopleByRound[row.round_id] || {};
    completedPeopleByRound[row.round_id][String(row.cohort || "") + "|" + row.recruit_no] = true;
  });

  const exchangeSummary = Object.keys(byExchange).map(function(key) {
    const row = byExchange[key];
    row.changeRate = row.totalCount ? Math.round((row.changedCount / row.totalCount) * 1000) / 10 : 0;
    return row;
  }).sort(summarySorter_);

  const completedRounds = Object.keys(completedPeopleByRound).map(function(roundId) {
    const matchingRound = records.find(function(row) {
      return row.round_id === roundId;
    });
    return {
      roundId: roundId,
      roundName: matchingRound ? matchingRound.round_name : roundId,
      peopleCount: Object.keys(completedPeopleByRound[roundId]).length
    };
  }).sort(function(a, b) {
    return String(a.roundId).localeCompare(String(b.roundId), "ko");
  });

  return {
    overview: {
      totalItems: records.length,
      totalPeople: unique_(records.map(function(row) { return String(row.cohort || "") + "|" + row.recruit_no; })).length,
      changedItems: changedItems,
      exchangeRate: records.length ? Math.round((changedItems / records.length) * 1000) / 10 : 0,
      completedRounds: completedRounds
    },
    sizeSummary: Object.keys(bySize).map(function(key) { return bySize[key]; }).sort(summarySorter_),
    personColumns: itemColumns,
    personSummary: Object.keys(byPerson).map(function(key) { return byPerson[key]; }).sort(function(a, b) {
      return String(a.cohort || "").localeCompare(String(b.cohort || ""), "ko") ||
        String(a.recruitNo).localeCompare(String(b.recruitNo), "ko") ||
        String(a.roundId).localeCompare(String(b.roundId), "ko");
    }),
    exchangeSummary: exchangeSummary,
    learningSummary: buildLearningSummary_(readLearningRecords_()),
    records: records
  };
}

function updateIssueRecords_(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    assertAdmin_(payload.adminPin);
    ensureSheets_();

    const cohort = String(payload.cohort || "").trim();
    const recruitNo = String(payload.recruitNo || "").trim();
    const roundId = String(payload.roundId || "").trim();
    if (!cohort || !recruitNo || !roundId) throw new Error("수정할 기수, 교번, 차수 정보가 필요합니다.");

    const result = updateIssueRows_(readRawRecords_(), {
      cohort: cohort,
      recruitNo: recruitNo,
      roundId: roundId,
      items: payload.items || [],
      changeReason: "관리자 수정"
    });
    writeSheet_(RAW_SHEET, RAW_HEADERS, result.rows.map(function(row) { return objectToRow_(RAW_HEADERS, row); }));
    refreshSummaries_();
    return { ok: true, updatedCount: result.updatedCount, message: "불출 내역을 수정했습니다." };
  } finally {
    lock.releaseLock();
  }
}

function updateIssueRows_(rows, options) {
  const itemUpdates = {};
  (options.items || []).forEach(function(item) {
    const itemId = String(item.itemId || "").trim();
    if (itemId) itemUpdates[itemId] = String(item.finalSize || "").trim();
  });
  if (!Object.keys(itemUpdates).length) throw new Error("수정할 품목이 없습니다.");

  var updatedCount = 0;
  const nextRows = rows.map(function(row) {
    const itemId = String(row.item_id || "");
    const baseMatch = String(row.cohort || "") === String(options.cohort || "") &&
      String(row.recruit_no || "") === String(options.recruitNo || "") &&
      String(row.round_id || "") === String(options.roundId || "") &&
      Object.prototype.hasOwnProperty.call(itemUpdates, itemId);
    const pinMatch = !options.personalPin || String(row.personal_pin || "") === String(options.personalPin || "");
    if (!baseMatch || !pinMatch) return row;

    const finalSize = itemUpdates[itemId];
    const changed = isEditedSizeChanged_(row, finalSize);
    row.final_size = finalSize;
    row.changed = changed ? "Y" : "N";
    row.change_reason = changed ? String(options.changeReason || "수정") : "";
    updatedCount += 1;
    return row;
  });

  if (!updatedCount) throw new Error("수정할 불출 기록을 찾지 못했습니다.");
  return { rows: nextRows, updatedCount: updatedCount };
}

function isEditedSizeChanged_(row, finalSize) {
  const nextFinalSize = String(finalSize || "").trim();
  const previousFinalSize = String(row.final_size || "").trim();
  const recommendedSize = String(row.recommended_size || "").trim();
  const hasRecommendation = Boolean(recommendedSize && recommendedSize !== "-");
  if (hasRecommendation) return Boolean(nextFinalSize && nextFinalSize !== recommendedSize);
  if (nextFinalSize !== previousFinalSize) return Boolean(nextFinalSize);
  return row.changed === "Y" || row.changed === true;
}

function deleteIssueRecords_(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    assertAdmin_(payload.adminPin);
    ensureSheets_();

    const cohort = String(payload.cohort || "").trim();
    const recruitNo = String(payload.recruitNo || "").trim();
    const roundId = String(payload.roundId || "").trim();
    if (!cohort || !recruitNo || !roundId) throw new Error("삭제할 기수, 교번, 차수 정보가 필요합니다.");

    const rows = readRawRecords_();
    const remainingRows = rows.filter(function(row) {
      return !(String(row.cohort || "") === cohort &&
        String(row.recruit_no || "") === recruitNo &&
        String(row.round_id || "") === roundId);
    });
    const deletedCount = rows.length - remainingRows.length;

    if (!deletedCount) throw new Error("삭제할 불출 기록을 찾지 못했습니다.");
    writeSheet_(RAW_SHEET, RAW_HEADERS, remainingRows.map(function(row) { return objectToRow_(RAW_HEADERS, row); }));
    refreshSummaries_();
    return { ok: true, deletedCount: deletedCount, message: "불출 내역을 삭제했습니다." };
  } finally {
    lock.releaseLock();
  }
}

function ensureSheets_() {
  const rawSheet = getOrCreateSheet_(RAW_SHEET);
  ensureHeader_(rawSheet, RAW_HEADERS);
  ensureHeader_(getOrCreateSheet_(SIZE_SHEET), ["round_id", "round_name", "item_id", "item_name", "final_size", "count", "changed_count"]);
  ensureHeader_(getOrCreateSheet_(PERSON_SHEET), ["cohort", "recruit_no", "round_id", "round_name", "changed_count"]);
  ensureHeader_(getOrCreateSheet_(EXCHANGE_SHEET), ["round_id", "round_name", "item_id", "item_name", "total_count", "changed_count", "change_rate"]);
  ensureHeader_(getOrCreateSheet_(CONFIG_SHEET), ["chunk_index", "json_chunk", "updated_at"]);
  ensureHeader_(getOrCreateSheet_(ML_SHEET), ML_HEADERS);
  ensureHeader_(getOrCreateSheet_("ml_summary"), ["date", "event_count", "changed_count", "change_rate", "estimated_a"]);
}

function readRuntimeConfig_() {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(CONFIG_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return null;

  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  const jsonText = values
    .filter(function(row) { return row[1] !== ""; })
    .sort(function(a, b) { return Number(a[0]) - Number(b[0]); })
    .map(function(row) { return String(row[1]); })
    .join("");

  return jsonText ? JSON.parse(jsonText) : null;
}

function writeRuntimeConfig_(config) {
  const sheet = getOrCreateSheet_(CONFIG_SHEET);
  const jsonText = JSON.stringify(config);
  const timestamp = new Date().toISOString();
  const rows = [];
  for (var index = 0; index < jsonText.length; index += CONFIG_CHUNK_SIZE) {
    rows.push([rows.length, jsonText.slice(index, index + CONFIG_CHUNK_SIZE), timestamp]);
  }

  sheet.clearContents();
  sheet.getRange(1, 1, 1, 3).setValues([["chunk_index", "json_chunk", "updated_at"]]);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  }
  sheet.setFrozenRows(1);
}

function readRawRecords_() {
  const sheet = getSheet_(RAW_SHEET);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, RAW_HEADERS.length).getValues();
  return values
    .filter(function(row) { return row.some(function(cell) { return cell !== ""; }); })
    .map(function(row) { return rowToObject_(RAW_HEADERS, row); });
}

function appendLearningRows_(payload, timestamp) {
  const learningItems = payload.learningItems || [];
  if (!learningItems.length) return;
  const sheet = getOrCreateSheet_(ML_SHEET);
  const rows = learningItems.map(function(item) {
    return [
      timestamp,
      String(payload.cohort || ""),
      payload.roundId,
      payload.roundName,
      item.itemId,
      item.itemName,
      item.recommendationType || "",
      item.recommendedSize || "",
      item.finalSize || "",
      item.changed ? "Y" : "N",
      Number(item.sizeDelta || 0),
      item.bmiBucket || "",
      item.disBucket || "",
      item.configVersion || payload.configVersion || ""
    ];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, ML_HEADERS.length).setValues(rows);
}

function readLearningRecords_() {
  const sheet = getOrCreateSheet_(ML_SHEET);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, ML_HEADERS.length).getValues();
  return values
    .filter(function(row) { return row.some(function(cell) { return cell !== ""; }); })
    .map(function(row) { return rowToObject_(ML_HEADERS, row); });
}

function buildLearningSummary_(rows) {
  const byDate = {};
  rows.forEach(function(row) {
    const date = String(row.timestamp || "").slice(0, 10) || "-";
    byDate[date] = byDate[date] || { date: date, count: 0, changed: 0, deltaSum: 0 };
    byDate[date].count += 1;
    if (row.changed === "Y" || row.changed === true) byDate[date].changed += 1;
    byDate[date].deltaSum += Number(row.size_delta || 0);
  });
  var adjustment = 0;
  const history = Object.keys(byDate).sort().map(function(date) {
    const row = byDate[date];
    adjustment += Math.sign(row.deltaSum) * 0.02;
    return {
      date: row.date,
      count: row.count,
      changed: row.changed,
      changeRate: row.count ? Math.round((row.changed / row.count) * 1000) / 10 : 0,
      aValue: Math.round((24 + adjustment) * 100) / 100
    };
  });
  return {
    totalRows: rows.length,
    changedRows: rows.filter(function(row) { return row.changed === "Y" || row.changed === true; }).length,
    baselineA: 24,
    currentA: history.length ? history[history.length - 1].aValue : 24,
    history: history
  };
}

function writeSheet_(name, headers, rows) {
  const sheet = getOrCreateSheet_(name);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sheet.setFrozenRows(1);
}

function ensureHeader_(sheet, headers) {
  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const matches = headers.every(function(header, index) {
    return current[index] === header;
  });
  if (!matches) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function getSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error(name + " 시트를 찾을 수 없습니다. setup()을 먼저 실행해 주세요.");
  return sheet;
}

function getOrCreateSheet_(name) {
  const spreadsheet = getSpreadsheet_();
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("SPREADSHEET_ID 스크립트 속성을 설정해 주세요.");
  return SpreadsheetApp.openById(id);
}

function rowToObject_(headers, row) {
  const out = {};
  headers.forEach(function(header, index) {
    out[header] = row[index];
  });
  return out;
}

function objectToRow_(headers, object) {
  return headers.map(function(header) {
    return object[header] === undefined ? "" : object[header];
  });
}

function unique_(values) {
  return values.filter(function(value, index, array) {
    return array.indexOf(value) === index;
  });
}

function summarySorter_(a, b) {
  return String(a.roundName).localeCompare(String(b.roundName), "ko") ||
    String(a.itemName).localeCompare(String(b.itemName), "ko") ||
    String(a.size || "").localeCompare(String(b.size || ""), "ko");
}

function calcBmi_(height, weight) {
  const meters = Math.max(Number(height) / 100, 0.1);
  return Math.round((Number(weight) / (meters * meters)) * 10) / 10;
}
