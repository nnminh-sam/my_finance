# 06. System Use Case Diagrams

This document illustrates the functional capabilities of **MyFinance** through Use Case diagrams and actor specifications across all system domains.

---

## 1. Actors Overview

| Actor | Type | Description |
| :--- | :--- | :--- |
| **Guest (Unauthenticated User)** | Primary Human Actor | A visitor who has not yet signed in. Can register a new account, sign in with email and password, or toggle the local light/dark appearance theme. |
| **Authenticated User** | Primary Human Actor | A signed-in user managing their personal finances across Calendar, Pay Cycle, Week, Day, Analytics, and Profile views. |
| **Recurrence Sync Engine** | Internal System Actor | Automated backend subsystem (`syncRepeatSpendings`) triggered during data loads or explicit sync calls to materialize upcoming recurring expenses within a 14-day lookahead horizon. |

---

## 2. Overall System Use Case Diagram

```mermaid
flowchart LR
    Guest(["👤 Guest User"])
    User(["👤 Authenticated User"])
    SyncEngine(["⚙️ Recurrence Sync Engine"])

    subgraph MyFinanceSystem["MyFinance System Boundary"]
        direction TB

        subgraph UC_Auth["Authentication & Session Management"]
            UC1(["Register Account (/signup)"])
            UC2(["Sign In (/login)"])
            UC3(["Restore / Refresh Session Automatically"])
            UC4(["Sign Out (/profile or Error Screen)"])
            UC5(["Toggle Light / Dark Theme"])
        end

        subgraph UC_Spend["Expense & Repeat Rule Management"]
            UC6(["Add Single Expense"])
            UC7(["Edit / Delete Expense"])
            UC8(["Create Repeat Spending Rule (Daily/Weekdays/Weekly/Monthly)"])
            UC9(["Stop / Delete Repeat Rule (Preserve Past History)"])
            UC10(["Auto-Generate Due Repeat Spendings (14-Day Horizon)"])
        end

        subgraph UC_IncomeSettings["Income & Profile Settings"]
            UC11(["View Income Sources & Month Breakdown"])
            UC12(["Add / Edit / Delete Income Source (Once, Daily, Weekly, Monthly, Yearly)"])
            UC13(["Customize Categories (Name, Color, Icon)"])
            UC14(["Update Profile Avatar URL"])
        end

        subgraph UC_Views["Browsing & Financial Analytics"]
            UC15(["View Monthly Calendar & Spending Heatmap (/calendar)"])
            UC16(["View Weekly Breakdown (/week)"])
            UC17(["Inspect Single-Day Transactions (/day)"])
            UC18(["Analyze Spending Forecast, Anomalies & Concentration (/analytics)"])
        end

        subgraph UC_Cycle["Salary (Pay) Cycle"]
            UC19(["View Spending per Salary Cycle (/cycle)"])
            UC20(["Configure Payday, Weekend Shift & Cycle End"])
            UC21(["Adjust This Month's Payday (Delay / Early Payout)"])
        end
    end

    Guest --> UC1 & UC2 & UC5
    User --> UC3 & UC4 & UC5
    User --> UC6 & UC7 & UC8 & UC9
    User --> UC11 & UC12 & UC13 & UC14
    User --> UC15 & UC16 & UC17 & UC18
    User --> UC19 & UC20 & UC21

    UC15 & UC16 & UC19 -.->|"«include» (GET /spendings)"| UC10
    UC8 -.->|"«include»"| UC10
    SyncEngine --> UC10
```

---

## 3. Domain-Specific Use Case Breakdowns

### 3.1 Authentication & Multi-Tab Session Use Cases

```mermaid
flowchart LR
    Guest(["👤 Guest User"])
    User(["👤 Authenticated User"])

    subgraph AuthBoundary["Authentication & Access Control Boundary"]
        A1(["Access Protected Route (/calendar, /cycle, /week, /day, /analytics, /profile)"])
        A2(["Redirect to /login?next=#lt;safeReturnPath#gt;"])
        A3(["Submit Login Credentials"])
        A4(["Submit Registration Details"])
        A5(["Verify Scrypt Password & Check Rate Limit (10/15m)"])
        A6(["Issue Memory Access Token + HttpOnly Refresh Cookie"])
        A7(["Synchronize Session Across Tabs (Web Locks + BroadcastChannel)"])
        A8(["Revoke Session Family on Logout"])
    end

    Guest --> A1
    A1 -.->|"If Unauthenticated"| A2
    Guest --> A3 & A4
    A3 & A4 -.->|"«include»"| A5
    A5 -.->|"«include»"| A6
    A6 -.->|"«include»"| A7
    User --> A8
    A8 -.->|"«include»"| A7
```

### 3.2 Expense Tracking & Recurring Rule Use Cases

```mermaid
flowchart LR
    User(["👤 Authenticated User"])

    subgraph ExpenseBoundary["Expense & Recurrence Domain"]
        E1(["Open Expense Modal (Header '+' or Day View)"])
        E2(["Record One-Time Expense"])
        E3(["Configure Repeat Rule (Quick Preset or Custom Schedule)"])
        E4(["Validate Category Against Locked User Settings"])
        E5(["Generate Initial Batch of Occurrences (Cap <= 100)"])
        E6(["Edit Existing Transaction"])
        E7(["Delete Single Transaction"])
        E8(["Stop Active Repeat Rule on /profile"])
        E9(["Delete Future Generated Spendings (date >= today)"])
    end

    User --> E1 & E6 & E7 & E8
    E1 --> E2 & E3
    E2 & E3 & E6 -.->|"«include»"| E4
    E3 -.->|"«include»"| E5
    E8 -.->|"«extend» (deleteFuture=true)"| E9
```

### 3.3 Income Management & Financial Analytics Use Cases

```mermaid
flowchart LR
    User(["👤 Authenticated User"])

    subgraph IncomeAnalyticsBoundary["Income & Analytics Domain"]
        I1(["Manage Income Sources (/profile): source, name, amount, frequency, period"])
        I2(["Add / Review a Month's Income (Calendar, Week, Pay Cycle dialog)"])
        I3(["Compute Month Income (Sum of amount × payments in the month)"])
        I4(["Compute Left Over (Month Income − Month Spending)"])

        V1(["Browse Calendar / Week Heatmap"])
        V2(["View Statistical Analytics Dashboard (/analytics)"])
        V3(["Calculate OLS End-of-Month Forecast & 95% Confidence Band"])
        V4(["Detect Tukey Outlier Spending Days"])
        V5(["Compute Pareto 80% Share, Gini Coefficient & Weekday/Hour Punch Card"])
        V6(["Generate Natural-Language Financial Insights"])
    end

    User --> I1 & I2 & V1 & V2
    V1 & V2 -.->|"«include»"| I3
    V1 -.->|"«include»"| I4
    V2 -.->|"«include»"| V3 & V4 & V5 & V6
```

---

### 3.4 Salary (Pay) Cycle Use Cases

```mermaid
flowchart LR
    User(["👤 Authenticated User"])

    subgraph CycleBoundary["Salary Cycle Domain (client-side, /cycle)"]
        C1(["Open Pay Cycle View (current cycle)"])
        C2(["Navigate to Previous / Next Cycle (header arrows or swipe)"])
        C3(["Set Base Payday (day 1–28, day-grid popover)"])
        C4(["Toggle Weekend → Monday Shift"])
        C5(["Toggle Include Next Payday in Cycle"])
        C6(["Set This Month's Actual Payday (mini-calendar or ±1 day, −7…+14)"])
        C7(["Reset This Month's Delay"])
        C8(["Load Spendings for Cycle Grid Range"])
        C9(["Compute Cycle Income, Spending, Top Categories & Leftover"])
        C10(["Persist Config in localStorage (per user, per device)"])
        C11(["Open Day Details / Edit Cycle Month Income"])
    end

    User --> C1 & C2 & C3 & C4 & C5 & C6 & C7 & C11
    C1 & C2 -.->|"«include»"| C8
    C1 & C2 -.->|"«include»"| C9
    C3 & C4 & C5 & C6 & C7 -.->|"«include»"| C10
    C3 & C4 & C5 & C6 & C7 -.->|"«include»"| C9
```

---

## 4. Use Case Specifications Summary

| ID | Use Case Name | Primary Actor | Entry Point / Endpoint | Key Business Rules & Postconditions |
| :--- | :--- | :--- | :--- | :--- |
| **UC-01** | **Register Account** | Guest | `/signup` → `POST /api/v1/auth/register` | Validates name (1–100 chars), normalized email ($\le 254$ chars), and password (12–128 chars). Reserves rate-limit slot (`10/15m`), hashes password with `scrypt`, creates user + session + refresh token history in one SQL CTE. |
| **UC-02** | **Sign In** | Guest | `/login` → `POST /api/v1/auth/login` | Reserves rate-limit slot, performs constant-time `scrypt` verification (or dummy KDF if email unknown), sets `mf_refresh` cookie, returns 15m `accessToken`, redirects to `safeReturnPath(next)`. |
| **UC-06** | **Add Single Expense** | Authenticated User | `ExpenseModal` → `POST /api/v1/finance/spendings` | Locks `finance_settings` row (`FOR UPDATE`), verifies category exists in user's active categories, inserts UUID spending with exact decimal amount ($>0 \dots 10^{12}$), `YYYY-MM-DD` date, and `HH:mm` time. |
| **UC-08** | **Create Repeat Rule** | Authenticated User | `ExpenseModal` → `POST /api/v1/finance/repeat-rules` | Validates frequency (`daily`, `weekdays`, `weekly`, `monthly`) and end condition (`unlimited`, `occurrences` $\le 100$, `until_date`). Inserts rule and bulk-inserts initial batch of up to 100 occurrences in a single transaction. |
| **UC-09** | **Stop Repeat Rule** | Authenticated User | `/profile` → `DELETE /api/v1/finance/repeat-rules/:id?deleteFuture=true` | Deletes future generated spendings (`date >= today`) and deletes the rule row; historical past spendings remain intact with `repeat_rule_id = NULL`. |
| **UC-12** | **Manage Income Sources** | Authenticated User | `/profile` (`IncomeSources`) or `MonthlyIncomeModal` → `GET/POST/PUT/DELETE /api/v1/finance/incomes` | Each source has a required source label (e.g. Salary), optional name, positive amount per payment, frequency (`once`, `daily`, `weekly`, `monthly`, `yearly`), start date, and optional end date (none for one-time). Month income = Σ `amount × payments in the month`; Calendar, Week, and Pay Cycle show **Left Over = month income − spending**. Rows are owner-scoped and never lock settings. |
| **UC-18** | **View Analytics & Forecast** | Authenticated User | `/analytics` (`computeMonthlyAnalytics`) | Computes daily series, 7-day moving average, OLS cumulative projection with $95\%$ confidence interval, Tukey outlier days, category MoM changes, $7 \times 24$ punch card, Pareto curve, Gini index, and actionable text insights. |
| **UC-19** | **View Salary Cycle** | Authenticated User | `/cycle?date=YYYY-MM-DD` (`SalaryCycleView`, `getSalaryCycleForMonth`) | Cycle runs from the month's actual payday to the next month's actual payday (inclusive by default). Loads spendings for the whole Monday–Sunday grid via `GET /spendings?startDate=&endDate=`. Shows cycle spending, top categories, peak day, income of the anchor month (recurring + additional), and leftover. |
| **UC-20** | **Configure Pay Cycle** | Authenticated User | `/cycle` settings banner | Payday 1–28 (default 5), weekend-to-Monday shift (default on), include next payday as cycle end (default on). Saved immediately to `localStorage['tracker_salary_cycle_v1_<userId>']`; not synced to the server or other devices. |
| **UC-21** | **Adjust Month Payday** | Authenticated User | `/cycle` mini-calendar / ±1-day steppers | Stores a per-month delay (−7…+14 days) keyed by `YYYY-MM`; resetting removes it. Changes both this cycle's start and the previous cycle's end. |
