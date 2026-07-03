# Detection Lab - Technical Specification Document

## Document Information
- **Project Name:** Detection Lab
- **Version:** 0.1.0
- **Repository:** DelaneyFoley/detection_lab
- **Last Updated:** 2026-03-26
- **Document Type:** Engineering Technical Specification

---

## Executive Summary

Detection Lab is a Next.js-based web application designed for managing detections, prompt versions, datasets, human-in-the-loop review workflows, and Gemini AI-backed evaluation runs. The system provides a comprehensive platform for VLM (Vision Language Model) evaluation and management with local persistence and optional cloud-based image resolution.

---

## 1. Project Overview

### 1.1 Purpose
Detection Lab enables teams to:
- Manage and organize AI detection results
- Version control and manage prompts
- Upload and manage evaluation datasets
- Conduct human-in-the-loop reviews of AI-generated outputs
- Execute and track Gemini-backed evaluation runs
- Export and analyze evaluation data

### 1.2 Core Use Cases
1. **Detection Management** - Store, retrieve, and organize detection results
2. **Prompt Engineering** - Version and manage prompt templates
3. **Dataset Management** - Upload and organize evaluation datasets
4. **Human Review** - Facilitate manual review workflows for evaluation validation
5. **AI-Powered Evaluation** - Execute evaluation runs using Google's Gemini API
6. **Data Export** - Export evaluation results and datasets in spreadsheet formats

---

## 2. Architecture & Technology Stack

### 2.1 Technology Stack

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| **Frontend Framework** | Next.js | 15.1.0 | React-based full-stack framework |
| **UI Library** | React | 19.0.0 | Component-based UI rendering |
| **Language** | TypeScript | 5.0.0+ | Type-safe development |
| **Styling** | Tailwind CSS | 4.0.0 | Utility-first CSS framework |
| **Styling Plugin** | Tailwind CSS PostCSS | 4.2.1 | PostCSS integration for Tailwind |
| **Database** | SQLite | (via better-sqlite3 11.7.0) | Local persistent data storage |
| **State Management** | Zustand | 5.0.0 | Client-side state management |
| **AI Integration** | Google Generative AI | 0.24.0 | Gemini API access |
| **Icons** | Lucide React | 0.469.0 | Icon component library |
| **Data Validation** | Zod | 4.3.6 | Runtime schema validation |
| **Spreadsheet I/O** | XLSX | 0.18.5 | Excel/CSV file handling |
| **ID Generation** | UUID | 11.0.0 | Unique identifier generation |
| **Testing** | Vitest | 4.0.18 | Unit testing framework |
| **Linting** | ESLint | 9.0.0 | Code quality analysis |
| **Runtime** | Node.js | 22.x | Backend runtime environment |
| **Package Manager** | npm | Latest | Dependency management |

### 2.2 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend Layer                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │      React Components (src/components)           │  │
│  │  - Detection Management UI                       │  │
│  │  - Prompt Version Manager                        │  │
│  │  - Dataset Upload Interface                      │  │
│  │  - Human-in-Loop Review Workflow                 │  │
│  │  - Evaluation Results Dashboard                  │  │
│  └──────────────────────────────────────────────────┘  │
│                          ↑                               │
│              Zustand State Management                    │
│                          ↓                               │
├─────────────────────────────────────────────────────────┤
│                    API Layer (Next.js)                   │
│  ┌──────────────────────────────────────────────────┐  │
│  │         Server-Side Route Handlers               │  │
│  │  - /api/detections                               │  │
│  │  - /api/prompts                                  │  │
│  │  - /api/datasets                                 │  │
│  │  - /api/evaluations                              │  │
│  └──────────────────────────────────────────────────┘  │
│                          ↑                               │
│            TypeScript Type Safety & Zod Validation      │
│                          ↓                               │
├─────────────────────────────────────────────────────────┤
│                  Business Logic Layer                    │
│  ┌──────────────────────────────────────────────────┐  │
│  │        Core Services (src/lib)                   │  │
│  │  - Detection Service                             │  │
│  │  - Gemini Evaluation Engine                      │  │
│  │  - Dataset Processor                             │  │
│  │  - Prompt Version Manager                        │  │
│  └──────────────────────────────────────────────────┘  │
│                          ↓                               │
├─────────────────────────────────────────────────────────┤
│                Persistence Layer                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │        SQLite Database (data/vlm-eval.db)        │  │
│  │  - Detections Table                              │  │
│  │  - Prompts Table (versioned)                     │  │
│  │  - Datasets Table                                │  │
│  │  - Evaluation Results Table                      │  │
│  │  - Human Review Records Table                    │  │
│  └──────────────────────────────────────────────────┘  │
│                          ↓                               │
├─────────────────────────────────────────────────────────┤
│              External Services                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │        Google Gemini API                         │  │
│  │        (For VLM Evaluation)                      │  │
│  │                                                  │  │
│  │        Google Cloud Storage (Optional)           │  │
│  │        (For Protected Image URLs)                │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────��────────┘
```

---

## 3. Directory Structure

```
detection_lab/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── layout.tsx          # Root layout component
│   │   ├── page.tsx            # Home page
│   │   ├── (routes)/           # Grouped routes
│   │   └── api/                # API route handlers
│   │
│   ├── components/             # Reusable React components
│   │   ├── DetectionManager/   # Detection management UI
│   │   ├── PromptVersioning/   # Prompt version UI
│   │   ├── DatasetUpload/      # Dataset upload UI
│   │   ├── HumanReview/        # Review workflow UI
│   │   └── EvaluationDash/     # Results dashboard
│   │
│   ├── lib/                    # Core business logic
│   │   ├── api-client.ts       # API client utilities
│   │   ├── db.ts               # SQLite connection & schemas
│   │   ├── gemini-service.ts   # Gemini API integration
│   │   ├── dataset-processor.ts# Dataset handling
│   │   └── validators.ts       # Zod schemas for validation
│   │
│   └── types/                  # TypeScript type definitions
│       ├── detection.ts        # Detection interfaces
│       ├── prompt.ts           # Prompt interfaces
│       ├── dataset.ts          # Dataset interfaces
│       ├── evaluation.ts       # Evaluation interfaces
│       └── index.ts            # Type exports
│
├── tests/                      # Vitest unit tests
│   ├── unit/
│   │   ├── detection.test.ts
│   │   ├── dataset.test.ts
│   │   └── gemini.test.ts
│   └── integration/
│       └── workflow.test.ts
│
├── public/
│   ├── uploads/
│   │   └── datasets/           # Uploaded dataset files
│   └── icons/                  # Static icon assets
│
├── data/                       # Local runtime data (gitignored)
│   ├── vlm-eval.db            # SQLite database
│   └── (generated at runtime)
│
├── .env.example               # Environment variable template
├── .eslintrc.json             # ESLint configuration
├── .gitignore                 # Git ignore patterns
├── next.config.ts             # Next.js configuration
├── tsconfig.json              # TypeScript configuration
├── vitest.config.ts           # Vitest configuration
├── postcss.config.mjs          # PostCSS configuration
├── package.json               # Dependencies & scripts
├── package-lock.json          # Locked dependency versions
├── README.md                  # Project documentation
└── TECHNICAL_SPECIFICATION.md # This file
```

---

## 4. Data Model & Database Schema

### 4.1 SQLite Database Overview
- **Database File:** `data/vlm-eval.db`
- **Auto-initialized:** On first application startup if empty
- **Type Safety:** Better-sqlite3 with TypeScript type definitions

### 4.2 Core Tables

#### Detections Table
```sql
CREATE TABLE detections (
  id TEXT PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  detection_type TEXT NOT NULL,
  confidence_score REAL,
  raw_output TEXT,
  metadata JSON
);
```

#### Prompts Table (Versioned)
```sql
CREATE TABLE prompts (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  content TEXT NOT NULL,
  is_active BOOLEAN DEFAULT 0,
  description TEXT,
  UNIQUE(id, version)
);
```

#### Datasets Table
```sql
CREATE TABLE datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  file_path TEXT,
  row_count INTEGER,
  metadata JSON
);
```

#### Evaluation Runs Table
```sql
CREATE TABLE evaluation_runs (
  id TEXT PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  prompt_version TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  results_summary JSON,
  FOREIGN KEY(prompt_version) REFERENCES prompts(id),
  FOREIGN KEY(dataset_id) REFERENCES datasets(id)
);
```

#### Human Review Records Table
```sql
CREATE TABLE review_records (
  id TEXT PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  detection_id TEXT NOT NULL,
  reviewer_notes TEXT,
  verified BOOLEAN,
  FOREIGN KEY(detection_id) REFERENCES detections(id)
);
```

---

## 5. API Endpoints

### 5.1 Detection Management
- `GET /api/detections` - List all detections
- `GET /api/detections/:id` - Get detection details
- `POST /api/detections` - Create detection
- `PUT /api/detections/:id` - Update detection
- `DELETE /api/detections/:id` - Delete detection

### 5.2 Prompt Management
- `GET /api/prompts` - List all prompts
- `GET /api/prompts/:id` - Get prompt with all versions
- `POST /api/prompts` - Create new prompt
- `POST /api/prompts/:id/versions` - Add prompt version
- `PUT /api/prompts/:id/versions/:version/activate` - Set active version

### 5.3 Dataset Management
- `GET /api/datasets` - List datasets
- `POST /api/datasets` - Upload new dataset
- `GET /api/datasets/:id` - Get dataset details
- `DELETE /api/datasets/:id` - Delete dataset

### 5.4 Evaluation Runs
- `POST /api/evaluations/run` - Start evaluation with Gemini
- `GET /api/evaluations/:id` - Get evaluation results
- `GET /api/evaluations/:id/progress` - Get real-time progress

### 5.5 Human Review Workflow
- `GET /api/reviews/pending` - Get pending reviews
- `POST /api/reviews/:id/submit` - Submit review result
- `GET /api/reviews/:id` - Get review details

---

## 6. Environment Configuration

### 6.1 Required Environment Variables

| Variable | Type | Required | Purpose |
|----------|------|----------|---------|
| `GEMINI_API_KEY` | string | Usually | Default API key for Gemini routes without inline `api_key` |
| `GOOGLE_APPLICATION_CREDENTIALS` | string | Optional | Path to Google service account JSON file |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | string | Optional | Inline JSON alternative to credentials file |
| `ENABLE_RATE_LIMIT` | boolean | Optional | Enable in-memory write-rate limiter (default: false) |

### 6.2 Setup Instructions

1. **Copy Environment Template:**
   ```bash
   cp .env.example .env.local
   ```

2. **Configure API Keys:**
   - Obtain Gemini API key from Google Cloud Console
   - Set `GEMINI_API_KEY` in `.env.local`

3. **Optional: GCS Image Resolution**
   - For protected GCS-backed image URLs, set one of:
     - `GOOGLE_APPLICATION_CREDENTIALS` (path to service account JSON)
     - `GOOGLE_SERVICE_ACCOUNT_JSON` (inline JSON)

---

## 7. Development Workflow

### 7.1 Setup & Installation

```bash
# Install dependencies
npm ci

# Create local environment file
cp .env.example .env.local

# Start development server
npm run dev
```

Access the application at `http://localhost:3000`

### 7.2 Available Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| **Dev** | `npm run dev` | Start dev server with hot reload (localhost:3000) |
| **Build** | `npm run build` | Production-ready build |
| **Start** | `npm run start` | Run production build |
| **Lint** | `npm run lint` | Check code quality with ESLint |
| **Test** | `npm run test` | Run unit tests with Vitest |

### 7.3 Development Best Practices

- **Type Safety:** Always use TypeScript types for new code
- **Schema Validation:** Use Zod schemas for all API inputs
- **Database:** Use better-sqlite3 synchronous API for consistency
- **State Management:** Use Zustand stores for global client state
- **Testing:** Aim for >80% coverage on business logic
- **Component Structure:** Keep components under 300 lines
- **API Design:** Follow RESTful conventions for endpoints

---

## 8. Build & Deployment

### 8.1 Build Process

```bash
npm run build
```

**Build Output:**
- Next.js compiled application in `.next/` directory
- Optimized for production deployment
- Includes server-side rendering and static optimization

### 8.2 Production Deployment

**Requirements:**
- Node.js 22.x runtime
- Environment variables configured
- Write permissions for `data/` directory
- 100MB+ disk space for SQLite database

**Steps:**
1. Build application: `npm run build`
2. Set production environment variables
3. Start server: `npm start`
4. Application listens on default port 3000

### 8.3 Local Runtime Data

The application creates and maintains local runtime state outside the Git repository:

- **SQLite Database:** `data/vlm-eval.db`
  - Initialized automatically on first run
  - Contains all persisted data
  - Should be backed up before updates

- **Uploaded Datasets:** `public/uploads/datasets/*`
  - User-uploaded evaluation files
  - Referenced by dataset records
  - Should be included in backup strategy

**Note:** Both paths are in `.gitignore` and should not be committed.

---

## 9. Quality Assurance

### 9.1 Testing Strategy

**Unit Tests:**
- Test individual services and utilities
- Mock Gemini API calls
- Test Zod schema validation

**Integration Tests:**
- Test full workflows (upload → process → evaluate)
- Test database operations
- Test API route handlers

**Run Tests:**
```bash
npm run test
```

### 9.2 Code Quality

**Linting:**
```bash
npm run lint
```

**Enforced Rules:**
- ESLint with Next.js recommended config
- TypeScript strict mode enabled
- No unused variables or imports
- Consistent code style

### 9.3 CI/CD Pipeline

- **Trigger:** On every push to main
- **Node Version:** 22.x
- **Steps:**
  1. Run linting: `npm run lint`
  2. Run tests: `npm run test`
  3. Build application: `npm run build`

---

## 10. Performance & Scalability

### 10.1 Performance Considerations

**Frontend:**
- Lazy-load components using Next.js dynamic imports
- Optimize images with Next.js Image component
- Use React.memo for expensive components

**Database:**
- Use indexes on frequently queried fields
- Batch operations where possible
- Archive old evaluation runs to separate table

**API:**
- Implement pagination for list endpoints
- Cache Gemini responses when applicable
- Use rate limiting for heavy operations (optional via `ENABLE_RATE_LIMIT`)

### 10.2 Scalability Limitations

**Current Design:**
- SQLite suitable for ~100K records
- Single-machine deployment
- In-memory rate limiter (not distributed)

**For Scaling to Production:**
- Migrate to PostgreSQL or MySQL
- Implement proper distributed caching (Redis)
- Deploy on multiple instances with load balancing
- Consider moving to serverless functions

---

## 11. Security Considerations

### 11.1 API Key Management

- Never commit `.env.local` files
- Rotate Gemini API keys regularly
- Use environment variables exclusively
- Implement API key validation in routes

### 11.2 Database Security

- SQLite used for local development
- Better-sqlite3 prevents SQL injection via parameterized queries
- Always validate input with Zod schemas

### 11.3 File Upload Security

- Validate uploaded file types
- Store files outside web root
- Implement file size limits
- Scan uploaded files for malicious content

### 11.4 CORS & Authentication

- Configure CORS for production domains
- Implement user authentication if needed
- Use secure session management

---

## 12. Integration Points

### 12.1 Google Gemini API

**Purpose:** AI-powered evaluation of detection results

**Integration:**
- Uses `@google/generative-ai` SDK (v0.24.0)
- API key from environment: `GEMINI_API_KEY`
- Service account auth via `GOOGLE_APPLICATION_CREDENTIALS`

**Usage Pattern:**
```typescript
// Example usage in src/lib/gemini-service.ts
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });
```

### 12.2 Google Cloud Storage (Optional)

**Purpose:** Resolve protected GCS-backed image URLs

**Integration:**
- Optional authentication via service account
- Transparently resolves signed URLs
- Used when evaluation requires image context

---

## 13. Common Issues & Troubleshooting

### 13.1 Database Issues

**Problem:** Database file corrupted
- **Solution:** Delete `data/vlm-eval.db` and restart (recreates on first run)

**Problem:** "Database is locked"
- **Solution:** Ensure only one instance running; restart server

### 13.2 Gemini API Issues

**Problem:** 401 Unauthorized
- **Solution:** Verify `GEMINI_API_KEY` is correct and valid

**Problem:** Rate limit exceeded
- **Solution:** Enable `ENABLE_RATE_LIMIT=true` to throttle requests

### 13.3 File Upload Issues

**Problem:** Large file uploads fail
- **Solution:** Check disk space in `data/` and `public/uploads/` directories

---

## 14. Future Considerations

### 14.1 Planned Features

- [ ] User authentication and role-based access control
- [ ] Multi-model evaluation support (Claude, LLaMA, etc.)
- [ ] Real-time collaboration features
- [ ] Advanced analytics dashboard
- [ ] Webhook integrations for external tools
- [ ] Automated model comparison reports

### 14.2 Technical Debt

- [ ] Migrate to PostgreSQL for production
- [ ] Implement distributed caching
- [ ] Add comprehensive integration tests
- [ ] Improve error handling and logging
- [ ] Implement proper monitoring and alerting

---

## 15. Contact & Support

**For Questions or Issues:**
- Repository: https://github.com/DelaneyFoley/detection_lab
- Issues: https://github.com/DelaneyFoley/detection_lab/issues
- Discussions: https://github.com/DelaneyFoley/detection_lab/discussions

**Key Team Members:**
- Owner: @DelaneyFoley

---

## Appendix A: Dependency Justification

| Dependency | Justification |
|-----------|--------------|
| **Next.js 15** | Full-stack React framework with built-in API routes, SSR, and optimization |
| **React 19** | Latest React with improved performance and features |
| **TypeScript 5** | Type safety for large codebases; catches errors at compile time |
| **Tailwind CSS 4** | Rapid UI development with utility-first approach |
| **Better-sqlite3** | Synchronous, performant SQLite wrapper for Node.js |
| **Zustand** | Lightweight state management without boilerplate |
| **Google Generative AI** | Official SDK for Gemini API integration |
| **Zod** | Runtime schema validation for API contracts |
| **XLSX** | Handle Excel/CSV file imports for datasets |
| **Vitest** | Fast unit testing with Vite integration |

---

## Appendix B: Release Checklist

Before releasing a new version:

- [ ] All tests passing (`npm run test`)
- [ ] Linting passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] Environment variables documented
- [ ] Database schema migration tested
- [ ] API endpoints tested with real Gemini calls
- [ ] File uploads tested with large files
- [ ] Performance regression tests passed
- [ ] Security audit completed
- [ ] Version bumped in package.json
- [ ] CHANGELOG updated
- [ ] Documentation updated

---

**Document Version:** 1.0.0  
**Last Updated:** 2026-03-26  
**Status:** Active