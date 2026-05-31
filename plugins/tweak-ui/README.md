# tweak-ui

A Claude Code plugin for **visual, point-and-click UI editing** that closes the loop back to
your source code.

Invoke it with a URL or a description of a page in your codebase. A real Chromium window
opens with a sleek overlay panel. Click any element, adjust its **color, background, border,
radius, opacity, font size/weight, margin and padding** with live preview — or just type a
**plain-English instruction** for that element. When you press **✓ Apply & Finish**, Claude
reads the captured change set and edits the matching source files for you.

> Packaged as an **Agent Skill** (`skills/tweak-ui/SKILL.md`). That means you can trigger it
> explicitly **and** Claude will surface it automatically when you describe the intent
> (e.g. *"let me click-and-tweak this page"*).

---

## Install

`tweak-ui` is distributed through the **`claude-lab`** marketplace, hosted on GitHub at
[`ddesilva/claude-lab`](https://github.com/ddesilva/claude-lab). The marketplace references
the plugin by a **relative path** (`./plugins/tweak-ui` in `.claude-plugin/marketplace.json`),
so nothing here depends on a machine-specific absolute path.

### Recommended — install from GitHub (no manual config)

```
/plugin marketplace add ddesilva/claude-lab
/plugin install tweak-ui@claude-lab
```

`/plugin marketplace add` clones the repo and resolves the relative plugin path; the install
is interactive, so you never hand-edit settings JSON. Available immediately, no restart.
(`claude-lab` is the marketplace name, so the plugin id is `tweak-ui@claude-lab`.)

### Team / persistent (portable `settings.json`)

To enable it without the interactive step — and, crucially, **without any absolute path** —
reference the marketplace by its **GitHub source**. Add this to `~/.claude/settings.json`,
or commit it to a project's `.claude/settings.json` so teammates get it on clone:

```json
{
  "extraKnownMarketplaces": {
    "claude-lab": {
      "source": { "source": "github", "repo": "ddesilva/claude-lab" }
    }
  },
  "enabledPlugins": {
    "tweak-ui@claude-lab": true
  }
}
```

When committed to a repo, teammates are prompted to install the first time they **trust** the
folder — no per-machine editing. Opt out locally via `.claude/settings.local.json`
(`"tweak-ui@claude-lab": false`). For a non-GitHub remote (GitLab, self-hosted, …) swap the
source for `{ "source": "url", "url": "https://…/claude-lab.git" }`.

### Local dev (working on the plugin itself)

From a clone, add the marketplace by path (relative paths in the manifest still resolve), or
load the plugin dir directly — neither needs committing:

```
/plugin marketplace add ./          # run from the claude-lab repo root
```
```bash
claude --plugin-dir ./plugins/tweak-ui
```

The **first run installs the Node deps and downloads Chromium**
(`npm install` + `npx playwright install chromium`) automatically — one-time; Chromium lands
in the shared `~/Library/Caches/ms-playwright` cache.

---

## Usage

Invoke the skill (plugin skills are namespaced as `<plugin>:<skill>`):

```
/tweak-ui:tweak-ui http://localhost:4173/                  # a URL — opens it directly
/tweak-ui:tweak-ui the pricing section of the landing page # a description — spins up the
                                                           # dev server, finds the route,
                                                           # then opens it
```

…or just tell Claude what you want — *"let me visually tweak the dashboard"* — and it will
offer the skill.

In the browser overlay:

1. **Hover** to highlight, **click** to select an element (indigo outline).
2. Use the panel controls to change color / background / border / radius / opacity /
   font size & weight / margin / padding — changes preview live on the page.
3. **Instruction for Claude** — a free-text box per element for things the sliders can't
   express (*"make this a pill-shaped gradient button"*). Captured even with no slider
   changes.
4. **Theme toggle** (☀/☾) flips the panel between light and dark; **crosshair** toggles
   element picking on/off so you can interact with the page normally; **Esc** deselects; the
   panel is draggable.
5. The **Generated instructions** box at the bottom updates with every tweak (with a Copy
   button if you want them by hand).
6. Click **✓ Apply & Finish** (or close the window) → Claude locates the source for each
   tweaked element and applies the changes, then shows you the diff.

---

## Try it with the bundled demo

A self-contained "Nimbus" dashboard ships in `skills/tweak-ui/demo/` so you can test without
your own project:

```bash
# from the claude-lab repo root
node plugins/tweak-ui/skills/tweak-ui/demo/server.mjs
# → http://localhost:4173/
```

Then:

```
/tweak-ui:tweak-ui http://localhost:4173/
```

Tweak the "Upgrade" button, a stat card, or a status pill (or leave a worded instruction),
hit **Apply & Finish**, and watch Claude edit `demo/styles.css` / `demo/index.html` to match.

---

## How it works

```
/tweak-ui:tweak-ui ──▶ resolve target (URL, or start dev server + find route)
                   ──▶ scripts/tweak-ui.mjs  (Playwright launches headed Chromium)
                   ──▶ scripts/overlay.js    (injected picker + visual CSS controls)
                   ──▶ you tweak elements / leave instructions; panel records from→to + notes
                   ──▶ "Apply & Finish" writes .tweak-ui/instructions.md + session.json
                   ──▶ Claude locates the source for each element and applies the changes
```

Everything the skill needs is bundled under `skills/tweak-ui/` and resolved at runtime via
`${CLAUDE_SKILL_DIR}`, so it works regardless of the current working directory.

| Path | Role |
| --- | --- |
| `skills/tweak-ui/SKILL.md` | The skill — orchestrates setup, target resolution, launching the editor, waiting, and applying changes to source. Auto-discovered by the plugin; no `plugin.json` entry needed. |
| `skills/tweak-ui/scripts/tweak-ui.mjs` | Node driver — launches headed Chromium, injects the overlay, streams tweaks into `.tweak-ui/`. |
| `skills/tweak-ui/scripts/overlay.js` | The in-page editor (shadow-DOM isolated): highlight, select, visual controls, instruction box, theme toggle, live preview, generated instructions. |
| `skills/tweak-ui/demo/` | A standalone "Nimbus" dashboard + zero-dep static server for trying it out. |
| `skills/tweak-ui/package.json` | The driver's dependency (`playwright`); installed on first run. |

**Output** lands in `.tweak-ui/` in the project you ran it from:

- `instructions.md` — human-readable change set (per element: preferred selector, classes,
  markup, any worded instruction, and `property: from → to` lines).
- `session.json` — structured per element: `selector` (a stable `id`/`data-*` hook when
  available, else a CSS path), `cssPath`, `dataId`, `classes`, `elementId`, `text`, `markup`,
  a `changes` map of `{property:{from,to}}`, and an optional free-text `note`.
- `DONE` — sentinel the driver writes when you finish.

### Source matching

The overlay prefers a **stable hook** for each element — `id`, then
`data-testid` / `data-test` / `data-cy` / `data-id` / `data-qa` — and only falls back to a
positional CSS path when none exists. Claude uses that hook (plus class names, visible text,
and markup) to find the source, and verifies the `from` value against the file before
editing rather than guessing.

---

## Requirements

- Node.js v18+ (tested on v22)
- A one-time `npx playwright install chromium` (the skill runs this for you)

## Notes

- The Chromium window is real and visible — it works with the Mac Claude Code app because
  the driver runs locally and Claude Code launches it via the shell.
- Mapping a live DOM element back to source is heuristic. For elements with no distinguishing
  markup, Claude surfaces the ambiguity rather than guessing.
- The skill's `description` is scoped to **explicit visual-editing intent**, so Claude won't
  auto-fire it on ordinary "change this CSS" requests.
- `.tweak-ui/` and `node_modules/` are gitignored; `demo/` is committed as a reusable fixture.
