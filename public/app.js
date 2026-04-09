/* =============================================================
   Ecommaxxing Admin Dashboard
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
  _key: 'ecommaxxing_admin_token',
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
const Api = {
  async _fetch(path, opts = {}) {
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
    return body.data;
  },

  getProducts(params = {}) {
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
    );
    const qs = new URLSearchParams(clean).toString();
    return this._fetch(`/admin/products${qs ? `?${qs}` : ''}`);
  },

  getProduct(id)       { return this._fetch(`/admin/products/${id}`); },
  createProduct(data)  { return this._fetch('/admin/products', { method: 'POST', body: JSON.stringify(data) }); },
  updateProduct(id, d) { return this._fetch(`/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(d) }); },
  deleteProduct(id)    { return this._fetch(`/admin/products/${id}`, { method: 'DELETE' }); },

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

function currencySymbol(code) {
  return { usd: '$', eur: '€', gbp: '£' }[code] ?? code.toUpperCase();
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

// ── Shared navbar ───────────────────────────────────────────────
function renderNavbar() {
  return `
    <nav class="navbar navbar-expand-lg border-bottom">
      <div class="container-fluid">
        <a class="navbar-brand" href="#/products">
          <i class="bi bi-bag-check-fill text-success me-2"></i>Ecommaxxing
        </a>
        <div class="d-flex align-items-center gap-3">
          <span class="text-secondary small d-none d-sm-inline">Admin Portal</span>
          <button class="btn btn-outline-secondary btn-sm" id="logout-btn">
            <i class="bi bi-box-arrow-right me-1"></i>Logout
          </button>
        </div>
      </div>
    </nav>`;
}

// ═══════════════════════════════════════════════════════════════
// View: Login
// ═══════════════════════════════════════════════════════════════
const LoginView = {
  render() {
    return `
      <div class="min-vh-100 d-flex align-items-center justify-content-center">
        <div class="card login-card">
          <div class="card-body p-4">
            <div class="text-center mb-4">
              <i class="bi bi-bag-check-fill text-success" style="font-size:2.5rem"></i>
              <h4 class="mt-2 fw-bold mb-0">Ecommaxxing Admin</h4>
              <p class="text-secondary small mt-1">Sign in to continue</p>
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
        Router.go('/products');
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
// View: Products List
// ═══════════════════════════════════════════════════════════════
const ProductsListView = {
  _offset:   0,
  _limit:    50,
  _filter:  'all',

  render() {
    return `
      ${renderNavbar()}
      <div class="container-fluid py-4">
        <div class="d-flex justify-content-between align-items-start mb-4 gap-3 flex-wrap">
          <div>
            <h2 class="fw-bold mb-0">Products</h2>
            <p class="text-secondary small mb-0">Manage your product catalog</p>
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
            <table class="table table-dark table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th class="ps-3 text-uppercase text-secondary small">Product</th>
                  <th class="text-uppercase text-secondary small">Price</th>
                  <th class="text-uppercase text-secondary small">Stock</th>
                  <th class="text-uppercase text-secondary small">Status</th>
                  <th class="text-uppercase text-secondary small">Created</th>
                  <th class="pe-3 text-uppercase text-secondary small">Actions</th>
                </tr>
              </thead>
              <tbody id="products-tbody">
                <tr>
                  <td colspan="6" class="text-center py-5">
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
    document.getElementById('logout-btn').addEventListener('click', () => Auth.logout());

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

    await this._load();
  },

  async _load() {
    const tbody = document.getElementById('products-tbody');
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-5">
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
          <td colspan="6" class="text-center py-4 text-danger">
            <i class="bi bi-exclamation-circle me-2"></i>${escHtml(err.message)}
          </td>
        </tr>`;
    }
  },

  _renderRows(products, hidePagination = false) {
    const tbody    = document.getElementById('products-tbody');
    const countEl  = document.getElementById('product-count');
    const pageRow  = document.getElementById('pagination-row');

    pageRow.style.display = hidePagination ? 'none' : '';
    countEl.textContent   = `${products.length} product${products.length !== 1 ? 's' : ''}`;

    if (products.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center py-5 text-secondary">
            <i class="bi bi-inbox fs-2 d-block mb-2 opacity-50"></i>
            No products found
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = products.map(p => {
      const thumb = p.images?.[0]
        ? `<img src="${escHtml(p.images[0])}" width="40" height="40" class="rounded" style="object-fit:cover" onerror="this.replaceWith(placeholder())">`
        : `<span class="d-inline-flex align-items-center justify-content-center rounded bg-secondary bg-opacity-25" style="width:40px;height:40px"><i class="bi bi-image text-secondary"></i></span>`;

      return `
        <tr>
          <td class="ps-3">
            <div class="d-flex align-items-center gap-3">
              ${thumb}
              <div>
                <div class="fw-semibold lh-sm">${escHtml(p.name)}</div>
                <div class="text-secondary font-monospace" style="font-size:0.7rem">${p.id.slice(0, 8)}…</div>
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
  _id:      null,
  _isNew:   false,
  _images:  [], // [{ url, key? }]

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
          <h2 class="fw-bold mb-0" id="form-title">
            ${this._isNew ? 'New Product' : '<span class="text-secondary">Loading…</span>'}
          </h2>
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

          <!-- Metadata card -->
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

    document.getElementById('logout-btn').addEventListener('click', () => Auth.logout());

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

    if (p.metadata && Object.keys(p.metadata).length > 0) {
      document.getElementById('metadata-input').value = JSON.stringify(p.metadata, null, 2);
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

  _clearErrors() {
    document.querySelectorAll('[data-field], #metadata-error').forEach(el => {
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
// Router
// ═══════════════════════════════════════════════════════════════
const Router = {
  go(path) { location.hash = `#${path}`; },

  init() {
    window.addEventListener('hashchange', () => this._route());
    this._route();
  },

  _route() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const app  = document.getElementById('app');

    // Redirect root
    if (hash === '/') {
      this.go(Auth.isLoggedIn() ? '/products' : '/login');
      return;
    }

    // Auth guard
    if (hash !== '/login' && !Auth.isLoggedIn()) { this.go('/login'); return; }
    if (hash === '/login' && Auth.isLoggedIn())  { this.go('/products'); return; }

    if (hash === '/login') {
      app.innerHTML = LoginView.render();
      LoginView.init();
      return;
    }

    if (hash === '/products') {
      app.innerHTML = ProductsListView.render();
      ProductsListView.init();
      return;
    }

    if (hash === '/products/new') {
      app.innerHTML = ProductFormView.render(null);
      ProductFormView.init(null);
      return;
    }

    const editMatch = hash.match(/^\/products\/([^/]+)\/edit$/);
    if (editMatch) {
      app.innerHTML = ProductFormView.render(editMatch[1]);
      ProductFormView.init(editMatch[1]);
      return;
    }

    app.innerHTML = `
      <div class="text-center py-5">
        <h3 class="text-secondary">404 — Page not found</h3>
        <a href="#/products" class="btn btn-primary mt-3">Go to products</a>
      </div>`;
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
            Set the <code>WORKER_URL</code> environment variable to your Cloudflare Worker URL and redeploy.
          </p>
        </div>
      </div>`;
    return;
  }

  Router.init();
});
