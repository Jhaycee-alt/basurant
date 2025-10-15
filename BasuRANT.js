// Extracted JS from BasuRANT.html
// 1) Tab functionality + DOMContentLoaded admin view handling
(function(){
    // Tab click handler
    function setupTabs(){
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', function() {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

                this.classList.add('active');
                const tabId = this.getAttribute('data-tab');
                const target = document.getElementById(`${tabId}-tab`);
                if (target) target.classList.add('active');
            });
        });
    }

    // Ensure admin view is visible on load (fallback)
    document.addEventListener('DOMContentLoaded', function() {
        const adminView = document.getElementById('admin-view');
        if (adminView) {
            adminView.style.display = 'block';
        }
        setupTabs();
    });
})();

// UI helpers: place left navbar below header and keep it fixed
(function navbarPositioning(){
    function adjust() {
        const header = document.querySelector('header');
        const leftNav = document.querySelector('.left-navbar');
        if (!leftNav) return;
        const top = header ? header.getBoundingClientRect().height : 0;
        leftNav.style.top = top + 'px';
    }
    window.addEventListener('resize', adjust);
    document.addEventListener('DOMContentLoaded', adjust);
})();

// Expose report markers renderer for map pages
(function exposeReportRenderer(){
    // Use same STORAGE_KEY as reportsModule
    const STORAGE_KEY = 'basurant_reports_v1';
    function readReports(){ try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch(e){ return []; } }

    // Provide function on window so history page can call it with its map
    window.renderReportsOnMap = function(map){
        if (!map || !window.L) return;
        const reports = readReports();
        // If a report doesn't have coordinates, we won't show it; optionally you can geocode or set defaults
        reports.forEach(r => {
            if (r.lat && r.lng) {
                const color = r.status === 'cleaned' ? '#9E9E9E' : (r.size === 'small' ? '#86B882' : r.size === 'medium' ? '#FFC107' : '#F44336');
                const marker = L.circleMarker([r.lat, r.lng], { radius: r.size === 'small' ? 6 : r.size === 'medium' ? 9 : 12, color:'#fff', weight:2, fillColor: color, fillOpacity:0.9 }).addTo(map);
                marker.bindPopup(`<strong>${r.type}</strong><br>${r.size}<br>${new Date(r.createdAt).toLocaleString()}<br>${r.description || ''}`);
            }
        });
    };
    // Expose a helper to get local reports (async) for chart fallbacks
    window.getLocalReports = async function() {
        try {
            const v = localStorage.getItem(STORAGE_KEY);
            if (v) return JSON.parse(v);
        } catch(e) { /* ignore */ }
        try {
            const idb = await (async function openIdbForWindow(){
                if (!window.indexedDB) return null;
                return new Promise((resolve) => {
                    const req = indexedDB.open('basurant', 1);
                    req.onupgradeneeded = function(e){ try { e.target.result.createObjectStore('kv'); } catch(e){} };
                    req.onsuccess = e => resolve(e.target.result);
                    req.onerror = () => resolve(null);
                });
            })();
            if (!idb) return [];
            return await new Promise((resolve) => {
                try {
                    const tx = idb.transaction('kv','readonly');
                    const store = tx.objectStore('kv');
                    const req = store.get(STORAGE_KEY);
                    req.onsuccess = () => resolve(req.result || []);
                    req.onerror = () => resolve([]);
                } catch(e) { resolve([]); }
            });
        } catch(e) { return []; }
    };
})();

// Report storage + rendering utilities
(function reportsModule(){
    const STORAGE_KEY = 'basurant_reports_v1';
    // IndexedDB fallback helpers (async). Uses a single DB 'basurant' and store 'kv'.
    function openIdb() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) return resolve(null);
            const req = indexedDB.open('basurant', 1);
            req.onupgradeneeded = function(e) {
                try { e.target.result.createObjectStore('kv'); } catch (err) { /* ignore if exists */ }
            };
            req.onsuccess = function(e) { resolve(e.target.result); };
            req.onerror = function(e) { resolve(null); };
        });
    }
    async function idbGet(key) {
        const db = await openIdb();
        if (!db) return null;
        return new Promise((resolve) => {
            try {
                const tx = db.transaction('kv', 'readonly');
                const store = tx.objectStore('kv');
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
                req.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        });
    }
    async function idbSet(key, value) {
        const db = await openIdb();
        if (!db) return false;
        return new Promise((resolve) => {
            try {
                const tx = db.transaction('kv', 'readwrite');
                const store = tx.objectStore('kv');
                const req = store.put(value, key);
                req.onsuccess = () => resolve(true);
                req.onerror = () => resolve(false);
            } catch (e) { resolve(false); }
        });
    }

    // Read from localStorage first, then fallback to IndexedDB if present
    function readReports(){
        try { const v = localStorage.getItem(STORAGE_KEY); if (v) return JSON.parse(v); }
        catch(e){ console.warn('localStorage read failed, falling back to IndexedDB', e); }
        try {
            // synchronous wrapper for async idbGet: return [] if unavailable (caller expects sync)
            // We'll attempt to read from IndexedDB synchronously if possible via blocking async call pattern
            // but since we cannot block, return [] and schedule a background refresh via window.fetchReportsFromFirestore in other flows.
            // To keep behavior consistent, try to return cached value from idb via a Promise.then if caller supports async; otherwise return [].
            var result = [];
            idbGet(STORAGE_KEY).then(v => { try { if (v) { /* no-op: this can be used by future async flows */ } } catch(e){} });
            return result;
        } catch(e){ return []; }
    }

    // Try writing to localStorage, but fall back to IndexedDB when quota exceeded or localStorage unavailable.
    function writeReports(list){
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(list || []));
            return true;
        } catch(e) {
            console.warn('localStorage write failed, attempting trimmed saves', e);
            // Attempt trimmed saves to localStorage first
            try {
                const trimmed = (list || []).map(({video, ...rest}) => rest);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
                return true;
            } catch(e2) {
                try {
                    const trimmed2 = (list || []).map(({video, photo, ...rest}) => rest);
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed2));
                    return true;
                } catch(e3) {
                    console.warn('localStorage trimming failed, falling back to IndexedDB', e3);
                    // Fallback to IndexedDB (async). Schedule save and optimistically return true.
                    try {
                        idbSet(STORAGE_KEY, list || []).then(ok => { if (!ok) console.error('IndexedDB save failed'); });
                        return true;
                    } catch(e4) {
                        console.error('Failed to save reports after trimming and IndexedDB fallback', e4);
                        return false;
                    }
                }
            }
        }
    }

    // small helper to read a file input as data URL
    function fileToDataURL(file){
        return new Promise((resolve, reject) => {
            if (!file) return resolve(null);
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // Form submit handler on report page
    document.addEventListener('DOMContentLoaded', function(){
        const form = document.getElementById('report-form');
        if (form) {
            form.addEventListener('submit', async function(e){
                e.preventDefault();
                const type = document.getElementById('waste-type')?.value || 'General waste';
                const size = document.querySelector('input[name="size"]:checked')?.value || 'small';
                const desc = document.getElementById('description')?.value || '';
                const photoFile = document.getElementById('photo')?.files?.[0];
                const videoFile = document.getElementById('video')?.files?.[0];

                // required photo check
                if (!photoFile) {
                    alert('Please add a photo of the dumpsite.');
                    return;
                }

                const photoData = await fileToDataURL(photoFile);
                const videoData = videoFile ? await fileToDataURL(videoFile) : null;

                // Try to get geolocation (optional). If available, attach to report.
                function saveWithCoords(coords){
                    const reports = readReports();
                    const id = 'R-' + Date.now();
                    const item = {
                        id, type, size, description: desc, photo: photoData, video: videoData, status: 'pending', createdAt: new Date().toISOString(), lat: coords?.lat, lng: coords?.lng
                    };
                    reports.unshift(item);
                    const saved = writeReports(reports);
                    if (!saved) {
                        alert('Could not save report to local storage. Media may be too large or storage quota exceeded. The report was NOT saved.');
                    }
                    // redirect to history page after submit
                    window.location.href = './history.html';
                }

                if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(function(pos){
                        saveWithCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                    }, function(){
                        // user denied or failed - save without coords
                        saveWithCoords(null);
                    }, { timeout: 5000 });
                } else {
                    saveWithCoords(null);
                }
            });
        }

        // Render reports on history page
        const listEl = document.getElementById('reports-list');
        if (listEl) {
            const reports = readReports();
            if (reports.length === 0) {
                listEl.innerHTML = '<p>No reports yet. Use the Report page to submit one.</p>';
            } else {
                listEl.innerHTML = reports.map(r => {
                    return `
                        <article class="report-card" style="margin-bottom:14px; padding:12px; border:1px solid #e6e6e6; border-radius:8px; background:white;">
                            <div style="display:flex; gap:12px; align-items:flex-start;">
                                <div style="width:120px; flex-shrink:0;"><img src="${r.photo}" style="width:100%; border-radius:6px;" alt="report photo"></div>
                                <div>
                                    <strong>${r.type} — ${r.size}</strong>
                                    <div style="font-size:0.9em; color:#666; margin-top:6px">${new Date(r.createdAt).toLocaleString()}</div>
                                    <p style="margin-top:8px">${r.description || ''}</p>
                                    <div style="margin-top:8px; font-size:0.9em; color:#666">Status: ${r.status}</div>
                                </div>
                            </div>
                        </article>
                    `;
                }).join('\n');
            }
        }

        // Render reports into admin reports table (in `BasuRANT.html`)
        const reportsTableBody = document.querySelector('#reports-management-tab tbody');
        if (reportsTableBody) {
            const reports = readReports();
            // Prepend into table as rows
            const rowsHtml = reports.map(r => {
                return `<tr>
                    <td>${r.id}</td>
                    <td>${new Date(r.createdAt).toLocaleString()}</td>
                    <td>N/A</td>
                    <td>${r.type}</td>
                    <td style="color:#2196F3;">${r.status}</td>
                    <td>
                        <button style="padding:5px 10px;">View</button>
                        <button style="padding:5px 10px;">Assign</button>
                    </td>
                </tr>`;
            }).join('\n');
            if (rowsHtml) {
                // Remove placeholder rows and insert ours at top
                reportsTableBody.innerHTML = rowsHtml + reportsTableBody.innerHTML;
            }
        }
    });

})();

// 2) Investor modal wiring
(function(){
    document.addEventListener('DOMContentLoaded', function(){
        const investBtn = document.getElementById('invest-btn');
        const investorModal = document.getElementById('investor-modal');
        const closeBtn = investorModal?.querySelector('.close');
        if (investBtn && investorModal) {
            investBtn.addEventListener('click', () => investorModal.style.display = 'flex');
        }
        if (closeBtn) closeBtn.addEventListener('click', () => investorModal.style.display = 'none');
        window.addEventListener('click', function(e){ if (e.target === investorModal) investorModal.style.display = 'none'; });

        // Dummy submit handler (replace with real integration)
        const invForm = document.getElementById('invest-form');
        if (invForm) invForm.addEventListener('submit', function(e){
            e.preventDefault();
            const btn = this.querySelector('button[type="submit"]');
            if (btn) btn.textContent = 'Sent — Thank you';
            setTimeout(()=> investorModal.style.display = 'none', 1200);
        });
    });
})();

// 3) Charts loading and initialization (Chart.js dynamic load)
(function loadAndInitCharts(){
    function loadChartJs(callback) {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/chart.js';
        s.onload = callback;
        document.head.appendChild(s);
    }

    const _initializedCharts = {};
    function createCharts() {
        // For analytics, attempt to fetch live reports list from Firestore, otherwise use static sample
        async function getReportsData() {
            if (window.fetchReportsFromFirestore) {
                try { return await window.fetchReportsFromFirestore(); } catch(e){ console.warn('charts: fetchReportsFromFirestore failed', e); }
            }
            // Fallback: try to read local reports (IndexedDB or localStorage)
            try {
                if (window.getLocalReports) return await window.getLocalReports();
            } catch(e) { console.warn('charts: getLocalReports failed', e); }
            return [];
        }

        // Build and render charts from live data only (no static fallbacks)
        (async function renderCharts() {
            const list = await getReportsData();

            // Convert createdAt to Date reliably
            function toDate(createdAt) {
                if (!createdAt) return null;
                if (createdAt.seconds) return new Date(createdAt.seconds * 1000);
                const d = new Date(createdAt);
                return isNaN(d.getTime()) ? null : d;
            }

            // BAR: counts by type
            if (document.getElementById('reportsBarChart')) {
                const counts = {};
                (list||[]).forEach(r => { const k = r.type || 'Unknown'; counts[k] = (counts[k]||0) + 1; });
                const labels = Object.keys(counts);
                const data = labels.map(l => counts[l]);
                const barCtx = document.getElementById('reportsBarChart').getContext('2d');
                if (_initializedCharts.bar) _initializedCharts.bar.destroy();
                _initializedCharts.bar = new Chart(barCtx, { type:'bar', data:{ labels, datasets:[{ label:'Number of Reports', data, backgroundColor:'#86B882' }] }, options:{ responsive:true, maintainAspectRatio:false }});
            }

            // LINE: reports over last 30 days (daily)
            if (document.getElementById('reportsLineChart')) {
                const days = 30;
                const labels = [];
                const counts = {};
                for (let i = days-1; i >= 0; --i) {
                    const d = new Date(); d.setDate(d.getDate() - i);
                    const key = d.toISOString().slice(0,10);
                    labels.push(key);
                    counts[key] = 0;
                }
                (list||[]).forEach(r => {
                    const dt = toDate(r.createdAt) || new Date();
                    const key = dt.toISOString().slice(0,10);
                    if (counts[key] !== undefined) counts[key]++;
                });
                const data = labels.map(l => counts[l]);
                const lineCtx = document.getElementById('reportsLineChart').getContext('2d');
                if (_initializedCharts.line) _initializedCharts.line.destroy();
                _initializedCharts.line = new Chart(lineCtx, { type:'line', data:{ labels, datasets:[{ label:'Reports (last 30 days)', data, borderColor:'#86B882', backgroundColor:'rgba(134,184,130,0.1)', fill:true }] }, options:{ responsive:true, maintainAspectRatio:false }});
            }

            // PIE: status distribution
            if (document.getElementById('reportsPieChart')) {
                const statusCounts = {};
                (list||[]).forEach(r => { const s = r.status || 'unknown'; statusCounts[s] = (statusCounts[s]||0) + 1; });
                const labels = Object.keys(statusCounts);
                const data = labels.map(l => statusCounts[l]);
                const colors = ['#FFC107','#86B882','#2196F3','#9E9E9E','#F44336'];
                const pieCtx = document.getElementById('reportsPieChart').getContext('2d');
                if (_initializedCharts.pie) _initializedCharts.pie.destroy();
                _initializedCharts.pie = new Chart(pieCtx, { type:'pie', data:{ labels, datasets:[{ data, backgroundColor: colors.slice(0, labels.length) }] }, options:{ responsive:true, maintainAspectRatio:false }});
            }

            // DOUGHNUT: size distribution (small/medium/large)
            if (document.getElementById('reportsDoughnutChart')) {
                const sizeCounts = {};
                (list||[]).forEach(r => { const s = r.size || 'unknown'; sizeCounts[s] = (sizeCounts[s]||0) + 1; });
                const labels = Object.keys(sizeCounts);
                const data = labels.map(l => sizeCounts[l]);
                const doughCtx = document.getElementById('reportsDoughnutChart').getContext('2d');
                if (_initializedCharts.doughnut) _initializedCharts.doughnut.destroy();
                _initializedCharts.doughnut = new Chart(doughCtx, { type:'doughnut', data:{ labels, datasets:[{ data, backgroundColor: ['#86B882','#FFC107','#2196F3','#F44336'] }] }, options:{ responsive:true, maintainAspectRatio:false }});
            }

            // STACKED: monthly status counts for last 6 months
            if (document.getElementById('reportsStackedBarChart')) {
                const months = 6;
                const monthLabels = [];
                const monthKeys = [];
                const now = new Date();
                for (let i = months-1; i >= 0; --i) {
                    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                    const label = d.toLocaleString(undefined, { month: 'short', year: 'numeric' });
                    monthLabels.push(label);
                    monthKeys.push(d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'));
                }
                const statuses = [...new Set((list||[]).map(r => r.status || 'unknown'))];
                const series = statuses.map(s => ({ label: s, data: monthKeys.map(() => 0) }));
                (list||[]).forEach(r => {
                    const dt = toDate(r.createdAt) || new Date();
                    const key = dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0');
                    const mi = monthKeys.indexOf(key);
                    if (mi >= 0) {
                        const si = statuses.indexOf(r.status || 'unknown');
                        if (si >= 0) series[si].data[mi]++;
                    }
                });
                const stackedCtx = document.getElementById('reportsStackedBarChart').getContext('2d');
                if (_initializedCharts.stacked) _initializedCharts.stacked.destroy();
                _initializedCharts.stacked = new Chart(stackedCtx, { type:'bar', data:{ labels: monthLabels, datasets: series.map((s,i) => ({ label: s.label, data: s.data, backgroundColor: ['#86B882','#FFC107','#F44336','#2196F3','#9E9E9E'][i % 5] })) }, options:{ responsive:true, maintainAspectRatio:false, scales:{ x:{ stacked:true }, y:{ stacked:true } } }});
            }
        })();
    }

    loadChartJs(function() {
        // render charts when analytics tab is active
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', function() {
                const tabId = this.getAttribute('data-tab');
                if (tabId === 'analytics') {
                    setTimeout(createCharts, 50);
                }
            });
        });

        if (document.querySelector('.tab.active')?.getAttribute('data-tab') === 'analytics') {
            setTimeout(createCharts, 50);
        }
    });
})();

// 4) Leaflet admin map initialization
(function initAdminMap(){
    const reports = [
        { id: 'R-2001', lat: 16.4153, lng: 120.5970, size: 'small', type: 'Plastic waste (Burnham Park)', status: 'pending' },
        { id: 'R-2002', lat: 16.4023, lng: 120.5975, size: 'medium', type: 'Household waste (Session Road)', status: 'in_progress' },
        { id: 'R-2003', lat: 16.4209, lng: 120.5999, size: 'large', type: 'Construction debris (Mines View)', status: 'verified' },
        { id: 'R-2004', lat: 16.4010, lng: 120.5900, size: 'medium', type: 'Cleaned area (Camp John Hay)', status: 'cleaned' }
    ];

    document.addEventListener('DOMContentLoaded', function(){
        const mapEl = document.getElementById('admin-map');
        if (!mapEl) return;

        const map = L.map('admin-map', { preferCanvas: true }).setView([16.4023, 120.5960], 13);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);

        function markerColor(r) {
            if (r.status === 'cleaned') return '#9E9E9E';
            if (r.size === 'small') return '#86B882';
            if (r.size === 'medium') return '#FFC107';
            return '#F44336';
        }

        // Helper to add marker to map if coords present
        function addReportMarker(r) {
            if (!r || !r.lat || !r.lng) return;
            const circle = L.circleMarker([r.lat, r.lng], {
                radius: r.size === 'small' ? 6 : r.size === 'medium' ? 9 : 12,
                color: '#ffffff',
                weight: 2,
                fillColor: markerColor(r),
                fillOpacity: 0.9
            }).addTo(map);
            const popupHtml = `<strong>${r.id || ''}</strong><br>${r.type || ''}<br>Status: ${r.status || ''}` + (r.photoUrl ? `<br><img src="${r.photoUrl}" style="width:120px; display:block; margin-top:6px;">` : '');
            circle.bindPopup(popupHtml);
        }

        // Function to refresh markers from a list
        function refreshMarkers(list) {
            // remove existing markers (quick way: re-create map layer by clearing all layers except tile layer)
            map.eachLayer(layer => {
                if (layer instanceof L.TileLayer) return; // keep tiles
                map.removeLayer(layer);
            });
            if (!Array.isArray(list) || list.length === 0) return;
            list.forEach(r => addReportMarker(r));
        }

        // If Firestore helper exists, use it to fetch live reports; otherwise fallback to sample reports
        async function loadReportsForAdmin(filter) {
            try {
                if (window.fetchReportsFromFirestore) {
                    const list = await window.fetchReportsFromFirestore();
                    let filtered = list;
                    if (filter === 'pending') filtered = list.filter(x => x.status === 'pending');
                    if (filter === 'verified') filtered = list.filter(x => x.status === 'verified');
                    refreshMarkers(filtered);
                    populateReportsTable(list);
                    updateStatsFromReports(list);
                    return;
                }
            } catch(err){ console.error('Error fetching reports from Firestore', err); }
            // fallback
            refreshMarkers(reports);
            populateReportsTable(reports);
            updateStatsFromReports(reports);
        }

        // initial load
        loadReportsForAdmin();

        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', function() {
                const tabId = this.getAttribute('data-tab');
                if (tabId === 'map-management') {
                    setTimeout(() => map.invalidateSize(), 120);
                }
            });
        });

        // Admin control buttons
        document.querySelectorAll('.admin-map-controls .admin-btn').forEach(btn => {
            btn.addEventListener('click', function(){
                const t = this.textContent.trim().toLowerCase();
                if (t.includes('show all')) loadReportsForAdmin();
                else if (t.includes('pending')) loadReportsForAdmin('pending');
                else if (t.includes('verified')) loadReportsForAdmin('verified');
                else if (t.includes('heatmap')) {
                    // Build a combined list of remote + local reports and render them with a heat-style marker.
                    (async function(){
                        let combined = [];
                        try {
                            if (window.fetchReportsFromFirestore) {
                                const remote = await window.fetchReportsFromFirestore().catch(()=>[]);
                                if (Array.isArray(remote)) combined = combined.concat(remote);
                            }
                        } catch(e) { console.debug('heatmap remote fetch failed', e); }
                        try {
                            if (window.getLocalReports) {
                                const local = await window.getLocalReports().catch(()=>[]);
                                if (Array.isArray(local)) combined = combined.concat(local);
                            }
                        } catch(e) { console.debug('heatmap local fetch failed', e); }
                        // Normalize and mark as heat for slightly larger radii
                        refreshMarkers(combined.map(r => ({ ...r, _heat: true })));
                    })();
                } else if (t.includes('export')) {
                    if (window.exportReportsToCSV) {
                        window.exportReportsToCSV().then(csv => {
                            const blob = new Blob([csv], { type: 'text/csv' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url; a.download = 'reports_export.csv'; a.click();
                            URL.revokeObjectURL(url);
                        }).catch(err => console.error('Export failed', err));
                    } else {
                        alert('Export not available in fallback mode.');
                    }
                }
            });
        });

        if (document.querySelector('.tab.active')?.getAttribute('data-tab') === 'map-management') {
            setTimeout(() => map.invalidateSize(), 120);
        }
    });
})();

// Helper to populate the reports table in the Reports Management tab
function populateReportsTable(list) {
    try {
        const tbody = document.querySelector('#reports-management-tab tbody');
        if (!tbody) return;
        const rowsHtml = (list || []).map(r => {
            const created = r.createdAt && r.createdAt.seconds ? new Date(r.createdAt.seconds*1000).toLocaleString() : (r.createdAt || '');
            return `<tr data-id="${r.id||r.id}">
                <td>${r.id||''}</td>
                <td>${created}</td>
                <td>${(r.lat && r.lng) ? (r.lat.toFixed(4)+', '+r.lng.toFixed(4)) : 'N/A'}</td>
                <td>${r.type||''}</td>
                <td style="color:#2196F3;">${r.status||''}</td>
                <td>
                    <button class="view-btn" style="padding:5px 10px;">View</button>
                    <button class="assign-btn" style="padding:5px 10px;">Assign</button>
                    <button class="verify-btn" style="padding:5px 10px;">Verify</button>
                </td>
            </tr>`;
        }).join('\n');
        tbody.innerHTML = rowsHtml + tbody.innerHTML;

        // Wire up buttons
        tbody.querySelectorAll('button.view-btn').forEach(b => b.addEventListener('click', function(){
            const id = this.closest('tr')?.getAttribute('data-id');
            // open popup by id on admin map (simple zoom)
            alert('View report: ' + id);
        }));
        tbody.querySelectorAll('button.assign-btn').forEach(b => b.addEventListener('click', async function(){
            const id = this.closest('tr')?.getAttribute('data-id');
            const ok = confirm('Assign this report to crew?');
            if (!ok) return;
            if (window.updateReport) {
                const res = await window.updateReport(id, { status: 'in_progress' });
                if (res) alert('Assigned');
            } else alert('Assign API not available');
        }));
        tbody.querySelectorAll('button.verify-btn').forEach(b => b.addEventListener('click', async function(){
            const id = this.closest('tr')?.getAttribute('data-id');
            const ok = confirm('Mark this report as verified?');
            if (!ok) return;
            if (window.updateReport) {
                const res = await window.updateReport(id, { status: 'verified' });
                if (res) alert('Marked verified');
            } else alert('Verify API not available');
        }));
    } catch(e) { console.error('populateReportsTable error', e); }
}

// Small stats calculator from reports list — updates dashboard cards
function updateStatsFromReports(list) {
    try {
        const total = (list || []).length;
        const pending = (list || []).filter(r => r.status === 'pending').length;
        const inProgress = (list || []).filter(r => r.status === 'in_progress').length;
        const cleaned = (list || []).filter(r => r.status === 'cleaned').length;
        document.querySelectorAll('.dashboard-stats .stat-card').forEach(card => {
            if (card.querySelector('h3')?.textContent?.includes('Total')) card.querySelector('p').textContent = total;
            if (card.querySelector('h3')?.textContent?.includes('Pending')) card.querySelector('p').textContent = pending;
            if (card.querySelector('h3')?.textContent?.includes('In Progress')) card.querySelector('p').textContent = inProgress;
            if (card.querySelector('h3')?.textContent?.includes('Cleaned')) card.querySelector('p').textContent = cleaned;
        });
    } catch(e) { console.error('updateStatsFromReports error', e); }
}

// Fetch reports from Firestore (or fallback) and update dashboard stats
async function fetchAndUpdateStats() {
    try {
        let list = [];
        if (window.fetchReportsFromFirestore) {
            list = await window.fetchReportsFromFirestore();
        }
        updateStatsFromReports(list || []);
    } catch (err) {
        console.error('fetchAndUpdateStats error', err);
        updateStatsFromReports([]);
    }
}

// Run on initial load and when dashboard tab becomes active
document.addEventListener('DOMContentLoaded', function(){
    fetchAndUpdateStats();
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', function(){
            if (this.getAttribute('data-tab') === 'dashboard') {
                setTimeout(fetchAndUpdateStats, 50);
            }
        });
    });
});

// 5) Login page handlers (guest and admin modal)
(function setupLoginHandlers(){
    document.addEventListener('DOMContentLoaded', function(){
        const adminBtn = document.getElementById('admin-btn');
        const adminModal = document.getElementById('admin-modal');
        const adminClose = document.getElementById('admin-close');
        const adminForm = document.getElementById('admin-login-form');
        const adminError = document.getElementById('admin-error');

        if (adminBtn && adminModal) {
            adminBtn.addEventListener('click', function(){
                adminModal.style.display = 'flex';
                adminModal.setAttribute('aria-hidden', 'false');
            });
        }

        if (adminClose && adminModal) {
            adminClose.addEventListener('click', function(){
                adminModal.style.display = 'none';
                adminModal.setAttribute('aria-hidden', 'true');
                if (adminError) adminError.style.display = 'none';
            });
        }

        if (adminForm) {
            adminForm.addEventListener('submit', function(e){
                e.preventDefault();
                const email = document.getElementById('admin-email')?.value?.trim();
                const pass = document.getElementById('admin-password')?.value || '';

                // Demo check: replace with real auth (Firebase/Backend) later
                if (email === 'admin@example.com' && pass === 'password') {
                    // success — proceed to app (could set a session flag)
                    window.location.href = './BasuRANT.html';
                } else {
                    if (adminError) {
                        adminError.textContent = 'Invalid admin credentials.';
                        adminError.style.display = 'block';
                    }
                }
            });
        }
    });
})();
