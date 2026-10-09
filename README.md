# extcheck

Checks VS Code extension IDs against three public sources:

- **Microsoft's block list**: the file VS Code itself downloads to uninstall malicious extensions and stop installs of deprecated ones.
- **The VS Code Marketplace**: does the ID exist, and does its publisher? An ID with no publisher behind it can be registered by someone else.
- **Open VSX**, the registry Cursor, Windsurf and VSCodium install from: if an extension's namespace doesn't exist there, anyone can create it and publish under that exact ID.

It also flags extensions with no release in 3+ years, and ones updated in the last few days.

Three ways to run it:

| | Where | What it checks |
|---|---|---|
| Web | [extcheck.pages.dev](https://extcheck.pages.dev) | A pasted `code --list-extensions`, an extensions.json / devcontainer.json, or a public GitHub repo |
| GitHub Action | this repo (`uses: hieu10x/extcheck@v0`) | The repo's `.vscode/extensions.json` and devcontainer.json files, on every push or PR |
| VS Code extension | [`vscode/`](vscode/) | Your installed extensions, or the open workspace's recommendations |

No server sees your list: the checks call the Marketplace, Open VSX and Microsoft's CDN directly (the web page proxies two lookups that browsers can't make; nothing is stored).

## GitHub Action

```yaml
on: [push, pull_request]
jobs:
  extcheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hieu10x/extcheck@v0
        with:
          fail-on: high   # high | medium | low | never
```

Findings appear in the job summary and as annotations on the file. Outputs: `findings` (medium or above), `extensions` (count checked).

## What the severities mean

- **high**: on Microsoft's malicious list, or the ID's Marketplace publisher has no public page (someone else could register it).
- **medium**: deprecated and no longer installable; not on the Marketplace; or the Open VSX namespace doesn't exist.
- **low**: deprecated, or no release in 3+ years.
- **info**: a release in the last 7 days; not on Open VSX while the namespace is owned; an Open VSX build published by someone who isn't a verified namespace owner.

Not checked: what an extension does at runtime, and Chrome or Edge extensions. It's a quick check, not an audit.

Built by Hieu Tran with AI agents. MIT licensed.
