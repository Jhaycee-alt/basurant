const LOCAL_REPORTS_KEY = 'basurant_reports';
const LOCAL_REPORT_COUNTER_KEY = 'basurant_report_counter';

// Runtime alignment: align header to centered content only on wider screens.
// On small viewports this is counter-productive (compresses text) so we no-op.
(function () {
  function alignHeaderToContent() {
    try {
      // Don't perform pixel-perfect alignment on narrow viewports — let CSS handle it.
      if (window.innerWidth < 640) return;
      const header = document.getElementById('floating-header');
      if (!header) return;
      const inner = header.querySelector('.page-wrapper');
      const content = document.querySelector('.mx-auto.w-full.max-w-3xl.px-4') || document.querySelector('.container') || document.querySelector('main');
      if (!inner || !content) return;
      const cRect = content.getBoundingClientRect();
      header.style.left = '0';
      header.style.right = '0';
      header.style.width = '100%';
      header.style.transform = 'none';
      inner.style.marginLeft = Math.round(cRect.left) + 'px';
      inner.style.width = Math.round(cRect.width) + 'px';
      inner.style.maxWidth = 'none';
    } catch (e) { console.warn('alignHeaderToContent failed', e); }
  }
  let raf = null;
  function onResize() {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(alignHeaderToContent);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { setTimeout(alignHeaderToContent, 30); });
  } else {
    setTimeout(alignHeaderToContent, 30);
  }
  window.addEventListener('load', () => setTimeout(alignHeaderToContent, 30));
  window.addEventListener('resize', onResize);
  setTimeout(alignHeaderToContent, 300);
  setTimeout(alignHeaderToContent, 900);
})();

// Defensive fallback: ensure showLoading / hideLoading exist even if BasuRANT.js failed to load
// This prevents runtime ReferenceErrors during submit/camera flows.
if (typeof window.showLoading !== 'function') {
  window.showLoading = function (msg) {
    try {
      const mm = document.getElementById('loading-message');
      if (mm && typeof msg !== 'undefined') mm.textContent = msg;
      const o = document.getElementById('loading-overlay');
      if (o) {
        o.classList.remove('hidden');
        o.style.display = 'flex';
      }
    } catch (e) {}
  };
  window.hideLoading = function () {
    try {
      const o = document.getElementById('loading-overlay');
      if (o) {
        o.classList.add('hidden');
        o.style.display = 'none';
      }
    } catch (e) {}
  };
}

function loadLocalReports() {
  try {
    const raw = localStorage.getItem(LOCAL_REPORTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('Failed to read local reports', e);
    return [];
  }
}

function saveLocalReports(list) {
  localStorage.setItem(LOCAL_REPORTS_KEY, JSON.stringify(list));
}

// Location is requested explicitly by user action to enable mobile permission prompts before form submit.
(function setupLocationRequest() {
  const requestBtn = document.getElementById('request-location-btn');
  const statusEl = document.getElementById('location-status');

  function updateStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = isError ? '#dc2626' : '#16a34a';
  }

  async function requestLocation() {
    if (!navigator.geolocation) {
      updateStatus('Location is not available on this device.', true);
      return;
    }

    try {
      if (navigator.permissions && typeof navigator.permissions.query === 'function') {
        const permission = await navigator.permissions.query({ name: 'geolocation' });
        if (permission && permission.state === 'denied') {
          updateStatus('Location blocked. Enable in browser settings.', true);
          return;
        }
      }
    } catch (e) { console.debug('Permission query failed', e); }

    updateStatus('Requesting location...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.__report_location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        updateStatus('✓ Location allowed');
        console.log('Location cached:', window.__report_location);
      },
      (err) => {
        console.warn('Location request error', err);
        if (err && err.code === 1) {
          updateStatus('Permission denied. Allow location and try again.', true);
        } else if (err && err.code === 2) {
          updateStatus('Location unavailable. Check GPS/network.', true);
        } else {
          updateStatus('Location request failed.', true);
        }
        window.__report_location = null;
      },
      { timeout: 10000, enableHighAccuracy: true, maximumAge: 60000 }
    );
  }

  if (requestBtn) {
    requestBtn.addEventListener('click', requestLocation);
  }

  // Check on load if location already cached from previous request
  setTimeout(() => {
    if (window.__report_location) {
      updateStatus('✓ Location allowed');
    }
  }, 500);
})();

// ---- Reporter name sanitization utilities ----
// Same rules as phone-signin: reject digits and disallowed symbols; allow Unicode letters, spaces, apostrophes, hyphens and dots.
const REPORTER_MAX_NAME_LEN = 64;
function sanitizeNameForReport(s) {
  if (!s) return null;
  s = String(s).trim();
  if (!s) return null;
  s = s.replace(/[\s\u00A0]+/g, ' ').replace(/[\r\n\t]/g, ' ').trim();
  if (!s) return null;
  // reject any digit
  if (/\d/.test(s)) return null;
  try {
    const allowed = /^([\p{L}\p{M} .'\-–—]+)$/u;
    if (!allowed.test(s)) return null;
  } catch (e) {
    const fallback = /^[A-Za-zÀ-ÖØ-öø-ÿ .'\-–—]+$/;
    if (!fallback.test(s)) return null;
  }
  if (s.length > REPORTER_MAX_NAME_LEN) s = s.slice(0, REPORTER_MAX_NAME_LEN);
  return s;
}

// Camera handling for mobile: open camera stream, capture frame to canvas, convert to File and set the photo input
const openCamBtn = document.getElementById('open-camera-btn');
const video = document.getElementById('camera-video');
const canvas = document.getElementById('camera-canvas');
const photoInput = document.getElementById('photo');
let stream = null;

async function startCamera() {
  try {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      hideLoading();
      if (photoInput) {
        photoInput.click();
      }
      alert('Camera API is not available on this browser/device. Please choose a photo from your device.');
      return;
    }

    showLoading('Starting camera...');
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    if (video) { video.srcObject = stream; video.style.display = ''; }
    if (canvas) canvas.style.display = 'none';
    if (openCamBtn) openCamBtn.textContent = 'Capture Photo';
    hideLoading();
  } catch (e) {
    hideLoading();
    console.error('Camera start failed', e);
    alert('Camera access failed: ' + (e && e.message ? e.message : e));
  }
}

function stopCamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (video) video.style.display = 'none';
}

async function captureFrameToInput() {
  try {
    if (!video || video.readyState < 2) { alert('Camera not ready'); return; }
    showLoading('Capturing photo...');
    const w = video.videoWidth;
    const h = video.videoHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);
    canvas.style.display = '';
    video.style.display = 'none';
    // Convert canvas to blob and set as File on the input
    canvas.toBlob(async (blob) => {
      const fileName = 'camera_' + Date.now() + '.jpg';
      const file = new File([blob], fileName, { type: blob.type });
      const dt = new DataTransfer();
      dt.items.add(file);
      if (photoInput) photoInput.files = dt.files;
      stopCamera();
      if (openCamBtn) openCamBtn.textContent = 'Open Camera';
      hideLoading();
      alert('Photo captured and attached');
    }, 'image/jpeg', 0.9);
  } catch (e) { console.error('Capture failed', e); alert('Capture failed: ' + (e && e.message ? e.message : e)); }
}

if (openCamBtn) openCamBtn.addEventListener('click', async () => {
  const canUseMediaDevices = !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
  if (!canUseMediaDevices || (typeof window.isSecureContext !== 'undefined' && !window.isSecureContext)) {
    try {
      if (photoInput) {
        photoInput.setAttribute('accept', 'image/*');
        photoInput.setAttribute('capture', 'environment');
        photoInput.click();
      }
    } catch (e) { console.warn('Camera file picker fallback failed', e); }
    return;
  }

  const modal = document.getElementById('camera-modal');
  if (modal) {
    modal.classList.remove('hidden');
    try {
      await startCamera();
      const modalVid = document.getElementById('modal-camera-video');
      if (modalVid && stream) modalVid.srcObject = stream;
      if (!stream) {
        modal.classList.add('hidden');
      }
    } catch (err) { console.warn('Camera start error', err); }
  } else {
    if (!stream) await startCamera(); else await captureFrameToInput();
  }
});

// Modal controls
const modal = document.getElementById('camera-modal');
const modalClose = document.getElementById('close-camera-modal');
const modalCancel = document.getElementById('modal-cancel-btn');
const modalCapture = document.getElementById('modal-capture-btn');
if (modalClose) modalClose.addEventListener('click', closeCameraModal);
if (modalCancel) modalCancel.addEventListener('click', closeCameraModal);
if (modalCapture) modalCapture.addEventListener('click', async () => {
  try {
    const modalVid = document.getElementById('modal-camera-video');
    if (!modalVid) return;
    const modalCanvas = document.getElementById('modal-camera-canvas');
    modalCanvas.width = modalVid.videoWidth;
    modalCanvas.height = modalVid.videoHeight;
    const ctx = modalCanvas.getContext('2d');
    ctx.drawImage(modalVid, 0, 0, modalCanvas.width, modalCanvas.height);
    modalCanvas.toBlob(async (blob) => {
      const fileName = 'camera_' + Date.now() + '.jpg';
      const file = new File([blob], fileName, { type: blob.type });
      const dt = new DataTransfer();
      dt.items.add(file);
      if (photoInput) photoInput.files = dt.files;
      closeCameraModal();
      alert('Photo captured and attached');
    }, 'image/jpeg', 0.9);
  } catch (e) { console.error(e); alert('Capture failed'); }
});

function closeCameraModal() {
  const modal = document.getElementById('camera-modal');
  if (modal) modal.classList.add('hidden');
  stopCamera();
}

// Additional image preview: show a preview when the user selects an optional additional image
(function wireAdditionalImagePreview() {
  try {
    const addInput = document.getElementById('add-image');
    const preview = document.getElementById('add-image-preview');
    if (!addInput || !preview) return;
    addInput.addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (!f) { preview.style.display = 'none'; preview.src = ''; return; }
      try { const url = URL.createObjectURL(f); preview.src = url; preview.style.display = 'block'; } catch (e) { console.warn('Preview failed', e); }
    });
  } catch (e) { console.debug('wireAdditionalImagePreview failed', e); }
})();

// Load barangays from JSON and initialize Choices.js after population
(function initBarangays() {
  const select = document.getElementById('barangay');
  if (!select) return;

  // Fallback list embedded so UI still works when fetch fails or when served via file://
  const FALLBACK_BARANGAYS = [
    "ABCR (A. Bonifacio-Caguioa-Rimando)",
    "Abanao-Zandueta-Kayong-Chugum-Otek (AZKCO)",
    "Alfonso Tabora",
    "Ambiong",
    "Andres Bonifacio (Lower Bokawkan)",
    "Apugan-Loakan",
    "Asin Road",
    "Atok Trail",
    "Aurora Hill Proper (Malvar-Sgt. Floresca)",
    "Aurora Hill, North Central",
    "Aurora Hill, South Central",
    "Bagong Lipunan (Market Area)",
    "Bakakeng Central",
    "Bakakeng North",
    "Bal-Marcoville (Marcoville)",
    "Balsigan",
    "Bayan Park East",
    "Bayan Park Village",
    "Bayan Park West (Leonila Hill)",
    "BGH Compound",
    "Brookside",
    "Brookspoint",
    "Cabinet Hill-Teacher's Camp",
    "Camdas Subdivision",
    "Camp 7",
    "Camp 8",
    "Camp Allen",
    "Campo Filipino",
    "City Camp Central",
    "City Camp Proper",
    "Country Club Village",
    "Cresencia Village",
    "Dagsian, Lower",
    "Dagsian, Upper",
    "Dizon Subdivision",
    "Dominican Hill-Mirador",
    "Dontogan",
    "DPS Compound",
    "Engineers' Hill",
    "Fairview Village",
    "Ferdinand (Happy Homes-Campo Sioco)",
    "Fort del Pilar",
    "Gabriela Silang",
    "General Emilio F. Aguinaldo (Quirino‑Magsaysay, Lower)",
    "General Luna, Upper",
    "General Luna, Lower",
    "Gibraltar",
    "Greenwater Village",
    "Guisad Central",
    "Guisad Sorong",
    "Happy Hollow",
    "Happy Homes",
    "Harrison-Claudio Carantes",
    "Hillside",
    "Holy Ghost Extension",
    "Holy Ghost Proper",
    "Honeymoon",
    "Imelda R. Marcos (La Salle)",
    "Imelda Village",
    "Irisan",
    "Kabayanihan",
    "Kagitingan",
    "Kayang Extension",
    "Kayang-Hilltop",
    "Kias",
    "Legarda-Burnham-Kisad",
    "Liwanag-Loakan",
    "Loakan Proper",
    "Lopez Jaena",
    "Lourdes Subdivision Extension",
    "Lourdes Subdivision, Lower",
    "Lourdes Subdivision, Proper",
    "Lualhati",
    "Lucnab",
    "Magsaysay Private Road",
    "Magsaysay, Lower",
    "Magsaysay, Upper",
    "Malcolm Square-Perfecto (Jose Abad Santos)",
    "Manuel A. Roxas",
    "Market Subdivision, Upper",
    "Middle Quezon Hill Subdivision (Quezon Hill Middle)",
    "Military Cut-off",
    "Mines View Park",
    "Modern Site, East",
    "Modern Site, West",
    "MRR-Queen of Peace",
    "New Lucban",
    "Outlook Drive",
    "Pacdal",
    "Padre Burgos",
    "Padre Zamora",
    "Palma-Urbano (Cariño-Palma)",
    "Phil-Am",
    "Pinget",
    "Pinsao Pilot Project",
    "Pinsao Proper",
    "Poliwes",
    "Pucsusan",
    "Quezon Hill Proper",
    "Quezon Hill, Upper",
    "Quirino Hill, East",
    "Quirino Hill, Lower",
    "Quirino Hill, Middle",
    "Quirino Hill, West",
    "Quirino-Magsaysay, Upper",
    "Rizal Monument Area",
    "Rock Quarry, Lower",
    "Rock Quarry, Middle",
    "Rock Quarry, Upper",
    "Saint Joseph Village",
    "Salud Mitra",
    "San Antonio Village",
    "San Luis Village",
    "San Roque Village",
    "San Vicente",
    "Sanitary Camp, North",
    "Sanitary Camp, South",
    "Santa Escolastica",
    "Santo Rosario",
    "Santo Tomas Proper",
    "Santo Tomas School Area",
    "Scout Barrio",
    "Session Road Area",
    "Slaughter House Area (Santo Niño Slaughter)",
    "SLU-SVP Housing Village",
    "South Drive",
    "Teodora Alonzo",
    "Trancoville",
    "Victoria Village"
  ];
  // ensure there's a clear placeholder while loading
  let placeholder = select.querySelector('option[value=""]');
  if (!placeholder) {
    placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = 'Select Barangay';
    select.insertBefore(placeholder, select.firstChild);
  } else {
    placeholder.textContent = 'Select Barangay';
  }
  select.disabled = false;
  // Failsafe: if fetch stalls, keep fallback after 3s
  let failsafeTimer = setTimeout(() => {
    console.warn('Barangays load stalled — keeping fallback list');
  }, 3000);

  let choicesInstance = null;
  function ensureEnabledUI() {
    try {
      select.disabled = false;
      select.removeAttribute('disabled');
      select.style.pointerEvents = 'auto';
      select.tabIndex = 0;
      select.setAttribute('aria-disabled', 'false');
    } catch (e) {}
    try { if (choicesInstance && typeof choicesInstance.enable === 'function') choicesInstance.enable(); } catch (e) {}
    // Also try to repair the Choices wrapper if present
    try {
      const wrapper = select.nextElementSibling; // Choices usually inserts a wrapper immediately after the select
      if (wrapper && wrapper.classList && wrapper.classList.contains('choices')) {
        wrapper.classList.remove('is-disabled');
        wrapper.style.pointerEvents = 'auto';
        wrapper.tabIndex = 0;
        // clear aria-disabled on any children
        Array.from(wrapper.querySelectorAll('[aria-disabled]')).forEach(el => el.setAttribute('aria-disabled', 'false'));
      }
    } catch (e) { console.warn('Failed to repair Choices wrapper', e); }
  }

  function populate(list) {
    // remove any existing non-placeholder options
    Array.from(select.querySelectorAll('option')).forEach(opt => { if (opt.value) opt.remove(); });
    list.forEach(name => {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = name;
      select.appendChild(o);
    });
    // Initialize Choices (safe)
    if (window.Choices) {
      try {
        // destroy previous instance if exists
        if (choicesInstance && typeof choicesInstance.destroy === 'function') {
          try { choicesInstance.destroy(); } catch (e) {}
          choicesInstance = null;
        }
        choicesInstance = new Choices(select, { searchEnabled: true, shouldSort: false, placeholderValue: 'Select Barangay', searchPlaceholderValue: 'Type barangay...' });
      } catch (e) { console.warn('Choices init failed', e); }
    }
    // ensure the UI is enabled after populating
    ensureEnabledUI();
  }

  // Populate immediately with fallback so the list is never empty
  populate(FALLBACK_BARANGAYS);

  async function load() {
    try {
      const res = await fetch('data/barangays.json');
      if (!res.ok) throw new Error('Failed to fetch barangays.json: ' + res.status);
      const list = await res.json();
      populate(list);
      // loaded successfully — clear failsafe
      clearTimeout(failsafeTimer);
    } catch (err) {
      console.warn('Failed to load barangays.json — using fallback list', err);
    } finally {
      try { clearTimeout(failsafeTimer); } catch (e) {}
      // ensure enabled regardless
      ensureEnabledUI();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
})();

// --- Baguio City bounding box enforcement ---
// Adjust these bounds if you need a wider/narrower area.
// Current safe defaults cover the general extent of Baguio City.
const BAGUIO_BOUNDS = {
  minLat: 16.30, // southern edge
  maxLat: 16.45, // northern edge
  minLng: 120.56, // western edge
  maxLng: 120.66  // eastern edge
};

function isWithinBaguio(coords) {
  try {
    if (!coords || typeof coords.lat !== 'number' || typeof coords.lng !== 'number') return false;
    return coords.lat >= BAGUIO_BOUNDS.minLat && coords.lat <= BAGUIO_BOUNDS.maxLat && coords.lng >= BAGUIO_BOUNDS.minLng && coords.lng <= BAGUIO_BOUNDS.maxLng;
  } catch (e) { return false; }
}

async function getNextReportId() {
  const endpoints = [
    '/api/reports/next-id',
    'http://localhost:3000/api/reports/next-id',
    'http://localhost:3001/api/reports/next-id'
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { method: 'GET' });
      if (!response.ok) continue;
      const payload = await response.json();
      if (payload && typeof payload.id === 'string' && /^R-\d{5}\d{8}$/.test(payload.id)) {
        return payload.id;
      }
    } catch (e) {}
  }

  const now = new Date();
  const datePart = String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + String(now.getFullYear());
  let reportNumber = 1;
  try {
    reportNumber = Number(localStorage.getItem(LOCAL_REPORT_COUNTER_KEY) || '0') + 1;
    localStorage.setItem(LOCAL_REPORT_COUNTER_KEY, String(reportNumber));
  } catch (e) {
    reportNumber = (Date.now() % 100000) || 1;
  }
  const numPart = String(reportNumber).padStart(5, '0');
  return 'R-' + numPart + datePart;
}

const form = document.getElementById('report-form');
form.addEventListener('submit', async function (e) {
  e.preventDefault();
  showLoading('Submitting report');
  const type = document.getElementById('waste-type').value;
  const size = document.querySelector('input[name="size"]:checked').value;
  const materialDesc = document.getElementById('description-material')?.value || '';
  const spotDesc = document.getElementById('description-spot')?.value || '';
  const landType = document.getElementById('description-land')?.value || '';
  const landmark = (document.getElementById('landmark')?.value || '').trim();
  const descParts = [];
  if (materialDesc) descParts.push('Materials: ' + materialDesc);
  if (spotDesc) descParts.push('Specific Spot: ' + spotDesc);
  if (landType) descParts.push('Land: ' + landType);
  if (landmark) descParts.push('Landmark: ' + landmark);
  const desc = descParts.join(' | ');
  if (!desc) { hideLoading(); alert('Please complete the description fields.'); return; }
  const barangayEl = document.getElementById('barangay');
  const barangay = barangayEl ? (barangayEl.value || '') : '';
  // client-side validation: barangay is required
  if (!barangay) { hideLoading(); alert('Please select a barangay.'); if (barangayEl) barangayEl.focus(); return; }
  const photoFile = document.getElementById('photo').files[0];
  const videoFile = document.getElementById('video').files[0];
  const addImageFile = (document.getElementById('add-image') ? document.getElementById('add-image').files[0] : null);

  if (!photoFile) { alert('Please add a photo'); return; }

  const id = await getNextReportId();
  let photoDataUrl = null;
  let additionalImageDataUrl = null;

  // helper to read a File as a data URL
  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.readAsDataURL(file);
    });
  }

  try { photoDataUrl = await fileToDataURL(photoFile); } catch (e) { photoDataUrl = null; }
  try { additionalImageDataUrl = await fileToDataURL(addImageFile); } catch (e) { additionalImageDataUrl = null; }

  async function persistReportToServer(reportData) {
    if (!reportData || !reportData.id) {
      throw new Error('Invalid report payload');
    }

    const endpoints = [
      '/api/reports',
      'http://localhost:3000/api/reports',
      'http://localhost:3001/api/reports'
    ];

    let lastError = null;
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reportData)
        });

        if (response.ok) {
          console.log('Saved report to reports.json via', endpoint);
          return;
        }

        lastError = new Error('Save failed with status ' + response.status + ' at ' + endpoint);
      } catch (e) {
        lastError = e;
      }
    }

    throw (lastError || new Error('Unable to save report to server')); 
  }

  // attempt geolocation and save document with logging
  async function saveReportLocally(coords) {
    try {
      const reportData = {
        id,
        type,
        size,
        description: desc,
        barangay: barangay,
        materialDesc,
        spotDesc,
        landType,
        landmark,
        photoDataUrl,
        additionalImageDataUrl,
        videoMeta: videoFile ? { name: videoFile.name, size: videoFile.size, type: videoFile.type } : null,
        status: 'pending',
        createdAt: Date.now(),
        lat: coords?.lat,
        lng: coords?.lng
      };
      const list = loadLocalReports();
      list.push(reportData);
      saveLocalReports(list);
      console.log('Saved report locally', { reportId: id });
      return reportData;
    } catch (err) {
      console.error('Failed to save report locally', err);
      throw err;
    }
  }

  // Prefer pre-fetched user location when available to avoid prompting twice
  const cachedLoc = window.__report_location;

  const redirectToHistory = (docId, lat, lng) => {
    const base = './history.html?plot=' + encodeURIComponent(docId || id);
    const coords = (typeof lat === 'number' && typeof lng === 'number') ? ('&lat=' + encodeURIComponent(lat) + '&lng=' + encodeURIComponent(lng)) : '';
    window.location.href = base + coords;
  };

  if (cachedLoc) {
    try {
      console.debug('Report submit: using cached location', cachedLoc);
      if (!isWithinBaguio(cachedLoc)) {
        hideLoading();
        alert('Reports are limited to Baguio City. Your current location appears to be outside Baguio. Please move to a location inside Baguio City or enable a device location within Baguio and try again.');
        return;
      }
      const savedReport = await saveReportLocally(cachedLoc);
      await persistReportToServer(savedReport);
    } catch (e) {
      console.error(e);
      hideLoading();
      alert('Save failed: ' + (e?.message || e));
      return;
    }
    showLoading('Report submitted');
    setTimeout(() => {
      hideLoading();
      alert('Report has been submitted and will be showed in the map if the admin has verified it');
    }, 800);
    redirectToHistory(id, cachedLoc.lat, cachedLoc.lng);
  } else if (navigator.geolocation) {
    try {
      if (navigator.permissions && typeof navigator.permissions.query === 'function') {
        const permission = await navigator.permissions.query({ name: 'geolocation' });
        if (permission && permission.state === 'denied') {
          hideLoading();
          alert('Location permission is currently blocked for this site. Enable location in browser settings and try again.');
          return;
        }
      }
    } catch (e) { console.debug('Geolocation permission query failed', e); }

    navigator.geolocation.getCurrentPosition(async (pos) => {
      const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      try {
        console.debug('Report submit: geolocation returned', loc);
        if (!isWithinBaguio(loc)) {
          hideLoading();
          alert('Reports are limited to Baguio City. Your detected location is outside Baguio. Report submission has been blocked.');
          return;
        }
        const savedReport = await saveReportLocally(loc);
        await persistReportToServer(savedReport);
      } catch (e) {
        console.error(e);
        hideLoading();
        alert('Save failed: ' + (e?.message || e));
        return;
      }
      showLoading('Report submitted');
      setTimeout(() => {
        hideLoading();
        alert('Report has been submitted and will be showed in the map if the admin has verified it');
      }, 800);
      redirectToHistory(id, loc.lat, loc.lng);
    }, async (err) => {
      console.warn('Geolocation failed or denied', err);
      // If geolocation is denied or fails we cannot verify city membership — block the report to ensure all saved reports are within Baguio.
      hideLoading();
      if (err && err.code === 1) {
        alert('Location permission was denied. Please allow location access in your browser settings and try again.');
      } else if (typeof window.isSecureContext !== 'undefined' && !window.isSecureContext) {
        alert('This page is running on an insecure connection. Some mobile browsers block location prompts unless the page is HTTPS (or localhost).');
      } else {
        alert('Location is required to verify that reports are inside Baguio City. Please enable location permissions and try again.');
      }
      return;
    }, { timeout: 10000, enableHighAccuracy: true, maximumAge: 0 });
  } else {
    // No geolocation available: block to ensure we only accept reports within Baguio.
    hideLoading();
    alert('Location is required to verify that reports are inside Baguio City. Your device does not provide geolocation or it is disabled.');
    return;
  }
});

