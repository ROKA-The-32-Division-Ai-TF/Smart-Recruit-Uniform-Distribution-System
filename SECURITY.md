# Security Notes

## Secret Handling

- Do not commit `ADMIN_PIN`, `SPREADSHEET_ID`, Google API keys, or GitHub tokens.
- Store `ADMIN_PIN` and `SPREADSHEET_ID` only in Apps Script `Script Properties`.
- The Apps Script Web App URL in `docs/data/distribution-config.json` is a public endpoint, not a secret. Authorization must happen in Apps Script.

## Current Server-Side Guards

- Admin summary, initialization, and runtime configuration saves require `ADMIN_PIN`.
- Apps Script fails closed if `ADMIN_PIN` is not configured.
- Apps Script fails closed if `SPREADSHEET_ID` is not configured.
- GitHub Pages only hosts static files and does not contain a GitHub write token.

## Operational Checklist

- Rotate the administrator PIN before real-world use.
- Delete test recruit rows before production operation.
- Keep the Google Sheet private to the operating account and required administrators.
- Redeploy Apps Script after changing `apps-script/Code.gs`.
- If abuse or unexpected submissions appear, redeploy the Apps Script Web App to a new URL and update `distribution-config.json`.
