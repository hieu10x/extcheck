// The two lookups for Node (GitHub Action, VS Code extension): no CORS limits here, so both go direct.
export const nodeApi = {
  async lists() {
    const r = await fetch("https://main.vscode-cdn.net/extensions/marketplace.json");
    if (!r.ok) throw new Error(`Microsoft's block list returned ${r.status}`);
    const d = await r.json();
    const deprecated = {};
    for (const [k, v] of Object.entries(d.deprecated || {})) deprecated[k.toLowerCase()] = v;
    return { fetched: new Date().toISOString().slice(0, 10), malicious: (d.malicious || []).map((x) => String(x).toLowerCase()), deprecated };
  },
  async publishers(names) {
    const out = {};
    await Promise.all(names.slice(0, 50).map(async (n) => {
      try {
        const r = await fetch(`https://marketplace.visualstudio.com/publishers/${encodeURIComponent(n)}`);
        out[n] = r.status === 200 ? true : r.status === 404 ? false : null;
      } catch { out[n] = null; }
    }));
    return out;
  },
};
