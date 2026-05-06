"use strict";

const API_BASE = "";

const STORAGE_KEY_USER_TAB = "rainsafe.userTab";
const STORAGE_KEY_ADMIN_TAB = "rainsafe.adminTab";
const VALID_USER_TABS = ["submit", "reports", "activity", "map"];
const VALID_ADMIN_TABS = ["reports", "analytics", "activity"];

let csrfToken = null;

function readStoredUserTab() {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY_USER_TAB);
    if (v && VALID_USER_TABS.includes(v)) return v;
  } catch (e) {
    /* ignore */
  }
  return "submit";
}

function readStoredAdminTab() {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY_ADMIN_TAB);
    if (v && VALID_ADMIN_TABS.includes(v)) return v;
  } catch (e) {
    /* ignore */
  }
  return "reports";
}

function clearDashboardTabStorage() {
  try {
    sessionStorage.removeItem(STORAGE_KEY_USER_TAB);
    sessionStorage.removeItem(STORAGE_KEY_ADMIN_TAB);
  } catch (e) {
    /* ignore */
  }
}

// Global map objects
let userSubmitMap = null;
let userReportsMap = null;
let adminReportsMap = null;
let currentMarker = null;
let userMarkers = [];
let adminMarkers = [];
let campusPolygon = null;

/** Latest user reports for the map tab (markers applied when the map is created). */
let cachedUserReports = [];

// NBSC Campus Polygon Coordinates
const campusPolygonCoords = [
  [8.361547305316519, 124.86760525452044],
  [8.361044161646763, 124.8696527571402],
  [8.35882818764747, 124.86914203737508],
  [8.359265105168815, 124.86701520908619],
  [8.361547305316519, 124.86760525452044]
];

// Center of NBSC Campus
const campusCenter = [8.36006193862642, 124.86840879895996];

// Chart objects
let severityChart = null;
let monthlyTrendsChart = null;
let topLocationsChart = null;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

async function apiRequest(path, { method = "GET", body } = {}) {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  };

  if (
    method !== "GET" &&
    method !== "HEAD" &&
    csrfToken
  ) {
    options.headers["X-CSRF-Token"] = csrfToken;
  }

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(API_BASE + path, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data && data.error ? data.error : "Request failed.";
    throw new Error(message);
  }

  return data;
}

async function apiGetSession() {
  const data = await apiRequest("auth.php?action=session", { method: "GET" });
  if (data && data.csrf_token) {
    csrfToken = data.csrf_token;
  }
  return data;
}

async function apiLogin(email, password) {
  return apiRequest("auth.php?action=login", {
    method: "POST",
    body: { email, password },
  });
}

async function apiSignup(email, password) {
  return apiRequest("auth.php?action=signup", {
    method: "POST",
    body: { email, password },
  });
}

async function apiLogout() {
  return apiRequest("auth.php?action=logout", { method: "POST" });
}

async function apiGetUserReports() {
  const data = await apiRequest("reports.php", { method: "GET" });
  return asArray(data && data.reports);
}

async function apiGetAdminReports(filters = {}) {
  const params = new URLSearchParams();
  params.set("scope", "admin");
  if (filters.severity) params.set("severity", filters.severity);

  const data = await apiRequest(
    `reports.php?${params.toString()}`,
    { method: "GET" }
  );
  return asArray(data && data.reports);
}

async function apiGetStats() {
  return apiRequest("reports.php?stats=true", { method: "GET" });
}

async function apiCreateReport(reportBody) {
  return apiRequest("reports.php", {
    method: "POST",
    body: reportBody,
  });
}

async function apiGetUserActivityLogs() {
  const data = await apiRequest("activity_logs.php", { method: "GET" });
  return asArray(data && data.logs);
}

async function apiGetAdminActivityLogs() {
  const params = new URLSearchParams();
  params.set("scope", "admin");
  const data = await apiRequest(
    `activity_logs.php?${params.toString()}`,
    { method: "GET" }
  );
  return asArray(data && data.logs);
}

// Elements
const loginView = document.getElementById("loginView");
const userDashboardView = document.getElementById("userDashboardView");
const adminDashboardView = document.getElementById("adminDashboardView");

const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const authMessage = document.getElementById("authMessage");

const reportForm = document.getElementById("reportForm");
const reportMessage = document.getElementById("reportMessage");
const userReportsList = document.getElementById("userReportsList");
const userActivityLogsList = document.getElementById("userActivityLogsList");
const userSideNav = document.getElementById("userSideNav");

const adminRefreshBtn = document.getElementById("adminRefreshBtn");
const adminTopNav = document.getElementById("adminTopNav");

// Always resolve these fresh from the DOM to avoid stale null refs
function getAdminReportsList()     { return document.getElementById("adminReportsList"); }
function getAdminSeverityFilter()  { return document.getElementById("adminSeverityFilter"); }
function getHotspotsTableBody()    { return document.querySelector("#hotspotsTable tbody"); }
function getAdminActivityLogsList(){ return document.getElementById("adminActivityLogsList"); }

const currentUserLabel = document.getElementById("currentUserLabel");
const logoutBtn = document.getElementById("logoutBtn");

const severityToggle = document.getElementById("severityToggle");
const selectedLocationCoords = document.getElementById("selectedLocationCoords");

let currentUser = null;
let selectedSeverity = "Low";

function setStatus(element, message, type = "") {
  if (!element) return;
  element.textContent = message || "";
  element.classList.remove("error", "success");
  if (type) {
    element.classList.add(type);
  }
}

function setLoading(button, isLoading, labelWhenIdle) {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = "Please wait…";
    button.disabled = true;
  } else {
    button.textContent = labelWhenIdle || button.dataset.originalLabel || "";
    button.disabled = false;
  }
}

function teardownLeafletMaps() {
  if (userSubmitMap) {
    userSubmitMap.remove();
    userSubmitMap = null;
  }
  if (userReportsMap) {
    userReportsMap.remove();
    userReportsMap = null;
  }
  if (adminReportsMap) {
    adminReportsMap.remove();
    adminReportsMap = null;
  }
  campusPolygon = null;
  currentMarker = null;
  userMarkers = [];
  adminMarkers = [];
}

function showView(view) {
  if (!loginView || !userDashboardView || !adminDashboardView) return;

  loginView.classList.add("hidden");
  userDashboardView.classList.add("hidden");
  adminDashboardView.classList.add("hidden");

  if (view === "login") {
    teardownLeafletMaps();
    loginView.classList.remove("hidden");
    currentUserLabel.classList.add("hidden");
    logoutBtn.classList.add("hidden");
  } else if (view === "user") {
    userDashboardView.classList.remove("hidden");
    currentUserLabel.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");
  } else if (view === "admin") {
    adminDashboardView.classList.remove("hidden");
    currentUserLabel.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");
  }
}

function invalidateMapWhenReady(map) {
  if (!map) return;
  requestAnimationFrame(() => {
    map.invalidateSize();
    setTimeout(() => map.invalidateSize(), 150);
  });
}

async function ensureUserSubmitMapReady() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        initUserSubmitMap();
        invalidateMapWhenReady(userSubmitMap);
        setTimeout(resolve, 50);
      });
    });
  });
}

async function ensureAdminMapReady() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        initAdminMap();
        invalidateMapWhenReady(adminReportsMap);
        setTimeout(resolve, 50);
      });
    });
  });
}

function resetSubmitTabForm() {
  if (reportForm) {
    reportForm.reset();
  }
  selectedSeverity = "Low";
  if (severityToggle) {
    Array.from(severityToggle.querySelectorAll("button")).forEach((btn) => {
      btn.classList.toggle("chip-selected", btn.dataset.value === selectedSeverity);
    });
  }
  clearSelectedLocation();
  setStatus(reportMessage, "");
}

function setUserTab(tab) {
  const previous = document
    .querySelector("[data-user-tab].side-tab-active")
    ?.getAttribute("data-user-tab");

  if (previous === "submit" && tab !== "submit") {
    resetSubmitTabForm();
  }

  const buttons = document.querySelectorAll("[data-user-tab]");
  const panels = document.querySelectorAll("[data-user-tab-panel]");

  buttons.forEach((btn) => {
    const value = btn.getAttribute("data-user-tab");
    btn.classList.toggle("side-tab-active", value === tab);
  });

  panels.forEach((panel) => {
    const value = panel.getAttribute("data-user-tab-panel");
    panel.classList.toggle("hidden", value !== tab);
  });

  if (tab === "map") {
    ensureUserReportsMap();
    updateUserMapMarkers(cachedUserReports);
    invalidateMapWhenReady(userReportsMap);
  } else if (tab === "submit" && userSubmitMap) {
    invalidateMapWhenReady(userSubmitMap);
  }

  try {
    sessionStorage.setItem(STORAGE_KEY_USER_TAB, tab);
  } catch (e) {
    /* ignore */
  }
}

function setAdminTab(tab) {
  const buttons = document.querySelectorAll("[data-admin-tab]");
  const panels = document.querySelectorAll("[data-admin-tab-panel]");

  buttons.forEach((btn) => {
    const value = btn.getAttribute("data-admin-tab");
    btn.classList.toggle("top-tab-active", value === tab);
  });

  panels.forEach((panel) => {
    const value = panel.getAttribute("data-admin-tab-panel");
    panel.classList.toggle("hidden", value !== tab);
  });

  if (tab === "analytics") {
    if (currentUser && currentUser.role === "admin") {
      loadAnalytics();
    }
  } else if (tab === "reports" && adminReportsMap) {
    invalidateMapWhenReady(adminReportsMap);
  }

  try {
    sessionStorage.setItem(STORAGE_KEY_ADMIN_TAB, tab);
  } catch (e) {
    /* ignore */
  }
}

function getSeverityClass(severity) {
  if (severity === "High") return "tag-high";
  if (severity === "Medium") return "tag-medium";
  return "tag-low";
}

function formatDateTime(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function escapeHtml(str) {
  if (str == null || str === "") return "";
  return String(str).replace(/[&<>]/g, function(m) {
    if (m === "&") return "&amp;";
    if (m === "<") return "&lt;";
    if (m === ">") return "&gt;";
    return m;
  });
}

function renderReports(listElement, reports, { showReporter = false } = {}) {
  if (!listElement) return;

  const rows = asArray(reports).filter((r) => r && typeof r === "object");

  if (rows.length === 0) {
    listElement.innerHTML =
      '<p class="muted">No reports yet. Encourage students to submit after rainfall.</p>';
    listElement.classList.add("empty-state");
    return;
  }

  listElement.classList.remove("empty-state");

  listElement.innerHTML = rows
    .map((r) => {
      const severityClass = getSeverityClass(r.severity);
      const reporterLabel =
        r.reporter_name && r.reporter_name.trim().length > 0
          ? r.reporter_name
          : "Anonymous";

      return `
      <article class="report-card">
        <div class="report-card-header">
          <div>
            <div class="report-location">${escapeHtml(r.location) || "Unknown location"}</div>
            <div class="report-tags">
              <span class="tag ${severityClass}">${r.severity} severity</span>
            </div>
          </div>
        </div>
        <div class="report-body">
          ${r.description ? escapeHtml(r.description) : "<em>No additional details provided.</em>"}
        </div>
        <div class="report-footer">
          <span>${formatDateTime(r.created_at)}</span>
          <span>${
            showReporter
              ? `Reported by: ${escapeHtml(reporterLabel)}`
              : `You reported this`
          }</span>
        </div>
      </article>
    `;
    })
    .join("");
}

function renderActivityLogs(listElement, logs, { showUser = false } = {}) {
  if (!listElement) return;

  const rows = asArray(logs).filter((r) => r && typeof r === "object");

  if (rows.length === 0) {
    listElement.innerHTML = '<p class="muted">No activity yet.</p>';
    listElement.classList.add("empty-state");
    return;
  }

  listElement.classList.remove("empty-state");

  listElement.innerHTML = rows
    .map((log) => {
      const who = showUser
        ? log.user_email || `User #${log.user_id}`
        : "";

      return `
      <article class="report-card">
        <div class="report-card-header">
          <div>
            <div class="report-location">${escapeHtml(log.action)}</div>
            ${
              who
                ? `<div class="report-tags"><span class="tag tag-muted">${escapeHtml(who)}</span></div>`
                : ""
            }
          </div>
        </div>
        <div class="report-body">
          ${log.details ? escapeHtml(log.details) : "<em>No extra details recorded.</em>"}
        </div>
        <div class="report-footer">
          <span>${formatDateTime(log.created_at)}</span>
        </div>
      </article>
    `;
    })
    .join("");
}

function groupHotspots(reports) {
  const byLocation = new Map();

  asArray(reports)
    .filter((r) => r && typeof r === "object")
    .forEach((r) => {
    const key = (r.location || "Unknown location").trim();
    if (!byLocation.has(key)) {
      byLocation.set(key, []);
    }
    byLocation.get(key).push(r);
  });

  const items = [];
  byLocation.forEach((rows, location) => {
    const reportsCount = rows.length;
    const sorted = [...rows].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
    const mostRecent = sorted[0];
    if (!mostRecent) {
      return;
    }

    items.push({
      location,
      reportsCount,
      mostRecentSeverity: mostRecent.severity,
      lastReported: mostRecent.created_at,
    });
  });

  items.sort((a, b) => b.reportsCount - a.reportsCount);
  return items;
}

function renderHotspots(reports) {
  const hotspotsTableBody = getHotspotsTableBody();
  if (!hotspotsTableBody) return;

  const hotspots = groupHotspots(reports).slice(0, 10);

  if (hotspots.length === 0) {
    hotspotsTableBody.innerHTML =
      '<tr><td colspan="4" class="muted">No data yet.</td></tr>';
    return;
  }

  hotspotsTableBody.innerHTML = hotspots
    .map(
      (h) => `
      <tr>
        <td>${escapeHtml(h.location)}</td>
        <td>${h.reportsCount}</td>
        <td>${h.mostRecentSeverity}</td>
        <td>${formatDateTime(h.lastReported)}</td>
      </tr>
    `
    )
    .join("");
}

async function loadAnalytics() {
  try {
    const stats = await apiGetStats();
    const severityStats = asArray(stats && stats.severity_stats);
    const monthlyTrends = asArray(stats && stats.monthly_trends);
    const topLocations = asArray(stats && stats.top_locations);

    if (typeof Chart === "undefined") {
      console.warn("Chart.js is not available.");
      return;
    }

    // Severity Chart
    if (severityChart) severityChart.destroy();
    const severityCanvas = document.getElementById("severityChart");
    if (severityCanvas) {
      const ctx = severityCanvas.getContext("2d");
      if (ctx) {
        severityChart = new Chart(ctx, {
          type: "pie",
          data: {
            labels: severityStats.map((s) => s.severity),
            datasets: [
              {
                data: severityStats.map((s) => s.count),
                backgroundColor: ["#22c55e", "#eab308", "#ef4444"],
              },
            ],
          },
          options: { responsive: true, maintainAspectRatio: true },
        });
      }
    }

    // Monthly Trends Chart
    if (monthlyTrendsChart) monthlyTrendsChart.destroy();
    const monthlyCanvas = document.getElementById("monthlyTrendsChart");
    if (monthlyCanvas) {
      const ctx = monthlyCanvas.getContext("2d");
      if (ctx) {
        monthlyTrendsChart = new Chart(ctx, {
          type: "line",
          data: {
            labels: stats.monthly_trends.map((t) => t.month).reverse(),
            datasets: [
              {
                label: "Reports per Month",
                data: stats.monthly_trends.map((t) => t.count).reverse(),
                borderColor: "#2563eb",
                backgroundColor: "rgba(37, 99, 235, 0.1)",
                fill: true,
              },
            ],
          },
          options: { responsive: true, maintainAspectRatio: true },
        });
      }
    }

    // Top Locations Chart
    if (topLocationsChart) topLocationsChart.destroy();
    const locationsCanvas = document.getElementById("topLocationsChart");
    if (locationsCanvas) {
      const ctx = locationsCanvas.getContext("2d");
      if (ctx) {
        topLocationsChart = new Chart(ctx, {
          type: "bar",
          data: {
            labels: topLocations.map((l) => l.location),
            datasets: [
              {
                label: "Number of Reports",
                data: topLocations.map((l) => l.count),
                backgroundColor: "#3b82f6",
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            indexAxis: "y",
          },
        });
      }
    }
  } catch (error) {
    console.error("Error loading analytics:", error);
  }
}

function addCampusTiles(map) {
  // Single-host tile URL (recommended by OSM; avoids {s} subdomain issues in some setups)
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);
}

function fixMapTiles(map) {
  if (!map || typeof map.whenReady !== "function") return;
  map.whenReady(() => {
    map.invalidateSize();
    setTimeout(() => map.invalidateSize(), 120);
    setTimeout(() => map.invalidateSize(), 450);
  });
}

function addCampusOutlineToMap(map, style) {
  const poly = L.polygon(campusPolygonCoords, style).addTo(map);
  poly.bindPopup("Northern Bukidnon State College");
  return poly;
}

/** Submit map (visible on default tab). */
function initUserSubmitMap() {
  if (userSubmitMap || !document.getElementById("userSubmitMap")) return;

  userSubmitMap = L.map("userSubmitMap", { scrollWheelZoom: true }).setView(
    campusCenter,
    18
  );
  addCampusTiles(userSubmitMap);

  campusPolygon = addCampusOutlineToMap(userSubmitMap, {
    color: "#2563eb",
    weight: 3,
    fillColor: "#3b82f6",
    fillOpacity: 0.2,
  });

  userSubmitMap.on("click", function (e) {
    placeMarker(e.latlng);
  });

  fixMapTiles(userSubmitMap);
}

/**
 * "All reports" map lives in a tab that starts hidden; init only when the tab
 * is shown so Leaflet gets a non-zero container size.
 */
function ensureUserReportsMap() {
  if (userReportsMap) {
    userReportsMap.invalidateSize();
    return;
  }
  const el = document.getElementById("userReportsMap");
  if (!el) return;

  userReportsMap = L.map("userReportsMap", { scrollWheelZoom: true }).setView(
    campusCenter,
    18
  );
  addCampusTiles(userReportsMap);

  addCampusOutlineToMap(userReportsMap, {
    color: "#2563eb",
    weight: 2,
    fillColor: "#3b82f6",
    fillOpacity: 0.1,
  });
}

function initAdminMap() {
  if (adminReportsMap || !document.getElementById("adminReportsMap")) return;

  adminReportsMap = L.map("adminReportsMap", { scrollWheelZoom: true }).setView(
    campusCenter,
    18
  );
  addCampusTiles(adminReportsMap);

  addCampusOutlineToMap(adminReportsMap, {
    color: "#2563eb",
    weight: 2,
    fillColor: "#3b82f6",
    fillOpacity: 0.1,
  });

  fixMapTiles(adminReportsMap);
}

function placeMarker(latlng) {
  if (!userSubmitMap) return;

  if (currentMarker) {
    userSubmitMap.removeLayer(currentMarker);
  }

  currentMarker = L.marker(latlng, { draggable: true }).addTo(userSubmitMap);

  currentMarker
    .bindPopup(
      `<strong>Selected Location</strong><br>
      Lat: ${latlng.lat.toFixed(6)}<br>
      Lng: ${latlng.lng.toFixed(6)}`
    )
    .openPopup();

  currentMarker.on("dragend", function (e) {
    const newPos = e.target.getLatLng();
    updateSelectedLocationDisplay(newPos.lat, newPos.lng);
  });

  updateSelectedLocationDisplay(latlng.lat, latlng.lng);
}

function updateSelectedLocationDisplay(lat, lng) {
  if (selectedLocationCoords) {
    selectedLocationCoords.innerHTML = `📍 Selected: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }
}

function clearSelectedLocation() {
  if (currentMarker && userSubmitMap) {
    userSubmitMap.removeLayer(currentMarker);
    currentMarker = null;
  }
  if (selectedLocationCoords) {
    selectedLocationCoords.innerHTML = "";
  }
}

function useMyLocation() {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by your browser");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    function (position) {
      const latlng = L.latLng(
        position.coords.latitude,
        position.coords.longitude
      );
      if (userSubmitMap) {
        userSubmitMap.setView(latlng, 18);
        placeMarker(latlng);
      }
    },
    function (error) {
      console.error("Error getting location:", error);
      alert(
        "Unable to get your location. Please check your browser permissions."
      );
    }
  );
}

function updateUserMapMarkers(reports) {
  if (!userReportsMap) return;

  userMarkers.forEach((marker) => userReportsMap.removeLayer(marker));
  userMarkers = [];

  reports.forEach((report) => {
    if (report.latitude && report.longitude) {
      const marker = L.marker([report.latitude, report.longitude])
        .bindPopup(
          `<strong>${escapeHtml(report.location)}</strong><br>
          Severity: ${report.severity}<br>
          ${report.description ? escapeHtml(report.description) : ""}<br>
          <small>${formatDateTime(report.created_at)}</small>`
        )
        .addTo(userReportsMap);
      userMarkers.push(marker);
    }
  });
}

function updateAdminMapMarkers(reports) {
  if (!adminReportsMap) return;

  adminMarkers.forEach((marker) => adminReportsMap.removeLayer(marker));
  adminMarkers = [];

  reports.forEach((report) => {
    if (report.latitude && report.longitude) {
      const markerColor = getSeverityColor(report.severity);
      const marker = L.circleMarker([report.latitude, report.longitude], {
        radius: 8,
        fillColor: markerColor,
        color: "#fff",
        weight: 2,
        opacity: 1,
        fillOpacity: 0.8,
      })
        .bindPopup(
          `<strong>${escapeHtml(report.location)}</strong><br>
          Severity: ${report.severity}<br>
          Reporter: ${escapeHtml(report.reporter_name || "Anonymous")}<br>
          ${report.description ? escapeHtml(report.description) : ""}<br>
          <small>${formatDateTime(report.created_at)}</small>`
        )
        .addTo(adminReportsMap);
      adminMarkers.push(marker);
    }
  });
}

function getSeverityColor(severity) {
  switch (severity) {
    case "High":   return "#ef4444";
    case "Medium": return "#eab308";
    default:       return "#22c55e";
  }
}

async function handleAuthChange(user) {
  currentUser = user;

  if (!user) {
    if (currentUserLabel) currentUserLabel.textContent = "";
    clearDashboardTabStorage();
    showView("login");
    return;
  }

  const role = user.role || "user";
  if (currentUserLabel) {
    currentUserLabel.textContent = `${user.email} · ${role.toUpperCase()} MODE`;
  }

  try {
    if (role === "admin") {
      showView("admin");
      setAdminTab(readStoredAdminTab());
      await ensureAdminMapReady();
      await loadAdminReports();
      await loadAdminActivityLogs();
    } else {
      showView("user");
      setUserTab(readStoredUserTab());
      await ensureUserSubmitMapReady();
      await loadUserReports();
      await loadUserActivityLogs();
    }
  } catch (err) {
    console.error("Dashboard load error:", err);
  }
}

async function loadUserReports() {
  if (!currentUser) return;

  try {
    const reports = await apiGetUserReports();
    cachedUserReports = reports;
    renderReports(userReportsList, reports, { showReporter: false });
    updateUserMapMarkers(reports);
  } catch (error) {
    console.error("Error loading user reports:", error);
    setStatus(reportMessage, "Unable to load your reports right now.", "error");
  }
}

async function loadAdminReports() {
  if (!currentUser || currentUser.role !== "admin") return;

  const reportsList    = getAdminReportsList();
  const severityFilter = getAdminSeverityFilter();
  const tableBody      = getHotspotsTableBody();

  if (!reportsList) return;

  const filters = {};
  const sev =
    severityFilter && typeof severityFilter.value === "string"
      ? severityFilter.value
      : "";
  if (sev) {
    filters.severity = sev;
  }

  try {
    const reports = await apiGetAdminReports(filters);
    renderReports(reportsList, reports, { showReporter: true });
    if (tableBody) renderHotspots(reports);
    if (adminReportsMap) updateAdminMapMarkers(reports);
  } catch (error) {
    console.error("Error loading admin reports:", error);
    renderReports(reportsList, [], { showReporter: true });
  }
}

async function loadUserActivityLogs() {
  if (!currentUser) return;

  try {
    const logs = await apiGetUserActivityLogs();
    renderActivityLogs(userActivityLogsList, logs, { showUser: false });
  } catch (error) {
    console.error("Error loading user activity logs:", error);
    renderActivityLogs(userActivityLogsList, [], { showUser: false });
  }
}

async function loadAdminActivityLogs() {
  if (!currentUser || currentUser.role !== "admin") return;

  const logsList = getAdminActivityLogsList();
  if (!logsList) return;

  try {
    const logs = await apiGetAdminActivityLogs();
    renderActivityLogs(logsList, logs, { showUser: true });
  } catch (error) {
    console.error("Error loading admin activity logs:", error);
    renderActivityLogs(logsList, [], { showUser: true });
  }
}

// ── Event wiring ──────────────────────────────────────────────────────────────

if (severityToggle) {
  severityToggle.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-value]");
    if (!button) return;

    selectedSeverity = button.dataset.value;

    Array.from(severityToggle.querySelectorAll("button")).forEach((btn) => {
      btn.classList.remove("chip-selected");
    });
    button.classList.add("chip-selected");
  });
}

if (userSideNav) {
  userSideNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-user-tab]");
    if (!button) return;
    const tab = button.getAttribute("data-user-tab");
    if (!tab) return;
    setUserTab(tab);
  });
}

if (adminTopNav) {
  adminTopNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-admin-tab]");
    if (!button) return;
    const tab = button.getAttribute("data-admin-tab");
    if (!tab) return;
    setAdminTab(tab);
  });
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus(authMessage, "");

    const email     = document.getElementById("loginEmail").value.trim();
    const password  = document.getElementById("loginPassword").value;
    const submitBtn = document.getElementById("loginSubmitBtn");
    setLoading(submitBtn, true, "Sign In");

    try {
      const { user } = await apiLogin(email, password);
      setLoading(submitBtn, false, "Sign In");
      setStatus(authMessage, "Signed in successfully.", "success");
      await handleAuthChange(user);
    } catch (error) {
      console.error("Login error:", error);
      setLoading(submitBtn, false, "Sign In");
      setStatus(
        authMessage,
        error.message || "Sign in failed. Check your email and password.",
        "error"
      );
    }
  });
}

if (signupForm) {
  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus(authMessage, "");

    const email     = document.getElementById("signupEmail").value.trim();
    const password  = document.getElementById("signupPassword").value;
    const submitBtn = document.getElementById("signupSubmitBtn");
    setLoading(submitBtn, true, "Create User Account");

    try {
      await apiSignup(email, password);
      setLoading(submitBtn, false, "Create User Account");
      setStatus(authMessage, "Account created. You can now sign in.", "success");
      signupForm.reset();
    } catch (error) {
      console.error("Signup error:", error);
      setLoading(submitBtn, false, "Create User Account");
      setStatus(
        authMessage,
        error.message ||
          "Could not create account. Use a different email or try again.",
        "error"
      );
    }
  });
}

if (reportForm) {
  reportForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentUser) {
      setStatus(reportMessage, "Please sign in again.", "error");
      return;
    }

    setStatus(reportMessage, "");

    const payload = {
      location:      document.getElementById("location").value.trim(),
      severity:      selectedSeverity,
      description:   document.getElementById("description").value.trim(),
      reporter_name: document.getElementById("reporterName").value.trim(),
    };

    if (currentMarker) {
      payload.latitude  = currentMarker.getLatLng().lat;
      payload.longitude = currentMarker.getLatLng().lng;
    }

    if (!payload.location) {
      setStatus(reportMessage, "Please enter a location name.", "error");
      return;
    }

    const submitBtn = document.getElementById("reportSubmitBtn");
    setLoading(submitBtn, true, "Submit Report");

    try {
      await apiGetSession();
      if (!csrfToken) {
        setStatus(
          reportMessage,
          "Session not ready. Please refresh the page and try again.",
          "error"
        );
        setLoading(submitBtn, false, "Submit Report");
        return;
      }
      await apiCreateReport(payload);
      setLoading(submitBtn, false, "Submit Report");

      reportForm.reset();
      selectedSeverity = "Low";
      if (severityToggle) {
        Array.from(severityToggle.querySelectorAll("button")).forEach((btn) => {
          btn.classList.toggle(
            "chip-selected",
            btn.dataset.value === selectedSeverity
          );
        });
      }

      clearSelectedLocation();
      setStatus(
        reportMessage,
        "Thank you. Your report has been recorded.",
        "success"
      );

      await loadUserReports();
      await loadUserActivityLogs();
    } catch (error) {
      console.error("Error submitting report:", error);
      setLoading(submitBtn, false, "Submit Report");
      setStatus(
        reportMessage,
        error.message || "Unable to submit report right now. Please try again.",
        "error"
      );
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await apiLogout();
    } catch (error) {
      console.error("Logout error:", error);
    }
    csrfToken = null;
    try {
      await apiGetSession();
    } catch (e) {
      console.error("Session refresh after logout:", e);
    }
    await handleAuthChange(null);
  });
}

if (adminRefreshBtn) {
  adminRefreshBtn.addEventListener("click", () => {
    if (currentUser && currentUser.role === "admin") {
      loadAdminReports();
      loadAdminActivityLogs();
    }
  });
}

// Use event delegation for the severity filter so it works even while the
// admin panel is hidden on page load (direct getElementById binding at init
// time can return the element but calling .value on a detached/hidden element
// is fine — the real historical crash was that reports.php still referenced
// hazard_type which no longer exists in the DB schema).
document.addEventListener("change", (event) => {
  if (event.target && event.target.id === "adminSeverityFilter") {
    if (currentUser && currentUser.role === "admin") {
      loadAdminReports();
    }
  }
});

document
  .getElementById("useMyLocationBtn")
  ?.addEventListener("click", useMyLocation);
document
  .getElementById("clearLocationBtn")
  ?.addEventListener("click", clearSelectedLocation);

// ── Bootstrap ─────────────────────────────────────────────────────────────────

(async function bootstrap() {
  try {
    const { user } = await apiGetSession();
    await handleAuthChange(user ?? null);
  } catch (err) {
    console.error("Error initializing session:", err);
    showView("login");
  }
})();