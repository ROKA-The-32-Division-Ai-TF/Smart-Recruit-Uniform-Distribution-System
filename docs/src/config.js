export const CONFIG_OVERRIDE_KEY = "sruds_config_override_v1";
const RUNTIME_CONFIG_CACHE_KEY = "sruds_runtime_config_cache_v1";
const RUNTIME_CONFIG_CACHE_TTL_MS = 3 * 60 * 1000;
const CURRENT_BRAND_LOGO = "assets/brand/baekryong-new-logo.gif";
const LEGACY_BRAND_LOGOS = new Set([
  "",
  "assets/brand/baekryong-ai-the-one-8.gif",
  "assets/brand/baekryong-horizontal-logo.gif"
]);

export async function loadDistributionConfig() {
  const response = await fetch("data/distribution-config.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("불출 설정 파일을 불러오지 못했습니다.");
  }
  const staticConfig = await response.json();
  const runtimeConfig = await loadRuntimeConfig(staticConfig);
  return normalizeConfig(mergeRuntimeConfig(staticConfig, runtimeConfig));
}

function mergeRuntimeConfig(staticConfig, runtimeConfig) {
  if (!runtimeConfig) return staticConfig;
  const merged = {
    ...staticConfig,
    ...runtimeConfig,
    brand: {
      ...(staticConfig.brand || {}),
      ...(runtimeConfig.brand || {})
    },
    api: {
      ...(staticConfig.api || {}),
      ...(runtimeConfig.api || {})
    }
  };

  if (staticConfig.api?.demoDataWhenEmpty === true && runtimeConfig.api?.demoDataWhenEmpty !== true) {
    const roundIds = new Set((runtimeConfig.rounds || []).map((round) => round.roundId));
    const itemIds = new Set((runtimeConfig.items || []).map((item) => item.itemId));
    merged.rounds = [
      ...(runtimeConfig.rounds || []),
      ...(staticConfig.rounds || []).filter((round) => !roundIds.has(round.roundId))
    ];
    merged.items = [
      ...(runtimeConfig.items || []),
      ...(staticConfig.items || []).filter((item) => !itemIds.has(item.itemId))
    ];
  }

  return merged;
}

export function normalizeConfig(config) {
  const rounds = [...(config.rounds || [])].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const items = [...(config.items || [])].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const cohorts = normalizeCohorts(config.cohorts);
  const logo = String(config.brand?.logo || "").trim();
  return {
    ...config,
    brand: {
      ...(config.brand || {}),
      logo: LEGACY_BRAND_LOGOS.has(logo) ? CURRENT_BRAND_LOGO : logo
    },
    rounds,
    items,
    cohorts,
    metadata: {
      ...(config.metadata || {}),
      creators: normalizeCreators(config.metadata?.creators)
    },
    itemMap: Object.fromEntries(items.map((item) => [item.itemId, item]))
  };
}

export function normalizeCohorts(cohorts) {
  return (cohorts || [])
    .map((cohort, index) => {
      const label = typeof cohort === "string" ? cohort : cohort?.label;
      const normalized = String(label || "").trim().replace(/\s+/g, "");
      if (!normalized) return null;
      return {
        cohortId: sanitizeConfigId(typeof cohort === "object" ? cohort.cohortId : normalized) || sanitizeConfigId(normalized),
        label: normalized,
        order: Number(typeof cohort === "object" ? cohort.order : index + 1) || index + 1,
        active: typeof cohort === "object" && cohort.active === false ? false : true
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

export function normalizeCreators(creators) {
  return (creators || [])
    .map((creator) => String(creator || "").trim())
    .filter(Boolean);
}

function sanitizeConfigId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function saveLocalConfigOverride(config) {
  localStorage.setItem(CONFIG_OVERRIDE_KEY, JSON.stringify(config));
}

export function readLocalConfigOverride() {
  try {
    const raw = localStorage.getItem(CONFIG_OVERRIDE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearLocalConfigOverride() {
  localStorage.removeItem(CONFIG_OVERRIDE_KEY);
}

export function clearRuntimeConfigCache() {
  try {
    sessionStorage.removeItem(RUNTIME_CONFIG_CACHE_KEY);
  } catch {
    // 캐시 삭제 실패는 앱 동작에 영향을 주지 않습니다.
  }
}

async function loadRuntimeConfig(staticConfig) {
  const appsScriptUrl = String(staticConfig.api?.appsScriptUrl || "").trim();
  if (!appsScriptUrl) return readLocalConfigOverride();
  const cached = readRuntimeConfigCache(appsScriptUrl);
  if (cached) return cached;

  try {
    const response = await fetch(appsScriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({ action: "getConfig" })
    });
    const data = await response.json();
    if (data.ok && data.config) {
      writeRuntimeConfigCache(appsScriptUrl, data.config);
      return data.config;
    }
    return null;
  } catch {
    return null;
  }
}

function readRuntimeConfigCache(appsScriptUrl) {
  const search = new URLSearchParams(window.location.search);
  if (search.has("fresh") || search.has("nocache")) return null;
  try {
    const cached = JSON.parse(sessionStorage.getItem(RUNTIME_CONFIG_CACHE_KEY) || "null");
    if (!cached || cached.appsScriptUrl !== appsScriptUrl || !cached.savedAt || !cached.config) return null;
    if (Date.now() - Number(cached.savedAt) > RUNTIME_CONFIG_CACHE_TTL_MS) return null;
    return cached.config;
  } catch {
    return null;
  }
}

function writeRuntimeConfigCache(appsScriptUrl, config) {
  try {
    sessionStorage.setItem(RUNTIME_CONFIG_CACHE_KEY, JSON.stringify({
      appsScriptUrl,
      savedAt: Date.now(),
      config
    }));
  } catch {
    // 캐시 저장 실패는 앱 동작에 영향을 주지 않습니다.
  }
}

export function getRoundItems(config, round) {
  return (round.itemIds || [])
    .map((itemId) => config.itemMap[itemId])
    .filter(Boolean)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

export function getNextRound(config, status) {
  const completed = new Set(status?.completedRoundIds || []);
  return config.rounds.find((round) => !completed.has(round.roundId)) || null;
}

export function getRoundLabel(config, roundId) {
  return config.rounds.find((round) => round.roundId === roundId)?.label || roundId;
}
