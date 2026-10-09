// extcheck engine: checks VS Code extension IDs against Microsoft's block list, the VS Code Marketplace
// and Open VSX. Shared by the web page (extcheck.pages.dev), the GitHub Action and the VS Code extension.
// `api` supplies the two lookups that differ by runtime (browser: via a small proxy; Node: direct).

const MKT = "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery";
const OVSX = "https://open-vsx.org/api";
export const SEV = { high: 3, medium: 2, low: 1, info: 0 };
const ID_RE = /^([a-z0-9][a-z0-9-]*)\.([a-z0-9][a-z0-9._-]*)$/i;

// VS Code's JSON-with-comments: strip // and /* */ outside strings, then trailing commas.
export function jsonc(text) {
  let out = "", i = 0, inStr = false;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === "\\" && i + 1 < n) { out += text[i + 1]; i += 2; continue; }
      if (c === '"') inStr = false;
    } else if (c === '"') { inStr = true; out += c; }
    else if (text.startsWith("//", i)) { while (i < n && text[i] !== "\n") i++; continue; }
    else if (text.startsWith("/*", i)) { const j = text.indexOf("*/", i + 2); i = j < 0 ? n : j + 2; continue; }
    else out += c;
    i++;
  }
  return JSON.parse(out.replace(/,\s*([}\]])/g, "$1"));
}

function addId(set, raw) {
  if (typeof raw !== "string") return;
  const s = raw.trim();
  if (!s || s.startsWith("-") || s.includes("/") || s.toLowerCase().endsWith(".vsix")) return; // "-id" in devcontainer.json = don't install
  const id = s.split("@")[0];
  if (ID_RE.test(id)) set.add(id.toLowerCase());
}

// IDs from .vscode/extensions.json ("recommendations"), devcontainer.json
// ("customizations.vscode.extensions") or `code --list-extensions [--show-versions]` output.
export function parseInput(text) {
  const ids = new Set();
  const t = text.trim();
  let kind = "list";
  if (t.startsWith("{")) {
    try {
      const d = jsonc(t);
      let recs = d.recommendations;
      kind = "extensions.json";
      if (recs === undefined) {
        recs = d.customizations?.vscode?.extensions || d.extensions || [];
        kind = "devcontainer.json";
      }
      (Array.isArray(recs) ? recs : []).forEach((r) => addId(ids, r));
    } catch { kind = "list"; }
  }
  if (!ids.size) {
    kind = "list";
    t.split(/[\s,;]+/).forEach((tok) => addId(ids, tok.replace(/^["'\[]+|["'\],]+$/g, "")));
  }
  return { ids: [...ids].sort(), kind };
}

async function getJson(url, opts) {
  const r = await fetch(url, opts);
  return { status: r.status, body: r.ok ? await r.json() : null };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const k = next++; out[k] = await fn(items[k]); }
  }));
  return out;
}

async function marketplace(ids) {
  const found = {};
  for (let k = 0; k < ids.length; k += 40) {
    const chunk = ids.slice(k, k + 40);
    const criteria = chunk.map((v) => ({ filterType: 7, value: v })).concat([{ filterType: 8, value: "Microsoft.VisualStudio.Code" }]);
    const { status, body } = await getJson(MKT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json;api-version=3.0-preview.1" },
      body: JSON.stringify({ filters: [{ criteria, pageSize: 100 }], flags: 914 }),
    });
    if (!body) throw new Error(`VS Code Marketplace returned ${status}`);
    for (const e of body.results[0].extensions) {
      const v = (e.versions || [{}])[0];
      const stats = Object.fromEntries((e.statistics || []).map((s) => [s.statisticName, s.value]));
      found[`${e.publisher.publisherName}.${e.extensionName}`.toLowerCase()] = {
        name: e.displayName, publisher: e.publisher.displayName, domain: e.publisher.domain,
        domainVerified: !!e.publisher.isDomainVerified, updated: v.lastUpdated, version: v.version,
        installs: Math.round(stats.install || 0),
      };
    }
  }
  return found;
}

async function openvsx(ids) {
  const nsCache = {};
  const ns = (name) => (nsCache[name] ||= getJson(`${OVSX}/${encodeURIComponent(name)}`).then(({ status, body }) =>
    status === 404 ? { exists: false } : body ? { exists: true, verified: !!body.verified } : { exists: null }));
  const recs = await pool(ids, 6, async (id) => {
    const [n, name] = [id.slice(0, id.indexOf(".")), id.slice(id.indexOf(".") + 1)];
    const { status, body } = await getJson(`${OVSX}/${encodeURIComponent(n)}/${encodeURIComponent(name)}`);
    if (body && !body.error) {
      return { exists: true, version: body.version, verified: body.verified, publishedBy: body.publishedBy?.loginName, downloads: body.downloadCount };
    }
    if (status !== 404) return { exists: null };
    const s = await ns(n);
    return { exists: false, namespaceExists: s.exists };
  });
  return Object.fromEntries(ids.map((id, k) => [id, recs[k]]));
}

const ageDays = (ts, now) => (ts ? Math.floor((now - new Date(ts)) / 86400000) : null);

// api: { lists: async () => {fetched, malicious[], deprecated{}}, publishers: async (names[]) => {name: true|false|null} }
export async function checkIds(ids, api, now = Date.now()) {
  const [lists, mkt, ovsx] = await Promise.all([api.lists(), marketplace(ids), openvsx(ids)]);
  const malicious = new Set(lists.malicious);
  const missingPubs = [...new Set(ids.filter((i) => !mkt[i] && !malicious.has(i)).map((i) => i.split(".")[0]))];
  const pubs = missingPubs.length ? await api.publishers(missingPubs) : {};
  const rows = ids.map((id) => {
    const f = [];
    const add = (sev, kind, text) => f.push({ sev, kind, text });
    const m = mkt[id], o = ovsx[id], pub = id.split(".")[0];
    if (malicious.has(id)) add("high", "malicious", "On Microsoft's malicious-extension list: VS Code blocks and uninstalls it.");
    const dep = lists.deprecated[id];
    if (dep) {
      const repl = typeof dep === "object" ? dep.extension?.id : null;
      if (typeof dep === "object" && dep.disallowInstall) add("medium", "disallowed", "Deprecated by Microsoft and no longer installable" + (repl ? `; replacement: ${repl}.` : "."));
      else add("low", "deprecated", "Deprecated" + (repl ? `; replacement: ${repl}.` : "."));
    }
    if (!m && !malicious.has(id)) {
      if (pubs[pub] === false) add("high", "unclaimed", `Not on the Marketplace, and the publisher "${pub}" has no public page there (a typo, or a removed publisher?). If the name is free, whoever registers it controls what this ID installs.`);
      else add("medium", "missing", "Not on the Marketplace (removed, unpublished or a typo).");
    }
    if (m) {
      const d = ageDays(m.updated, now);
      if (d !== null && d > 3 * 365) add("low", "stale", `No update in ${Math.floor(d / 365)} years (last ${m.updated.slice(0, 10)}). Unmaintained extensions with installs are the ones that get sold or taken over.`);
      else if (d !== null && d <= 7) add("info", "recent", `New version ${d === 0 ? "today" : d === 1 ? "yesterday" : d + " days ago"} (${m.version}). Auto-update installs it everywhere within hours.`);
    }
    if (o.exists === false) {
      if (o.namespaceExists === false) add("medium", "ovsx_unclaimed", `Not on Open VSX, and the namespace "${pub}" doesn't exist there. In Cursor, Windsurf or VSCodium this ID resolves to whoever publishes it first.`);
      else add("info", "ovsx_missing", "Not on Open VSX (the namespace exists and belongs to someone).");
    } else if (o.exists && o.verified === false) {
      add("info", "ovsx_unverified", `On Open VSX, published by "${o.publishedBy}", who isn't a verified owner of the namespace: a different build from the Marketplace one.`);
    }
    return { id, marketplace: m || null, openvsx: o, findings: f };
  });
  return { rows, lists };
}

export function toMarkdown(rows, lists, source) {
  const fs = rows.flatMap((r) => r.findings.map((x) => ({ ...x, id: r.id }))).sort((a, b) => SEV[b.sev] - SEV[a.sev]);
  const serious = fs.filter((x) => SEV[x.sev] >= 2);
  const L = [`# Extension check: ${source}`, "",
    `Checked ${new Date().toISOString().slice(0, 10)} against Microsoft's VS Code block lists (fetched ${lists.fetched}), the VS Code Marketplace and Open VSX.`, "",
    `**${rows.length} extensions. ${serious.length} finding${serious.length === 1 ? "" : "s"} worth a look.**`, ""];
  if (fs.length) L.push("| Extension | Severity | Finding |", "|---|---|---|", ...fs.map((x) => `| \`${x.id}\` | ${x.sev} | ${x.text} |`), "");
  L.push("## Every extension", "", "| Extension | Marketplace publisher | Last update | Installs | Verified domain | Open VSX |", "|---|---|---|---|---|---|");
  for (const r of rows) {
    const m = r.marketplace, o = r.openvsx;
    const ov = o.exists ? `${o.version} by ${o.publishedBy}${o.verified ? "" : " (unverified)"}` : o.exists === false ? "absent" : "?";
    L.push(m ? `| \`${r.id}\` | ${m.publisher} | ${(m.updated || "").slice(0, 10)} | ${m.installs.toLocaleString("en")} | ${m.domainVerified ? "yes" : "no"} | ${ov} |`
      : `| \`${r.id}\` | not found | | | | ${ov} |`);
  }
  L.push("", "Checked with extcheck (https://extcheck.pages.dev)");
  return L.join("\n") + "\n";
}
