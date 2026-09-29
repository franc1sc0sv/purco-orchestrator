export const MONITOR_PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Orchestrator Monitor</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #f7f7f5;
  --panel: #ffffff;
  --line: #e3e3de;
  --ink: #1d1d1b;
  --muted: #6c6c66;
  --accent: #2f6f4f;
  --warn: #9a5b1e;
  --stop: #98332b;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16161a;
    --panel: #1e1e23;
    --line: #32323a;
    --ink: #ececea;
    --muted: #9a9a94;
    --accent: #7cc4a0;
    --warn: #e0a463;
    --stop: #e58b80;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}
header {
  padding: 20px 24px 14px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: baseline;
  gap: 16px;
  flex-wrap: wrap;
}
h1 { font-size: 17px; margin: 0; letter-spacing: -0.01em; }
.stamp { color: var(--muted); font: 12px/1 var(--mono); }
main { padding: 20px 24px 64px; max-width: 1400px; }
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}
.tile {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 14px 16px;
}
.tile .n { font: 600 26px/1.1 var(--mono); letter-spacing: -0.02em; }
.tile .k { color: var(--muted); font-size: 12px; margin-top: 4px; }
.run {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  margin-bottom: 18px;
  overflow: hidden;
}
.run > summary {
  padding: 14px 16px;
  cursor: pointer;
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.run > summary::-webkit-details-marker { display: none; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: 0 0 auto; }
.dot.live { background: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent); }
.ticket { font-weight: 600; }
.rid { font: 12px/1 var(--mono); color: var(--muted); }
.spacer { flex: 1 1 auto; }
.pill {
  font: 11px/1 var(--mono);
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--muted);
  white-space: nowrap;
}
.pill.live { color: var(--accent); border-color: currentColor; }
.pill.warn { color: var(--warn); border-color: currentColor; }
.pill.stop { color: var(--stop); border-color: currentColor; }
.body { padding: 0 16px 16px; }
h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 20px 0 8px; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 500; font-size: 12px; white-space: nowrap; }
td.m, th.m { font-family: var(--mono); font-size: 12px; }
td.num { text-align: right; font-family: var(--mono); font-size: 12px; }
.feed { max-height: 380px; overflow-y: auto; border: 1px solid var(--line); border-radius: 6px; }
.ev { display: grid; grid-template-columns: 66px 92px 128px 1fr; gap: 10px; padding: 5px 10px; border-bottom: 1px solid var(--line); font-size: 12px; }
.ev:last-child { border-bottom: 0; }
.ev .t, .ev .a { font-family: var(--mono); color: var(--muted); }
.ev .k { font-family: var(--mono); font-size: 11px; }
.ev .s { overflow-wrap: anywhere; }
.k-thinking { color: var(--warn); }
.k-escalation, .k-tool_error, .k-permission_denied { color: var(--stop); }
.k-resolution, .k-answer, .k-handoff { color: var(--accent); }
.empty { color: var(--muted); padding: 12px 0; }
.qpanel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; margin-bottom: 14px; }
.qpanel.waiting { border-left: 4px solid var(--stop); }
.qpanel h2 { font-size: 15px; margin: 0 0 12px; }
.qrow { border-top: 1px solid var(--line); padding: 12px 0; }
.qrow:first-of-type { border-top: none; padding-top: 0; }
.qmeta { font-family: var(--mono); font-size: 11px; color: var(--muted); margin-bottom: 5px; }
.qtext { font-size: 14px; line-height: 1.55; margin-bottom: 6px; }
.qhow { font-family: var(--mono); font-size: 11px; color: var(--muted); word-break: break-all; }
.qanswer { font-size: 13px; color: var(--accent); border-left: 2px solid var(--line); padding-left: 10px; }
.qrow.done .qtext { color: var(--muted); }
.arrow { font-family: var(--mono); color: var(--muted); }
</style>
</head>
<body>
<header>
  <h1>Orchestrator Monitor</h1>
  <span class="stamp" id="stamp">connecting…</span>
</header>
<main>
  <div class="tiles" id="tiles"></div>
  <div id="mailbox"></div>
  <div id="runs"></div>
</main>
<script>
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clock = (iso) => (iso || "").slice(11, 19);
const money = (n) => "$" + Number(n || 0).toFixed(4);
const open = new Set();

const tile = (n, k) => '<div class="tile"><div class="n">' + n + '</div><div class="k">' + k + '</div></div>';

const statusPill = (status) => {
  const cls = status === "done" ? "live" : status === "running" ? "" : status === "skipped" ? "" : "stop";
  return '<span class="pill ' + cls + '">' + esc(status) + '</span>';
};

const levelClass = (level) => (level === "human" || level === "abort" ? "stop" : level === "orchestrator" ? "warn" : "");

function renderMailbox(rows) {
  const waiting = rows.filter(function (q) { return !q.answer; });
  const answered = rows.filter(function (q) { return !!q.answer; });
  if (rows.length === 0) return "";

  var html = "";
  if (waiting.length > 0) {
    html += '<div class="qpanel waiting"><h2>Waiting on you — ' + waiting.length + '</h2>';
    waiting.forEach(function (q) {
      html +=
        '<div class="qrow">' +
        '<div class="qmeta"><code>' + esc(q.id) + '</code> · ' + esc(q.fromAgent) +
        ' · phase ' + esc(q.phase) + ' · ' + esc(q.at.slice(11, 19)) + '</div>' +
        '<div class="qtext">' + esc(q.question) + '</div>' +
        '<div class="qhow">answer it: <code>purco-spike answer --id ' + esc(q.id) +
        ' --run ' + esc(q.runId) + ' --text "..."</code></div>' +
        "</div>";
    });
    html += "</div>";
  }
  if (answered.length > 0) {
    html += '<div class="qpanel"><h2>Answered — ' + answered.length + '</h2>';
    answered.slice(0, 12).forEach(function (q) {
      html +=
        '<div class="qrow done">' +
        '<div class="qmeta"><code>' + esc(q.id) + '</code> · ' + esc(q.fromAgent) +
        ' · answered by ' + esc(q.answeredBy || "?") + '</div>' +
        '<div class="qtext">' + esc(q.question) + '</div>' +
        '<div class="qanswer">' + esc(q.answer) + "</div>" +
        "</div>";
    });
    html += "</div>";
  }
  return html;
}

function renderRun(run) {
  const key = run.ticket + "/" + run.runId;
  const isOpen = open.has(key) || run.active;

  const agents = run.agents.length === 0 ? '<p class="empty">No agents yet.</p>' :
    '<div class="scroll"><table><thead><tr><th>Agent</th><th class="num">Events</th><th class="num">Tools</th><th class="num">Fails</th><th class="num">Thoughts</th><th class="num">Asks</th><th class="num">Sent</th><th>Last action</th></tr></thead><tbody>' +
    run.agents.map((a) =>
      '<tr><td class="m">' + esc(a.label) + '</td><td class="num">' + a.events + '</td><td class="num">' + a.toolCalls +
      '</td><td class="num">' + a.failures + '</td><td class="num">' + a.thoughts + '</td><td class="num">' + a.questions +
      '</td><td class="num">' + a.messagesSent + '</td><td>' + esc(a.lastAction) + '</td></tr>'
    ).join("") + "</tbody></table></div>";

  const phases = run.phases.length === 0 ? '<p class="empty">No phases yet.</p>' :
    '<div class="scroll"><table><thead><tr><th>Phase</th><th>Agent</th><th>Status</th><th class="num">Cost</th></tr></thead><tbody>' +
    run.phases.map((p) => '<tr><td class="m">' + esc(p.phase) + '</td><td class="m">' + esc(p.agent) + '</td><td>' + statusPill(p.status) + '</td><td class="num">' + money(p.cost) + '</td></tr>').join("") +
    "</tbody></table></div>";

  const decisions = run.decisions.length === 0 ? '<p class="empty">No decisions yet.</p>' :
    '<div class="scroll"><table><thead><tr><th>ID</th><th>Level</th><th>From</th><th>Question or blocker</th><th>Decision</th><th>By</th></tr></thead><tbody>' +
    run.decisions.map((d) =>
      '<tr><td class="m">' + esc(d.id) + '</td><td><span class="pill ' + levelClass(d.level) + '">' + esc(d.level) +
      (d.attempts > 1 ? " x" + d.attempts : "") + '</span></td><td class="m">' + esc(d.from) + '</td><td>' + esc(d.summary) +
      '</td><td>' + esc(d.resolution || "—") + '</td><td class="m">' + esc(d.resolvedBy || "open") + '</td></tr>'
    ).join("") + "</tbody></table></div>";

  const messages = run.messages.length === 0 ? '<p class="empty">Nothing relayed through the coordinator yet.</p>' :
    '<div class="scroll"><table><thead><tr><th>ID</th><th>From</th><th></th><th>For role</th><th>Subject</th><th>Body</th><th>Handed to</th><th>Read</th></tr></thead><tbody>' +
    run.messages.map((m) =>
      '<tr><td class="m">' + esc(m.id) + '</td><td class="m">' + esc(m.from) + '</td><td class="arrow">-&gt;</td><td class="m">' + esc(m.forRole || "coordinator") +
      '</td><td>' + esc(m.subject) + '</td><td>' + esc(m.body) + '</td><td class="m">' + esc(m.relayedTo || "not yet") + '</td><td class="m">' + (m.readAt ? clock(m.readAt) : "unread") + '</td></tr>'
    ).join("") + "</tbody></table></div>";

  const feed = '<div class="feed">' + run.recent.map((e) =>
    '<div class="ev"><span class="t">' + clock(e.at) + '</span><span class="k k-' + esc(e.kind) + '">' + esc(e.kind) +
    '</span><span class="a">' + esc(e.agent) + '</span><span class="s">' + esc(e.summary) + '</span></div>'
  ).join("") + "</div>";

  return '<details class="run" data-key="' + esc(key) + '"' + (isOpen ? " open" : "") + '>' +
    '<summary><span class="dot' + (run.active ? " live" : "") + '"></span>' +
    '<span class="ticket">' + esc(run.ticket) + '</span><span class="rid">' + esc(run.runId) + '</span>' +
    '<span class="spacer"></span>' +
    '<span class="pill' + (run.active ? " live" : "") + '">' + (run.active ? "running" : run.ended ? "finished" : "stalled") + '</span>' +
    '<span class="pill">' + run.subagentCount + ' agents</span>' +
    '<span class="pill">' + run.eventCount + ' events</span>' +
    '<span class="pill">' + money(run.costUsd) + '</span>' +
    '<span class="rid">' + clock(run.lastEventAt) + '</span>' +
    '</summary><div class="body">' +
    "<h3>Phases</h3>" + phases +
    "<h3>Agents</h3>" + agents +
    "<h3>Orchestrator decisions</h3>" + decisions +
    "<h3>Coordinator relay</h3>" + messages +
    "<h3>Event feed (newest first)</h3>" + feed +
    "</div></details>";
}

async function tick() {
  try {
    const state = await (await fetch("/api/state")).json();
    document.getElementById("stamp").textContent =
      "updated " + clock(state.generatedAt) + " · " + state.totalRuns + " runs on disk";
    document.getElementById("tiles").innerHTML =
      tile(state.activeOrchestrators, "orchestrators running") +
      tile(state.liveSubagents, "sub-agents in live runs") +
      tile(state.openDecisions, "decisions still open") +
      tile(state.openQuestions, "questions waiting on you") +
      tile(state.totalRuns, "runs recorded") +
      tile(money(state.totalCostUsd), "total cost");
    document.querySelectorAll("details.run").forEach((d) => {
      if (d.open) open.add(d.dataset.key); else open.delete(d.dataset.key);
    });
    document.getElementById("runs").innerHTML =
      state.runs.length === 0
        ? '<p class="empty">No orchestrator runs found yet. Start one with purco-orchestrate.</p>'
        : state.runs.map(renderRun).join("");

      document.getElementById("mailbox").innerHTML = renderMailbox(state.mailbox || []);
  } catch (error) {
    document.getElementById("stamp").textContent = "monitor unreachable: " + error;
  }
}
tick();
setInterval(tick, 2000);
</script>
</body>
</html>`;
