// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js";
import { getDatabase, ref, get } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCSEqyxRcUDCN0JhUaoHj6wgvu2qjg1gBk",
  authDomain: "basuhero-6687c.firebaseapp.com",
  projectId: "basuhero-6687c",
  databaseURL: "https://basuhero-6687c-default-rtdb.asia-southeast1.firebasedatabase.app",
  storageBucket: "basuhero-6687c.firebasestorage.app",
  messagingSenderId: "381669972902",
  appId: "1:381669972902:web:accd33feb498e59c040d67",
  measurementId: "G-L5RJ0NBSBG"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const database = getDatabase(app);
(function(){
  console.debug('history-script loaded');

  const REPORTS_API_ENDPOINTS = [
    '/api/reports',
    'http://localhost:3000/api/reports',
    'http://localhost:3001/api/reports'
  ];
  

  // Run main when DOM is ready so elements like #history-map exist
  function main() {
    console.debug('history main start');
    // init map centered on Baguio City
    // Ensure header height is reflected in CSS variable so map height calculation is correct
    function computeHeaderHeight() {
      try {
          const header = document.querySelector('header');
          if (!header) return;
          // include computed height (padding/border) for accurate map offset
          const h = Math.ceil(header.getBoundingClientRect().height + (parseInt(getComputedStyle(header).paddingBottom||0)));
        document.documentElement.style.setProperty('--header-height', h + 'px');
        // Also set explicit height for the history map container so Leaflet can size correctly
        try {
          const mapEl = document.getElementById('history-map');
          if (mapEl) mapEl.style.height = `calc(100vh - ${h}px)`;
        } catch(e) { /* ignore */ }
      } catch (e) { console.debug('computeHeaderHeight failed', e); }
    }
    // Run initially and on resize
    computeHeaderHeight();
    window.addEventListener('resize', () => { computeHeaderHeight(); if (map) try { map.invalidateSize(); } catch(e){} });

    const COMPLETED_STATUS_KEYS = new Set(['cleaned','clean','cleaned-up','done','resolved','fixed']);
    const ONGOING_STATUS_KEYS = new Set([
      'ongoing',
      'in-progress',
      'inprogress',
      'assigned',
      'working',
      'active'
    ]);
    const STATUS_COLORS = { cleaned: '#16a34a', ongoing: '#f59e0b', pending: '#9E9E9E' };
    function normalizeStatusKey(status) {
      try { return (status || '').toString().trim().toLowerCase().replace(/[\s_]+/g, '-'); } catch(e) { return ''; }
    }
    function isCompletedStatus(status) {
      return COMPLETED_STATUS_KEYS.has(normalizeStatusKey(status));
    }
    function isOngoingStatus(status) {
      return ONGOING_STATUS_KEYS.has(normalizeStatusKey(status));
    }
    function getCanonicalStatus(status) {
      const key = normalizeStatusKey(status);
      if (COMPLETED_STATUS_KEYS.has(key)) return 'cleaned';
      if (ONGOING_STATUS_KEYS.has(key)) return 'ongoing';
      if (key === 'verified') return 'pending';
      return 'pending';
    }

    async function fetchReportsFromJsonApi() {
      for (const endpoint of REPORTS_API_ENDPOINTS) {
        try {
          const response = await fetch(endpoint, { method: 'GET' });
          if (!response.ok) continue;
          const payload = await response.json();
          const reports = Array.isArray(payload?.reports) ? payload.reports : [];
          return reports;
        } catch (e) {
          console.debug('fetchReportsFromJsonApi failed at', endpoint, e);
        }
      }
      return [];
    }

    async function fetchReportsFromRTDB() {
      try {
        const snapshot = await get(ref(database, 'reports'));
        if (!snapshot.exists()) return [];
        const value = snapshot.val();
        if (!value || typeof value !== 'object') return [];
        return Object.values(value).filter(Boolean);
      } catch (e) {
        console.debug('fetchReportsFromRTDB failed', e);
        return [];
      }
    }

    let map;
    try {
      map = L.map('history-map').setView([16.4023, 120.5960], 13);
      // expose map for other modules (allow showReportDetails to update marker styles)
      try { window.__history_map = map; } catch(e) {}
      console.debug('Leaflet map created', !!map);
    } catch (err) {
      console.error('Failed to create Leaflet map', err);
      throw err;
    }
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    // Create a shared reports layer — prefer marker clustering when available
    function createClusterLayer(map) {
      try {
        if (window.L && typeof L.markerClusterGroup === 'function') {
          const grp = L.markerClusterGroup({
            maxClusterRadius: 60,
            disableClusteringAtZoom: 17,
            spiderfyOnMaxZoom: true,
            zoomToBoundsOnClick: true,
            showCoverageOnHover: false
          });
          // when a cluster is clicked, show a detail banner listing contained reports
          try {
            grp.on('clusterclick', function(ev){
              try {
                const markers = ev.layer.getAllChildMarkers ? ev.layer.getAllChildMarkers() : [];
                const reports = markers.map(m => m.report).filter(Boolean);
                showClusterBanner(reports);
              } catch(e) { console.debug('cluster click handler failed', e); }
            });
          } catch(e) { console.debug('cluster banner attach failed', e); }
          return grp;
        }
      } catch(e) { console.debug('createClusterLayer check failed', e); }
      return L.layerGroup();
    }

    // --- Marker sizing helpers (scale icons by zoom) ---
    function computeScaledSize(base) {
      // base: original small/medium/large base radius
      // We want icons to be ~20px larger at default, and scale with zoom so
      // they become larger when zoomed out and smaller when zoomed in.
      try {
        const zoom = (map && typeof map.getZoom === 'function') ? map.getZoom() : 13;
        // zoom reference: 13 is our typical city-level zoom. Use an exponential scale factor.
        const zoomDelta = 13 - zoom; // positive when zoomed out
        const zoomFactor = Math.pow(1.12, zoomDelta); // ~12% change per zoom level
        const size = Math.max(4, Math.round((base + 20) * zoomFactor));
        return size;
      } catch (e) { return base + 20; }
    }

    function createDivIconFor(base, color) {
      const size = computeScaledSize(base);
      const html = `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 2px rgba(0,0,0,0.2)"></div>`;
      return L.divIcon({ html: html, className: '', iconSize: [size, size], iconAnchor: [Math.round(size/2), Math.round(size/2)] });
    }

    function updateMarkerIcon(marker) {
      try {
        if (!marker) return;
        const base = marker.__basurant_base || 6;
        const color = marker.__basurant_color || '#16A34A';
        const newIcon = createDivIconFor(base, color);
        marker.setIcon(newIcon);
      } catch (e) { console.debug('updateMarkerIcon failed', e); }
    }

    function refreshAllMarkerIcons() {
      try {
        if (!reportsLayer || typeof reportsLayer.getLayers !== 'function') return;
        const layers = reportsLayer.getLayers();
        layers.forEach(m => { try { updateMarkerIcon(m); } catch(e){} });
      } catch (e) { console.debug('refreshAllMarkerIcons failed', e); }
    }

    // Refresh icons when zoom changes
    try { map.on && map.on('zoomend', function(){ try { refreshAllMarkerIcons(); } catch(e){} }); } catch(e) {}
  // Expose a safe global hook so other scripts (loaded earlier) can request icon refreshes
  try { window.__updateBasurantMarkerIcon = updateMarkerIcon; window.__refreshBasurantMarkerIcons = refreshAllMarkerIcons; } catch(e) {}

    // Cluster details banner: render into the static HTML container so designers can edit markup in `history.html`
    function showClusterBanner(reports) {
      try {
        console.debug('showClusterBanner called, reports count:', Array.isArray(reports) ? reports.length : typeof reports);
        const banner = document.getElementById('cluster-details-banner');
        if (!banner) return; // static markup expected in history.html

        // If no reports, hide the banner
        if (!Array.isArray(reports) || reports.length === 0) {
          banner.classList.add('hidden');
          return;
        }

        // Populate header count
        const countEl = document.getElementById('cluster-details-count');
        if (countEl) countEl.textContent = `${reports.length} report${reports.length > 1 ? 's' : ''}`;

        // Render list
        const list = document.getElementById('cluster-details-list');
        if (!list) return;
        list.innerHTML = '';
        reports.slice(0,50).forEach((r, idx) => {
          try {
            const row = document.createElement('div');
            row.className = 'flex items-center gap-3 p-2 border-b last:border-b-0';

            const dot = document.createElement('div');
            dot.className = 'w-2.5 h-2.5 rounded-full flex-shrink-0';
            const statusKey = getCanonicalStatus(r && r.status);
            const color = STATUS_COLORS[statusKey] || (r.size === 'small' ? '#16A34A' : r.size === 'medium' ? '#FFC107' : '#9E9E9E');
            dot.style.background = color;

            const meta = document.createElement('div');
            meta.className = 'flex-1';
            const title = document.createElement('div'); title.className = 'font-medium'; title.textContent = r.type || 'Report';
            const desc = document.createElement('div'); desc.className = 'text-xs text-gray-500'; desc.textContent = (r.description || '').slice(0, 100);
            meta.appendChild(title); meta.appendChild(desc);

            const openBtn = document.createElement('button');
            openBtn.className = 'p-1.5 w-8 h-8 bg-indigo-600 text-white rounded-md text-xs hover:bg-indigo-500 focus:outline-none flex items-center justify-center';
            openBtn.dataset.idx = String(idx);
            openBtn.setAttribute('title', 'View details');
            openBtn.setAttribute('aria-label', 'View details');
            // eye icon (Heroicons outline view) + hidden text for screen readers
            // clearer outline eye icon (stroke-based) so users recognize it as "view"
            openBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
              + '<path d="M2.759 12.524C4.749 8.34 8.7 6 12 6c3.3 0 7.25 2.34 9.241 6.524a2.25 2.25 0 010 1.952C19.25 17.66 15.3 20 12 20c-3.3 0-7.25-2.34-9.241-6.524a2.25 2.25 0 010-1.952z"></path>'
              + '<circle cx="12" cy="12" r="3"></circle>'
              + '</svg><span class="sr-only">View</span>';
            openBtn.addEventListener('click', function(){
              try { if (typeof window.showReportDetails === 'function') window.showReportDetails(reports[Number(this.dataset.idx)]); }
              catch(e) { console.debug('open report from cluster failed', e); }
            });

            row.appendChild(dot); row.appendChild(meta); row.appendChild(openBtn);
            list.appendChild(row);
          } catch(e) { console.debug('cluster list row failed', e); }
        });

        // Wire close button (replace handler to avoid duplicates)
        const closeBtn = document.getElementById('cluster-details-close');
        if (closeBtn) closeBtn.onclick = function(){ banner.classList.add('hidden'); };

        banner.classList.remove('hidden');
      } catch(e) { console.debug('showClusterBanner failed', e); }
    }
    // Invalidate size after initial creation so Leaflet uses the correct container dimensions
    setTimeout(() => { try { computeHeaderHeight(); map.invalidateSize(); } catch(e) { console.debug('map invalidate failed', e); } }, 120);

    // (removed temporary test marker) — map is now clean on load

  // Provide a lightweight `showReportDetails` helper on the history page so
  // marker clicks and the "View" buttons can open the modal.
  try {
    if (!window.showReportDetails) {
      window.showReportDetails = async function(reportOrId) {
        try {
          if (!reportOrId) return;
          let report = null;
          if (typeof reportOrId === 'object') report = reportOrId;
          else if (typeof reportOrId === 'string' || typeof reportOrId === 'number') {
            const id = String(reportOrId);
            // try stored in-memory lists or marker map
            try { if (window.__admin_reports && Array.isArray(window.__admin_reports)) report = window.__admin_reports.find(r=>String(r.id||r.reportId||r._id)===id) || null; } catch(e){}
            try { if (!report && window.__reportMarkers && window.__reportMarkers[id]) report = window.__reportMarkers[id].report || null; } catch(e){}
            // finally try RTDB then reports.json API
            if (!report) {
              try {
                const rtdbReports = await fetchReportsFromRTDB();
                report = rtdbReports.find(r => String(r?.id || r?.reportId || r?._id) === id) || null;
              } catch(e) { console.debug('showReportDetails RTDB lookup failed', e); }
            }

            if (!report) {
              try {
                const apiReports = await fetchReportsFromJsonApi();
                report = apiReports.find(r => String(r?.id || r?.reportId || r?._id) === id) || null;
              } catch(e) { console.debug('showReportDetails API lookup failed', e); }
            }
          }

          if (!report) {
            console.debug && console.debug('showReportDetails: report not found', reportOrId);
          }

          if (!report) return;

          const setText = (id, val) => { try { const el = document.getElementById(id); if (el) el.textContent = val || ''; } catch(e){} };
          setText('rv-id', report.id || report.reportId || report._id || '');
          setText('rv-type', report.type || '');
          setText('rv-size', report.size || '');
          setText('rv-status', report.status || '');
          const created = (report.createdAt && report.createdAt.seconds) ? new Date(report.createdAt.seconds*1000).toLocaleString() : (report.createdAt ? new Date(report.createdAt).toLocaleString() : '');
          setText('rv-created', created);
          setText('rv-barangay', report.barangay || report.brgy || (report.location && report.location.barangay) || '');
          setText('rv-loc', (report.lat && report.lng) ? (Number(report.lat).toFixed(6) + ', ' + Number(report.lng).toFixed(6)) : (report.location ? (report.location.lat + ', ' + report.location.lng) : ''));
          try { const desc = document.getElementById('rv-desc'); if (desc) desc.textContent = report.description || ''; } catch(e){}

          try {
            const photoEl = document.getElementById('rv-photo'); const photoDataEl = document.getElementById('rv-photo-data');
            const photoWrap = document.getElementById('rv-photo-wrap'); const photoDataWrap = document.getElementById('rv-photo-data-wrap');
              if (report.photoUrl) { if (photoEl) { photoEl.src = report.photoUrl; photoEl.style.display = ''; } if (photoDataEl) { photoDataEl.src = ''; photoDataEl.style.display = 'none'; } if (photoWrap) photoWrap.style.display = ''; if (photoDataWrap) photoDataWrap.style.display = 'none'; }
              else if (report.photoDataUrl) { if (photoDataEl) { photoDataEl.src = report.photoDataUrl; photoDataEl.style.display = ''; } if (photoEl) { photoEl.src = ''; photoEl.style.display = 'none'; } if (photoWrap) photoWrap.style.display = 'none'; if (photoDataWrap) photoDataWrap.style.display = ''; }
            else { if (photoEl) photoEl.style.display = 'none'; if (photoDataEl) photoDataEl.style.display = 'none'; }
            const videoLink = document.getElementById('rv-video'); if (videoLink) { if (report.videoUrl) { videoLink.href = report.videoUrl; videoLink.style.display = ''; } else { videoLink.href = '#'; videoLink.style.display = 'none'; } }
          } catch(e) { console.debug('showReportDetails: media render failed', e); }

          // show modal (ensure it appears above the cluster banner)
          try {
            const modal = document.getElementById('report-view-modal');
            if (modal) {
              modal.classList.remove('hidden');
              modal.style.display = 'flex';
              try { modal.style.zIndex = String((parseInt(window.getComputedStyle(document.getElementById('cluster-details-banner')?.style?.zIndex || '') || 0) || 1000000) + 10); } catch(e) { modal.style.zIndex = '1000001'; }
            }
          } catch(e) {}
        } catch(e) { console.debug('showReportDetails helper failed', e); }
      };
      // wire close button on history page if present
      try { const closeBtn = document.getElementById('close-report-view'); if (closeBtn) closeBtn.addEventListener('click', function(){ try { const modal = document.getElementById('report-view-modal'); if (modal) { modal.classList.add('hidden'); modal.style.display = 'none'; } } catch(e){} }); } catch(e) {}
    }
  } catch(e) { console.debug('history showReportDetails init failed', e); }

  // Shared reports layer (clustered when available)
  const reportsLayer = createClusterLayer(map).addTo(map);
  try { window.__reports_layer = reportsLayer; } catch(e) {}

  // Ensure markers added to the reports layer are visibly clickable and open the details modal.
  try {
    if (reportsLayer && typeof reportsLayer.on === 'function') {
      reportsLayer.on('layeradd', function(ev){
        try {
          const m = ev.layer;
          if (!m) return;
          // make the marker cursor a pointer when the element is available
          const setCursor = function(){ try { const el = (typeof m.getElement === 'function') ? m.getElement() : null; if (el && el.style) el.style.cursor = 'pointer'; } catch(e){} };
          // attempt immediately and shortly after (DOM may be created async)
          setCursor(); setTimeout(setCursor, 120);

          // Ensure clicking the marker opens the details modal when a report object is present
          try {
            m.on && m.on('click', function(){
              try {
                const rpt = m.report || (m.options && m.options.report) || null;
                if (typeof window.showReportDetails === 'function') {
                  if (rpt) return window.showReportDetails(rpt);
                  // fallback: try to use any stored report id
                  if (m.__reportId) return window.showReportDetails(m.__reportId);
                }
              } catch(e) { console.debug('reportsLayer marker click proxy failed', e); }
            });
          } catch(e) { /* ignore */ }
        } catch(e) { console.debug('reportsLayer layeradd hook failed', e); }
      });
    }
  } catch(e) { console.debug('reportsLayer on layeradd setup failed', e); }

    function renderLocalReportsOnMap(list) {
      try { if (reportsLayer && typeof reportsLayer.clearLayers === 'function') reportsLayer.clearLayers(); } catch (e) {}
      if (!Array.isArray(list) || list.length === 0) return;
      list.forEach(r => {
        if (!r) return;
        const lat = (typeof r.lat === 'string') ? parseFloat(r.lat) : r.lat;
        const lng = (typeof r.lng === 'string') ? parseFloat(r.lng) : r.lng;
        if (!isFinite(lat) || !isFinite(lng)) return;
        const size = r.size || 'small';
        const statusKey = getCanonicalStatus(r && r.status);
        const color = STATUS_COLORS[statusKey] || '#9E9E9E';
        const baseRadius = size === 'small' ? 6 : size === 'medium' ? 9 : 12;
        const icon = createDivIconFor(baseRadius, color);
        const marker = L.marker([lat, lng], { icon: icon });
        try { marker.report = r; } catch (e) {}
        try { marker.__basurant_base = baseRadius; marker.__basurant_color = color; updateMarkerIcon(marker); } catch (e) {}
        try { if (reportsLayer && typeof reportsLayer.addLayer === 'function') reportsLayer.addLayer(marker); else marker.addTo(map); } catch (e) {}
      });
    }

    (async function loadAndRenderReports(){
      try { console.debug('loadAndRenderReports reports.json API'); } catch (e) {}

      let reports = await fetchReportsFromRTDB();

      if (!Array.isArray(reports) || reports.length === 0) {
        reports = await fetchReportsFromJsonApi();
      }

      renderLocalReportsOnMap(reports);
    })();

    // If the page was opened with ?plot=id&lat=...&lng=..., add a temporary marker and center map
    function plotFromQuery() {
      try {
        const params = new URLSearchParams(window.location.search);
        const plotId = params.get('plot');
        const lat = parseFloat(params.get('lat'));
        const lng = parseFloat(params.get('lng'));
        if (plotId && !isNaN(lat) && !isNaN(lng)) {
          // small delay to ensure map is ready and tiles have loaded enough
          setTimeout(() => {
            try {
              const tmpBase = 18;
              const tmpIcon = createDivIconFor(tmpBase, '#16a34a');
              const tmp = L.marker([lat, lng], { icon: tmpIcon }).addTo(map);
              map.setView([lat, lng], 16, { animate: true });
              tmp.bindPopup(`<div style="font-weight:600">New report</div><div style="font-size:13px">ID: ${plotId}</div>`).openPopup();
              // Remove the temporary marker after 15 seconds to avoid clutter
              setTimeout(() => { try { map.removeLayer(tmp); } catch(e){} }, 15000);
            } catch(e) { console.debug('plotFromQuery failed', e); }
          }, 500);
        }
      } catch(e) { console.debug('plotFromQuery error', e); }
    }
    plotFromQuery();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }

})();
