import { getRoundItems, loadDistributionConfig } from "./config.js";
import { buildProfile, recommendRoundItems, validateProfileInput } from "./recommender.js";
import { buildSubmissionPayload, createApi } from "./api.js";

const app = document.querySelector("#app");
const state = {
  config: null,
  api: null,
  profile: null,
  status: null,
  round: null,
  issueItems: [],
  itemIndex: 0,
  lastSavedRows: [],
  selectedRoundId: null,
  personalPin: ""
};
const ROUND_THEME_CLASSES = ["theme-round-one", "theme-round-two", "theme-round-three", "theme-round-four"];

init();

async function init() {
  try {
    state.config = await loadDistributionConfig();
    state.api = createApi(state.config);
    state.selectedRoundId = state.config.rounds[0]?.roundId || null;
    renderInput();
  } catch (error) {
    renderError(error.message || "앱을 시작하지 못했습니다.");
  }
}

function renderInput(message = "") {
  const round = getSelectedRound();
  app.className = `app-shell input-shell ${roundThemeClass(round)}`;
  app.innerHTML = `
    <section class="input-screen ${state.profile && state.issueItems.length ? "has-results" : ""}">
      ${renderTopBar(round)}
      <form id="profileForm" class="input-card">
        <div class="input-grid">
          ${renderCohortField()}
          <label class="profile-field">
            <span>교번</span>
            <div class="field-input-wrap">
              <input name="recruitNo" type="text" inputmode="numeric" autocomplete="off" placeholder="교번 입력" aria-label="교번" value="${esc(state.profile?.recruitNo || "")}" />
            </div>
          </label>
          <label class="profile-field">
            <span>키</span>
            <div class="field-input-wrap">
              <input name="height" type="text" inputmode="decimal" autocomplete="off" placeholder="입력" aria-label="키" value="${esc(state.profile?.height || "")}" />
              <em>cm</em>
            </div>
          </label>
          <label class="profile-field">
            <span>몸무게</span>
            <div class="field-input-wrap">
              <input name="weight" type="text" inputmode="decimal" autocomplete="off" placeholder="입력" aria-label="몸무게" value="${esc(state.profile?.weight || "")}" />
              <em>kg</em>
            </div>
          </label>
        </div>
        <div class="input-line"></div>
        <p class="input-note">키와 몸무게는 백룡 AI가 스마트폰 안에서 추천 계산에만 사용합니다. 최종 확정 시에는 불출받은 사이즈 정보만 안전하게 전달됩니다.</p>
        <button class="primary-button" type="submit">추천 사이즈 보기</button>
        <button id="openHistory" class="secondary-button history-open-button" type="button">불출기록 확인</button>
        <p id="formMessage" class="form-message">${esc(message)}</p>
      </form>
      ${state.profile && state.issueItems.length ? renderRecommendationPanel(round) : ""}
      <a class="admin-link" href="admin.html">관리자 현황</a>
    </section>
  `;

  document.querySelector("#profileForm").addEventListener("submit", handleProfileSubmit);
  document.querySelector("#openHistory").addEventListener("click", openPersonalHistoryDialog);
  bindRoundSwitch();
  bindRecommendationControls();
}

function renderCohortField() {
  const cohorts = activeCohorts();
  const current = state.profile?.cohort || "";
  if (!cohorts.length) {
    return `
      <label class="profile-field">
        <span>기수</span>
        <div class="field-input-wrap">
          <input name="cohort" type="text" inputmode="text" autocomplete="off" placeholder="26-1기" aria-label="기수" value="${esc(current)}" />
        </div>
      </label>
    `;
  }
  return `
    <label class="profile-field">
      <span>기수</span>
      <div class="field-input-wrap">
        <select name="cohort" aria-label="기수">
          <option value="">선택</option>
          ${cohorts.map((cohort) => `<option value="${esc(cohort.label)}" ${cohort.label === current ? "selected" : ""}>${esc(cohort.label)}</option>`).join("")}
        </select>
      </div>
    </label>
  `;
}

function activeCohorts() {
  return (state.config?.cohorts || []).filter((cohort) => cohort.active !== false);
}

function openPersonalHistoryDialog() {
  document.querySelector(".history-sheet")?.remove();
  const currentCohort = state.profile?.cohort || "";
  const currentRecruitNo = state.profile?.recruitNo || "";
  const sheet = document.createElement("div");
  sheet.className = "history-sheet";
  sheet.innerHTML = `
    <section class="history-panel" role="dialog" aria-modal="true" aria-labelledby="historyTitle">
      <header>
        <div>
          <h2 id="historyTitle">불출기록 확인</h2>
          <p>기수, 교번, 개인 PIN을 입력하면 본인 불출기록을 확인하고 수정할 수 있습니다.</p>
        </div>
        <button data-history-close type="button" aria-label="닫기">×</button>
      </header>
      <form id="historyForm" class="history-form">
        <label>
          <span>기수</span>
          ${renderHistoryCohortInput(currentCohort)}
        </label>
        <label>
          <span>교번</span>
          <input name="recruitNo" type="text" inputmode="numeric" autocomplete="off" value="${esc(currentRecruitNo)}" placeholder="교번 입력" />
        </label>
        <label>
          <span>개인 PIN</span>
          <input name="personalPin" type="password" inputmode="numeric" maxlength="4" autocomplete="current-password" placeholder="4자리" />
        </label>
        <button class="primary-button" type="submit">기록 확인</button>
      </form>
      <div id="historyResult" class="history-result"></div>
      <p id="historyMessage" class="form-message"></p>
    </section>
  `;
  document.body.appendChild(sheet);
  sheet.querySelectorAll("[data-history-close]").forEach((button) => button.addEventListener("click", () => sheet.remove()));
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) sheet.remove();
  });
  sheet.querySelector("#historyForm").addEventListener("submit", (event) => loadPersonalHistory(event, sheet));
}

function renderHistoryCohortInput(currentCohort) {
  const cohorts = activeCohorts();
  if (!cohorts.length) {
    return `<input name="cohort" type="text" autocomplete="off" value="${esc(currentCohort)}" placeholder="26-1기" />`;
  }
  return `
    <select name="cohort">
      <option value="">선택</option>
      ${cohorts.map((cohort) => `<option value="${esc(cohort.label)}" ${cohort.label === currentCohort ? "selected" : ""}>${esc(cohort.label)}</option>`).join("")}
    </select>
  `;
}

async function loadPersonalHistory(event, sheet) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = {
    cohort: String(form.get("cohort") || "").trim(),
    recruitNo: String(form.get("recruitNo") || "").trim(),
    personalPin: String(form.get("personalPin") || "").trim()
  };
  const message = sheet.querySelector("#historyMessage");
  const result = sheet.querySelector("#historyResult");
  if (!payload.cohort || !payload.recruitNo || !/^\d{4}$/.test(payload.personalPin)) {
    message.textContent = "기수, 교번, 개인 PIN 4자리를 입력해 주세요.";
    return;
  }
  message.textContent = "기록을 확인하는 중입니다.";
  result.innerHTML = "";
  try {
    const response = await state.api.getPersonalRecords(payload);
    message.textContent = "";
    renderPersonalHistoryResult(sheet, payload, response.records || []);
  } catch (error) {
    message.textContent = error.message || "불출기록을 확인하지 못했습니다.";
  }
}

function renderPersonalHistoryResult(sheet, auth, records) {
  const result = sheet.querySelector("#historyResult");
  if (!records.length) {
    result.innerHTML = `<p class="history-empty">확인되는 불출기록이 없습니다.</p>`;
    return;
  }
  const grouped = groupPersonalRecords(records);
  result.innerHTML = Object.values(grouped).map((group) => `
    <article class="history-round-card">
      <header>
        <strong>${esc(group.roundName)}</strong>
        <button data-history-edit-round="${esc(group.roundId)}" type="button">수정</button>
      </header>
      <div class="history-record-list">
        ${group.rows.map((row) => `
          <div class="${isChangedRecord(row) ? "changed" : ""}">
            <span>${esc(row.item_name)}</span>
            <strong>${esc(row.final_size || "-")}</strong>
          </div>
        `).join("")}
      </div>
    </article>
  `).join("");

  result.querySelectorAll("[data-history-edit-round]").forEach((button) => {
    button.addEventListener("click", () => renderPersonalEditForm(sheet, auth, grouped[button.dataset.historyEditRound]));
  });
}

function renderPersonalEditForm(sheet, auth, group) {
  const result = sheet.querySelector("#historyResult");
  result.innerHTML = `
    <article class="history-edit-card">
      <header>
        <div>
          <strong>${esc(group.roundName)} 수정</strong>
          <small>교체한 항목은 관리자 화면과 원본 기록에 함께 반영됩니다.</small>
        </div>
        <button data-history-back type="button">돌아가기</button>
      </header>
      <div class="history-edit-list">
        ${group.rows.map((row) => renderPersonalEditRow(row)).join("")}
      </div>
      <div class="history-edit-actions">
        <button class="ghost-button" data-history-back type="button">취소</button>
        <button class="primary-button" data-history-save type="button">수정 저장</button>
      </div>
    </article>
  `;
  result.querySelectorAll("[data-history-back]").forEach((button) => {
    button.addEventListener("click", async () => {
      const response = await state.api.getPersonalRecords(auth);
      renderPersonalHistoryResult(sheet, auth, response.records || []);
    });
  });
  result.querySelector("[data-history-save]").addEventListener("click", () => savePersonalHistoryEdit(sheet, auth, group.roundId));
}

function renderPersonalEditRow(row) {
  const item = state.config.items.find((candidate) => candidate.itemId === row.item_id);
  const sizes = uniqueStrings([row.final_size, ...(item?.sizes || [])]);
  return `
    <label class="history-edit-row">
      <span>
        <strong>${esc(row.item_name)}</strong>
        <small>추천 ${esc(row.recommended_size || "-")}</small>
      </span>
      <select data-history-item-id="${esc(row.item_id)}">
        ${sizes.map((size) => `<option value="${esc(size)}" ${String(size) === String(row.final_size) ? "selected" : ""}>${esc(size)}</option>`).join("")}
      </select>
    </label>
  `;
}

async function savePersonalHistoryEdit(sheet, auth, roundId) {
  const message = sheet.querySelector("#historyMessage");
  const button = sheet.querySelector("[data-history-save]");
  const items = [...sheet.querySelectorAll("[data-history-item-id]")].map((select) => ({
    itemId: select.dataset.historyItemId,
    finalSize: select.value
  }));
  button.disabled = true;
  message.textContent = "수정 내용을 저장하는 중입니다.";
  try {
    await state.api.updatePersonalIssueRecords({ ...auth, roundId, items });
    const response = await state.api.getPersonalRecords(auth);
    message.textContent = "수정 내용을 반영했습니다.";
    renderPersonalHistoryResult(sheet, auth, response.records || []);
  } catch (error) {
    message.textContent = error.message || "수정에 실패했습니다.";
  } finally {
    button.disabled = false;
  }
}

function groupPersonalRecords(records) {
  return records.reduce((acc, row) => {
    const roundId = row.round_id || row.roundId || row.round_name || "round";
    acc[roundId] = acc[roundId] || {
      roundId,
      roundName: row.round_name || row.roundName || "불출 내역",
      rows: []
    };
    acc[roundId].rows.push(row);
    return acc;
  }, {});
}

async function handleProfileSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const raw = {
    cohort: form.get("cohort"),
    recruitNo: form.get("recruitNo"),
    height: form.get("height"),
    weight: form.get("weight")
  };
  const errors = validateProfileInput(raw);
  if (errors.length) {
    document.querySelector("#formMessage").textContent = errors[0];
    return;
  }

  state.profile = buildProfile(raw);
  state.round = getSelectedRound();
  showRecommendationLoading(true);
  try {
    const [status] = await Promise.all([
      state.api.getStatus(state.profile.recruitNo, state.profile.cohort),
      wait(650)
    ]);
    state.status = status;
    const routing = syncRoundWithStatus();
    if (routing.allDone) {
      renderDone("모든 불출 차수가 완료되었습니다.", state.status.records || []);
      return;
    }
    const routedErrors = validateProfileInput(raw);
    if (routedErrors.length) {
      renderInput(routedErrors[0]);
      return;
    }
    refreshIssueItems();
    renderInput(routing.switched
      ? `기록 기준으로 ${state.round.label} 추천 사이즈를 표시했습니다.`
      : `${state.round.label} 추천 사이즈를 표시했습니다.`);
  } catch (error) {
    await wait(350);
    refreshIssueItems();
    renderInput(error.message || `${state.round.label} 추천 사이즈를 표시했습니다.`);
  } finally {
    showRecommendationLoading(false);
  }
}

function getSelectedRound() {
  return state.config.rounds.find((round) => round.roundId === state.selectedRoundId) || state.config.rounds[0] || null;
}

function syncRoundWithStatus() {
  const nextRoundId = state.status?.nextRoundId || null;
  if (!nextRoundId) return { allDone: true, switched: false };
  const switched = state.selectedRoundId !== nextRoundId;
  state.selectedRoundId = nextRoundId;
  state.round = getSelectedRound();
  return { allDone: false, switched };
}

function refreshIssueItems() {
  state.round = getSelectedRound();
  const roundItems = getRoundItems(state.config, state.round);
  state.issueItems = recommendRoundItems(roundItems, state.profile);
}

function renderTopBar(round) {
  return `
    <header class="mobile-topbar">
      <img class="brand-gif-logo" src="${esc(state.config.brand.logo)}" alt="${esc(state.config.appName)}" />
      ${renderRoundSwitch(round)}
    </header>
  `;
}

function renderRoundSwitch(activeRound) {
  const rounds = state.config.rounds;
  const activeIndex = Math.max(0, rounds.findIndex((round) => round.roundId === activeRound?.roundId));
  return `
    <div class="round-switch" style="--round-count: ${rounds.length || 1}; --round-index: ${activeIndex};" role="tablist" aria-label="불출 차수 전환">
      ${rounds
        .map(
          (round) => `
            <button class="${round.roundId === activeRound?.roundId ? "active" : ""}" data-round-id="${esc(round.roundId)}" type="button" role="tab" aria-selected="${round.roundId === activeRound?.roundId}">
              ${esc(round.label)}
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderRecommendationPanel(round) {
  return `
    <section class="recommendation-panel">
      <div class="panel-head">
        <div>
          <h1>${esc(round.label)} 추천 사이즈표</h1>
        </div>
      </div>
      <p class="recommendation-hint">품목을 터치하면 세부 사이즈표와 선택 화면을 확인할 수 있습니다.</p>
      <div class="size-card-grid">
        ${state.issueItems.map(renderSizeCard).join("")}
      </div>
      <button id="submitIssue" class="primary-button confirm-all" type="button">${esc(round.label)} 최종 확정</button>
    </section>
  `;
}

function renderProfileMeta() {
  const parts = [
    `${state.profile.cohort}`,
    `교번 ${state.profile.recruitNo}`
  ];
  return esc(parts.join(" · "));
}

function renderSizeCard(item) {
  const recommendation = item.recommendation;
  const direct = isDirectSelectionItem(item);
  const hasSelection = Boolean(item.finalSize);
  return `
    <button class="size-card" data-detail-item="${esc(item.itemId)}" type="button">
      <div class="card-body">
        <div class="card-title-row">
          <h2>${esc(item.label)}</h2>
          <span>${direct ? hasSelection ? "선택완료" : "직접선택" : item.finalSize !== recommendation.recommendedSize ? "교체됨" : "추천"}</span>
        </div>
        <strong class="card-size ${hasSelection ? "" : "needs-choice"}">${esc(hasSelection ? item.finalSize : "선택 필요")}</strong>
      </div>
    </button>
  `;
}

function renderCardVisual(item) {
  if (item.image) {
    return `<div class="card-image" style="--visual-image: url('${esc(item.image)}'); --visual-position: ${esc(item.imagePosition || "center")}; --visual-size: ${esc(item.imageSize || "cover")};"></div>`;
  }
  return `<div class="card-boot-icon"><div class="boot-icon"></div></div>`;
}

function bindRoundSwitch() {
  document.querySelectorAll("[data-round-id]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.selectedRoundId === button.dataset.roundId) return;
      if (state.profile && state.status?.nextRoundId && button.dataset.roundId !== state.status.nextRoundId) {
        const nextRound = state.config.rounds.find((round) => round.roundId === state.status.nextRoundId);
        state.selectedRoundId = state.status.nextRoundId;
        if (state.profile) refreshIssueItems();
        renderInput();
        showInfoModal("확인 필요", `${nextRound?.label || "다음 차수"}만 확정할 수 있습니다. 이전 차수 기록을 기준으로 자동 이동했습니다.`);
        return;
      }
      if (state.profile && state.status && !state.status.nextRoundId) {
        renderDone("모든 불출 차수가 완료되었습니다.", state.status.records || []);
        return;
      }
      state.selectedRoundId = button.dataset.roundId;
      if (state.profile) refreshIssueItems();
      renderInput(state.profile ? `${getSelectedRound().label}로 전환했습니다.` : "");
    });
  });
}

function bindRecommendationControls() {
  const submitButton = document.querySelector("#submitIssue");
  if (submitButton) submitButton.addEventListener("click", openSubmitConfirm);

  document.querySelectorAll("[data-detail-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const itemIndex = state.issueItems.findIndex((candidate) => candidate.itemId === button.dataset.detailItem);
      if (itemIndex < 0) return;
      state.itemIndex = itemIndex;
      renderItem();
    });
  });

  document.querySelectorAll("[data-change-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.issueItems.find((candidate) => candidate.itemId === button.dataset.changeItem);
      if (item) openSizeSheet(item);
    });
  });

  document.querySelectorAll("[data-card-size]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.issueItems.find((candidate) => candidate.itemId === button.dataset.itemId);
      if (!item) return;
      applyItemSize(item, button.dataset.cardSize);
      renderInput("선택한 사이즈를 반영했습니다.");
    });
  });
}

function roundThemeClass(round) {
  const index = state.config.rounds.findIndex((candidate) => candidate.roundId === round?.roundId);
  return ROUND_THEME_CLASSES[Math.max(0, index) % ROUND_THEME_CLASSES.length];
}

function renderItem() {
  const item = state.issueItems[state.itemIndex];
  const recommendation = item.recommendation;
  const direct = isDirectSelectionItem(item);
  app.className = "app-shell item-shell";
  app.innerHTML = `
    <section class="item-screen">
      ${renderSlimBrand()}
      <button id="closeDetail" class="detail-close-button" type="button" aria-label="추천표로 돌아가기">×</button>
      <div class="item-progress">
        <button id="backToSummary" class="detail-back" type="button">추천표</button>
        <span>${esc(state.round.label)}</span>
        <strong>${state.itemIndex + 1} / ${state.issueItems.length}</strong>
      </div>
      <h1>${esc(item.label)}</h1>
      ${renderItemVisual(item)}
      <div class="recommend-copy">${direct ? "사이즈를 직접 선택해 주세요." : "추천 사이즈"}</div>
      <div class="recommend-size ${item.finalSize ? "" : "empty"}">${esc(item.finalSize || (direct ? "미선택" : "선택"))}</div>
      ${renderDetailSizeStack(item)}
      <p class="algorithm-note">${direct ? "AI 추천 없이 본인 실측 또는 착용 기준으로 선택합니다." : `${esc(recommendation.targetDescription)} · BMI ${recommendation.bmi} (${esc(recommendation.bmiLabel)})`}</p>
      <div class="mobile-actions">
        ${direct ? "" : `<button id="changeSize" class="primary-button" type="button">사이즈 교체</button>`}
        <div class="action-row">
          <button id="prevItem" class="secondary-button" type="button" ${state.itemIndex === 0 ? "disabled" : ""}>이전</button>
          <button id="nextItem" class="secondary-button strong" type="button">${state.itemIndex === state.issueItems.length - 1 ? "최종 확인" : "다음"}</button>
        </div>
      </div>
    </section>
  `;

  document.querySelector("#closeDetail").addEventListener("click", () => renderInput("추천 사이즈표로 돌아왔습니다."));
  document.querySelector("#backToSummary").addEventListener("click", () => renderInput("추천 사이즈표로 돌아왔습니다."));
  document.querySelector("#changeSize")?.addEventListener("click", () => openSizeSheet(item, "detail"));
  document.querySelectorAll("[data-detail-size]").forEach((button) => {
    button.addEventListener("click", () => {
      applyItemSize(item, button.dataset.detailSize);
      renderItem();
    });
  });
  document.querySelector("#prevItem").addEventListener("click", () => {
    if (state.itemIndex > 0) {
      state.itemIndex -= 1;
      renderItem();
    }
  });
  document.querySelector("#nextItem").addEventListener("click", () => {
    if (isDirectSelectionItem(item) && !item.finalSize) {
      showInfoModal("선택 필요", `${item.label} 사이즈를 직접 선택해 주세요.`);
      return;
    }
    if (state.itemIndex < state.issueItems.length - 1) {
      state.itemIndex += 1;
      renderItem();
    } else {
      renderReview();
    }
  });
}

function renderDetailSizeStack(item) {
  if (isDirectSelectionItem(item)) return renderDirectSizeGrid(item);

  const headers = item.recommendation.tableHeaders;
  const rows = [...item.recommendation.alternatives];
  if (!rows.some((row) => row.size === item.finalSize)) {
    rows.splice(1, 0, {
      size: item.finalSize,
      measureOne: "선택됨",
      measureTwo: "현장 교체",
      relation: "현재 선택"
    });
  }
  return `
    <section class="detail-size-stack" aria-label="${esc(item.label)} 추천 사이즈 후보">
      ${rows.map((row) => {
        const isRecommended = row.relation === "추천";
        const isSelected = row.size === item.finalSize;
        return `
          <button class="detail-size-option ${isRecommended ? "recommended" : ""} ${isSelected ? "selected" : ""}" data-detail-size="${esc(row.size)}" type="button">
            <span>${esc(displayRelation(row.relation))}</span>
            <strong>${esc(row.size)}</strong>
            <small>${esc(headers[1])} ${esc(row.measureOne)} · ${esc(headers[2])} ${esc(row.measureTwo)}</small>
          </button>
        `;
      }).join("")}
    </section>
  `;
}

function renderDirectSizeGrid(item) {
  return `
    <section class="direct-size-grid" aria-label="${esc(item.label)} 직접 선택">
      ${(item.sizes || []).map((size) => `
        <button class="${String(size) === String(item.finalSize) ? "selected" : ""}" data-detail-size="${esc(size)}" type="button">
          ${esc(size)}
        </button>
      `).join("")}
    </section>
  `;
}

function displayRelation(relation) {
  if (relation === "한 치수 낮음") return "한 치수 작게";
  if (relation === "한 치수 큼") return "한 치수 크게";
  return relation;
}

function renderReview(message = "") {
  app.className = "app-shell review-shell";
  app.innerHTML = `
    <section class="review-screen">
      ${renderSlimBrand()}
      <div class="section-kicker">${esc(state.round.label)}</div>
      <h1>최종 확정</h1>
      <p class="review-warning">최종 확정 전 사이즈를 한 번 더 확인해 주세요. 확정 후 교체나 수정은 관리자 확인이 필요합니다.</p>
      <div class="review-list">
        ${state.issueItems
          .map(
            (item, index) => `
              <button class="review-row" data-review-index="${index}" type="button">
                <span>${esc(item.label)}</span>
                <strong>${esc(item.finalSize || "선택 필요")}</strong>
                ${isDirectSelectionItem(item) ? "<em>선택</em>" : item.finalSize !== item.recommendation.recommendedSize ? "<em>교체</em>" : "<em>추천</em>"}
              </button>
            `
          )
          .join("")}
      </div>
      <div class="review-actions">
        <button id="downloadDraftReceipt" class="secondary-button" type="button">현재 내역 이미지 저장</button>
        <button id="submitIssue" class="primary-button" type="button">최종 확정</button>
      </div>
      <p id="submitMessage" class="form-message">${esc(message)}</p>
    </section>
  `;

  document.querySelector("#submitIssue").addEventListener("click", openSubmitConfirm);
  document.querySelector("#downloadDraftReceipt").addEventListener("click", () => downloadReceiptImage(buildCurrentReceiptRows()));
  document.querySelectorAll(".review-row").forEach((row) => {
    row.addEventListener("click", () => {
      state.itemIndex = Number(row.dataset.reviewIndex || 0);
      renderItem();
    });
  });
}

function openSubmitConfirm() {
  if (document.querySelector(".confirm-sheet")) return;
  const missing = findMissingSelections();
  if (missing) {
    state.itemIndex = state.issueItems.findIndex((item) => item.itemId === missing.itemId);
    renderItem();
    showInfoModal("선택 필요", `${missing.label} 사이즈를 직접 선택해 주세요.`);
    return;
  }
  const sheet = document.createElement("div");
  sheet.className = "confirm-sheet";
  sheet.innerHTML = `
    <div class="confirm-panel" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
      <h2 id="confirmTitle">최종 확정할까요?</h2>
      <p>이 버튼을 누르면 현재 선택된 사이즈가 불출 내역으로 저장됩니다. 확정 후 교체나 수정은 현장 관리자 확인이 필요하니, 사이즈 교체가 필요하면 먼저 품목 카드를 눌러 수정해 주세요.</p>
      <label class="pin-setup-field">
        <span>개인 확인 PIN 4자리</span>
        <input id="personalPin" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="예: 1234" />
        <small>나중에 본인 불출기록을 확인하거나 수정할 때 사용합니다.</small>
      </label>
      <div class="confirm-summary">
        ${state.issueItems.map((item) => `
          <span>
            <b>${esc(item.label)}</b>
            <strong>${esc(item.finalSize || "-")}</strong>
          </span>
        `).join("")}
      </div>
      <div class="confirm-actions">
        <button class="ghost-button" type="button" data-cancel>취소</button>
        <button class="primary-button" type="button" data-confirm>확정</button>
      </div>
      <p class="form-message" data-confirm-message></p>
    </div>
  `;
  document.body.appendChild(sheet);
  sheet.querySelector("[data-cancel]").addEventListener("click", () => sheet.remove());
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) sheet.remove();
  });
  const confirm = () => {
    const pin = sheet.querySelector("#personalPin").value.trim();
    const message = sheet.querySelector("[data-confirm-message]");
    if (!/^\d{4}$/.test(pin)) {
      message.textContent = "개인 확인 PIN은 숫자 4자리로 입력해 주세요.";
      return;
    }
    state.personalPin = pin;
    sheet.remove();
    submitIssue();
  };
  sheet.querySelector("[data-confirm]").addEventListener("click", confirm);
  sheet.querySelector("#personalPin").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirm();
    }
  });
  sheet.querySelector("#personalPin").focus();
}

function buildCurrentReceiptRows() {
  return state.issueItems.map((item) => ({
    cohort: state.profile?.cohort || "",
    recruit_no: state.profile?.recruitNo || "",
    round_name: state.round?.label || "",
    item_name: item.label,
    recommended_size: item.recommendation?.recommendedSize || "",
    final_size: item.finalSize || "",
    changed: !isDirectSelectionItem(item) && item.finalSize !== item.recommendation?.recommendedSize ? "Y" : "N"
  }));
}

async function submitIssue() {
  const missing = findMissingSelections();
  if (missing) {
    state.itemIndex = state.issueItems.findIndex((item) => item.itemId === missing.itemId);
    renderItem();
    showInfoModal("선택 필요", `${missing.label} 사이즈를 직접 선택해 주세요.`);
    return;
  }
  setBusy(true, "불출 내역을 저장하고 있습니다.");
  try {
    state.status = await state.api.getStatus(state.profile.recruitNo, state.profile.cohort);
    const routing = syncRoundWithStatus();
    if (routing.allDone) {
      renderDone("모든 불출 차수가 완료되었습니다.", state.status.records || []);
      return;
    }
    if (routing.switched) {
      refreshIssueItems();
      renderInput(`이미 저장된 차수가 있어 ${state.round.label}로 이동했습니다.`);
      return;
    }
  } catch {
    // 저장 요청에서 네트워크 실패 처리를 이어받게 둡니다.
  }

  const payload = buildSubmissionPayload({
    config: state.config,
    round: state.round,
    profile: state.profile,
    issueItems: state.issueItems,
    personalPin: state.personalPin
  });

  try {
    const result = await state.api.submitIssue(payload);
    state.lastSavedRows = result.records || payload.items.map((item) => ({
      recruit_no: payload.recruitNo,
      round_name: payload.roundName,
      item_name: item.itemName,
      recommended_size: item.recommendedSize,
      final_size: item.finalSize,
      changed: item.changed ? "Y" : "N"
    }));
    renderDone(result.duplicate ? "이미 저장된 불출 내역입니다." : "불출 내역이 저장되었습니다.", state.lastSavedRows);
  } catch (error) {
    renderInput(error.pendingSaved ? "네트워크 실패로 휴대폰에 임시 저장했습니다. 연결 후 다시 시도해 주세요." : error.message);
  }
}

function renderDone(title, rows) {
  app.className = "app-shell done-shell";
  const grouped = rowsByRound(rows);
  app.innerHTML = `
    <section class="done-screen">
      ${renderSlimBrand()}
      <h1>${esc(title)}</h1>
      <div id="receiptCard" class="receipt-card">
        <div>
          <span>기수 / 교번</span>
          <strong>${esc(state.profile?.cohort || rows[0]?.cohort || "-")} · ${esc(state.profile?.recruitNo || rows[0]?.recruit_no || "-")}</strong>
        </div>
        ${Object.entries(grouped)
          .map(
            ([roundName, roundRows]) => `
              <section>
                <h2>${esc(roundName)}</h2>
                ${roundRows
                  .map(
                    (row) => `
                      <p>
                        <span>${esc(row.item_name)}</span>
                        <strong>${esc(row.final_size)}</strong>
                      </p>
                    `
                  )
                  .join("")}
              </section>
            `
          )
          .join("")}
      </div>
      <button id="downloadReceipt" class="primary-button" type="button">불출 내역 이미지 저장</button>
      <button id="startOver" class="ghost-button" type="button">처음으로</button>
    </section>
  `;

  document.querySelector("#downloadReceipt").addEventListener("click", () => downloadReceiptImage(rows));
  document.querySelector("#startOver").addEventListener("click", () => {
    state.profile = null;
    state.round = null;
    state.issueItems = [];
    renderInput();
  });
}

function openSizeSheet(item, returnTo = "summary") {
  const sheet = document.createElement("div");
  sheet.className = "size-sheet";
  sheet.innerHTML = `
    <div class="sheet-panel">
      <div class="sheet-handle"></div>
      <h2>${esc(item.label)} 사이즈 ${isDirectSelectionItem(item) ? "선택" : "교체"}</h2>
      <div class="size-options">
        ${(item.sizes || [])
          .map(
            (size) => `
              <button class="${size === item.finalSize ? "selected" : ""}" data-size="${esc(size)}" type="button">${esc(size)}</button>
            `
          )
          .join("")}
      </div>
      <button class="ghost-button" type="button" data-close>닫기</button>
    </div>
  `;
  document.body.appendChild(sheet);
  sheet.querySelectorAll("[data-size]").forEach((button) => {
    button.addEventListener("click", () => {
      applyItemSize(item, button.dataset.size);
      sheet.remove();
      if (returnTo === "detail") {
        renderItem();
      } else {
        renderInput("선택한 사이즈를 반영했습니다.");
      }
    });
  });
  sheet.querySelector("[data-close]").addEventListener("click", () => sheet.remove());
}

function isDirectSelectionItem(item) {
  return item?.recommendation?.inputMode === "direct";
}

function applyItemSize(item, size) {
  item.finalSize = String(size);
  if (isDirectSelectionItem(item) && !item.recommendation.recommendedSize) {
    item.changed = false;
    item.changeReason = "직접 선택";
    return;
  }
  item.changed = item.finalSize !== item.recommendation.recommendedSize;
  item.changeReason = item.changed ? "현장 교체" : "";
}

function findMissingSelections() {
  return state.issueItems.find((item) => isDirectSelectionItem(item) && !item.finalSize);
}

function showRecommendationLoading(show) {
  document.querySelector(".recommend-loading-overlay")?.remove();
  const form = document.querySelector("#profileForm");
  const submit = form?.querySelector('button[type="submit"]');
  if (submit) submit.disabled = show;
  if (!show) return;
  const overlay = document.createElement("div");
  overlay.className = "recommend-loading-overlay";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.innerHTML = `
    <div class="recommend-loading-card">
      <div class="loading-mark"></div>
      <strong>백룡 AI가 추천중</strong>
      <span>잠시만 기다려 주세요.</span>
    </div>
  `;
  document.body.appendChild(overlay);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderSlimBrand() {
  return `
    <header class="slim-brand">
      <img class="brand-gif-logo" src="${esc(state.config.brand.logo)}" alt="${esc(state.config.appName)}" />
    </header>
  `;
}

function renderItemVisual(item) {
  if (item.image) {
    const isMockupImage = String(item.image).includes("assets/mockups/");
    const visualPosition = isMockupImage ? "center 35%" : item.imagePosition || "center";
    const visualFit = isMockupImage ? "cover" : item.imageSize || "contain";
    return `
      <figure class="item-visual image-visual" style="--visual-position: ${esc(visualPosition)}; --visual-fit: ${esc(visualFit)};">
        <img src="${esc(item.image)}" alt="${esc(item.label)} 이미지" loading="eager" />
      </figure>
    `;
  }
  return `
    <div class="item-visual boot-visual" aria-label="전투화 임시 아이콘">
      <div class="boot-icon"></div>
    </div>
  `;
}

function downloadReceiptImage(rows) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1440;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f7faff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#244ca9";
  ctx.font = "bold 64px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("백룡 AI 스마트 신병피복불출", 540, 110);
  ctx.font = "bold 86px sans-serif";
  ctx.fillText("불출 내역", 540, 220);
  ctx.font = "bold 54px sans-serif";
  ctx.fillText(`교번 ${state.profile?.recruitNo || rows[0]?.recruit_no || "-"}`, 540, 310);

  let y = 410;
  rows.forEach((row) => {
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, 90, y - 58, 900, 96, 24);
    ctx.fill();
    ctx.fillStyle = "#1d2a44";
    ctx.font = "bold 42px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(row.item_name, 130, y);
    ctx.textAlign = "right";
    ctx.fillStyle = "#244ca9";
    ctx.fillText(row.final_size, 950, y);
    y += 118;
  });

  const link = document.createElement("a");
  link.download = `uniform-${state.profile?.recruitNo || "receipt"}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function rowsByRound(rows) {
  return rows.reduce((acc, row) => {
    const key = row.round_name || "불출 내역";
    acc[key] = acc[key] || [];
    acc[key].push(row);
    return acc;
  }, {});
}

function isChangedRecord(row) {
  return row?.changed === "Y" || row?.changed === true;
}

function uniqueStrings(values) {
  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .sort((a, b) => a.localeCompare(b, "ko"));
}

function setBusy(isBusy, message) {
  if (!isBusy) return;
  app.className = "app-shell";
  app.innerHTML = `
    <section class="loading-screen">
      <div class="loading-mark"></div>
      <p>${esc(message)}</p>
    </section>
  `;
}

function showInfoModal(title, message) {
  document.querySelector(".info-sheet")?.remove();
  const sheet = document.createElement("div");
  sheet.className = "info-sheet";
  sheet.innerHTML = `
    <div class="info-panel" role="dialog" aria-modal="true" aria-labelledby="infoTitle">
      <h2 id="infoTitle">${esc(title)}</h2>
      <p>${esc(message)}</p>
      <button class="primary-button" type="button" data-info-close>확인</button>
    </div>
  `;
  document.body.appendChild(sheet);
  sheet.querySelector("[data-info-close]").addEventListener("click", () => sheet.remove());
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) sheet.remove();
  });
}

function renderError(message) {
  app.className = "app-shell";
  app.innerHTML = `
    <section class="loading-screen">
      <p>${esc(message)}</p>
      <button class="primary-button" type="button" onclick="location.reload()">다시 시도</button>
    </section>
  `;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}
