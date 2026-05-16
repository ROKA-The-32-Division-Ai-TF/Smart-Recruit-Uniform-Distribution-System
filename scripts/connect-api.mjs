import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(repoRoot, "docs", "data", "distribution-config.json");
const url = process.argv[2];

if (!url) {
  console.error("Usage: npm run connect-api -- <Apps Script Web App URL>");
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(url);
} catch {
  console.error("Apps Script Web App URL 형식이 아닙니다.");
  process.exit(1);
}

if (!["https:", "http:"].includes(parsed.protocol)) {
  console.error("URL은 http 또는 https로 시작해야 합니다.");
  process.exit(1);
}

const config = JSON.parse(await readFile(configPath, "utf-8"));
config.api = {
  ...(config.api || {}),
  appsScriptUrl: url,
  localMockWhenEmpty: true,
  demoDataWhenEmpty: false
};
config.configVersion = new Date().toISOString();

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

console.log("API URL을 distribution-config.json에 반영했습니다.");
console.log(`- ${url}`);
console.log("다음 확인: npm run test-api -- [관리자PIN]");
