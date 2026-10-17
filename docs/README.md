# MyFinance Architecture Documentation

Welcome to the architecture documentation suite for **MyFinance**, a full-stack personal finance tracker built as a unified **Next.js 15 (App Router)** application with React 19, serverless Route Handlers, and a Neon Serverless PostgreSQL database.

## Documentation Index

| Document | Description | Key Diagrams Included |
| :--- | :--- | :--- |
| **[01. System Architecture](./01-system-architecture.md)** | High-level system context, Next.js App Router container/component architecture, database schema (ERD), and security boundaries. | System Context Diagram, Container & Component Diagram, Database Entity-Relationship Diagram (`erDiagram`) |
| **[02. Deployment Architecture](./02-deployment-architecture.md)** | Vercel Next.js deployment model, request routing/fallback, local dev vs. production topologies, and environment configuration. | Production Deployment Topology, Request Decision Flow, Local Dev (`next dev`) Topology |
| **[03. CI/CD Architecture](./03-cicd-architecture.md)** | Continuous Integration, testing tiers (unit, HTTP, Neon concurrency), Next.js build verification, database migration workflow, and deployment promotion. | End-to-End CI/CD Pipeline Flowchart, Database Migration & Promotion Sequence, Testing Pyramid Diagram |
| **[04. Source Code Architecture](./04-source-code-architecture.md)** | Deep dive into frontend (Next.js persistent layouts, route groups, React Context tree, cross-tab Web Locks + BroadcastChannel auth, serialized mutations, analytics engine) and backend (Next.js route handlers, Web standard fetch pipeline, injectable stores, row-level locking, recurrence sync engine). | Client Context & Layout Hierarchy Graph, Cross-Tab Auth State Machine, Server Layered Class/Module Diagram, Repeat Rule Sync Flow |
| **[05. Project Structure](./05-project-structure.md)** | Complete repository directory tree, App Router segment mapping, Next.js page manifest, and file-by-file module catalog. | App Router Segment Mapping Diagram, Project Directory Architecture |
| **[06. System Use Case Diagrams](./06-use-case-diagrams.md)** | Actor definitions and functional use case diagrams covering authentication, expense tracking, recurring rules, monthly income, and analytics. | Overall System Use Case Diagram, Auth & Session Use Cases, Expense & Recurrence Use Cases, Income & Analytics Use Cases |
| **[07. Sequence Diagrams](./07-sequence-diagrams.md)** | End-to-end runtime interaction sequences across browser tabs, React contexts, Next.js Route Handlers, and PostgreSQL transactions. | Login & Cross-Tab Sync, Single-Flight Token Rotation & Replay Detection, Protected Page Load & Auto-Sync, Expense & Repeat Rule Creation with Row Lock, Logout Revocation |

---

## Architectural Highlights

1. **Unified Next.js 15 App Router Architecture**:
   - The application combines the React 19 frontend UI and backend API routes in a single unified project root, eliminating monorepo cross-package linking complexity.
   - Route groups separate concerns cleanly: `src/app/(auth)` handles guest authentication views (`/login`, `/signup`), while `src/app/(finance)` wraps financial views (`/calendar`, `/week`, `/day`, `/analytics`, `/profile`) inside a **persistent layout shell** (`src/app/(finance)/layout.tsx`).
   - The persistent finance shell keeps `FinanceProvider`, `SettingsProvider`, header navigation, and global modals (`ExpenseModal`, `MonthlyIncomeModal`) mounted across client transitions via `next/link`, preventing redundant data re-fetching and preserving UI state.
   - Synchronous inline theme initialization prevents light/dark mode flash, and bfcache (`pageshow`) guards revalidate stale authentication state on browser history navigation.

2. **Web Standard API Route Handlers**:
   - Backend APIs live under `src/app/api/route.ts` and `src/app/api/[...slug]/route.ts`, powered by Next.js dynamic Route Handlers that delegate to a portable Web Fetch application layer (`src/server/app.ts` and `src/server/application.ts`).
   - Both the frontend UI and the `/api/v1/*` routes are served on the same origin (port 5173 in local development, HTTPS domain in production), completely eliminating the need for development reverse proxies or multi-service rewrite rules.

3. **Zero-Trust Memory-Only Access Tokens & Atomic Refresh Rotation**:
   - Access tokens (15-minute TTL) live strictly in browser memory ([`src/auth.ts`](../src/auth.ts)) and are coordinated across same-origin tabs via the **Web Locks API** (`navigator.locks`) and **BroadcastChannel**.
   - Refresh tokens (30-day sliding TTL) are stored in `HttpOnly`, `SameSite=Lax`, path-scoped (`/api/v1/auth`) cookies (`mf_refresh`).
   - Backend token rotation ([`src/server/auth/store.ts`](../src/server/auth/store.ts)) executes in a single atomic PostgreSQL CTE statement that detects token replay and immediately revokes the entire session family if a consumed refresh token is reused.

4. **Transactional Per-User Serialization & Incremental Recurrence Engine**:
   - Expense and settings writes lock the user's `finance_settings` row (`SELECT ... FOR UPDATE`) inside a `ReadCommitted` Neon transaction ([`src/server/finance/store.ts`](../src/server/finance/store.ts)) to prevent category-deletion race conditions.
   - Recurring expenses (`daily`, `weekdays`, `weekly`, `monthly`) are generated in bounded batches (capped at 100 occurrences) by [`src/server/finance/recurrence.ts`](../src/server/finance/recurrence.ts) and automatically synced ahead of a 14-day horizon during `GET /api/v1/finance/spendings` and `GET /api/v1/finance/repeat-rules`.
