# Smart Recruit Uniform Distribution System

백룡 AI The One 스마트 신병피복불출 v1입니다.

## 구조

- `docs/` - GitHub Pages용 정적 웹앱
  - `index.html` - 신병 모바일 입력/추천/확정 화면
  - `admin.html` - 보급대 간부용 일자별 현황, 엑셀식 사이즈 필터, 개인별 현황, 품목/이미지/사이즈표 설정 화면
  - `data/distribution-config.json` - 차수, 품목, 사이즈, 이미지, 추천방식 설정
  - `src/recommender.js` - 교번/키/몸무게 기반 임시 추천 알고리즘
- `apps-script/Code.gs` - Google Apps Script Web App API
- `tests/` - 추천 로직 최소 검증

## 로컬 실행

```bash
npm test
npm run serve
```

브라우저에서 `http://localhost:8080` 접속.

`distribution-config.json`의 `api.appsScriptUrl`이 비어 있으면 브라우저 `localStorage`를 사용하는 목업 저장소로 동작합니다. 그래서 로컬에서 바로 1차/2차 흐름과 관리자 현황을 확인할 수 있습니다.

관리자 화면에서 품목/사이즈표를 저장하면 로컬 목업에서는 같은 브라우저의 `localStorage`에 반영됩니다. Apps Script를 연결한 운영 환경에서는 `runtime_config` 시트에 저장되고, 신병 화면을 새로고침하면 최신 설정을 불러옵니다.

## GitHub Pages 배포

1. GitHub 저장소 Settings → Pages로 이동
2. Source를 `Deploy from a branch`로 선택
3. Branch는 `main`, Folder는 `/docs` 선택
4. 저장 후 발급된 Pages URL을 신병 QR 링크로 사용

## Google Apps Script 연결

1. Google Sheets를 생성합니다.
2. Apps Script 프로젝트를 만들고 `apps-script/Code.gs` 내용을 붙여 넣습니다.
3. Apps Script의 프로젝트 설정 또는 스크립트 속성에 아래 값을 설정합니다.
   - `SPREADSHEET_ID`: 저장할 Google Sheets ID
   - `ADMIN_PIN`: 관리자 화면 PIN
4. Apps Script에서 `setup()`을 한 번 실행해 시트를 만듭니다. 이 단계는 배포 후 `npm run test-api -- "관리자PIN"`을 실행해도 자동으로 처리됩니다.
5. 배포 → 새 배포 → 웹 앱
   - 실행 사용자: 나
   - 액세스 권한: 링크가 있는 모든 사용자
6. 발급된 Web App URL을 아래 명령으로 앱 설정에 반영합니다.

```bash
npm run connect-api -- "https://script.google.com/macros/s/배포ID/exec"
```

7. 관리자 PIN으로 연결과 시트 초기화를 점검합니다.

```bash
npm run test-api -- "관리자PIN"
```

`connect-api`를 실행하면 `docs/data/distribution-config.json`의 `api.appsScriptUrl`이 채워지고 테스트 더미 데이터 표시가 꺼집니다. 연결 전에는 로컬 확인용 더미 데이터가 보이고, 연결 후에는 Google Sheets 데이터를 기준으로 동작합니다.

## 데이터 저장 방식

Google Sheets의 `raw_records`는 품목 1개당 1행으로 저장합니다.

| submission_id | recruit_no | round_id | item_id | recommended_size | final_size | changed |
| --- | --- | --- | --- | --- | --- | --- |
| 001-round_1-... | 001 | round_1 | combat_top | 100-173 | 100-173 | N |
| 001-round_1-... | 001 | round_1 | combat_bottom | 80-173 | 85-173 | Y |

이 구조라서 품목이 늘어나도 관리자 집계가 깨지지 않습니다.

자동 생성되는 시트:

- `raw_records` - 원본 기록
- `summary_by_size` - 차수/품목/사이즈별 수량
- `summary_by_person` - 개인별 불출 현황
- `exchange_summary` - 교체 건수/교체율

## 품목/차수 추가

기본값은 `docs/data/distribution-config.json`에 둡니다. 운영 중 품목/이미지/사이즈표 변경은 데스크탑 관리자 화면의 `품목 / 사이즈표 설정`에서 처리할 수 있습니다. 스마트폰 폭에서는 수정 기능을 숨기고 전체 수치와 일자별 현황만 조회합니다.

- `rounds[].itemIds`에 품목 ID를 넣으면 해당 차수 화면에 자동 표시됩니다.
- `items[]`에 품목명, 사이즈 목록, 이미지, 추천방식을 추가합니다.
- 추천방식은 `upper`, `lower`, `outer`, `inner`, `shoes`, `manual`을 사용합니다.

정적 GitHub Pages 프론트엔드가 GitHub 저장소에 직접 쓰도록 만들면 토큰이 노출될 수 있으므로, v1은 Apps Script가 설정 저장 API 역할을 합니다. GitHub Actions는 정적 앱 배포에 쓰고, 현장 설정 변경은 Google Sheets/Apps Script 런타임 설정으로 즉시 반영하는 구조입니다.

## 운영 흐름

1. 신병이 QR로 접속
2. 교번 / 키 / 몸무게 입력
3. 시스템이 교번 기록을 조회
4. 1차 미완료면 1차, 1차 완료면 2차, 전체 완료면 최종 내역 표시
5. 품목별 추천 사이즈 확인
6. 필요 시 사이즈 교체
7. 최종 확정
8. 관리자 화면에서 총 수량, 사이즈별 수량, 개인별 현황 확인
