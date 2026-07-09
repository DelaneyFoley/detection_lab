# Detection Lab

Next.js application for managing detections, prompt versions, datasets, human-in-the-loop review, and Gemini-backed evaluation runs.

## Stack

- Next.js 15
- React 19
- TypeScript
- SQLite via `better-sqlite3`
- Vitest

## Requirements

- Node.js 22.x (Node 20+ works)
- npm
- On the first install, `better-sqlite3` compiles a native module. It normally
  downloads a prebuilt binary; if the build fails, install platform build tools:
  macOS `xcode-select --install`, Windows "Desktop development with C++"
  (Visual Studio Build Tools), Linux `build-essential` + `python3`.

## Getting Started (fresh clone)

```bash
git clone git@github-delaneyfoley:DelaneyFoley/detection_lab.git
# or over HTTPS:
# git clone https://github.com/DelaneyFoley/detection_lab.git

cd detection_lab
npm ci                 # installs all packages (incl. native better-sqlite3)
cp .env.example .env.local   # optional — only needed to run AI models
npm run dev
```

Open `http://localhost:3000`.

On first load, the app auto-creates `data/vlm-eval.db` and seeds 9 bundled
datasets (unassigned, `CUSTOM` split, blank labels/tags, fixed attribute list).
This is one-time and guarded — labels and tags you add are never overwritten on
reload. No API key is required to browse or label the datasets.

## Environment

Use `.env.local` for local development.

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | For Gemini | Default API key for Gemini routes when the request body does not provide `api_key`. |
| `ANTHROPIC_API_KEY` | For Claude | API key used when running Anthropic (Claude) models. |
| `OPENAI_API_KEY` | For OpenAI | API key used when running OpenAI models. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Optional | Path to a Google service account JSON file for resolving protected GCS-backed image URLs. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Optional | Inline JSON alternative to `GOOGLE_APPLICATION_CREDENTIALS`. |
| `ENABLE_RATE_LIMIT` | Optional | Enables the in-memory write-rate limiter when set to `true`. Disabled by default. |

If GCS-backed images are in use, set one of `GOOGLE_APPLICATION_CREDENTIALS` or `GOOGLE_SERVICE_ACCOUNT_JSON`.

## Local Runtime Data

The app creates and mutates local runtime state outside the tracked source tree:

- SQLite database: `data/vlm-eval.db`
- Uploaded dataset files: `public/uploads/datasets/*`

These paths are intentionally gitignored and should not be committed.

## Useful Scripts

```bash
npm run dev
npm run lint
npm run test
npm run build
npm run start
```

## Notes

- The CI workflow runs `lint`, `test`, and `build` on Node 22.
- The 9 bundled datasets in `src/lib/seed-datasets.json` auto-load once on first
  run. Regenerate that file from a local database with
  `node scripts/export-seed-datasets.mjs`.
- All API keys are optional to start: the app runs and loads datasets without
  them, and keys can be pasted in the UI instead of using `.env.local`.
