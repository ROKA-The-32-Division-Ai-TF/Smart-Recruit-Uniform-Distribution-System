import { loadDistributionConfig, normalizeConfig } from "./config.js";
import { createApi } from "./api.js";

const app = document.querySelector("#adminApp");
const UNIT_MARK_SRC = "assets/brand/unit-mark.svg";
let config;
let api;
let currentSummary;
let currentAdminPin = "";
let visibleSizeSummary = [];
let sizeColumnFilters = {};
let currentIssueSizeRows = [];
let currentIssueSummary = null;
let activeDesktopView = "dashboard";
let activeIssuePanel = "size";
let selectedIssueDate = "all";
let selectedMobileDate = "";
let selectedMobileItemId = "all";
let mobilePersonQuery = "";
let draggedRoundItem = null;
const expandedConfigItems = new Set();

init();

async function init() {
  try {
    config = await loadDistributionConfig();
    api = createApi(config);
    bindLogin();
  } catch (error) {
    document.querySelector("#adminMessage").textContent = error.message || "설정을 불러오지 못했습니다.";
  }
}

function bindLogin() {
  document.querySelector("#adminLogin").addEventListener("click", loadSummary);
  document.querySelector("#adminPin").addEventListener("keydown", (event) => {
    if (event.key === "Enter") loadSummary();
  });
}

async function loadSummary() {
  const pin = document.querySelector("#adminPin").value;
  currentAdminPin = pin;
  const message = document.querySelector("#adminMessage");
  message.textContent = "현황을 불러오는 중입니다.";
  try {
    const summary = await api.adminSummary(pin);
    if (summary.ok === false) {
      message.textContent = summary.message || "관리자 확인에 실패했습니다.";
      return;
    }
    currentSummary = summary;
    renderDashboard(summary);
  } catch (error) {
    message.textContent = error.message || "현황을 불러오지 못했습니다.";
  }
}

function renderDashboard(summary, notice = "") {
  const dailySummary = buildDailySummary(summary.records || []);
  const today = dailySummary[0] || { date: "-", peopleCount: 0, itemCount: 0, changedCount: 0, rounds: {} };
  const mobileDate = resolveMobileDate(dailySummary);
  const mobileItemOptions = buildMobileItemOptions(summary, mobileDate);
  const mobileItemId = resolveMobileItem(mobileItemOptions);
  const mobileIssueSummary = buildIssueSummary(summary, mobileDate, mobileItemId);
  const mobileMetrics = buildMobileMetrics(summary.records || [], mobileDate, mobileItemId);
  const itemShares = buildItemShares(summary.sizeSummary);
  const issueSummary = buildIssueSummary(summary, selectedIssueDate);
  currentIssueSummary = issueSummary;
  currentIssueSizeRows = issueSummary.sizeSummary;
  visibleSizeSummary = filterSizeRows(currentIssueSizeRows);
  app.className = "admin-shell dashboard-mode";
  app.innerHTML = `
    ${renderMobileDashboard(summary, dailySummary, mobileDate, mobileItemId, mobileItemOptions, mobileIssueSummary, mobileMetrics)}
    <div class="desktop-dashboard desktop-only" data-desktop-view="${esc(activeDesktopView)}">
      <div class="dashboard-canvas">
        <header class="dashboard-header">
          <div class="dashboard-header-brand">
            ${unitMarkLogo()}
            <div>
              <strong>관리자 현황</strong>
              <span>${formatDashboardDate(new Date())}</span>
            </div>
          </div>
          <nav class="desktop-nav" aria-label="관리자 화면 전환">
            ${renderNavButton("dashboard", "데시보드")}
            ${renderNavButton("issues", "불출현황")}
            ${renderNavButton("settings", "품목/사이즈 설정")}
            ${renderNavButton("adminSettings", "관리자 설정")}
          </nav>
          <div class="dashboard-spacer"></div>
        </header>
        ${activeDesktopView === "dashboard" ? renderDesktopOverview(summary, today, itemShares) : ""}
        ${activeDesktopView === "issues" ? renderIssueView(issueSummary, dailySummary) : ""}
        ${activeDesktopView === "settings" ? renderSettingsView(notice) : ""}
        ${activeDesktopView === "adminSettings" ? renderAdminSettingsView(notice) : ""}
      </div>
    </div>
  `;

  bindMobileDashboard(dailySummary, mobileDate, mobileItemId);
  bindDesktopNav();
  if (activeDesktopView === "issues") {
    bindIssueControls();
    bindExcelFilters();
  }
  if (activeDesktopView === "settings" && document.querySelector("#addConfigItem")) {
    bindConfigEditor();
  }
  if (activeDesktopView === "adminSettings") {
    bindPinEditor();
    bindAdminSettingsEditor();
  }
}

function renderNavButton(view, label) {
  return `<button class="${activeDesktopView === view ? "active" : ""}" data-desktop-nav="${esc(view)}" type="button">${esc(label)}</button>`;
}

function renderDesktopOverview(summary, today, itemShares) {
  const learning = summary.learningSummary || { totalRows: 0, changedRows: 0, currentA: 24, history: [] };
  return `
    <section class="dashboard-kpi-grid">
      ${renderKpiCard("기준일 불출 품목", today.itemCount, "개", "primary")}
      ${renderKpiCard("기준일 불출 인원", today.peopleCount, "명")}
      ${renderKpiCard("학습 데이터", learning.totalRows, "건", "success")}
      ${renderKpiCard("누적 총 불출", summary.overview.totalItems, "개")}
      <article class="dashboard-panel learning-panel">
        <div class="panel-title">
          <h2>추천 가중치 학습 현황</h2>
          <span>현재 기준값 ${Number(learning.currentA || 24).toFixed(2)}</span>
        </div>
        ${renderLearningChart(learning)}
      </article>
      <article class="dashboard-panel share-panel">
        <div class="panel-title">
          <h2>품목별 비중</h2>
          <span>수량 기준</span>
        </div>
        ${renderDonut(itemShares)}
      </article>
    </section>
  `;
}

function renderIssueView(issueSummary, dailySummary) {
  return `
    <section class="view-control-bar">
      <label class="date-filter">
        일자
        <select id="issueDateFilter">
          <option value="all" ${selectedIssueDate === "all" ? "selected" : ""}>전체</option>
          ${dailySummary.map((row) => `<option value="${esc(row.date)}" ${selectedIssueDate === row.date ? "selected" : ""}>${esc(row.date)}</option>`).join("")}
        </select>
      </label>
    </section>
    ${renderDailySummary(dailySummary)}
    <section class="issue-accordion-list">
      ${renderIssueAccordion("size", "사이즈별 불출현황", "차수, 품목, 사이즈 기준 수량입니다.", renderSizeSummaryPanel(issueSummary))}
      ${renderIssueAccordion("person", "개인별 불출현황", "교번별 최종 불출 사이즈입니다.", renderPersonPanel(issueSummary))}
    </section>
  `;
}

function renderIssueAccordion(panel, title, description, content) {
  const open = activeIssuePanel === panel;
  return `
    <article class="issue-accordion ${open ? "open" : ""}">
      <div class="issue-accordion-head">
        <button class="issue-accordion-toggle" data-issue-panel="${esc(panel)}" type="button" aria-expanded="${open ? "true" : "false"}">
          <span>
            <strong>${esc(title)}</strong>
            <small>${esc(description)}</small>
          </span>
        </button>
        <div class="issue-accordion-actions">
          ${open ? renderIssueAccordionActions(panel) : ""}
          <button class="issue-toggle-pill" data-issue-panel="${esc(panel)}" type="button" aria-expanded="${open ? "true" : "false"}">${open ? "접기" : "열기"}</button>
        </div>
      </div>
      <div class="issue-accordion-body" ${open ? "" : "hidden"}>
        ${content}
      </div>
    </article>
  `;
}

function renderIssueAccordionActions(panel) {
  const legend = panel === "person"
    ? `<span class="accordion-exchange-legend"><i class="exchange-dot"></i>빨간색 행은 교체 이력이 있는 인원입니다.</span>`
    : "";
  return `
    ${legend}
    <button class="secondary-button print-report-button compact-print-button" data-print-report="${esc(panel)}" type="button">인쇄</button>
  `;
}

function renderSettingsView(notice) {
  return `
    ${renderConfigEditor(notice)}
  `;
}

function renderAdminSettingsView(notice) {
  return `
    <section class="view-control-bar align-right">
      <button id="saveAdminSettings" class="secondary-button strong settings-save-button" type="button">설정 저장</button>
    </section>
    <p id="adminSettingsNotice" class="config-notice">${esc(notice)}</p>
    <div class="admin-settings-grid">
      ${renderPinEditor()}
      ${renderCohortEditor()}
      ${renderCreatorPanel()}
      ${renderSystemFlowPanel()}
      ${renderLearningFlowPanel()}
    </div>
  `;
}

function renderPinEditor() {
  return `
    <section class="admin-section pin-editor">
      <div class="section-head">
        <div>
          <h2>관리자 PIN 변경</h2>
          <p>새 PIN은 4자리 이상 숫자로 설정합니다.</p>
        </div>
      </div>
      <div class="pin-editor-form">
        <label>
          현재 PIN
          <input id="currentAdminPin" type="password" inputmode="numeric" autocomplete="current-password" value="${esc(currentAdminPin)}" />
        </label>
        <label>
          새 PIN
          <input id="nextAdminPin" type="password" inputmode="numeric" autocomplete="new-password" />
        </label>
        <label>
          새 PIN 확인
          <input id="confirmAdminPin" type="password" inputmode="numeric" autocomplete="new-password" />
        </label>
        <button id="changeAdminPin" class="secondary-button strong" type="button">PIN 변경</button>
      </div>
      <p id="pinNotice" class="config-notice"></p>
    </section>
  `;
}

function renderCohortEditor() {
  const cohorts = config.cohorts?.length ? config.cohorts : [];
  return `
    <section class="admin-section cohort-editor">
      <div class="section-head">
        <div>
          <h2>기수 관리</h2>
          <p>신병 화면의 기수 선택 목록으로 바로 사용됩니다.</p>
        </div>
        <button id="addCohort" class="secondary-button compact-button" type="button">기수 추가</button>
      </div>
      <div id="cohortEntries" class="cohort-entry-list">
        ${(cohorts.length ? cohorts : [{ label: "", active: true }]).map((cohort, index) => renderCohortEntry(cohort, index)).join("")}
      </div>
    </section>
  `;
}

function renderCohortEntry(cohort, index) {
  return `
    <article class="cohort-entry" data-cohort-entry>
      <input data-cohort-field="cohortId" type="hidden" value="${esc(cohort.cohortId || sanitizeItemId(cohort.label || `cohort_${index + 1}`))}" />
      <input data-cohort-field="order" type="hidden" value="${esc(cohort.order || index + 1)}" />
      <label>
        <span>기수명</span>
        <input data-cohort-field="label" value="${esc(cohort.label || "")}" placeholder="예: 26-4기" />
      </label>
      <label class="cohort-active">
        <input data-cohort-field="active" type="checkbox" ${cohort.active === false ? "" : "checked"} />
        <span>사용</span>
      </label>
      <div class="config-order-actions">
        <button data-move-cohort="up" type="button">위</button>
        <button data-move-cohort="down" type="button">아래</button>
        <button class="remove-cohort" type="button">삭제</button>
      </div>
    </article>
  `;
}

function renderCreatorPanel() {
  const creators = config.metadata?.creators?.length ? config.metadata.creators : defaultCreators();
  return `
    <section class="admin-section creator-panel">
      <div class="section-head">
        <div>
          <h2>만든 사람들</h2>
          <p>쉼표나 줄바꿈으로 여러 명을 입력할 수 있습니다.</p>
        </div>
      </div>
      <div class="creator-editor">
        <textarea id="creatorNames" rows="5" placeholder="예: 홍길동, 이순신">${esc(creators.join("\n"))}</textarea>
      </div>
    </section>
  `;
}

function renderSystemFlowPanel() {
  const steps = [
    ["관리자", "기수/차수/품목 설정"],
    ["신병", "기수 선택 후 교번/키/몸무게 입력"],
    ["정적 앱", "브라우저에서 사이즈 추천 계산"],
    ["신병", "직접 선택 품목 선택 후 최종 확정"],
    ["API", "Apps Script가 결과만 저장"],
    ["Sheets", "불출 현황/학습 데이터 정리"],
    ["관리자", "현황 확인 및 다음 설정 반영"]
  ];
  return `
    <section class="admin-section system-flow-panel">
      <div class="section-head">
        <div>
          <h2>프로그램 동작 방식</h2>
          <p>현장 사용 흐름을 기준으로 한 순서도입니다.</p>
        </div>
      </div>
      <div class="flow-lane">
        ${steps.map(([title, description], index) => `
          <div class="flow-step">
            <b>${String(index + 1).padStart(2, "0")}</b>
            <strong>${esc(title)}</strong>
            <span>${esc(description)}</span>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderLearningFlowPanel() {
  const steps = [
    ["확정", "추천 사이즈와 실제 확정 사이즈를 비교합니다."],
    ["교체 신호", "작게 바꿨는지, 크게 바꿨는지 방향을 남깁니다."],
    ["학습 저장", "Google Sheets의 ml_training에 학습용 기록이 쌓입니다."],
    ["평균 확인", "하루 단위로 교체가 어느 쪽으로 많았는지 봅니다."],
    ["기준 조정", "a값을 아주 조금 움직여 다음 추천을 보정합니다."],
    ["다음 추천", "새 기록이 쌓일수록 추천 기준이 현장에 가까워집니다."]
  ];
  return `
    <section class="admin-section learning-flow-panel">
      <div class="section-head">
        <div>
          <h2>백룡AI 학습 방식</h2>
          <p>교체 기록이 쌓이면 추천 기준을 조금씩 조정합니다.</p>
        </div>
      </div>
      <div class="flow-lane learning-flow-lane">
        ${steps.map(([title, description], index) => `
          <div class="flow-step">
            <b>${String(index + 1).padStart(2, "0")}</b>
            <strong>${esc(title)}</strong>
            <span>${esc(description)}</span>
          </div>
        `).join("")}
      </div>
      <div class="learning-explain-grid">
        <article class="formula-card">
          <strong>계산은 이렇게 봅니다</strong>
          <p>BMI = 몸무게 ÷ (키m × 키m)</p>
          <p>기준 BMI 24보다 크면 조금 큰 쪽, 작으면 조금 작은 쪽으로 추천합니다.</p>
          <p>교체가 계속 한 방향으로 생기면 기준값 a를 조금 움직입니다.</p>
        </article>
        <article class="sample-learning-card">
          <strong>그래프 예시</strong>
          <svg viewBox="0 0 220 94" role="img" aria-label="학습 기준값 예시 그래프">
            <line x1="12" y1="76" x2="208" y2="76" />
            <line x1="12" y1="12" x2="12" y2="76" />
            <polyline points="12,56 52,52 92,58 132,42 172,37 208,29" />
            <circle cx="12" cy="56" r="4" />
            <circle cx="52" cy="52" r="4" />
            <circle cx="92" cy="58" r="4" />
            <circle cx="132" cy="42" r="4" />
            <circle cx="172" cy="37" r="4" />
            <circle cx="208" cy="29" r="4" />
          </svg>
          <p>점이 위로 가면 추천 기준이 조금 커진다는 뜻입니다. 한 번에 확 바뀌지 않고 기록이 쌓일 때마다 천천히 움직입니다.</p>
        </article>
      </div>
    </section>
  `;
}

function defaultCreators() {
  return [
    "제32보병사단 AI TF",
    "대위 정동호 · 9급 전재문 · 병장 김지성 · 병장 김준우 · 상병 김민규 · 일병 임다민 · 일병 전호성"
  ];
}

function bindDesktopNav() {
  document.querySelectorAll("[data-desktop-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      activeDesktopView = button.dataset.desktopNav || "dashboard";
      sizeColumnFilters = {};
      renderDashboard(currentSummary);
    });
  });
}

function bindIssueControls() {
  document.querySelector("#issueDateFilter")?.addEventListener("change", (event) => {
    selectedIssueDate = event.target.value;
    sizeColumnFilters = {};
    renderDashboard(currentSummary);
  });
  document.querySelectorAll("[data-issue-panel]").forEach((button) => {
    button.addEventListener("click", () => {
      activeIssuePanel = activeIssuePanel === button.dataset.issuePanel ? "" : button.dataset.issuePanel || "size";
      renderDashboard(currentSummary);
    });
  });
  document.querySelectorAll("[data-print-report]").forEach((button) => {
    button.addEventListener("click", () => {
      printIssueReport(button.dataset.printReport || "size");
    });
  });
}

function bindPinEditor() {
  document.querySelector("#changeAdminPin")?.addEventListener("click", async () => {
    const notice = document.querySelector("#pinNotice");
    const currentPin = document.querySelector("#currentAdminPin")?.value || "";
    const nextPin = document.querySelector("#nextAdminPin")?.value || "";
    const confirmPin = document.querySelector("#confirmAdminPin")?.value || "";
    if (!/^[0-9]{4,12}$/.test(nextPin)) {
      notice.textContent = "새 PIN은 숫자 4자리 이상으로 입력해 주세요.";
      return;
    }
    if (nextPin !== confirmPin) {
      notice.textContent = "새 PIN 확인이 일치하지 않습니다.";
      return;
    }
    notice.textContent = "PIN을 변경하는 중입니다.";
    try {
      const result = await api.changeAdminPin(currentPin, nextPin);
      if (result.ok === false) {
        notice.textContent = result.message || "PIN 변경에 실패했습니다.";
        return;
      }
      currentAdminPin = nextPin;
      document.querySelector("#currentAdminPin").value = nextPin;
      document.querySelector("#nextAdminPin").value = "";
      document.querySelector("#confirmAdminPin").value = "";
      notice.textContent = result.message || "PIN이 변경되었습니다.";
    } catch (error) {
      notice.textContent = error.message || "PIN 변경에 실패했습니다.";
    }
  });
}

function bindAdminSettingsEditor() {
  document.querySelector("#addCohort")?.addEventListener("click", addCohortEntry);
  document.querySelector("#saveAdminSettings")?.addEventListener("click", saveAdminSettings);
  document.querySelectorAll("[data-cohort-entry]").forEach(bindCohortEntry);
}

function addCohortEntry() {
  const container = document.querySelector("#cohortEntries");
  const nextNumber = container.querySelectorAll("[data-cohort-entry]").length + 1;
  const cohort = {
    cohortId: `cohort_${Date.now()}`,
    label: "",
    order: nextNumber,
    active: true
  };
  container.insertAdjacentHTML("beforeend", renderCohortEntry(cohort, nextNumber - 1));
  bindCohortEntry(container.lastElementChild);
  refreshCohortOrders();
  container.lastElementChild.querySelector('[data-cohort-field="label"]')?.focus();
  setAdminSettingsNotice("새 기수를 추가했습니다. 기수명을 입력하고 설정 저장을 눌러 주세요.");
}

function bindCohortEntry(node) {
  node.querySelectorAll("[data-move-cohort]").forEach((button) => {
    button.onclick = () => {
      moveConfigNode(node, button.dataset.moveCohort, "[data-cohort-entry]");
      refreshCohortOrders();
    };
  });
  node.querySelector(".remove-cohort").onclick = () => {
    const entries = document.querySelectorAll("[data-cohort-entry]");
    if (entries.length <= 1) {
      setAdminSettingsNotice("기수는 최소 1개가 필요합니다.");
      return;
    }
    node.remove();
    refreshCohortOrders();
    setAdminSettingsNotice("기수를 삭제했습니다. 설정 저장을 누르면 반영됩니다.");
  };
}

async function saveAdminSettings() {
  const notice = document.querySelector("#adminSettingsNotice");
  try {
    const cohorts = collectCohortsFromEditor();
    const creators = collectCreatorsFromEditor();
    const nextConfig = {
      ...config,
      configVersion: new Date().toISOString(),
      cohorts,
      metadata: {
        ...(config.metadata || {}),
        creators
      }
    };
    notice.textContent = "관리자 설정을 저장하는 중입니다.";
    const result = await api.saveConfig(currentAdminPin, nextConfig);
    if (result.ok === false) {
      notice.textContent = result.message || "관리자 설정 저장에 실패했습니다.";
      return;
    }
    config = normalizeConfig(result.config || nextConfig);
    api = createApi(config);
    currentSummary = await api.adminSummary(currentAdminPin);
    renderDashboard(currentSummary, "관리자 설정 저장 완료. 신병 화면을 새로고침하면 반영됩니다.");
  } catch (error) {
    notice.textContent = error.message || "관리자 설정 저장에 실패했습니다.";
  }
}

function collectCohortsFromEditor() {
  const entries = [...document.querySelectorAll("[data-cohort-entry]")];
  const seen = new Set();
  const cohorts = entries.map((node, index) => {
    const get = (field) => node.querySelector(`[data-cohort-field="${field}"]`)?.value?.trim() || "";
    const label = normalizeCohortLabel(get("label"));
    if (!label) return null;
    if (seen.has(label)) throw new Error(`기수가 중복되었습니다: ${label}`);
    seen.add(label);
    return {
      cohortId: sanitizeItemId(get("cohortId") || label),
      label,
      order: index + 1,
      active: node.querySelector('[data-cohort-field="active"]')?.checked !== false
    };
  }).filter(Boolean);
  if (!cohorts.length) throw new Error("기수는 최소 1개 이상 입력해 주세요.");
  return cohorts;
}

function collectCreatorsFromEditor() {
  return String(document.querySelector("#creatorNames")?.value || "")
    .split(/[\n,]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function refreshCohortOrders() {
  document.querySelectorAll("[data-cohort-entry]").forEach((node, index) => {
    const order = node.querySelector('[data-cohort-field="order"]');
    if (order) order.value = String(index + 1);
  });
}

function normalizeCohortLabel(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function setAdminSettingsNotice(message) {
  const notice = document.querySelector("#adminSettingsNotice");
  if (notice) notice.textContent = message;
}

function renderMobileDashboard(summary, dailySummary, mobileDate, mobileItemId, mobileItemOptions, issueSummary, metrics) {
  return `
    <div class="admin-mobile-view">
      <header class="admin-topbar">
        ${brandLogo()}
        <div>
          <h1>관리자 현황 확인</h1>
          <p>날짜별 불출 현황</p>
        </div>
      </header>
      <section class="admin-section mobile-date-panel">
        <div class="mobile-filter-grid">
          <label class="mobile-date-picker">
            <span>조회 일자</span>
            <select id="mobileDateFilter">
              <option value="all" ${mobileDate === "all" ? "selected" : ""}>전체 누적</option>
              ${dailySummary.map((row) => `<option value="${esc(row.date)}" ${mobileDate === row.date ? "selected" : ""}>${esc(row.date)}</option>`).join("")}
            </select>
          </label>
          <label class="mobile-date-picker">
            <span>품목 필터</span>
            <select id="mobileItemFilter">
              <option value="all" ${mobileItemId === "all" ? "selected" : ""}>전체 품목</option>
              ${mobileItemOptions.map((item) => `<option value="${esc(item.itemId)}" ${mobileItemId === item.itemId ? "selected" : ""}>${esc(item.label)}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="mobile-kpi-grid">
          <article><span>불출 품목</span><strong>${metrics.itemTypes.toLocaleString("ko-KR")}종</strong></article>
          <article><span>불출 인원</span><strong>${metrics.peopleCount.toLocaleString("ko-KR")}명</strong></article>
          <article><span>불출 건수</span><strong>${metrics.issueCount.toLocaleString("ko-KR")}건</strong></article>
          <article><span>교체율</span><strong>${metrics.exchangeRate}%</strong></article>
        </div>
      </section>
      ${renderMobileItemTable(issueSummary)}
      ${renderMobilePersonSearch(issueSummary)}
    </div>
  `;
}

function bindMobileDashboard(dailySummary, mobileDate, mobileItemId) {
  document.querySelector("#mobileDateFilter")?.addEventListener("change", (event) => {
    selectedMobileDate = event.target.value || dailySummary[0]?.date || "all";
    mobilePersonQuery = "";
    renderDashboard(currentSummary);
  });
  document.querySelector("#mobileItemFilter")?.addEventListener("change", (event) => {
    selectedMobileItemId = event.target.value || "all";
    mobilePersonQuery = "";
    renderDashboard(currentSummary);
  });
  const search = document.querySelector("#mobileRecruitSearch");
  search?.addEventListener("input", (event) => {
    mobilePersonQuery = event.target.value;
    const nextSummary = buildIssueSummary(currentSummary, mobileDate, mobileItemId);
    document.querySelector("#mobilePersonResults").innerHTML = renderMobilePersonResults(nextSummary, mobilePersonQuery);
  });
}

function resolveMobileDate(dailySummary) {
  const validDates = new Set(["all", ...dailySummary.map((row) => row.date)]);
  if (!selectedMobileDate) selectedMobileDate = dailySummary[0]?.date || "all";
  if (!validDates.has(selectedMobileDate)) selectedMobileDate = dailySummary[0]?.date || "all";
  return selectedMobileDate;
}

function buildMobileItemOptions(summary, date) {
  const options = new Map();
  (config.items || []).forEach((item) => {
    options.set(item.itemId, { itemId: item.itemId, label: item.label });
  });
  filterRecordsByDate(summary.records || [], date).forEach((row) => {
    const itemId = String(row.item_id || "").trim();
    if (itemId && !options.has(itemId)) {
      options.set(itemId, { itemId, label: String(row.item_name || itemId) });
    }
  });
  return [...options.values()].sort((a, b) => {
    const aOrder = config.items.findIndex((item) => item.itemId === a.itemId);
    const bOrder = config.items.findIndex((item) => item.itemId === b.itemId);
    return (aOrder < 0 ? 999 : aOrder) - (bOrder < 0 ? 999 : bOrder) || String(a.label).localeCompare(String(b.label), "ko");
  });
}

function resolveMobileItem(options) {
  const validIds = new Set(["all", ...options.map((item) => item.itemId)]);
  if (!validIds.has(selectedMobileItemId)) selectedMobileItemId = "all";
  return selectedMobileItemId;
}

function buildMobileMetrics(records, date, itemId = "all") {
  const rows = filterRecordsByItem(filterRecordsByDate(records, date), itemId);
  const changedCount = rows.filter((row) => row.changed === "Y" || row.changed === true).length;
  return {
    itemTypes: new Set(rows.map((row) => row.item_name).filter(Boolean)).size,
    peopleCount: new Set(rows.map((row) => personIdentity(row)).filter(Boolean)).size,
    issueCount: rows.length,
    exchangeRate: rows.length ? Number(((changedCount / rows.length) * 100).toFixed(1)) : 0
  };
}

function filterRecordsByDate(records, date) {
  if (date === "all") return records;
  return records.filter((row) => formatDate(row.timestamp) === date);
}

function filterRecordsByItem(records, itemId) {
  if (!itemId || itemId === "all") return records;
  return records.filter((row) => String(row.item_id) === String(itemId));
}

function renderMobileItemTable(summary) {
  return `
    <section class="admin-section mobile-report-section">
      <div class="section-head">
        <h2>품목별 불출 수량</h2>
      </div>
      <div class="mobile-table-wrap">
        <table class="mobile-report-table">
          <thead>
            <tr>
              <th>품목</th>
              <th>사이즈</th>
              <th>수량</th>
            </tr>
          </thead>
          <tbody>
            ${summary.sizeSummary.map((row) => `
              <tr>
                <td>
                  <strong>${esc(row.itemName)}</strong>
                  <span>${esc(row.roundName)}</span>
                </td>
                <td>${esc(row.size)}</td>
                <td>${Number(row.count || 0).toLocaleString("ko-KR")}개</td>
              </tr>
            `).join("") || `<tr><td colspan="3">조회된 불출 내역이 없습니다.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderMobilePersonSearch(summary) {
  return `
    <section class="admin-section mobile-person-section">
      <div class="section-head">
        <h2>개인별 검색</h2>
      </div>
      <label class="mobile-search-field">
        <span>기수 또는 교번</span>
        <input id="mobileRecruitSearch" type="search" autocomplete="off" placeholder="예: 26-1기 또는 80" value="${esc(mobilePersonQuery)}" />
      </label>
      <div id="mobilePersonResults" class="mobile-person-results">
        ${renderMobilePersonResults(summary, mobilePersonQuery)}
      </div>
    </section>
  `;
}

function renderMobilePersonResults(summary, query) {
  const keyword = String(query || "").trim();
  if (!keyword) return `<p class="mobile-empty-state">교번을 입력하면 개인별 불출 내역이 표시됩니다.</p>`;
  const rows = summary.personSummary
    .filter((row) => `${row.cohort || ""} ${row.recruitNo}`.includes(keyword))
    .slice(0, 8);
  if (!rows.length) return `<p class="mobile-empty-state">조건에 맞는 개인 불출 내역이 없습니다.</p>`;
  return rows.map((row) => {
    const issuedItems = summary.personColumns
      .filter((column) => row.items[column])
      .map((column) => ({ label: column, size: row.items[column] }));
    return `
      <article class="mobile-person-card">
        <header>
          <strong>${esc(row.cohort || "-")} · 교번 ${esc(row.recruitNo)}</strong>
          <span>${esc(row.roundName)}</span>
        </header>
        <div class="mobile-person-counts">
          <b>${issuedItems.length.toLocaleString("ko-KR")}개 불출</b>
          <small>교체 ${Number(row.changedCount || 0).toLocaleString("ko-KR")}건</small>
        </div>
        <ul>
          ${issuedItems.map((item) => `<li><span>${esc(item.label)}</span><b>${esc(item.size)}</b></li>`).join("")}
        </ul>
      </article>
    `;
  }).join("");
}

function renderKpiCard(label, value, unit, tone = "") {
  return `
    <article class="kpi-card ${tone}">
      <div>
        <span>${esc(label)}</span>
        <strong>${Number(value || 0).toLocaleString("ko-KR")}${esc(unit)}</strong>
        <p>현재 조회 기준</p>
      </div>
    </article>
  `;
}

function renderLearningChart(learning) {
  const history = learning.history || [];
  if (!history.length) {
    return `
      <div class="learning-empty">
        <strong>아직 학습 데이터가 없습니다.</strong>
        <span>신병이 확정한 추천/교체 결과는 Google Sheets의 ml_training 탭에 자동으로 쌓입니다.</span>
      </div>
    `;
  }
  const values = history.map((row) => Number(row.aValue || 24));
  const min = Math.min(...values, 23.8);
  const max = Math.max(...values, 24.2);
  const range = Math.max(max - min, 0.1);
  const points = history.map((row, index) => {
    const x = history.length === 1 ? 50 : (index / (history.length - 1)) * 100;
    const y = 38 - ((Number(row.aValue || 24) - min) / range) * 30;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  return `
    <div class="learning-chart">
      <svg viewBox="0 0 100 44" preserveAspectRatio="none" role="img" aria-label="추천 기준값 변화">
        <polyline points="${points}" />
        ${history.map((row, index) => {
          const [x, y] = points.split(" ")[index].split(",");
          return `<circle cx="${x}" cy="${y}" r="1.5"><title>${esc(row.date)} · 기준값 ${Number(row.aValue || 24).toFixed(2)}</title></circle>`;
        }).join("")}
      </svg>
      <div class="learning-stats">
        <span>누적 ${Number(learning.totalRows || 0).toLocaleString("ko-KR")}건</span>
        <span>교체 ${Number(learning.changedRows || 0).toLocaleString("ko-KR")}건</span>
        <span>현재 a ${Number(learning.currentA || 24).toFixed(2)}</span>
      </div>
      <div class="learning-labels">
        <span>${esc(history[0]?.date || "-")}</span>
        <span>${esc(history[history.length - 1]?.date || "-")}</span>
      </div>
    </div>
  `;
}

function buildItemShares(sizeRows) {
  const totals = new Map();
  sizeRows.forEach((row) => {
    totals.set(row.itemName, (totals.get(row.itemName) || 0) + Number(row.count || 0));
  });
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0) || 1;
  return [...totals.entries()]
    .map(([label, count], index) => ({
      label,
      count,
      percent: Math.round((count / total) * 100),
      color: ["#6c8cff", "#69e6a3", "#ffe681", "#ff8b8b", "#f59d62"][index % 5]
    }))
    .slice(0, 5);
}

function renderDonut(items) {
  if (!items.length) return `<div class="empty-chart">저장된 품목 현황이 없습니다.</div>`;
  let cursor = 0;
  const gradient = items.map((item) => {
    const start = cursor;
    cursor += item.percent;
    return `${item.color} ${start}% ${cursor}%`;
  }).join(", ");
  return `
    <div class="donut-wrap">
      <div class="donut" style="--donut: conic-gradient(${gradient});"></div>
      <div class="donut-legend">
        ${items.map((item) => `
          <span><i style="background:${item.color}"></i>${esc(item.label)} <b>${item.percent}%</b></span>
        `).join("")}
      </div>
    </div>
  `;
}

function renderSizeSummaryPanel(summary) {
  return `
    <section class="admin-section desktop-only dashboard-table-panel">
      <div class="table-wrap">
        <table class="admin-table excel-table" id="sizeTable">
          <thead>
            <tr>
              ${renderExcelFilterHeader("roundName", "차수", summary.sizeSummary)}
              ${renderExcelFilterHeader("itemName", "품목", summary.sizeSummary)}
              ${renderExcelFilterHeader("size", "사이즈", summary.sizeSummary)}
              ${renderExcelFilterHeader("count", "수량", summary.sizeSummary)}
              ${renderExcelFilterHeader("changedCount", "교체", summary.sizeSummary)}
            </tr>
          </thead>
          <tbody id="sizeTableBody">
            ${renderSizeRows(visibleSizeSummary)}
          </tbody>
        </table>
      </div>
      <div class="excel-filter-status">
        <span id="sizeFilterCount">${visibleSizeSummary.length.toLocaleString("ko-KR")}개 항목 표시</span>
        <button id="clearAllSizeFilters" class="ghost-button" type="button">필터 해제</button>
      </div>
    </section>
  `;
}

function renderPersonPanel(summary) {
  return `
    <section class="admin-section desktop-only dashboard-table-panel">
      <div class="table-wrap">
        <table class="admin-table" id="personTable">
          <thead>
            <tr>
              <th>기수</th>
              <th>교번</th>
              <th>차수</th>
              ${summary.personColumns.map((column) => `<th>${esc(column)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${summary.personSummary.map((row) => renderPersonRow(row, summary.personColumns)).join("") || `<tr><td colspan="${summary.personColumns.length + 3}">저장된 불출 내역이 없습니다.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function formatDashboardDate(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(date);
}

function renderDailySummary(rows) {
  return `
    <section class="admin-section daily-section">
      <div class="section-head">
        <h2>일자별 불출현황</h2>
        <p>저장 일자 기준 최근 현황입니다.</p>
      </div>
      <div class="daily-list">
        ${rows.map(renderDailyCard).join("") || `<article class="daily-card empty">저장된 불출 내역이 없습니다.</article>`}
      </div>
    </section>
  `;
}

function renderDailyCard(row) {
  const roundText = Object.entries(row.rounds)
    .map(([roundName, count]) => `${roundName} ${count.toLocaleString("ko-KR")}개`)
    .join(" · ") || "-";
  return `
    <article class="daily-card">
      <strong>${esc(row.date)}</strong>
      <div>
        <span>인원</span>
        <b>${row.peopleCount.toLocaleString("ko-KR")}명</b>
      </div>
      <div>
        <span>품목</span>
        <b>${row.itemCount.toLocaleString("ko-KR")}개</b>
      </div>
      <div>
        <span>교체</span>
        <b>${row.changedCount.toLocaleString("ko-KR")}건</b>
      </div>
      <p>${esc(roundText)}</p>
    </article>
  `;
}

function buildDailySummary(records) {
  const byDate = new Map();
  records.forEach((row) => {
    const date = formatDate(row.timestamp);
    const entry = byDate.get(date) || {
      date,
      itemCount: 0,
      changedCount: 0,
      people: new Set(),
      rounds: {}
    };
    entry.itemCount += 1;
    if (row.changed === "Y" || row.changed === true) entry.changedCount += 1;
    entry.people.add(personIdentity(row));
    entry.rounds[row.round_name] = (entry.rounds[row.round_name] || 0) + 1;
    byDate.set(date, entry);
  });
  return [...byDate.values()]
    .map((entry) => ({
      ...entry,
      peopleCount: entry.people.size
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date), "ko"))
    .slice(0, 14);
}

function buildIssueSummary(summary, date, itemId = "all") {
  if (date === "all" && (!itemId || itemId === "all")) return summary;
  const records = filterRecordsByItem(filterRecordsByDate(summary.records || [], date), itemId);
  return buildSummaryFromRecords(summary, records);
}

function buildSummaryFromRecords(summary, records) {
  const bySize = new Map();
  const byPerson = new Map();

  records.forEach((row) => {
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
      cohort: String(row.cohort || ""),
      recruitNo: String(row.recruit_no || ""),
      roundId: String(row.round_id || ""),
      roundName: String(row.round_name || ""),
      changedCount: 0,
      items: {}
    };
    person.items[row.item_name] = row.final_size;
    if (row.changed === "Y" || row.changed === true) person.changedCount += 1;
    byPerson.set(personKey, person);
  });

  return {
    ...summary,
    sizeSummary: [...bySize.values()].sort(summarySorter),
    personSummary: [...byPerson.values()].sort((a, b) =>
      String(a.cohort || "").localeCompare(String(b.cohort || ""), "ko") ||
      String(a.recruitNo).localeCompare(String(b.recruitNo), "ko") ||
      String(a.roundId).localeCompare(String(b.roundId), "ko")
    ),
    records
  };
}

function personIdentity(row) {
  const recruitNo = String(row.recruit_no || "").trim();
  if (!recruitNo) return "";
  return `${String(row.cohort || "").trim()}|${recruitNo}`;
}

function summarySorter(a, b) {
  return String(a.roundName).localeCompare(String(b.roundName), "ko") || String(a.itemName).localeCompare(String(b.itemName), "ko") || String(a.size).localeCompare(String(b.size), "ko");
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10) || "-";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function renderExcelFilterHeader(column, label, rows) {
  const values = uniqueValues(rows.map((row) => filterValue(row[column])));
  const active = hasActiveFilter(column, values);
  const selected = sizeColumnFilters[column] || new Set(values);
  return `
    <th>
      <div class="excel-filter" data-filter-column="${esc(column)}">
        <div class="excel-filter-head">
          <span>${esc(label)}</span>
          <button class="${active ? "active" : ""}" data-filter-toggle type="button" aria-label="${esc(label)} 필터">▼</button>
        </div>
        <div class="excel-filter-menu" hidden>
          <input data-filter-search type="search" placeholder="검색" />
          <div class="excel-filter-options">
            ${values.map((value) => `
              <label data-filter-label>
                <input data-filter-option type="checkbox" value="${esc(value)}" ${selected.has(value) ? "checked" : ""} />
                ${esc(value)}
              </label>
            `).join("")}
          </div>
          <div class="excel-filter-actions">
            <button data-filter-apply type="button">적용</button>
            <button data-filter-clear type="button">전체</button>
          </div>
        </div>
      </div>
    </th>
  `;
}

function bindExcelFilters() {
  document.querySelectorAll(".excel-filter").forEach((filter) => {
    const menu = filter.querySelector(".excel-filter-menu");
    menu.addEventListener("click", (event) => event.stopPropagation());
    filter.querySelector("[data-filter-toggle]").addEventListener("click", (event) => {
      event.stopPropagation();
      document.querySelectorAll(".excel-filter-menu").forEach((candidate) => {
        if (candidate !== menu) candidate.hidden = true;
      });
      menu.hidden = !menu.hidden;
    });
    filter.querySelector("[data-filter-search]").addEventListener("input", (event) => {
      const keyword = event.target.value.trim().toLowerCase();
      filter.querySelectorAll("[data-filter-label]").forEach((label) => {
        label.hidden = keyword && !label.textContent.toLowerCase().includes(keyword);
      });
    });
    filter.querySelector("[data-filter-apply]").addEventListener("click", () => {
      applyColumnFilter(filter);
      menu.hidden = true;
    });
    filter.querySelector("[data-filter-clear]").addEventListener("click", () => {
      filter.querySelectorAll("[data-filter-option]").forEach((option) => {
        option.checked = true;
      });
      applyColumnFilter(filter);
      menu.hidden = true;
    });
  });
  document.querySelector("#clearAllSizeFilters")?.addEventListener("click", () => {
    sizeColumnFilters = {};
    renderDashboard(currentSummary);
  });
  document.removeEventListener("click", closeExcelFilterMenus);
  document.addEventListener("click", closeExcelFilterMenus);
}

function closeExcelFilterMenus() {
  document.querySelectorAll(".excel-filter-menu").forEach((menu) => {
    menu.hidden = true;
  });
}

function applyColumnFilter(filter) {
  const column = filter.dataset.filterColumn;
  const allValues = uniqueValues(currentIssueSizeRows.map((row) => filterValue(row[column])));
  const checked = [...filter.querySelectorAll("[data-filter-option]:checked")].map((option) => option.value);
  if (checked.length === allValues.length) {
    delete sizeColumnFilters[column];
  } else {
    sizeColumnFilters[column] = new Set(checked);
  }
  visibleSizeSummary = filterSizeRows(currentIssueSizeRows);
  document.querySelector("#sizeTableBody").innerHTML = renderSizeRows(visibleSizeSummary);
  document.querySelector("#sizeFilterCount").textContent = `${visibleSizeSummary.length.toLocaleString("ko-KR")}개 항목 표시`;
  updateFilterButtonStates();
}

function updateFilterButtonStates() {
  document.querySelectorAll(".excel-filter").forEach((filter) => {
    const column = filter.dataset.filterColumn;
    const values = uniqueValues(currentIssueSizeRows.map((row) => filterValue(row[column])));
    filter.querySelector("[data-filter-toggle]").classList.toggle("active", hasActiveFilter(column, values));
  });
}

function filterSizeRows(rows) {
  return rows.filter((row) => Object.entries(sizeColumnFilters).every(([column, values]) => values.has(filterValue(row[column]))));
}

function filterValue(value) {
  return String(value ?? "-");
}

function hasActiveFilter(column, allValues) {
  const selected = sizeColumnFilters[column];
  return Boolean(selected && selected.size !== allValues.length);
}

function renderSizeRows(rows) {
  return rows.map(renderSizeRow).join("") || `<tr><td colspan="5">조건에 맞는 불출 내역이 없습니다.</td></tr>`;
}

function renderSizeRow(row) {
  return `
    <tr>
      <td>${esc(row.roundName)}</td>
      <td>${esc(row.itemName)}</td>
      <td><strong>${esc(row.size)}</strong></td>
      <td>${Number(row.count || 0).toLocaleString("ko-KR")}</td>
      <td>${Number(row.changedCount || 0).toLocaleString("ko-KR")}</td>
    </tr>
  `;
}

function renderPersonRow(row, columns) {
  return `
    <tr class="${row.changedCount ? "changed-person-row" : ""}">
      <td>${esc(row.cohort || "-")}</td>
      <td><strong>${esc(row.recruitNo)}</strong></td>
      <td>${esc(row.roundName)}</td>
      ${columns.map((column) => `<td>${esc(row.items[column] || "-")}</td>`).join("")}
    </tr>
  `;
}

function printIssueReport(type) {
  const title = type === "person" ? "개인별 불출 현황" : "사이즈별 불출 수량";
  const rows = type === "person" ? currentIssueSummary?.personSummary || [] : visibleSizeSummary || [];
  const columns = type === "person"
    ? ["기수", "교번", "차수", ...(currentIssueSummary?.personColumns || [])]
    : ["차수", "품목", "사이즈", "수량", "교체"];
  const bodyRows = type === "person"
    ? rows.map((row) => ({
        changed: Number(row.changedCount || 0) > 0,
        cells: [
          row.cohort || "-",
          row.recruitNo,
          row.roundName,
          ...(currentIssueSummary?.personColumns || []).map((column) => row.items[column] || "-")
        ]
      }))
    : rows.map((row) => ({
        changed: false,
        cells: [row.roundName, row.itemName, row.size, row.count, row.changedCount]
      }));
  const dateText = selectedIssueDate === "all" ? "전체 기간" : selectedIssueDate;
  const fontSize = Math.max(7, Math.min(11, 13 - columns.length * 0.25));
  const html = `
    <!doctype html>
    <html lang="ko">
      <head>
        <meta charset="UTF-8" />
        <title>${esc(title)}</title>
        <style>
          @page { size: A4 landscape; margin: 8mm; }
          * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          html, body { width: 100%; margin: 0; }
          body { color: #111827; font-family: "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; }
          .print-sheet { width: 100%; page-break-inside: avoid; }
          h1 { margin: 0 0 4px; color: #17377d; font-size: 20px; line-height: 1.1; }
          p { margin: 0 0 10px; color: #5f6b80; font-size: 11px; font-weight: 700; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: ${fontSize}px; }
          th, td { border: 1px solid #cbd5e1; padding: 5px 6px; text-align: left; white-space: normal; overflow-wrap: anywhere; line-height: 1.22; }
          th { color: #17377d; background: #eef4ff; font-weight: 900; }
          td { font-weight: 700; }
          tr.changed td { background: #fff1f2; color: #991b1b; }
          .legend { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 8px; color: #991b1b; font-size: 10px; font-weight: 800; }
          .legend i { width: 10px; height: 10px; border-radius: 999px; background: #ef4444; }
        </style>
      </head>
      <body>
        <main class="print-sheet">
          <h1>${esc(title)}</h1>
          <p>${esc(dateText)} · ${bodyRows.length.toLocaleString("ko-KR")}건</p>
          ${type === "person" ? `<div class="legend"><i></i>빨간색 행은 교체 이력이 있는 인원입니다.</div>` : ""}
          <table>
            <thead><tr>${columns.map((column) => `<th>${esc(column)}</th>`).join("")}</tr></thead>
            <tbody>
              ${bodyRows.map((row) => `<tr class="${row.changed ? "changed" : ""}">${row.cells.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${columns.length}">인쇄할 내역이 없습니다.</td></tr>`}
            </tbody>
          </table>
        </main>
        <script>window.addEventListener("load", () => { window.print(); });</script>
      </body>
    </html>
  `;
  const popup = window.open("", "_blank");
  if (!popup) return;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "ko"));
}

function uniqueOrdered(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function renderConfigEditor(notice = "") {
  return `
    <section class="admin-section config-section">
      <div class="config-command-bar">
        <button id="addConfigRound" class="config-command-button" type="button">
          <span>+</span>
          <strong>차수 추가</strong>
        </button>
        <button id="addConfigItem" class="config-command-button" type="button">
          <span>+</span>
          <strong>품목 추가</strong>
        </button>
        <button id="saveConfig" class="config-command-button primary" type="button">
          <span>✓</span>
          <strong>설정 저장</strong>
        </button>
      </div>
      <p id="configNotice" class="config-notice">${esc(notice)}</p>
      ${renderRoundEditor(config.rounds)}
      ${renderRoundCompositionEditor(config.rounds, config.items)}
      <section class="config-stage size-config-stage">
        <div class="config-stage-head">
          <div>
            <h3>품목 / 사이즈표 관리</h3>
            <p>품목을 열어서 이미지와 사이즈표를 수정합니다.</p>
          </div>
        </div>
        <div id="configItems" class="config-items">
          ${config.items.map((item) => renderConfigItem(item)).join("")}
        </div>
      </section>
    </section>
  `;
}

function renderRoundEditor(rounds) {
  return `
    <section class="config-stage round-editor">
      <div class="config-stage-head">
        <div>
          <h3>불출 차수 설정</h3>
          <p>예: 3차 불출, 4차 불출처럼 필요한 만큼 추가할 수 있습니다.</p>
        </div>
      </div>
      <div id="configRounds" class="round-entry-list">
        ${(rounds || []).map((round, index) => renderConfigRound(round, index)).join("")}
      </div>
    </section>
  `;
}

function renderConfigRound(round, index) {
  return `
    <article class="round-entry" data-config-round>
      <input data-round-field="roundId" type="hidden" value="${esc(round.roundId)}" />
      <input data-round-field="order" type="hidden" value="${esc(round.order || index + 1)}" />
      <label>
        <span>차수명</span>
        <input data-round-field="label" value="${esc(round.label || `${index + 1}차 불출`)}" />
      </label>
      <div class="config-order-actions">
        <button data-move-round="up" type="button">위</button>
        <button data-move-round="down" type="button">아래</button>
        <button class="remove-config-round" type="button">삭제</button>
      </div>
    </article>
  `;
}

function renderConfigItem(item) {
  const expanded = expandedConfigItems.has(item.itemId);
  return `
    <article class="config-item ${expanded ? "open" : ""}" data-config-item data-config-item-id="${esc(item.itemId)}">
      <input data-field="itemId" type="hidden" value="${esc(item.itemId)}" />
      <input data-field="recommendationType" type="hidden" value="${esc(item.recommendationType || "manual")}" />
      <input data-field="order" type="hidden" value="${esc(item.order || 0)}" />
      <input data-field="image" type="hidden" value="${esc(item.image || "")}" />
      <input data-field="imagePosition" type="hidden" value="${esc(item.imagePosition || "center")}" />
      <input data-field="imageSize" type="hidden" value="${esc(item.imageSize || "contain")}" />
      <div class="config-item-toolbar">
        <button class="config-item-toggle" data-config-toggle type="button" aria-expanded="${expanded ? "true" : "false"}">
          <span>
            <strong data-config-title>${esc(item.label)}</strong>
            <small>${(item.sizes || []).length.toLocaleString("ko-KR")}개 사이즈 · 클릭해서 수정</small>
          </span>
          <b>${expanded ? "접기" : "열기"}</b>
        </button>
      </div>
      <div class="config-item-body" ${expanded ? "" : "hidden"}>
        <div class="config-card-head">
          <label>
            품목명
            <input data-field="label" value="${esc(item.label)}" />
          </label>
          <button class="ghost-button remove-config-item" type="button">품목 삭제</button>
        </div>
        <div class="image-uploader">
          <div class="image-preview" data-image-preview>
            ${renderImagePreviewMarkup(item.image)}
          </div>
          <div class="image-actions">
            <label class="image-file-label">
              이미지 첨부
              <input data-image-file type="file" accept="image/*" />
            </label>
            <button class="secondary-button clear-image" data-clear-image type="button">이미지 삭제</button>
          </div>
        </div>
        <section class="sizes-editor">
          <div class="sizes-editor-head">
            <h3>사이즈표 추가 / 수정</h3>
            <button class="secondary-button add-size-entry" type="button">사이즈 추가</button>
          </div>
          <div class="size-entry-list">
            ${renderSizeEntries(item.sizes || [])}
          </div>
        </section>
      </div>
    </article>
  `;
}

function renderRoundCompositionEditor(rounds, items) {
  return `
    <section class="config-stage round-composition-editor">
      <div class="config-stage-head">
        <div>
          <h3>차수별 구성 / 불출 순서 설정</h3>
          <p>품목을 차수에 추가한 뒤 마우스로 끌어서 신병 화면 표시 순서를 바꿉니다.</p>
        </div>
      </div>
      <div id="roundCompositions" class="round-composition-list">
        ${(rounds || []).map((round) => renderRoundComposition(round, items)).join("")}
      </div>
    </section>
  `;
}

function renderRoundComposition(round, items) {
  const itemMap = new Map(items.map((item) => [item.itemId, item]));
  const assignedIds = uniqueOrdered((round.itemIds || []).map(String)).filter((itemId) => itemMap.has(itemId));
  const assigned = assignedIds.map((itemId) => itemMap.get(itemId));
  const unused = items.filter((item) => !assignedIds.includes(item.itemId));
  return `
    <article class="round-composition" data-round-composition data-round-id="${esc(round.roundId)}">
      <header>
        <strong data-composition-title="${esc(round.roundId)}">${esc(round.label)}</strong>
        <span>${assigned.length.toLocaleString("ko-KR")}개 품목</span>
      </header>
      <div class="round-item-dropzone" data-round-items="${esc(round.roundId)}">
        ${assigned.map(renderRoundCompositionItem).join("") || `<p class="round-empty">아직 포함된 품목이 없습니다.</p>`}
      </div>
      <div class="round-add-row">
        <select data-add-round-item aria-label="${esc(round.label)} 품목 추가">
          <option value="">품목 선택</option>
          ${unused.map((item) => `<option value="${esc(item.itemId)}">${esc(item.label)}</option>`).join("")}
        </select>
      </div>
    </article>
  `;
}

function renderRoundCompositionItem(item) {
  return `
    <div class="round-item-chip" draggable="true" data-round-item-id="${esc(item.itemId)}">
      <span class="drag-handle" aria-hidden="true">↕</span>
      <strong>${esc(item.label)}</strong>
      <button data-remove-round-item type="button" aria-label="${esc(item.label)} 제외">삭제</button>
    </div>
  `;
}

function bindConfigEditor() {
  document.querySelector("#addConfigRound").addEventListener("click", addConfigRound);
  document.querySelector("#addConfigItem").addEventListener("click", () => {
    const container = document.querySelector("#configItems");
    const itemId = `custom_${Date.now()}`;
    const item = {
      itemId,
      label: "새 품목",
      recommendationType: "manual",
      image: "",
      order: 0,
      sizes: []
    };
    expandedConfigItems.add(itemId);
    container.insertAdjacentHTML("afterbegin", renderConfigItem(item));
    const node = container.firstElementChild;
    bindConfigItem(node);
    refreshConfigOrders();
    refreshRoundCompositionEditor();
    node.scrollIntoView({ block: "start" });
    node.querySelector('[data-field="label"]')?.focus();
  });
  document.querySelector("#saveConfig").addEventListener("click", saveConfigFromEditor);
  document.querySelectorAll("[data-config-round]").forEach(bindConfigRound);
  document.querySelectorAll("[data-config-item]").forEach(bindConfigItem);
  bindRoundCompositionEditor();
}

function addConfigRound() {
  const rounds = readRoundEditorEntries();
  const nextNumber = nextRoundNumber(rounds);
  const round = {
    roundId: nextRoundId(rounds, nextNumber),
    label: `${nextNumber}차 불출`,
    order: rounds.length + 1,
    itemIds: []
  };
  const container = document.querySelector("#configRounds");
  container.insertAdjacentHTML("beforeend", renderConfigRound(round, rounds.length));
  bindConfigRound(container.lastElementChild);
  refreshConfigOrders();
  refreshRoundCompositionEditor();
  setConfigNotice(`${round.label}을 추가했습니다. 아래 차수별 구성에서 품목을 넣어 주세요.`);
  container.lastElementChild.querySelector('[data-round-field="label"]')?.focus();
}

function bindConfigRound(node) {
  const labelInput = node.querySelector('[data-round-field="label"]');
  const idInput = node.querySelector('[data-round-field="roundId"]');
  labelInput.addEventListener("input", () => {
    const label = labelInput.value.trim() || "새 차수";
    document.querySelector(`[data-composition-title="${cssEscape(idInput.value)}"]`)?.replaceChildren(document.createTextNode(label));
  });
  node.querySelectorAll("[data-move-round]").forEach((button) => {
    button.onclick = () => {
      moveConfigNode(node, button.dataset.moveRound, "[data-config-round]");
      refreshConfigOrders();
    };
  });
  node.querySelector(".remove-config-round").onclick = () => {
    const roundNodes = document.querySelectorAll("[data-config-round]");
    if (roundNodes.length <= 1) {
      setConfigNotice("불출 차수는 최소 1개가 필요합니다.");
      return;
    }
    const label = labelInput.value.trim() || "차수";
    node.remove();
    refreshConfigOrders();
    refreshRoundCompositionEditor();
    setConfigNotice(`${label}을 삭제했습니다. 설정 저장을 누르면 반영됩니다.`);
  };
}

function renderImagePreviewMarkup(image) {
  if (image) return `<img src="${esc(image)}" alt="품목 이미지 미리보기" />`;
  return `<span>첨부된 이미지 없음</span>`;
}

function renderSizeEntries(sizes) {
  const values = sizes.length ? sizes : [""];
  return values.map(renderSizeEntry).join("");
}

function renderSizeEntry(size = "") {
  return `
    <div class="size-entry" data-size-entry>
      <input value="${esc(size)}" placeholder="예: 100-178" />
      <button class="remove-size-entry" type="button" aria-label="사이즈 삭제">삭제</button>
    </div>
  `;
}

function bindConfigItem(node) {
  const toggle = node.querySelector("[data-config-toggle]");
  const body = node.querySelector(".config-item-body");
  const itemIdInput = node.querySelector('[data-field="itemId"]');
  const labelInput = node.querySelector('[data-field="label"]');
  toggle.onclick = () => {
    const isOpen = body.hidden;
    body.hidden = !isOpen;
    node.classList.toggle("open", isOpen);
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    toggle.querySelector("b").textContent = isOpen ? "접기" : "열기";
    if (isOpen) {
      expandedConfigItems.add(itemIdInput.value);
    } else {
      expandedConfigItems.delete(itemIdInput.value);
    }
  };
  labelInput?.addEventListener("input", () => {
    const label = labelInput.value.trim() || "새 품목";
    node.querySelector("[data-config-title]").textContent = label;
    updateRoundCompositionItemLabel(itemIdInput.value, label);
  });
  node.querySelector(".remove-config-item").onclick = () => {
    node.remove();
    refreshConfigOrders();
    refreshRoundCompositionEditor();
  };
  bindImageUploader(node);
  bindSizeEditor(node);
}

function bindRoundCompositionEditor() {
  document.querySelectorAll("[data-round-composition]").forEach((panel) => {
    const zone = panel.querySelector("[data-round-items]");
    const select = panel.querySelector("[data-add-round-item]");
    select?.addEventListener("change", () => {
      const itemId = select?.value || "";
      if (!itemId) return;
      const item = readItemEditorEntries().find((candidate) => candidate.itemId === itemId);
      if (!item) return;
      zone.querySelector(".round-empty")?.remove();
      zone.insertAdjacentHTML("beforeend", renderRoundCompositionItem(item));
      bindRoundCompositionChip(zone.lastElementChild);
      select.value = "";
      refreshRoundCompositionSelects();
    });
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      const dragging = draggedRoundItem;
      if (!dragging || dragging === zone) return;
      const duplicate = [...zone.querySelectorAll("[data-round-item-id]")]
        .some((chip) => chip !== dragging && chip.dataset.roundItemId === dragging.dataset.roundItemId);
      if (duplicate) return;
      zone.querySelector(".round-empty")?.remove();
      const afterElement = getDragAfterElement(zone, event.clientY);
      if (afterElement) {
        zone.insertBefore(dragging, afterElement);
      } else {
        zone.appendChild(dragging);
      }
    });
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      refreshRoundCompositionSelects();
    });
  });
  document.querySelectorAll(".round-item-chip").forEach(bindRoundCompositionChip);
  refreshRoundCompositionSelects();
}

function bindRoundCompositionChip(chip) {
  chip.addEventListener("dragstart", (event) => {
    draggedRoundItem = chip;
    chip.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
  });
  chip.addEventListener("dragend", () => {
    chip.classList.remove("dragging");
    draggedRoundItem = null;
    document.querySelectorAll("[data-round-items]").forEach((zone) => {
      if (!zone.querySelector("[data-round-item-id]")) {
        zone.innerHTML = `<p class="round-empty">아직 포함된 품목이 없습니다.</p>`;
      }
    });
    refreshRoundCompositionSelects();
  });
  chip.querySelector("[data-remove-round-item]")?.addEventListener("click", () => {
    const zone = chip.closest("[data-round-items]");
    chip.remove();
    if (zone && !zone.querySelector("[data-round-item-id]")) {
      zone.innerHTML = `<p class="round-empty">아직 포함된 품목이 없습니다.</p>`;
    }
    refreshRoundCompositionSelects();
  });
}

function getDragAfterElement(container, y) {
  const elements = [...container.querySelectorAll(".round-item-chip:not(.dragging)")];
  return elements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

function refreshRoundCompositionEditor() {
  const container = document.querySelector("#roundCompositions");
  if (!container) return;
  const composition = readRoundCompositionEntries();
  const rounds = readRoundEditorEntries().map((round) => ({
    ...round,
    itemIds: composition[round.roundId] || []
  }));
  const items = readItemEditorEntries();
  container.innerHTML = rounds.map((round) => renderRoundComposition(round, items)).join("");
  bindRoundCompositionEditor();
}

function refreshRoundCompositionSelects() {
  const items = readItemEditorEntries();
  document.querySelectorAll("[data-round-composition]").forEach((panel) => {
    const assigned = new Set([...panel.querySelectorAll("[data-round-item-id]")].map((chip) => chip.dataset.roundItemId));
    const select = panel.querySelector("[data-add-round-item]");
    const unused = items.filter((item) => !assigned.has(item.itemId));
    if (!select) return;
    const previous = select.value;
    select.innerHTML = `
      <option value="">품목 선택</option>
      ${unused.map((item) => `<option value="${esc(item.itemId)}">${esc(item.label)}</option>`).join("")}
    `;
    if (unused.some((item) => item.itemId === previous)) select.value = previous;
    select.disabled = unused.length === 0;
    panel.querySelector("header span").textContent = `${assigned.size.toLocaleString("ko-KR")}개 품목`;
  });
}

function updateRoundCompositionItemLabel(itemId, label) {
  document.querySelectorAll("[data-round-item-id]").forEach((chip) => {
    if (chip.dataset.roundItemId === itemId) {
      chip.querySelector("strong").textContent = label;
      chip.querySelector("[data-remove-round-item]")?.setAttribute("aria-label", `${label} 제외`);
    }
  });
  refreshRoundCompositionSelects();
}

function moveConfigNode(node, direction, selector) {
  if (direction === "up") {
    const previous = previousMatchingSibling(node, selector);
    if (previous) node.parentNode.insertBefore(node, previous);
  } else {
    const next = nextMatchingSibling(node, selector);
    if (next) node.parentNode.insertBefore(next, node);
  }
}

function previousMatchingSibling(node, selector) {
  let current = node.previousElementSibling;
  while (current && !current.matches(selector)) current = current.previousElementSibling;
  return current;
}

function nextMatchingSibling(node, selector) {
  let current = node.nextElementSibling;
  while (current && !current.matches(selector)) current = current.nextElementSibling;
  return current;
}

function refreshConfigOrders() {
  document.querySelectorAll("[data-config-round]").forEach((node, index) => {
    const order = node.querySelector('[data-round-field="order"]');
    if (order) order.value = String(index + 1);
  });
  document.querySelectorAll("[data-config-item]").forEach((node, index) => {
    const order = node.querySelector('[data-field="order"]');
    if (order) order.value = String(index + 1);
  });
}

function readRoundEditorEntries() {
  return [...document.querySelectorAll("[data-config-round]")].map((node, index) => {
    const get = (field) => node.querySelector(`[data-round-field="${field}"]`)?.value?.trim() || "";
    return {
      roundId: sanitizeRoundId(get("roundId") || `round_${index + 1}`),
      label: get("label") || `${index + 1}차 불출`,
      order: Number(get("order") || index + 1),
      itemIds: []
    };
  });
}

function readItemEditorEntries() {
  return [...document.querySelectorAll("[data-config-item]")].map((node, index) => {
    const get = (field) => node.querySelector(`[data-field="${field}"]`)?.value?.trim() || "";
    const itemId = sanitizeItemId(get("itemId") || `item_${index + 1}`);
    return {
      itemId,
      label: get("label") || itemId,
      recommendationType: get("recommendationType") || "manual",
      image: get("image"),
      imagePosition: get("imagePosition") || "center",
      imageSize: get("imageSize") || "contain",
      order: index + 1,
      sizes: [...node.querySelectorAll("[data-size-entry] input")]
        .map((input) => input.value.trim())
        .filter(Boolean)
    };
  });
}

function readRoundCompositionEntries() {
  return Object.fromEntries([...document.querySelectorAll("[data-round-composition]")].map((panel) => [
    panel.dataset.roundId,
    [...panel.querySelectorAll("[data-round-item-id]")].map((chip) => chip.dataset.roundItemId).filter(Boolean)
  ]));
}

function nextRoundNumber(rounds) {
  const numbers = rounds
    .map((round) => String(round.label || "").match(/^(\d+)차/)?.[1])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  return numbers.length ? Math.max(...numbers) + 1 : rounds.length + 1;
}

function nextRoundId(rounds, number) {
  const used = new Set(rounds.map((round) => round.roundId));
  let candidate = `round_${number}`;
  let suffix = 1;
  while (used.has(candidate)) {
    candidate = `round_${number}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function bindImageUploader(node) {
  const fileInput = node.querySelector("[data-image-file]");
  const imageInput = node.querySelector('[data-field="image"]');
  const imagePositionInput = node.querySelector('[data-field="imagePosition"]');
  const imageSizeInput = node.querySelector('[data-field="imageSize"]');
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      imageInput.value = await readImageFile(file);
      if (imagePositionInput) imagePositionInput.value = "center";
      if (imageSizeInput) imageSizeInput.value = "contain";
      renderImagePreview(node, imageInput.value);
      setConfigNotice("이미지를 첨부했습니다. 설정 저장을 누르면 반영됩니다.");
    } catch (error) {
      setConfigNotice(error.message || "이미지를 첨부하지 못했습니다.");
    }
  };
  node.querySelector("[data-clear-image]").onclick = () => {
    fileInput.value = "";
    imageInput.value = "";
    if (imagePositionInput) imagePositionInput.value = "center";
    if (imageSizeInput) imageSizeInput.value = "contain";
    renderImagePreview(node, "");
  };
}

function bindSizeEditor(node) {
  const list = node.querySelector(".size-entry-list");
  node.querySelector(".add-size-entry").onclick = () => {
    list.insertAdjacentHTML("beforeend", renderSizeEntry(""));
    bindSizeEntry(list.lastElementChild);
    list.lastElementChild.querySelector("input").focus();
  };
  list.querySelectorAll("[data-size-entry]").forEach(bindSizeEntry);
}

function bindSizeEntry(entry) {
  entry.querySelector(".remove-size-entry").onclick = () => {
    const list = entry.closest(".size-entry-list");
    entry.remove();
    if (!list.querySelector("[data-size-entry]")) {
      list.insertAdjacentHTML("beforeend", renderSizeEntry(""));
      bindSizeEntry(list.lastElementChild);
    }
  };
}

function renderImagePreview(node, image) {
  node.querySelector("[data-image-preview]").innerHTML = renderImagePreviewMarkup(image);
}

function readImageFile(file) {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error("이미지 파일만 첨부할 수 있습니다."));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        resolve(await resizeImageIfNeeded(String(reader.result), file.type));
      } catch {
        resolve(String(reader.result));
      }
    };
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

function resizeImageIfNeeded(dataUrl, mimeType) {
  if (dataUrl.length < 700000 || mimeType === "image/gif" || mimeType === "image/svg+xml") {
    return Promise.resolve(dataUrl);
  }
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const maxSide = 1100;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL(mimeType === "image/jpeg" ? "image/jpeg" : "image/webp", 0.86));
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

function setConfigNotice(message) {
  const notice = document.querySelector("#configNotice");
  if (notice) notice.textContent = message;
}

async function saveConfigFromEditor() {
  const notice = document.querySelector("#configNotice");
  try {
    const nextConfig = collectConfigFromEditor();
    notice.textContent = "설정을 저장하는 중입니다.";
    const result = await api.saveConfig(currentAdminPin, nextConfig);
    if (result.ok === false) {
      notice.textContent = result.message || "설정 저장에 실패했습니다.";
      return;
    }
    config = normalizeConfig(result.config || nextConfig);
    api = createApi(config);
    currentSummary = await api.adminSummary(currentAdminPin);
    renderDashboard(currentSummary, "설정 저장 완료. 신병 화면을 새로고침하면 바로 반영됩니다.");
  } catch (error) {
    notice.textContent = error.message || "설정 저장에 실패했습니다.";
  }
}

function collectConfigFromEditor() {
  const roundNodes = [...document.querySelectorAll("[data-config-round]")];
  if (!roundNodes.length) throw new Error("불출 차수는 최소 1개가 필요합니다.");

  const seenRounds = new Set();
  const roundDefinitions = roundNodes.map((node, index) => {
    const get = (field) => node.querySelector(`[data-round-field="${field}"]`)?.value?.trim() || "";
    const roundId = sanitizeRoundId(get("roundId") || `round_${index + 1}`);
    if (seenRounds.has(roundId)) throw new Error(`차수 ID가 중복되었습니다: ${roundId}`);
    seenRounds.add(roundId);
    return {
      roundId,
      label: get("label") || `${index + 1}차 불출`,
      order: index + 1
    };
  });

  const seen = new Set();
  const items = readItemEditorEntries().map((item) => {
    const itemId = sanitizeItemId(item.itemId);
    if (seen.has(itemId)) throw new Error(`품목 ID가 중복되었습니다: ${itemId}`);
    seen.add(itemId);
    return {
      ...item,
      itemId,
      label: item.label || itemId
    };
  });
  const composition = readRoundCompositionEntries();

  const rounds = roundDefinitions.map((round) => ({
    ...round,
    itemIds: uniqueOrdered(composition[round.roundId] || []).filter((itemId) => seen.has(itemId))
  }));

  return {
    ...config,
    configVersion: new Date().toISOString(),
    rounds,
    items
  };
}

function sanitizeItemId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/^_+|_+$/g, "") || `item_${Date.now()}`;
}

function sanitizeRoundId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/^_+|_+$/g, "") || `round_${Date.now()}`;
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value || "").replace(/["\\]/g, "\\$&");
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

function brandLogo() {
  return `<img class="admin-brand-logo" src="${esc(config.brand.logo)}" alt="${esc(config.appName)}" />`;
}

function unitMarkLogo() {
  return `<img class="unit-mark-logo" src="${UNIT_MARK_SRC}" alt="부대마크" />`;
}
