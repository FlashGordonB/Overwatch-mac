const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");

function readEnv(name, fallback) {
  const value = process.env[name];
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

const PORT = Number.parseInt(readEnv("PORT", "3010"), 10);
const HOST = readEnv("HOST", "127.0.0.1");
const PUBLIC_ORIGIN = readEnv("PUBLIC_ORIGIN", "https://spin.bownsfam.app");
const ROOT = path.join(__dirname, "src");
const HERO_CACHE_DIR = path.join(ROOT, "assets", "hero-cache");
const ALLOWED_HOSTS = new Set(["overwatch.blizzard.com"]);
const ALLOWED_IMAGE_HOSTS = new Set(["d15f34w2p8l1cc.cloudfront.net"]);
const sseClients = new Set();
const heroThumbCache = new Map();
const liveState = {
  roll: 1,
  statId: null,
  statLabel: null,
  updatedAt: Date.now()
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

fs.mkdirSync(HERO_CACHE_DIR, { recursive: true });

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (data.length > 1_000_000) {
        reject(new Error("Payload too large."));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function broadcastLiveState() {
  const payload = `data: ${JSON.stringify(liveState)}\n\n`;
  sseClients.forEach((client) => {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  });
}

function extractPageTitle(html) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : null;
}

function decodeHtml(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeName(value) {
  return decodeHtml(String(value || ""))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

function extractDivBlock(html, startIdx) {
  const tagRegex = /<\/?div\b[^>]*>/g;
  tagRegex.lastIndex = startIdx;
  let depth = 0;
  let match;

  while ((match = tagRegex.exec(html)) !== null) {
    const token = match[0];
    if (token.startsWith("</div")) {
      depth -= 1;
      if (depth === 0) {
        return html.slice(startIdx, tagRegex.lastIndex);
      }
    } else if (token.startsWith("<div")) {
      depth += 1;
    }
  }

  return "";
}

function extractQuickPlaySection(html) {
  const startMarker = '<div class="Profile-heroSummary--view quickPlay-view';
  const endMarker = '<div class="Profile-heroSummary--view competitive-view';
  const start = html.indexOf(startMarker);
  if (start < 0) return "";

  const end = html.indexOf(endMarker, start);
  if (end < 0) return html.slice(start);
  return html.slice(start, end);
}

function parseHeroRolesFromHeroesPage(html) {
  const rolesByHeroId = {};
  const rolesByName = {};
  const heroes = [];

  const cardRegex =
    /<a class="hero-card"[^>]*\sdata-role="([^"]+)"[^>]*\sid="([^"]+)"[^>]*>[\s\S]*?<h2 slot="heading">([^<]+)<\/h2>/g;
  let cardMatch;

  while ((cardMatch = cardRegex.exec(html)) !== null) {
    const role = cardMatch[1].trim().toLowerCase();
    const heroId = decodeHtml(cardMatch[2].trim().toLowerCase());
    const displayName = decodeHtml(cardMatch[3].trim());
    const key = normalizeName(displayName);

    rolesByHeroId[heroId] = role;
    if (key) {
      rolesByName[key] = role;
    }
    heroes.push({ id: heroId, name: displayName, role });
  }

  return { rolesByHeroId, rolesByName, heroes };
}

function parseTopHeroesData(html) {
  const section = extractQuickPlaySection(html);
  if (!section) {
    return { stats: [], rankingsByStatId: {} };
  }

  const optionRegex = /<option value="([^"]+)"[^>]*option-id="([^"]+)"[^>]*>([^<]+)<\/option>/g;
  const stats = [];
  let optionMatch;
  while ((optionMatch = optionRegex.exec(section)) !== null) {
    const statId = optionMatch[1];
    const label = decodeHtml(optionMatch[2] || optionMatch[3] || "");
    stats.push({ id: statId, label });
  }

  const rankingsByStatId = {};
  let scanFrom = 0;
  const progressMarker = '<div class="Profile-progressBars';

  while (true) {
    const start = section.indexOf(progressMarker, scanFrom);
    if (start < 0) break;

    const block = extractDivBlock(section, start);
    if (!block) break;

    const categoryMatch = block.match(/data-category-id="([^"]+)"/);
    const statId = categoryMatch ? categoryMatch[1] : null;
    if (statId) {
      const heroRows = [];
      const rowRegex =
        /<div class="Profile-progressBar[^"]*">[\s\S]*?<img class="Profile-progressBar--icon" src="([^"]+)"[\s\S]*?data-hero-id="([^"]+)"[\s\S]*?<div class="Profile-progressBar-title">([^<]+)<\/div>\s*<div class="Profile-progressBar-description">([^<]*)<\/div>/g;
      let rowMatch;
      while ((rowMatch = rowRegex.exec(block)) !== null) {
        heroRows.push({
          heroImage: decodeHtml(rowMatch[1].trim()),
          heroId: decodeHtml(rowMatch[2].trim().toLowerCase()),
          hero: decodeHtml(rowMatch[3].trim()),
          value: decodeHtml(rowMatch[4].trim())
        });
      }
      rankingsByStatId[statId] = heroRows;
    }

    scanFrom = start + block.length;
  }

  return { stats, rankingsByStatId };
}

function getHeroThumbCacheFilename(url, width, height) {
  const hash = crypto.createHash("sha1").update(`${url}|${width}x${height}`).digest("hex");
  return `${hash}-${width}x${height}.webp`;
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/live-stream")) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });

    res.write(`data: ${JSON.stringify(liveState)}\n\n`);
    sseClients.add(res);
    req.on("close", () => {
      sseClients.delete(res);
    });
    return;
  }

  if (req.url.startsWith("/api/live-state")) {
    if (req.method === "GET") {
      sendJson(res, 200, { ok: true, liveState });
      return;
    }

    if (req.method === "POST") {
      collectBody(req)
        .then((raw) => {
          let parsed;
          try {
            parsed = JSON.parse(raw || "{}");
          } catch {
            sendJson(res, 400, { ok: false, error: "Invalid JSON body." });
            return;
          }

          if (parsed.roll !== undefined) {
            const roll = Number.parseInt(parsed.roll, 10);
            if (Number.isInteger(roll) && roll >= 1 && roll <= 6) {
              liveState.roll = roll;
            }
          }
          if (typeof parsed.statId === "string") {
            liveState.statId = parsed.statId;
          }
          if (typeof parsed.statLabel === "string") {
            liveState.statLabel = parsed.statLabel;
          }
          liveState.updatedAt = Date.now();
          broadcastLiveState();

          sendJson(res, 200, { ok: true, liveState });
        })
        .catch((error) => {
          sendJson(res, 400, { ok: false, error: error.message });
        });
      return;
    }

    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  if (req.url.startsWith("/api/profile-access")) {
    const base = `http://${req.headers.host || `localhost:${PORT}`}`;
    const requestUrl = new URL(req.url, base);
    const target = requestUrl.searchParams.get("url");

    if (!target) {
      sendJson(res, 400, { ok: false, error: "Missing query parameter: url" });
      return;
    }

    let parsedTarget;
    try {
      parsedTarget = new URL(target);
    } catch {
      sendJson(res, 400, { ok: false, error: "Invalid URL format." });
      return;
    }

    if (!["http:", "https:"].includes(parsedTarget.protocol)) {
      sendJson(res, 400, { ok: false, error: "Only http/https URLs are allowed." });
      return;
    }

    if (!ALLOWED_HOSTS.has(parsedTarget.hostname)) {
      sendJson(res, 403, {
        ok: false,
        error: `Host not allowed. Allowed hosts: ${Array.from(ALLOWED_HOSTS).join(", ")}`
      });
      return;
    }

    fetch(parsedTarget.toString(), {
      method: "GET",
      headers: {
        "User-Agent": "party-character-spinner/1.0"
      },
      redirect: "follow"
    })
      .then(async (response) => {
        const body = await response.text();
        const snippet = body.replace(/\s+/g, " ").slice(0, 240);
        sendJson(res, 200, {
          ok: true,
          targetUrl: parsedTarget.toString(),
          finalUrl: response.url,
          status: response.status,
          statusText: response.statusText,
          contentType: response.headers.get("content-type"),
          title: extractPageTitle(body),
          bodySnippet: snippet
        });
      })
      .catch((error) => {
        sendJson(res, 502, {
          ok: false,
          targetUrl: parsedTarget.toString(),
          error: error.message
        });
      });
    return;
  }

  if (req.url.startsWith("/api/hero-thumb")) {
    const base = `http://${req.headers.host || `localhost:${PORT}`}`;
    const requestUrl = new URL(req.url, base);
    const target = requestUrl.searchParams.get("url");
    const width = Math.max(16, Math.min(128, Number.parseInt(requestUrl.searchParams.get("w") || "48", 10)));
    const height = Math.max(16, Math.min(128, Number.parseInt(requestUrl.searchParams.get("h") || "48", 10)));

    if (!target) {
      sendJson(res, 400, { ok: false, error: "Missing query parameter: url" });
      return;
    }

    let parsedTarget;
    try {
      parsedTarget = new URL(target);
    } catch {
      sendJson(res, 400, { ok: false, error: "Invalid URL format." });
      return;
    }

    if (!["http:", "https:"].includes(parsedTarget.protocol)) {
      sendJson(res, 400, { ok: false, error: "Only http/https URLs are allowed." });
      return;
    }
    if (!ALLOWED_IMAGE_HOSTS.has(parsedTarget.hostname)) {
      sendJson(res, 403, {
        ok: false,
        error: `Image host not allowed. Allowed hosts: ${Array.from(ALLOWED_IMAGE_HOSTS).join(", ")}`
      });
      return;
    }

    const cacheKey = `${parsedTarget.toString()}|${width}x${height}`;
    const diskCachePath = path.join(
      HERO_CACHE_DIR,
      getHeroThumbCacheFilename(parsedTarget.toString(), width, height)
    );
    const cached = heroThumbCache.get(cacheKey);
    if (cached) {
      res.writeHead(200, {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable"
      });
      res.end(cached);
      return;
    }

    fs.promises
      .readFile(diskCachePath)
      .then((diskBuffer) => {
        if (heroThumbCache.size > 600) {
          const firstKey = heroThumbCache.keys().next().value;
          heroThumbCache.delete(firstKey);
        }
        heroThumbCache.set(cacheKey, diskBuffer);
        res.writeHead(200, {
          "Content-Type": "image/webp",
          "Cache-Control": "public, max-age=31536000, immutable"
        });
        res.end(diskBuffer);
      })
      .catch(async () => {
        try {
          const response = await fetch(parsedTarget.toString(), {
            method: "GET",
            headers: { "User-Agent": "party-character-spinner/1.0" }
          });
          if (!response.ok) {
            sendJson(res, 502, { ok: false, error: `Upstream image failed: ${response.status}` });
            return;
          }

          const imageBuffer = Buffer.from(await response.arrayBuffer());
          const thumbBuffer = await sharp(imageBuffer)
            .resize(width, height, { fit: "cover", position: "attention" })
            .webp({ quality: 62 })
            .toBuffer();

          await fs.promises.writeFile(diskCachePath, thumbBuffer);

          if (heroThumbCache.size > 600) {
            const firstKey = heroThumbCache.keys().next().value;
            heroThumbCache.delete(firstKey);
          }
          heroThumbCache.set(cacheKey, thumbBuffer);

          res.writeHead(200, {
            "Content-Type": "image/webp",
            "Cache-Control": "public, max-age=31536000, immutable"
          });
          res.end(thumbBuffer);
        } catch (error) {
          sendJson(res, 502, { ok: false, error: error.message });
        }
      });
    return;
  }

  if (req.url.startsWith("/api/profile-top-heroes")) {
    const base = `http://${req.headers.host || `localhost:${PORT}`}`;
    const requestUrl = new URL(req.url, base);
    const target = requestUrl.searchParams.get("url");

    if (!target) {
      sendJson(res, 400, { ok: false, error: "Missing query parameter: url" });
      return;
    }

    let parsedTarget;
    try {
      parsedTarget = new URL(target);
    } catch {
      sendJson(res, 400, { ok: false, error: "Invalid URL format." });
      return;
    }

    if (!["http:", "https:"].includes(parsedTarget.protocol)) {
      sendJson(res, 400, { ok: false, error: "Only http/https URLs are allowed." });
      return;
    }

    if (!ALLOWED_HOSTS.has(parsedTarget.hostname)) {
      sendJson(res, 403, {
        ok: false,
        error: `Host not allowed. Allowed hosts: ${Array.from(ALLOWED_HOSTS).join(", ")}`
      });
      return;
    }

    fetch(parsedTarget.toString(), {
      method: "GET",
      headers: {
        "User-Agent": "party-character-spinner/1.0"
      },
      redirect: "follow"
    })
      .then(async (response) => {
        const body = await response.text();
        const parsed = parseTopHeroesData(body);

        let heroRoleData = { rolesByHeroId: {}, rolesByName: {}, heroes: [] };
        try {
          const heroesResponse = await fetch("https://overwatch.blizzard.com/en-us/heroes/", {
            method: "GET",
            headers: { "User-Agent": "party-character-spinner/1.0" },
            redirect: "follow"
          });
          const heroesHtml = await heroesResponse.text();
          heroRoleData = parseHeroRolesFromHeroesPage(heroesHtml);
        } catch {
          // Keep processing without role data if this fetch fails.
        }

        const normalizedStats = parsed.stats.filter((stat) =>
          Array.isArray(parsed.rankingsByStatId[stat.id]) && parsed.rankingsByStatId[stat.id].length > 0
        );

        const rankingsByStatId = {};
        normalizedStats.forEach((stat) => {
          rankingsByStatId[stat.id] = parsed.rankingsByStatId[stat.id].map((entry) => {
            const roleById = heroRoleData.rolesByHeroId[entry.heroId];
            const roleByName = heroRoleData.rolesByName[normalizeName(entry.hero)];
            return {
              ...entry,
              role: roleById || roleByName || "unknown"
            };
          });
        });

        sendJson(res, 200, {
          ok: true,
          targetUrl: parsedTarget.toString(),
          finalUrl: response.url,
          status: response.status,
          stats: normalizedStats,
          rankingsByStatId,
          heroesByRole: heroRoleData.heroes.reduce(
            (acc, hero) => {
              if (hero.role === "tank") acc.tank.push(hero);
              else if (hero.role === "damage") acc.damage.push(hero);
              else if (hero.role === "support") acc.support.push(hero);
              return acc;
            },
            { tank: [], damage: [], support: [] }
          )
        });
      })
      .catch((error) => {
        sendJson(res, 502, {
          ok: false,
          targetUrl: parsedTarget.toString(),
          error: error.message
        });
      });
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  let cleanPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  if (cleanPath === "/host") cleanPath = "/host.html";
  if (cleanPath === "/view") cleanPath = "/view.html";
  const safePath = path.normalize(cleanPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT, safePath);
  sendFile(res, filePath);
});

server.listen(PORT, HOST, () => {
  console.log(`Spinner app running on ${HOST}:${PORT}`);
  console.log(`Host view: ${PUBLIC_ORIGIN}/host`);
  console.log(`Viewer view: ${PUBLIC_ORIGIN}/view`);
});
