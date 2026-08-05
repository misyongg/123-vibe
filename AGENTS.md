# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is
`123-vibe` is a collection of **static, client-side HTML apps** (counseling-room tools, in Korean) that are published as a **GitHub Pages** site, plus a few **Google Apps Script** projects. There is no build step, bundler, or package manager — the GitHub Pages workflow (`.github/workflows/deploy.yml`) just uploads the repository root as-is.

### Running the site (development)
There are no dependencies to install. Serve the repository root as static files with any static server, e.g.:

```bash
python3 -m http.server 8000
```

Then open individual apps directly, e.g. `http://localhost:8000/consultation-card/`, `http://localhost:8000/emotion-hotel/emotion-hotel.html`, `http://localhost:8000/anxiety-cup/`.

### Non-obvious gotchas
- **The home page `index.html` is gated behind Google Sign-In** (`home-auth-config.js` sets `GOOGLE_CLIENT_ID` + `ALLOWED_EMAILS`). The Google Identity button only works from an OAuth-authorized origin (`https://misyongg.github.io`, or `http://localhost`). On the cloud VM it is served from a non-authorized origin, so the sign-in gate will show but cannot complete — this is expected. To exercise the actual tools locally, **open the individual app subpaths directly** (they are not gated), rather than going through `index.html`.
- Several apps (e.g. `consultation-card/`, `anxiety-cup/`) integrate with **Google Sheets / Apps Script web-app endpoints** for saving data. The UI renders and is fully interactive locally, but "save to sheet" calls hit external Google endpoints and will fail/no-op without the real backend — this does not block local UI testing.
- `emotion-hotel/emotion-hotel.html` is a **self-contained interactive app** (state kept in `localStorage`), making it the easiest end-to-end demo without any backend.
- The `apps-script/`, `sailing/`, and `google-apps-script/` folders contain **Google Apps Script** code (`Code.gs`, `appsscript.json`). These run on Google's servers and are deployed via the Apps Script editor / `clasp`; they cannot be run on the local VM.

### Lint / test / build
There is no linter, automated test suite, or build command in this repo. "Deployment" is handled entirely by the GitHub Pages workflow on push to `main`.
