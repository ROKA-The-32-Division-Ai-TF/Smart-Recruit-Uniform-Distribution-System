import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(repoRoot, "docs", "data", "distribution-config.json");
const config = JSON.parse(await readFile(configPath, "utf-8"));
const url = String(config.api?.appsScriptUrl || "").trim();
const adminPin = process.argv[2] || "";

if (!url) {
  console.error("docs/data/distribution-config.json의 api.appsScriptUrl이 비어 있습니다.");
  console.error("먼저 실행: npm run connect-api -- <Apps Script Web App URL>");
  process.exit(1);
}

const ping = await post(url, "ping", {});
console.log("ping:", JSON.stringify(ping, null, 2));

if (adminPin) {
  const initialized = await post(url, "initialize", { adminPin });
  console.log("initialize:", JSON.stringify(initialized, null, 2));
  const summary = await post(url, "adminSummary", { adminPin });
  console.log("adminSummary:", JSON.stringify({
    ok: summary.ok,
    totalItems: summary.overview?.totalItems,
    totalPeople: summary.overview?.totalPeople,
    completedRounds: summary.overview?.completedRounds
  }, null, 2));
} else {
  console.log("관리자 PIN을 인자로 주면 initialize/adminSummary까지 확인합니다.");
}

async function post(endpoint, action, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(endpoint, {
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
