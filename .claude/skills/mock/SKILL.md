---
name: mock
description: Analyze a UI/UX problem in MyFinance and propose solutions as interactive HTML mockups in docs/mockups, before any app code changes. Use when the user runs /mock, shares screenshots of a screen they dislike, asks to "mock", "mock up", "propose designs/directions" for a screen, or describes a usability problem they want designed before it is built.
---

# /mock: problem analysis → HTML mockups

The user designs before coding. This skill produces one self-contained page, `docs/mockups/<slug>.html`, that (1) proves the problem and (2) proposes 3–5 interactive directions. **Do not change app code in this skill.** Building starts only after the user picks a direction.

Input: whatever follows `/mock` (a problem description), plus any screenshots in the conversation. If both are missing, ask what screen and what bothers them, in one question.

## 1. Gather evidence

- **Screenshots the user pasted**: look at every one closely and note what you see (layout, text, overflow, empty space, state). Try to copy each into `docs/mockups/assets/<slug>/` with `cp`. macOS screenshot temp paths (`/var/folders/.../NSIRD_screencaptureui_*`) are usually blocked by the sandbox; if the copy fails, do not ask the user to fix it: rebuild the current UI in HTML instead (section "Today"), which also lets you show it at worst-case scale.
- **Live app, only if useful and available**: `npm run dev` serves http://localhost:5173. Use the browser skill (`claude-in-chrome` or `built-in-browser`) to capture extra states. Skip when the screenshots suffice.
- **The code behind the screen**: find the component, its CSS and the data it reads (`grep -rn` for visible labels). Read `FINANCE.md` / `PAGES.md` for the documented behaviour. Every issue you list needs a `file:line` reference.

## 2. Analyze

Write down, before designing:

- **Issues**: numbered, each with a short title, severity (High / Medium / Low / To verify), and evidence (what the user sees + the code cause). Include problems the user did not mention if they come from the same screen; mark unconfirmed ones "To verify".
- **Scale**: check the limits in code (max counts, long names, empty states, phone width) and design for the worst case, not the screenshot's data.
- **User stories**: 3–5, "As <persona>, I want <goal> so that <reason>". Personas come from the app's real users (Vietnamese user, ₫ amounts, pay cycle, daily logging).
- **Use cases**: a table of trigger → steps today → goal. "Steps today" shows the friction.

## 3. Design 3–5 directions

- Each direction is a different idea, not a restyle. Name it in 1–3 words.
- Each one lists which issue numbers it **solves**, has a live, working stage (search filters, tabs switch, Back/Next steps), and short **Good / Watch** notes (Watch = cost, data changes, phone behaviour).
- Mark exactly one **Recommended**. If the problem spans two screens, split directions into groups (e.g. A–C picker, D–E settings) and recommend one per group.
- Follow the user's design taste: the UI should explain itself, so keep instructional text inside mockup screens to a minimum; use icons, color, numbers and layout. Use the user's real data from screenshots (names, ₫ amounts in vi-VN format like `3.836.583 ₫`, dates like `5 Nov`).
- Respect app constraints you found: existing data model, endpoints, the 50-item limits, phone dock vs desktop dialog.

## 4. Build the page from the fixed shell

`docs/mockups/_shell.html` is the **fixed shell**: tokens (mirroring `src/styles/globals.css`), page chrome, the section order, app-like components (`.modal`, `.btn`, `.field`, `.chip`, `.sub`…) and the stepper engine. Never edit it for one mockup. Read it once per session to know the classes.

Fixed section order (the shell's `<main>` shows the markup for each):
1. **Intro**: eyebrow, one-line problem as h1, 2–3 sentence summary, legend.
2. **01 Today**: screenshots (`figure.shot`) or an HTML rebuild of the current UI at worst-case scale, then `ol.issues`.
3. **02 Who and when**: `.stories` + use-case table.
4. **03 Directions**: one `section.dir` per direction (tag, name, Recommended pill, idea, `.solves`, `.stage`, `.notes`).
5. **04 Recommendation**: which direction(s) and why, plus a File → Change table of what the build would touch.

Write four fragments in the scratchpad (`<scratchpad>/<slug>/`):
- `body.html`: the whole `<main class="wrap">…</main>`, following the order above.
- `page.css`: direction-specific CSS only, built from the shell's tokens (`var(--card)`, `var(--primary)`…). No literal colors except user data colors (category colors etc.).
- `sprite.svg`: extra `<symbol id="i-…">` icons (lucide-style 24×24 paths).
- `page.js`: interactivity, wrapped in an IIFE. For multi-step flows prefer the shell's stepper (`.stage-host[data-step]`, `[data-p]`, `[data-go]`, `data-labels`, `data-lefts`) over custom code. Accent-insensitive search for Vietnamese: `s.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/gi,'d').toLowerCase()`.

Assemble and check:

```sh
node .claude/skills/mock/assemble.mjs <scratchpad>/<slug> docs/mockups/<slug>.html "<Two To Four Word Title>"
node -e "const h=require('fs').readFileSync('docs/mockups/<slug>.html','utf8');for(const m of h.matchAll(/<script>([\s\S]*?)<\/script>/g))new Function(m[1]);console.log('ok')"
```

The script warns if any `FILL` placeholder is left. To revise a mockup later, edit the fragments (or the generated file directly for small fixes) and republish.

## 5. Hand off (local file only)

- The deliverable is the local file `docs/mockups/<slug>.html`. **Do not publish it with the Artifact tool** and do not load the artifact-design skill; this shell already defines the styling. The user opens it locally (`open docs/mockups/<slug>.html`).
- Reply briefly: the full file path, the top issues in one line each, each direction in one line, your recommendation, and the open questions that decide the build (e.g. "verify issue 8 first?"). Then stop and let the user choose; implementation is a separate request.
