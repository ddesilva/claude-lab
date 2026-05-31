---
name: tweak-ui
description: >-
  Visually tweak a live web page by point-and-click and auto-apply the changes to source.
  Opens the rendered page in a real browser, lets the user select elements and adjust
  color, background, border, radius, opacity, font size/weight, margin and padding (plus
  free-text instructions) with live preview, then edits the matching source files. Use ONLY
  when the user explicitly wants to interactively/visually edit a rendered page — e.g.
  "tweak the UI", "let me click and adjust this page", "visually edit the dashboard". Do NOT
  use for ordinary code or CSS edits the user has already described in words.
argument-hint: <url | description of a page in this codebase>
allowed-tools: Bash, BashOutput, Read, Edit, Write, Glob, Grep
---

You are running the **tweak-ui** workflow. The user wants to visually edit a web page
and have you apply the resulting changes to their source code.

This skill is self-contained at `${CLAUDE_SKILL_DIR}` (driver, overlay, deps, and a demo
all live there). The user's request is:

> $ARGUMENTS

Follow these steps in order. Keep the user informed with short status lines.

## 1. Ensure the driver is installed (idempotent)

Run, and read the output:

```bash
cd "${CLAUDE_SKILL_DIR}" && \
  ( [ -d node_modules/playwright ] || npm install ) && \
  ( npx playwright install chromium ) && echo "tweak-ui: deps ok"
```

If `npm install` or the Chromium download fails, stop and show the error to the user
(network/permissions are the usual cause). The Chromium download only happens once.

## 2. Resolve the target URL

Inspect `$ARGUMENTS`:

- **It already looks like a URL** (starts with `http://`, `https://`, `localhost`,
  `127.0.0.1`, or contains a `:port`): normalize it to a full `http(s)://…` URL and use it
  directly. Skip to step 3.

- **It is a description of a page in this codebase** (e.g. "the settings page", "the
  pricing section of the marketing site"): you must start the dev server and find the route.
  1. Detect the project: read `package.json` (and lockfiles) in the current working
     directory. Identify the dev command — usually `npm run dev`, `pnpm dev`, `yarn dev`,
     `npm start`, `next dev`, `vite`, etc. Note the framework (Next.js, Vite/React, SvelteKit,
     Astro, Remix, plain static, …) to map descriptions to route files.
  2. Check whether a dev server is already running on the common ports
     (`curl -sI http://localhost:3000` etc. for 3000, 5173, 5174, 8080, 4321, 4173). If one
     is already up, reuse it — do not start a second one.
  3. Otherwise start the dev server **in the background** (Bash `run_in_background: true`)
     from the project root. Poll its output (BashOutput) and/or `curl` until it reports a
     ready URL/port. Capture the actual host and port it bound to.
  4. Find the route for the requested page by searching the source
     (`app/`, `pages/`, `src/routes/`, `src/pages/`, etc.) with Glob/Grep, matching the
     user's description to a file/route. Build the page path (e.g. `/settings`).
  5. Compose the full URL: `http://localhost:<port><path>`.

If you cannot confidently determine the page, ask the user for the exact path/URL before
launching the browser.

## 3. Launch the visual editor

Run the driver **in the background** so it can stay open while the user edits. Write the
session into the user's project (not the skill dir):

```bash
node "${CLAUDE_SKILL_DIR}/scripts/tweak-ui.mjs" "<RESOLVED_URL>" --out "$PWD/.tweak-ui"
```

(Use Bash with `run_in_background: true`.) A Chromium window will open on the user's
desktop with the tweak-ui panel. Tell the user:

> A browser window opened. Click any element to select it, use the panel to change
> colors / opacity / margin / padding / borders / type (or type a worded instruction in
> the **Instruction for Claude** box), watch the live preview, then click
> **"✓ Apply & Finish"** (or close the window) when you're done.

## 4. Wait for the session to finish

Poll for the sentinel file the driver writes on finish. Run (foreground), and if it prints
`WAITING` rather than `DONE`, run it again — the user is still editing:

```bash
cd "$PWD" && for i in $(seq 1 290); do [ -f .tweak-ui/DONE ] && { echo DONE; break; }; sleep 2; done; [ -f .tweak-ui/DONE ] || echo WAITING
```

## 5. Apply the changes to source

Once `DONE` exists:

1. Read `.tweak-ui/instructions.md` (the human-readable change set) and
   `.tweak-ui/session.json` (structured: each element has `selector` (a stable
   id/`data-*` hook when available, else a CSS path), `cssPath`, `dataId`, `classes`,
   `elementId`, `text`, `markup`, a `changes` map of `{property:{from,to}}`, and an optional
   free-text `note`).
2. If there are no changes **and** no notes, tell the user and stop.
3. For **each** changed element, locate the matching source. Prefer the `selector` when it
   is an id / `data-*` hook; otherwise match on unique class names, visible `text`, and
   `markup` via Grep/Glob. Use `cssPath` only as a last-resort disambiguator.
4. Apply each `property: from → to` change using the project's existing styling convention:
   - Tailwind project → edit the utility classes (e.g. `p-2` → `p-3`, `bg-blue-600` →
     `bg-green-600`); pick the closest token to the target px/color value and note any
     rounding.
   - CSS / SCSS / CSS Modules → edit the matching rule (or add one) for that selector.
   - Inline styles / styled-components / CSS-in-JS → edit in place.
   Change only the listed properties; preserve everything else. Verify the `from` value
   roughly matches what's in the source before changing it — if it doesn't, flag the
   mismatch instead of guessing.
5. For any element with a `note`, treat it as a worded instruction and implement it
   tastefully in the project's existing convention, scoped to that element (e.g. add a
   distinguishing class rather than restyling a shared one).
6. Show the user a concise summary: each element, the file(s) touched, and the
   property changes / instructions applied. Then show the diff (`git diff --stat` plus key
   hunks).

## 6. Clean up

Leave the dev server running if you started it (the user may want to verify), but mention
it. The `.tweak-ui/` working dir is gitignored; you can leave it in place for reference.
Do not commit anything unless the user asks.
