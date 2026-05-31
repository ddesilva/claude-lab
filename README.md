# claude-lab

A place for Claude Code things — plugins, experiments, and tooling.

This repo doubles as a local **plugin marketplace** (`.claude-plugin/marketplace.json`), so
the plugins under `plugins/` can be installed straight into Claude Code.

## Plugins

| Plugin | What it does |
| --- | --- |
| [**tweak-ui**](plugins/tweak-ui/) | Visually select webpage elements and tweak color, opacity, margin, padding, borders and type in a live browser — then auto-apply the `from → to` changes to your source code. Ships with a demo dashboard. |

## Install a plugin

```
/plugin marketplace add ddesilva/claude-lab
/plugin install tweak-ui@claude-lab
```

`/plugin marketplace add` takes the GitHub repo (clones it and resolves the relative plugin
paths), so no machine-specific path is involved. The marketplace name is `claude-lab`, so
plugin ids look like `<plugin>@claude-lab`. Plugins are available immediately in the current
session. See each plugin's README for usage and a persistent, committable `settings.json`
alternative.
