# 06. System Use Case Diagrams

This document illustrates the functional capabilities of **MyFinance** through Use Case diagrams and actor specifications across all system domains.

---

## 1. Actors Overview

| Actor | Type | Description |
| :--- | :--- | :--- |
| **Guest (Unauthenticated User)** | Primary Human Actor | A visitor who has not yet signed in. Can register a new account, sign in with email and password, or toggle the local light/dark appearance theme. |
| **Authenticated User** | Primary Human Actor | A signed-in user managing their personal finances across Calendar, Week, Day, Analytics, and Profile views. |
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
            UC11(["Update Recurring Monthly Income"])
            UC12(["Add / Edit / Delete Month-Specific Bonus Income"])
            UC13(["Customize Categories (Name, Color, Icon)"])
            UC14(["Update Profile Avatar URL"])
        end

        subgraph UC_Views["Browsing & Financial Analytics"]
            UC15(["View Monthly Calendar & Spending Heatmap (/calendar)"])
            UC16(["View Weekly Breakdown (/week)"])
            UC17(["Inspect Single-Day Transactions (/day)"])
            UC18(["Analyze Spending Forecast, Anomalies & Concentration (/analytics)"])
        end
    end

    Guest --> UC1 & UC2 & UC5
    User --> UC3 & UC4 & UC5
    User --> UC6 & UC7 & UC8 & UC9
    User --> UC11 & UC12 & UC13 & UC14
    User --> UC15 & UC16 & UC17 & UC18

    UC15 & UC16 -.->|"«include»"| UC10
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
        A1(["Access Protected Route (/calendar, /week, /day, /analytics, /profile)"])
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
        I1(["Set Base Recurring Monthly Income (/profile)"])
        I2(["Manage Month-Specific Additional Income (/profile or Calendar/Week Modal)"])
        I3(["Compute Effective Month Income (Base + Sum of Month Entries)"])

        V1(["Browse Calendar / Week Heatmap"])
        V2(["View Statistical Analytics Dashboard (/analytics)"])
        V3(["Calculate OLS End-of-Month Forecast & 95% Confidence Band"])
        V4(["Detect Tukey Outlier Spending Days"])
        V5(["Compute Pareto 80% Share, Gini Coefficient & Weekday/Hour Punch Card"])
        V6(["Generate Natural-Language Financial Insights"])
    end

    User --> I1 & I2 & V1 & V2
    V1 & V2 -.->|"«include»"| I3
    V2 -.->|"«include»"| V3 & V4 & V5 & V6
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
| **UC-12** | **Manage Monthly Bonus Income** | Authenticated User | `/profile` or `MonthlyIncomeModal` → `POST/PUT/DELETE /api/v1/finance/income-entries` | Stores non-recurring bonus/extra income scoped to a specific `YYYY-MM` month. Effective monthly income is `settings.income + sum(entries for YYYY-MM)`. |
| **UC-18** | **View Analytics & Forecast** | Authenticated User | `/analytics` (`computeMonthlyAnalytics`) | Computes daily series, 7-day moving average, OLS cumulative projection with $95\%$ confidence interval, Tukey outlier days, category MoM changes, $7 \times 24$ punch card, Pareto curve, Gini index, and actionable text insights. |
