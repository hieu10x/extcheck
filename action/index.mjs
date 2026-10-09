// GitHub Action entry: read the repo's recommendation files, run the checks, write a job summary,
// annotate the files and fail at the chosen severity. No dependencies; the runner's Node has fetch.
import { readFileSync, existsSync, readdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { parseInput, checkIds, toMarkdown, SEV } from "../src/check.mjs";
import { nodeApi } from "../src/node-api.mjs";

const input = (name) => (process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] || "").trim();
const ws = process.env.GITHUB_WORKSPACE || process.cwd();
const failOn = (input("fail-on") || "high").toLowerCase();
if (!(failOn in SEV) && failOn !== "never") throw new Error(`fail-on must be high, medium, low or never (got "${failOn}")`);

function defaultFiles() {
  const f = [".vscode/extensions.json", ".devcontainer.json", ".devcontainer/devcontainer.json"];
  const dc = join(ws, ".devcontainer");
  if (existsSync(dc)) for (const d of readdirSync(dc, { withFileTypes: true })) if (d.isDirectory()) f.push(`.devcontainer/${d.name}/devcontainer.json`);
  return f;
}
const files = (input("files") ? input("files").split(/[,\n]/).map((s) => s.trim()).filter(Boolean) : defaultFiles()).filter((f) => existsSync(join(ws, f)));
const out = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);

if (!files.length) {
  console.log("extcheck: no .vscode/extensions.json or devcontainer.json found; nothing to check.");
  out("findings", 0); out("extensions", 0);
  process.exit(0);
}
const idsByFile = Object.fromEntries(files.map((f) => [f, parseInput(readFileSync(join(ws, f), "utf8")).ids]));
const ids = [...new Set(Object.values(idsByFile).flat())].sort();
const { rows, lists } = await checkIds(ids, nodeApi);

const md = toMarkdown(rows, lists, `${process.env.GITHUB_REPOSITORY || "this repo"} (${files.join(", ")})`, "action");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(md);

let worst = -1, serious = 0;
for (const r of rows) for (const f of r.findings) {
  worst = Math.max(worst, SEV[f.sev]);
  if (SEV[f.sev] >= 2) serious++;
  if (SEV[f.sev] >= 1) {
    const file = files.find((x) => idsByFile[x].includes(r.id));
    const level = SEV[f.sev] >= 2 ? "warning" : "notice";
    console.log(`::${level} file=${file},title=extcheck ${f.sev}: ${r.id}::${f.text.replace(/\n/g, " ")}`);
  }
}
out("findings", serious); out("extensions", ids.length);
if (failOn !== "never" && worst >= SEV[failOn]) {
  console.log(`::error::extcheck found ${failOn}-or-worse findings (fail-on: ${failOn})`);
  process.exit(1);
}
