// The /admin/stats shell. The report itself is drawn by /admin-stats.js from /api/stats, which already
// leaves out whatever the viewer may not see.
export function renderStatsPage() {
    return `<!DOCTYPE html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>統計報表 | 北科無人機社</title><script src="/theme.js"></script>
<style>
:root{color-scheme:light dark;--bg:#f5f7fa;--fg:#14202b;--card:#fcfcfb;--line:#d5dce3;--accent:#1b5fc4;--muted:#52514e;--bad:#b42318}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#10161c;--fg:#f0efec;--card:#1a1a19;--line:#33373d;--accent:#58a6ff;--muted:#c3c2b7;--bad:#ff7b72}}
:root[data-theme="dark"]{--bg:#10161c;--fg:#f0efec;--card:#1a1a19;--line:#33373d;--accent:#58a6ff;--muted:#c3c2b7;--bad:#ff7b72}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,"Noto Sans TC",sans-serif}
main{max-width:1000px;margin:0 auto;padding:16px}h1{font-size:1.4rem;margin:0}h2{font-size:1.1rem;margin:0}h3{font-size:.95rem;margin:16px 0 6px}
header{display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between}.tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:14px 0;break-inside:avoid}
.head{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:6px}
select,button,a.btn{font:inherit;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:5px 12px;cursor:pointer;text-decoration:none}
a{color:var(--accent)}.muted{color:var(--muted);font-size:.85rem}.err{color:var(--bad)}
.tiles{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0}.tile{border:1px solid var(--line);border-radius:8px;padding:6px 14px;min-width:120px}.tile b{display:block;font-size:1.35rem}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:18px}
table{width:100%;border-collapse:collapse;font-size:.88rem}th,td{text-align:left;border-bottom:1px solid var(--line);padding:4px 6px}.scroll{overflow-x:auto}
@media print{:root,:root[data-theme]{--bg:#fff;--fg:#000;--card:#fff;--line:#bbb;--accent:#000;--muted:#333}body{background:#fff;color:#000}.noprint{display:none!important}section{border-color:#bbb}}
</style></head><body><main>
<header><h1>統計報表</h1><div class="tools noprint"><label>學期 <select id="semester" aria-label="學期"></select></label><button id="print" type="button">列印</button><a href="/admin/dashboard">回後台</a></div></header>
<p id="range" class="muted"></p><div id="msg" class="err" role="status"></div><div id="sections"><p class="muted">載入中…</p></div>
</main><script src="/charts.js"></script><script src="/admin-stats.js"></script></body></html>`;
}
