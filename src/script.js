import DiceBox from "./vendor/dice-box/dice-box.es.js";

const DEFAULT_PROFILES = [
  {
    name: "Flash",
    url: "https://overwatch.blizzard.com/en-us/career/d452ad99bb3ccaf9bea927%7C437063a46c16b6df52a8fd16ba6925b8/"
  },
  {
    name: "Xeonight",
    url: "https://overwatch.blizzard.com/en-us/career/ca51a9a4ba7693b9a4a126a6d3%7Cb2cb4008d354768ed6aa50603edc9db8/"
  },
  {
    name: "KingKeeper",
    url: "https://overwatch.blizzard.com/en-us/career/d957a28d98749ebdece23aa1d306a1%7Cee5edd39d3eade2954fb59085aff7bab/"
  },
  {
    name: "Alylynn",
    url: "https://overwatch.blizzard.com/en-us/career/f352b586aa7f95e0b8a520a6%7C441eae4bff62ad65418e7aa7082fd18c/"
  },
  {
    name: "Makeshift",
    url: "https://overwatch.blizzard.com/en-us/career/df5fa78f807992abfda922bdd505a608%7C4dabfe9bef32707e920acc11d23033f6/"
  }
];

const ROLES = ["tank", "damage", "support"];
const mode = document.body.dataset.mode === "view" ? "view" : "host";
const isViewer = mode === "view";
const STATIC_STATS = [
  { id: "0x0860000000000021", label: "Time Played" },
  { id: "0x0860000000000039", label: "Games Won" },
  { id: "0x08600000000003D1", label: "Win Percentage" },
  { id: "0x08600000000001BB", label: "Weapon Accuracy - Best in Game" },
  { id: "0x08600000000003D2", label: "Eliminations per Life" },
  { id: "0x0860000000000223", label: "Kill Streak - Best" },
  { id: "0x0860000000000346", label: "Multikill - Best" },
  { id: "0x08600000000004D4", label: "Eliminations - Avg per 10 Min" },
  { id: "0x08600000000004D3", label: "Deaths - Avg per 10 Min" },
  { id: "0x08600000000004D5", label: "Final Blows - Avg per 10 Min" },
  { id: "0x08600000000004DA", label: "Solo Kills - Avg per 10 Min" },
  { id: "0x08600000000004D8", label: "Objective Kills - Avg per 10 Min" },
  { id: "0x08600000000004D9", label: "Objective Time - Avg per 10 Min" },
  { id: "0x08600000000004BD", label: "Hero Damage Done - Avg per 10 Min" },
  { id: "0x08600000000004D6", label: "Healing Done - Avg per 10 Min" }
];

const statWheelEl = document.getElementById("statWheel");
const statResultEl = document.getElementById("statResult");
const runRoundBtn = document.getElementById("runRoundBtn");
const dice3dEl = document.getElementById("dice3d");
const diceResultEl = document.getElementById("diceResult");
const reloadAllBtn = document.getElementById("reloadAllBtn");
const profilesGridEl = document.getElementById("profilesGrid");
const accessOutputEl = document.getElementById("accessOutput");

const appState = {
  profiles: loadProfilesFromStorage(),
  stats: [...STATIC_STATS],
  selectedStatId: STATIC_STATS[0].id,
  selectedStatLabel: STATIC_STATS[0].label,
  statRotation: 0,
  selectedRoll: 1,
  diceBox: null,
  diceReady: false,
  liveStream: null,
  diceDisplayEl: null,
  diceDisplayValueEl: null
};

renderProfileColumns();
drawWheel(
  statWheelEl,
  appState.stats.map((s) => s.label),
  makePalette("#2e6b6b", "#83c4b8", appState.stats.length)
);
initDiceDisplay();
updateDiceDisplay(appState.selectedRoll);
diceResultEl.textContent = String(appState.selectedRoll);
statResultEl.textContent = appState.selectedStatLabel;
initDiceBox();

runRoundBtn.addEventListener("click", () => {
  if (isViewer) return;
  runRound();
});

reloadAllBtn.addEventListener("click", () => {
  if (isViewer) return;
  loadAllProfiles();
});

loadAllProfiles();
if (isViewer) {
  setupViewerMode();
}

function loadProfilesFromStorage() {
  try {
    const saved = JSON.parse(localStorage.getItem("partySpinnerProfiles"));
    if (Array.isArray(saved) && saved.length === 5) {
      const hydrated = saved.map((p, index) => ({
        name: DEFAULT_PROFILES[index].name,
        url: p.url || DEFAULT_PROFILES[index].url || "",
        status: "Waiting to load...",
        data: null,
        error: null
      }));

      return hydrated;
    }
  } catch (error) {
    console.warn("Could not parse saved profiles", error);
  }

  return DEFAULT_PROFILES.map((p) => ({
    ...p,
    status: "Waiting to load...",
    data: null,
    error: null
  }));
}

function saveProfilesToStorage() {
  const raw = appState.profiles.map((p) => ({ name: p.name, url: p.url }));
  localStorage.setItem("partySpinnerProfiles", JSON.stringify(raw));
}

function renderProfileColumns() {
  profilesGridEl.innerHTML = "";

  appState.profiles.forEach((profile, index) => {
    const card = document.createElement("article");
    card.className = "profile-column";
    card.innerHTML = `
      <h4>${escapeHtml(profile.name)}</h4>
      <p class="profile-status" id="status-${index}">${escapeHtml(profile.status)}</p>
      <div class="role-result role-tank">
        <h5><img src="./assets/ow/role-tank.svg" alt="" />Tank</h5>
        <div class="hero-line" id="result-${index}-tank"></div>
      </div>
      <div class="role-result role-damage">
        <h5><img src="./assets/ow/role-damage.svg" alt="" />Damage</h5>
        <div class="hero-line" id="result-${index}-damage"></div>
      </div>
      <div class="role-result role-support">
        <h5><img src="./assets/ow/role-support.svg" alt="" />Support</h5>
        <div class="hero-line" id="result-${index}-support"></div>
      </div>
    `;

    profilesGridEl.appendChild(card);
  });
}

async function loadAllProfiles() {
  setTopButtonsDisabled(true);
  reloadAllBtn.disabled = true;
  setDebugText("Loading all profile stats...");

  const jobs = appState.profiles.map(async (profile, index) => {
    if (!profile.url) {
      profile.data = null;
      profile.error = null;
      profile.status = "No URL set.";
      setProfileStatus(index, profile.status);
      clearRoleLines(index, "No URL");
      return;
    }

    profile.status = "Loading...";
    setProfileStatus(index, profile.status);
    clearRoleLines(index, "Loading...");

    try {
      const response = await fetch(
        `/api/profile-top-heroes?url=${encodeURIComponent(profile.url)}`
      );
      const payload = await response.json();
      if (!payload.ok) {
        throw new Error(payload.error || "Failed to load profile data.");
      }

      profile.data = payload;
      profile.error = null;
      profile.status = `Loaded (${payload.stats.length} stats)`;
      setProfileStatus(index, profile.status);
    } catch (error) {
      profile.data = null;
      profile.error = error.message;
      profile.status = `Error: ${error.message}`;
      setProfileStatus(index, profile.status);
      clearRoleLines(index, "Error");
    }
  });

  await Promise.all(jobs);
  saveProfilesToStorage();

  drawWheel(
    statWheelEl,
    appState.stats.map((s) => s.label),
    makePalette("#2e6b6b", "#83c4b8", appState.stats.length)
  );
  statWheelEl.style.transform = "rotate(0deg)";
  appState.statRotation = 0;

  const summary = appState.profiles.map((p, i) => ({
    column: i + 1,
    name: p.name,
    loaded: Boolean(p.data),
    status: p.status
  }));
  setDebugText(JSON.stringify(summary, null, 2));

  setTopButtonsDisabled(false);
  reloadAllBtn.disabled = false;
  renderAllResults();
  publishLiveState();
}

function renderAllResults() {
  appState.profiles.forEach((profile, index) => {
    if (!profile.data || !appState.selectedStatId) {
      clearRoleLines(index, "No data");
      return;
    }

    const rows = profile.data.rankingsByStatId[appState.selectedStatId] || [];
    ROLES.forEach((role) => {
      const filtered = rows.filter((row) => row.role === role);
      const ranks = getRoleRanksForRoll(role, appState.selectedRoll);
      const hits = ranks.map((rank) => ({
        rank,
        entry: filtered[rank - 1] || null
      }));
      renderRoleLine(index, role, hits, filtered.length);
    });
  });
}

function renderRoleLine(profileIndex, role, hits, countForRole) {
  const line = document.getElementById(`result-${profileIndex}-${role}`);
  if (!line) return;

  const hasAny = hits.some((h) => h.entry);
  if (!hasAny) {
    line.innerHTML = `
      <div>
        <div class="hero-name">No result</div>
        <div class="hero-meta">Only ${countForRole} ${role} heroes in this stat list</div>
      </div>
    `;
    return;
  }

  line.innerHTML = hits
    .map(({ rank, entry }) => {
      if (!entry) {
        return `
          <div class="hero-slot">
            <div class="hero-name">No #${rank}</div>
            <div class="hero-meta">${capitalize(role)} rank unavailable</div>
          </div>
        `;
      }

      const imageHtml = entry.heroImage
        ? `<img src="/api/hero-thumb?url=${encodeURIComponent(entry.heroImage)}&w=48&h=48" alt="${escapeHtml(
            entry.hero
          )}" loading="lazy" decoding="async" />`
        : `<img alt="" />`;
      const statValueHtml = entry.value
        ? `<div class="hero-stat-value" title="${escapeHtml(appState.selectedStatLabel || "Stat value")}">${escapeHtml(
            entry.value
          )}</div>`
        : "";

      return `
        <div class="hero-slot">
          ${imageHtml}
          <div class="hero-copy">
            <div class="hero-name">${escapeHtml(entry.hero)}</div>
            <div class="hero-meta">#${rank} ${capitalize(role)} for ${escapeHtml(
              appState.selectedStatLabel || "-"
            )}</div>
          </div>
          ${statValueHtml}
        </div>
      `;
    })
    .join("");
}

function clearRoleLines(profileIndex, message) {
  ROLES.forEach((role) => {
    const line = document.getElementById(`result-${profileIndex}-${role}`);
    if (!line) return;
    line.innerHTML = `
      <div>
        <div class="hero-name">${escapeHtml(message)}</div>
      </div>
    `;
  });
}

function setProfileStatus(profileIndex, text) {
  const el = document.getElementById(`status-${profileIndex}`);
  if (!el) return;
  el.textContent = `${appState.profiles[profileIndex].name}: ${text}`;
}

async function initDiceBox() {
  try {
    const box = new DiceBox({
      container: "#dice3d",
      assetPath: "/vendor/dice-box/assets/",
      theme: "default",
      scale: 18,
      gravity: 1,
      throwForce: 5.5,
      spinForce: 6
    });
    await box.init();
    appState.diceBox = box;
    appState.diceReady = true;
  } catch (error) {
    appState.diceReady = false;
    setDebugText(`3D dice unavailable, fallback enabled: ${error.message}`);
  }
}

async function rollD6() {
  try {
    let value = null;
    if (appState.diceReady && appState.diceBox) {
      const results = await appState.diceBox.roll("1d6");
      value = extractRollValue(results);
    }
    if (!Number.isInteger(value) || value < 1 || value > 6) {
      value = randInt(1, 6);
    }

    appState.selectedRoll = value;
    diceResultEl.textContent = String(value);
    updateDiceDisplay(value, { animate: true });
    renderAllResults();
  } catch (error) {
    const fallback = randInt(1, 6);
    appState.selectedRoll = fallback;
    diceResultEl.textContent = String(fallback);
    updateDiceDisplay(fallback, { animate: true });
    renderAllResults();
    setDebugText(`3D roll error, used fallback: ${error.message}`);
  }
}

function spinStatOnce() {
  return new Promise((resolve) => {
    if (!appState.stats.length) {
      resolve();
      return;
    }

    spinWheel(
      statWheelEl,
      appState.stats.map((s) => s.label),
      (selectedIndex) => {
        const stat = appState.stats[selectedIndex];
        appState.selectedStatId = stat.id;
        appState.selectedStatLabel = stat.label;
        statResultEl.textContent = stat.label;
        renderAllResults();
        resolve();
      }
    );
  });
}

async function runRound() {
  if (!appState.stats.length) {
    setDebugText("No stats loaded yet. Reload profiles first.");
    return;
  }

  setTopButtonsDisabled(true);
  try {
    await Promise.all([rollD6(), spinStatOnce()]);
    publishLiveState();
  } finally {
    setTopButtonsDisabled(false);
  }
}

function extractRollValue(results) {
  if (typeof results === "number") return Math.floor(results);
  if (!results) return null;

  if (Array.isArray(results)) {
    for (const item of results) {
      const direct = extractRollValue(item);
      if (Number.isInteger(direct)) return direct;
    }
    return null;
  }

  if (typeof results === "object") {
    if (Number.isFinite(results.value)) {
      return Math.round(results.value);
    }
    if (Array.isArray(results.rollsArray)) {
      const numeric = results.rollsArray
        .map((r) => (Number.isFinite(r == null ? void 0 : r.value) ? Number(r.value) : null))
        .filter((n) => n !== null);
      if (numeric.length) {
        return Math.round(numeric[0]);
      }
    }
  }

  return null;
}

function setDebugText(text) {
  if (accessOutputEl) {
    accessOutputEl.textContent = text;
  }
}

function setupViewerMode() {
  runRoundBtn.disabled = true;
  reloadAllBtn.disabled = true;
  runRoundBtn.textContent = "Host Controlled";
  reloadAllBtn.textContent = "Viewer Mode";

  fetch("/api/live-state")
    .then((res) => res.json())
    .then((payload) => {
      if (payload && payload.ok && payload.liveState) {
        applyLiveState(payload.liveState);
      }
    })
    .catch(() => {});

  const stream = new EventSource("/api/live-stream");
  stream.onmessage = (event) => {
    try {
      const incoming = JSON.parse(event.data);
      applyLiveState(incoming);
    } catch {
      // ignore malformed event
    }
  };
  appState.liveStream = stream;
}

function applyLiveState(incoming) {
  if (!incoming) return;

  if (Number.isInteger(incoming.roll) && incoming.roll >= 1 && incoming.roll <= 6) {
    const rollChanged = incoming.roll !== appState.selectedRoll;
    appState.selectedRoll = incoming.roll;
    diceResultEl.textContent = String(incoming.roll);
    updateDiceDisplay(incoming.roll, { animate: rollChanged });
    if (isViewer) {
      nudgeDiceIntoView();
    }
  }

  if (typeof incoming.statId === "string") {
    const stat = appState.stats.find((s) => s.id === incoming.statId);
    if (stat) {
      appState.selectedStatId = stat.id;
      appState.selectedStatLabel = stat.label;
      statResultEl.textContent = stat.label;
    } else if (typeof incoming.statLabel === "string") {
      appState.selectedStatId = incoming.statId;
      appState.selectedStatLabel = incoming.statLabel;
      statResultEl.textContent = incoming.statLabel;
    }
  } else if (typeof incoming.statLabel === "string") {
    appState.selectedStatLabel = incoming.statLabel;
    statResultEl.textContent = incoming.statLabel;
  }

  renderAllResults();
}

function nudgeDiceIntoView() {
  if (!dice3dEl) return;
  dice3dEl.classList.remove("dice-stage-ping");
  void dice3dEl.offsetWidth;
  dice3dEl.classList.add("dice-stage-ping");

  if (window.innerWidth <= 700) {
    dice3dEl.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function initDiceDisplay() {
  if (!dice3dEl) return;

  dice3dEl.innerHTML = `
    <div class="dice-display" aria-hidden="true">
      <div class="dice-cube">
        <div class="dice-face dice-face-front"><span class="dice-pips" data-face="1"></span></div>
        <div class="dice-face dice-face-back"><span class="dice-pips" data-face="6"></span></div>
        <div class="dice-face dice-face-right"><span class="dice-pips" data-face="3"></span></div>
        <div class="dice-face dice-face-left"><span class="dice-pips" data-face="4"></span></div>
        <div class="dice-face dice-face-top"><span class="dice-pips" data-face="5"></span></div>
        <div class="dice-face dice-face-bottom"><span class="dice-pips" data-face="2"></span></div>
      </div>
      <div class="dice-display-value">1</div>
    </div>
  `;

  appState.diceDisplayEl = dice3dEl.querySelector(".dice-display");
  appState.diceDisplayValueEl = dice3dEl.querySelector(".dice-display-value");
}

function updateDiceDisplay(value, { animate = false } = {}) {
  if (!appState.diceDisplayEl || !appState.diceDisplayValueEl) {
    return;
  }

  appState.diceDisplayEl.dataset.value = String(value);
  appState.diceDisplayValueEl.textContent = String(value);
  if (animate) {
    appState.diceDisplayEl.classList.remove("dice-display-roll");
    void appState.diceDisplayEl.offsetWidth;
    appState.diceDisplayEl.classList.add("dice-display-roll");
  }
}

function publishLiveState() {
  if (isViewer) return;
  const payload = {
    roll: appState.selectedRoll,
    statId: appState.selectedStatId,
    statLabel: appState.selectedStatLabel
  };

  fetch("/api/live-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).catch(() => {});
}

function spinWheel(canvas, values, onFinish) {
  if (!values.length) return;
  setTopButtonsDisabled(true);

  const currentRotation = appState.statRotation;
  const extraSpins = 5 * 360;
  const randomAngle = Math.random() * 360;
  const newRotation = currentRotation + extraSpins + randomAngle;
  const normalized = ((newRotation % 360) + 360) % 360;
  const segmentAngle = 360 / values.length;
  const selectedIndex = Math.floor(((360 - normalized) % 360) / segmentAngle);

  canvas.style.transform = `rotate(${newRotation}deg)`;

  window.setTimeout(() => {
    appState.statRotation = newRotation;
    onFinish(selectedIndex);
    setTopButtonsDisabled(false);
  }, 4200);
}

function drawWheel(canvas, labels, colors) {
  const ctx = canvas.getContext("2d");
  const center = canvas.width / 2;
  const radius = center - 6;
  const segment = (2 * Math.PI) / labels.length;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(center, center);

  labels.forEach((label, index) => {
    const start = index * segment - Math.PI / 2;
    const end = start + segment;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = colors[index % colors.length];
    ctx.fill();
    ctx.strokeStyle = "#f5f5f5";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    ctx.rotate(start + segment / 2);
    ctx.fillStyle = "#1f2933";
    ctx.font = labels.length > 12 ? "12px sans-serif" : "bold 16px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const maxLen = labels.length > 10 ? 18 : 24;
    const display = label.length > maxLen ? `${label.slice(0, maxLen - 3)}...` : label;
    ctx.fillText(display, radius - 12, 0);
    ctx.restore();
  });

  ctx.beginPath();
  ctx.arc(0, 0, 18, 0, 2 * Math.PI);
  ctx.fillStyle = "#1f2933";
  ctx.fill();
  ctx.restore();
}

function setTopButtonsDisabled(disabled) {
  runRoundBtn.disabled = disabled;
}

function getRoleRanksForRoll(role, roll) {
  if (role === "support" || role === "damage") {
    if (roll <= 1) return [1, 2];
    return [roll, Math.max(1, roll - 1)];
  }
  return [roll];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function makePalette(startColor, endColor, steps) {
  const from = hexToRgb(startColor);
  const to = hexToRgb(endColor);
  const palette = [];
  for (let i = 0; i < steps; i += 1) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const r = Math.round(from.r + (to.r - from.r) * t);
    const g = Math.round(from.g + (to.g - from.g) * t);
    const b = Math.round(from.b + (to.b - from.b) * t);
    palette.push(`rgb(${r}, ${g}, ${b})`);
  }
  return palette;
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const num = Number.parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}
