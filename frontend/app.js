// ============================================================
// CONFIG
// ============================================================
// Relative by default — works when Nginx proxies /api to the FastAPI
// service on the same origin (see deploy/nginx.conf.example). Only
// change this if the API is genuinely served from a different origin,
// and add that origin to CORS_ORIGINS in backend/.env.
const API_BASE = "/api";



// ============================================================
// STATE
// ============================================================
const state = {
  token: localStorage.getItem("rt_token") || null,
  admin: null,
  page: null,
  refreshTimer: null,
};

// ============================================================
// API CLIENT
// ============================================================
async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (state.token) {
    headers["Authorization"] = `Bearer ${state.token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const isJson = res.headers
    .get("content-type")
    ?.includes("application/json");

  const body = isJson
    ? await res.json().catch(() => null)
    : null;

  /*
   * Login 401 is NOT a session-expiry.
   * It means the supplied username/password are invalid.
   */
  if (res.status === 401 && path === "/auth/login") {
    throw new Error(
      typeof body?.detail === "string"
        ? body.detail
        : "Invalid username or password",
    );
  }

  /*
   * 401 on an authenticated API request means
   * the existing session/token has expired or is invalid.
   */
  if (res.status === 401) {
    logout();
    throw new Error("Session expired — please sign in again");
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;

    if (typeof body?.detail === "string") {
      message = body.detail;
    } else if (Array.isArray(body?.detail)) {
      message = body.detail
        .map((item) => {
          if (typeof item === "string") return item;

          const field = Array.isArray(item?.loc)
            ? item.loc[item.loc.length - 1]
            : null;

          return field && item?.msg
            ? `${field}: ${item.msg}`
            : item?.msg || "Invalid input";
        })
        .join("\n");
    }

    throw new Error(message);
  }

  return body;
}

const get = (path) => api(path);
const post = (path, data) =>
  api(path, { method: "POST", body: JSON.stringify(data || {}) });
const patch = (path, data) =>
  api(path, { method: "PATCH", body: JSON.stringify(data || {}) });
const del = (path) => api(path, { method: "DELETE" });

// ============================================================
// TOASTS
// ============================================================
function toast(message, type = "success") {
  const el = document.createElement("div");
  el.className = `toast ${type === "error" ? "error" : ""}`;
  el.textContent = message;
  document.getElementById("toast-container").appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ============================================================
// FORMATTING
// ============================================================
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fmtDuration(ms) {
  if (ms == null) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}
function maskChatId(id) {
  const s = String(id);
  return s.length <= 4 ? "••••" : `••••${s.slice(-4)}`;
}
function levelBadgeClass(level) {
  const l = (level || "").toUpperCase();
  if (l === "SUCCESS") return "badge-success";
  if (l === "WARN") return "badge-warn";
  if (l === "ERROR") return "badge-error";
  return "badge-neutral";
}
function statusBadgeClass(status) {
  if (status === "success" || status === "sent" || status === "active")
    return "badge-success";
  if (status === "running" || status === "pending" || status === "sending")
    return "badge-warn";
  if (status === "failed" || status === "cancelled") return "badge-error";
  return "badge-neutral";
}
function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

// ============================================================
// MODAL
// ============================================================
function openModal(innerHtml) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop"><div class="modal panel">${innerHtml}</div></div>`;
  document.getElementById("modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") closeModal();
  });
}
function closeModal() {
  document.getElementById("modal-root").innerHTML = "";
}
function confirmModal(message, onConfirm) {
  openModal(`
    <div class="modal-title">${escapeHtml(message)}</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="confirm-cancel">Cancel</button>
      <button class="btn btn-danger" id="confirm-ok">Confirm</button>
    </div>
  `);
  document.getElementById("confirm-cancel").onclick = closeModal;
  document.getElementById("confirm-ok").onclick = async () => {
    closeModal();
    await onConfirm();
  };
}

// ============================================================
// AUTH
// ============================================================
async function login(username, password) {
  const data = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  state.token = data.access_token;
  localStorage.setItem("rt_token", state.token);
  await loadSession();
}

function logout() {
  state.token = null;
  state.admin = null;
  localStorage.removeItem("rt_token");
  clearInterval(state.refreshTimer);
  document.getElementById("app-shell").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
}

async function loadSession() {
  state.admin = await get("/auth/me");
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");
  document.getElementById("topbar-user").textContent =
    state.admin.display_name || state.admin.username;
  navigate(location.hash.replace("#", "") || "overview");
}

// ============================================================
// NAVIGATION
// ============================================================
const PAGE_TITLES = {
  overview: "Overview",
  results: "Results",
  crawler: "Crawler",
  telegram: "Telegram",
  notifications: "Notifications",
  subscribers: "Subscribers",
  logs: "Logs",
  admins: "Admins",
  health: "System Health",
  profile: "Profile",
};

const RENDERERS = {
  overview: renderOverview,
  results: renderResults,
  crawler: renderCrawler,
  telegram: renderTelegram,
  notifications: renderNotifications,
  subscribers: renderSubscribers,
  logs: renderLogs,
  admins: renderAdmins,
  health: renderHealth,
  profile: renderProfile,
};

// Doc section 26: auto-refresh cadence per page. null = no polling.
const REFRESH_MS = {
  overview: 7000,
  crawler: 5000,
  notifications: 7000,
};

const menuToggle = document.getElementById("menu-toggle");
const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");

function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("open");
  menuToggle.setAttribute("aria-expanded", "false");
  document.body.style.overflow = "";
}

function openSidebar() {
  sidebar.classList.add("open");
  sidebarOverlay.classList.add("open");
  menuToggle.setAttribute("aria-expanded", "true");
  document.body.style.overflow = "hidden";
}

menuToggle.onclick = () => {
  if (sidebar.classList.contains("open")) {
    closeSidebar();
  } else {
    openSidebar();
  }
};

sidebarOverlay.onclick = () => {
  closeSidebar();
};

function navigate(page) {
  if (!RENDERERS[page]) page = "overview";
  state.page = page;
  location.hash = page;

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === page);
  });
  document.getElementById("page-title").textContent = PAGE_TITLES[page];
  closeSidebar();

  clearInterval(state.refreshTimer);
  RENDERERS[page]();

  if (REFRESH_MS[page]) {
    state.refreshTimer = setInterval(() => {
      if (state.page === page) RENDERERS[page](true);
    }, REFRESH_MS[page]);
  }
}

// ============================================================
// PAGE: OVERVIEW
// ============================================================
async function renderOverview(isPoll) {
  const mount = document.getElementById("page-content");
  try {
    const d = await get("/overview");
    mount.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="label">Results stored</div><div class="value">${d.results_total}</div><div class="sub">${d.results_new_24h} new in last 24h</div></div>
        <div class="stat-card"><div class="label">Subscribers</div><div class="value">${d.subscribers_active}</div><div class="sub">${d.subscribers_total} total</div></div>
        <div class="stat-card"><div class="label">Notification queue</div><div class="value c-amber">${d.notification_queue.pending + d.notification_queue.sending}</div><div class="sub">${d.notification_queue.failed} failed</div></div>
        <div class="stat-card"><div class="label">Crawler</div><div class="value ${d.running_run ? "c-amber" : "c-teal"}">${d.running_run ? "Running" : d.crawler_enabled ? "Idle" : "Disabled"}</div><div class="sub">${d.latest_run ? "Last: " + fmtDate(d.latest_run.started_at) : "No runs yet"}</div></div>
      </div>

      <div class="section-title"><h3>Recent crawler runs</h3></div>
      <div class="table-wrap mb-14">
        <table>
          <thead><tr><th>Run</th><th>Status</th><th>Duration</th><th>New results</th><th>Started</th></tr></thead>
          <tbody>
            ${
              d.recent_runs.length
                ? d.recent_runs
                    .map(
                      (r) => `
              <tr><td class="mono">#${r.id}</td><td><span class="badge ${statusBadgeClass(r.status)}">${escapeHtml(r.status)}</span></td>
              <td class="mono tab-num">${fmtDuration(r.duration_ms)}</td><td class="mono tab-num">${r.results_new}</td>
              <td class="mono tab-num text-muted">${fmtDate(r.started_at)}</td></tr>`,
                    )
                    .join("")
                : `<tr class="empty-row"><td colspan="5">No crawl runs yet — trigger one from the Crawler page.</td></tr>`
            }
          </tbody>
        </table>
      </div>

      <div class="section-title"><h3>Recent activity</h3></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Level</th><th>Actor</th><th>Action</th><th>Message</th><th>Time</th></tr></thead>
          <tbody>
            ${d.recent_activity
              .map(
                (l) => `
              <td><span class="badge ${levelBadgeClass(l.level)}">${escapeHtml(l.level)}</span></td>
              <td class="mono text-muted">${escapeHtml(l.actor)}</td><td class="mono text-muted">${escapeHtml(l.action)}</td>
              <td>${escapeHtml(l.message || "")}</td><td class="mono tab-num text-muted">${fmtDate(l.created_at)}</td></tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    if (!isPoll)
      mount.innerHTML = `<p class="error-text">${escapeHtml(e.message)}</p>`;
  }
}

// ============================================================
// PAGE: RESULTS
// ============================================================
let resultsOffset = 0;
const RESULTS_LIMIT = 20;

async function renderResults() {
  const mount = document.getElementById("page-content");
  const [institutes] = await Promise.all([
    get("/structure/institutes").catch(() => []),
  ]);

  mount.innerHTML = `
    <div class="filters">
      <select id="f-institute"><option value="">All institutes</option>${institutes.map((i) => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join("")}</select>
      <input type="text" id="f-search" placeholder="Search exam name…" />
      <button class="btn btn-ghost" id="f-apply">Filter</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Exam</th><th>Institute</th><th>Degree</th><th>Semester</th><th>Discovered</th><th>Notified</th></tr></thead>
        <tbody id="results-body"><tr class="empty-row"><td colspan="6">Loading…</td></tr></tbody>
      </table>
    </div>
    <div class="pagination">
      <span id="results-count" class="mono"></span>
      <div>
        <button class="btn btn-ghost" id="results-prev">← Prev</button>
        <button class="btn btn-ghost" id="results-next">Next →</button>
      </div>
    </div>
  `;

  document.getElementById("f-apply").onclick = () => {
    resultsOffset = 0;
    loadResults();
  };
  document.getElementById("results-prev").onclick = () => {
    resultsOffset = Math.max(0, resultsOffset - RESULTS_LIMIT);
    loadResults();
  };
  document.getElementById("results-next").onclick = () => {
    resultsOffset += RESULTS_LIMIT;
    loadResults();
  };

  await loadResults();

  async function loadResults() {
    const institute_id = document.getElementById("f-institute").value;
    const search = document.getElementById("f-search").value.trim();
    const params = new URLSearchParams({
      limit: RESULTS_LIMIT,
      offset: resultsOffset,
    });
    if (institute_id) params.set("institute_id", institute_id);
    if (search) params.set("search", search);

    try {
      const d = await get(`/results?${params}`);
      const body = document.getElementById("results-body");
      body.innerHTML = d.items.length
        ? d.items
            .map(
              (r) => `
        <tr>
          <td>${escapeHtml(r.exam_name)}</td>
          <td class="text-muted">${escapeHtml(r.institute_name || r.institute_id)}</td>
          <td class="text-muted">${escapeHtml(r.degree_name || r.degree_id)}</td>
          <td class="mono text-muted">${escapeHtml(r.semester_id)}</td>
          <td class="mono tab-num text-muted">${fmtDate(r.first_seen_at)}</td>
          <td class="mono tab-num">${r.notified_count}${r.pending_count ? ` <span class="text-dim">(+${r.pending_count} pending)</span>` : ""}</td>
        </tr>`,
            )
            .join("")
        : `<tr class="empty-row"><td colspan="6">No results match this filter.</td></tr>`;
      document.getElementById("results-count").textContent =
        `${d.total} total · showing ${resultsOffset + 1}–${Math.min(resultsOffset + RESULTS_LIMIT, d.total)}`;
    } catch (e) {
      toast(e.message, "error");
    }
  }
}

// ============================================================
// PAGE: CRAWLER
// ============================================================
async function renderCrawler(isPoll) {
  const mount = document.getElementById("page-content");

  try {
    const [status, runs] = await Promise.all([
      get("/crawler/status"),
      get("/crawler/runs?limit=15"),
    ]);

    const s = status.settings;
    const running = status.running_run;

    const statusText = running
      ? `Run #${running.id} in progress — started ${fmtDate(running.started_at)}`
      : s["crawler.enabled"]
        ? "Idle, waiting for next scheduled run"
        : "Disabled";

    const runButtonText = running ? "Running…" : "Run now";

    const runsHtml = runs.length
      ? runs
          .map(
            (r) => `
              <tr>
                <td class="mono">#${r.id}</td>
                <td>
                  <span class="badge ${statusBadgeClass(r.status)}">
                    ${escapeHtml(r.status)}
                  </span>
                </td>
                <td class="mono tab-num">${fmtDuration(r.duration_ms)}</td>
                <td class="mono tab-num">
                  ${r.institutes_completed}/${r.institutes_total}
                  ${
                    r.institutes_failed
                      ? ` <span class="c-red">(${r.institutes_failed} failed)</span>`
                      : ""
                  }
                </td>
                <td class="mono tab-num">${r.results_discovered}</td>
                <td class="mono tab-num">${r.results_new}</td>
                <td class="mono tab-num text-muted">${fmtDate(r.started_at)}</td>
              </tr>
            `,
          )
          .join("")
      : `<tr class="empty-row"><td colspan="7">No runs yet.</td></tr>`;

    /*
     * IMPORTANT:
     * During polling, update ONLY the live status/run history.
     * Do NOT rebuild the settings form.
     *
     * This prevents unsaved user input from being overwritten.
     */
    if (isPoll) {
      const statusDesc = document.getElementById("crawler-status-desc");
      const runNowButton = document.getElementById("run-now");
      const runsBody = document.getElementById("crawler-runs-body");

      if (statusDesc) {
        statusDesc.textContent = statusText;
      }

      if (runNowButton) {
        runNowButton.disabled = !!running;
        runNowButton.textContent = runButtonText;
      }

      if (runsBody) {
        runsBody.innerHTML = runsHtml;
      }

      return;
    }

    /*
     * Full render only when:
     * - Opening the page
     * - After saving settings
     * - After clicking Run Now
     */
    mount.innerHTML = `
      <div class="card">
        <h4>Crawler control</h4>

        <div class="form-row">
          <div>
            <div class="row-label">Status</div>
            <div class="row-desc" id="crawler-status-desc">
              ${escapeHtml(statusText)}
            </div>
          </div>

          <button
            class="btn btn-primary"
            id="run-now"
            ${running ? "disabled" : ""}
          >
            ${runButtonText}
          </button>
        </div>

        <div class="form-row">
          <div class="row-label">Enabled</div>
          <label class="toggle">
            <input
              type="checkbox"
              id="s-enabled"
              ${s["crawler.enabled"] ? "checked" : ""}
            />
            <span class="slider"></span>
          </label>
        </div>

        <div class="form-row">
          <div class="row-label">Interval (minutes)</div>
          <input
            type="number"
            id="s-interval"
            value="${s["crawler.interval_minutes"]}"
          />
        </div>

        <div class="form-row">
          <div class="row-label">Workers</div>
          <input
            type="number"
            id="s-workers"
            value="${s["crawler.workers"]}"
          />
        </div>

        <div class="form-row">
          <div class="row-label">Retry count</div>
          <input
            type="number"
            id="s-retry"
            value="${s["crawler.retry_count"]}"
          />
        </div>

        <div class="form-row">
          <div class="row-label">Retry delay (s)</div>
          <input
            type="number"
            id="s-retrydelay"
            value="${s["crawler.retry_delay_seconds"]}"
          />
        </div>

        <div class="form-row">
          <div class="row-label">Request timeout (s)</div>
          <input
            type="number"
            id="s-timeout"
            value="${s["crawler.request_timeout_seconds"]}"
          />
        </div>

        <div class="form-row">
          <div></div>
          <button class="btn btn-ghost" id="save-crawler-settings">
            Save changes
          </button>
        </div>
      </div>

      <div class="section-title">
        <h3>Recent runs</h3>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Run</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Institutes</th>
              <th>Discovered</th>
              <th>New</th>
              <th>Started</th>
            </tr>
          </thead>

          <tbody id="crawler-runs-body">
            ${runsHtml}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById("run-now").onclick = async (e) => {
      e.target.disabled = true;

      try {
        await post("/crawler/run");

        toast("Crawl run triggered");
        renderCrawler();
      } catch (err) {
        toast(err.message, "error");
        e.target.disabled = false;
      }
    };

    document.getElementById("save-crawler-settings").onclick = async () => {
      try {
        await patch("/settings/bulk", {
          settings: {
            "crawler.enabled": document.getElementById("s-enabled").checked,

            "crawler.interval_minutes": Number(
              document.getElementById("s-interval").value,
            ),

            "crawler.workers": Number(
              document.getElementById("s-workers").value,
            ),

            "crawler.retry_count": Number(
              document.getElementById("s-retry").value,
            ),

            "crawler.retry_delay_seconds": Number(
              document.getElementById("s-retrydelay").value,
            ),

            "crawler.request_timeout_seconds": Number(
              document.getElementById("s-timeout").value,
            ),
          },
        });

        toast("Crawler settings saved");

        /*
         * Full render after successful save is intentional.
         * At this point the database contains the new values.
         */
        renderCrawler();
      } catch (err) {
        toast(err.message, "error");
      }
    };
  } catch (e) {
    if (!isPoll) {
      mount.innerHTML = `
        <p class="error-text">
          ${escapeHtml(e.message)}
        </p>
      `;
    }
  }
}

// ============================================================
// PAGE: TELEGRAM
// ============================================================
async function renderTelegram() {
  const mount = document.getElementById("page-content");
  try {
    const status = await get("/telegram/status");
    const s = status.settings;

    mount.innerHTML = `
      <div class="card">
        <h4>Telegram integration</h4>
        <div class="form-row"><div class="row-label">Integration enabled</div><label class="toggle"><input type="checkbox" id="t-enabled" ${s["telegram.enabled"] ? "checked" : ""}/><span class="slider"></span></label></div>
        <div class="form-row"><div class="row-label">Result notifications</div><label class="toggle"><input type="checkbox" id="t-notif" ${s["telegram.notifications_enabled"] ? "checked" : ""}/><span class="slider"></span></label></div>
        <div class="form-row"><div class="row-label">Admin chat ID</div><input type="text" id="t-admin-chat" value="${escapeHtml(s["telegram.admin_chat_id"] ?? "")}" /></div>
        <div class="form-row"><div></div><button class="btn btn-ghost" id="save-telegram-settings">Save changes</button></div>
      </div>

      <div class="card">
        <h4>Bot token</h4>
        <div class="form-row">
          <div><div class="row-label">Current token</div><div class="row-desc">•••••••••••••••• ${status.bot_token_configured ? "(configured on server)" : "(not set — Telegram features will fail)"}</div></div>
        </div>
        <p class="text-dim">Rotating the token isn't wired up from the dashboard yet — it lives in the server's environment, not the database, so it never gets logged or exposed through this API. Update it in <code>.env</code> and restart the service.</p>
      </div>

      <div class="card">
        <h4>Test message</h4>
        <div class="form-row">
          <input type="text" id="test-chat-id" placeholder="Chat ID (defaults to admin)" style="width:180px;" />
          <button class="btn btn-primary" id="send-test">Send test message</button>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat-card"><div class="label">Active subscribers</div><div class="value">${status.subscribers_active}</div><div class="sub">${status.subscribers_total} total</div></div>
      </div>
    `;

    document.getElementById("save-telegram-settings").onclick = async () => {
      try {
        const adminChatId = document
          .getElementById("t-admin-chat")
          .value.trim();

        await patch("/settings/bulk", {
          settings: {
            "telegram.enabled": document.getElementById("t-enabled").checked,
            "telegram.notifications_enabled":
              document.getElementById("t-notif").checked,
            "telegram.admin_chat_id":
              adminChatId === "" ? null : Number(adminChatId),
          },
        });

        toast("Telegram settings saved");
        renderTelegram();
      } catch (err) {
        toast(err.message, "error");
      }
    };

    document.getElementById("send-test").onclick = async () => {
      const chatId = document.getElementById("test-chat-id").value.trim();
      try {
        await post("/telegram/test", chatId ? { chat_id: Number(chatId) } : {});
        toast("Test message sent");
      } catch (err) {
        toast(err.message, "error");
      }
    };
  } catch (e) {
    mount.innerHTML = `<p class="error-text">${escapeHtml(e.message)}</p>`;
  }
}

// ============================================================
// PAGE: NOTIFICATIONS
// ============================================================
async function renderNotifications(isPoll) {
  const mount = document.getElementById("page-content");
  try {
    const status = await get("/notifications/status");
    const queue = await get("/notifications/queue?limit=25");
    const c = status.queue_counts;
    const s = status.settings;

    mount.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="label">Pending</div><div class="value c-amber">${c.pending}</div></div>
        <div class="stat-card"><div class="label">Sending</div><div class="value c-amber">${c.sending}</div></div>
        <div class="stat-card"><div class="label">Sent</div><div class="value c-teal">${c.sent}</div></div>
        <div class="stat-card"><div class="label">Failed</div><div class="value c-red">${c.failed}</div></div>
      </div>

      <div class="card">
        <h4>Notification worker settings</h4>
        <div class="form-row"><div class="row-label">Worker enabled</div><div class="mono">${s["notifications.enabled"] ? "Yes" : "No"}</div></div>
        <div class="form-row"><div class="row-label">Poll interval</div><div class="mono">${s["notifications.poll_interval_seconds"]}s</div></div>
        <div class="form-row"><div class="row-label">Batch size</div><div class="mono">${s["notifications.batch_size"]}</div></div>
        <div class="form-row"><div class="row-label">Retry delay</div><div class="mono">${s["notifications.retry_delay_seconds"]}s</div></div>
        <div class="form-row"><div class="row-label">Max attempts</div><div class="mono">${s["notifications.max_attempts"]}</div></div>
      </div>

      <div class="section-title"><h3>Queue</h3></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Exam</th><th>Chat</th><th>Status</th><th>Attempts</th><th>Last error</th><th>Next attempt</th></tr></thead>
          <tbody>
            ${
              queue.length
                ? queue
                    .map(
                      (n) => `
              <tr><td>${escapeHtml(n.exam_name)}</td><td class="mono">${maskChatId(n.chat_id)}</td>
              <td><span class="badge ${statusBadgeClass(n.status)}">${escapeHtml(n.status)}</span></td>
              <td class="mono tab-num">${n.attempts}</td>
              <td class="text-muted">${escapeHtml(n.last_error || "—")}</td>
              <td class="mono tab-num text-muted">${fmtDate(n.next_attempt_at)}</td></tr>`,
                    )
                    .join("")
                : `<tr class="empty-row"><td colspan="6">Queue is empty.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    if (!isPoll)
      mount.innerHTML = `<p class="error-text">${escapeHtml(e.message)}</p>`;
  }
}

// ============================================================
// PAGE: SUBSCRIBERS
// ============================================================
async function renderSubscribers() {
  const mount = document.getElementById("page-content");
  mount.innerHTML = `
    <div class="filters">
      <select id="sub-filter"><option value="">All</option><option value="true">Active</option><option value="false">Inactive</option></select>
      <button class="btn btn-primary" id="add-subscriber" style="margin-left:auto;">Add subscriber</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Chat ID</th><th>Username</th><th>Name</th><th>Status</th><th>Since</th><th></th></tr></thead>
        <tbody id="sub-body"><tr class="empty-row"><td colspan="6">Loading…</td></tr></tbody>
      </table>
    </div>
  `;

  document.getElementById("sub-filter").onchange = load;
  document.getElementById("add-subscriber").onclick = () => {
    openModal(`
      <div class="modal-title">Add subscriber</div>
      <div class="field"><label>Chat ID</label><input type="text" id="m-chatid" /></div>
      <div class="field"><label>Username (optional)</label><input type="text" id="m-username" /></div>
      <div class="field"><label>First name (optional)</label><input type="text" id="m-firstname" /></div>
      <div class="modal-actions"><button class="btn btn-ghost" id="m-cancel">Cancel</button><button class="btn btn-primary" id="m-save">Add</button></div>
    `);
    document.getElementById("m-cancel").onclick = closeModal;
    document.getElementById("m-save").onclick = async () => {
      const chat_id = Number(document.getElementById("m-chatid").value);
      if (!chat_id) {
        toast("Chat ID is required", "error");
        return;
      }
      try {
        await post("/subscribers", {
          chat_id,
          username: document.getElementById("m-username").value || null,
          first_name: document.getElementById("m-firstname").value || null,
        });
        closeModal();
        toast("Subscriber added");
        load();
      } catch (e) {
        toast(e.message, "error");
      }
    };
  };

  await load();

  async function load() {
    const isActive = document.getElementById("sub-filter").value;
    const params = new URLSearchParams({ limit: 100 });
    if (isActive) params.set("is_active", isActive);
    try {
      const d = await get(`/subscribers?${params}`);
      document.getElementById("sub-body").innerHTML = d.items.length
        ? d.items
            .map(
              (s) => `
        <tr>
          <td class="mono">${maskChatId(s.chat_id)}</td>
          <td class="text-muted">${escapeHtml(s.username || "—")}</td>
          <td>${escapeHtml(s.first_name || "—")}</td>
          <td><span class="badge ${statusBadgeClass(s.is_active ? "active" : "inactive")}">${s.is_active ? "active" : "inactive"}</span></td>
          <td class="mono tab-num text-muted">${fmtDate(s.created_at)}</td>
          <td style="text-align:right; white-space:nowrap;">
            <button class="btn btn-ghost" data-toggle="${s.chat_id}" data-active="${s.is_active}" style="padding:5px 10px;font-size:12px;">${s.is_active ? "Deactivate" : "Activate"}</button>
            <button class="btn btn-danger" data-delete="${s.chat_id}" style="padding:5px 10px;font-size:12px;">Delete</button>
          </td>
        </tr>`,
            )
            .join("")
        : `<tr class="empty-row"><td colspan="6">No subscribers.</td></tr>`;

      document.querySelectorAll("[data-toggle]").forEach((btn) => {
        btn.onclick = async () => {
          try {
            await patch(`/subscribers/${btn.dataset.toggle}`, {
              is_active: btn.dataset.active !== "true",
            });
            load();
          } catch (e) {
            toast(e.message, "error");
          }
        };
      });
      document.querySelectorAll("[data-delete]").forEach((btn) => {
        btn.onclick = () =>
          confirmModal("Delete this subscriber permanently?", async () => {
            try {
              await del(`/subscribers/${btn.dataset.delete}`);
              toast("Subscriber deleted");
              load();
            } catch (e) {
              toast(e.message, "error");
            }
          });
      });
    } catch (e) {
      toast(e.message, "error");
    }
  }
}

// ============================================================
// PAGE: LOGS
// ============================================================
let logsOffset = 0;
const LOGS_LIMIT = 30;

async function renderLogs() {
  const mount = document.getElementById("page-content");
  mount.innerHTML = `
    <div class="filters">
      <select id="l-level"><option value="">All levels</option>${["DEBUG", "INFO", "SUCCESS", "WARN", "ERROR"].map((l) => `<option value="${l}">${l}</option>`).join("")}</select>
      <input type="text" id="l-actor" placeholder="Actor…" />
      <input type="text" id="l-action" placeholder="Action…" />
      <button class="btn btn-ghost" id="l-apply">Filter</button>
      <button class="btn btn-ghost" id="l-refresh">Refresh</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Level</th><th>Actor</th><th>Action</th><th>Target</th><th>Message</th><th>Time</th></tr></thead>
        <tbody id="logs-body"><tr class="empty-row"><td colspan="6">Loading…</td></tr></tbody>
      </table>
    </div>
    <div class="pagination">
      <span id="logs-count" class="mono"></span>
      <div><button class="btn btn-ghost" id="logs-prev">← Prev</button><button class="btn btn-ghost" id="logs-next">Next →</button></div>
    </div>
  `;
  document.getElementById("l-apply").onclick = () => {
    logsOffset = 0;
    load();
  };
  document.getElementById("l-refresh").onclick = load;
  document.getElementById("logs-prev").onclick = () => {
    logsOffset = Math.max(0, logsOffset - LOGS_LIMIT);
    load();
  };
  document.getElementById("logs-next").onclick = () => {
    logsOffset += LOGS_LIMIT;
    load();
  };

  await load();

  async function load() {
    const params = new URLSearchParams({
      limit: LOGS_LIMIT,
      offset: logsOffset,
    });
    const level = document.getElementById("l-level").value;
    const actor = document.getElementById("l-actor").value.trim();
    const action = document.getElementById("l-action").value.trim();
    if (level) params.set("level", level);
    if (actor) params.set("actor", actor);
    if (action) params.set("action", action);

    try {
      const d = await get(`/logs?${params}`);
      document.getElementById("logs-body").innerHTML = d.items.length
        ? d.items
            .map(
              (l) => `
        <tr><td><span class="badge ${levelBadgeClass(l.level)}">${escapeHtml(l.level)}</span></td>
        <td class="mono text-muted">${escapeHtml(l.actor)}</td><td class="mono text-muted">${escapeHtml(l.action)}</td>
        <td class="mono text-muted">${escapeHtml(l.target || "—")}</td><td>${escapeHtml(l.message || "")}</td>
        <td class="mono tab-num text-muted">${fmtDate(l.created_at)}</td></tr>`,
            )
            .join("")
        : `<tr class="empty-row"><td colspan="6">No matching log entries.</td></tr>`;
      document.getElementById("logs-count").textContent =
        `${d.total} total · showing ${logsOffset + 1}–${Math.min(logsOffset + LOGS_LIMIT, d.total)}`;
    } catch (e) {
      toast(e.message, "error");
    }
  }
}

// ============================================================
// PAGE: ADMINS
// ============================================================
async function renderAdmins() {
  const mount = document.getElementById("page-content");
  try {
    const admins = await get("/admins");
    mount.innerHTML = `
      <div class="filters"><button class="btn btn-primary" id="add-admin" style="margin-left:auto;">Add admin</button></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Username</th><th>Display name</th><th>Status</th><th>Last login</th><th></th></tr></thead>
          <tbody>
            ${admins
              .map(
                (a) => `
              <tr><td class="mono">${escapeHtml(a.username)}</td><td>${escapeHtml(a.display_name || "—")}</td>
              <td><span class="badge ${statusBadgeClass(a.is_active ? "active" : "inactive")}">${a.is_active ? "active" : "inactive"}</span></td>
              <td class="mono tab-num text-muted">${fmtDate(a.last_login_at)}</td>
              <td style="text-align:right; white-space:nowrap;">
                ${
                  a.id !== state.admin.id
                    ? `
                  <button class="btn btn-ghost" data-toggle-admin="${a.id}" data-active="${a.is_active}" style="padding:5px 10px;font-size:12px;">${a.is_active ? "Deactivate" : "Activate"}</button>
                  <button class="btn btn-danger" data-delete-admin="${a.id}" style="padding:5px 10px;font-size:12px;">Delete</button>
                `
                    : `<span class="text-dim">You</span>`
                }
              </td></tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById("add-admin").onclick = () => {
      openModal(`
        <div class="modal-title">Add admin</div>
        <div class="field"><label>Username</label><input type="text" id="m-username" /></div>
        <div class="field"><label>Password</label><input type="password" id="m-password" /></div>
        <div class="field"><label>Display name (optional)</label><input type="text" id="m-display" /></div>
        <div class="modal-actions"><button class="btn btn-ghost" id="m-cancel">Cancel</button><button class="btn btn-primary" id="m-save">Create</button></div>
      `);
      document.getElementById("m-cancel").onclick = closeModal;
      document.getElementById("m-save").onclick = async () => {
        try {
          await post("/admins", {
            username: document.getElementById("m-username").value,
            password: document.getElementById("m-password").value,
            display_name: document.getElementById("m-display").value || null,
          });
          closeModal();
          toast("Admin created");
          renderAdmins();
        } catch (e) {
          toast(e.message, "error");
        }
      };
    };

    document.querySelectorAll("[data-toggle-admin]").forEach((btn) => {
      btn.onclick = async () => {
        try {
          await patch(`/admins/${btn.dataset.toggleAdmin}`, {
            is_active: btn.dataset.active !== "true",
          });
          renderAdmins();
        } catch (e) {
          toast(e.message, "error");
        }
      };
    });
    document.querySelectorAll("[data-delete-admin]").forEach((btn) => {
      btn.onclick = () =>
        confirmModal("Delete this admin account permanently?", async () => {
          try {
            await del(`/admins/${btn.dataset.deleteAdmin}`);
            toast("Admin deleted");
            renderAdmins();
          } catch (e) {
            toast(e.message, "error");
          }
        });
    });
  } catch (e) {
    mount.innerHTML = `<p class="error-text">${escapeHtml(e.message)}</p>`;
  }
}

// ============================================================
// PAGE: HEALTH
// ============================================================
function healthDot(value) {
  if (value === "healthy" || value === "active") return "dot-healthy";
  if (value === "unhealthy" || value === "failed" || value === "inactive")
    return "dot-unhealthy";
  return "dot-unknown";
}

async function renderHealth() {
  const mount = document.getElementById("page-content");
  try {
    const h = await get("/health");
    const rows = [
      ["PostgreSQL", h.postgres],
      ["Crawler service", h.crawler_service],
      ["Notification worker", h.notification_worker],
      ["Telegram bot", h.telegram_bot],
      ["Dashboard API", h.dashboard_api],
    ];
    mount.innerHTML = `
      <div class="card">
        <div class="health-list">
          ${rows
            .map(
              ([name, val]) => `
            <div class="health-row"><div class="name"><span class="dot-status ${healthDot(val)}"></span>${escapeHtml(name)}</div><div class="state">${escapeHtml(val)}</div></div>`,
            )
            .join("")}
          <div class="health-row"><div class="name"><span class="dot-status ${h.disk_free_percent > 15 ? "dot-healthy" : "dot-unhealthy"}"></span>Disk free</div><div class="state">${h.disk_free_percent}%</div></div>
        </div>
      </div>
      <p class="text-dim">Service checks use <code>systemctl is-active</code> on the host — they'll read "unknown" anywhere that's not how the service is run (e.g. this isn't the production VPS). Checked at ${fmtDate(h.checked_at)}.</p>
    `;
  } catch (e) {
    mount.innerHTML = `<p class="error-text">${escapeHtml(e.message)}</p>`;
  }
}

// ============================================================
// PAGE: PROFILE
// ============================================================
async function renderProfile() {
  const mount = document.getElementById("page-content");
  const a = state.admin;
  mount.innerHTML = `
    <div class="card">
      <h4>Your account</h4>
      <div class="form-row"><div class="row-label">Username</div><div class="mono">${escapeHtml(a.username)}</div></div>
      <div class="form-row"><div class="row-label">Display name</div><input type="text" id="p-display" value="${escapeHtml(a.display_name || "")}" /></div>
      <div class="form-row"><div></div><button class="btn btn-ghost" id="p-save-name">Save display name</button></div>
    </div>
    <div class="card">
      <h4>Change password</h4>
      <div class="form-row"><div class="row-label">New password</div><input type="password" id="p-password" style="width:220px;" /></div>
      <div class="form-row"><div></div><button class="btn btn-primary" id="p-save-password">Update password</button></div>
    </div>
  `;
  document.getElementById("p-save-name").onclick = async () => {
    try {
      await patch(`/admins/${a.id}`, {
        display_name: document.getElementById("p-display").value,
      });
      toast("Display name updated");
      await loadSession();
      navigate("profile");
    } catch (e) {
      toast(e.message, "error");
    }
  };
  document.getElementById("p-save-password").onclick = async () => {
    const pw = document.getElementById("p-password").value;
    if (pw.length < 8) {
      toast("Password must be at least 8 characters", "error");
      return;
    }
    try {
      await patch(`/admins/${a.id}`, { password: pw });
      toast("Password updated");
      document.getElementById("p-password").value = "";
    } catch (e) {
      toast(e.message, "error");
    }
  };
}

// ============================================================
// INIT
// ============================================================
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const usernameInput = document.getElementById("login-username");
  const passwordInput = document.getElementById("login-password");
  const btn = document.getElementById("login-submit");
  const errEl = document.getElementById("login-error");

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  errEl.textContent = "";
  errEl.classList.add("hidden");

  // Client-side validation
  if (!username && !password) {
    errEl.textContent = "Username and password are required";
    errEl.classList.remove("hidden");
    usernameInput.focus();
    return;
  }

  if (!username) {
    errEl.textContent = "Username is required";
    errEl.classList.remove("hidden");
    usernameInput.focus();
    return;
  }

  if (!password) {
    errEl.textContent = "Password is required";
    errEl.classList.remove("hidden");
    passwordInput.focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = "Signing in…";

  try {
    await login(username, password);
  } catch (e) {
    errEl.textContent = e.message || "Unable to sign in";
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign in";
  }
});

document.getElementById("logout-btn").addEventListener("click", logout);

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => navigate(btn.dataset.page));
});

window.addEventListener("hashchange", () => {
  const page = location.hash.replace("#", "");
  if (page && page !== state.page) navigate(page);
});

(async function init() {
  if (state.token) {
    try {
      await loadSession();
      return;
    } catch (e) {
      // token invalid/expired — fall through to login screen
    }
  }
  document.getElementById("login-screen").classList.remove("hidden");
})();
