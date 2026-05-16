const SIZE_STEP = 5;

export const REC_CONFIG = {
  curve: {
    a: 24,
    b: 0
  },
  baselinePeople: 1000,
  baselineBmi: 24,
  kgPerStep: {
    upper: 6,
    lower: 6,
    single: 6
  },
  baseSize: {
    upper: 100,
    lower: 85,
    single: 100
  },
  maxSizeGap: {
    upper: 20,
    lower: 15,
    single: 20
  },
  headRanges: [
    { size: "소", max: 56 },
    { size: "중", max: 58 },
    { size: "대", max: 99 }
  ]
};

export function buildProfile({ recruitNo, height, weight, footSize, headSize }) {
  const heightNum = Number(height);
  const weightNum = Number(weight);
  const footSizeNum = normalizeFootSize(footSize);
  const headSizeNum = normalizeHeadSize(headSize);
  const bmiValue = bmi(heightNum, weightNum);
  return {
    recruitNo: String(recruitNo || "").trim(),
    height: heightNum,
    weight: weightNum,
    footSize: footSizeNum,
    headSize: headSizeNum,
    bmi: bmiValue,
    bmiLabel: bmiLabel(bmiValue)
  };
}

export function bmi(height, weight) {
  const meters = Math.max(Number(height) / 100, 0.1);
  return Number((Number(weight) / (meters * meters)).toFixed(1));
}

export function validateProfileInput({ recruitNo, height, weight, footSize, headSize }, items = []) {
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

  const needsFoot = items.some((item) => isFootType(item.recommendationType));
  const needsHead = items.some((item) => isHeadType(item.recommendationType));
  const footSizeNum = normalizeFootSize(footSize);
  const headSizeNum = normalizeHeadSize(headSize);
  if (needsFoot && !Number.isFinite(footSizeNum)) {
    errors.push("발 사이즈를 선택해 주세요.");
  } else if (Number.isFinite(footSizeNum) && (footSizeNum < 220 || footSizeNum > 330)) {
    errors.push("발 사이즈는 220mm부터 330mm 사이로 입력해 주세요.");
  }
  if (needsHead && !Number.isFinite(headSizeNum)) {
    errors.push("머리둘레를 선택해 주세요.");
  } else if (Number.isFinite(headSizeNum) && (headSizeNum < 50 || headSizeNum > 65)) {
    errors.push("머리둘레는 50호부터 65호 사이로 입력해 주세요.");
  }
  return errors;
}

export function recommendForItem(item, profile, recConfig = REC_CONFIG) {
  const parsedSizes = (item.sizes || []).map(parseSize).filter(Boolean);
  const type = normalizeType(item.recommendationType);
  const target = buildTarget(item, profile, parsedSizes, recConfig);
  const ranked = rankSizes(parsedSizes, target);
  const primary = ranked[0]?.raw || item.sizes?.[0] || "-";
  const alternatives = buildNeighborAlternatives(parsedSizes, primary).map(({ entry, relation }) => ({
    size: entry.raw,
    measureOne: formatMeasureOne(entry, type),
    measureTwo: formatMeasureTwo(entry, relation, type),
    relation,
    selected: entry.raw === primary
  }));

  return {
    itemId: item.itemId,
    itemLabel: item.label,
    recommendationType: item.recommendationType,
    inputMode: target.inputMode,
    recommendedSize: primary,
    finalSize: primary,
    alternatives,
    tableHeaders: tableHeadersFor(type),
    targetDescription: target.description,
    specialHandling: target.specialHandling || false,
    bmi: profile.bmi,
    bmiLabel: profile.bmiLabel
  };
}

export function recommendRoundItems(items, profile) {
  return items.map((item) => {
    const recommendation = recommendForItem(item, profile);
    return {
      ...item,
      recommendation,
      finalSize: recommendation.recommendedSize,
      changed: false,
      changeReason: ""
    };
  });
}

export function parseSize(raw, index = 0) {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (value.includes("-")) {
    const [size, sizeHigh] = value.split("-").map((part) => Number(part));
    if (!Number.isFinite(size) || !Number.isFinite(sizeHigh)) return null;
    return { raw: value, width: size, height: sizeHigh, index, kind: "two-part" };
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return { raw: value, width: numeric, height: null, index, kind: "numeric" };
  }
  return { raw: value, width: null, height: null, index, kind: "label" };
}

export function expectedWeightForHeight(height, recConfig = REC_CONFIG) {
  const meters = Math.max(Number(height) / 100, 0.1);
  return Number((Number(recConfig.curve.a) * meters * meters + Number(recConfig.curve.b || 0)).toFixed(1));
}

export function displacementFromCurve(profile, recConfig = REC_CONFIG) {
  return Number((Number(profile.weight) - expectedWeightForHeight(profile.height, recConfig)).toFixed(1));
}

export function adjustRecConfigFromRecords(records, baseConfig = REC_CONFIG) {
  const byRecruit = new Map();
  (records || []).forEach((row) => {
    const recruitNo = String(row.recruit_no || row.recruitNo || "").trim();
    const height = Number(row.height_cm || row.height);
    const weight = Number(row.weight_kg || row.weight);
    if (recruitNo && Number.isFinite(height) && Number.isFinite(weight)) {
      byRecruit.set(recruitNo, bmi(height, weight));
    }
  });

  const newBmis = [...byRecruit.values()];
  const weightedTotal = Number(baseConfig.baselineBmi) * Number(baseConfig.baselinePeople) +
    newBmis.reduce((sum, value) => sum + value, 0);
  const peopleCount = Number(baseConfig.baselinePeople) + newBmis.length;
  const nextA = peopleCount ? Number((weightedTotal / peopleCount).toFixed(2)) : Number(baseConfig.curve.a);

  return {
    ...baseConfig,
    curve: {
      ...baseConfig.curve,
      a: nextA
    },
    adjustedFromPeople: newBmis.length
  };
}

function buildTarget(item, profile, parsedSizes, recConfig) {
  const type = normalizeType(item.recommendationType);
  if (isFootType(type)) return buildFootTarget(type, profile, parsedSizes);
  if (isHeadType(type)) return buildHeadTarget(item, type, profile, parsedSizes, recConfig);

  const dis = displacementFromCurve(profile, recConfig);
  const group = targetGroup(type);
  const baseSize = Number(item.baseSize || recConfig.baseSize[group]);
  const kgPerStep = Number(item.kgPerStep || recConfig.kgPerStep[group] || 6);
  const sizeOffset = Number(item.sizeOffset || 0);
  const targetWidth = roundToStep(baseSize + sizeOffset + Math.round(dis / kgPerStep) * SIZE_STEP);
  const candidates = heightAwareCandidates(parsedSizes, profile.height);
  const availableWidths = (candidates.length ? candidates : parsedSizes)
    .map((size) => size.width)
    .filter(Number.isFinite);
  const boundedWidth = clampToAvailable(targetWidth, availableWidths);
  const maxGap = Number(item.maxSizeGap || recConfig.maxSizeGap[group] || 20);
  const gap = Math.abs(Number(boundedWidth) - Number(targetWidth));

  return {
    width: boundedWidth,
    height: targetHeightFromCandidates(candidates),
    candidates,
    inputMode: "auto",
    description: `${targetDescriptionFor(type)} · 기준곡선 ${expectedWeightForHeight(profile.height, recConfig)}kg · dis ${dis}kg${gap > maxGap ? " · 현장 확인 필요" : ""}`,
    specialHandling: gap > maxGap
  };
}

function buildFootTarget(type, profile, parsedSizes) {
  const footSize = Number.isFinite(profile.footSize) ? profile.footSize : parsedSizes[0]?.width;
  return {
    width: clampToAvailable(footSize, parsedSizes.map((size) => size.width).filter(Number.isFinite)),
    height: null,
    candidates: parsedSizes,
    inputMode: "direct",
    description: type === "shoes" ? "발 사이즈 선택값 기준" : "실측 선택값 기준"
  };
}

function buildHeadTarget(item, type, profile, parsedSizes, recConfig) {
  const headSize = Number.isFinite(profile.headSize) ? profile.headSize : parsedSizes[0]?.width;
  if (type === "head_sml") {
    const ranges = item.sizeRules?.headRanges || recConfig.headRanges;
    const selected = ranges.find((range) => Number(headSize) <= Number(range.max)) || ranges[ranges.length - 1];
    return {
      label: selected?.size || parsedSizes[0]?.raw || "-",
      candidates: parsedSizes,
      inputMode: "direct",
      description: "머리둘레 선택값 기준"
    };
  }

  return {
    width: clampToAvailable(headSize, parsedSizes.map((size) => size.width).filter(Number.isFinite)),
    height: null,
    candidates: parsedSizes,
    inputMode: "direct",
    description: "머리둘레 선택값 기준"
  };
}

function rankSizes(parsedSizes, target) {
  if (target.label) {
    const selected = parsedSizes.find((size) => size.raw === target.label) || parsedSizes[0];
    return selected ? [selected, ...parsedSizes.filter((size) => size.raw !== selected.raw)] : [];
  }

  const candidates = target.candidates?.length ? target.candidates : parsedSizes;
  return [...candidates]
    .map((size) => {
      const heightScore = size.height && target.height ? Math.abs(size.height - target.height) * 2 : 0;
      const widthScore = Number.isFinite(size.width) && Number.isFinite(target.width) ? Math.abs(size.width - target.width) : 999;
      return { ...size, score: widthScore + heightScore };
    })
    .sort((a, b) => a.score - b.score || Number(a.width || 0) - Number(b.width || 0) || String(a.raw).localeCompare(String(b.raw), "ko"));
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
  ].filter((row) => row.entry)
    .filter((row, index, array) => array.findIndex((candidate) => candidate.entry.raw === row.entry.raw) === index);
}

function closestLowerSize(parsedSizes, selected) {
  if (selected.kind === "label") {
    return parsedSizes.filter((size) => size.index < selected.index).sort((a, b) => b.index - a.index)[0];
  }
  const sameHeightLower = parsedSizes
    .filter((size) => size.height === selected.height && Number(size.width) < Number(selected.width))
    .sort((a, b) => Number(b.width) - Number(a.width))[0];
  if (sameHeightLower) return sameHeightLower;

  return parsedSizes
    .filter((size) => Number(size.width) < Number(selected.width))
    .sort((a, b) => sizeDistance(a, selected) - sizeDistance(b, selected))[0];
}

function closestUpperSize(parsedSizes, selected) {
  if (selected.kind === "label") {
    return parsedSizes.filter((size) => size.index > selected.index).sort((a, b) => a.index - b.index)[0];
  }
  const sameHeightUpper = parsedSizes
    .filter((size) => size.height === selected.height && Number(size.width) > Number(selected.width))
    .sort((a, b) => Number(a.width) - Number(b.width))[0];
  if (sameHeightUpper) return sameHeightUpper;

  return parsedSizes
    .filter((size) => Number(size.width) > Number(selected.width))
    .sort((a, b) => sizeDistance(a, selected) - sizeDistance(b, selected))[0];
}

function heightAwareCandidates(parsedSizes, height) {
  const withHeight = parsedSizes.filter((size) => Number.isFinite(size.height));
  if (!withHeight.length) return [];
  const nearestHeight = [...new Set(withHeight.map((size) => size.height))]
    .sort((a, b) => Math.abs(a - height) - Math.abs(b - height) || a - b)[0];
  return withHeight.filter((size) => size.height === nearestHeight);
}

function targetHeightFromCandidates(candidates) {
  return candidates.find((size) => Number.isFinite(size.height))?.height || null;
}

function sizeDistance(size, selected) {
  return Math.abs(Number(size.width || 0) - Number(selected.width || 0)) * 10 +
    Math.abs(Number(size.height || 0) - Number(selected.height || 0));
}

function normalizeType(type) {
  return String(type || "manual").trim().replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

function targetGroup(type) {
  if (type === "lower") return "lower";
  if (type === "single_upper" || type === "manual") return "single";
  return "upper";
}

function isFootType(type) {
  return normalizeType(type) === "shoes";
}

function isHeadType(type) {
  const normalized = normalizeType(type);
  return normalized === "head_sml" || normalized === "beret";
}

function targetDescriptionFor(type) {
  if (type === "lower") return "키와 몸무게 기반 허리 기준";
  if (type === "single_upper") return "몸무게 곡선 기반 가슴둘레 기준";
  if (type === "outer") return "키와 몸무게 기반 외피 기준";
  if (type === "inner") return "키와 몸무게 기반 내피 기준";
  return "키와 몸무게 기반 가슴둘레 기준";
}

function tableHeadersFor(type) {
  if (type === "lower") return ["사이즈", "허리 기준", "신장"];
  if (type === "shoes") return ["사이즈", "발 기준", "비고"];
  if (type === "head_sml" || type === "beret") return ["사이즈", "머리둘레", "비고"];
  if (type === "single_upper") return ["사이즈", "가슴둘레", "비고"];
  return ["사이즈", "가슴둘레", "신장"];
}

function formatMeasureOne(entry, type) {
  if (entry.kind === "label") return "-";
  if (type === "shoes") return `${entry.width}mm`;
  if (type === "head_sml" || type === "beret") return `${entry.width || entry.raw}호`;
  return `${entry.width}cm`;
}

function formatMeasureTwo(entry, relation, type) {
  if (entry.height) return `${entry.height}cm`;
  if (type === "shoes") return "발 실측";
  if (type === "head_sml" || type === "beret") return "머리 실측";
  return relation;
}

function normalizeFootSize(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return NaN;
  return numeric < 100 ? Math.round(numeric * 10) : Math.round(numeric);
}

function normalizeHeadSize(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function roundToStep(value) {
  return Math.round(Number(value) / SIZE_STEP) * SIZE_STEP;
}

function clampToAvailable(value, available) {
  const values = [...new Set(available.filter(Number.isFinite))].sort((a, b) => a - b);
  if (!values.length) return value;
  return values
    .map((candidate) => ({ candidate, score: Math.abs(candidate - value), over: candidate >= value ? 0 : 1 }))
    .sort((a, b) => a.score - b.score || a.over - b.over || a.candidate - b.candidate)[0].candidate;
}

function bmiLabel(value) {
  if (value < 18.5) return "마른형";
  if (value < 23) return "보통";
  if (value < 25) return "주의";
  return "여유 필요";
}
