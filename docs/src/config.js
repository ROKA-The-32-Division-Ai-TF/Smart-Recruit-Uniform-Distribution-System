export const CONFIG_OVERRIDE_KEY = "sruds_config_override_v1";
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
  const logo = String(config.brand?.logo || "").trim();
  return {
    ...config,
    brand: {
      ...(config.brand || {}),
      logo: LEGACY_BRAND_LOGOS.has(logo) ? CURRENT_BRAND_LOGO : logo
    },
    rounds,
    items,
    itemMap: Object.fromEntries(items.map((item) => [item.itemId, item]))
  };
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

async function loadRuntimeConfig(staticConfig) {
  const appsScriptUrl = String(staticConfig.api?.appsScriptUrl || "").trim();
  if (!appsScriptUrl) return readLocalConfigOverride();

  try {
    const response = await fetch(appsScriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({ action: "getConfig" })
    });
    const data = await response.json();
    return data.ok && data.config ? data.config : null;
  } catch {
    return null;
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
