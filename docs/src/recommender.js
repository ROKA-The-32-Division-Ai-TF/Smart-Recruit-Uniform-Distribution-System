const SIZE_STEP = 5;

export function buildProfile({ recruitNo, height, weight }) {
  const heightNum = Number(height);
  const weightNum = Number(weight);
  const bmiValue = bmi(heightNum, weightNum);
  return {
    recruitNo: String(recruitNo || "").trim(),
    height: heightNum,
    weight: weightNum,
    bmi: bmiValue,
    bmiLabel: bmiLabel(bmiValue)
  };
}

export function bmi(height, weight) {
  const meters = Math.max(Number(height) / 100, 0.1);
  return Number((Number(weight) / (meters * meters)).toFixed(1));
}

export function validateProfileInput({ recruitNo, height, weight }) {
  const errors = [];
  if (!String(recruitNo || "").trim()) errors.push("교번을 입력해 주세요.");
  const heightNum = Number(height);
  const weightNum = Number(weight);
  if (!Number.isFinite(heightNum) || heightNum < 130 || heightNum > 220) {
    errors.push("키는 130cm부터 220cm 사이로 입력해 주세요.");
  }
  if (!Number.isFinite(weightNum) || weightNum < 35 || weightNum > 160) {
    errors.push("몸무게는 35kg부터 160kg 사이로 입력해 주세요.");
  }
  return errors;
}

export function recommendForItem(item, profile) {
  const parsedSizes = (item.sizes || []).map(parseSize).filter(Boolean);
  const target = buildTarget(item.recommendationType, profile, parsedSizes);
  const ranked = rankSizes(parsedSizes, target);
  const primary = ranked[0]?.raw || item.sizes?.[0] || "-";
  const alternatives = buildNeighborAlternatives(parsedSizes, primary).map(({ entry, relation }) => ({
    size: entry.raw,
    measureOne: entry.width ? `${entry.width}${entry.height ? "cm" : "mm"}` : "-",
    measureTwo: entry.height ? `${entry.height}cm` : relation,
    relation,
    selected: entry.raw === primary
  }));

  return {
    itemId: item.itemId,
    itemLabel: item.label,
    recommendationType: item.recommendationType,
    recommendedSize: primary,
    finalSize: primary,
    alternatives,
    tableHeaders: tableHeadersFor(item.recommendationType),
    targetDescription: target.description,
    bmi: profile.bmi,
    bmiLabel: profile.bmiLabel
  };
}

export function recommendRoundItems(items, profile) {
  return items.map((item) => ({
    ...item,
    recommendation: recommendForItem(item, profile),
    finalSize: recommendForItem(item, profile).recommendedSize,
    changed: false,
    changeReason: ""
  }));
}

export function parseSize(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (value.includes("-")) {
    const [width, height] = value.split("-").map((part) => Number(part));
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    return { raw: value, width, height };
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return { raw: value, width: numeric, height: null };
}

function buildTarget(type, profile, parsedSizes) {
  const heightTarget = roundHeightUp(profile.height, parsedSizes);
  const baseUpper = roundToStep(profile.height * 0.55 + (profile.weight - (profile.height - 105)) * 0.35);
  const baseLower = roundToStep(profile.height * 0.44 + (profile.weight - (profile.height - 105)) * 0.45);

  if (type === "lower") {
    return {
      width: clamp(baseLower, 75, 110),
      height: heightTarget,
      description: "키와 몸무게 기반 임시 허리 기준"
    };
  }

  if (type === "outer" || type === "inner") {
    const padding = type === "outer" ? 10 : 5;
    return {
      width: clamp(baseUpper + padding + bmiPadding(profile.bmi), 90, 150),
      height: heightTarget,
      description: type === "outer" ? "동계 착용 여유 반영" : "보온 내피 여유 반영"
    };
  }

  if (type === "shoes") {
    return {
      width: clamp(roundToStep(profile.height * 1.5), 230, 300),
      height: null,
      description: "키 기반 임시 전투화 기준"
    };
  }

  return {
    width: clamp(baseUpper + bmiPadding(profile.bmi), 90, 120),
    height: heightTarget,
    description: "키와 몸무게 기반 임시 상의 기준"
  };
}

function rankSizes(parsedSizes, target) {
  return [...parsedSizes]
    .map((size) => {
      const heightScore = size.height && target.height ? Math.abs(size.height - target.height) * 0.8 : 0;
      const widthScore = Math.abs(size.width - target.width);
      return { ...size, score: widthScore + heightScore };
    })
    .sort((a, b) => a.score - b.score || String(a.raw).localeCompare(String(b.raw), "ko"));
}

function buildNeighborAlternatives(parsedSizes, primary) {
  const selected = parsedSizes.find((size) => size.raw === primary);
  if (!selected) return [];
  const lower = closestLowerSize(parsedSizes, selected);
  const upper = closestUpperSize(parsedSizes, selected);
  return [
    { entry: lower, relation: "한 치수 낮음" },
    { entry: selected, relation: "추천" },
    { entry: upper, relation: "한 치수 큼" }
  ].filter((row, index, array) => row.entry && array.findIndex((candidate) => candidate.entry.raw === row.entry.raw) === index);
}

function closestLowerSize(parsedSizes, selected) {
  const sameHeightLower = parsedSizes
    .filter((size) => size.height === selected.height && size.width < selected.width)
    .sort((a, b) => b.width - a.width)[0];
  if (sameHeightLower) return sameHeightLower;

  const sameWidthLower = parsedSizes
    .filter((size) => size.width === selected.width && comparableHeight(size) < comparableHeight(selected))
    .sort((a, b) => comparableHeight(b) - comparableHeight(a))[0];
  if (sameWidthLower) return sameWidthLower;

  return parsedSizes
    .filter((size) => size.width < selected.width)
    .sort((a, b) => sizeDistance(a, selected) - sizeDistance(b, selected))[0];
}

function closestUpperSize(parsedSizes, selected) {
  const sameHeightUpper = parsedSizes
    .filter((size) => size.height === selected.height && size.width > selected.width)
    .sort((a, b) => a.width - b.width)[0];
  if (sameHeightUpper) return sameHeightUpper;

  const sameWidthUpper = parsedSizes
    .filter((size) => size.width === selected.width && comparableHeight(size) > comparableHeight(selected))
    .sort((a, b) => comparableHeight(a) - comparableHeight(b))[0];
  if (sameWidthUpper) return sameWidthUpper;

  return parsedSizes
    .filter((size) => size.width > selected.width)
    .sort((a, b) => sizeDistance(a, selected) - sizeDistance(b, selected))[0];
}

function comparableHeight(size) {
  return size.height || 0;
}

function sizeDistance(size, selected) {
  return Math.abs(size.width - selected.width) * 10 + Math.abs(comparableHeight(size) - comparableHeight(selected));
}

function roundHeightUp(height, parsedSizes) {
  const heights = [...new Set(parsedSizes.map((size) => size.height).filter(Boolean))].sort((a, b) => a - b);
  return heights.find((candidate) => height <= candidate) || heights[heights.length - 1] || Math.round(height);
}

function bmiLabel(value) {
  if (value < 18.5) return "마른형";
  if (value < 23) return "보통";
  if (value < 25) return "주의";
  return "여유 필요";
}

function bmiPadding(value) {
  if (value >= 28) return 10;
  if (value >= 24) return 5;
  if (value < 18.5) return -5;
  return 0;
}

function tableHeadersFor(type) {
  if (type === "lower") return ["사이즈", "허리 기준", "신장"];
  if (type === "shoes") return ["사이즈", "발 기준", "비고"];
  return ["사이즈", "가슴둘레", "신장"];
}

function roundToStep(value) {
  return Math.round(Number(value) / SIZE_STEP) * SIZE_STEP;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}
