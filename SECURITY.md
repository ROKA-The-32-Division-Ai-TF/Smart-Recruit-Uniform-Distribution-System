# Security Notes

## Secret Handling

- Do not commit `ADMIN_PIN`, `SPREADSHEET_ID`, Google API keys, or GitHub tokens.
- Store `ADMIN_PIN` and `SPREADSHEET_ID` only in Apps Script `Script Properties`.
- The Apps Script Web App URL in `docs/data/distribution-config.json` is a public endpoint, not a secret. Authorization must happen in Apps Script.

## Current Server-Side Guards

- Admin summary, initialization, and runtime configuration saves require `ADMIN_PIN`.
- Admin PIN changes require the current `ADMIN_PIN`.
- Apps Script fails closed if `ADMIN_PIN` is not configured.
- Apps Script fails closed if `SPREADSHEET_ID` is not configured.
- GitHub Pages only hosts static files and does not contain a GitHub write token.
- Recruit height and weight are used in the browser for recommendation only. Raw height, weight, and BMI are not written to Sheets by the current Apps Script pipeline.
- ML training rows store recommendation result features such as final size, changed flag, size delta, and coarse BMI/dis buckets instead of raw body measurements.

## Operational Checklist

- Rotate the administrator PIN before real-world use.
- Delete test recruit rows before production operation.
- Keep the Google Sheet private to the operating account and required administrators.
- Redeploy Apps Script after changing `apps-script/Code.gs`.
- If abuse or unexpected submissions appear, redeploy the Apps Script Web App to a new URL and update `distribution-config.json`.
- Treat the Apps Script Web App URL as a public endpoint. It is not a secret and must not be the only protection for admin actions.
