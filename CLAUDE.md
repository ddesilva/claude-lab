# Global instructions (apply to every Claude Code session)

## Prove understanding before doing work

When the user asks you to do something, your first step MUST be to confirm your understanding of the request.

## Prototype if it's not trivial

If the user asks for a change that isn't trivial (e.g., "change this text" or "fix this typo"), you MUST ASK if you should produce a quick prototype of the change before doing the full implementation. This serves several purposes:
- It confirms your understanding of the request and the codebase.
- It surfaces any hidden complexities or edge cases early on.
- It gives the user confidence that you can deliver what they asked for before you invest time in a full implementation.
- It allows for early feedback and course correction before you go too far down the wrong path.

## Verify before claiming done

When the user asks for UI work in a web or browser context — building
screens, tweaking layout/spacing, adjusting visual styling — you MUST visually
verify the result before telling the user it's done. "Done" without a
screenshot is a claim you can't back up.

This rule applies to web UI (HTML/CSS/JS/TS in a browser, including
React/Vue/Svelte/Next.js, Electron renderer, mobile web). It does NOT apply
to native macOS, iOS, or Android apps — the user verifies those manually.

Trigger: if you edited any web UI file this turn (.tsx/.jsx/.vue/.svelte/
.css/.scss/.html, or a component file in app/, src/components/, etc.), your
final tool call before declaring done MUST be a screenshot or Playwright
run. No exceptions for "the change is small" or "the diff looks right" —
the layout systems lie.

How to verify (in order of preference):
1. Use the `verify` or `run` skill to launch the app and capture the rendered
   state directly. This is the default. Do it.
2. If a dev server is already running and only requires a screenshot, take
   the screenshot.
3. If verification is genuinely impossible (no platform available, headless
   environment, user explicitly says "don't run anything"), say so EXPLICITLY
   in the report — never silently skip it.

Typecheck passing, lint clean, and "it should look like X" are not substitutes
for actually looking at the rendered screen. The layout systems lie (gap
on the wrong container, flex collapsing differently than expected, safe-area
insets not what you guessed). The only reliable check is the pixels.

## Self code-review before claiming done

Before reporting any non-trivial code change as complete, do a self code review
of your own diff. Specifically:

- Re-read the diff (use `git diff`) end-to-end as if you were a reviewer who
  doesn't trust the author.
- Check that the change you described matches the change you actually made
  (renamed symbols updated everywhere, stale imports removed, props used
  where you thought you were using them).
- Look for the failure modes the user has hit before in this codebase
  (recorded in memory): stale CSS/layout assumptions, gap on the wrong
  container, hardcoded colors, magic numbers, copy-paste typos.
- If a value or behaviour MUST take effect for the change to do anything,
  confirm in the code that nothing higher up is shadowing or overriding it.

Run typecheck + lint as a baseline floor, not as the ceiling. They catch
syntax errors; they don't catch "this prop has no effect".

## Use superpowers for significant changes

Before any of the following, you MUST invoke the corresponding superpower skill:

- Creating a feature, building a component, adding functionality, or
  modifying behavior → `superpowers:brainstorming` first, to surface
  requirements and tradeoffs before writing code. Then proceed.
- Multi-step implementations or anything with a spec/requirements doc
  → `superpowers:writing-plans` to produce a plan before touching code.
- Implementing a feature or fixing a non-trivial bug →
  `superpowers:test-driven-development`. Tests first.
- Debugging a failing test, bug, or unexpected behavior →
  `superpowers:systematic-debugging` before proposing a fix.
- Before declaring a non-trivial change complete or merging →
  `superpowers:verification-before-completion` and, where appropriate,
  `superpowers:requesting-code-review`.

What counts as "significant": multi-file edits, new features, refactors
crossing module boundaries, anything you'd open a PR for, anything the
user would notice if it broke. One-line typo fixes, dependency bumps,
README edits, and obvious renames don't count.

If a superpower clearly doesn't apply (e.g., user is asking a question,
not requesting work), skip it. Don't perform-invoke skills to look diligent.
But the default lean for substantive work is: invoke first, justify only
when skipping.
