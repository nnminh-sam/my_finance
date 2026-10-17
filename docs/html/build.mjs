#!/usr/bin/env node
// Generates the HTML documentation site from the markdown files in /docs.
// Usage (from repo root): node docs/html/build.mjs
// No npm dependencies: markdown, Mermaid and KaTeX are rendered in the browser.
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(here, "..");
const publicDocsDir = path.resolve(here, "../../public/docs");

const docs = [
  { src: "README.md", out: "index.html", label: "Overview" },
  { src: "01-system-architecture.md", out: "01-system-architecture.html", label: "System" },
  { src: "02-deployment-architecture.md", out: "02-deployment-architecture.html", label: "Deployment" },
  { src: "03-cicd-architecture.md", out: "03-cicd-architecture.html", label: "CI/CD" },
  { src: "04-source-code-architecture.md", out: "04-source-code-architecture.html", label: "Source Code" },
  { src: "05-project-structure.md", out: "05-project-structure.html", label: "Structure" },
  { src: "06-use-case-diagrams.md", out: "06-use-case-diagrams.html", label: "Use Cases" },
  { src: "07-sequence-diagrams.md", out: "07-sequence-diagrams.html", label: "Sequences" },
];

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// JSON inside <script> must not contain "</" or the HTML parser could close the tag early.
const safeJson = (value) => JSON.stringify(value).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\!--");

function page(doc, markdown) {
  const title = (markdown.match(/^#\s+(.+)$/m)?.[1] ?? doc.label).trim();
  const nav = docs
    .map((d) => {
      const current = d.out === doc.out ? ' aria-current="page" class="active"' : "";
      return `<a href="${d.out}"${current}>${escapeHtml(d.label)}</a>`;
    })
    .join("\n        ");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} · MyFinance Architecture</title>
  <link rel="icon" href="/favicon.svg" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" />
  <link rel="stylesheet" href="assets/style.css" />
  <script>
    // Apply theme before first paint to avoid a flash.
    (function () {
      try {
        var t = localStorage.getItem("docs-theme");
        if (!t) t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        document.documentElement.dataset.theme = t;
        if (localStorage.getItem("docs-sidebar") === "closed") document.documentElement.classList.add("sidebar-closed");
      } catch (e) {}
    })();
  </script>
</head>
<body>
  <header class="topbar">
    <button id="sidebar-toggle" class="icon-btn" type="button" aria-label="Toggle table of contents" aria-controls="sidebar" title="Toggle table of contents">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
    <a class="brand" href="index.html">
      <span class="brand-mark">MF</span><span class="brand-text">MyFinance Docs</span>
    </a>
    <nav class="doc-nav" aria-label="Documents">
        ${nav}
    </nav>
    <div class="search" role="search">
      <svg class="search-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" fill="none"/><path d="M20 20l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <input id="search-input" type="search" placeholder="Search this page…  ( / )" autocomplete="off" aria-label="Search this page" aria-controls="search-results" />
      <span id="search-count" class="search-count" aria-live="polite"></span>
      <button id="search-prev" class="search-step" type="button" aria-label="Previous match" title="Previous (Shift+Enter)">&#8593;</button>
      <button id="search-next" class="search-step" type="button" aria-label="Next match" title="Next (Enter)">&#8595;</button>
      <div id="search-results" class="search-results" role="listbox" hidden></div>
    </div>
    <button id="theme-toggle" class="icon-btn" type="button" aria-label="Toggle dark mode" title="Toggle dark mode">
      <svg class="icon-sun" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <svg class="icon-moon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" fill="currentColor"/></svg>
    </button>
  </header>

  <div class="layout">
    <aside id="sidebar" class="sidebar" aria-label="Table of contents">
      <div class="sidebar-title">On this page</div>
      <nav id="toc" class="toc"></nav>
    </aside>
    <div id="sidebar-backdrop" class="sidebar-backdrop" hidden></div>
    <main class="main">
      <article id="content" class="markdown-body">
        <noscript><p>JavaScript is required to render this documentation page. The source is <a href="../${doc.src}">../${doc.src}</a>.</p></noscript>
      </article>
      <footer class="page-footer">Generated from <a href="../${doc.src}"><code>docs/${doc.src}</code></a>. Regenerate with <code>node docs/html/build.mjs</code>.</footer>
    </main>
  </div>

  <script id="md-source" type="application/json">${safeJson(markdown)}</script>
  <script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
  <script src="assets/app.js"></script>
</body>
</html>
`;
}

await mkdir(path.join(publicDocsDir, "assets"), { recursive: true });
await cp(path.join(here, "assets"), path.join(publicDocsDir, "assets"), { recursive: true });

for (const doc of docs) {
  const markdown = await readFile(path.join(docsDir, doc.src), "utf8");
  const html = page(doc, markdown);
  await writeFile(path.join(here, doc.out), html);
  await writeFile(path.join(publicDocsDir, doc.out), html);
  console.log(`docs/html/${doc.out} & public/docs/${doc.out}  <-  docs/${doc.src}`);
}
