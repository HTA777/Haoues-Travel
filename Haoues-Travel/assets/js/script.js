/**
 * HAOUES TRAVEL & VOYAGES — LOGIC ENGINE v6 (LUXURY)
 * ─────────────────────────────────────────────────────
 * Full Feature Set: Booking, Offers, Capacity, Exports
 * Admin Posting: Packages with Drive image upload
 *
 * BUG FIXES (v6):
 * - renderAdminQuickStats: uses normalized English keys
 * - getFilteredBookings: uses normalized English keys
 * - exportData mapping: uses normalized English keys
 * - Counter animation for hero stats
 * - Mobile nav toggle
 * - Scroll-to-top button
 * - Loading skeletons
 */
'use strict';
// WEB_APP_URL is not needed as we use /api/proxy for security and consistency.
// ADMIN_KEY is now verified server-side and never stored in the source code.
let state = {
  packages: [],
  settings: {},
  bookings: [],
  adminPackages: []
};
const ICON_TRASH = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 2px 4px rgba(255, 71, 87, 0.25));"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;
let currentBookingPackage = null;

/* ═══════════════════════════════════════════════════════
   GLOBAL UTILITIES
   ═══════════════════════════════════════════════════════ */
const PREFERS_REDUCED_MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsString(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

function debounce(fn, wait = 250) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}
/* ═══════════════════════════════════════════════════════
   0. API — Proxy Helper
   ═══════════════════════════════════════════════════════ */
async function gasFetch(method, payload = {}, retries = 2) {
  const isPost = method === 'POST';
  const url = '/api/proxy';
  const token = sessionStorage.getItem('admin_token');
  const options = {
    method: method,
    headers: { 'Content-Type': 'application/json' }
  };
  let finalUrl = url;
  if (isPost) {
    if (!payload.key && !payload.pass) payload.pass = token;
    options.body = JSON.stringify(payload);
  } else {
    const params = new URLSearchParams(payload);
    const isAdminAction = ['bookings', 'adminInitial', 'setup'].includes(payload.action);
    if (isAdminAction && !params.has('key') && !params.has('pass')) {
      params.append('pass', token);
    }
    finalUrl = `${url}?${params.toString()}`;
  }
  console.log(`[API Request] ${method} action=${payload.action || 'unknown'}`, payload);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(finalUrl, options);
      let data;
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        if (!res.ok) throw new Error(`Server returned ${res.status}: ${text.substring(0, 100)}`);
        try { data = JSON.parse(text); } catch (e) { data = { value: text }; }
      }
      if (!res.ok || (data && data.success === false) || (data && data.error)) {
        const msg = data.error || data.message || data.details || `Server Error ${res.status}`;
        console.error("⛔ GasFetch Failed:", { status: res.status, data, payload });

        if (res.status === 429 && attempt < retries) {
          const delay = 2000 * (attempt + 1);
          console.warn(`⏳ Rate limited (429). Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw new Error(msg);
      }
      // Layered unrolling for maximum resilience
      let result = data;
      if (data && typeof data === 'object') {
        if (data.value !== undefined) result = data.value;
        else if (data.data !== undefined) result = data.data;
        else if (data.packages !== undefined && payload.action === 'packages') result = data.packages;
      }
      return result;
    } catch (err) {
      if (attempt === retries) {
        console.error(`❌ Final Fetch Error [${method} ${payload.action || ''}]:`, err);
        throw err;
      }
      const delay = 1000 * (attempt + 1);
      console.warn(`⚠️ Attempt ${attempt + 1} failed. Retrying in ${delay}ms...`, err.message);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
/* ═══════════════════════════════════════════════════════
   0.5 DATA NORMALIZER
   ═══════════════════════════════════════════════════════ */
function normalizeItem(item) {
  if (!item || typeof item !== 'object') return item;
  const mapping = {
    // Offers
    name: ["الاسم", "الاسم ", "باقة", "العرض"],
    price: ["السعر", "الثمن", "السعر (دج)", "السعر دج"],
    start: ["تاريخ_البداية", "البداية", "تاريخ البداية", "تاريخ البدء"],
    end: ["تاريخ_النهاية", "النهاية", "تاريخ النهاية"],
    hotel: ["الفندق", "hotel", "النزل"],
    image: ["صورة_url", "صورة", "image", "صورة الفندق"],
    seats: ["المقاعد", "عدد_المقاعد", "المقاعد الكلية", "totalSeats"],
    booked: ["المحجوزة", "عدد_المحجوزة", "booked"],
    rooms: ["الغرف", "أنواع الغرف", "rooms"],
    published: ["منشور", "حالة النشر", "published"],
    priceDouble: ["سعر_ثنائي", "ثمن_ثنائية", "سعر الثنائية", "الثنائية"],
    priceTriple: ["سعر_ثلاثي", "ثمن_ثلاثية", "سعر الثلاثية", "الثلاثية"],
    priceQuad: ["سعر_رباعي", "ثمن_رباعية", "سعر الرباعية", "الرباعية"],
    priceQuint: ["سعر_خماسي", "ثمن_خماسية", "سعر الخماسية", "الخماسية"],
    travelStart: ["تاريخ_الذهاب", "الذهاب"],
    travelEnd: ["تاريخ_العودة", "العودة"],
    airline: ["شركة_الطيران", "الطيران"],
    flightType: ["نوع_الرحلة"],
    documents: ["الوثائق_المطلوبة", "الوثائق"],
    distance: ["المسافة_عن_الحرم", "المسافة"],
    food: ["الإطعام"],
    hotelMap: ["رابط_الفندق"],
    description: ["الوصف", "text"],
    images: ["الصور", "صور", "صورة_url", "صورة", "image", "صورة الفندق"],
    // Bookings
    timestamp: ["التوقيت", "تاريخ الحجز", "timestamp"],
    firstName: ["الاسم_الأول", "الاسم", "firstName"],
    lastName: ["اللقب", "lastName"],
    phone: ["الهاتف", "رقم الهاتف", "phone"],
    package: ["الباقة", "العرض المحجوز", "package"],
    pax: ["الأشخاص", "عدد الأشخاص", "pax"],
    roomType: ["نوع_الغرفة", "نوع الغرفة", "الغرفة", "roomType"],
    status: ["الحالة", "status"],
    // Ads
    type: ["النوع", "type"],
    title: ["العنوان", "title"],
    text: ["النص", "text"],
    position: ["المكان", "position"],
    active: ["مفعّل", "active"]
  };
  const normalized = { ...item };
  const sourceKeys = Object.keys(item);
  for (const [english, variants] of Object.entries(mapping)) {
    if (item[english] === undefined) {
      const match = sourceKeys.find(sk => {
        const cleanSk = sk.trim().replace(/_/g, ' ');
        return cleanSk === english || variants.some(v => v.trim().replace(/_/g, ' ') === cleanSk);
      });
      if (match) normalized[english] = item[match];
    }
  }
  // Value parsing
  if (normalized.price !== undefined) normalized.price = parseFloat(normalized.price) || 0;
  if (normalized.pax !== undefined) normalized.pax = parseInt(normalized.pax) || 0;
  if (normalized.seats !== undefined) normalized.seats = parseInt(normalized.seats) || 0;
  if (normalized.booked !== undefined) normalized.booked = parseInt(normalized.booked) || 0;
  if (normalized.phone !== undefined) {
    let p = String(normalized.phone).trim();
    if (p.length === 9 && !p.startsWith('0')) {
      p = '0' + p;
    }
    normalized.phone = p;
  }
  // Boolean normalization
  const checkBool = (val) => val === true || val === "TRUE" || String(val).toLowerCase() === "true";
  if (normalized.published !== undefined) normalized.published = checkBool(normalized.published);
  if (normalized.active !== undefined) normalized.active = checkBool(normalized.active);
  return normalized;
}
/* ═══════════════════════════════════════════════════════
   1. UI INITIALIZATION
   ═══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initUI();
  fetchInitialData();
  setupRevealOnScroll();
  setupScrollToTop();
  animateCounters();
  initCanvasGrid();
});
/* ─── Reveal on Scroll ─── */
let revealObserver;
function setupRevealOnScroll() {
  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.01 });
  refreshRevealObserver();
}
function refreshRevealObserver() {
  if (!revealObserver) return;
  document.querySelectorAll('.reveal:not(.active)').forEach(el => revealObserver.observe(el));
}
/* ─── Scroll to Top ─── */
function setupScrollToTop() {
  const btn = document.getElementById('scroll-top-btn');
  if (!btn) return;
  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 500);
  }, { passive: true });
}
/* ─── Counter Animation ─── */
let counterObserver;
function animateCounters() {
  const counters = document.querySelectorAll('.stat-num[data-target]');

  counterObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = parseInt(el.getAttribute('data-target'), 10);
      if (!target || el.dataset.animated === 'true') return;
      el.dataset.animated = 'true';

      if (PREFERS_REDUCED_MOTION) {
        el.textContent = target >= 1000 ? target.toLocaleString() + '+' : String(target);
        counterObserver.unobserve(el);
        return;
      }

      const duration = 2000;
      const steps = 60;
      const stepTime = duration / steps;
      let current = 0;
      const increment = target / steps;

      const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
          el.textContent = target >= 1000 ? target.toLocaleString() + '+' : String(target);
          clearInterval(timer);
        } else {
          el.textContent = String(Math.floor(current));
        }
      }, stepTime);

      counterObserver.unobserve(el);
    });
  }, { threshold: 0.3 });

  counters.forEach(c => counterObserver.observe(c));
}

/* Re-animate a specific counter whose data-target was updated after load */
function retriggerCounter(el) {
  if (!el || !counterObserver) return;
  delete el.dataset.animated;
  el.textContent = '0';
  counterObserver.observe(el);
}
/* ─── Mobile Nav ─── */
window.toggleMobileNav = () => {
  const overlay = document.getElementById('mobile-nav-overlay');
  const hamburger = document.getElementById('nav-hamburger');
  if (!overlay || !hamburger) return;

  const willOpen = !overlay.classList.contains('active');
  overlay.classList.toggle('active', willOpen);
  hamburger.classList.toggle('active', willOpen);
  hamburger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  document.body.style.overflow = willOpen ? 'hidden' : '';
};
/* ─── Main UI Init ─── */
function initUI() {
  // Mouse glow
  const glow = document.getElementById('mouse-glow');
  if (glow && !PREFERS_REDUCED_MOTION) {
    window.addEventListener('mousemove', (e) => {
      requestAnimationFrame(() => {
        glow.style.setProperty('--mouse-x', `${e.clientX}px`);
        glow.style.setProperty('--mouse-y', `${e.clientY}px`);
      });
    }, { passive: true });
  }
  // Nav scroll effect
  window.addEventListener('scroll', () => {
    const nav = document.getElementById('site-nav');
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 50);
  }, { passive: true });
  // Booking Form Submission
  const bookingForm = document.getElementById('form-booking');
  if (bookingForm) bookingForm.addEventListener('submit', handleBookingSubmit);
  // Search filter (live)
  document.getElementById('booking-search')?.addEventListener('input', applyBookingFilters);
  // Status filter (live)
  document.getElementById('booking-status-filter')?.addEventListener('change', applyBookingFilters);
  // Toast Container
  if (!document.getElementById('toast-container')) {
    const tc = document.createElement('div');
    tc.id = 'toast-container';
    tc.setAttribute('role', 'status');
    tc.setAttribute('aria-live', 'polite');
    tc.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:10px;pointer-events:none;max-width:90vw;';
    document.body.appendChild(tc);
  }
  // Global Esc: close top-most visible modal
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = Array.from(document.querySelectorAll('.modal-overlay.active'))
      .filter(el => el.offsetParent !== null);
    if (open.length) {
      closeModal(open[open.length - 1].id);
      return;
    }
    const mobileNav = document.getElementById('mobile-nav-overlay');
    if (mobileNav?.classList.contains('active')) {
      window.toggleMobileNav();
    }
  });
  // Close modal on overlay backdrop click (outside content)
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });
}
/* ═══════════════════════════════════════════════════════
   2. DATA FETCHING
   ═══════════════════════════════════════════════════════ */
async function fetchInitialData() {
  const loader = document.getElementById('pkg-loading');
  if (loader) loader.style.display = 'block';
  try {
    const results = await Promise.allSettled([
      gasFetch('GET', { action: 'packages' }),
      gasFetch('GET', { action: 'settings' })
    ]);
    const pkgs = results[0].status === 'fulfilled' ? results[0].value : [];
    const sets = results[1].status === 'fulfilled' ? results[1].value : {};
    if (results[0].status === 'rejected') console.error("❌ Packages failed:", results[0].reason);
    if (results[1].status === 'rejected') console.error("❌ Settings failed:", results[1].reason);
    state.packages = (Array.isArray(pkgs) ? pkgs : []).map(normalizeItem);
    state.settings = (typeof sets === 'object' && !Array.isArray(sets)) ? sets : {};
    console.log(`📊 Sync: ${state.packages.length} pkgs`);
    renderPublicUI();
    if (results[0].status === 'rejected') {
      showToast('⚠️ لم يتم تحميل البيانات. يرجى التحديث.', 'error');
    }
  } catch (err) {
    console.error("❌ Critical fetch error:", err);
    showToast('⚠️ خطأ تقني في مزامنة البيانات.', 'error');
  } finally {
    if (loader) loader.style.display = 'none';
  }
}
function renderPublicUI() {
  try { renderSettings(); } catch (e) { console.error("❌ renderSettings failed:", e); }
  try { renderPackages(); } catch (e) { console.error("❌ renderPackages failed:", e); }
}
function renderSettings() {
  if (state.settings.agency_name) {
    const agencyEl = document.getElementById('agency-name');
    if (agencyEl) agencyEl.textContent = state.settings.agency_name;
    document.title = state.settings.page_title || document.title;
  }
  // Contact info is hardcoded in index.html to ensure priority.
  // Stats counter
  const statPkgsEl = document.getElementById('stat-pkgs');
  if (statPkgsEl) {
    const count = state.packages.length;
    statPkgsEl.setAttribute('data-target', String(count));
    retriggerCounter(statPkgsEl);
  }
  // Populate public package filter dropdown
  populatePublicPackageFilter();
}
/* Debounced public search handler — wired via inline oninput in index.html */
const debouncedRenderPackages = debounce(renderPackages, 180);
window.debounceRenderPackages = debouncedRenderPackages;
function populatePublicPackageFilter() {
  const select = document.getElementById('public-pkg-filter');
  const cards = document.getElementById('public-pkg-filter-cards');
  const currentVal = select ? select.value : 'all';

  const packageNames = [...new Set(state.packages.map(p => {
    const item = normalizeItem(p);
    return String(item.name || '').trim();
  }))].filter(Boolean).sort();

  if (select) {
    let selHtml = '<option value="all">كل العروض 🕌</option>';
    packageNames.forEach(name => {
      const safe = escapeHtml(name);
      selHtml += `<option value="${safe}" ${name === currentVal ? 'selected' : ''}>${safe}</option>`;
    });
    select.innerHTML = selHtml;
  }

  if (cards) {
    const activePkg = currentVal || 'all';
    const allActive = activePkg === 'all';
    let cardsHtml = `<button type="button" class="pkg-filter-card ${allActive ? 'active' : ''}" data-pkg="all" onclick="selectPublicPackageFilterCard(this, 'all')">🏷️ كل العروض</button>`;
    packageNames.forEach(name => {
      const selected = name === activePkg;
      cardsHtml += `<button type="button" class="pkg-filter-card ${selected ? 'active' : ''}" data-pkg="${escapeHtml(name)}" onclick="selectPublicPackageFilterCard(this, '${escapeJsString(name)}')">${escapeHtml(name)}</button>`;
    });
    cards.innerHTML = cardsHtml;
  }
}

window.selectPublicPackageFilterCard = function (btn, pkg) {
  document.querySelectorAll('#public-pkg-filter-cards .pkg-filter-card').forEach(c => c.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const select = document.getElementById('public-pkg-filter');
  if (select) select.value = pkg;
  renderPackages();
};
function renderPackages() {
  const grid = document.getElementById('pkg-grid');
  const loader = document.getElementById('pkg-loading');
  if (!grid) return;
  if (loader) loader.style.display = 'none';
  const searchTerm = (document.getElementById('public-pkg-search')?.value || '').toLowerCase();
  const filterVal = document.getElementById('public-pkg-filter')?.value || 'all';
  const validPackages = state.packages.filter(p => {
    const item = normalizeItem(p);
    const name = String(item.name || '').trim();
    if (!name) return false;
    const matchesSearch = name.toLowerCase().includes(searchTerm) ||
      String(item.hotel || '').toLowerCase().includes(searchTerm);
    const matchesFilter = filterVal === 'all' || name === filterVal;
    const remaining = (item.seats || 0) - (item.booked || 0);
    const isFull = remaining <= 0;
    return matchesSearch && matchesFilter && !isFull;
  });
  if (validPackages.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
        <div style="font-size: 3rem; margin-bottom: 16px; opacity: 0.3;">🕋</div>
        <p style="font-size: 1.1rem;">لا توجد باقات منشورة حالياً</p>
        <p style="font-size: 0.9rem; margin-top: 8px; opacity: 0.5;">ترقبوا عروضنا قريباً</p>
      </div>
    `;
    return;
  }
  grid.innerHTML = validPackages.map((p, index) => {
    const item = normalizeItem(p);
    const remaining = (item.seats || 0) - (item.booked || 0);
    const isFull = remaining <= 0;
    const rawName = item.name || '';
    const nameHtml = escapeHtml(rawName || 'بدون عنوان');
    const nameJs = escapeJsString(rawName);
    const hotelHtml = escapeHtml(item.hotel || '—');
    const airlineHtml = escapeHtml(item.airline || '—');
    const distanceHtml = escapeHtml(item.distance || '—');
    const priceText = Number.isFinite(Number(item.price)) && Number(item.price) > 0
      ? Number(item.price).toLocaleString()
      : '—';
    return `
      <div class="card reveal" style="transition-delay: ${index * 0.1}s; cursor: pointer; display: flex; flex-direction: column;" onclick="window.openOfferDetailModal('${nameJs}')">
       <span class="badge ${isFull ? 'badge-f' : 'badge-m'}">${isFull ? 'ممتلئ' : 'متاح'}</span>
              <div class="card-body" style="padding: 40px 24px; flex: 1; display: flex; flex-direction: column; text-align: center;">
                <div style="font-size:3.5rem; text-align:center; margin-bottom:20px; opacity: 0.9;">🕋</div>
                <h3 style="text-align:center; font-size:3.2rem; margin-bottom:15px; color: var(--primary-light);">${nameHtml}</h3>
                <div class="price" style="text-align:center; font-size:2rem; margin-bottom: 30px;">ابتداءً من <span style="font-size: 4rem; font-weight: bold;">${priceText} دج</span></div>
                <div class="meta" style="grid-template-columns: 1fr; gap: 12px; margin-bottom: 30px; flex: 1; text-align: center;">
                  ${item.travelStart || item.travelEnd ? `
                  <div style="border:none; background:rgba(255,255,255,0.03); border-radius:12px; padding:12px; display: flex; flex-direction: column; gap: 6px;">
                    ${item.travelStart ? `<div><span style="color:var(--text-muted);">🛫 الذهاب:</span> <span style="font-weight:700;">${escapeHtml(formatDate(item.travelStart))}</span></div>` : ''}
                    ${item.travelEnd ? `<div><span style="color:var(--text-muted);">🛬 العودة:</span> <span style="font-weight:700;">${escapeHtml(formatDate(item.travelEnd))}</span></div>` : ''}
                  </div>
                  ` : `<div style="border:none; background:rgba(255,255,255,0.03); border-radius:12px; padding:12px; text-align:center;">📅 ${escapeHtml(formatDate(item.start))}</div>`}
                  <div style="border:none; background:rgba(255,255,255,0.03); border-radius:12px; padding:12px; text-align:center; font-size:1.15rem; font-weight:800; color:var(--text-main);">🏨 ${hotelHtml}</div>
                  <div style="border:none; background:rgba(255,255,255,0.03); border-radius:12px; padding:12px; text-align:center; color: var(--text-dim); font-size:0.9rem;">✈️ ${airlineHtml}</div>
                  <div style="border:none; background:rgba(255,255,255,0.03); border-radius:12px; padding:12px; text-align:center; color: var(--text-dim); font-size:0.9rem;">📍 المسافة: ${distanceHtml}</div>
                  <div style="border:none; background:rgba(255,255,255,0.03); border-radius:12px; padding:12px; text-align:center; font-size:1.15rem; font-weight:800; color:var(--text-main);">💺 متبقي: ${remaining} مقعد</div>
                </div>
                <button class="btn btn-p" style="width: 100%; margin-top: auto;" onclick="event.stopPropagation(); window.openOfferDetailModal('${nameJs}')">
                  عرض التفاصيل 🔍
                 </button>
                         </div>
                       </div>
                     `;
  }).join('');
  refreshRevealObserver();
}
/* ═══════════════════════════════════════════════════════
   3. BOOKING MODAL & SUBMISSION
   ═══════════════════════════════════════════════════════ */
window.openBookingModal = (packageName) => {
  const pkg = state.packages.find(p => {
    const item = normalizeItem(p);
    return item.name === packageName;
  });
  if (!pkg) return;
  const item = normalizeItem(pkg);
  const remaining = (item.seats || 0) - (item.booked || 0);
  currentBookingPackage = item;
  document.getElementById('b-package').value = packageName;
  document.getElementById('modal-title').textContent = "حجز في باقة: " + packageName;
  // Set seat limits
  const paxInput = document.getElementById('b-pax');
  if (paxInput) {
    paxInput.max = Math.max(0, remaining);
    paxInput.value = 1;
  }
  // [IMPROVED] Reset ALL form fields completely
  document.getElementById('b-fname').value = '';
  document.getElementById('b-lname').value = '';
  document.getElementById('b-phone').value = '';
  const roomInput = document.getElementById('b-room');
  if (roomInput) roomInput.value = '';
  const roomChips = document.getElementById('room-chips');
  if (roomChips) roomChips.innerHTML = '';
  // [IMPROVED] Always reset to Step 1 — Step 2 completely hidden (display:none)
  const step1 = document.getElementById('booking-step-1');
  const step2 = document.getElementById('booking-step-2');
  const dot1 = document.getElementById('step-dot-1');
  const dot2 = document.getElementById('step-dot-2');
  if (step1) step1.style.display = 'block';
  if (step2) step2.style.display = 'none';
  if (dot1) dot1.className = 'step-dot active';
  if (dot2) dot2.className = 'step-dot';
  // Re-enable next button in case it was disabled
  const nextBtn = document.getElementById('btn-next-step');
  if (nextBtn) nextBtn.style.display = 'block';
  const loadingEl = document.getElementById('step1-loading');
  if (loadingEl) loadingEl.style.display = 'none';
  window.openModal('modal-booking');
};
window.openModal = (id) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('active');
  document.body.style.overflow = 'hidden';
  // Focus first focusable control inside modal
  setTimeout(() => {
    const first = el.querySelector('input, select, textarea, button, [tabindex]:not([tabindex="-1"])');
    if (first) { try { first.focus({ preventScroll: true }); } catch (_) { first.focus(); } }
  }, 50);
};
window.closeModal = (id) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('active');
  // Restore page scroll if no other modals are open
  const anyOpen = document.querySelector('.modal-overlay.active');
  if (!anyOpen) document.body.style.overflow = '';
};
let _verifyingStep1 = false;
window.verifyBookingStep1 = async () => {
  if (_verifyingStep1) return; // guard against double-submit
  const fNameInput = document.getElementById('b-fname');
  const lNameInput = document.getElementById('b-lname');
  const phoneInput = document.getElementById('b-phone');
  if (!fNameInput || !lNameInput || !phoneInput || !currentBookingPackage) {
    showToast('❌ حدث خطأ. أعد فتح نموذج الحجز.', 'error');
    return;
  }

  const fName = fNameInput.value.trim();
  const lName = lNameInput.value.trim();
  const phone = phoneInput.value.trim();

  // Field presence
  if (!fName) { fNameInput.focus(); showToast('⚠️ الرجاء إدخال الاسم.', 'error'); return; }
  if (!lName) { lNameInput.focus(); showToast('⚠️ الرجاء إدخال اللقب.', 'error'); return; }
  if (!phone) { phoneInput.focus(); showToast('⚠️ الرجاء إدخال رقم الهاتف.', 'error'); return; }

  // Phone format
  if (!/^(05|06|07)\d{8}$/.test(phone)) {
    phoneInput.focus();
    showToast('⚠️ يرجى إدخال رقم هاتف صحيح يبدأ بـ 05، 06 أو 07 (10 أرقام).', 'error');
    return;
  }

  // Capacity validation (uses pax default of 1 since pax is chosen in step 2)
  const remaining = (currentBookingPackage.seats || 0) - (currentBookingPackage.booked || 0);
  if (remaining < 1) {
    showToast('⚠️ عذراً، لا توجد مقاعد متبقية في هذه الباقة.', 'error');
    return;
  }

  const loader = document.getElementById('step1-loading');
  const btn = document.getElementById('btn-next-step');
  _verifyingStep1 = true;
  if (btn) { btn.style.display = 'none'; btn.disabled = true; }
  if (loader) loader.style.display = 'block';

  let advance = false;
  try {
    const res = await gasFetch('POST', {
      action: 'checkDuplicate',
      data: { firstName: fName, lastName: lName, phone, package: currentBookingPackage.name }
    });
    if (res && res.exists) {
      showToast(`❌ ${res.error || 'تم تسجيل هذا الحجز مسبقاً.'}`, 'error');
    } else {
      advance = true;
    }
  } catch (err) {
    console.error('checkDuplicate failed:', err);
    showToast(`❌ ${err && err.message ? err.message : 'خطأ في التحقق من البيانات. حاول مجدداً.'}`, 'error');
  } finally {
    if (btn) { btn.style.display = 'block'; btn.disabled = false; }
    if (loader) loader.style.display = 'none';
    _verifyingStep1 = false;
  }

  if (!advance) return; // stay on step 1 until server confirms

  // Advance to step 2
  document.getElementById('booking-step-1').style.display = 'none';
  document.getElementById('booking-step-2').style.display = 'block';
  document.getElementById('step-dot-1').className = 'step-dot done';
  document.getElementById('step-dot-2').className = 'step-dot active';
  populateRoomOptions();
  updateBookingTotalPrice();
};
function populateRoomOptions() {
  const container = document.getElementById('room-chips');
  const hiddenInput = document.getElementById('b-room');
  if (!container || !hiddenInput || !currentBookingPackage) return;
  const roomText = currentBookingPackage.rooms || "ثنائية، ثلاثية، رباعية";
  const rooms = roomText.split(/[،,]/).map(r => r.trim()).filter(Boolean);
  container.innerHTML = rooms
    .map((r, i) => `<button type="button" class="chip-btn ${i === 0 ? 'active' : ''}" onclick="selectRoomFilter('${escapeJsString(r)}')">${escapeHtml(r)}</button>`)
    .join('');
  hiddenInput.value = rooms[0] || '';
}
window.selectRoomFilter = function (val) {
  document.querySelectorAll('#room-chips .chip-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent === val);
  });
  document.getElementById('b-room').value = val;
  updateBookingTotalPrice();
}
window.selectStatusFilter = function (val) {
  document.querySelectorAll('#booking-status-chips .chip-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-val') === val);
  });
  const select = document.getElementById('booking-status-filter');
  select.value = val;
  select.dispatchEvent(new Event('change'));
}
window.updateBookingTotalPrice = () => {
  const roomType = document.getElementById('b-room').value;
  const priceDisplay = document.getElementById('b-total-price');
  let basePrice = currentBookingPackage.price;
  // Adaptive pricing logic
  if (roomType.includes('ثنائية')) basePrice = currentBookingPackage.priceDouble || basePrice;
  else if (roomType.includes('ثلاثية')) basePrice = currentBookingPackage.priceTriple || basePrice;
  else if (roomType.includes('رباعية')) basePrice = currentBookingPackage.priceQuad || basePrice;
  else if (roomType.includes('خماسية')) basePrice = currentBookingPackage.priceQuint || basePrice;
  const total = parseFloat(basePrice) || 0;
  // Display as Price per person as requested (multiplication removed)
  priceDisplay.textContent = `${total.toLocaleString()} دج / شخص`;
};
async function handleBookingSubmit(e) {
  e.preventDefault();
  if (document.getElementById('booking-step-1').style.display !== 'none') {
    await verifyBookingStep1();
    return;
  }
  const btn = document.getElementById('btn-submit-book');
  const formData = new FormData(e.target);
  const data = Object.fromEntries(formData.entries());
  btn.disabled = true;
  btn.textContent = "جاري الحجز...";
  try {
    await gasFetch('POST', { action: 'book', data: data });
    showToast("✅ تم الحجز بنجاح! سنتواصل معكم قريباً.", 'success');
    closeModal('modal-booking');
    e.target.reset();
    fetchInitialData();
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = "تأكيد الطلب 🚀";
  }
}
/* ═══════════════════════════════════════════════════════
   4. ADMIN DASHBOARD
   ═══════════════════════════════════════════════════════ */
/* ─── Admin Toggle Switch ─── */
let adminGateOpen = false;
window.toggleAdminGate = () => {
  adminGateOpen = !adminGateOpen;
  const passRow = document.getElementById('admin-pass-row');
  const sw = document.getElementById('admin-switch');
  const knob = document.getElementById('admin-switch-knob');
  const errMsg = document.getElementById('admin-pass-err');
  if (adminGateOpen) {
    passRow.style.display = 'flex';
    sw.style.background = 'var(--primary)';
    sw.style.borderColor = 'var(--primary)';
    knob.style.right = 'auto';
    knob.style.left = '3px';
    knob.style.background = '#000';
    errMsg.style.display = 'none';
    document.getElementById('admin-pass-input').value = '';
    setTimeout(() => document.getElementById('admin-pass-input').focus(), 100);
  } else {
    passRow.style.display = 'none';
    sw.style.background = 'rgba(255,255,255,0.06)';
    sw.style.borderColor = 'var(--glass-border)';
    knob.style.left = 'auto';
    knob.style.right = '3px';
    knob.style.background = 'var(--text-dim)';
    errMsg.style.display = 'none';
  }
};
window.verifyAdminSwitch = async () => {
  const input = document.getElementById('admin-pass-input');
  const errMsg = document.getElementById('admin-pass-err');
  const pass = input.value.trim();
  if (!pass) return;
  try {
    showToast('⏳ جاري التحقق من كلمة السر...', 'info');

    // Temporarily set token to verify
    sessionStorage.setItem('admin_token', pass);

    // Attempt to fetch admin data - if wrong pass, the proxy or GAS will throw 401/error
    await fetchAdminData(true);
    errMsg.style.display = 'none';
    document.getElementById('admin-panel').style.display = 'flex';
    // Reset toggle
    adminGateOpen = false;
    document.getElementById('admin-pass-row').style.display = 'none';
    const sw = document.getElementById('admin-switch');
    const knob = document.getElementById('admin-switch-knob');
    sw.style.background = 'rgba(255,255,255,0.06)';
    sw.style.borderColor = 'var(--glass-border)';
    knob.style.left = 'auto';
    knob.style.right = '3px';
    knob.style.background = 'var(--text-dim)';
    input.value = '';

    showToast('✅ تم الدخول بنجاح', 'success');
  } catch (err) {
    console.error("Auth failed:", err);
    sessionStorage.removeItem('admin_token');
    errMsg.style.display = 'inline';
    input.value = '';
    input.focus();
    showToast('❌ كلمة السر غير صحيحة', 'error');
  }
};
async function fetchAdminData(isInitialLogin = false) {
  try {
    if (!isInitialLogin) showToast('⏳ جاري تحميل بيانات لوحة التحكم...', 'info');
    const data = await gasFetch('GET', { action: 'adminInitial' });
    state.bookings = (Array.isArray(data.bookings) ? data.bookings : []).map(normalizeItem);
    state.adminPackages = (Array.isArray(data.packages) ? data.packages : []).map(normalizeItem);
    renderAdminUI();
    populatePackageFilterDropdown();

    showToast(`✅ تم تحميل البيانات: ${state.bookings.length} حجز، ${state.adminPackages.length} باقة`, 'success');
  } catch (err) {
    console.error("❌ Admin fetch failed:", err);
    showToast("❌ تعذر جلب بيانات الإدارة. تأكد من كلمة المرور.", 'error');
  }
}
function renderAdminUI() {
  renderAdminQuickStats();
  renderAdminBookings();
  renderAdminPackages();
}
/* ─── Quick Stats (BUG FIX: uses normalized English keys) ─── */
function renderAdminQuickStats() {
  const el = document.getElementById('admin-quick-stats');
  if (!el) return;
  const totalBookings = state.bookings.length;
  // FIX: Use normalized English keys instead of Arabic keys
  const confirmedBookings = state.bookings.filter(b => {
    const s = String(b.status || '').toUpperCase();
    return s === 'CONFIRMED' || b.status === 'تم التأكيد';
  }).length;
  const activeOffers = state.adminPackages.filter(p => p.published === true).length;
  el.innerHTML = `
    <div class="stat-item" style="padding: 10px 20px; animation: none;">
      <span class="stat-num" style="font-size: 1.2rem;">${totalBookings}</span>
      <span class="stat-label" style="font-size: 0.65rem;">إجمالي الحجوزات</span>
    </div>
    <div class="stat-item" style="padding: 10px 20px; animation: none; border-color: var(--success);">
      <span class="stat-num" style="font-size: 1.2rem; color: var(--success);">${confirmedBookings}</span>
      <span class="stat-label" style="font-size: 0.65rem;">حجوزات مؤكدة</span>
    </div>
    <div class="stat-item" style="padding: 10px 20px; animation: none;">
      <span class="stat-num" style="font-size: 1.2rem;">${activeOffers}</span>
      <span class="stat-label" style="font-size: 0.65rem;">عروض منشورة</span>
    </div>
  `;
}
/* ─── Status Helpers ─── */
const STATUS_MAP = {
  "PENDING": { cls: "st-none", label: "⏳ لم يتم التأكيد" },
  "CONFIRMED": { cls: "st-confirm", label: "✅ تم التأكيد" },
  // Arabic fallbacks
  "لم يتم التأكيد": { cls: "st-none", label: "⏳ لم يتم التأكيد" },
  "تم التأكيد": { cls: "st-confirm", label: "✅ تم التأكيد" }
};
function getStatusInfo(rawStatus) {
  return STATUS_MAP[rawStatus] || STATUS_MAP["PENDING"];
}
/* ─── Bookings Table ─── */
function renderAdminBookings() {
  const list = document.getElementById('list-bookings');
  if (!state.bookings || state.bookings.length === 0) {
    list.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:40px; color:var(--text-muted);">لا توجد حجوزات بعد</td></tr>';
    return;
  }
  list.innerHTML = state.bookings.map(b => {
    const si = getStatusInfo(b.status);
    const statusForFilter = getArabicStatus(b.status);
    const pkgName = String(b.package || '').trim();
    const rowIdx = Number(b.rowIndex);
    return `
      <tr data-status="${escapeHtml(statusForFilter)}" data-package="${escapeHtml(pkgName)}">
        <td>${escapeHtml(b.firstName || '')} ${escapeHtml(b.lastName || '')}</td>
        <td dir="ltr">${escapeHtml(b.phone || '')}</td>
        <td>${escapeHtml(pkgName)}</td>
        <td>${escapeHtml(String(b.pax || ''))}</td>
        <td>${escapeHtml(b.roomType || '')}</td>
        <td>
          <span class="st ${si.cls}" role="button" tabindex="0" onclick="cycleBookingStatus(${rowIdx}, '${escapeJsString(b.status)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();cycleBookingStatus(${rowIdx}, '${escapeJsString(b.status)}');}" title="انقر لتغيير الحالة">
            ${si.label}
          </span>
        </td>
        <td style="font-size: 0.72rem; color: var(--text-dim);">${escapeHtml(formatDate(b.timestamp))}</td>
        <td><button class="btn-delete" onclick="performFinalDeletionRobustV4('BOOKINGS', ${rowIdx})" title="حذف الحجز" aria-label="حذف الحجز">${ICON_TRASH}</button></td>
      </tr>
    `;
  }).join('');
  applyBookingFilters();
}
// Card click handler — highlights active card, syncs hidden select
window.selectPackageFilterCard = function (btn, pkg) {
  document.querySelectorAll('.pkg-filter-card').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  const select = document.getElementById('admin-package-filter');
  if (select) { select.value = pkg; }
  applyBookingFilters();
};
// Populate card-based package filter + keep hidden select in sync
function populatePackageFilterDropdown() {
  const select = document.getElementById('admin-package-filter');
  const cardsContainer = document.getElementById('admin-package-filter-cards');
  const packages = [...new Set(state.bookings.map(b => String(b.package || '').trim()))].filter(p => p).sort();
  if (select) {
    let html = '<option value="all">كل العروض 🕌</option>';
    packages.forEach(pkg => { html += `<option value="${escapeHtml(pkg)}">${escapeHtml(pkg)}</option>`; });
    select.innerHTML = html;
  }
  if (cardsContainer) {
    let cardsHtml = `<button type="button" class="pkg-filter-card active" data-pkg="all" onclick="selectPackageFilterCard(this,'all')">🕌 كل العروض</button>`;
    packages.forEach(pkg => {
      cardsHtml += `<button type="button" class="pkg-filter-card" data-pkg="${escapeHtml(pkg)}" onclick="selectPackageFilterCard(this,'${escapeJsString(pkg)}')">${escapeHtml(pkg)}</button>`;
    });
    cardsContainer.innerHTML = cardsHtml;
  }
}
/* Helper: Convert backend status to Arabic for filter matching */
function getArabicStatus(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'CONFIRMED' || status === 'تم التأكيد') return 'تم التأكيد';
  return 'لم يتم التأكيد';
}
/* ─── Search + Status Filters ─── */
function applyBookingFilters() {
  const searchInput = document.getElementById('booking-search');
  const statusSelect = document.getElementById('booking-status-filter');
  const packageSelect = document.getElementById('admin-package-filter');
  const q = (searchInput?.value || '').toLowerCase().trim();
  const statusFilter = statusSelect?.value || 'all';
  const packageFilter = packageSelect?.value || 'all';
  const rows = document.querySelectorAll('#list-bookings tr');
  rows.forEach(r => {
    // skip rows with no data (loader or empty message)
    if (r.cells.length < 5) return;
    const name = r.cells[0]?.innerText?.toLowerCase() || '';
    const phone = r.cells[1]?.innerText?.toLowerCase() || '';
    const pkg = r.getAttribute('data-package') || '';
    const status = r.getAttribute('data-status') || '';
    const matchesSearch = !q || name.includes(q) || phone.includes(q) || pkg.toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'all' || status === statusFilter;
    const matchesPackage = packageFilter === 'all' || pkg === packageFilter;

    r.style.display = (matchesSearch && matchesStatus && matchesPackage) ? '' : 'none';
  });
}
/* ─── Status Cycling ─── */
window.cycleBookingStatus = async (idx, curr) => {
  const statuses = ["PENDING", "CONFIRMED"];
  let currNormalized = curr;
  if (curr === "لم يتم التأكيد") currNormalized = "PENDING";
  if (curr === "تم التأكيد") currNormalized = "CONFIRMED";
  const next = statuses[(statuses.indexOf(currNormalized) + 1) % statuses.length];
  try {
    showToast('⏳ جاري تحديث الحالة...', 'info');
    await gasFetch('POST', { action: 'updateStatus', rowIndex: idx, status: next });
    showToast(`✅ تم تغيير الحالة إلى: ${STATUS_MAP[next]?.label || next}`, 'success');
    fetchAdminData();
  } catch (e) {
    showToast("❌ خطأ في تحديث الحالة", 'error');
  }
};
/* ─── Packages CRUD ─── */
function renderAdminPackages() {
  const container = document.getElementById('list-mgr-packages');
  const filterInput = document.getElementById('admin-pkg-list-filter');
  const searchTerm = (filterInput?.value || '').toLowerCase();
  const filtered = state.adminPackages.filter(p => {
    const item = normalizeItem(p);
    return String(item.name || '').toLowerCase().includes(searchTerm);
  });
  if (filtered.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-muted);">
          ${searchTerm ? 'لا توجد باقات تطابق البحث.' : 'لا توجد باقات. اضغط "+ عرض جديد" لإضافة أول باقة.'}
        </div>`;
    return;
  }
  container.innerHTML = filtered.map(p => {
    const seats = parseInt(p.seats) || 0;
    const booked = parseInt(p.booked) || 0;
    const remaining = seats - booked;
    const isFull = remaining <= 0;
    const isPublished = p.published === true;
    const rowIdx = Number(p.rowIndex);
    const imgUrl = escapeHtml(String(p.image || ''));
    const nameHtml = escapeHtml(p.name || 'بدون اسم');
    return `
        <div class="card" style="padding:18px; display:flex; gap:16px; align-items:center; flex-direction:row;">
           <img src="${imgUrl}" alt="" loading="lazy" decoding="async" style="width:56px; height:56px; border-radius:12px; object-fit:cover; border:1px solid var(--glass-border);" onerror="this.onerror=null;this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 60 60%22><rect fill=%22%23111%22 width=%2260%22 height=%2260%22/><text x=%2230%22 y=%2238%22 text-anchor=%22middle%22 font-size=%2224%22>🕋</text></svg>'">
           <div style="flex:1; min-width:0;">
             <strong style="display:block; margin-bottom:4px;">${nameHtml}</strong>
             <small style="color:var(--text-muted);">${isPublished ? '✅ منشور' : '❌ مخفي'} | <span style="color:${isFull ? 'var(--danger)' : 'var(--success)'}">${isFull ? 'ممتلئ' : '💺 ' + remaining + ' متبقي'}</span> | ${booked}/${seats} مقعد</small>
           </div>
           <button class="btn btn-s" onclick="showManager('package', ${rowIdx})" style="padding:10px 14px; font-size:0.85rem;" aria-label="تعديل">📝</button>
           <button class="btn-delete" onclick="performFinalDeletionRobustV4('OFFERS', ${rowIdx})" title="حذف الباقة" aria-label="حذف الباقة">${ICON_TRASH}</button>
        </div>
      `;
  }).join('');
}
/* ─── Offer Manager Modal ─── */
window.showManager = (type, rowIndex = null) => {
  const form = document.getElementById('form-manager');
  const title = document.getElementById('mgr-title');
  const modal = document.getElementById('modal-manager');
  let item = null;
  if (rowIndex) {
    item = state.adminPackages.find(x => x.rowIndex === rowIndex);
    if (item) item = normalizeItem(item);
  }
  title.textContent = rowIndex ? 'تعديل باقة' : '+ باقة جديدة';
  if (type === 'package') {
    form.innerHTML = `
          <input type="hidden" name="action" value="savePackage">
          <input type="hidden" name="rowIndex" value="${rowIndex || ''}">
          <div class="full-w field"><label class="label">اسم الباقة</label><input type="text" name="name" value="${item ? item.name : ''}" placeholder="مثال: عمرة رمضان 2025" required></div>
          <div class="field"><label class="label">السعر (دج)</label><input type="number" name="price" value="${item ? item.price : ''}" placeholder="85000" required></div>
          <div class="field"><label class="label">الفندق</label><input type="text" name="hotel" value="${item ? item.hotel : ''}" placeholder="فندق الحرم" required></div>
          <div class="field"><label class="label">تاريخ البداية</label><input type="date" name="start" value="${item ? formatDateInput(item.start) : ''}" required></div>
          <div class="field"><label class="label">تاريخ النهاية</label><input type="date" name="end" value="${item ? formatDateInput(item.end) : ''}" required></div>
          
          <div class="field"><label class="label">تاريخ الذهاب</label><input type="date" name="travelStart" value="${item ? formatDateInput(item.travelStart) : ''}"></div>
          <div class="field"><label class="label">تاريخ العودة</label><input type="date" name="travelEnd" value="${item ? formatDateInput(item.travelEnd) : ''}"></div>
          
          <div class="field"><label class="label">عدد المقاعد الكلي</label><input type="number" name="totalSeats" value="${item ? item.seats : '50'}" required></div>
          <div class="field"><label class="label">المحجوزة حالياً</label><input type="number" name="booked" value="${item ? item.booked : '0'}" required></div>
          <div class="full-w field"><label class="label">قائمة الغرف (نص)</label><input type="text" name="rooms" value="${item ? item.rooms : 'ثنائية، ثلاثية، رباعية'}" required></div>
          <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 12px;">
            <div class="field"><label class="label">سعر الثنائية</label><input type="number" name="priceDouble" value="${item ? item.priceDouble : ''}" placeholder="اختياري"></div>
            <div class="field"><label class="label">سعر الثلاثية</label><input type="number" name="priceTriple" value="${item ? item.priceTriple : ''}" placeholder="اختياري"></div>
            <div class="field"><label class="label">سعر الرباعية</label><input type="number" name="priceQuad" value="${item ? item.priceQuad : ''}" placeholder="اختياري"></div>
            <div class="field"><label class="label">سعر الخماسية</label><input type="number" name="priceQuint" value="${item ? item.priceQuint : ''}" placeholder="اختياري"></div>
          </div>
          <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 12px;">
            <div class="field"><label class="label">شركة الطيران</label><input type="text" name="airline" value="${item ? item.airline : ''}"></div>
            <div class="field"><label class="label">نوع الرحلة</label><input type="text" name="flightType" value="${item ? item.flightType : ''}"></div>
            <div class="field"><label class="label">المسافة عن الحرم</label><input type="text" name="distance" value="${item ? item.distance : ''}"></div>
            <div class="field"><label class="label">الإطعام</label><input type="text" name="food" value="${item ? item.food : ''}"></div>
          </div>
          <div class="full-w field"><label class="label">الوثائق المطلوبة</label><input type="text" name="documents" value="${item ? item.documents : ''}"></div>
          <div class="full-w field"><label class="label">الوصف الإضافي</label><textarea name="description" rows="3" style="width:100%; border-radius:12px; border:1px solid var(--glass-border); background:rgba(255,255,255,0.02); color:#fff; padding:12px;">${item ? item.description : ''}</textarea></div>
          <div class="full-w field"><label class="label">رابط خريطة الفندق</label><input type="url" name="hotelMap" value="${item ? item.hotelMap : ''}"></div>

          <div class="full-w field">
            <label class="label">صورة الفندق (رفع مباشر إلى Google Drive)</label>
            <input type="file" id="mgr-file" accept="image/*" onchange="previewMgrImage(this)">
            <input type="hidden" name="image" value="${item ? item.image : ''}">
            <div id="mgr-img-preview" style="margin-top:10px;">${item?.image ? `<img src="${item.image}" style="width:100%; max-height:150px; object-fit:cover; border-radius:12px; border:1px solid var(--glass-border);">` : ''}</div>
            <div id="mgr-upload-progress" style="display:none; margin-top:8px;">
              <div style="background:rgba(255,255,255,0.06); border-radius:8px; overflow:hidden; height:4px;">
                <div id="mgr-progress-bar" style="width:0%; height:100%; background: linear-gradient(90deg, var(--primary), var(--secondary)); border-radius:8px; transition: width 0.3s;"></div>
              </div>
              <small id="mgr-progress-text" style="color:var(--text-muted); margin-top:4px; display:block;">جاري الرفع...</small>
            </div>
          </div>
          <div class="full-w field" style="display: flex; gap: 12px; flex-direction: column;">
            <label class="label">نشر الباقة (متى يراها الزبائن)</label>
            <div class="custom-chips-group">
              <label class="chip-btn ${item?.published !== false ? 'active' : ''}" style="cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
                 <input type="radio" name="published" value="true" style="display:none;" ${item?.published !== false ? 'checked' : ''} onclick="this.parentElement.parentElement.querySelectorAll('.chip-btn').forEach(l=>l.classList.remove('active')); this.parentElement.classList.add('active');"> نعم — متاح للزبائن ✅
              </label>
              <label class="chip-btn ${item?.published === false ? 'active' : ''}" style="cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
                 <input type="radio" name="published" value="false" style="display:none;" ${item?.published === false ? 'checked' : ''} onclick="this.parentElement.parentElement.querySelectorAll('.chip-btn').forEach(l=>l.classList.remove('active')); this.parentElement.classList.add('active');"> لا — مخفي ❌
              </label>
            </div>
          </div>
          <button type="submit" class="btn btn-p full-w" id="mgr-submit-btn">
            <span class="mgr-btn-text">${rowIndex ? 'تحديث الباقة' : 'نشر الباقة'}</span>
            <span class="mgr-btn-loading" style="display:none;">جاري الحفظ والرفع...</span>
          </button>
        `;
  }
  // Form submission handler
  form.onsubmit = async (e) => {
    e.preventDefault();
    const subBtn = document.getElementById('mgr-submit-btn');
    const btnText = subBtn.querySelector('.mgr-btn-text');
    const btnLoading = subBtn.querySelector('.mgr-btn-loading');
    subBtn.disabled = true;
    btnText.style.display = 'none';
    btnLoading.style.display = 'inline';
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    const fileInput = document.getElementById('mgr-file');
    // Step 1: Upload image if selected
    if (fileInput && fileInput.files[0]) {
      btnLoading.textContent = '📤 جاري ضغط ورفع الصورة...';
      const progressDiv = document.getElementById('mgr-upload-progress');
      const progressBar = document.getElementById('mgr-progress-bar');
      const progressText = document.getElementById('mgr-progress-text');
      if (progressDiv) progressDiv.style.display = 'block';
      if (progressBar) progressBar.style.width = '10%';
      if (progressText) progressText.textContent = '⏳ جاري ضغط الصورة...';
      try {
        const compressedB64 = await compressAndConvert(fileInput.files[0], 1200, 0.8);
        if (progressBar) progressBar.style.width = '40%';
        if (progressText) progressText.textContent = '📤 جاري رفع الصورة إلى Google Drive...';
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'uploadImage',
            pass: sessionStorage.getItem('admin_token') || '',
            filename: fileInput.files[0].name,
            base64: compressedB64
          })
        });
        if (progressBar) progressBar.style.width = '80%';
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `خطأ في الخادم: ${res.status}`);
        }
        const upRes = await res.json();
        if (upRes.url) {
          payload.image = upRes.url;
          if (progressBar) progressBar.style.width = '100%';
          if (progressText) progressText.textContent = '✅ تم رفع الصورة بنجاح!';
          showToast('✅ تم رفع الصورة بنجاح', 'success');
        } else {
          throw new Error(upRes.error || 'لم يتم الحصول على رابط الصورة');
        }
      } catch (uploadErr) {
        console.error('Image upload failed:', uploadErr);
        if (progressBar) progressBar.style.width = '0%';
        if (progressText) progressText.textContent = '❌ فشل الرفع';

        // Final fallback for the specific error "ADMIN_KEY is not defined"
        let msg = uploadErr.message;
        if (msg.includes('ADMIN_KEY')) msg = "خطأ في مفتاح الإدارة. يرجى تسجيل الدخول مجدداً.";

        showToast(`❌ فشل رفع الصورة: ${msg || 'حاول مجدداً'}`, 'error');
        subBtn.disabled = false;
        btnText.style.display = 'inline';
        btnLoading.style.display = 'none';
        return;
      }
    }
    // Step 2: Prepare row values for Google Sheets
    btnLoading.textContent = '💾 جاري حفظ البيانات...';
    let values = [
      "",                           // id (0)
      payload.name,                 // الاسم (1)
      Number(payload.price),        // السعر (2)
      payload.start || '',          // البداية (3)
      payload.end || '',            // النهاية (4)
      payload.hotel,                // الفندق (5)
      Number(payload.totalSeats),   // المقاعد (6)
      Number(payload.booked),       // المحجوزة (7)
      payload.rooms,                // الغرف (8)
      payload.published === 'true', // منشور (9)
      payload.airline || '',        // AIRLINE (10)
      payload.flightType || '',     // FLIGHT_TYPE (11)
      payload.documents || '',      // DOCUMENTS (12)
      payload.distance || '',       // DISTANCE (13)
      payload.food || '',           // FOOD (14)
      payload.hotelMap || '',       // HOTEL_MAP (15)
      payload.description || '',    // DESCRIPTION (16)
      payload.image || '',          // IMAGES (17)
      payload.travelStart || '',    // TRAVEL_START (18)
      payload.travelEnd || ''       // TRAVEL_END (19)
    ];
    // Step 3: Save to Google Sheets
    try {
      const saveResult = await gasFetch('POST', {
        action: payload.action,
        key: sessionStorage.getItem('admin_token'),
        data: {
          rowIndex: payload.rowIndex !== undefined && payload.rowIndex !== null ? payload.rowIndex : -1,
          values: values
        }
      });
      if (saveResult.error) {
        showToast(`❌ ${saveResult.error}`, 'error');
      } else {
        showToast('🕌 تم حفظ الباقة بنجاح!', 'success');
        closeModal('modal-manager');
        setTimeout(async () => {
          await fetchAdminData();
          await fetchInitialData();
        }, 1500);
      }
    } catch (saveErr) {
      console.error('Save failed:', saveErr);
      showToast(`❌ حدث خطأ أثناء الحفظ: ${saveErr.message}`, 'error');
    } finally {
      subBtn.disabled = false;
      btnText.style.display = 'inline';
      btnLoading.style.display = 'none';
    }
  };
  window.openModal('modal-manager');
};
/* ─── Delete ─── */
window.performFinalDeletionRobustV4 = async (type, rowIndex) => {
  if (!confirm("هل أنت متأكد من الحذف النهائي لهذا السجل؟")) return;
  const idx = parseInt(rowIndex, 10);
  if (isNaN(idx)) {
    showToast('❌ خطأ في تحديد الصف', 'error');
    return;
  }
  try {
    showToast('⏳ جاري الحذف...', 'info');
    const token = sessionStorage.getItem('admin_token');
    const payload = {
      action: 'delete',
      pass: token,
      type: type,
      rowIndex: idx
    };
    await gasFetch('POST', payload);
    showToast('✅ تم الحذف بنجاح', 'success');
    console.log(`🗑️ Deleted ${type} row ${idx}`);
    setTimeout(async () => {
      await fetchAdminData();
      await fetchInitialData();
    }, 1500);
  } catch (e) {
    console.error("❌ Deletion Critical Error:", e);
    const errorMsg = e.message || "خطأ غير معروف";
    showToast(`❌ فشل الحذف: ${errorMsg}`, 'error');
  }
};
/* ═══════════════════════════════════════════════════════
   5. EXPORTS — Excel / PDF / Word (BUG FIX: normalized keys)
   ═══════════════════════════════════════════════════════ */
function getFilteredBookings() {
  const searchInput = document.getElementById('booking-search');
  const statusSelect = document.getElementById('booking-status-filter');
  const packageSelect = document.getElementById('admin-package-filter');
  const q = (searchInput?.value || '').toLowerCase();
  const statusFilter = statusSelect?.value || 'all';
  const packageFilter = packageSelect?.value || 'all';
  return state.bookings.filter(b => {
    const fullText = `${b.firstName || ''} ${b.lastName || ''} ${b.phone || ''} ${b.package || ''}`.toLowerCase();
    const matchesSearch = fullText.includes(q);

    const arabicStatus = getArabicStatus(b.status);
    const matchesStatus = statusFilter === 'all' || arabicStatus === statusFilter;

    const pkgName = String(b.package || '').trim();
    const matchesPackage = packageFilter === 'all' || pkgName === packageFilter;

    return matchesSearch && matchesStatus && matchesPackage;
  });
}
window.exportData = (format) => {
  const filtered = getFilteredBookings();
  if (filtered.length === 0) {
    showToast("⚠️ لا توجد بيانات للتصدير مع الفلتر الحالي.", 'error');
    return;
  }
  // FIX: Use normalized English keys for export mapping
  const data = filtered.map(b => ({
    "الاسم": `${b.firstName || ''} ${b.lastName || ''}`,
    "الهاتف": b.phone || '',
    "الباقة": b.package || '',
    "الأشخاص": b.pax || '',
    "الغرفة": b.roomType || '',
    "الحالة": getArabicStatus(b.status),
    "التاريخ": b.timestamp || ''
  }));
  if (format === 'xlsx') exportExcel(data);
  else if (format === 'pdf') exportPDF(data);
  else if (format === 'docx') exportWord(data);
};
/* Lazy-load the xlsx library only when needed (admin-only feature) */
let _xlsxPromise = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (_xlsxPromise) return _xlsxPromise;
  _xlsxPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.async = true;
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('فشل تحميل مكتبة Excel'));
    document.head.appendChild(s);
  });
  return _xlsxPromise;
}

function _sanitizeForFilename(s) {
  return String(s || '')
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '_')
    .trim();
}

/** Filename like حجوزات_عمرة_جوان_2026.pdf or حجوزات_كل_العروض.pdf */
function buildReportFilename(ext) {
  const pkgFilter = document.getElementById('admin-package-filter')?.value || 'all';
  const statusFilter = document.getElementById('booking-status-filter')?.value || 'all';
  const parts = ['حجوزات'];
  if (pkgFilter && pkgFilter !== 'all') parts.push(pkgFilter);
  else parts.push('كل_العروض');
  if (statusFilter && statusFilter !== 'all') parts.push(statusFilter);
  return _sanitizeForFilename(parts.join('_')) + '.' + ext;
}

function buildReportFilterLabel(sep = ' - ') {
  const statusFilter = document.getElementById('booking-status-filter')?.value || 'all';
  const pkgFilter = document.getElementById('admin-package-filter')?.value || 'all';
  const calLabel = (typeof _calendarDateFilter !== 'undefined' && _calendarDateFilter)
    ? `${sep}يوم: ${_calendarDateFilter}` : '';
  return ([
    statusFilter === 'all' ? '' : statusFilter,
    pkgFilter === 'all' ? '' : pkgFilter
  ].filter(Boolean).join(sep) || 'all') + calLabel;
}

async function exportExcel(data) {
  try {
    const XLSX = await loadXLSX();
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bookings');
    XLSX.writeFile(wb, buildReportFilename('xlsx'));
  } catch (e) {
    console.error('Excel export failed:', e);
    showToast('❌ فشل تصدير Excel. حاول مجدداً.', 'error');
  }
}

function exportPDF(data) {
  const filterLabel = buildReportFilterLabel(' - ');
  const docTitle = buildReportFilename('pdf').replace(/\.pdf$/i, '');
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    showToast('⚠️ يرجى السماح بالنوافذ المنبثقة.', 'error');
    return;
  }
  const rowsHtml = data.map(row => `
    <tr>
      <td style="text-align:right;">${escapeHtml(row['الاسم'])}</td>
      <td dir="ltr" style="text-align:center; font-family: monospace; font-size: 14px;">${escapeHtml(row['الهاتف'])}</td>
      <td style="text-align:right;">${escapeHtml(row['الباقة'])}</td>
      <td style="text-align:center; font-weight:bold; font-size: 15px; color:#309aaf;">${escapeHtml(String(row['الأشخاص']))}</td>
      <td style="text-align:center;">${escapeHtml(row['الغرفة'])}</td>
      <td style="text-align:center;">${escapeHtml(row['الحالة'])}</td>
      <td style="text-align:center; font-size:12px;">${row['التاريخ'] ? escapeHtml(new Date(row['التاريخ']).toLocaleString('ar-DZ')) : '-'}</td>
    </tr>`).join('');
  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(docTitle)}</title>
  <style>
    body { font-family: 'Tajawal', Tahoma, Arial, sans-serif; padding: 30px; color: #1a1a1a; background: #fff; margin: 0; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #309aaf; padding-bottom: 16px; margin-bottom: 24px; }
    .header h1 { margin: 0; color: #1a1a1a; font-size: 22px; font-weight: 800; }
    .header p { margin: 8px 0 0; color: #555; font-size: 13px; }
    .logo { font-size: 20px; font-weight: 900; color: #ae9073; white-space: nowrap; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
    th, td { border: 1px solid #ccc; padding: 10px 12px; text-align: center; }
    th { background-color: #1e2a66; color: #fff; font-weight: bold; }
    tr:nth-child(even) { background-color: #f4f6fb; }
    .footer { margin-top: 36px; text-align: center; color: #555; font-size: 12px; border-top: 1px solid #ccc; padding-top: 14px; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>تقرير حجوزات وكالة حواس للسياحة والسفر</h1>
      <p>الفلتر: <strong>${escapeHtml(filterLabel)}</strong> | إجمالي الحجوزات: <strong>${data.length}</strong> | التاريخ: <strong>${escapeHtml(new Date().toLocaleDateString('ar-DZ'))}</strong></p>
    </div>
    <div class="logo">HAOUES TRAVEL</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>الاسم الكامل</th><th>الهاتف</th><th>الباقة</th><th>الأشخاص</th><th>الغرفة</th><th>الحالة</th><th>تاريخ التسجيل</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="footer">© ${new Date().getFullYear()} Haoues Travel — All rights reserved.</div>
</body>
</html>`;
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  setTimeout(() => { printWindow.print(); }, 300);
}

function exportWord(data) {
  const filterLabel = buildReportFilterLabel(' • ');
  const rowsHtml = data.map(row => `
    <tr>
      <td>${escapeHtml(row['الاسم'])}</td>
      <td dir="ltr">${escapeHtml(row['الهاتف'])}</td>
      <td>${escapeHtml(row['الباقة'])}</td>
      <td>${escapeHtml(String(row['الأشخاص']))}</td>
      <td>${escapeHtml(row['الغرفة'])}</td>
      <td>${escapeHtml(row['الحالة'])}</td>
      <td>${row['التاريخ'] ? escapeHtml(new Date(row['التاريخ']).toLocaleString('ar-DZ')) : '-'}</td>
    </tr>`).join('');
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8">
<title>Haoues Travel — تقرير الحجوزات</title>
<style>
  body { font-family: 'Tajawal', Tahoma, sans-serif; direction: rtl; padding: 30px; background: #fff; color: #1a1a1a; }
  h1 { color: #1a1a1a; border-bottom: 2px solid #309aaf; padding-bottom: 10px; }
  .info { color: #555; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  th { background: #1e2a66; color: #fff; padding: 12px; border: 1px solid #ccc; }
  td { padding: 10px; border: 1px solid #ccc; text-align: right; }
  tr:nth-child(even) { background: #f4f6fb; }
  .footer { margin-top: 30px; color: #555; font-size: 11px; border-top: 1px solid #ccc; padding-top: 10px; }
</style></head>
<body>
  <h1>Haoues Travel — تقرير الحجوزات — ${escapeHtml(filterLabel)}</h1>
  <p class="info">الفلتر: ${escapeHtml(filterLabel)} | إجمالي النتائج: ${data.length} حجز | تاريخ التصدير: ${escapeHtml(new Date().toLocaleDateString('ar-DZ'))}</p>
  <table>
    <thead>
      <tr><th>الاسم</th><th>الهاتف</th><th>الباقة</th><th>الأشخاص</th><th>الغرفة</th><th>الحالة</th><th>التاريخ</th></tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <p class="footer">© ${new Date().getFullYear()} Haoues Travel — All rights reserved.</p>
</body></html>`;
  const blob = new Blob(['\ufeff' + html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = buildReportFilename('doc');
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
/* ═══════════════════════════════════════════════════════
   6. UTILITIES
   ═══════════════════════════════════════════════════════ */
function formatDate(iso) {
  if (!iso) return '-';
  let rawDate = iso;
  if (typeof iso === 'string' && iso.startsWith('T_')) {
    rawDate = iso.substring(2);
  }
  try {
    const d = new Date(rawDate);
    if (isNaN(d.getTime())) return '-';
    return new Intl.DateTimeFormat('ar-DZ', {
      year: 'numeric', month: 'long', day: 'numeric'
    }).format(d);
  } catch (e) {
    return '-';
  }
}
function formatDateInput(iso) {
  if (!iso) return '';
  let rawDate = iso;
  if (typeof iso === 'string' && iso.startsWith('T_')) {
    rawDate = iso.substring(2);
  }
  const d = new Date(rawDate);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return '';
}
/* ─── Image Compression ─── */
function compressAndConvert(file, maxWidth = 1200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onerror = () => reject(new Error('فشل قراءة الملف'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('فشل تحميل الصورة'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width;
        let h = img.height;
        if (w > maxWidth) {
          h = Math.round(h * (maxWidth / w));
          w = maxWidth;
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL('image/jpeg', quality);
        console.log(`📸 Image compressed: ${(file.size / 1024).toFixed(0)}KB → ${(compressed.length * 0.75 / 1024).toFixed(0)}KB (${w}x${h})`);
        resolve(compressed);
      };
      img.src = e.target.result;
    };
  });
}
/* ─── Tab Switching ─── */
window.switchTab = (tab) => {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
  document.querySelector(`.tab[onclick*="${tab}"]`).classList.add('active');
  document.getElementById(`tab-${tab}`).style.display = 'block';
};
/* ═══════════════════════════════════════════════════════
   7. TOAST NOTIFICATION SYSTEM
   ═══════════════════════════════════════════════════════ */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  const colors = {
    success: { border: 'var(--success)', bg: 'rgba(0, 230, 195, 0.1)', text: 'var(--success)' },
    error: { border: 'var(--danger)', bg: 'rgba(255, 71, 87, 0.1)', text: 'var(--danger)' },
    info: { border: 'var(--secondary)', bg: 'rgba(15, 76, 117, 0.15)', text: '#5fb8e4' }
  };
  const c = colors[type] || colors.info;
  toast.style.cssText = `
    padding: 14px 28px;
    border-radius: 14px;
    font-weight: 700;
    font-size: 0.9rem;
    pointer-events: auto;
    animation: toast-in 0.4s ease forwards;
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    border: 1px solid ${c.border};
    background: ${c.bg};
    color: ${c.text};
    box-shadow: 0 8px 30px rgba(0,0,0,0.3);
    max-width: 480px;
    text-align: center;
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toast-out 0.4s ease forwards';
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}
/* ─── Image Preview in Manager Modal ─── */
window.previewMgrImage = (input) => {
  const previewDiv = document.getElementById('mgr-img-preview');
  if (!previewDiv) return;
  if (input.files && input.files[0]) {
    const file = input.files[0];
    if (file.size > 5 * 1024 * 1024) {
      showToast('⚠️ حجم الصورة كبير جداً (الحد الأقصى 5MB). سيتم ضغطها تلقائياً عند الرفع.', 'info');
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      previewDiv.innerHTML = `
        <img src="${e.target.result}" style="width:100%; max-height:180px; object-fit:cover; border-radius:12px; border: 1px solid var(--glass-border);">
        <small style="color:var(--success); display:block; margin-top:5px;">✅ ${file.name} (${(file.size / 1024).toFixed(0)} KB) — سيتم ضغطها تلقائياً</small>
      `;
    };
    reader.readAsDataURL(file);
  } else {
    previewDiv.innerHTML = '';
  }
};
/* ═══════════════════════════════════════════════════════
   18. CANVAS GRID ANIMATION
   ═══════════════════════════════════════════════════════ */
function initCanvasGrid() {
  const canvas = document.getElementById('grid-canvas');
  if (!canvas) return;
  if (PREFERS_REDUCED_MOTION) {
    canvas.style.display = 'none';
    return;
  }

  const ctx = canvas.getContext('2d');
  let w, h;
  let mouse = { x: -1000, y: -1000 };
  const gridSize = 70;
  let offsetY = 0;
  let offsetX = 0;
  let rafId = null;
  let isVisible = !document.hidden;
  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }

  window.addEventListener('resize', resize);
  window.addEventListener('mousemove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    isVisible = !document.hidden;
    if (isVisible && rafId == null) { rafId = requestAnimationFrame(draw); }
  });
  resize();
  function draw() {
    ctx.clearRect(0, 0, w, h);

    // Draw moving grid
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
    ctx.lineWidth = 1;
    // Vertical
    for (let x = (offsetX % gridSize); x <= w; x += gridSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    // Horizontal
    for (let y = (offsetY % gridSize); y <= h; y += gridSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    // Draw interactive dots at intersections
    const startX = (offsetX % gridSize);
    const startY = (offsetY % gridSize);
    for (let x = startX; x <= w; x += gridSize) {
      for (let y = startY; y <= h; y += gridSize) {
        const dx = mouse.x - x;
        const dy = mouse.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = 250;

        let dotSize = 1;
        let opacity = 0.1;
        if (dist < maxDist) {
          const factor = 1 - (dist / maxDist);
          dotSize = 1 + factor * 3;
          opacity = 0.1 + factor * 0.4;

          // Subtle glow for nearby dots
          ctx.beginPath();
          ctx.arc(x, y, dotSize * 2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(194, 31, 42, ${opacity * 0.3})`;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(x, y, dotSize, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
        ctx.fill();
      }
    }
    offsetY -= 0.35; // Move up
    offsetX -= 0.15; // Slight drift
    requestAnimationFrame(draw);
  }
  draw();
}
// Calendar functionality removed.
/* ═══════════════════════════════════════════════════════
   5. OFFER DETAIL & LIGHTBOX
   ═══════════════════════════════════════════════════════ */
let _currentOfferImages = [];
window.openOfferDetailModal = (packageName) => {
  const pkg = state.packages.find(p => {
    const item = normalizeItem(p);
    return item.name === packageName;
  });
  if (!pkg) return;
  const item = normalizeItem(pkg);
  // Populate data
  document.getElementById('offer-detail-title').textContent = item.name || 'بدون عنوان';
  const priceNum = Number(item.price);
  document.getElementById('offer-detail-price').textContent = Number.isFinite(priceNum) && priceNum > 0
    ? `ابتداءً من ${priceNum.toLocaleString()} دج`
    : 'السعر قيد التحديث';

  const remaining = (item.seats || 0) - (item.booked || 0);
  const isFull = remaining <= 0;
  const statusEl = document.getElementById('offer-detail-status');
  statusEl.textContent = isFull ? 'ممتلئ' : 'متاح';
  statusEl.className = `badge ${isFull ? 'badge-f' : 'badge-m'}`;
  // Travel Dates handling
  const datesEl = document.getElementById('offer-detail-dates');
  datesEl.innerHTML = '';
  if (item.travelStart || item.travelEnd) {
    if (item.travelStart) {
      const line = document.createElement('div');
      line.textContent = `الذهاب: ${formatDate(item.travelStart)}`;
      datesEl.appendChild(line);
    }
    if (item.travelEnd) {
      const line = document.createElement('div');
      line.textContent = `العودة: ${formatDate(item.travelEnd)}`;
      datesEl.appendChild(line);
    }
  } else {
    datesEl.textContent = formatDate(item.start);
  }
  document.getElementById('offer-detail-hotel').textContent = item.hotel || '—';
  document.getElementById('offer-detail-airline').textContent = item.airline || '—';
  document.getElementById('offer-detail-food').textContent = item.food || '—';
  document.getElementById('offer-detail-distance').textContent = item.distance || '—';
  // Fixed: use normalized `documents` instead of undefined `docs`
  document.getElementById('offer-detail-docs').textContent = item.documents || 'جواز سفر صالح';
  // Rooms
  const roomsEl = document.getElementById('offer-detail-rooms');
  roomsEl.innerHTML = (item.rooms || 'ثنائية، ثلاثية، رباعية')
    .split(/[،,]/)
    .map(r => r.trim())
    .filter(Boolean)
    .map(r => `<span class="chip-btn" style="padding: 4px 10px; font-size: 0.8rem; cursor: default;">${escapeHtml(r)}</span>`)
    .join('');
  // Desc — use textContent + pre-line CSS to preserve line breaks without HTML injection
  const descEl = document.getElementById('offer-detail-desc');
  descEl.style.whiteSpace = 'pre-line';
  descEl.textContent = item.description || item.text || 'لا توجد تفاصيل إضافية.';
  // Image button for Lightbox
  const sliderContainer = document.getElementById('offer-detail-slider-container');
  let imgs = [];
  if (item.images) {
    try {
      const parsed = JSON.parse(item.images);
      if (Array.isArray(parsed)) imgs = parsed;
    } catch (e) {
      if (typeof item.images === 'string') imgs = item.images.split(',').map(s => s.trim()).filter(Boolean);
    }
  } else if (item.image) {
    imgs = typeof item.image === 'string' ? item.image.split(',').map(s => s.trim()).filter(Boolean) : [item.image];
  }
  imgs = imgs.filter(u => typeof u === 'string' && u.trim());
  _currentOfferImages = imgs;

  if (imgs.length > 0) {
    sliderContainer.innerHTML = `
      <div style="background: rgba(255,255,255,0.03); padding: 30px; text-align: center; border-bottom: 1px solid var(--glass-border); cursor: pointer;" onclick="openCurrentOfferLightbox()" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openCurrentOfferLightbox();}">
        <div style="font-size: 3rem; margin-bottom: 10px;">📸</div>
        <h3 style="color: var(--primary-light);">تصفح صور الفندق</h3>
        <p style="color: var(--text-muted); font-size: 0.85rem;">انقر هنا لمشاهدة الصور (${imgs.length})</p>
      </div>
    `;
  } else {
    sliderContainer.innerHTML = '';
  }
  // Hotel map button (if configured)
  const mapBtn = document.getElementById('offer-detail-map-btn');
  if (mapBtn) {
    const mapUrl = item.hotelMap || item['رابط_الفندق'] || '';
    if (mapUrl && /^https?:\/\//i.test(mapUrl)) {
      mapBtn.href = mapUrl;
      mapBtn.style.display = '';
      mapBtn.rel = 'noopener noreferrer';
    } else {
      mapBtn.href = '#';
      mapBtn.style.display = 'none';
    }
  }
  // Book button
  const bookBtn = document.getElementById('offer-detail-book-btn');
  bookBtn.textContent = isFull ? 'انتهت المقاعد' : 'احجز الآن ✈️';
  bookBtn.disabled = isFull;
  bookBtn.onclick = () => {
    closeModal('modal-offer-detail');
    openBookingModal(packageName);
  };
  window.openModal('modal-offer-detail');
};

window.openCurrentOfferLightbox = () => {
  if (!_currentOfferImages || !_currentOfferImages.length) return;
  window.openLightbox(_currentOfferImages);
};
let lightboxImages = [];
let currentLightboxIndex = 0;
let touchStartX = 0;
let touchEndX = 0;
let touchMoveX = 0;
let isDragging = false;
/* Convert Google Drive share links to their embed thumbnail form so they render
   reliably cross-origin without referrer blocks. */
function normalizeImageUrl(u) {
  if (!u || typeof u !== 'string') return '';
  const url = u.trim();
  // Already a direct image URL
  if (/googleusercontent\.com|\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(url)) return url;
  // Drive file ID extraction
  let id = null;
  let m = url.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) id = m[1];
  if (!id) { m = url.match(/[?&]id=([a-zA-Z0-9_-]{20,})/); if (m) id = m[1]; }
  if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=w1600`;
  return url;
}

window.openLightbox = (images) => {
  const list = Array.isArray(images) ? images : String(images || '').split(',');
  lightboxImages = list.map(s => normalizeImageUrl(String(s).trim())).filter(Boolean);
  if (!lightboxImages.length) return;
  currentLightboxIndex = 0;

  const track = document.getElementById('lightbox-track');
  track.innerHTML = lightboxImages.map((img, i) => `
            <div class="lightbox-slide ${i === 0 ? 'active' : ''}" id="lb-slide-${i}">
              <img src="${escapeHtml(img)}" alt="صورة الفندق" loading="${i === 0 ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer"
                   onerror="this.onerror=null;this.insertAdjacentHTML('afterend','<div class=&quot;lb-fail&quot; style=&quot;color:#cbd2e6;padding:24px;text-align:center;&quot;>تعذر تحميل الصورة</div>');this.style.display='none';">
            </div>
          `).join('');

  window.openModal('lightbox-overlay');
  document.getElementById('lightbox-counter').textContent = `1 / ${lightboxImages.length}`;
  document.addEventListener('keydown', handleLightboxKeydown);
};
window.closeLightbox = () => {
  const lb = document.getElementById('lightbox-overlay');
  if (lb) lb.classList.remove('active');
  const anyOpen = document.querySelector('.modal-overlay.active');
  if (!anyOpen) document.body.style.overflow = '';
  document.removeEventListener('keydown', handleLightboxKeydown);
};
function setLightboxImage(newIndex, direction) {
  if (lightboxImages.length <= 1 || newIndex === currentLightboxIndex) return;
  const oldSlide = document.getElementById(`lb-slide-${currentLightboxIndex}`);
  const newSlide = document.getElementById(`lb-slide-${newIndex}`);
  if (!newSlide) return;

  if (oldSlide) {
    oldSlide.classList.remove('active');
    oldSlide.style.transform = '';
  }
  newSlide.classList.add('active');
  newSlide.style.transform = '';

  currentLightboxIndex = newIndex;
  document.getElementById('lightbox-counter').textContent = `${currentLightboxIndex + 1} / ${lightboxImages.length}`;
}
window.lightboxNext = () => {
  let next = currentLightboxIndex + 1;
  if (next >= lightboxImages.length) next = 0;
  setLightboxImage(next, 'next');
};
window.lightboxPrev = () => {
  let prev = currentLightboxIndex - 1;
  if (prev < 0) prev = lightboxImages.length - 1;
  setLightboxImage(prev, 'prev');
};
function handleLightboxKeydown(e) {
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') lightboxNext();
  if (e.key === 'ArrowRight') lightboxPrev();
}
// Mobile Swipe Support
const overlay = document.getElementById('lightbox-overlay');
if (overlay) {
  overlay.addEventListener('touchstart', e => {
    isDragging = true;
    touchStartX = e.changedTouches[0].screenX;
    touchMoveX = touchStartX;
    const currentSlide = document.getElementById(`lb-slide-${currentLightboxIndex}`);
    if (currentSlide) currentSlide.style.transition = 'none';
  }, { passive: true });
  overlay.addEventListener('touchmove', e => {
    if (!isDragging) return;
    touchMoveX = e.changedTouches[0].screenX;
    const diff = touchMoveX - touchStartX;
    const currentSlide = document.getElementById(`lb-slide-${currentLightboxIndex}`);
    // Apply rubber band effect if only 1 image, else slide it normally
    if (currentSlide) {
      if (lightboxImages.length === 1) {
        currentSlide.style.transform = `translateX(${diff * 0.3}px)`;
      } else {
        currentSlide.style.transform = `translateX(${diff}px)`;
      }
    }
  }, { passive: true });
  overlay.addEventListener('touchend', e => {
    isDragging = false;
    touchEndX = e.changedTouches[0].screenX;
    const distance = touchEndX - touchStartX;
    const currentSlide = document.getElementById(`lb-slide-${currentLightboxIndex}`);

    if (currentSlide) currentSlide.style.transition = 'transform 350ms cubic-bezier(0.4, 0, 0.2, 1)';
    if (Math.abs(distance) < 50 || lightboxImages.length <= 1) {
      // Bounce back
      if (currentSlide) currentSlide.style.transform = 'translateX(0)';
      return;
    }

    // In RTL, swipe left (negative) means go to next image
    if (distance < -50) lightboxNext();
    if (distance > 50) lightboxPrev();
  }, { passive: true });
}
