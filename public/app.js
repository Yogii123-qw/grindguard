// GrindGuard frontend. Calls POST /api/verify and renders the report.
// No data is stored. Results live only in this page session.

const form = document.getElementById("verifyForm");
const urlInput = document.getElementById("urlInput");
const contractInput = document.getElementById("contractInput");
const chainSelect = document.getElementById("chainSelect");
const runBtn = document.getElementById("runBtn");
const verdictBody = document.getElementById("verdictBody");
const checksGrid = document.getElementById("checksGrid");
const themeBtn = document.getElementById("themeBtn");

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeBtn.textContent = theme === "dark" ? "Light mode" : "Dark mode";
  try { localStorage.setItem("grindguard-theme", theme); } catch { /* storage unavailable */ }
}

let savedTheme = "light";
try { savedTheme = localStorage.getItem("grindguard-theme") || "light"; } catch { /* storage unavailable */ }
if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches && !savedTheme) savedTheme = "dark";
setTheme(savedTheme === "dark" ? "dark" : "light");
themeBtn.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  setTheme(next);
});

document.querySelectorAll("[data-example]").forEach((chip) => {
  chip.addEventListener("click", () => {
    urlInput.value = chip.getAttribute("data-example");
    urlInput.focus();
  });
});

function esc(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showLoading() {
  verdictBody.innerHTML = '<div class="skeleton" style="height:44px"></div>'
    + '<div class="skeleton" style="height:20px;margin-top:12px"></div>'
    + '<div class="skeleton" style="height:20px;margin-top:8px"></div>';
  checksGrid.innerHTML = Array.from({ length: 4 }, () => '<div class="card span-6"><div class="skeleton" style="height:20px"></div><div class="skeleton" style="height:60px;margin-top:10px"></div></div>').join("");
}

function showError(message) {
  verdictBody.innerHTML = `<div class="error-box">${esc(message)}</div>`;
  checksGrid.innerHTML = '<p class="empty span-12">No results. Fix the error above and run again.</p>';
}

function renderReport(report) {
  const verdictClass = report.verdict.toLowerCase();
  const llm = report.llm || {};
  const llmHtml = llm.available
    ? `<p style="margin-top:12px"><strong>AI synthesis (${esc(llm.model || "Groq")}):</strong> ${esc(llm.text)}</p>`
    : `<p style="margin-top:12px" class="muted">${esc(llm.reason || "No AI synthesis ran.")}</p>`;
  verdictBody.innerHTML =
    `<span class="verdict-badge ${verdictClass}">${esc(report.verdict)}</span>`
    + `<div class="score-line"><span class="score-num">${report.score}</span><span class="score-of">/ 100</span></div>`
    + `<div class="score-bar"><div class="score-fill" style="width:${report.score}%"></div></div>`
    + `<p style="margin-top:12px">${esc(report.verdictNote)}</p>`
    + llmHtml
    + `<p class="mono muted" style="margin-top:12px">Checked ${esc(report.finishedAt)}<br>${esc(report.input.url)}</p>`;

  checksGrid.innerHTML = report.checks.map((c) => {
    const source = c.source ? `<a class="check-source" href="${esc(c.source)}" target="_blank" rel="noopener">${esc(c.source)}</a>` : "";
    return `<div class="card span-6 check-card">`
      + `<div class="check-head"><h3>${c.id}. ${esc(c.name)}</h3><span class="chip-status ${esc(c.status)}">${esc(c.status.toUpperCase())}</span></div>`
      + `<p class="check-evidence">${esc(c.evidence)}</p>`
      + source
      + `</div>`;
  }).join("");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    url: urlInput.value.trim(),
    contractAddress: contractInput.value.trim(),
    chain: chainSelect.value,
  };
  runBtn.disabled = true;
  runBtn.textContent = "Checking live sources...";
  showLoading();
  try {
    const res = await fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showError(data.error || `Request failed with HTTP ${res.status}.`);
      return;
    }
    renderReport(data);
  } catch (err) {
    showError(`Network error: ${err.message}. Check the connection and try again.`);
  } finally {
    runBtn.disabled = false;
    runBtn.textContent = "Run verification";
  }
});
