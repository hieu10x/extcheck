// extcheck for VS Code: runs only when you call one of its two commands. It sends extension IDs to the
// VS Code Marketplace, Open VSX and Microsoft's block-list CDN, and nothing anywhere else. The report's
// early-access link opens only if you click it, and carries counts, not IDs.
const vscode = require("vscode");
const path = require("path");
const { pathToFileURL } = require("url");

async function engine() {
  const load = (f) => import(pathToFileURL(path.join(__dirname, "src", f)).href);
  const [check, api] = await Promise.all([load("check.mjs"), load("node-api.mjs")]);
  return { ...check, api: api.nodeApi };
}

async function run(ids, label) {
  if (!ids.length) return vscode.window.showInformationMessage(`extcheck: no extensions found in ${label}.`);
  const md = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `extcheck: checking ${ids.length} extensions…` },
    async () => {
      const e = await engine();
      const { rows, lists } = await e.checkIds(ids, e.api);
      return e.toMarkdown(rows, lists, label, "vscode");
    });
  const doc = await vscode.workspace.openTextDocument({ content: md, language: "markdown" });
  await vscode.window.showTextDocument(doc, { preview: false });
  await vscode.commands.executeCommand("markdown.showPreview");
}

async function readIds(uri) {
  try {
    const { parseInput } = await engine();
    return parseInput(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8")).ids;
  } catch { return []; } // missing file or invalid JSON
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("extcheck.checkInstalled", async () => {
      const ids = vscode.extensions.all.filter((x) => !x.packageJSON.isBuiltin).map((x) => x.id.toLowerCase()).sort();
      await run(ids, `installed extensions in ${vscode.env.appName}`);
    }),
    vscode.commands.registerCommand("extcheck.checkWorkspace", async () => {
      const folders = vscode.workspace.workspaceFolders || [];
      if (!folders.length) return vscode.window.showInformationMessage("extcheck: open a folder first.");
      const ids = new Set(), seen = [];
      for (const f of folders) for (const rel of [".vscode/extensions.json", ".devcontainer.json", ".devcontainer/devcontainer.json"]) {
        const found = await readIds(vscode.Uri.joinPath(f.uri, rel));
        if (found.length) { seen.push(rel); found.forEach((i) => ids.add(i)); }
      }
      await run([...ids].sort(), seen.length ? `this workspace (${[...new Set(seen)].join(", ")})` : "this workspace's .vscode/extensions.json or devcontainer.json");
    }));
}

module.exports = { activate, deactivate() {} };
