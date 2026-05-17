import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildProfile, recommendRoundItems } from "../docs/src/recommender.js";
import { buildSubmissionPayload } from "../docs/src/api.js";
import { getRoundItems, normalizeConfig } from "../docs/src/config.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(repoRoot, "docs", "data", "distribution-config.json");
const adminPin = process.argv[2];

if (!adminPin) {
  console.error("Usage: npm run smoke-live-api -- <관리자PIN>");
  process.exit(1);
}

const staticConfig = JSON.parse(await readFile(configPath, "utf-8"));
const endpoint = String(staticConfig.api?.appsScriptUrl || "").trim();
if (!endpoint) {
  console.error("api.appsScriptUrl이 비어 있습니다. npm run connect-api를 먼저 실행하세요.");
  process.exit(1);
}

const ping = await post(endpoint, "ping", {});
assert(ping.ok, "ping 실패");
assert(ping.spreadsheetOk, ping.spreadsheetMessage || "스프레드시트 연결 실패");

const initialized = await post(endpoint, "initialize", { adminPin });
assert(initialized.ok && initialized.initialized, "initialize 실패");

const runtimeConfigResponse = await post(endpoint, "getConfig", {});
const config = normalizeConfig(runtimeConfigResponse.config || staticConfig);
assert(config.rounds.length >= 4, "4개 이상 차수 설정이 필요합니다.");

const before = await post(endpoint, "adminSummary", { adminPin });
assert(before.ok, "adminSummary 최초 조회 실패");

const recruitNo = `99${Date.now().toString().slice(-8)}`;
const cohort = `smoke-${new Date().toISOString().slice(5, 10)}`;
console.log(`live smoke cohort/recruitNo: ${cohort} ${recruitNo}`);
const profile = buildProfile({ cohort, recruitNo, height: 177, weight: 74 });
const initialStatus = await post(endpoint, "getStatus", {
  cohort,
  recruitNo,
  roundIds: config.rounds.map((round) => round.roundId)
});
assert(initialStatus.nextRoundId === config.rounds[0].roundId, "신규 교번의 다음 차수가 1차가 아닙니다.");

const submitted = [];
for (const round of config.rounds) {
  const roundItems = getRoundItems(config, round);
  assert(roundItems.length > 0, `${round.label}에 품목이 없습니다.`);

  const issueItems = recommendRoundItems(roundItems, profile).map(applySmokeDirectSelection);
  const payload = buildSubmissionPayload({ config, round, profile, issueItems });
  payload.submissionId = `live-smoke-${recruitNo}-${round.roundId}`;

  const result = await post(endpoint, "submitIssue", payload);
  assert(result.ok, `${round.label} 저장 실패`);
  assert(result.records?.length === payload.items.length, `${round.label} 저장 행 수 불일치`);

  const duplicate = await post(endpoint, "submitIssue", payload);
  assert(duplicate.ok && duplicate.duplicate === true, `${round.label} 중복 저장 방지 실패`);

  const duplicateRound = await post(endpoint, "submitIssue", {
    ...payload,
    submissionId: `${payload.submissionId}-different-id`
  });
  assert(duplicateRound.ok && duplicateRound.duplicate === true, `${round.label} 교번/차수 중복 저장 방지 실패`);

  const status = await post(endpoint, "getStatus", {
    cohort,
    recruitNo,
    roundIds: config.rounds.map((candidate) => candidate.roundId)
  });
  submitted.push({
    roundId: round.roundId,
    label: round.label,
    rows: result.records.length,
    completedRoundIds: status.completedRoundIds,
    nextRoundId: status.nextRoundId
  });
}

const finalStatus = await post(endpoint, "getStatus", {
  cohort,
  recruitNo,
  roundIds: config.rounds.map((round) => round.roundId)
});
assert(finalStatus.nextRoundId === null, "전체 차수 완료 후 nextRoundId가 null이 아닙니다.");
assert(finalStatus.completedRoundIds.length === config.rounds.length, "완료 차수 수가 설정과 다릅니다.");

const after = await post(endpoint, "adminSummary", { adminPin });
assert(after.ok, "adminSummary 최종 조회 실패");
const expectedAddedRows = config.rounds.reduce((sum, round) => sum + getRoundItems(config, round).length, 0);
const addedRows = Number(after.overview?.totalItems || 0) - Number(before.overview?.totalItems || 0);
assert(addedRows === expectedAddedRows, `추가 raw row 수 불일치: expected ${expectedAddedRows}, actual ${addedRows}`);
const personRows = (after.personSummary || []).filter((row) => String(row.cohort) === cohort && String(row.recruitNo) === recruitNo);
assert(personRows.length === config.rounds.length, "개인별 현황의 차수별 행 수가 맞지 않습니다.");

console.log(JSON.stringify({
  ok: true,
  cohort,
  recruitNo,
  spreadsheetName: ping.spreadsheetName,
  roundsTested: submitted.map((row) => row.label),
  rowsAdded: addedRows,
  totalItemsBefore: before.overview?.totalItems || 0,
  totalItemsAfter: after.overview?.totalItems || 0,
  finalCompletedRoundIds: finalStatus.completedRoundIds,
  finalNextRoundId: finalStatus.nextRoundId
}, null, 2));

async function post(url, action, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`JSON 응답이 아닙니다: ${text.slice(0, 120)}`);
    }
    if (!response.ok || data.ok === false) {
      throw new Error(data.message || `${action} 요청 실패`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function applySmokeDirectSelection(item) {
  if (item.recommendation.inputMode !== "direct") return item;
  const preferred = preferredDirectSize(item);
  return {
    ...item,
    finalSize: preferred,
    changed: false,
    changeReason: "직접 선택"
  };
}

function preferredDirectSize(item) {
  const sizes = (item.sizes || []).map(String);
  const preferred = item.recommendationType === "shoes" ? "265" :
    item.recommendationType === "beret" ? "58" :
      "중";
  return sizes.includes(preferred) ? preferred : sizes[Math.floor(sizes.length / 2)] || "";
}
