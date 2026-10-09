# extcheck for VS Code

Two commands (Command Palette → "extcheck"):

- **Check my installed extensions**
- **Check this workspace's recommended extensions** (`.vscode/extensions.json`, devcontainer.json)

Each opens a Markdown report: anything on Microsoft's malicious or deprecated lists, IDs that don't exist on the Marketplace, IDs whose namespace doesn't exist on Open VSX (Cursor, Windsurf and VSCodium install from there, so anyone could publish under that name), and extensions with no release in 3+ years.

It runs only when you call a command, and sends extension IDs only to the VS Code Marketplace, Open VSX and Microsoft's CDN. Nothing is stored or sent anywhere else.

Same checks on the web: [extcheck.pages.dev](https://extcheck.pages.dev/?utm_source=listing). Source and the GitHub Action: [github.com/hieu10x/extcheck](https://github.com/hieu10x/extcheck).

Built by Hieu Tran with AI agents. MIT licensed.
