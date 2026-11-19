# Design system audit: roll-up

Run on 2026-11-18 by 9 Sonnet agents, one per showcase page, against the app code on `develop/feat/navbar-sidebar-redesign` (based on `develop/base`).
Counts are as reported by each agent. They have not been spot-checked.

- **FIX**: inconsistent or wrong inside the showcase or the app itself.
- **SYNC**: the showcase drifted from `src/`.
- **ADD**: exists in the app, missing from the showcase.

| Page | FIX | SYNC | ADD | Report |
|---|---:|---:|---:|---|
| colors | 10 | 3 | 2 | [colors.md](colors.md) |
| typography | 6 | 8 | 3 | [typography.md](typography.md) |
| spacing | 3 | 5 | 6 | [spacing.md](spacing.md) |
| elevation | 9 | 8 | 5 | [elevation.md](elevation.md) |
| icons | 10 | 4 | 3 | [icons.md](icons.md) |
| primitives | 9 | 7 | 6 | [primitives.md](primitives.md) |
| components | 8 | 7 | 6 | [components.md](components.md) |
| charts | 9 | 8 | 9 | [charts.md](charts.md) |
| workbench | 7 | 24 | 11 | [workbench.md](workbench.md) |
| **Total** | **71** | **74** | **51** | |

Not audited: `index`, `swarm-report` and `v2-fixes` (narrative pages).

Import-ai code (`Import.css`, `src/lib/import`, `AiImportSection`, `AiModelPicker`, `ImportFlow`, `/design-system` route) is not on this branch. Each report lists it under "Deferred", not in the counts.

`workbench.md` also records the current navbar and sidebar structure, as a baseline for the redesign.
