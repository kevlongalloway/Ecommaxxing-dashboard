/* =============================================================
   Blackstar Admin Dashboard
   ============================================================= */
'use strict';

// ── Config ─────────────────────────────────────────────────────
const Config = {
  workerUrl: null,
  async load() {
    const res = await fetch('/config');
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Failed to load configuration');
    this.workerUrl = data.workerUrl;
  },
};

// ── Auth ────────────────────────────────────────────────────────
const Auth = {
  _key: 'blackstar_admin_token',
  getToken()   { return sessionStorage.getItem(this._key); },
  setToken(t)  { sessionStorage.setItem(this._key, t); },
  clearToken() { sessionStorage.removeItem(this._key); },
  isLoggedIn() { return !!this.getToken(); },

  async login(username, password) {
    const res  = await fetch(`${Config.workerUrl}/admin/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    });
    const body = await res.json();
    if (!body.ok) throw new ApiError(body.error, res.status);
    this.setToken(body.data.token);
  },

  logout() {
    this.clearToken();
    Router.go('/login');
  },
};

// ── ApiError ────────────────────────────────────────────────────
class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name    = 'ApiError';
    this.status  = status;
    this.details = details;
  }
}

// ── Api ─────────────────────────────────────────────────────────
function qs(params = {}) {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
  const s = new URLSearchParams(clean).toString();
  return s ? `?${s}` : '';
}

const Api = {
  // Returns the whole envelope — `data` plus any sibling keys such as `pagination`.
  async _envelope(path, opts = {}) {
    const token = Auth.getToken();
    const res = await fetch(`${Config.workerUrl}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
    });
    const body = await res.json();
    if (!res.ok || !body.ok) {
      if (res.status === 401) { Auth.clearToken(); Router.go('/login'); }
      throw new ApiError(body.error ?? 'Unknown error', res.status, body.details);
    }
    return body;
  },

  async _fetch(path, opts = {}) {
    return (await this._envelope(path, opts)).data;
  },

  getProducts(params = {}) {
    return this._fetch(`/admin/products${qs(params)}`);
  },

  getProduct(id)       { return this._fetch(`/admin/products/${id}`); },
  createProduct(data)  { return this._fetch('/admin/products', { method: 'POST', body: JSON.stringify(data) }); },
  updateProduct(id, d) { return this._fetch(`/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(d) }); },
  deleteProduct(id)    { return this._fetch(`/admin/products/${id}`, { method: 'DELETE' }); },
  reorderProducts(products) { return this._fetch('/admin/products/reorder', { method: 'PUT', body: JSON.stringify({ products }) }); },

  async uploadImage(file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${Config.workerUrl}/admin/images/upload`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${Auth.getToken()}` },
      body:    form,
    });
    const body = await res.json();
    if (!res.ok || !body.ok) throw new ApiError(body.error ?? 'Upload failed', res.status);
    return body.data; // { url, key }
  },

  deleteImage(key) {
    return this._fetch(`/admin/images/${encodeURIComponent(key)}`, { method: 'DELETE' });
  },

  // Orders — returns the envelope so callers get `pagination` alongside `data`
  getOrders(params = {}) {
    return this._envelope(`/admin/orders${qs(params)}`);
  },

  getOrder(id)          { return this._fetch(`/admin/orders/${id}`); },
  updateOrder(id, data) { return this._fetch(`/admin/orders/${id}`, { method: 'PUT', body: JSON.stringify(data) }); },

  getOrderRates(id, params) {
    return this._fetch(`/admin/orders/${id}/rates${qs(params)}`);
  },

  generateShippingLabel(id, data) {
    return this._fetch(`/admin/orders/${id}/shipping-label`, { method: 'POST', body: JSON.stringify(data) });
  },

  // Analytics
  getDashboard(params = {})   { return this._fetch(`/admin/analytics/dashboard${qs(params)}`); },
  getOverview(params = {})    { return this._fetch(`/admin/analytics/overview${qs(params)}`); },
  getTimeseries(params = {})  { return this._fetch(`/admin/analytics/timeseries${qs(params)}`); },
  getTopProducts(params = {}) { return this._fetch(`/admin/analytics/top-products${qs(params)}`); },

  // Newsletter
  getSubscribers(params = {})  { return this._envelope(`/admin/newsletter/subscribers${qs(params)}`); },
  getNewsletterStats()         { return this._fetch('/admin/newsletter/stats'); },
  updateSubscriber(id, data)   { return this._fetch(`/admin/newsletter/subscribers/${id}`, { method: 'PUT', body: JSON.stringify(data) }); },
  deleteSubscriber(id)         { return this._fetch(`/admin/newsletter/subscribers/${id}`, { method: 'DELETE' }); },

  // CSV export — text/csv, not the JSON envelope
  async exportSubscribers(params = {}) {
    const res = await fetch(`${Config.workerUrl}/admin/newsletter/export${qs(params)}`, {
      headers: { Authorization: `Bearer ${Auth.getToken()}` },
    });
    if (res.status === 401) { Auth.clearToken(); Router.go('/login'); throw new ApiError('Session expired', 401); }
    if (!res.ok) throw new ApiError('Export failed', res.status);
    return res.blob();
  },

  // Settings
  getHeaderVideo()          { return this._fetch('/admin/settings/header-video'); },
  updateHeaderVideo(data)   { return this._fetch('/admin/settings/header-video', { method: 'PUT', body: JSON.stringify(data) }); },
  clearHeaderVideo()        { return this._fetch('/admin/settings/header-video', { method: 'DELETE' }); },
};

// ── Toast ───────────────────────────────────────────────────────
const Toast = {
  _container: null,
  _ensure() {
    if (this._container) return;
    this._container = Object.assign(document.createElement('div'), {
      className: 'toast-container position-fixed bottom-0 end-0 p-3',
    });
    this._container.style.zIndex = '9999';
    document.body.appendChild(this._container);
  },

  show(message, type = 'success') {
    this._ensure();
    const id    = `t${Date.now()}`;
    const icon  = type === 'success' ? 'bi-check-circle-fill text-success' : 'bi-exclamation-triangle-fill text-danger';
    const html  = `
      <div id="${id}" class="toast align-items-center border-secondary" role="alert">
        <div class="d-flex">
          <div class="toast-body d-flex align-items-center gap-2">
            <i class="bi ${icon}"></i>
            <span>${escHtml(message)}</span>
          </div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
      </div>`;
    this._container.insertAdjacentHTML('beforeend', html);
    const el = document.getElementById(id);
    const t  = new bootstrap.Toast(el, { delay: 4000 });
    t.show();
    el.addEventListener('hidden.bs.toast', () => el.remove());
  },

  success(msg) { this.show(msg, 'success'); },
  error(msg)   { this.show(msg, 'error'); },
};

// ── Helpers ─────────────────────────────────────────────────────
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatPrice(cents, currency = 'usd') {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function parsePriceInput(input) {
  const n = parseFloat(String(input).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : Math.round(n * 100);
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(iso));
}

function stockBadge(stock) {
  if (stock === -1) return '<span class="badge text-bg-secondary">Unlimited</span>';
  if (stock ===  0) return '<span class="badge text-bg-danger">Sold out</span>';
  if (stock <=   4) return `<span class="badge text-bg-warning">Only ${stock} left</span>`;
  return `<span class="badge text-bg-success">${stock} in stock</span>`;
}

function activeBadge(active) {
  return active
    ? '<span class="badge text-bg-success">Active</span>'
    : '<span class="badge text-bg-secondary">Inactive</span>';
}

function statusBadge(s) {
  const cls = { pending: 'text-bg-warning', paid: 'text-bg-success', fulfilled: 'text-bg-primary', cancelled: 'text-bg-secondary' };
  return `<span class="badge ${cls[s] ?? 'text-bg-secondary'}">${escHtml(s ?? '—')}</span>`;
}

function fulfillmentBadge(s) {
  const cls = { unfulfilled: 'text-bg-danger', processing: 'text-bg-warning', shipped: 'text-bg-info', delivered: 'text-bg-success' };
  return `<span class="badge ${cls[s] ?? 'text-bg-secondary'}">${escHtml(s ?? '—')}</span>`;
}

function currencySymbol(code) {
  return { usd: '$', eur: '€', gbp: '£' }[code] ?? code.toUpperCase();
}

// ── Analytics helpers ───────────────────────────────────────────
// Minutes east of UTC — must go on every analytics request or "today"
// means 00:00 UTC and the numbers look wrong.
function tzOffsetMinutes() {
  return -new Date().getTimezoneOffset();
}

// null = no baseline (previous period was 0) → em dash, never "+100%"
function formatChange(pct) {
  if (pct === null || pct === undefined) return '—';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function changeTone(pct, invert = false) {
  if (pct === null || pct === undefined || pct === 0) return 'neutral';
  const good = invert ? pct < 0 : pct > 0;
  return good ? 'positive' : 'negative';
}

function changeHtml(pct, invert = false) {
  const tone = changeTone(pct, invert);
  const icon = (pct === null || pct === undefined || pct === 0)
    ? 'bi-dash'
    : pct > 0 ? 'bi-arrow-up-right' : 'bi-arrow-down-right';
  return `<span class="delta delta-${tone}"><i class="bi ${icon}"></i>${formatChange(pct)}</span>`;
}

// Compact money for chart axis labels: $1.2k, $18k, $1.4M
function formatCompactMoney(cents, currency = 'usd') {
  const sym = currencySymbol(currency);
  const v = cents / 100;
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000)     return `${sym}${(v / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  if (abs >= 100)       return `${sym}${Math.round(v)}`;
  return `${sym}${v.toFixed(2).replace(/\.00$/, '')}`;
}

function formatCompactNumber(n) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// Bucket strings are ALREADY in the merchant's timezone — parse them as
// local time (no trailing "Z") or every label shifts by a day.
function formatBucket(bucket, interval, long = false) {
  try {
    if (interval === 'month') {
      return new Date(`${bucket}-01T00:00:00`)
        .toLocaleDateString('en-US', { month: 'short', year: long ? 'numeric' : '2-digit' });
    }
    if (interval === 'hour') {
      const d = new Date(`${bucket}:00`);
      return long
        ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' })
        : d.toLocaleTimeString('en-US', { hour: 'numeric' });
    }
    const d = new Date(`${bucket}T00:00:00`);
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return interval === 'week' && long ? `Week of ${label}` : label;
  } catch {
    return bucket;
  }
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

function relativeTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7)   return `${days}d ago`;
  return formatDate(iso);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function skeletonRows(cols, rows = 5) {
  return Array.from({ length: rows }, () =>
    `<tr>${Array.from({ length: cols }, () => '<td><span class="skeleton"></span></td>').join('')}</tr>`
  ).join('');
}

// ── Confirm modal ───────────────────────────────────────────────
function confirmModal(title, bodyHtml, btnLabel = 'Delete', btnClass = 'btn-danger') {
  return new Promise(resolve => {
    const id  = `cm${Date.now()}`;
    const html = `
      <div class="modal fade" id="${id}" tabindex="-1">
        <div class="modal-dialog modal-sm modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">${escHtml(title)}</h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">${bodyHtml}</div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="button" class="btn ${btnClass}" id="${id}-ok">${escHtml(btnLabel)}</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    const el    = document.getElementById(id);
    const modal = new bootstrap.Modal(el);
    let confirmed = false;
    document.getElementById(`${id}-ok`).addEventListener('click', () => {
      confirmed = true;
      modal.hide();
    });
    el.addEventListener('hidden.bs.modal', () => { el.remove(); resolve(confirmed); });
    modal.show();
  });
}

// ── Form modal ──────────────────────────────────────────────────
// Like confirmModal, but `read()` runs while the fields still exist and
// its return value is what the promise resolves with (null on cancel).
function formModal(title, bodyHtml, read, btnLabel = 'Save', btnClass = 'btn-primary') {
  return new Promise(resolve => {
    const id = `fm${Date.now()}`;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal fade" id="${id}" tabindex="-1">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title text-truncate">${escHtml(title)}</h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">${bodyHtml}</div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="button" class="btn ${btnClass}" id="${id}-ok">${escHtml(btnLabel)}</button>
            </div>
          </div>
        </div>
      </div>`);
    const el    = document.getElementById(id);
    const modal = new bootstrap.Modal(el);
    let result  = null;
    document.getElementById(`${id}-ok`).addEventListener('click', () => {
      result = read(el);          // read before Bootstrap tears the node down
      modal.hide();
    });
    el.addEventListener('hidden.bs.modal', () => { el.remove(); resolve(result); });
    modal.show();
  });
}

// ── Shared navigation ───────────────────────────────────────────
const NAV_ITEMS = [
  { path: '/dashboard',   label: 'Dashboard',   icon: 'bi-speedometer2',    hint: 'Sales at a glance' },
  { path: '/orders',      label: 'Orders',      icon: 'bi-receipt',         hint: 'Fulfil and track' },
  { path: '/products',    label: 'Products',    icon: 'bi-box-seam',        hint: 'Manage your catalog' },
  { path: '/subscribers', label: 'Email list',  icon: 'bi-people',          hint: 'Newsletter subscribers' },
  { path: '/newsletter',  label: 'Newsletter',  icon: 'bi-envelope-paper',  hint: 'Write a campaign' },
  { path: '/settings',    label: 'Settings',    icon: 'bi-gear',            hint: 'Storefront header video' },
];

function currentPath() {
  return location.hash.replace(/^#/, '').split('?')[0] || '/';
}

function isNavActive(path) {
  const here = currentPath();
  return here === path || here.startsWith(`${path}/`);
}

// Top bar + slide-out drawer. The drawer is the primary navigation on
// phones; ≥lg the links sit inline in the bar instead.
function renderNavbar() {
  const active = NAV_ITEMS.find(i => isNavActive(i.path));

  const inlineLinks = NAV_ITEMS.map(i => `
    <li class="nav-item">
      <a class="nav-link px-3 py-2 ${isNavActive(i.path) ? 'active' : ''}" href="#${i.path}">
        <i class="bi ${i.icon} me-1"></i>${escHtml(i.label)}
      </a>
    </li>`).join('');

  const drawerLinks = NAV_ITEMS.map(i => `
    <a class="drawer-link ${isNavActive(i.path) ? 'active' : ''}" href="#${i.path}" data-drawer-link>
      <span class="drawer-icon"><i class="bi ${i.icon}"></i></span>
      <span class="flex-grow-1">
        <span class="drawer-label">${escHtml(i.label)}</span>
        <span class="drawer-hint">${escHtml(i.hint)}</span>
      </span>
      <i class="bi bi-chevron-right drawer-chevron"></i>
    </a>`).join('');

  return `
    <nav class="navbar app-nav">
      <div class="container-fluid d-flex align-items-center gap-2">
        <button class="btn nav-burger d-lg-none" type="button"
                data-bs-toggle="offcanvas" data-bs-target="#app-drawer"
                aria-controls="app-drawer" aria-label="Open navigation menu">
          <i class="bi bi-list"></i>
        </button>

        <a class="navbar-brand" href="#/dashboard">
          <img src="/IMG_1306.jpeg" alt="Blackstar" class="brand-logo">
          <span class="brand-sub ms-2">ADMIN</span>
        </a>

        <span class="nav-current d-lg-none ms-1">${escHtml(active?.label ?? '')}</span>

        <ul class="nav nav-pills d-none d-lg-flex gap-1 mb-0 ms-3">
          ${inlineLinks}
        </ul>

        <button class="btn btn-outline-secondary btn-sm d-none d-lg-inline-flex ms-auto js-logout">
          <i class="bi bi-box-arrow-right me-1"></i>Logout
        </button>
      </div>
    </nav>

    <div class="offcanvas offcanvas-start app-drawer" tabindex="-1" id="app-drawer"
         aria-label="Main navigation">
      <div class="offcanvas-header">
        <div class="d-flex align-items-center">
          <img src="/IMG_1306.jpeg" alt="Blackstar" class="brand-logo">
          <span class="brand-sub ms-2">ADMIN</span>
        </div>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="offcanvas" aria-label="Close"></button>
      </div>
      <div class="offcanvas-body d-flex flex-column p-0">
        <div class="drawer-nav">${drawerLinks}</div>
        <div class="drawer-footer mt-auto">
          <button class="btn btn-outline-secondary w-100 js-logout">
            <i class="bi bi-box-arrow-right me-2"></i>Log out
          </button>
        </div>
      </div>
    </div>`;
}

// Bound once per render by the Router — the shell markup is shared by
// every view, so views no longer wire their own logout button.
function initShell() {
  document.querySelectorAll('.js-logout').forEach(btn =>
    btn.addEventListener('click', () => Auth.logout())
  );

  const drawer = document.getElementById('app-drawer');
  if (!drawer) return;

  // Close the drawer before navigating so the slide-out animates away
  // instead of being ripped out from under Bootstrap.
  drawer.addEventListener('click', e => {
    const link = e.target.closest('[data-drawer-link]');
    if (!link) return;
    const href = link.getAttribute('href');
    if (href === location.hash) { closeDrawer(); return; }
    e.preventDefault();
    drawer.addEventListener('hidden.bs.offcanvas', () => { location.hash = href; }, { once: true });
    closeDrawer();
  });
}

function closeDrawer() {
  const el = document.getElementById('app-drawer');
  if (el) bootstrap.Offcanvas.getOrCreateInstance(el).hide();
}

// Belt and braces: a view swap can orphan a backdrop and leave the body
// scroll-locked. Clear anything left behind before rendering.
function cleanupOverlays() {
  document.querySelectorAll('.offcanvas.show, .modal.show').forEach(el => {
    const inst = bootstrap.Offcanvas.getInstance(el) ?? bootstrap.Modal.getInstance(el);
    inst?.dispose();
  });
  document.querySelectorAll('.offcanvas-backdrop, .modal-backdrop').forEach(el => el.remove());
  document.body.classList.remove('modal-open', 'offcanvas-open');
  document.body.style.removeProperty('overflow');
  document.body.style.removeProperty('padding-right');
}

// ═══════════════════════════════════════════════════════════════
// View: Login
// ═══════════════════════════════════════════════════════════════
const LoginView = {
  render() {
    return `
      <div class="login-wrap">
        <div class="card login-card">
          <div class="card-body p-4 p-sm-5">
            <div class="text-center mb-4">
              <div class="login-logo">
                <img src="/IMG_1306.jpeg" alt="Blackstar" class="login-brand-img">
              </div>
              <p class="mb-0 mt-2" style="font-size:0.65rem;letter-spacing:0.18em;text-transform:uppercase;color:var(--text-muted)">Admin Panel</p>
              <p class="text-secondary small mt-3 mb-0">Sign in to continue</p>
            </div>
            <div id="login-error" class="alert alert-danger d-none py-2 small" role="alert"></div>
            <form id="login-form" novalidate>
              <div class="mb-3">
                <label for="login-username" class="form-label small fw-semibold">Username</label>
                <input type="text" class="form-control" id="login-username" autocomplete="username" required>
              </div>
              <div class="mb-4">
                <label for="login-password" class="form-label small fw-semibold">Password</label>
                <input type="password" class="form-control" id="login-password" autocomplete="current-password" required>
              </div>
              <button type="submit" class="btn btn-primary w-100 fw-semibold" id="login-btn">
                Sign in
              </button>
            </form>
          </div>
        </div>
      </div>`;
  },

  init() {
    const form   = document.getElementById('login-form');
    const btn    = document.getElementById('login-btn');
    const errEl  = document.getElementById('login-error');

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      errEl.classList.add('d-none');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Signing in…';
      try {
        await Auth.login(username, password);
        Router.go('/dashboard');
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('d-none');
        btn.disabled = false;
        btn.textContent = 'Sign in';
      }
    });
  },
};

// ═══════════════════════════════════════════════════════════════
// View: Dashboard
// ═══════════════════════════════════════════════════════════════
const RANGE_PRESETS = [
  { value: 'today',      label: 'Today' },
  { value: 'yesterday',  label: 'Yesterday' },
  { value: '7d',         label: '7 days' },
  { value: '30d',        label: '30 days' },
  { value: '90d',        label: '90 days' },
  { value: 'mtd',        label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: '12m',        label: '12 months' },
  { value: 'ytd',        label: 'Year to date' },
  { value: 'all',        label: 'All time' },
];

const METRICS = [
  { key: 'total_sales', label: 'Sales', money: true },
  { key: 'orders',      label: 'Orders', money: false },
  { key: 'units_sold',  label: 'Units',  money: false },
];

// Round a max value up to a friendly axis bound (1, 2, 2.5, 5, 10 × 10ⁿ)
function niceCeil(n) {
  if (n <= 0) return 1;
  const exp  = Math.floor(Math.log10(n));
  const base = Math.pow(10, exp);
  const frac = n / base;
  const step = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10;
  return step * base;
}

const DashboardView = {
  _range:   localStorage.getItem('blackstar_range') || '30d',
  _start:   null,
  _end:     null,
  _metric:  'total_sales',
  _compare: true,
  _data:    null,
  _chart:   null,
  _onResize: null,

  render() {
    const pills = RANGE_PRESETS.map(r => `
      <button class="btn btn-sm range-pill ${this._range === r.value ? 'active' : ''}"
              data-range="${r.value}">${escHtml(r.label)}</button>`).join('');

    return `
      ${renderNavbar()}
      <div class="container-fluid page">
        <div class="page-head">
          <div>
            <h1 class="page-title">Dashboard</h1>
            <p class="page-sub" id="range-caption">Loading…</p>
          </div>
          <button class="btn btn-outline-secondary btn-sm" id="refresh-btn" title="Refresh">
            <i class="bi bi-arrow-clockwise"></i><span class="d-none d-sm-inline ms-1">Refresh</span>
          </button>
        </div>

        <!-- Range picker -->
        <div class="range-bar" id="range-pills">
          ${pills}
          <button class="btn btn-sm range-pill ${this._range === 'custom' ? 'active' : ''}"
                  data-range="custom"><i class="bi bi-calendar3 me-1"></i>Custom</button>
        </div>

        <div class="card mb-3 ${this._range === 'custom' ? '' : 'd-none'}" id="custom-range">
          <div class="card-body d-flex flex-wrap align-items-end gap-2">
            <div class="flex-grow-1" style="min-width:140px">
              <label class="form-label" for="range-start">Start</label>
              <input type="date" class="form-control form-control-sm" id="range-start" value="${escHtml(this._start ?? '')}">
            </div>
            <div class="flex-grow-1" style="min-width:140px">
              <label class="form-label" for="range-end">End</label>
              <input type="date" class="form-control form-control-sm" id="range-end" value="${escHtml(this._end ?? '')}">
            </div>
            <button class="btn btn-primary btn-sm" id="apply-range">Apply</button>
          </div>
        </div>

        <div id="dash-error" class="alert alert-danger d-none" role="alert"></div>

        <!-- KPI cards -->
        <div class="kpi-grid" id="kpi-grid">
          ${['Total sales', 'Orders', 'Avg order value', 'Units sold'].map(l => `
            <div class="card kpi-card">
              <div class="card-body">
                <div class="kpi-label">${l}</div>
                <div class="kpi-value"><span class="skeleton skeleton-lg"></span></div>
              </div>
            </div>`).join('')}
        </div>

        <!-- Sales chart -->
        <div class="card mb-3">
          <div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
            <span id="chart-title">Sales over time</span>
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <div class="btn-group btn-group-sm" id="metric-toggle">
                ${METRICS.map(m => `
                  <button class="btn btn-outline-secondary ${this._metric === m.key ? 'active' : ''}"
                          data-metric="${m.key}">${m.label}</button>`).join('')}
              </div>
              <div class="form-check form-switch mb-0 compare-switch">
                <input class="form-check-input" type="checkbox" id="compare-toggle" ${this._compare ? 'checked' : ''}>
                <label class="form-check-label" for="compare-toggle">Compare</label>
              </div>
            </div>
          </div>
          <div class="card-body pb-2">
            <div class="chart-wrap" id="chart-wrap">
              <div class="chart-loading"><div class="spinner-border text-success"></div></div>
            </div>
            <div class="chart-legend" id="chart-legend"></div>
          </div>
        </div>

        <!-- Order status chips (range-scoped) -->
        <div class="card mb-3">
          <div class="card-header">Orders in this period</div>
          <div class="card-body"><div class="chip-row" id="order-counts"></div></div>
        </div>

        <div class="row g-3">
          <div class="col-lg-6">
            <div class="card h-100">
              <div class="card-header d-flex justify-content-between align-items-center">
                <span>Top products</span>
                <a href="#/products" class="card-link">All products</a>
              </div>
              <div class="card-body pt-2" id="top-products">
                <div class="text-secondary small py-3">Loading…</div>
              </div>
            </div>
          </div>

          <div class="col-lg-6">
            <div class="card h-100">
              <div class="card-header d-flex justify-content-between align-items-center">
                <span>Needs attention</span>
                <span class="badge text-bg-secondary">All time</span>
              </div>
              <div class="card-body pt-2" id="needs-attention">
                <div class="text-secondary small py-3">Loading…</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Secondary metrics -->
        <div class="card mt-3">
          <div class="card-header">More metrics</div>
          <div class="card-body"><div class="mini-grid" id="mini-metrics"></div></div>
        </div>

        <!-- Recent orders -->
        <div class="card mt-3">
          <div class="card-header d-flex justify-content-between align-items-center">
            <span>Recent orders</span>
            <a href="#/orders" class="card-link">All orders</a>
          </div>
          <div id="recent-orders">
            <div class="text-secondary small p-3">Loading…</div>
          </div>
        </div>

        <!-- Newsletter -->
        <div class="card mt-3 mb-4" id="newsletter-card">
          <div class="card-header d-flex justify-content-between align-items-center">
            <span>Newsletter</span>
            <a href="#/subscribers" class="card-link">Manage list</a>
          </div>
          <div class="card-body"><div class="mini-grid" id="newsletter-stats"></div></div>
        </div>
      </div>`;
  },

  async init() {
    document.getElementById('range-pills').addEventListener('click', e => {
      const btn = e.target.closest('[data-range]');
      if (!btn) return;
      const value = btn.dataset.range;
      document.querySelectorAll('.range-pill').forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('custom-range').classList.toggle('d-none', value !== 'custom');
      this._range = value;
      // Don't persist "custom" — it is meaningless without the dates,
      // and reloading into it would send a range with no start or end.
      if (value !== 'custom') {
        localStorage.setItem('blackstar_range', value);
        this._start = null;
        this._end = null;
        this._load();
      }
    });

    document.getElementById('apply-range').addEventListener('click', () => {
      const start = document.getElementById('range-start').value;
      const end   = document.getElementById('range-end').value;
      if (!start && !end) { Toast.error('Pick a start or end date'); return; }
      if (start && end && start > end) { Toast.error('Start date is after the end date'); return; }
      this._start = start || null;
      this._end   = end || null;
      this._range = 'custom';
      this._load();
    });

    document.getElementById('metric-toggle').addEventListener('click', e => {
      const btn = e.target.closest('[data-metric]');
      if (!btn) return;
      document.querySelectorAll('#metric-toggle .btn').forEach(b => b.classList.toggle('active', b === btn));
      this._metric = btn.dataset.metric;
      this._drawChart();
    });

    document.getElementById('compare-toggle').addEventListener('change', e => {
      this._compare = e.target.checked;
      this._load();
    });

    document.getElementById('refresh-btn').addEventListener('click', () => this._load());

    // Redraw the chart when the viewport changes size (phone rotation included)
    let t;
    this._onResize = () => { clearTimeout(t); t = setTimeout(() => this._drawChart(), 150); };
    window.addEventListener('resize', this._onResize);

    this._bindChartEvents();
    await this._load();
  },

  destroy() {
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    this._onResize = null;
  },

  _params() {
    return {
      range: this._range,
      start: this._start ?? undefined,
      end:   this._end ?? undefined,
      tz_offset_minutes: tzOffsetMinutes(),
      compare: this._compare ? 'true' : undefined,
      top_products_limit: 5,
      recent_orders_limit: 8,
    };
  },

  async _load() {
    const errEl = document.getElementById('dash-error');
    if (!errEl) return;                       // view was swapped mid-flight
    errEl.classList.add('d-none');
    document.getElementById('chart-wrap').innerHTML =
      '<div class="chart-loading"><div class="spinner-border text-success"></div></div>';

    try {
      const data = await Api.getDashboard(this._params());
      if (!document.getElementById('dash-error')) return;
      this._data = data;
      this._renderCaption();
      this._renderKpis();
      this._drawChart();
      this._renderOrderCounts();
      this._renderTopProducts();
      this._renderNeedsAttention();
      this._renderMini();
      this._renderRecentOrders();
      this._renderNewsletter();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('d-none');
      document.getElementById('chart-wrap').innerHTML =
        `<div class="chart-loading text-secondary small">Couldn’t load the chart</div>`;
    }
  },

  _renderCaption() {
    const r = this._data.range ?? {};
    const fmt = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    const label = RANGE_PRESETS.find(p => p.value === r.preset)?.label ?? 'Custom range';
    document.getElementById('range-caption').textContent =
      r.preset === 'all' ? 'All time' : `${label} · ${fmt(r.start)} – ${fmt(r.end)}`;
  },

  _renderKpis() {
    const { metrics: m, changes: c, currency } = this._data;
    const cards = [
      { label: 'Total sales',     value: formatPrice(m.total_sales, currency), change: c.total_sales },
      { label: 'Orders',          value: m.orders.toLocaleString(),            change: c.orders },
      { label: 'Avg order value', value: formatPrice(m.average_order_value, currency), change: c.average_order_value },
      { label: 'Units sold',      value: m.units_sold.toLocaleString(),        change: c.units_sold },
    ];
    document.getElementById('kpi-grid').innerHTML = cards.map(card => `
      <div class="card kpi-card">
        <div class="card-body">
          <div class="kpi-label">${card.label}</div>
          <div class="kpi-value">${escHtml(card.value)}</div>
          <div class="kpi-change">${changeHtml(card.change)}<span class="kpi-vs">vs previous</span></div>
        </div>
      </div>`).join('');
  },

  _renderMini() {
    const { metrics: m, changes: c, currency } = this._data;
    const items = [
      { label: 'Gross sales',   value: formatPrice(m.gross_sales, currency), change: c.gross_sales },
      { label: 'Discounts',     value: formatPrice(m.discounts, currency),   change: c.discounts, invert: true },
      { label: 'Customers',     value: m.customers.toLocaleString(),         change: c.customers },
      { label: 'New customers', value: m.new_customers.toLocaleString(),     change: c.new_customers },
    ];
    document.getElementById('mini-metrics').innerHTML = items.map(i => `
      <div class="mini-stat">
        <div class="mini-label">${i.label}</div>
        <div class="mini-value">${escHtml(i.value)}</div>
        <div>${changeHtml(i.change, i.invert)}</div>
      </div>`).join('');
  },

  _renderOrderCounts() {
    const oc = this._data.order_counts ?? {};
    const chips = [
      { label: 'Pending',     key: 'pending',     cls: 'text-bg-warning',   href: '#/orders?status=pending' },
      { label: 'Paid',        key: 'paid',        cls: 'text-bg-success',   href: '#/orders?status=paid' },
      { label: 'Fulfilled',   key: 'fulfilled',   cls: 'text-bg-primary',   href: '#/orders?status=fulfilled' },
      { label: 'Cancelled',   key: 'cancelled',   cls: 'text-bg-secondary', href: '#/orders?status=cancelled' },
      { label: 'Unfulfilled', key: 'unfulfilled', cls: 'text-bg-danger',    href: '#/orders?fulfillment_status=unfulfilled' },
      { label: 'Processing',  key: 'processing',  cls: 'text-bg-warning',   href: '#/orders?fulfillment_status=processing' },
      { label: 'Shipped',     key: 'shipped',     cls: 'text-bg-info',      href: '#/orders?fulfillment_status=shipped' },
      { label: 'Delivered',   key: 'delivered',   cls: 'text-bg-success',   href: '#/orders?fulfillment_status=delivered' },
    ];
    document.getElementById('order-counts').innerHTML = chips.map(ch => `
      <a class="stat-chip" href="${ch.href}">
        <span class="badge ${ch.cls}">${oc[ch.key] ?? 0}</span>
        <span>${ch.label}</span>
      </a>`).join('');
  },

  _renderTopProducts() {
    const el   = document.getElementById('top-products');
    const list = this._data.top_products ?? [];
    const cur  = this._data.currency;

    if (!list.length) {
      el.innerHTML = `<div class="empty-state small"><i class="bi bi-box"></i>No sales in this period</div>`;
      return;
    }
    const max = Math.max(...list.map(p => p.units_sold), 1);
    el.innerHTML = list.map((p, i) => `
      <div class="rank-row">
        <span class="rank-num">${i + 1}</span>
        <div class="flex-grow-1 min-w-0">
          <div class="d-flex justify-content-between gap-2">
            <span class="rank-name">${escHtml(p.product_name)}</span>
            <span class="rank-value">${escHtml(formatPrice(p.total_revenue, cur))}</span>
          </div>
          <div class="rank-bar"><span style="width:${(p.units_sold / max) * 100}%"></span></div>
          <div class="rank-meta">${p.units_sold} unit${p.units_sold !== 1 ? 's' : ''} · ${p.orders} order${p.orders !== 1 ? 's' : ''}</div>
        </div>
      </div>`).join('');
  },

  _renderNeedsAttention() {
    const na = this._data.needs_attention ?? {};
    const rows = [
      { n: na.unfulfilled_orders ?? 0, label: 'order', suffix: 'to fulfil', icon: 'bi-box-seam',    tone: 'warn',   href: '#/orders?status=paid&fulfillment_status=unfulfilled' },
      { n: na.processing_orders  ?? 0, label: 'order', suffix: 'in processing', icon: 'bi-hourglass-split', tone: 'info', href: '#/orders?fulfillment_status=processing' },
      { n: na.pending_orders     ?? 0, label: 'abandoned checkout', suffix: '', icon: 'bi-cart-x',  tone: 'muted',  href: '#/orders?status=pending' },
    ];

    const lowStock = na.low_stock_products ?? [];
    const items = rows.filter(r => r.n > 0).map(r => `
      <a class="task-row task-${r.tone}" href="${r.href}">
        <i class="bi ${r.icon}"></i>
        <span class="flex-grow-1">
          <strong>${r.n}</strong> ${escHtml(r.label)}${r.n !== 1 ? 's' : ''}${r.suffix ? ` ${escHtml(r.suffix)}` : ''}
        </span>
        <i class="bi bi-chevron-right text-secondary"></i>
      </a>`);

    if (lowStock.length) {
      items.push(`
        <div class="task-row task-danger flex-column align-items-start">
          <div class="d-flex align-items-center gap-2 w-100">
            <i class="bi bi-exclamation-triangle"></i>
            <span class="flex-grow-1"><strong>${lowStock.length}</strong> product${lowStock.length !== 1 ? 's' : ''} low on stock</span>
          </div>
          <div class="low-stock-list">
            ${lowStock.map(p => `
              <a href="#/products/${escHtml(p.id)}/edit" class="low-stock-item">
                <span class="text-truncate">${escHtml(p.name)}</span>
                <span class="badge ${p.stock === 0 ? 'text-bg-danger' : 'text-bg-warning'}">${p.stock} left</span>
              </a>`).join('')}
          </div>
        </div>`);
    }

    document.getElementById('needs-attention').innerHTML = items.length
      ? items.join('')
      : `<div class="empty-state small"><i class="bi bi-check-circle"></i>All caught up — nothing needs attention</div>`;
  },

  _renderRecentOrders() {
    const el     = document.getElementById('recent-orders');
    const orders = this._data.recent_orders ?? [];
    const cur    = this._data.currency;

    if (!orders.length) {
      el.innerHTML = `<div class="empty-state"><i class="bi bi-inbox"></i>No orders yet</div>`;
      return;
    }
    el.innerHTML = `<div class="list-rows">${orders.map(o => `
      <a class="list-row" href="#/orders/${escHtml(o.id)}">
        <div class="min-w-0 flex-grow-1">
          <div class="list-row-title">
            <span class="font-monospace">#${escHtml(o.id.slice(0, 8).toUpperCase())}</span>
            <span class="text-secondary ms-2">${escHtml(o.customer_name ?? o.customer_email ?? '—')}</span>
          </div>
          <div class="list-row-sub">
            ${escHtml(relativeTime(o.created_at))} · ${o.item_count ?? 0} item${(o.item_count ?? 0) !== 1 ? 's' : ''}
          </div>
        </div>
        <div class="text-end">
          <div class="fw-semibold">${escHtml(formatPrice(o.amount_total, o.currency ?? cur))}</div>
          <div class="d-flex gap-1 justify-content-end mt-1">
            ${statusBadge(o.status)}${fulfillmentBadge(o.fulfillment_status)}
          </div>
        </div>
      </a>`).join('')}</div>`;
  },

  _renderNewsletter() {
    const n = this._data.newsletter ?? {};
    const items = [
      { label: 'Subscribed',   value: (n.subscribed ?? 0).toLocaleString() },
      { label: 'New in 30d',   value: `+${(n.new_last_30d ?? 0).toLocaleString()}` },
      { label: 'Unsubscribed', value: (n.unsubscribed ?? 0).toLocaleString() },
      { label: 'Total ever',   value: (n.total ?? 0).toLocaleString() },
    ];
    document.getElementById('newsletter-stats').innerHTML = items.map(i => `
      <div class="mini-stat">
        <div class="mini-label">${i.label}</div>
        <div class="mini-value">${escHtml(i.value)}</div>
      </div>`).join('');
  },

  // ── Chart ─────────────────────────────────────────────────────
  _drawChart() {
    const wrap = document.getElementById('chart-wrap');
    if (!wrap || !this._data) return;

    const chart    = this._data.chart ?? {};
    const points   = chart.points ?? [];
    const prev     = (this._compare && chart.previous_points) || [];
    const interval = chart.interval ?? 'day';
    const cur      = this._data.currency;
    const metric   = METRICS.find(m => m.key === this._metric) ?? METRICS[0];

    document.getElementById('chart-title').textContent = `${metric.label} over time`;

    if (!points.length) {
      wrap.innerHTML = `<div class="chart-loading text-secondary small">No data in this period</div>`;
      document.getElementById('chart-legend').innerHTML = '';
      this._chart = null;
      return;
    }

    const W    = Math.max(wrap.clientWidth || 320, 280);
    const H    = window.innerWidth < 576 ? 210 : 280;
    const padL = metric.money ? 54 : 42;
    const padR = 12, padT = 14, padB = 30;
    const iw   = W - padL - padR;
    const ih   = H - padT - padB;

    const vals     = points.map(p => p[metric.key] ?? 0);
    const prevVals = prev.map(p => p[metric.key] ?? 0);
    const max      = niceCeil(Math.max(1, ...vals, ...prevVals));

    const x = i => points.length === 1 ? padL + iw / 2 : padL + (i * iw) / (points.length - 1);
    const y = v => padT + ih - (v / max) * ih;
    const fmtVal = v => metric.money ? formatCompactMoney(v, cur) : formatCompactNumber(v);

    // Horizontal grid + y labels
    const ticks = 4;
    let grid = '';
    for (let t = 0; t <= ticks; t++) {
      const v  = (max / ticks) * t;
      const gy = y(v);
      grid += `<line class="grid-line" x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}"></line>`;
      grid += `<text class="axis-label" x="${padL - 8}" y="${gy + 4}" text-anchor="end">${escHtml(fmtVal(v))}</text>`;
    }

    // X labels — thinned, and the last label wins any collision at the edge
    const minGap    = W < 480 ? 56 : 78;
    const maxLabels = Math.max(2, Math.floor(iw / minGap));
    const step      = Math.max(1, Math.ceil(points.length / maxLabels));
    const last      = points.length - 1;
    const chosen    = [];
    for (let i = 0; i < points.length; i += step) chosen.push(i);
    if (chosen[chosen.length - 1] !== last) {
      while (chosen.length && x(last) - x(chosen[chosen.length - 1]) < minGap) chosen.pop();
      chosen.push(last);
    }

    const xLabels = chosen.map(i => {
      const anchor = i === 0 ? 'start' : i === last ? 'end' : 'middle';
      return `<text class="axis-label" x="${x(i)}" y="${H - 8}" text-anchor="${anchor}">${escHtml(formatBucket(points[i].bucket, interval))}</text>`;
    }).join('');

    const linePath = (arr) => arr.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const areaPath = `${linePath(vals)} L${x(points.length - 1).toFixed(1)},${(padT + ih).toFixed(1)} L${x(0).toFixed(1)},${(padT + ih).toFixed(1)} Z`;

    const prevLine = prevVals.length
      ? `<path class="chart-line-prev" d="${linePath(prevVals.slice(0, points.length))}"></path>`
      : '';

    const dots = points.length === 1
      ? `<circle class="chart-dot-static" cx="${x(0)}" cy="${y(vals[0])}" r="4"></circle>`
      : '';

    wrap.innerHTML = `
      <svg class="chart-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img"
           aria-label="${escHtml(metric.label)} over time">
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="var(--gold)" stop-opacity="0.28"></stop>
            <stop offset="100%" stop-color="var(--gold)" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        ${grid}
        ${xLabels}
        <path class="chart-area" d="${areaPath}"></path>
        ${prevLine}
        <path class="chart-line" d="${linePath(vals)}"></path>
        ${dots}
        <line class="chart-cursor d-none" id="chart-cursor" y1="${padT}" y2="${padT + ih}"></line>
        <circle class="chart-dot d-none" id="chart-dot" r="4.5"></circle>
      </svg>
      <div class="chart-tip d-none" id="chart-tip"></div>`;

    document.getElementById('chart-legend').innerHTML = `
      <span class="legend-item"><span class="legend-swatch legend-current"></span>This period</span>
      ${prevVals.length ? '<span class="legend-item"><span class="legend-swatch legend-prev"></span>Previous period</span>' : ''}
      <span class="legend-item text-secondary ms-auto">${
        { hour: 'Hourly', day: 'Daily', week: 'Weekly', month: 'Monthly' }[interval] ?? escHtml(interval)
      }</span>`;

    // The wrap element itself survives redraws, so the pointer handlers are
    // bound once in init() and read whatever this leaves behind.
    this._chart = { points, vals, prevVals, x, y, metric, cur, interval, padL, iw };
  },

  // Bound once per view. Redrawing only swaps `this._chart`, so handlers
  // never stack up as the user flips metrics and date ranges.
  _bindChartEvents() {
    const wrap = document.getElementById('chart-wrap');
    if (!wrap) return;

    const readout = () => ({
      cursor: document.getElementById('chart-cursor'),
      dot:    document.getElementById('chart-dot'),
      tip:    document.getElementById('chart-tip'),
    });

    const move = clientX => {
      const c = this._chart;
      const { cursor, dot, tip } = readout();
      if (!c || !c.points.length || !cursor || !dot || !tip) return;

      const { points, vals, prevVals, x, y, metric, cur, interval, padL, iw } = c;
      const mx  = clientX - wrap.getBoundingClientRect().left;
      const idx = points.length === 1
        ? 0
        : Math.max(0, Math.min(points.length - 1, Math.round(((mx - padL) / iw) * (points.length - 1))));

      const fmt = v => metric.money ? formatPrice(v, cur) : v.toLocaleString();
      const px = x(idx), py = y(vals[idx]);

      cursor.setAttribute('x1', px); cursor.setAttribute('x2', px);
      cursor.classList.remove('d-none');
      dot.setAttribute('cx', px); dot.setAttribute('cy', py);
      dot.classList.remove('d-none');

      tip.innerHTML = `
        <div class="tip-title">${escHtml(formatBucket(points[idx].bucket, interval, true))}</div>
        <div class="tip-row"><span class="legend-swatch legend-current"></span>${escHtml(fmt(vals[idx]))}</div>
        ${prevVals[idx] !== undefined
          ? `<div class="tip-row"><span class="legend-swatch legend-prev"></span>${escHtml(fmt(prevVals[idx]))}</div>`
          : ''}
        <div class="tip-meta">${points[idx].orders} order${points[idx].orders !== 1 ? 's' : ''} · ${points[idx].units_sold} unit${points[idx].units_sold !== 1 ? 's' : ''}</div>`;
      tip.classList.remove('d-none');
      tip.style.left = `${Math.max(4, Math.min(px - tip.offsetWidth / 2, wrap.clientWidth - tip.offsetWidth - 4))}px`;
    };

    const hide = () => {
      const { cursor, dot, tip } = readout();
      cursor?.classList.add('d-none');
      dot?.classList.add('d-none');
      tip?.classList.add('d-none');
    };

    // A tap also emits compatibility mouse events (including mouseleave),
    // which would wipe the readout the instant a finger lifts.
    let touchedAt = 0;
    let lingerTimer;
    const fromMouse = () => Date.now() - touchedAt > 700;

    wrap.addEventListener('mousemove', e => { if (fromMouse()) move(e.clientX); });
    wrap.addEventListener('mouseleave', () => { if (fromMouse()) hide(); });

    const onTouch = e => {
      touchedAt = Date.now();
      clearTimeout(lingerTimer);
      move(e.touches[0].clientX);
    };
    wrap.addEventListener('touchstart', onTouch, { passive: true });
    wrap.addEventListener('touchmove',  onTouch, { passive: true });
    wrap.addEventListener('touchend', () => {
      touchedAt = Date.now();
      clearTimeout(lingerTimer);
      lingerTimer = setTimeout(hide, 2500);   // no hover on touch — let it linger
    });
  },
};

// ═══════════════════════════════════════════════════════════════
// View: Products List
// ═══════════════════════════════════════════════════════════════
const ProductsListView = {
  _offset:     0,
  _limit:      50,
  _filter:    'all',
  _products:    [],
  _dragSrcIdx:  -1,
  _touchState:  null,

  render() {
    return `
      ${renderNavbar()}
      <div class="container-fluid py-4">
        <div class="d-flex justify-content-between align-items-center mb-4 gap-3 flex-wrap">
          <div>
            <h1 class="fw-black mb-0" style="font-size:1.4rem;letter-spacing:-0.01em">Products</h1>
            <p class="mb-0 mt-1" style="font-size:0.75rem;color:var(--text-muted)">Manage your catalog</p>
          </div>
          <a href="#/products/new" class="btn btn-primary">
            <i class="bi bi-plus-lg me-1"></i>New Product
          </a>
        </div>

        <div class="card">
          <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div class="btn-group btn-group-sm" role="group" id="filter-group">
              <input type="radio" class="btn-check" name="filter" id="f-all"      value="all"      checked>
              <label class="btn btn-outline-secondary" for="f-all">All</label>
              <input type="radio" class="btn-check" name="filter" id="f-active"   value="active">
              <label class="btn btn-outline-secondary" for="f-active">Active</label>
              <input type="radio" class="btn-check" name="filter" id="f-inactive" value="inactive">
              <label class="btn btn-outline-secondary" for="f-inactive">Inactive</label>
            </div>
            <span class="text-secondary small" id="product-count"></span>
          </div>

          <div class="table-responsive">
            <table class="table table-dark table-hover align-middle mb-0 products-table">
              <thead>
                <tr>
                  <th style="width:32px"></th>
                  <th class="ps-3">Product</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th class="pe-3">Actions</th>
                </tr>
              </thead>
              <tbody id="products-tbody">
                <tr>
                  <td colspan="7" class="text-center py-5">
                    <div class="spinner-border text-success" role="status">
                      <span class="visually-hidden">Loading…</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="card-footer d-flex justify-content-between align-items-center" id="pagination-row">
            <button class="btn btn-sm btn-outline-secondary" id="prev-btn" disabled>
              <i class="bi bi-chevron-left me-1"></i>Previous
            </button>
            <span class="text-secondary small" id="page-info"></span>
            <button class="btn btn-sm btn-outline-secondary" id="next-btn" disabled>
              Next<i class="bi bi-chevron-right ms-1"></i>
            </button>
          </div>
        </div>
      </div>`;
  },

  async init() {

    document.getElementById('filter-group').addEventListener('change', e => {
      this._filter = e.target.value;
      this._offset = 0;
      this._load();
    });

    document.getElementById('prev-btn').addEventListener('click', () => {
      this._offset = Math.max(0, this._offset - this._limit);
      this._load();
    });
    document.getElementById('next-btn').addEventListener('click', () => {
      this._offset += this._limit;
      this._load();
    });

    document.getElementById('products-tbody').addEventListener('click', async e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, id, name, active } = btn.dataset;

      if (action === 'edit') {
        Router.go(`/products/${id}/edit`);
        return;
      }

      if (action === 'toggle') {
        const nowActive = active === 'true';
        btn.disabled = true;
        try {
          await Api.updateProduct(id, { active: !nowActive });
          Toast.success(`Product ${!nowActive ? 'activated' : 'deactivated'}`);
          this._load();
        } catch (err) {
          Toast.error(err.message);
          btn.disabled = false;
        }
        return;
      }

      if (action === 'delete') {
        const ok = await confirmModal(
          'Delete product',
          `<p class="mb-1">Permanently delete <strong>${escHtml(name)}</strong>?</p>
           <p class="text-warning small mb-0"><i class="bi bi-exclamation-triangle me-1"></i>Consider deactivating instead to preserve checkout history.</p>`,
          'Delete permanently',
          'btn-danger'
        );
        if (!ok) return;
        try {
          await Api.deleteProduct(id);
          Toast.success('Product deleted');
          this._load();
        } catch (err) {
          Toast.error(err.message);
        }
      }
    });

    const tbody = document.getElementById('products-tbody');

    tbody.addEventListener('dragstart', e => {
      if (e.target.closest('[data-action]')) { e.preventDefault(); return; }
      const row = e.target.closest('tr[data-index]');
      if (!row) return;
      this._dragSrcIdx = +row.dataset.index;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => row.classList.add('dragging'), 0);
    });

    tbody.addEventListener('dragend', () => {
      tbody.querySelectorAll('tr').forEach(r => r.classList.remove('dragging', 'drag-over'));
      this._dragSrcIdx = -1;
    });

    tbody.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const row = e.target.closest('tr[data-index]');
      if (!row || +row.dataset.index === this._dragSrcIdx) return;
      tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over'));
      row.classList.add('drag-over');
    });

    tbody.addEventListener('dragleave', e => {
      if (!tbody.contains(e.relatedTarget)) {
        tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over'));
      }
    });

    tbody.addEventListener('drop', e => {
      e.preventDefault();
      const row = e.target.closest('tr[data-index]');
      if (!row || this._dragSrcIdx === -1) return;
      const destIdx = +row.dataset.index;
      if (destIdx === this._dragSrcIdx) return;
      const reordered = [...this._products];
      const [moved] = reordered.splice(this._dragSrcIdx, 1);
      reordered.splice(destIdx, 0, moved);
      this._products = reordered;
      this._renderRows(reordered, this._filter === 'inactive');
      this._saveReorder(reordered);
    });

    // Touch drag-and-drop for mobile
    tbody.addEventListener('touchstart', e => {
      if (!e.target.closest('.drag-handle')) return;
      e.preventDefault();
      const row = e.target.closest('tr[data-index]');
      if (!row) return;
      const touch = e.touches[0];
      const rect = row.getBoundingClientRect();
      const ghost = document.createElement('table');
      ghost.className = 'table table-dark mb-0';
      ghost.style.cssText = `position:fixed;pointer-events:none;z-index:9999;opacity:0.9;width:${rect.width}px;top:${rect.top}px;left:${rect.left}px;margin:0;box-shadow:0 8px 24px rgba(0,0,0,0.6);background:var(--bg-card);border-radius:4px;`;
      const gtb = document.createElement('tbody');
      gtb.appendChild(row.cloneNode(true));
      ghost.appendChild(gtb);
      document.body.appendChild(ghost);
      row.classList.add('dragging');
      this._touchState = { srcIdx: +row.dataset.index, ghost, offsetY: touch.clientY - rect.top, destIdx: null };
    }, { passive: false });

    tbody.addEventListener('touchmove', e => {
      if (!this._touchState) return;
      e.preventDefault();
      const touch = e.touches[0];
      const { ghost, offsetY } = this._touchState;
      ghost.style.top = `${touch.clientY - offsetY}px`;
      ghost.style.visibility = 'hidden';
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      ghost.style.visibility = '';
      const targetRow = el?.closest('#products-tbody tr[data-index]');
      tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over'));
      if (targetRow && +targetRow.dataset.index !== this._touchState.srcIdx) {
        targetRow.classList.add('drag-over');
        this._touchState.destIdx = +targetRow.dataset.index;
      } else {
        this._touchState.destIdx = null;
      }
    }, { passive: false });

    const _finishTouch = () => {
      if (!this._touchState) return;
      const { srcIdx, ghost, destIdx } = this._touchState;
      ghost.remove();
      tbody.querySelectorAll('tr').forEach(r => r.classList.remove('dragging', 'drag-over'));
      this._touchState = null;
      if (destIdx !== null && destIdx !== srcIdx) {
        const reordered = [...this._products];
        const [moved] = reordered.splice(srcIdx, 1);
        reordered.splice(destIdx, 0, moved);
        this._products = reordered;
        this._renderRows(reordered, this._filter === 'inactive');
        this._saveReorder(reordered);
      }
    };
    tbody.addEventListener('touchend', _finishTouch);
    tbody.addEventListener('touchcancel', _finishTouch);

    await this._load();
  },

  async _saveReorder(products) {
    try {
      await Api.reorderProducts(products.map((p, i) => ({ id: p.id, display_order: i })));
      Toast.success('Order saved');
    } catch (err) {
      Toast.error(`Failed to save order: ${err.message}`);
    }
  },

  async _load() {
    const tbody = document.getElementById('products-tbody');
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-5">
          <div class="spinner-border text-success" role="status"></div>
        </td>
      </tr>`;

    // For "inactive" filter: fetch all (no server-side filter) and filter client-side
    const isInactiveFilter = this._filter === 'inactive';
    const params = {
      limit:  isInactiveFilter ? 100 : this._limit,
      offset: isInactiveFilter ? 0   : this._offset,
      ...(this._filter === 'active' ? { active_only: 'true' } : {}),
    };

    try {
      let products = await Api.getProducts(params);

      if (isInactiveFilter) {
        products = products.filter(p => !p.active);
      }

      this._renderRows(products, isInactiveFilter);
      this._updatePagination(products.length, isInactiveFilter);
    } catch (err) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center py-4 text-danger">
            <i class="bi bi-exclamation-circle me-2"></i>${escHtml(err.message)}
          </td>
        </tr>`;
    }
  },

  _renderRows(products, hidePagination = false) {
    const tbody    = document.getElementById('products-tbody');
    const countEl  = document.getElementById('product-count');
    const pageRow  = document.getElementById('pagination-row');

    this._products = products;

    pageRow.style.display = hidePagination ? 'none' : '';
    countEl.textContent   = `${products.length} product${products.length !== 1 ? 's' : ''}`;

    if (products.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center py-5 text-secondary">
            <i class="bi bi-inbox fs-2 d-block mb-2 opacity-50"></i>
            No products found
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = products.map((p, i) => {
      const thumb = p.images?.[0]
        ? `<img src="${escHtml(p.images[0])}" width="40" height="40" class="rounded" style="object-fit:cover" onerror="this.replaceWith(placeholder())">`
        : `<span class="d-inline-flex align-items-center justify-content-center rounded bg-secondary bg-opacity-25" style="width:40px;height:40px"><i class="bi bi-image text-secondary"></i></span>`;

      return `
        <tr draggable="true" data-index="${i}">
          <td class="ps-2 text-center"><i class="bi bi-grip-vertical drag-handle"></i></td>
          <td class="ps-3">
            <div class="d-flex align-items-center gap-3">
              ${thumb}
              <div class="min-w-0">
                <div class="fw-semibold lh-sm">${escHtml(p.name)}</div>
                <div class="text-secondary font-monospace d-none d-md-block" style="font-size:0.7rem">${p.id.slice(0, 8)}…</div>
                <!-- Price/stock/status columns are hidden on phones — show them here instead -->
                <div class="product-meta d-md-none">
                  <span class="fw-semibold">${formatPrice(p.price, p.currency)}</span>
                  <span class="text-muted">·</span>
                  <span>${p.stock === -1 ? 'Unlimited' : `${p.stock} in stock`}</span>
                  ${p.active ? '' : '<span class="badge text-bg-secondary ms-1">Inactive</span>'}
                </div>
              </div>
            </div>
          </td>
          <td class="fw-semibold">${formatPrice(p.price, p.currency)}</td>
          <td>${stockBadge(p.stock)}</td>
          <td>${activeBadge(p.active)}</td>
          <td class="text-secondary small">${formatDate(p.created_at)}</td>
          <td class="pe-3">
            <div class="d-flex gap-1">
              <button class="btn btn-sm btn-outline-secondary" title="Edit"
                      data-action="edit" data-id="${escHtml(p.id)}">
                <i class="bi bi-pencil"></i>
              </button>
              <button class="btn btn-sm ${p.active ? 'btn-outline-warning' : 'btn-outline-success'}"
                      title="${p.active ? 'Deactivate' : 'Activate'}"
                      data-action="toggle" data-id="${escHtml(p.id)}" data-active="${p.active}">
                <i class="bi bi-${p.active ? 'eye-slash' : 'eye'}"></i>
              </button>
              <button class="btn btn-sm btn-outline-danger" title="Delete"
                      data-action="delete" data-id="${escHtml(p.id)}" data-name="${escHtml(p.name)}">
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
  },

  _updatePagination(count, hidden) {
    if (hidden) return;
    const prevBtn  = document.getElementById('prev-btn');
    const nextBtn  = document.getElementById('next-btn');
    const pageInfo = document.getElementById('page-info');

    prevBtn.disabled = this._offset === 0;
    nextBtn.disabled = count < this._limit;

    if (count > 0) {
      pageInfo.textContent = `${this._offset + 1}–${this._offset + count}`;
    } else {
      pageInfo.textContent = '';
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// View: Product Form (create + edit)
// ═══════════════════════════════════════════════════════════════
const ProductFormView = {
  _id:       null,
  _isNew:    false,
  _images:   [], // [{ url, key? }]
  _variants: [], // [{ size, stock }]

  render(id) {
    this._id     = id ?? null;
    this._isNew  = !id;
    this._images = [];

    const showForm    = this._isNew;
    const showLoader  = !this._isNew;

    return `
      ${renderNavbar()}
      <div class="container py-4" style="max-width:700px">

        <div class="d-flex align-items-center gap-3 mb-4">
          <a href="#/products" class="btn btn-sm btn-outline-secondary">
            <i class="bi bi-arrow-left me-1"></i>Back
          </a>
          <h1 class="fw-black mb-0" id="form-title" style="font-size:1.3rem;letter-spacing:-0.01em">
            ${this._isNew ? 'New Product' : '<span style="color:var(--text-muted)">Loading…</span>'}
          </h1>
        </div>

        <!-- Loading state (edit only) -->
        <div id="form-loader" class="page-loader ${showLoader ? '' : 'd-none'}">
          <div class="spinner-border text-success"></div>
        </div>

        <!-- The form -->
        <form id="product-form" novalidate class="${showForm ? '' : 'd-none'}">

          <!-- Details card -->
          <div class="card mb-3">
            <div class="card-header small fw-semibold text-uppercase text-secondary">
              Product Details
            </div>
            <div class="card-body">

              <div class="mb-3">
                <label class="form-label small fw-semibold">
                  Name <span class="text-danger">*</span>
                </label>
                <input type="text" class="form-control" name="name" maxlength="255" required>
                <div class="invalid-feedback" data-field="name"></div>
              </div>

              <div class="mb-3">
                <label class="form-label small fw-semibold">Description</label>
                <textarea class="form-control" name="description" rows="3" maxlength="5000"></textarea>
              </div>

              <div class="row g-3 mb-3">
                <div class="col-sm-7">
                  <label class="form-label small fw-semibold">
                    Price <span class="text-danger">*</span>
                  </label>
                  <div class="input-group">
                    <span class="input-group-text" id="currency-symbol">$</span>
                    <input type="number" class="form-control" name="price_display"
                           step="0.01" min="0.01" placeholder="0.00" required>
                  </div>
                  <div class="invalid-feedback d-block d-none small" data-field="price"></div>
                </div>
                <div class="col-sm-5">
                  <label class="form-label small fw-semibold">Currency</label>
                  <select class="form-select" name="currency" id="currency-select">
                    <option value="usd">USD ($)</option>
                    <option value="eur">EUR (€)</option>
                    <option value="gbp">GBP (£)</option>
                  </select>
                </div>
              </div>

              <div class="row g-3">
                <div class="col-sm-7">
                  <label class="form-label small fw-semibold">Stock</label>
                  <div class="input-group">
                    <input type="number" class="form-control" id="stock-input" name="stock" min="-1" value="-1" disabled>
                    <span class="input-group-text">
                      <div class="form-check mb-0">
                        <input class="form-check-input" type="checkbox" id="unlimited-check" checked>
                        <label class="form-check-label small text-secondary" for="unlimited-check">Unlimited</label>
                      </div>
                    </span>
                  </div>
                  <div class="form-text">-1 = unlimited &nbsp;·&nbsp; 0 = sold out</div>
                </div>
                <div class="col-sm-5 d-flex align-items-center pt-3">
                  <div class="form-check form-switch mt-2">
                    <input class="form-check-input" type="checkbox" id="active-toggle" name="active" checked>
                    <label class="form-check-label fw-semibold" for="active-toggle">Active / Visible</label>
                  </div>
                </div>
              </div>

            </div>
          </div>

          <!-- Images card -->
          <div class="card mb-3">
            <div class="card-header small fw-semibold text-uppercase text-secondary">
              Images
            </div>
            <div class="card-body">
              <div id="image-gallery" class="d-flex flex-wrap gap-2 mb-3">
                <span class="text-secondary small">No images</span>
              </div>
              <div class="d-flex align-items-center gap-3 flex-wrap">
                <label class="btn btn-sm btn-outline-secondary mb-0" for="image-file-input">
                  <i class="bi bi-upload me-1"></i>Upload image
                  <input type="file" id="image-file-input" accept="image/jpeg,image/png,image/webp,image/gif" class="d-none">
                </label>
                <span class="text-secondary small" id="upload-status"></span>
              </div>
              <div class="form-text">JPEG, PNG, WebP or GIF. The images array replaces existing images on save.</div>
            </div>
          </div>

          <!-- Variants / Sizes card -->
          <div class="card mb-4">
            <div class="card-header small fw-semibold text-uppercase text-secondary d-flex justify-content-between">
              Variants / Sizes
              <span class="fw-normal text-secondary">Size and stock combinations</span>
            </div>
            <div class="card-body">
              <div id="variants-container">
                <div class="table-responsive">
                  <table class="table table-sm table-borderless mb-3">
                    <thead>
                      <tr class="border-bottom">
                        <th class="text-secondary small fw-semibold">Size</th>
                        <th class="text-secondary small fw-semibold">Stock</th>
                        <th class="text-secondary small fw-semibold"></th>
                      </tr>
                    </thead>
                    <tbody id="variants-list">
                    </tbody>
                  </table>
                </div>
              </div>
              <button type="button" class="btn btn-sm btn-outline-secondary" id="add-variant-btn">
                <i class="bi bi-plus-lg me-1"></i>Add Size
              </button>
              <div class="form-text mt-3">Common sizes: S, M, L, XL. Or use custom sizes like "One Size", "32x24", etc.</div>
              <div class="mt-3 p-3 bg-dark rounded-2 border border-secondary small">
                <div class="text-secondary mb-2">JSON Preview:</div>
                <code id="variants-preview" class="text-success font-monospace">{ "variants": [] }</code>
              </div>
              <div class="invalid-feedback d-block d-none small mt-2" id="variants-error"></div>
            </div>
          </div>

          <!-- Metadata card (legacy) -->
          <div class="card mb-4">
            <div class="card-header small fw-semibold text-uppercase text-secondary d-flex justify-content-between">
              Metadata
              <span class="fw-normal text-secondary">Optional JSON key/value pairs</span>
            </div>
            <div class="card-body">
              <textarea class="form-control font-monospace small" id="metadata-input" name="metadata" rows="4"
                        placeholder='{ "sku": "WP-001", "weight_kg": 0.5 }'></textarea>
              <div class="invalid-feedback d-block d-none small mt-1" id="metadata-error"></div>
            </div>
          </div>

          <!-- Stripe info (edit only) -->
          <div id="stripe-info" class="d-none mb-4">
            <div class="card border-secondary">
              <div class="card-header small fw-semibold text-uppercase text-secondary">
                Stripe (read-only)
              </div>
              <div class="card-body">
                <div class="row g-2">
                  <div class="col-sm-6">
                    <label class="form-label small text-secondary mb-1">Stripe Product ID</label>
                    <input type="text" class="form-control form-control-sm font-monospace" id="stripe-product-id" readonly>
                  </div>
                  <div class="col-sm-6">
                    <label class="form-label small text-secondary mb-1">Stripe Price ID</label>
                    <input type="text" class="form-control form-control-sm font-monospace" id="stripe-price-id" readonly>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Action buttons -->
          <div class="d-flex justify-content-end gap-2">
            <a href="#/products" class="btn btn-secondary">Cancel</a>
            <button type="submit" class="btn btn-primary px-4 fw-semibold" id="save-btn">
              <i class="bi bi-check-lg me-1"></i>${this._isNew ? 'Create Product' : 'Save Changes'}
            </button>
          </div>

        </form>
      </div>`;
  },

  async init(id) {
    this._id    = id ?? null;
    this._isNew = !id;


    // Currency symbol
    document.getElementById('currency-select').addEventListener('change', e => {
      document.getElementById('currency-symbol').textContent = currencySymbol(e.target.value);
    });

    // Unlimited stock toggle
    const unlimitedCheck = document.getElementById('unlimited-check');
    const stockInput     = document.getElementById('stock-input');
    unlimitedCheck.addEventListener('change', () => {
      if (unlimitedCheck.checked) {
        stockInput.value    = '-1';
        stockInput.disabled = true;
      } else {
        stockInput.value    = '0';
        stockInput.disabled = false;
        stockInput.focus();
      }
    });

    // Image upload
    document.getElementById('image-file-input').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const statusEl = document.getElementById('upload-status');
      statusEl.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Uploading…';
      try {
        const { url, key } = await Api.uploadImage(file);
        this._images.push({ url, key });
        this._renderGallery();
        statusEl.textContent = '';
        Toast.success('Image uploaded');
      } catch (err) {
        statusEl.textContent = '';
        Toast.error(`Upload failed: ${err.message}`);
      }
    });

    // Variants / Sizes
    document.getElementById('add-variant-btn').addEventListener('click', e => {
      e.preventDefault();
      this._addVariant();
    });
    this._renderVariants();

    // Load product data when editing
    if (!this._isNew) {
      try {
        const product   = await Api.getProduct(id);
        this._images    = (product.images ?? []).map(url => ({ url }));
        this._fillForm(product);
        document.getElementById('form-loader').classList.add('d-none');
        document.getElementById('product-form').classList.remove('d-none');
        document.getElementById('form-title').textContent = product.name;
      } catch (err) {
        document.getElementById('form-loader').innerHTML =
          `<div class="alert alert-danger">Failed to load product: ${escHtml(err.message)}</div>`;
      }
    } else {
      this._renderGallery();
    }

    // Submit
    document.getElementById('product-form').addEventListener('submit', async e => {
      e.preventDefault();
      await this._submit();
    });
  },

  _fillForm(p) {
    const form = document.getElementById('product-form');
    form.querySelector('[name=name]').value        = p.name ?? '';
    form.querySelector('[name=description]').value = p.description ?? '';
    form.querySelector('[name=price_display]').value = (p.price / 100).toFixed(2);

    const currEl = form.querySelector('[name=currency]');
    currEl.value = p.currency ?? 'usd';
    document.getElementById('currency-symbol').textContent = currencySymbol(currEl.value);

    const stockInput     = document.getElementById('stock-input');
    const unlimitedCheck = document.getElementById('unlimited-check');
    if (p.stock === -1) {
      unlimitedCheck.checked = true;
      stockInput.value       = '-1';
      stockInput.disabled    = true;
    } else {
      unlimitedCheck.checked = false;
      stockInput.value       = p.stock;
      stockInput.disabled    = false;
    }

    document.getElementById('active-toggle').checked = p.active !== false;

    // Variants / Sizes
    if (p.metadata && p.metadata.variants && Array.isArray(p.metadata.variants)) {
      this._variants = p.metadata.variants.map(v => ({
        size: v.size ?? '',
        stock: v.stock ?? 0
      }));
    } else {
      this._variants = [];
    }
    this._renderVariants();

    // Metadata (legacy, excluding variants)
    if (p.metadata && Object.keys(p.metadata).length > 0) {
      const metaCopy = { ...p.metadata };
      delete metaCopy.variants;
      if (Object.keys(metaCopy).length > 0) {
        document.getElementById('metadata-input').value = JSON.stringify(metaCopy, null, 2);
      }
    }

    // Stripe fields (read-only)
    if (p.stripe_product_id || p.stripe_price_id) {
      document.getElementById('stripe-info').classList.remove('d-none');
      document.getElementById('stripe-product-id').value = p.stripe_product_id ?? '—';
      document.getElementById('stripe-price-id').value   = p.stripe_price_id   ?? '—';
    }

    this._renderGallery();
  },

  _renderGallery() {
    const gallery = document.getElementById('image-gallery');
    if (!gallery) return;

    if (this._images.length === 0) {
      gallery.innerHTML = '<span class="text-secondary small">No images</span>';
      return;
    }

    gallery.innerHTML = this._images.map((img, i) => `
      <div class="img-thumb-wrap">
        <img src="${escHtml(img.url)}"
             onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2280%22%3E%3Crect width=%2280%22 height=%2280%22 fill=%22%2330363d%22 rx=%226%22/%3E%3Ctext x=%2240%22 y=%2248%22 text-anchor=%22middle%22 font-size=%2224%22%3E%F0%9F%96%BC%EF%B8%8F%3C/text%3E%3C/svg%3E'">
        <button type="button" class="btn btn-danger remove-btn" data-remove="${i}" title="Remove">
          <i class="bi bi-x"></i>
        </button>
      </div>`).join('');

    gallery.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._images.splice(parseInt(btn.dataset.remove), 1);
        this._renderGallery();
      });
    });
  },

  _renderVariants() {
    const list = document.getElementById('variants-list');
    if (!list) return;

    list.innerHTML = this._variants.map((variant, i) => `
      <tr class="border-bottom">
        <td class="py-2">
          <input type="text" class="form-control form-control-sm" placeholder="e.g., S, M, L, XL"
                 value="${escHtml(variant.size)}" data-variant-size="${i}">
        </td>
        <td class="py-2">
          <input type="number" class="form-control form-control-sm" placeholder="0" min="0"
                 value="${variant.stock}" data-variant-stock="${i}">
        </td>
        <td class="py-2 text-end">
          <button type="button" class="btn btn-sm btn-danger" data-remove-variant="${i}" title="Remove">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>`).join('');

    // Attach input listeners
    list.querySelectorAll('[data-variant-size]').forEach(input => {
      input.addEventListener('change', e => {
        const idx = parseInt(e.target.dataset.variantSize);
        this._variants[idx].size = e.target.value.trim();
        this._updateVariantsPreview();
      });
      input.addEventListener('input', e => {
        const idx = parseInt(e.target.dataset.variantSize);
        this._variants[idx].size = e.target.value.trim();
        this._updateVariantsPreview();
      });
    });

    list.querySelectorAll('[data-variant-stock]').forEach(input => {
      input.addEventListener('change', e => {
        const idx = parseInt(e.target.dataset.variantStock);
        const stock = parseInt(e.target.value, 10) || 0;
        this._variants[idx].stock = Math.max(0, stock);
        e.target.value = this._variants[idx].stock;
        this._updateVariantsPreview();
      });
      input.addEventListener('input', e => {
        const idx = parseInt(e.target.dataset.variantStock);
        const stock = parseInt(e.target.value, 10) || 0;
        this._variants[idx].stock = Math.max(0, stock);
        this._updateVariantsPreview();
      });
    });

    list.querySelectorAll('[data-remove-variant]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        const idx = parseInt(btn.dataset.removeVariant);
        this._variants.splice(idx, 1);
        this._renderVariants();
        this._updateVariantsPreview();
      });
    });

    this._updateVariantsPreview();
  },

  _updateVariantsPreview() {
    const preview = document.getElementById('variants-preview');
    if (!preview) return;

    const variants = this._variants
      .filter(v => v.size.trim() !== '')
      .map(v => ({ size: v.size, stock: v.stock }));

    const json = { variants };
    preview.textContent = JSON.stringify(json);
  },

  _addVariant() {
    this._variants.push({ size: '', stock: 0 });
    this._renderVariants();
  },

  _clearErrors() {
    document.querySelectorAll('[data-field], #metadata-error, #variants-error').forEach(el => {
      el.textContent = '';
      el.classList.add('d-none');
    });
    document.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
  },

  _showFieldErrors(fieldErrors) {
    for (const [field, errors] of Object.entries(fieldErrors)) {
      const errEl = document.querySelector(`[data-field="${field}"]`);
      if (errEl) {
        errEl.textContent = Array.isArray(errors) ? errors.join(', ') : errors;
        errEl.classList.remove('d-none');
      }
      const input = document.querySelector(`[name="${field}"], [name="${field}_display"]`);
      if (input) input.classList.add('is-invalid');
    }
  },

  async _submit() {
    this._clearErrors();

    const form    = document.getElementById('product-form');
    const saveBtn = document.getElementById('save-btn');

    const name        = form.querySelector('[name=name]').value.trim();
    const description = form.querySelector('[name=description]').value.trim();
    const priceRaw    = form.querySelector('[name=price_display]').value;
    const currency    = form.querySelector('[name=currency]').value;
    const stockInput  = document.getElementById('stock-input');
    const unlimited   = document.getElementById('unlimited-check').checked;
    const active      = document.getElementById('active-toggle').checked;
    const metaRaw     = document.getElementById('metadata-input').value.trim();

    // Validate price
    const price = parsePriceInput(priceRaw);
    if (!price || price < 1) {
      const el = document.querySelector('[data-field=price]');
      if (el) { el.textContent = 'Enter a valid price greater than 0'; el.classList.remove('d-none'); }
      return;
    }

    // Validate metadata JSON
    let metadata = {};
    if (metaRaw) {
      try {
        metadata = JSON.parse(metaRaw);
        if (typeof metadata !== 'object' || Array.isArray(metadata) || metadata === null) throw new Error();
      } catch {
        const el = document.getElementById('metadata-error');
        el.textContent = 'Must be a valid JSON object, e.g. { "sku": "WP-001" }';
        el.classList.remove('d-none');
        return;
      }
    }

    // Add variants to metadata
    const variants = this._variants
      .filter(v => v.size.trim() !== '')
      .map(v => ({ size: v.size, stock: v.stock }));

    if (variants.length > 0) {
      metadata.variants = variants;
    }

    const stock = unlimited ? -1 : parseInt(stockInput.value, 10);

    const payload = {
      name,
      description,
      price,
      currency,
      stock,
      active,
      images:   this._images.map(i => i.url),
      metadata,
    };

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving…';

    try {
      if (this._isNew) {
        const created = await Api.createProduct(payload);
        Toast.success('Product created');
        // Navigate to the edit view for the new product
        Router.go(`/products/${created.id}/edit`);
      } else {
        await Api.updateProduct(this._id, payload);
        Toast.success('Changes saved');
      }
    } catch (err) {
      if (err.details?.fieldErrors) {
        this._showFieldErrors(err.details.fieldErrors);
      } else {
        Toast.error(err.message);
      }
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<i class="bi bi-check-lg me-1"></i>${this._isNew ? 'Create Product' : 'Save Changes'}`;
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// View: Orders List
// ═══════════════════════════════════════════════════════════════
const ORDER_QUICK_FILTERS = [
  { label: 'All orders',   icon: 'bi-list-ul',    status: '',          fulfill: '' },
  { label: 'To fulfil',    icon: 'bi-inbox',      status: 'paid',      fulfill: 'unfulfilled' },
  { label: 'Processing',   icon: 'bi-hourglass-split', status: '',     fulfill: 'processing' },
  { label: 'Shipped',      icon: 'bi-truck',      status: '',          fulfill: 'shipped' },
  { label: 'Unpaid',       icon: 'bi-cart-x',     status: 'pending',   fulfill: '' },
  { label: 'Cancelled',    icon: 'bi-x-circle',   status: 'cancelled', fulfill: '' },
];

const OrdersListView = {
  _offset:        0,
  _limit:         25,
  _statusFilter:  '',
  _fulfillFilter: '',
  _search:        '',
  _range:         '',
  _sort:          'created_at',
  _direction:     'desc',
  _total:         0,

  render(params = {}) {
    // Deep links from the dashboard arrive as #/orders?status=paid&…
    this._statusFilter  = params.status ?? '';
    this._fulfillFilter = params.fulfillment_status ?? '';
    this._search        = params.search ?? '';
    this._range         = params.range ?? '';
    this._offset        = 0;

    const pills = ORDER_QUICK_FILTERS.map(f => `
      <button class="btn btn-sm range-pill ${this._isActivePill(f) ? 'active' : ''}"
              data-status="${f.status}" data-fulfill="${f.fulfill}">
        <i class="bi ${f.icon} me-1"></i>${escHtml(f.label)}
      </button>`).join('');

    return `
      ${renderNavbar()}
      <div class="container-fluid page">
        <div class="page-head">
          <div>
            <h1 class="page-title">Orders</h1>
            <p class="page-sub">Fulfil and track customer orders</p>
          </div>
        </div>

        <div class="range-bar" id="order-filters">${pills}</div>

        <div class="card">
          <div class="card-header filter-bar">
            <div class="search-field">
              <i class="bi bi-search"></i>
              <input type="search" class="form-control form-control-sm" id="order-search"
                     placeholder="Email, name, order ID, tracking" value="${escHtml(this._search)}" autocomplete="off">
            </div>
            <select class="form-select form-select-sm" id="order-range">
              <option value="">Any date</option>
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="mtd">This month</option>
              <option value="last_month">Last month</option>
              <option value="ytd">Year to date</option>
            </select>
            <select class="form-select form-select-sm" id="order-sort">
              <option value="created_at:desc">Newest first</option>
              <option value="created_at:asc">Oldest first</option>
              <option value="amount_total:desc">Highest value</option>
              <option value="amount_total:asc">Lowest value</option>
            </select>
            <span class="text-secondary small ms-auto" id="orders-count"></span>
          </div>

          <div id="orders-list">
            <div class="p-4 text-center"><div class="spinner-border text-success"></div></div>
          </div>

          <div class="card-footer d-flex justify-content-between align-items-center">
            <button class="btn btn-sm btn-outline-secondary" id="orders-prev-btn" disabled>
              <i class="bi bi-chevron-left me-1"></i>Prev
            </button>
            <span class="text-secondary small" id="orders-page-info"></span>
            <button class="btn btn-sm btn-outline-secondary" id="orders-next-btn" disabled>
              Next<i class="bi bi-chevron-right ms-1"></i>
            </button>
          </div>
        </div>
      </div>`;
  },

  _isActivePill(f) {
    return f.status === this._statusFilter && f.fulfill === this._fulfillFilter;
  },

  async init() {
    document.getElementById('order-range').value = this._range;

    document.getElementById('order-filters').addEventListener('click', e => {
      const btn = e.target.closest('[data-status]');
      if (!btn) return;
      document.querySelectorAll('#order-filters .range-pill')
        .forEach(b => b.classList.toggle('active', b === btn));
      this._statusFilter  = btn.dataset.status;
      this._fulfillFilter = btn.dataset.fulfill;
      this._offset = 0;
      this._load();
    });

    let t;
    document.getElementById('order-search').addEventListener('input', e => {
      clearTimeout(t);
      t = setTimeout(() => { this._search = e.target.value.trim(); this._offset = 0; this._load(); }, 300);
    });

    document.getElementById('order-range').addEventListener('change', e => {
      this._range = e.target.value; this._offset = 0; this._load();
    });

    document.getElementById('order-sort').addEventListener('change', e => {
      [this._sort, this._direction] = e.target.value.split(':');
      this._offset = 0;
      this._load();
    });

    document.getElementById('orders-prev-btn').addEventListener('click', () => {
      this._offset = Math.max(0, this._offset - this._limit); this._load();
    });
    document.getElementById('orders-next-btn').addEventListener('click', () => {
      this._offset += this._limit; this._load();
    });

    await this._load();
  },

  async _load() {
    const list = document.getElementById('orders-list');
    if (!list) return;
    list.innerHTML = '<div class="p-4 text-center"><div class="spinner-border text-success"></div></div>';

    try {
      const { data: orders, pagination } = await Api.getOrders({
        limit:              this._limit,
        offset:             this._offset,
        status:             this._statusFilter,
        fulfillment_status: this._fulfillFilter,
        search:             this._search,
        sort:               this._sort,
        direction:          this._direction,
        range:              this._range,
        tz_offset_minutes:  this._range ? tzOffsetMinutes() : undefined,
      });
      if (!document.getElementById('orders-list')) return;
      this._total = pagination?.total ?? orders.length;
      this._renderRows(orders);
      this._renderPagination(pagination, orders.length);
    } catch (err) {
      list.innerHTML = `<div class="empty-state text-danger">
        <i class="bi bi-exclamation-circle"></i>${escHtml(err.message)}
      </div>`;
    }
  },

  _renderRows(orders) {
    const list = document.getElementById('orders-list');
    document.getElementById('orders-count').textContent =
      `${this._total.toLocaleString()} order${this._total !== 1 ? 's' : ''}`;

    if (!orders.length) {
      list.innerHTML = `<div class="empty-state">
        <i class="bi bi-inbox"></i>No orders match these filters
      </div>`;
      return;
    }

    list.innerHTML = `<div class="rec-list">${orders.map(o => `
      <a class="rec-row rec-link" href="#/orders/${escHtml(o.id)}">
        <div class="rec-main">
          <div class="rec-title">
            <span class="font-monospace">#${escHtml(o.id.slice(0, 8).toUpperCase())}</span>
            <span class="rec-amount d-md-none">${escHtml(formatPrice(o.amount_total, o.currency))}</span>
          </div>
          <div class="rec-sub">
            ${escHtml(o.customer_name ?? o.customer_email ?? '—')}
            ${o.items?.length ? ` · ${o.items.length} item${o.items.length !== 1 ? 's' : ''}` : ''}
            ${o.tracking_number ? ` · <i class="bi bi-truck"></i> ${escHtml(o.tracking_number)}` : ''}
          </div>
        </div>
        <div class="rec-status">
          ${statusBadge(o.status)}${fulfillmentBadge(o.fulfillment_status)}
        </div>
        <div class="rec-date text-secondary small">${escHtml(formatDate(o.created_at))}</div>
        <div class="rec-total d-none d-md-block">${escHtml(formatPrice(o.amount_total, o.currency))}</div>
        <i class="bi bi-chevron-right rec-chevron"></i>
      </a>`).join('')}</div>`;
  },

  _renderPagination(p, count) {
    const prev  = document.getElementById('orders-prev-btn');
    const next  = document.getElementById('orders-next-btn');
    const info  = document.getElementById('orders-page-info');
    const total = p?.total ?? count;
    const pages = Math.max(1, Math.ceil(total / this._limit));
    const page  = Math.floor(this._offset / this._limit) + 1;

    prev.disabled = this._offset === 0;
    next.disabled = p ? !p.has_more : count < this._limit;
    info.textContent = total ? `Page ${page} of ${pages}` : '';
  },
};

// ═══════════════════════════════════════════════════════════════
// View: Order Detail
// ═══════════════════════════════════════════════════════════════
const OrderDetailView = {
  _id:    null,
  _order: null,

  render(id) {
    this._id    = id;
    this._order = null;
    return `
      ${renderNavbar()}
      <div class="container py-4" style="max-width:960px">
        <div class="d-flex align-items-center gap-3 mb-4 flex-wrap">
          <a href="#/orders" class="btn btn-sm btn-outline-secondary">
            <i class="bi bi-arrow-left me-1"></i>Orders
          </a>
          <h1 class="fw-black mb-0" id="order-title" style="font-size:1.3rem;letter-spacing:-0.01em">
            <span style="color:var(--text-muted)">Loading…</span>
          </h1>
        </div>
        <div id="order-loader" class="page-loader">
          <div class="spinner-border text-success"></div>
        </div>
        <div id="order-content" class="d-none"></div>
      </div>`;
  },

  async init(id) {
    this._id = id;
    await this._load();
  },

  async _load() {
    try {
      this._order = await Api.getOrder(this._id);
      this._renderContent();
    } catch (err) {
      document.getElementById('order-loader').innerHTML =
        `<div class="alert alert-danger"><i class="bi bi-exclamation-triangle me-2"></i>Failed to load order: ${escHtml(err.message)}</div>`;
    }
  },

  _renderContent() {
    const o = this._order;
    document.getElementById('order-title').innerHTML =
      `Order <span class="font-monospace">#${o.id.slice(0, 8).toUpperCase()}</span>
       <span class="ms-2">${statusBadge(o.status)}</span>
       <span class="ms-1">${fulfillmentBadge(o.fulfillment_status)}</span>`;

    document.getElementById('order-loader').classList.add('d-none');
    const content = document.getElementById('order-content');
    content.classList.remove('d-none');
    content.innerHTML = this._buildHtml(o);
    this._bindEvents();
  },

  _buildHtml(o) {
    return `
      <div class="row g-4">

        <!-- ── Left column ─────────────────────────────────── -->
        <div class="col-lg-7">

          <!-- Customer & Shipping -->
          <div class="card mb-4">
            <div class="card-header small fw-semibold text-uppercase text-secondary d-flex justify-content-between align-items-center">
              Customer &amp; Shipping
              <button class="btn btn-sm btn-outline-secondary" id="edit-addr-btn">
                <i class="bi bi-pencil me-1"></i>Edit
              </button>
            </div>
            <!-- Display mode -->
            <div class="card-body" id="addr-display">
              ${this._addrDisplay(o)}
            </div>
            <!-- Edit mode (hidden) -->
            <div class="card-body d-none" id="addr-edit">
              ${this._addrForm(o)}
            </div>
          </div>

          <!-- Fulfillment actions -->
          <div class="card mb-4">
            <div class="card-header small fw-semibold text-uppercase text-secondary">
              Fulfillment
            </div>
            <div class="card-body">

              <!-- Quick action buttons -->
              <div class="mb-3">
                <div class="text-secondary small mb-2 fw-semibold">Quick Actions</div>
                <div class="d-flex flex-wrap gap-2" id="quick-actions">
                  ${this._quickActions(o)}
                </div>
              </div>

              <hr class="border-secondary">

              <!-- Existing tracking info (read-only banner) -->
              ${o.tracking_number ? `
              <div class="alert alert-secondary py-2 mb-3 d-flex align-items-center justify-content-between flex-wrap gap-2">
                <div class="small">
                  <i class="bi bi-truck me-2"></i>
                  <strong>${escHtml(o.shipping_carrier ?? '')}</strong>
                  ${o.shipping_service ? `<span class="text-secondary ms-1">${escHtml(o.shipping_service)}</span>` : ''}
                  <span class="ms-2 font-monospace">${escHtml(o.tracking_number)}</span>
                </div>
                ${o.label_url
                  ? `<a href="${escHtml(o.label_url)}" target="_blank" rel="noopener" class="btn btn-sm btn-outline-primary">
                       <i class="bi bi-printer me-1"></i>Print Label
                     </a>`
                  : ''}
              </div>` : ''}

              <!-- Manual tracking form -->
              <div class="text-secondary small mb-2 fw-semibold">Tracking Information</div>
              <form id="tracking-form">
                <div class="row g-2">
                  <div class="col-sm-6">
                    <label class="form-label small mb-1">Carrier</label>
                    <select class="form-select form-select-sm" name="shipping_carrier">
                      <option value="">— Select —</option>
                      ${['USPS','UPS','FedEx','DHL'].map(c =>
                        `<option value="${c}" ${o.shipping_carrier === c ? 'selected' : ''}>${c}</option>`
                      ).join('')}
                    </select>
                  </div>
                  <div class="col-sm-6">
                    <label class="form-label small mb-1">Service</label>
                    <input type="text" class="form-control form-control-sm" name="shipping_service"
                           value="${escHtml(o.shipping_service ?? '')}" placeholder="e.g. Priority Mail">
                  </div>
                  <div class="col-12">
                    <label class="form-label small mb-1">Tracking Number</label>
                    <input type="text" class="form-control form-control-sm" name="tracking_number"
                           value="${escHtml(o.tracking_number ?? '')}" placeholder="Enter tracking number">
                  </div>
                  <div class="col-12">
                    <label class="form-label small mb-1">Label URL <span class="text-secondary">(optional)</span></label>
                    <input type="url" class="form-control form-control-sm" name="label_url"
                           value="${escHtml(o.label_url ?? '')}" placeholder="https://...">
                  </div>
                </div>
                <button type="submit" class="btn btn-sm btn-primary mt-3" id="save-tracking-btn">
                  <i class="bi bi-check-lg me-1"></i>Save Tracking
                </button>
              </form>

              <hr class="border-secondary">

              <!-- Notes -->
              <div class="text-secondary small mb-2 fw-semibold">Internal Notes <span class="fw-normal">(not shown to customer)</span></div>
              <form id="notes-form">
                <textarea class="form-control form-control-sm" name="notes" rows="3"
                          placeholder="Add packing notes, customer requests, etc.…">${escHtml(o.notes ?? '')}</textarea>
                <button type="submit" class="btn btn-sm btn-outline-secondary mt-2">
                  <i class="bi bi-save me-1"></i>Save Notes
                </button>
              </form>
            </div>
          </div>

        </div>

        <!-- ── Right column ────────────────────────────────── -->
        <div class="col-lg-5">

          <!-- Line items -->
          <div class="card mb-4">
            <div class="card-header small fw-semibold text-uppercase text-secondary">
              Order Items
            </div>
            ${(o.items ?? []).length === 0
              ? '<div class="card-body text-secondary small">No items</div>'
              : `<ul class="list-group list-group-flush">
                  ${(o.items ?? []).map(item => `
                    <li class="list-group-item bg-transparent border-secondary px-3 py-2">
                      <div class="d-flex justify-content-between align-items-start gap-2">
                        <div>
                          <div class="fw-semibold small">${escHtml(item.product_name ?? '—')}</div>
                          <div class="text-secondary" style="font-size:0.75rem">
                            ${item.quantity} × ${formatPrice(item.price, item.currency)}
                          </div>
                        </div>
                        <div class="fw-semibold small text-nowrap">
                          ${formatPrice(item.price * item.quantity, item.currency)}
                        </div>
                      </div>
                    </li>`).join('')}
                  <li class="list-group-item bg-transparent border-secondary px-3 py-2">
                    <div class="d-flex justify-content-between fw-bold">
                      <span>Total</span>
                      <span class="text-success">${formatPrice(o.amount_total, o.currency)}</span>
                    </div>
                  </li>
                </ul>`}
          </div>

          <!-- Order metadata -->
          <div class="card">
            <div class="card-header small fw-semibold text-uppercase text-secondary">
              Order Details
            </div>
            <div class="card-body small">
              <dl class="row g-1 mb-0">
                <dt class="col-5 text-secondary">Order ID</dt>
                <dd class="col-7 font-monospace text-truncate" style="font-size:0.7rem" title="${escHtml(o.id)}">${escHtml(o.id)}</dd>

                <dt class="col-5 text-secondary">Date</dt>
                <dd class="col-7">${formatDate(o.created_at)}</dd>

                <dt class="col-5 text-secondary">Customer</dt>
                <dd class="col-7">${escHtml(o.customer_email ?? '—')}</dd>

                <dt class="col-5 text-secondary">Stripe Session</dt>
                <dd class="col-7 font-monospace text-truncate" style="font-size:0.7rem"
                    title="${escHtml(o.stripe_session_id ?? '')}">
                  ${o.stripe_session_id ? escHtml(o.stripe_session_id) : '—'}
                </dd>

                <dt class="col-5 text-secondary">Payment Intent</dt>
                <dd class="col-7 font-monospace text-truncate" style="font-size:0.7rem"
                    title="${escHtml(o.stripe_payment_intent_id ?? '')}">
                  ${o.stripe_payment_intent_id ? escHtml(o.stripe_payment_intent_id) : '—'}
                </dd>
              </dl>
            </div>
          </div>

        </div>
      </div>`;
  },

  _addrDisplay(o) {
    const addrLines = [
      o.shipping_address_line1,
      o.shipping_address_line2,
      [o.shipping_city, o.shipping_state, o.shipping_postal_code].filter(Boolean).join(', '),
      o.shipping_country,
    ].filter(Boolean);

    return `
      <div class="row g-3 small">
        <div class="col-sm-6">
          <div class="text-secondary mb-1">Name</div>
          <div class="fw-semibold">${escHtml(o.customer_name ?? '—')}</div>
        </div>
        <div class="col-sm-6">
          <div class="text-secondary mb-1">Email</div>
          <div>${o.customer_email
            ? `<a href="mailto:${escHtml(o.customer_email)}" class="text-decoration-none">${escHtml(o.customer_email)}</a>`
            : '—'}</div>
        </div>
        <div class="col-12">
          <div class="text-secondary mb-1">Shipping Address</div>
          ${addrLines.length
            ? `<div>${addrLines.map(l => escHtml(l)).join('<br>')}</div>`
            : '<div class="text-secondary">No address on file</div>'}
          ${o.shipping_phone
            ? `<div class="text-secondary mt-1"><i class="bi bi-telephone me-1"></i>${escHtml(o.shipping_phone)}</div>`
            : ''}
        </div>
      </div>`;
  },

  _addrForm(o) {
    const f = (name, label, value, type = 'text') => `
      <div>
        <label class="form-label small mb-1">${label}</label>
        <input type="${type}" class="form-control form-control-sm" name="${name}" value="${escHtml(value ?? '')}">
      </div>`;
    return `
      <form id="addr-form">
        <div class="row g-2">
          <div class="col-sm-6">${f('customer_name',        'Full Name',             o.customer_name)}</div>
          <div class="col-sm-6">${f('customer_email',       'Email',                 o.customer_email, 'email')}</div>
          <div class="col-12">${f('shipping_address_line1', 'Address Line 1',        o.shipping_address_line1)}</div>
          <div class="col-12">${f('shipping_address_line2', 'Address Line 2 (opt.)', o.shipping_address_line2)}</div>
          <div class="col-5">${f('shipping_city',           'City',                  o.shipping_city)}</div>
          <div class="col-3">${f('shipping_state',          'State',                 o.shipping_state)}</div>
          <div class="col-4">${f('shipping_postal_code',    'ZIP',                   o.shipping_postal_code)}</div>
          <div class="col-sm-6">${f('shipping_country',    'Country (2-char)',       o.shipping_country)}</div>
          <div class="col-sm-6">${f('shipping_phone',      'Phone',                  o.shipping_phone)}</div>
        </div>
        <div class="d-flex gap-2 mt-3">
          <button type="submit" class="btn btn-sm btn-primary">
            <i class="bi bi-check-lg me-1"></i>Save Address
          </button>
          <button type="button" class="btn btn-sm btn-secondary" id="cancel-addr-btn">Cancel</button>
        </div>
      </form>`;
  },

  _quickActions(o) {
    const { status, fulfillment_status: fs } = o;
    const btns = [];

    if (status === 'paid' && (fs === 'unfulfilled' || !fs)) {
      btns.push(`<button class="btn btn-sm btn-outline-warning" data-update='{"fulfillment_status":"processing"}'>
        <i class="bi bi-box-seam me-1"></i>Start Processing
      </button>`);
    }
    if (fs === 'processing') {
      btns.push(`<button class="btn btn-sm btn-outline-info" data-update='{"fulfillment_status":"shipped","status":"fulfilled"}'>
        <i class="bi bi-truck me-1"></i>Mark Shipped
      </button>`);
    }
    if (fs === 'shipped') {
      btns.push(`<button class="btn btn-sm btn-outline-success" data-update='{"fulfillment_status":"delivered","status":"fulfilled"}'>
        <i class="bi bi-check2-circle me-1"></i>Mark Delivered
      </button>`);
    }
    if (status !== 'cancelled') {
      btns.push(`<button class="btn btn-sm btn-outline-danger" data-update='{"status":"cancelled"}' data-confirm="Cancel this order?">
        <i class="bi bi-x-circle me-1"></i>Cancel Order
      </button>`);
    }
    if (btns.length === 0) {
      return `<span class="text-secondary small">
        Order is ${status === 'cancelled' ? 'cancelled' : 'complete — no further actions needed'}.
      </span>`;
    }
    return btns.join('');
  },

  _bindEvents() {
    // Logout already bound by init
    const editBtn = document.getElementById('edit-addr-btn');
    editBtn.addEventListener('click', () => {
      document.getElementById('addr-display').classList.add('d-none');
      document.getElementById('addr-edit').classList.remove('d-none');
      editBtn.classList.add('d-none');
    });

    // Cancel address edit
    document.getElementById('order-content').addEventListener('click', e => {
      if (e.target.closest('#cancel-addr-btn')) {
        document.getElementById('addr-display').classList.remove('d-none');
        document.getElementById('addr-edit').classList.add('d-none');
        document.getElementById('edit-addr-btn').classList.remove('d-none');
      }
    });

    // Save address
    document.getElementById('addr-form').addEventListener('submit', async e => {
      e.preventDefault();
      const btn  = e.target.querySelector('[type=submit]');
      const data = Object.fromEntries(new FormData(e.target).entries());
      // Blank string → null
      Object.keys(data).forEach(k => { if (data[k] === '') data[k] = null; });
      btn.disabled = true;
      await this._save(data, 'Address updated');
    });

    // Tracking form
    document.getElementById('tracking-form').addEventListener('submit', async e => {
      e.preventDefault();
      const btn  = document.getElementById('save-tracking-btn');
      const data = Object.fromEntries(new FormData(e.target).entries());
      Object.keys(data).forEach(k => { if (data[k] === '') data[k] = null; });
      btn.disabled = true;
      await this._save(data, 'Tracking saved');
    });

    // Notes form
    document.getElementById('notes-form').addEventListener('submit', async e => {
      e.preventDefault();
      const notes = e.target.querySelector('[name=notes]').value;
      const btn   = e.target.querySelector('[type=submit]');
      btn.disabled = true;
      await this._save({ notes }, 'Notes saved');
    });

    // Quick action buttons
    document.getElementById('quick-actions').addEventListener('click', async e => {
      const btn = e.target.closest('[data-update]');
      if (!btn) return;
      const payload  = JSON.parse(btn.dataset.update);
      const confirmMsg = btn.dataset.confirm;
      if (confirmMsg) {
        const ok = await confirmModal('Confirm', confirmMsg, 'Yes, proceed', 'btn-danger');
        if (!ok) return;
      }
      btn.disabled = true;
      await this._save(payload, 'Order updated');
    });
  },

  async _save(data, successMsg) {
    try {
      this._order = await Api.updateOrder(this._id, data);
      Toast.success(successMsg);
      this._renderContent();
    } catch (err) {
      Toast.error(err.message);
      // Re-enable any disabled buttons
      document.querySelectorAll('#order-content button[disabled]').forEach(b => { b.disabled = false; });
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// View: Subscribers (email list)
// ═══════════════════════════════════════════════════════════════
const SubscribersView = {
  _limit:  50,
  _offset: 0,
  _search: '',
  _status: '',
  _source: '',
  _total:  0,
  _rows:   [],
  _sources: new Set(),

  render() {
    return `
      ${renderNavbar()}
      <div class="container-fluid page">
        <div class="page-head">
          <div>
            <h1 class="page-title">Email list</h1>
            <p class="page-sub">Everyone who signed up for the newsletter</p>
          </div>
          <div class="d-flex gap-2">
            <a href="#/newsletter" class="btn btn-outline-secondary btn-sm">
              <i class="bi bi-envelope-paper me-1"></i><span class="d-none d-sm-inline">Write</span>
            </a>
            <button class="btn btn-primary btn-sm" id="export-btn">
              <i class="bi bi-download me-1"></i>Export<span class="d-none d-sm-inline"> CSV</span>
            </button>
          </div>
        </div>

        <div class="mini-grid mb-3" id="sub-stats">
          ${['Subscribed', 'New in 30d', 'Unsubscribed', 'Total'].map(l => `
            <div class="mini-stat">
              <div class="mini-label">${l}</div>
              <div class="mini-value"><span class="skeleton"></span></div>
            </div>`).join('')}
        </div>

        <div class="card">
          <div class="card-header filter-bar">
            <div class="search-field">
              <i class="bi bi-search"></i>
              <input type="search" class="form-control form-control-sm" id="sub-search"
                     placeholder="Search email or name" autocomplete="off">
            </div>
            <select class="form-select form-select-sm" id="sub-status">
              <option value="">All statuses</option>
              <option value="subscribed">Subscribed</option>
              <option value="unsubscribed">Unsubscribed</option>
            </select>
            <select class="form-select form-select-sm" id="sub-source">
              <option value="">All sources</option>
            </select>
            <span class="text-secondary small ms-auto" id="sub-count"></span>
          </div>

          <div id="sub-list">
            <div class="p-4 text-center"><div class="spinner-border text-success"></div></div>
          </div>

          <div class="card-footer d-flex justify-content-between align-items-center">
            <button class="btn btn-sm btn-outline-secondary" id="sub-prev" disabled>
              <i class="bi bi-chevron-left me-1"></i>Prev
            </button>
            <span class="text-secondary small" id="sub-page"></span>
            <button class="btn btn-sm btn-outline-secondary" id="sub-next" disabled>
              Next<i class="bi bi-chevron-right ms-1"></i>
            </button>
          </div>
        </div>
      </div>`;
  },

  async init() {
    let t;
    document.getElementById('sub-search').addEventListener('input', e => {
      clearTimeout(t);
      t = setTimeout(() => { this._search = e.target.value.trim(); this._offset = 0; this._load(); }, 300);
    });

    document.getElementById('sub-status').addEventListener('change', e => {
      this._status = e.target.value; this._offset = 0; this._load();
    });
    document.getElementById('sub-source').addEventListener('change', e => {
      this._source = e.target.value; this._offset = 0; this._load();
    });

    document.getElementById('sub-prev').addEventListener('click', () => {
      this._offset = Math.max(0, this._offset - this._limit); this._load();
    });
    document.getElementById('sub-next').addEventListener('click', () => {
      this._offset += this._limit; this._load();
    });

    document.getElementById('export-btn').addEventListener('click', () => this._export());

    document.getElementById('sub-list').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, id, email } = btn.dataset;
      if (action === 'edit')   this._edit(id);
      if (action === 'delete') this._delete(id, email);
      if (action === 'copy')   this._copyUnsubLink(btn.dataset.token);
    });

    this._loadStats();
    await this._load();
  },

  async _loadStats() {
    try {
      const s = await Api.getNewsletterStats();
      const el = document.getElementById('sub-stats');
      if (!el) return;
      const items = [
        { label: 'Subscribed',   value: (s.subscribed ?? 0).toLocaleString() },
        { label: 'New in 30d',   value: `+${(s.new_last_30d ?? 0).toLocaleString()}` },
        { label: 'Unsubscribed', value: (s.unsubscribed ?? 0).toLocaleString() },
        { label: 'Total',        value: (s.total ?? 0).toLocaleString() },
      ];
      el.innerHTML = items.map(i => `
        <div class="mini-stat">
          <div class="mini-label">${i.label}</div>
          <div class="mini-value">${escHtml(i.value)}</div>
        </div>`).join('');
    } catch {
      /* stats are non-critical — the list below still renders */
    }
  },

  _filters() {
    return { status: this._status, source: this._source, search: this._search };
  },

  async _load() {
    const list = document.getElementById('sub-list');
    if (!list) return;
    list.innerHTML = '<div class="p-4 text-center"><div class="spinner-border text-success"></div></div>';

    try {
      const { data, pagination } = await Api.getSubscribers({
        ...this._filters(), limit: this._limit, offset: this._offset,
      });
      if (!document.getElementById('sub-list')) return;
      this._rows  = data;
      this._total = pagination?.total ?? data.length;
      this._renderRows(data);
      this._renderPagination(pagination);
      this._refreshSources(data);
    } catch (err) {
      list.innerHTML = `<div class="empty-state text-danger">
        <i class="bi bi-exclamation-circle"></i>${escHtml(err.message)}
      </div>`;
    }
  },

  _refreshSources(rows) {
    const before = this._sources.size;
    rows.forEach(r => r.source && this._sources.add(r.source));
    if (this._sources.size === before) return;
    const sel = document.getElementById('sub-source');
    sel.innerHTML = `<option value="">All sources</option>` +
      [...this._sources].sort().map(s =>
        `<option value="${escHtml(s)}" ${s === this._source ? 'selected' : ''}>${escHtml(s)}</option>`).join('');
  },

  _renderRows(rows) {
    const list = document.getElementById('sub-list');
    document.getElementById('sub-count').textContent =
      `${this._total.toLocaleString()} subscriber${this._total !== 1 ? 's' : ''}`;

    if (!rows.length) {
      list.innerHTML = `<div class="empty-state">
        <i class="bi bi-person-plus"></i>
        ${this._search || this._status || this._source ? 'No subscribers match these filters' : 'Nobody has signed up yet'}
      </div>`;
      return;
    }

    list.innerHTML = `<div class="rec-list">${rows.map(s => {
      const tags = (s.tags ?? []).map(t => `<span class="tag-chip">${escHtml(t)}</span>`).join('');
      return `
        <div class="rec-row">
          <div class="rec-main">
            <div class="rec-title">${escHtml(s.email)}</div>
            <div class="rec-sub">
              ${s.name ? `${escHtml(s.name)} · ` : ''}
              ${s.source ? `<span class="src-chip">${escHtml(s.source)}</span>` : '<span class="text-muted">no source</span>'}
              ${s.country ? ` · ${escHtml(s.country)}` : ''}
            </div>
            ${tags ? `<div class="rec-tags">${tags}</div>` : ''}
          </div>
          <div class="rec-status">
            <span class="badge ${s.status === 'subscribed' ? 'text-bg-success' : 'text-bg-secondary'}">${escHtml(s.status)}</span>
          </div>
          <div class="rec-date text-secondary small">${escHtml(formatDate(s.subscribed_at ?? s.created_at))}</div>
          <div class="rec-actions">
            <button class="btn btn-sm btn-outline-secondary" title="Edit"
                    data-action="edit" data-id="${escHtml(s.id)}"><i class="bi bi-pencil"></i></button>
            <button class="btn btn-sm btn-outline-secondary" title="Copy unsubscribe link"
                    data-action="copy" data-token="${escHtml(s.unsubscribe_token ?? '')}"><i class="bi bi-link-45deg"></i></button>
            <button class="btn btn-sm btn-outline-danger" title="Delete"
                    data-action="delete" data-id="${escHtml(s.id)}" data-email="${escHtml(s.email)}"><i class="bi bi-trash"></i></button>
          </div>
        </div>`;
    }).join('')}</div>`;
  },

  _renderPagination(p) {
    const prev = document.getElementById('sub-prev');
    const next = document.getElementById('sub-next');
    const info = document.getElementById('sub-page');
    const total = p?.total ?? 0;
    const pages = Math.max(1, Math.ceil(total / this._limit));
    const page  = Math.floor(this._offset / this._limit) + 1;
    prev.disabled = this._offset === 0;
    next.disabled = !(p?.has_more);
    info.textContent = total ? `Page ${page} of ${pages}` : '';
  },

  async _copyUnsubLink(token) {
    if (!token) { Toast.error('No unsubscribe token on this record'); return; }
    const url = `${Config.workerUrl}/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
    try {
      await navigator.clipboard.writeText(url);
      Toast.success('Unsubscribe link copied');
    } catch {
      Toast.error('Clipboard blocked — link: ' + url);
    }
  },

  async _edit(id) {
    const sub = this._rows.find(r => r.id === id);
    if (!sub) return;

    const body = `
      <div class="mb-3">
        <label class="form-label" for="edit-name">Name</label>
        <input type="text" class="form-control" id="edit-name" value="${escHtml(sub.name ?? '')}">
      </div>
      <div class="mb-3">
        <label class="form-label" for="edit-status">Status</label>
        <select class="form-select" id="edit-status">
          <option value="subscribed"   ${sub.status === 'subscribed' ? 'selected' : ''}>Subscribed</option>
          <option value="unsubscribed" ${sub.status === 'unsubscribed' ? 'selected' : ''}>Unsubscribed</option>
        </select>
      </div>
      <div>
        <label class="form-label" for="edit-tags">Tags</label>
        <input type="text" class="form-control" id="edit-tags" value="${escHtml((sub.tags ?? []).join(', '))}"
               placeholder="vip, early-access">
        <div class="form-text">Comma separated, up to 10.</div>
      </div>`;

    const changes = await formModal(sub.email, body, root => ({
      name:   root.querySelector('#edit-name').value.trim() || null,
      status: root.querySelector('#edit-status').value,
      tags:   root.querySelector('#edit-tags').value
                .split(',').map(t => t.trim()).filter(Boolean).slice(0, 10),
    }));
    if (!changes) return;

    try {
      await Api.updateSubscriber(id, changes);
      Toast.success('Subscriber updated');
      this._load();
      this._loadStats();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async _delete(id, email) {
    const ok = await confirmModal(
      'Delete subscriber',
      `<p class="mb-1">Permanently delete <strong>${escHtml(email)}</strong>?</p>
       <p class="text-warning small mb-0"><i class="bi bi-exclamation-triangle me-1"></i>
       For a normal opt-out, edit them to “unsubscribed” instead — deleting loses the record that they opted out.</p>`,
      'Delete permanently', 'btn-danger'
    );
    if (!ok) return;
    try {
      await Api.deleteSubscriber(id);
      Toast.success('Subscriber deleted');
      this._load();
      this._loadStats();
    } catch (err) {
      Toast.error(err.message);
    }
  },

  async _export() {
    const btn = document.getElementById('export-btn');
    btn.disabled = true;
    try {
      const filters = this._filters();
      const blob = await Api.exportSubscribers({ ...filters, status: filters.status || 'subscribed' });
      downloadBlob(blob, `subscribers-${new Date().toISOString().slice(0, 10)}.csv`);
      Toast.success('CSV downloaded');
    } catch (err) {
      Toast.error(err.message);
    } finally {
      btn.disabled = false;
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// View: Newsletter composer
// ═══════════════════════════════════════════════════════════════

// Very small Markdown subset: headings, bullets, bold, italic, links.
function mdToHtml(text) {
  const inline = s => escHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" style="color:#C9A227;text-decoration:underline">$1</a>');

  return String(text ?? '')
    .split(/\n{2,}/)
    .map(block => {
      const lines = block.split('\n').filter(l => l.trim() !== '');
      if (!lines.length) return '';
      if (lines.every(l => /^\s*[-*]\s+/.test(l))) {
        const items = lines.map(l => `<li style="margin:0 0 8px">${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('');
        return `<ul style="margin:0 0 20px;padding-left:20px;color:#d8d8d8">${items}</ul>`;
      }
      if (/^##\s+/.test(lines[0])) {
        return `<h2 style="margin:28px 0 12px;font-size:19px;color:#ffffff">${inline(lines[0].replace(/^##\s+/, ''))}</h2>` +
          (lines.length > 1 ? `<p style="margin:0 0 20px;color:#d8d8d8;line-height:1.65">${lines.slice(1).map(inline).join('<br>')}</p>` : '');
      }
      if (/^#\s+/.test(lines[0])) {
        return `<h1 style="margin:24px 0 12px;font-size:24px;color:#ffffff">${inline(lines[0].replace(/^#\s+/, ''))}</h1>` +
          (lines.length > 1 ? `<p style="margin:0 0 20px;color:#d8d8d8;line-height:1.65">${lines.slice(1).map(inline).join('<br>')}</p>` : '');
      }
      return `<p style="margin:0 0 20px;color:#d8d8d8;line-height:1.65;font-size:15px">${lines.map(inline).join('<br>')}</p>`;
    })
    .join('');
}

function buildEmailHtml(d) {
  const cta = d.ctaLabel && d.ctaUrl ? `
        <tr><td align="center" style="padding:8px 0 28px">
          <a href="${escHtml(d.ctaUrl)}" style="display:inline-block;background:#C9A227;color:#000;text-decoration:none;
             font-weight:700;font-size:15px;padding:14px 30px;border-radius:6px">${escHtml(d.ctaLabel)}</a>
        </td></tr>` : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(d.subject || 'Newsletter')}</title></head>
<body style="margin:0;padding:0;background:#080808;font-family:Helvetica,Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escHtml(d.preheader ?? '')}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:600px;background:#0d0d0d;border:1px solid #1f1f1f;border-radius:10px;overflow:hidden">
        <tr><td style="padding:26px 32px;border-bottom:1px solid #1f1f1f" align="center">
          <span style="font-size:13px;letter-spacing:0.24em;text-transform:uppercase;color:#C9A227;font-weight:700">
            ${escHtml(d.brand || 'Blackstar')}</span>
        </td></tr>
        ${d.headline ? `<tr><td style="padding:32px 32px 0">
          <h1 style="margin:0;font-size:26px;line-height:1.25;color:#ffffff">${escHtml(d.headline)}</h1>
        </td></tr>` : ''}
        <tr><td style="padding:24px 32px 4px">${mdToHtml(d.body)}</td></tr>
        ${cta}
        <tr><td style="padding:22px 32px 28px;border-top:1px solid #1f1f1f;text-align:center">
          <p style="margin:0 0 8px;font-size:12px;color:#777">${escHtml(d.footer || '')}</p>
          <p style="margin:0;font-size:12px;color:#555">
            <a href="{{unsubscribe_url}}" style="color:#777;text-decoration:underline">Unsubscribe</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

const NewsletterView = {
  _draftsKey: 'blackstar_newsletter_drafts',
  _currentKey: 'blackstar_newsletter_current',
  _draft: null,
  _recipients: null,
  _sources: new Set(),

  _blank() {
    return {
      id: null, brand: 'Blackstar', subject: '', preheader: '', headline: '',
      body: '', ctaLabel: '', ctaUrl: '', footer: 'You’re receiving this because you subscribed at our store.',
      audienceStatus: 'subscribed', audienceSource: '',
    };
  },

  _drafts() {
    try { return JSON.parse(localStorage.getItem(this._draftsKey) ?? '[]'); }
    catch { return []; }
  },

  render() {
    const d = { ...this._blank(), ...(JSON.parse(localStorage.getItem(this._currentKey) || 'null') ?? {}) };
    this._draft = d;

    return `
      ${renderNavbar()}
      <div class="container-fluid page">
        <div class="page-head">
          <div>
            <h1 class="page-title">Newsletter</h1>
            <p class="page-sub">Write a campaign and export it for your email provider</p>
          </div>
          <div class="d-flex gap-2">
            <button class="btn btn-outline-secondary btn-sm" id="new-draft-btn">
              <i class="bi bi-file-earmark-plus me-1"></i><span class="d-none d-sm-inline">New</span>
            </button>
            <button class="btn btn-primary btn-sm" id="save-draft-btn">
              <i class="bi bi-save me-1"></i>Save<span class="d-none d-sm-inline"> draft</span>
            </button>
          </div>
        </div>

        <div class="alert alert-info-soft d-flex gap-3" role="alert">
          <i class="bi bi-info-circle fs-5"></i>
          <div>
            <strong>Email sending isn’t set up yet.</strong>
            <div class="small mt-1">
              The API has no send route, so nothing here goes out to subscribers. Write and save your
              campaign, then <strong>copy or download the HTML</strong> and export the recipient list —
              paste both into Mailchimp, Klaviyo, Resend or whatever you use to actually send.
              Once a send endpoint exists, this page can post straight to it.
            </div>
          </div>
        </div>

        <div class="row g-3">
          <!-- Composer -->
          <div class="col-xl-6">
            <div class="card mb-3">
              <div class="card-header">Campaign</div>
              <div class="card-body">
                <div class="mb-3">
                  <label class="form-label" for="nl-subject">Subject line <span class="text-danger">*</span></label>
                  <input type="text" class="form-control" id="nl-subject" maxlength="150"
                         placeholder="New drop: the winter collection" value="${escHtml(d.subject)}">
                  <div class="form-text"><span id="subject-len">0</span>/150 · aim for under 50 characters on mobile</div>
                </div>
                <div class="mb-3">
                  <label class="form-label" for="nl-preheader">Preview text</label>
                  <input type="text" class="form-control" id="nl-preheader" maxlength="200"
                         placeholder="The line inboxes show after the subject" value="${escHtml(d.preheader)}">
                </div>
                <div class="row g-3">
                  <div class="col-sm-6">
                    <label class="form-label" for="nl-brand">Brand name</label>
                    <input type="text" class="form-control" id="nl-brand" value="${escHtml(d.brand)}">
                  </div>
                  <div class="col-sm-6">
                    <label class="form-label" for="nl-headline">Headline</label>
                    <input type="text" class="form-control" id="nl-headline"
                           placeholder="Shown at the top of the email" value="${escHtml(d.headline)}">
                  </div>
                </div>
              </div>
            </div>

            <div class="card mb-3">
              <div class="card-header d-flex justify-content-between align-items-center">
                <span>Body</span>
                <span class="fw-normal text-secondary">**bold** · *italic* · ## heading · - bullet · [link](url)</span>
              </div>
              <div class="card-body">
                <textarea class="form-control" id="nl-body" rows="12"
                          placeholder="Write your email here.&#10;&#10;Blank lines start a new paragraph.">${escHtml(d.body)}</textarea>
                <div class="row g-3 mt-1">
                  <div class="col-sm-5">
                    <label class="form-label" for="nl-cta-label">Button label</label>
                    <input type="text" class="form-control" id="nl-cta-label" placeholder="Shop the drop" value="${escHtml(d.ctaLabel)}">
                  </div>
                  <div class="col-sm-7">
                    <label class="form-label" for="nl-cta-url">Button link</label>
                    <input type="url" class="form-control" id="nl-cta-url" placeholder="https://…" value="${escHtml(d.ctaUrl)}">
                  </div>
                  <div class="col-12">
                    <label class="form-label" for="nl-footer">Footer note</label>
                    <input type="text" class="form-control" id="nl-footer" value="${escHtml(d.footer)}">
                    <div class="form-text">
                      The footer always includes an unsubscribe link as <code>{{unsubscribe_url}}</code> —
                      most providers swap that for their own, or use
                      <code>${escHtml(Config.workerUrl ?? '')}/newsletter/unsubscribe?token=…</code> from the export.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="card mb-3">
              <div class="card-header">Audience</div>
              <div class="card-body">
                <div class="row g-3">
                  <div class="col-sm-6">
                    <label class="form-label" for="nl-aud-status">Status</label>
                    <select class="form-select" id="nl-aud-status">
                      <option value="subscribed" ${d.audienceStatus === 'subscribed' ? 'selected' : ''}>Subscribed only</option>
                      <option value="" ${d.audienceStatus === '' ? 'selected' : ''}>Everyone on the list</option>
                    </select>
                  </div>
                  <div class="col-sm-6">
                    <label class="form-label" for="nl-aud-source">Signup source</label>
                    <select class="form-select" id="nl-aud-source"><option value="">All sources</option></select>
                  </div>
                </div>
                <div class="recipient-box mt-3">
                  <div>
                    <div class="mini-label">Recipients</div>
                    <div class="mini-value" id="recipient-count"><span class="skeleton"></span></div>
                  </div>
                  <button class="btn btn-outline-secondary btn-sm" id="export-recipients">
                    <i class="bi bi-download me-1"></i>Export list
                  </button>
                </div>
              </div>
            </div>

            <div class="card mb-3">
              <div class="card-header">Send</div>
              <div class="card-body">
                <div class="d-flex flex-wrap gap-2">
                  <button class="btn btn-primary" id="send-btn" disabled>
                    <i class="bi bi-send me-1"></i>Send campaign
                  </button>
                  <button class="btn btn-outline-secondary" id="copy-html">
                    <i class="bi bi-clipboard me-1"></i>Copy HTML
                  </button>
                  <button class="btn btn-outline-secondary" id="download-html">
                    <i class="bi bi-filetype-html me-1"></i>Download .html
                  </button>
                </div>
                <p class="form-text mb-0 mt-2">
                  <i class="bi bi-lock me-1"></i>Sending is disabled — no send route exists on the API yet.
                </p>
              </div>
            </div>
          </div>

          <!-- Preview + drafts -->
          <div class="col-xl-6">
            <div class="card mb-3 preview-card">
              <div class="card-header d-flex justify-content-between align-items-center">
                <span>Preview</span>
                <div class="btn-group btn-group-sm" id="preview-width">
                  <button class="btn btn-outline-secondary active" data-width="full">Desktop</button>
                  <button class="btn btn-outline-secondary" data-width="mobile">Mobile</button>
                </div>
              </div>
              <div class="card-body p-0">
                <div class="inbox-strip">
                  <div class="inbox-subject" id="preview-subject">No subject</div>
                  <div class="inbox-preheader" id="preview-preheader"></div>
                </div>
                <div class="preview-frame-wrap" id="preview-wrap">
                  <iframe id="email-preview" title="Email preview"></iframe>
                </div>
              </div>
            </div>

            <div class="card mb-4">
              <div class="card-header">Saved drafts</div>
              <div id="draft-list"></div>
            </div>
          </div>
        </div>
      </div>`;
  },

  init() {
    const fields = ['subject', 'preheader', 'brand', 'headline', 'body', 'cta-label', 'cta-url', 'footer'];
    fields.forEach(f => {
      document.getElementById(`nl-${f}`).addEventListener('input', () => this._sync());
    });
    document.getElementById('nl-aud-status').addEventListener('change', () => { this._sync(); this._countRecipients(); });
    document.getElementById('nl-aud-source').addEventListener('change', () => { this._sync(); this._countRecipients(); });

    document.getElementById('save-draft-btn').addEventListener('click', () => this._saveDraft());
    document.getElementById('new-draft-btn').addEventListener('click', () => this._newDraft());
    document.getElementById('copy-html').addEventListener('click', () => this._copyHtml());
    document.getElementById('download-html').addEventListener('click', () => this._downloadHtml());
    document.getElementById('export-recipients').addEventListener('click', () => this._exportRecipients());

    document.getElementById('send-btn').addEventListener('click', () =>
      Toast.error('Sending isn’t wired up yet — export the HTML and send from your email provider.'));

    document.getElementById('preview-width').addEventListener('click', e => {
      const btn = e.target.closest('[data-width]');
      if (!btn) return;
      document.querySelectorAll('#preview-width .btn').forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('preview-wrap').classList.toggle('mobile', btn.dataset.width === 'mobile');
    });

    document.getElementById('draft-list').addEventListener('click', e => {
      const btn = e.target.closest('[data-draft-action]');
      if (!btn) return;
      if (btn.dataset.draftAction === 'load')   this._loadDraft(btn.dataset.id);
      if (btn.dataset.draftAction === 'delete') this._deleteDraft(btn.dataset.id);
    });

    this._sync();
    this._renderDrafts();
    this._loadSources();
    this._countRecipients();
  },

  _read() {
    const v = id => document.getElementById(id)?.value ?? '';
    return {
      id:       this._draft.id,
      brand:    v('nl-brand'),
      subject:  v('nl-subject'),
      preheader: v('nl-preheader'),
      headline: v('nl-headline'),
      body:     v('nl-body'),
      ctaLabel: v('nl-cta-label'),
      ctaUrl:   v('nl-cta-url'),
      footer:   v('nl-footer'),
      audienceStatus: v('nl-aud-status'),
      audienceSource: v('nl-aud-source'),
    };
  },

  // Mirror the form into the preview and keep an autosave copy so a
  // half-written campaign survives navigating away.
  _sync() {
    this._draft = this._read();
    localStorage.setItem(this._currentKey, JSON.stringify(this._draft));

    document.getElementById('subject-len').textContent = this._draft.subject.length;
    document.getElementById('preview-subject').textContent = this._draft.subject || 'No subject';
    document.getElementById('preview-preheader').textContent =
      this._draft.preheader || (this._draft.body || '').replace(/[#*\-]/g, '').split('\n')[0].slice(0, 90);
    document.getElementById('email-preview').srcdoc = buildEmailHtml(this._draft);
  },

  async _loadSources() {
    try {
      const { data } = await Api.getSubscribers({ limit: 200, status: 'subscribed' });
      data.forEach(s => s.source && this._sources.add(s.source));
      const sel = document.getElementById('nl-aud-source');
      if (!sel) return;
      const current = this._draft.audienceSource;
      sel.innerHTML = `<option value="">All sources</option>` +
        [...this._sources].sort().map(s =>
          `<option value="${escHtml(s)}" ${s === current ? 'selected' : ''}>${escHtml(s)}</option>`).join('');
    } catch {
      /* the source filter is optional — leave it as "all" */
    }
  },

  async _countRecipients() {
    const el = document.getElementById('recipient-count');
    if (!el) return;
    el.innerHTML = '<span class="skeleton"></span>';
    try {
      const { pagination } = await Api.getSubscribers({
        status: this._draft.audienceStatus,
        source: this._draft.audienceSource,
        limit: 1,
      });
      if (!document.getElementById('recipient-count')) return;
      this._recipients = pagination?.total ?? 0;
      el.textContent = this._recipients.toLocaleString();
    } catch (err) {
      el.textContent = '—';
    }
  },

  _saveDraft() {
    const draft = this._read();
    if (!draft.subject.trim()) { Toast.error('Give the campaign a subject line first'); return; }

    const drafts = this._drafts();
    const now = new Date().toISOString();
    if (draft.id) {
      const i = drafts.findIndex(x => x.id === draft.id);
      if (i >= 0) drafts[i] = { ...draft, updated_at: now };
      else drafts.unshift({ ...draft, updated_at: now });
    } else {
      draft.id = `d${Date.now()}`;
      this._draft.id = draft.id;
      drafts.unshift({ ...draft, updated_at: now });
    }
    localStorage.setItem(this._draftsKey, JSON.stringify(drafts.slice(0, 30)));
    localStorage.setItem(this._currentKey, JSON.stringify(draft));
    this._renderDrafts();
    Toast.success('Draft saved on this device');
  },

  _newDraft() {
    localStorage.removeItem(this._currentKey);
    this._draft = this._blank();
    ['subject', 'preheader', 'headline', 'body', 'cta-label', 'cta-url'].forEach(f => {
      document.getElementById(`nl-${f}`).value = '';
    });
    document.getElementById('nl-footer').value = this._draft.footer;
    this._sync();
    Toast.success('Started a new draft');
  },

  _loadDraft(id) {
    const draft = this._drafts().find(d => d.id === id);
    if (!draft) return;
    this._draft = draft;
    const set = (f, v) => { document.getElementById(`nl-${f}`).value = v ?? ''; };
    set('brand', draft.brand); set('subject', draft.subject); set('preheader', draft.preheader);
    set('headline', draft.headline); set('body', draft.body);
    set('cta-label', draft.ctaLabel); set('cta-url', draft.ctaUrl); set('footer', draft.footer);
    document.getElementById('nl-aud-status').value = draft.audienceStatus ?? 'subscribed';
    this._sync();
    this._draft.id = id;
    this._countRecipients();
    this._renderDrafts();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  async _deleteDraft(id) {
    const ok = await confirmModal('Delete draft', '<p class="mb-0">Delete this saved draft?</p>', 'Delete', 'btn-danger');
    if (!ok) return;
    localStorage.setItem(this._draftsKey, JSON.stringify(this._drafts().filter(d => d.id !== id)));
    if (this._draft.id === id) this._draft.id = null;
    this._renderDrafts();
    Toast.success('Draft deleted');
  },

  _renderDrafts() {
    const drafts = this._drafts();
    const el = document.getElementById('draft-list');
    if (!drafts.length) {
      el.innerHTML = `<div class="empty-state small"><i class="bi bi-file-earmark-text"></i>
        No saved drafts. Drafts live in this browser only.</div>`;
      return;
    }
    el.innerHTML = `<div class="rec-list">${drafts.map(d => `
      <div class="rec-row">
        <div class="rec-main">
          <div class="rec-title">${escHtml(d.subject || 'Untitled')}</div>
          <div class="rec-sub">Edited ${escHtml(relativeTime(d.updated_at))}${d.id === this._draft.id ? ' · <span class="text-warning">open</span>' : ''}</div>
        </div>
        <div class="rec-actions">
          <button class="btn btn-sm btn-outline-secondary" data-draft-action="load" data-id="${escHtml(d.id)}">Open</button>
          <button class="btn btn-sm btn-outline-danger" data-draft-action="delete" data-id="${escHtml(d.id)}">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </div>`).join('')}</div>`;
  },

  async _copyHtml() {
    try {
      await navigator.clipboard.writeText(buildEmailHtml(this._read()));
      Toast.success('Email HTML copied to clipboard');
    } catch {
      Toast.error('Clipboard blocked — use “Download .html” instead');
    }
  },

  _downloadHtml() {
    const draft = this._read();
    const slug = (draft.subject || 'newsletter').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    downloadBlob(new Blob([buildEmailHtml(draft)], { type: 'text/html' }), `${slug || 'newsletter'}.html`);
    Toast.success('HTML downloaded');
  },

  async _exportRecipients() {
    const btn = document.getElementById('export-recipients');
    btn.disabled = true;
    try {
      const blob = await Api.exportSubscribers({
        status: this._draft.audienceStatus || undefined,
        source: this._draft.audienceSource || undefined,
      });
      downloadBlob(blob, `recipients-${new Date().toISOString().slice(0, 10)}.csv`);
      Toast.success('Recipient list downloaded');
    } catch (err) {
      Toast.error(err.message);
    } finally {
      btn.disabled = false;
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// View: Settings (storefront header video)
// ═══════════════════════════════════════════════════════════════
const SettingsView = {
  _video: { desktop_url: null, mobile_url: null, poster_url: null },

  render() {
    return `
      ${renderNavbar()}
      <div class="container py-4" style="max-width:760px">
        <div class="page-head">
          <div>
            <h1 class="page-title">Settings</h1>
            <p class="page-sub">Storefront configuration</p>
          </div>
        </div>

        <div id="settings-loader" class="page-loader">
          <div class="spinner-border text-success"></div>
        </div>

        <form id="video-form" class="d-none" novalidate>
          <div class="card mb-3">
            <div class="card-header">Landing page header video</div>
            <div class="card-body">
              <p class="text-secondary small">
                The looping video at the top of the landing page. This stores links only — host the files on
                Cloudflare Stream, Mux or a public R2 bucket. (The image uploader rejects MP4s.)
              </p>

              <div class="mb-3">
                <label class="form-label" for="desktop-url">Desktop video URL</label>
                <input type="url" class="form-control" id="desktop-url" placeholder="https://cdn.example.com/hero-desktop.mp4">
                <div class="form-text">Leave empty to fall back to the static header.</div>
              </div>

              <div class="form-check form-switch mb-2">
                <input class="form-check-input" type="checkbox" id="same-on-mobile">
                <label class="form-check-label" for="same-on-mobile">Use the same video on mobile</label>
              </div>

              <div class="mb-3" id="mobile-wrap">
                <label class="form-label" for="mobile-url">Mobile video URL</label>
                <input type="url" class="form-control" id="mobile-url" placeholder="https://cdn.example.com/hero-mobile.mp4">
                <div class="form-text">Usually a tighter crop for portrait screens.</div>
              </div>

              <div class="mb-3">
                <label class="form-label" for="poster-url">Poster image URL</label>
                <input type="url" class="form-control" id="poster-url" placeholder="https://cdn.example.com/hero.jpg">
                <div class="form-text">
                  Shown while the video loads or if autoplay is blocked — this is your largest contentful paint.
                </div>
              </div>

              <div id="video-error" class="alert alert-danger d-none py-2 small"></div>

              <div class="d-flex flex-wrap gap-2">
                <button type="submit" class="btn btn-primary" id="save-video">Save changes</button>
                <button type="button" class="btn btn-outline-danger" id="clear-video">Clear all</button>
              </div>
            </div>
          </div>

          <div class="card mb-4">
            <div class="card-header">Preview</div>
            <div class="card-body">
              <div class="video-previews" id="video-previews"></div>
            </div>
          </div>
        </form>
      </div>`;
  },

  async init() {
    const form = document.getElementById('video-form');

    document.getElementById('same-on-mobile').addEventListener('change', e => {
      document.getElementById('mobile-wrap').classList.toggle('d-none', e.target.checked);
      if (e.target.checked) document.getElementById('mobile-url').value = '';
      this._preview();
    });

    ['desktop-url', 'mobile-url', 'poster-url'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => this._preview());
    });

    form.addEventListener('submit', e => { e.preventDefault(); this._save(); });
    document.getElementById('clear-video').addEventListener('click', () => this._clear());

    try {
      this._video = await Api.getHeaderVideo();
      this._fill();
    } catch (err) {
      Toast.error(err.message);
    } finally {
      const loader = document.getElementById('settings-loader');
      if (loader) {
        loader.classList.add('d-none');
        document.getElementById('video-form').classList.remove('d-none');
      }
    }
  },

  _fill() {
    const v = this._video ?? {};
    document.getElementById('desktop-url').value = v.desktop_url ?? '';
    document.getElementById('mobile-url').value  = v.mobile_url ?? '';
    document.getElementById('poster-url').value  = v.poster_url ?? '';
    // mobile_url === null means "same video everywhere"
    const same = !v.mobile_url;
    document.getElementById('same-on-mobile').checked = same;
    document.getElementById('mobile-wrap').classList.toggle('d-none', same);
    this._preview();
  },

  _values() {
    const val = id => document.getElementById(id).value.trim();
    const same = document.getElementById('same-on-mobile').checked;
    return {
      desktop_url: val('desktop-url') || null,
      mobile_url:  same ? null : (val('mobile-url') || null),
      poster_url:  val('poster-url') || null,
    };
  },

  _preview() {
    const v = this._values();
    const el = document.getElementById('video-previews');
    const box = (label, src, poster) => {
      if (!src && !poster) {
        return `<div class="video-box"><div class="video-box-label">${label}</div>
          <div class="video-empty">Not set</div></div>`;
      }
      return `<div class="video-box">
        <div class="video-box-label">${label}</div>
        ${src
          ? `<video src="${escHtml(src)}" ${poster ? `poster="${escHtml(poster)}"` : ''}
                   autoplay loop muted playsinline preload="metadata"></video>`
          : `<img src="${escHtml(poster)}" alt="Poster">`}
      </div>`;
    };
    el.innerHTML =
      box('Desktop', v.desktop_url, v.poster_url) +
      box('Mobile', v.mobile_url ?? v.desktop_url, v.poster_url) +
      box('Poster', null, v.poster_url);
  },

  async _save() {
    const btn   = document.getElementById('save-video');
    const errEl = document.getElementById('video-error');
    const body  = this._values();

    errEl.classList.add('d-none');
    const bad = Object.entries(body).find(([, url]) => url && !/^https?:\/\//i.test(url));
    if (bad) {
      errEl.textContent = 'URLs must start with http:// or https://';
      errEl.classList.remove('d-none');
      return;
    }

    btn.disabled = true;
    try {
      this._video = await Api.updateHeaderVideo(body);
      this._fill();
      Toast.success('Header video saved — allow up to a minute for the storefront cache');
    } catch (err) {
      errEl.textContent = err.details?.fieldErrors
        ? Object.entries(err.details.fieldErrors).map(([k, v]) => `${k}: ${v.join(', ')}`).join(' · ')
        : err.message;
      errEl.classList.remove('d-none');
    } finally {
      btn.disabled = false;
    }
  },

  async _clear() {
    const ok = await confirmModal(
      'Clear header video',
      '<p class="mb-0">Clear all three URLs? The storefront falls back to its static header.</p>',
      'Clear', 'btn-danger'
    );
    if (!ok) return;
    try {
      this._video = await Api.clearHeaderVideo();
      this._fill();
      Toast.success('Header video cleared');
    } catch (err) {
      Toast.error(err.message);
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// Router
// ═══════════════════════════════════════════════════════════════
const Router = {
  _current: null,

  go(path) { location.hash = `#${path}`; },

  init() {
    window.addEventListener('hashchange', () => this._route());
    this._route();
  },

  // Renders a view and wires the shared shell. `arg` is passed to
  // render()/init() for detail routes.
  _mount(view, arg) {
    const app = document.getElementById('app');
    this._current?.destroy?.();
    this._current = view;
    app.innerHTML = view.render(arg);
    initShell();
    view.init(arg);
    window.scrollTo(0, 0);
  },

  _route() {
    cleanupOverlays();

    const raw    = location.hash.replace(/^#/, '') || '/';
    const [path, search = ''] = raw.split('?');
    const params = Object.fromEntries(new URLSearchParams(search));
    const app    = document.getElementById('app');

    if (path === '/') {
      this.go(Auth.isLoggedIn() ? '/dashboard' : '/login');
      return;
    }

    // Auth guard
    if (path !== '/login' && !Auth.isLoggedIn()) { this.go('/login'); return; }
    if (path === '/login' && Auth.isLoggedIn())  { this.go('/dashboard'); return; }

    if (path === '/login')        { this._current?.destroy?.(); this._current = LoginView;
                                    app.innerHTML = LoginView.render(); LoginView.init(); return; }
    if (path === '/dashboard')    return this._mount(DashboardView);
    if (path === '/products')     return this._mount(ProductsListView);
    if (path === '/products/new') return this._mount(ProductFormView, null);
    if (path === '/orders')       return this._mount(OrdersListView, params);
    if (path === '/subscribers')  return this._mount(SubscribersView);
    if (path === '/newsletter')   return this._mount(NewsletterView);
    if (path === '/settings')     return this._mount(SettingsView);

    const editMatch = path.match(/^\/products\/([^/]+)\/edit$/);
    if (editMatch) return this._mount(ProductFormView, editMatch[1]);

    const orderMatch = path.match(/^\/orders\/([^/]+)$/);
    if (orderMatch) return this._mount(OrderDetailView, orderMatch[1]);

    this._current?.destroy?.();
    this._current = null;
    app.innerHTML = `
      ${renderNavbar()}
      <div class="text-center py-5">
        <div style="font-size:3rem;margin-bottom:1rem">★</div>
        <h3 style="color:var(--text-muted)">404 — Page not found</h3>
        <a href="#/dashboard" class="btn btn-primary mt-3">Go to Dashboard</a>
      </div>`;
    initShell();
  },
};

// ═══════════════════════════════════════════════════════════════
// Boot
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  const app = document.getElementById('app');

  try {
    await Config.load();
  } catch (err) {
    app.innerHTML = `
      <div class="min-vh-100 d-flex align-items-center justify-content-center">
        <div class="alert alert-danger text-center p-4" style="max-width:420px">
          <i class="bi bi-exclamation-triangle-fill fs-2 d-block mb-3"></i>
          <h5 class="fw-bold">Configuration Error</h5>
          <p class="mb-1">${escHtml(err.message)}</p>
          <p class="text-secondary small mb-0">
            Set the <code>WORKER_URL</code> environment variable and redeploy.
          </p>
        </div>
      </div>`;
    return;
  }

  Router.init();
});
