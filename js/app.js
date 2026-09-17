"use strict";

const state = {
  hostname: "",
  targetTabId: null,
  cookies: [],
  localStorageItems: [],
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const params = new URLSearchParams(location.search);
  const tabIdParam = params.get("tabId");

  let tab;
  try {
    if (tabIdParam) {
      tab = await browser.tabs.get(parseInt(tabIdParam, 10));
    } else {
      [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    }
  } catch (e) {
    tab = null;
  }

  if (!tab) {
    document.getElementById("site-host").textContent = "No tab found.";
    return;
  }

  state.targetTabId = tab.id;
  try {
    state.hostname = new URL(tab.url).hostname;
  } catch (e) {
    state.hostname = "";
  }
  document.getElementById("site-host").textContent = state.hostname || tab.url || "Unknown page";

  const openTabBtn = document.getElementById("open-tab-btn");
  if (openTabBtn) {
    openTabBtn.addEventListener("click", () => {
      browser.tabs.create({
        url: browser.runtime.getURL("tab.html") + "?tabId=" + state.targetTabId,
      });
      window.close();
    });
  }

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  document.getElementById("delete-all-cookies").addEventListener("click", deleteAllCookies);
  document.getElementById("delete-all-storage").addEventListener("click", deleteAllStorage);

  await Promise.all([loadCookies(), loadLocalStorage()]);
}

function switchTab(name) {
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === name);
  });
  document.querySelectorAll(".panel").forEach((p) => {
    p.classList.toggle("active", p.id === "panel-" + name);
  });
}

/* ---------- Cookies ---------- */

// Mirrors Cookie Quick Manager's own domain-narrowing heuristic
// (github.com/ysard/cookie-quick-manager, cookies.js: setDefaultDomain()).
// Not a real Public Suffix List lookup - just a length heuristic to decide
// whether the last two labels are a compound suffix (e.g. "co.uk").
function getBaseDomain(hostname) {
  if (!hostname) return hostname;
  const parts = hostname.replace(/^www\./, "").split(".");
  while (parts.length > 3) {
    parts.shift();
  }
  if (parts.length === 3 && parts[1].length > 2 && parts[2].length > 2) {
    parts.shift();
  }
  return parts.join(".");
}

// A cookie is a session cookie when it has no expirationDate at all.
// Never treat those as expired, regardless of their age.
function isSessionCookie(c) {
  return typeof c.expirationDate !== "number";
}

function isExpiredCookie(c) {
  return !isSessionCookie(c) && c.expirationDate < Date.now() / 1000;
}

async function loadCookies() {
  const list = document.getElementById("cookies-list");
  if (!state.hostname) {
    list.innerHTML = '<li class="empty">No site loaded.</li>';
    document.getElementById("cookies-count").textContent = "0";
    return;
  }
  let allCookies = [];
  try {
    // Cookie Quick Manager doesn't use the API's own "domain" filter either
    // (too rigid) - it fetches everything and matches with a substring
    // check against a narrowed base domain. We do the same here.
    allCookies = await browser.cookies.getAll({});
  } catch (e) {
    list.innerHTML = '<li class="empty">Unable to read cookies for this page.</li>';
    document.getElementById("cookies-count").textContent = "0";
    return;
  }
  const baseDomain = getBaseDomain(state.hostname);
  const matched = allCookies.filter((c) => c.domain.indexOf(baseDomain) !== -1);

  // Delete expired cookies outright (not just hide them). Session cookies
  // have no expirationDate and are never considered expired, so they're
  // never touched here.
  const expired = matched.filter(isExpiredCookie);
  for (const c of expired) {
    await removeCookie(c);
  }

  const cookies = matched.filter((c) => !isExpiredCookie(c));
  cookies.sort((a, b) => a.name.localeCompare(b.name));
  state.cookies = cookies;
  renderCookies();
}

function renderCookies() {
  const list = document.getElementById("cookies-list");
  list.innerHTML = "";
  document.getElementById("cookies-count").textContent = String(state.cookies.length);

  if (state.cookies.length === 0) {
    list.innerHTML = '<li class="empty">No cookies for this site.</li>';
    return;
  }

  const frag = document.createDocumentFragment();
  state.cookies.forEach((c) => {
    frag.appendChild(buildEntryRow(c.name, c.value, () => deleteCookie(c), formatExpiry(c)));
  });
  list.appendChild(frag);
}

// Human-readable expiry label shown under each cookie's value.
function formatExpiry(c) {
  if (isSessionCookie(c)) return "Session cookie";
  const d = new Date(c.expirationDate * 1000);
  return "Expires " + d.toLocaleString();
}

async function removeCookie(c) {
  const protocol = c.secure ? "https" : "http";
  const domain = c.domain.startsWith(".") ? c.domain.substring(1) : c.domain;
  const url = protocol + "://" + domain + c.path;
  try {
    await browser.cookies.remove({ url, name: c.name, storeId: c.storeId });
  } catch (e) {
    /* ignore, list refresh reflects actual state */
  }
}

async function deleteCookie(c) {
  await removeCookie(c);
  await loadCookies();
}

async function deleteAllCookies() {
  const targets = state.cookies.slice();
  for (const c of targets) {
    await removeCookie(c);
  }
  await loadCookies();
}

/* ---------- Local storage ---------- */

async function loadLocalStorage() {
  const list = document.getElementById("storage-list");
  try {
    const results = await browser.tabs.executeScript(state.targetTabId, {
      code:
        "(() => { try { return Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]); } catch (e) { return null; } })()",
    });
    const data = results && results[0];
    if (!data) {
      list.innerHTML = '<li class="empty">Local storage is not accessible on this page.</li>';
      state.localStorageItems = [];
      document.getElementById("storage-count").textContent = "0";
      return;
    }
    data.sort((a, b) => a[0].localeCompare(b[0]));
    state.localStorageItems = data;
    renderLocalStorage();
  } catch (e) {
    list.innerHTML = '<li class="empty">Local storage is not accessible on this page.</li>';
    state.localStorageItems = [];
    document.getElementById("storage-count").textContent = "0";
  }
}

function renderLocalStorage() {
  const list = document.getElementById("storage-list");
  list.innerHTML = "";
  document.getElementById("storage-count").textContent = String(state.localStorageItems.length);

  if (state.localStorageItems.length === 0) {
    list.innerHTML = '<li class="empty">No local storage entries for this site.</li>';
    return;
  }

  const frag = document.createDocumentFragment();
  state.localStorageItems.forEach(([key, value]) => {
    frag.appendChild(buildEntryRow(key, value, () => deleteStorageItem(key)));
  });
  list.appendChild(frag);
}

async function deleteStorageItem(key) {
  try {
    await browser.tabs.executeScript(state.targetTabId, {
      code: `localStorage.removeItem(${JSON.stringify(key)});`,
    });
  } catch (e) {
    /* ignore */
  }
  await loadLocalStorage();
}

async function deleteAllStorage() {
  try {
    await browser.tabs.executeScript(state.targetTabId, {
      code: "localStorage.clear();",
    });
  } catch (e) {
    /* ignore */
  }
  await loadLocalStorage();
}

/* ---------- Shared row builder ---------- */

function buildEntryRow(name, value, onDelete, meta) {
  const li = document.createElement("li");
  li.className = "entry";

  const info = document.createElement("div");
  info.className = "entry-info";

  const nameEl = document.createElement("div");
  nameEl.className = "entry-name";
  nameEl.textContent = name;
  nameEl.title = name;

  const valueEl = document.createElement("div");
  valueEl.className = "entry-value";
  valueEl.textContent = value;
  valueEl.title = value;

  info.appendChild(nameEl);
  info.appendChild(valueEl);

  if (meta) {
    const metaEl = document.createElement("div");
    metaEl.className = "entry-meta";
    metaEl.textContent = meta;
    metaEl.title = meta;
    info.appendChild(metaEl);
  }

  const del = document.createElement("button");
  del.className = "del-btn";
  del.type = "button";
  del.title = "Delete this entry";
  del.textContent = "\u2715";
  del.addEventListener("click", onDelete);

  li.appendChild(info);
  li.appendChild(del);
  return li;
}