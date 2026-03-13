# Detection Lab

Next.js application for managing detections, prompt versions, datasets, human-in-the-loop review, and Gemini-backed evaluation runs.

## Stack

- Next.js 15
- React 19
- TypeScript
- SQLite via `better-sqlite3`
- Vitest

## Requirements

- Node.js 22.x
- npm

## Setup

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Environment

Use `.env.local` for local development.

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | Usually | Default API key for Gemini routes when the request body does not provide `api_key`. |
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
- Baseline detection seed data is created on first use if the database is empty.
