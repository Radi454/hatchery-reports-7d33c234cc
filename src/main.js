import './styles.css';
import { supabase, supabaseConfigured, supabaseConfigError } from './supabase.js';
import { uniqueBirdRows, totalBirds, aggregateDashboard, availableMonths, buildAmpouleRates, customerLabel, durationMinutes, estimateAmpoules, filterRows, getReportProducts, isKnownCustomer, latestAvailableYear } from './dashboard-data.js';
import { PRODUCT_TYPE_ORDER, productDisplay } from './product-catalog.js';

const app = document.querySelector('#app');
const state = {
  session: null,
  rows: [],
  ampouleRates: new Map(),
  yearDefaultInitialized: false,
  total: 0,
  dateMin: null,
  dateMax: null,
  refreshedAt: null,
  loading: false,
  loadingUserId: '',
  loadedUserId: '',
  sourceReportCount: 0,
  excludedInvalid: 0,
  error: '',
  authMode: 'password',
  otpEmail: '',
  page: 0,
  pageSize: 25,
  selectedProductId: '',
  selectedCustomerCode: '',
  customerMetric: 'birds',
  search: '',
  filters: { status: ['accepted'], dateFrom: '', dateTo: '', region: 'all', customerCode: '', productIds: [], competitorProductIds: [], yearIds: [], monthIds: [] },
  competitorSearch: '',
};
let requestId = 0;
let sourceRequestId = 0;

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const number = value => new Intl.NumberFormat('en-US').format(Number(value) || 0);
function ampouleSummary(item) {
  const result = estimateAmpoules(item, state.ampouleRates);
  if (result.status === 'exact') return number(result.value);
  if (result.status === 'estimated') {
    const rate = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(result.birdsPerAmpoule);
    const title = `تقدير من ${number(result.sampleReports)} تقرير معتمد · ${rate} طائر لكل أمبولة`;
    return `<span title="${title}" aria-label="${title}">≈ ${number(result.value)} (تقديري)</span><small class="ampoule-recorded">المسجل: ${number(result.recorded)} أمبولة</small>`;
  }
  return result.status === 'recorded' ? `المسجل فقط: ${number(result.recorded)}` : 'غير مسجل';
}
const birds = value => `${number(value)} طائر`;
const dateLabel = value => value ? new Intl.DateTimeFormat('ar-EG', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)) : '—';
const monthLabel = value => value ? new Intl.DateTimeFormat('ar-EG', { year: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}-01T00:00:00Z`)) : '—';
const customerIdentity = row => row.customer_code || `unassigned:${row.id}`;
const monthKey = date => date ? String(date).slice(0, 7) : '';

function renderShell() {
  app.innerHTML = `
    <header class="topbar"><div class="brand" aria-label="Hatchery Insights"><span class="brand-copy">Hatchery Insights<small>تقارير التحصين</small></span></div><div id="session-tools"></div></header>
    <main id="main-content" class="container"></main>
    <footer class="footer"><span>تقارير معامل التفريخ</span></footer>
    <dialog id="batch-dialog" class="dialog"><div id="dialog-content"></div></dialog>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>`;
}

function renderLogin() {
  document.querySelector('#session-tools').innerHTML = '';
  document.querySelector('#main-content').classList.add('login-main');
  document.querySelector('#main-content').innerHTML = `
    <section class="login-page" aria-label="تسجيل الدخول">
      <div class="login-visual"><img src="${import.meta.env.BASE_URL}assets/chicks.jpg" alt="كتاكيت"><div class="login-visual-copy"><span>Hatchery Insights</span><h2>تقارير التحصين</h2></div></div>
      <div class="login-side"><form id="login-form" class="login-card">
      <h1>تسجيل الدخول</h1>
      ${!supabaseConfigured ? `<div class="alert error">${escapeHtml(supabaseConfigError ? 'إعداد مفتاح الخدمة غير صالح.' : 'تعذر الاتصال بالخدمة.')}</div>` : ''}
      ${state.error ? `<div class="alert error" role="alert">${escapeHtml(state.error)}</div>` : ''}
      <label>البريد الإلكتروني<input name="email" type="email" autocomplete="username" value="${escapeHtml(state.otpEmail)}" required ${!supabaseConfigured || state.loading ? 'disabled' : ''}></label>
      ${state.authMode === 'password' ? `<label>كلمة المرور<input name="password" type="password" autocomplete="current-password" required ${state.loading ? 'disabled' : ''}></label>` : state.authMode === 'code' ? `<label>رمز البريد الإلكتروني<input name="token" inputmode="numeric" autocomplete="one-time-code" required ${state.loading ? 'disabled' : ''}></label><p class="muted">أدخل الرمز أو افتح رابط الدخول في بريدك.</p>` : '<p class="muted">أرسل رابط الدخول إلى بريدك.</p>'}
      <button class="button primary full" type="submit" ${!supabaseConfigured || state.loading ? 'disabled' : ''}>${state.loading ? 'جارٍ التحقق…' : state.authMode === 'password' ? 'تسجيل الدخول' : state.authMode === 'code' ? 'التحقق من الرمز' : 'إرسال رابط الدخول'}</button>
      ${state.authMode === 'password' ? '<button id="otp-mode" class="button quiet full" type="button">الدخول عبر البريد</button>' : state.authMode === 'otp-email' ? '<button id="code-entry" class="button quiet full" type="button">لدي رمز دخول</button>' : '<button id="resend-otp" class="button quiet full" type="button">إرسال رمز جديد</button>'}
      ${state.authMode !== 'password' ? '<button id="password-mode" class="button quiet full" type="button">الدخول بكلمة المرور</button>' : ''}
      <p class="fineprint">للحسابات المصرح بها فقط.</p>
      </form></div>
    </section>`;
  document.querySelector('#login-form')?.addEventListener('submit', signIn);
  document.querySelector('#otp-mode')?.addEventListener('click', () => { state.otpEmail = document.querySelector('[name="email"]')?.value || ''; state.authMode = 'otp-email'; state.error = ''; renderLogin(); });
  document.querySelector('#code-entry')?.addEventListener('click', () => { state.otpEmail = document.querySelector('[name="email"]')?.value || ''; state.authMode = 'code'; state.error = ''; renderLogin(); });
  document.querySelector('#password-mode')?.addEventListener('click', () => { state.authMode = 'password'; state.error = ''; renderLogin(); });
  document.querySelector('#resend-otp')?.addEventListener('click', () => sendOtp(state.otpEmail));
}

async function signIn(event) {
  event.preventDefault();
  if (!supabase) return;
  const form = new FormData(event.currentTarget);
  const email = String(form.get('email') || '').trim();
  state.otpEmail = email;
  if (state.authMode === 'otp-email') return sendOtp(email);
  state.loading = true;
  state.error = '';
  renderLogin();
  try {
    const result = state.authMode === 'code'
      ? await supabase.auth.verifyOtp({ email, token: String(form.get('token') || '').trim(), type: 'email' })
      : await supabase.auth.signInWithPassword({ email, password: form.get('password') });
    state.loading = false;
    if (result.error) {
      state.error = 'تعذر تسجيل الدخول. تحقق من البريد وكلمة المرور أو الرمز.';
      renderLogin();
      return;
    }
    state.session = result.data.session;
    state.authMode = 'password';
    await loadDashboard();
  } catch {
    state.loading = false;
    state.error = 'تعذر الاتصال. أعد المحاولة.';
    renderLogin();
  }
}

async function sendOtp(email) {
  if (!supabase || !email) {
    state.error = 'أدخل البريد الإلكتروني.';
    renderLogin();
    return;
  }
  state.loading = true;
  state.error = '';
  renderLogin();
  try {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).href } });
    state.loading = false;
    if (error) {
      state.error = 'تعذر إرسال رابط الدخول. تحقق من البريد.';
      renderLogin();
      return;
    }
    state.authMode = 'code';
    renderLogin();
    document.querySelector('[name="token"]')?.focus();
  } catch {
    state.loading = false;
    state.error = 'تعذر إرسال رابط الدخول. أعد المحاولة.';
    renderLogin();
  }
}

function sessionBar() {
  const email = state.session?.user?.email || '';
  document.querySelector('#session-tools').innerHTML = `<div class="session-actions"><span class="session-email">${escapeHtml(email)}</span><button id="logout" class="button quiet">تسجيل الخروج</button></div>`;
  document.querySelector('#logout').addEventListener('click', signOut);
}

async function signOut() {
  const current = supabase;
  requestId += 1;
  sourceRequestId += 1;
  const dialog = document.querySelector('#batch-dialog');
  if (dialog?.open) dialog.close();
  const dialogContent = document.querySelector('#dialog-content');
  if (dialogContent) dialogContent.replaceChildren();
  state.rows = [];
  state.ampouleRates = new Map();
  state.yearDefaultInitialized = false;
  state.total = 0;
  state.dateMin = null;
  state.dateMax = null;
  state.refreshedAt = null;
  state.sourceReportCount = 0;
  state.excludedInvalid = 0;
  state.loading = false;
  state.loadingUserId = '';
  state.loadedUserId = '';
  state.session = null;
  state.error = '';
  state.authMode = 'password';
  state.otpEmail = '';
  state.page = 0;
  state.search = '';
  state.customerMetric = 'birds';
  state.filters = { status: ['accepted'], dateFrom: '', dateTo: '', region: 'all', customerCode: '', productIds: [], competitorProductIds: [], yearIds: [], monthIds: [] };
  state.competitorSearch = '';
  state.selectedProductId = '';
  state.selectedCustomerCode = '';
  renderLogin();
  if (current) await current.auth.signOut({ scope: 'local' });
}

async function loadDashboard() {
  if (!supabase || !state.session) return;
  const userId = state.session.user.id;
  if (state.loading && state.loadingUserId === userId) return;
  if (!state.loading && state.loadedUserId === userId) return;
  const id = ++requestId;
  state.loading = true;
  state.loadingUserId = userId;
  state.error = '';
  sessionBar();
  renderLoading();
  const batchSize = 1000;
  let offset = 0;
  let expectedTotal = null;
  let allRows = [];
  let metadata = null;
  try {
    while (expectedTotal === null || offset < expectedTotal) {
      if (id !== requestId || !state.session) return;
      const { data, error } = await supabase.rpc('hatchery_dashboard_data', { p_offset: offset, p_limit: batchSize });
      if (error) throw error;
      if (!data || !Array.isArray(data.rows) || !Number.isInteger(data.total)) throw new Error('Unexpected dashboard response.');
      if (expectedTotal !== null && expectedTotal !== data.total) throw new Error('Data changed during loading; retry.');
      expectedTotal = data.total;
      metadata = data;
      allRows = allRows.concat(data.rows);
      if (data.rows.length === 0 || data.rows.length < batchSize) {
        if (allRows.length < expectedTotal) throw new Error('Dashboard pagination ended before all rows loaded.');
        break;
      }
      offset += data.rows.length;
    }
    if (id !== requestId || !state.session) return;
    if (allRows.length !== expectedTotal || new Set(allRows.map(row => row.id)).size !== expectedTotal) throw new Error('Incomplete or duplicate report pages.');
    state.rows = allRows.map(row => ({ ...row, products: (row.products || []).map(productDisplay) }));
    state.ampouleRates = buildAmpouleRates(state.rows);
    if (!state.yearDefaultInitialized) {
      const latestYear = latestAvailableYear(state.rows);
      state.filters.yearIds = latestYear ? [latestYear] : [];
      state.yearDefaultInitialized = true;
    }
    state.total = expectedTotal ?? 0;
    state.dateMin = metadata?.date_min ?? null;
    state.dateMax = metadata?.date_max ?? null;
    state.refreshedAt = metadata?.refreshed_at ?? null;
    state.sourceReportCount = metadata?.source_report_count ?? expectedTotal ?? 0;
    state.excludedInvalid = metadata?.excluded_invalid ?? 0;
    state.loading = false;
    state.loadingUserId = '';
    state.loadedUserId = userId;
    state.page = 0;
    renderDashboard();
  } catch (error) {
    if (id !== requestId || !state.session) return;
    console.error('Dashboard data load failed', error);
    state.rows = [];
    state.total = 0;
    state.loading = false;
    state.loadingUserId = '';
    state.loadedUserId = '';
    state.error = error?.code === '42501' || error?.status === 403
      ? 'لا يملك الحساب صلاحية عرض البيانات.'
      : 'تعذر تحميل البيانات. أعد المحاولة.';
    renderDashboard();
  }
}

function renderLoading() {
  document.querySelector('#main-content').classList.remove('login-main');
  document.querySelector('#main-content').innerHTML = '<section class="panel loading-card"><div class="spinner" aria-hidden="true"></div><p>جارٍ التحميل…</p></section>';
}

function currentRows() {
  const filters = { ...state.filters, status: [...state.filters.status] };
  return filterRows(state.rows, filters);
}

function pruneMonths() {
  const available = new Set(availableMonths(state.rows, state.filters.yearIds));
  state.filters.monthIds = state.filters.monthIds.filter(month => available.has(month));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(value => value != null && value !== ''))].sort((a, b) => String(a).localeCompare(String(b), 'ar'));
}

function filterOptions(rows) {
  const regions = uniqueSorted(rows.map(row => row.region));
  const customerRows = new Map();
  for (const row of rows) {
    if (!isKnownCustomer(row)) continue;
    const key = customerIdentity(row);
    if (!customerRows.has(key)) customerRows.set(key, row);
  }
  const products = new Map();
  const ownProducts = new Map();
  const competitorProducts = new Map();
  rows.forEach(row => (row.products || []).forEach(product => {
    if (!product.id || !product.name) return;
    products.set(product.id, product.name);
    (product.is_competitor ? competitorProducts : ownProducts).set(product.id, { id: product.id, name: product.name, type: product.type || 'Other' });
  }));
  const sortProducts = map => [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return {
    regions,
    customers: [...customerRows.entries()].sort((a, b) => customerLabel(a[1]).localeCompare(customerLabel(b[1]), 'ar')),
    products: [...products.entries()].sort((a, b) => a[1].localeCompare(b[1], 'en')),
    ownProducts: sortProducts(ownProducts),
    competitorProducts: sortProducts(competitorProducts),
  };
}

function renderDashboard() {
  document.querySelector('#main-content').classList.remove('login-main');
  sessionBar();
  const rows = currentRows();
  const stats = aggregateDashboard(rows);
  const options = filterOptions(state.rows);
  const regionValue = state.filters.region;
  const productDetailItems = options.products.map(([id, name]) => `<option value="${escapeHtml(id)}" ${state.selectedProductId === id ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('');
  const regionItems = options.regions.map(region => `<option value="${escapeHtml(region)}" ${regionValue === region ? 'selected' : ''}>${escapeHtml(region)}</option>`).join('');
  const customerItems = options.customers.map(([code, row]) => `<option value="${escapeHtml(code)}" ${state.filters.customerCode === code ? 'selected' : ''}>${escapeHtml(customerLabel(row))}</option>`).join('');
  const years = uniqueSorted(state.rows.map(row => String(row.date || '').slice(0, 4)).filter(year => /^\d{4}$/.test(year))).sort((a, b) => b.localeCompare(a));
  const yearSlicer = renderYearSlicer(years);
  const monthSlicer = renderMonthSlicer(availableMonths(state.rows, state.filters.yearIds));
  const productSlicers = renderProductSlicer('productIds', 'منتجاتنا', options.ownProducts);
  const filteredCompetitors = options.competitorProducts.filter(product => product.name.toLocaleLowerCase().includes(state.competitorSearch.toLocaleLowerCase()));
  const competitorProductSlicers = renderProductSlicer('competitorProductIds', 'منتجات المنافسين', filteredCompetitors, true);
  const statusNames = { accepted: 'معتمد', needs_review: 'بحاجة للمراجعة', rejected: 'مستبعد' };
  const knownStatuses = uniqueSorted(state.rows.map(row => row.status));
  const pendingReviewCount = state.rows.filter(row => row.status === 'needs_review').length;
  document.querySelector('#main-content').innerHTML = `
    <div class="page-heading"><div><h1>تقارير التحصين</h1></div><button id="export-csv" class="button outline">تصدير CSV</button></div>
    <section class="filters panel" aria-label="الفلاتر"><div class="filter-title"><div><h2>الفلاتر</h2></div><button id="clear-filters" class="button quiet">مسح الفلاتر</button></div><div class="filter-grid">
      <label>من تاريخ<input id="date-from" type="date" value="${escapeHtml(state.filters.dateFrom)}"></label><label>إلى تاريخ<input id="date-to" type="date" value="${escapeHtml(state.filters.dateTo)}"></label>
      <label>المنطقة التشغيلية<select id="region-filter"><option value="all">كل المناطق</option><option value="__unassigned__" ${regionValue === '__unassigned__' ? 'selected' : ''}>غير محددة</option>${regionItems}</select></label>
      <label>العميل / الكود<select id="customer-filter"><option value="">كل العملاء</option>${customerItems}</select></label>
      <div class="slicer-filters">${yearSlicer}${monthSlicer}${productSlicers}${competitorProductSlicers}</div>
      <fieldset class="status-filter"><legend>حالة التقرير</legend>${knownStatuses.map(status => `<label class="check-label"><input type="checkbox" name="status" value="${escapeHtml(status)}" ${state.filters.status.includes(status) ? 'checked' : ''}> ${escapeHtml(statusNames[status] || status)}</label>`).join('')}</fieldset>
    </div></section>
    ${state.error ? `<div class="alert error" role="alert">${escapeHtml(state.error)} <button id="retry" class="button quiet">إعادة المحاولة</button></div>` : ''}
    <div class="coverage-line"><span>${number(rows.length)} من ${number(state.total)} تقرير</span><span>للمراجعة: ${number(pendingReviewCount)}</span><span>إجمالي المصدر: ${number(state.sourceReportCount ?? state.total)} · دون عدد طيور: ${number(state.excludedInvalid ?? 0)}</span><span>الفترة: ${dateLabel(state.dateMin)} – ${dateLabel(state.dateMax)}</span><span>آخر تحديث: ${state.refreshedAt ? new Date(state.refreshedAt).toLocaleString('ar-EG') : '—'}</span></div>
    <section class="metrics-grid" aria-label="المؤشرات"><article class="metric-card"><span>الطيور</span><strong>${number(stats.birds)}</strong><small>مرة لكل دفعة فعلية</small></article><article class="metric-card"><span>التقارير</span><strong>${number(stats.batches)}</strong></article><article class="metric-card"><span>العملاء</span><strong>${number(stats.customers)}</strong></article><article class="metric-card"><span>المنتجات</span><strong>${number(stats.productById.size)}</strong></article></section>
    <section class="panel products-panel"><div class="section-heading"><div><h2>المنتجات</h2></div><label class="inline-select">المنتج<select id="product-detail"><option value="">اختر منتجًا</option>${productDetailItems}</select></label></div><div class="overlap-note"><b>تداخل المنتجات:</b> قد تضم الدفعة عدة منتجات؛ لا تُجمع أعداد الطيور بينها. قد تتوزع تقارير الدفعة نفسها بين مناطق؛ إجمالي الطيور يحسب الدفعة مرة واحدة، وأرقام المناطق قد تتداخل. تظهر منتجات المنافسين بالاسم فقط.</div><div class="products-grid"><div class="table-scroll"><table><thead><tr><th>المنتج</th><th>طيور مغطاة</th><th>تقارير</th><th>عملاء</th><th>أمبولات</th></tr></thead><tbody>${renderProductRows(stats.productById)}</tbody></table></div><div id="product-detail-panel" class="product-detail"><div class="empty-state">اختر منتجًا للتفاصيل.</div></div></div></section>
    <section class="charts-grid"><article class="panel"><div class="section-heading"><div><h2>الطيور حسب الشهر</h2></div></div><div id="overall-chart">${renderBirdChart(rows, 'overall')}</div></article><article class="panel"><h2>التقارير حسب المنطقة</h2><div id="region-bars">${renderRegionBars(stats.regionByName)}</div></article></section>
    <section class="panel customer-panel"><div class="section-heading"><div><h2>العملاء</h2></div><div class="customer-search"><label for="customer-search">بحث</label><input id="customer-search" type="search" value="${escapeHtml(state.search)}" placeholder="اسم أو كود العميل"></div></div><div class="customer-layout"><aside id="customer-list" class="customer-list"></aside><div id="customer-profile" class="customer-profile"><div class="empty-state">اختر عميلًا.</div></div></div></section>
    <section class="panel reports-panel"><div class="section-heading"><div><h2>التقارير الأخيرة</h2></div><div class="pagination"><button id="previous-page" class="button quiet" ${state.page === 0 ? 'disabled' : ''}>السابق</button><span>${state.page + 1} / ${Math.max(1, Math.ceil(rows.length / state.pageSize))}</span><button id="next-page" class="button quiet" ${(state.page + 1) * state.pageSize >= rows.length ? 'disabled' : ''}>التالي</button></div></div><div class="table-scroll"><table><thead><tr><th>التقرير</th><th>التاريخ</th><th>العميل / المنطقة</th><th>المفرخ</th><th>الطيور</th><th>المنتجات المسجلة</th><th>الحالة</th><th>تفاصيل</th></tr></thead><tbody>${renderReportRows(rows)}</tbody></table></div></section>`;
  bindDashboardEvents();
  renderCustomerAnalysis(rows);
  renderProductDetail(rows);
}

function renderProductRows(products) {
  const sorted = [...products.values()].sort((a, b) => b.birds - a.birds || a.name.localeCompare(b.name, 'ar'));
  if (!sorted.length) return '<tr><td colspan="5" class="empty-row">لا توجد منتجات.</td></tr>';
  return sorted.map(product => `<tr><td><button class="text-action product-choice" data-product-id="${escapeHtml(product.id)}">${escapeHtml(product.name)}</button>${product.isCompetitor ? '<span class="small-tag">منافس</span>' : ''}</td><td>${number(product.birds)}</td><td>${number(product.batches)}</td><td>${number(product.customers.size)}</td><td>${product.isCompetitor ? '—' : ampouleSummary(product)}</td></tr>`).join('');
}

function renderProductSlicer(filterKey, label, products, searchable = false) {
  const selected = new Set(state.filters[filterKey]);
  const search = searchable ? `<label class="slicer-search"><input id="competitor-product-search" type="search" aria-label="بحث منتجات المنافسين" value="${escapeHtml(state.competitorSearch)}" placeholder="بحث المنتجات"></label>` : '';
  const grouped = new Map();
  products.forEach(product => {
    const type = PRODUCT_TYPE_ORDER.includes(product.type) ? product.type : 'Other';
    if (!grouped.has(type)) grouped.set(type, []);
    grouped.get(type).push(product);
  });
  const options = PRODUCT_TYPE_ORDER.filter(type => grouped.has(type)).map(type => `<div class="slicer-category"><h4>${escapeHtml(type)}</h4><div class="slicer-options">${grouped.get(type).map(product => `<button type="button" class="slicer-chip" data-slicer="${filterKey}" data-product-id="${escapeHtml(product.id)}" aria-pressed="${selected.has(product.id)}">${escapeHtml(product.name)}</button>`).join('')}</div></div>`).join('');
  return `<section class="slicer-group product-slicer"><div class="slicer-heading"><h3>${label}</h3><button type="button" class="button quiet" data-clear-slicer="${filterKey}">مسح الفلتر</button></div>${search}<div class="group-options" role="group" aria-label="${label}">${options || '<span class="slicer-empty">لا توجد منتجات</span>'}</div></section>`;
}

function renderYearSlicer(years) {
  const selected = new Set(state.filters.yearIds);
  const options = years.map(year => `<button type="button" class="slicer-chip" data-year-slicer="${year}" aria-pressed="${selected.has(year)}">${year}</button>`).join('');
  return `<section class="slicer-group year-slicer"><div class="slicer-heading"><h3>السنة</h3><button type="button" class="button quiet" id="clear-years">مسح الفلتر</button></div><div class="slicer-options" role="group" aria-label="السنة">${options || '<span class="slicer-empty">لا توجد سنوات</span>'}</div></section>`;
}

function renderMonthSlicer(months) {
  const labels = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const selected = new Set(state.filters.monthIds);
  const options = months.map(month => `<button type="button" class="slicer-chip" data-month-slicer="${month}" aria-pressed="${selected.has(month)}">${labels[Number(month) - 1]}</button>`).join('');
  return `<section class="slicer-group period-slicer"><div class="slicer-heading"><h3>الشهر</h3><button type="button" class="button quiet" id="clear-months">مسح الفلتر</button></div><div class="slicer-options" role="group" aria-label="الشهر">${options || '<span class="slicer-empty">لا توجد أشهر</span>'}</div></section>`;
}

function renderRegionBars(regions) {
  const data = [...regions.values()].sort((a, b) => b.batches - a.batches);
  if (!data.length) return '<div class="empty-state">لا توجد بيانات.</div>';
  const max = Math.max(...data.map(region => region.batches), 1);
  return data.map(region => `<div class="region-row"><span>${escapeHtml(region.name || 'منطقة غير محددة')}</span><div class="bar"><i style="width:${Math.max(4, region.batches / max * 100)}%"></i></div><b>${number(region.batches)} تقرير</b><small>${number(region.birds)} طائر</small></div>`).join('');
}

function renderBirdChart(rows, suffix = '') {
  if (!rows.length) return '<div class="empty-state">لا توجد بيانات.</div>';
  const monthly = new Map();
  for (const row of uniqueBirdRows(rows)) {
    const key = monthKey(row.date);
    if (!key) continue;
    monthly.set(key, (monthly.get(key) || 0) + (Number(row.bird_count) || 0));
  }
  const points = [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (!points.length) return '<div class="empty-state">لا توجد تواريخ.</div>';
  const max = Math.max(...points.map(([, value]) => value), 1);
  const tickEvery = Math.max(1, Math.ceil(points.length / 8));
  const coords = points.map(([, value], index) => [75 + index * (590 / Math.max(points.length - 1, 1)), 190 - value / max * 145]);
  const path = coords.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ');
  return `<svg class="chart" viewBox="0 0 700 245" role="img" aria-label="اتجاه الطيور حسب الشهر"><g class="grid-lines"><path d="M70 45H685M70 90H685M70 135H685M70 190H685"/></g><g class="axis-labels" direction="ltr" text-anchor="end"><text x="64" y="190">0</text><text x="64" y="135">${number(max * .33)}</text><text x="64" y="90">${number(max * .66)}</text><text x="64" y="45">${number(max)}</text>${points.map(([month], index) => index % tickEvery === 0 || index === points.length - 1 ? `<text x="${coords[index][0]}" y="222" text-anchor="middle">${escapeHtml(monthLabel(month))}</text>` : '').join('')}</g><path d="${path}" class="chart-line"/>${coords.map(([x, y], index) => `<circle cx="${x}" cy="${y}" r="4" class="chart-dot"><title>${escapeHtml(monthLabel(points[index][0]))}: ${number(points[index][1])} طائر</title></circle>`).join('')}</svg>`;
}

function renderProductDetail(rows) {
  const panel = document.querySelector('#product-detail-panel');
  const selected = state.selectedProductId || document.querySelector('#product-detail')?.value;
  if (!selected || !panel) return;
  const associated = rows.filter(row => row.products?.some(product => product.id === selected));
  const product = associated.flatMap(row => row.products).find(item => item.id === selected);
  if (!associated.length || !product) {
    panel.innerHTML = '<div class="empty-state">لا توجد تقارير لهذا المنتج.</div>';
    return;
  }
  if (product.is_competitor) {
    panel.innerHTML = `<div class="detail-title"><div><span class="eyebrow">منافس</span><h3>${escapeHtml(product.name)}</h3></div><button class="button quiet" id="clear-product-detail">مسح</button></div>`;
    document.querySelector('#clear-product-detail')?.addEventListener('click', () => { state.selectedProductId = ''; renderDashboard(); });
    return;
  }

  const uniqueProductRows = associated.map(row => ({ ...row, bird_count: Number(row.bird_count) || 0 }));
  const productBirds = totalBirds(uniqueProductRows);
  const customers = new Map();
  const regions = new Map();
  associated.forEach(row => {
    if (isKnownCustomer(row)) {
      const key = customerIdentity(row);
      const entry = customers.get(key) || { label: customerLabel(row), birds: 0, batches: 0, applicationRows: [] };
      entry.applicationRows.push(row);
      entry.batches += 1;
      customers.set(key, entry);
    }
    const regionKey = row.region || '__unassigned__';
    const region = regions.get(regionKey) || { label: row.region || 'منطقة غير محددة', birds: 0, batches: 0, applicationRows: [] };
    region.applicationRows.push(row);
    region.batches += 1;
    regions.set(regionKey, region);
  });
  for (const group of [...customers.values(), ...regions.values()]) group.birds = totalBirds(group.applicationRows);
  const topCustomers = [...customers.values()].sort((a, b) => b.birds - a.birds).slice(0, 5);
  const regionRows = [...regions.values()].sort((a, b) => b.birds - a.birds);
  panel.innerHTML = `<div class="detail-title"><div><h3>${escapeHtml(product.name)}</h3></div><button class="button quiet" id="clear-product-detail">مسح</button></div><div class="detail-kpis"><div><small>الطيور</small><b>${number(productBirds)}</b></div><div><small>التقارير</small><b>${number(associated.length)}</b></div><div><small>العملاء</small><b>${number(customers.size)}</b></div></div><div class="detail-columns"><div><h4>الطيور حسب الشهر</h4>${renderBirdChart(uniqueProductRows, 'product')}</div><div><h4>العملاء والمناطق</h4><div class="mini-list">${topCustomers.map(row => `<div><span>${escapeHtml(row.label)}</span><b>${number(row.birds)} طائر · ${row.batches} تقارير</b></div>`).join('') || '<p>لا يوجد عملاء.</p>'}</div><div class="mini-list region-list">${regionRows.map(row => `<div><span>${escapeHtml(row.label)}</span><b>${number(row.birds)} طائر · ${row.batches}</b></div>`).join('')}</div></div></div>`;
  document.querySelector('#clear-product-detail')?.addEventListener('click', () => { state.selectedProductId = ''; renderDashboard(); });
}

function renderCustomerAnalysis(rows) {
  const list = document.querySelector('#customer-list');
  const profile = document.querySelector('#customer-profile');
  if (!list || !profile) return;
  const grouped = new Map();
  rows.forEach(row => {
    if (!isKnownCustomer(row)) return;
    const key = customerIdentity(row);
    const current = grouped.get(key) || { code: key, name: row.customer || 'عميل غير محدد', rows: [], regions: new Set() };
    current.rows.push(row);
    if (row.region) current.regions.add(row.region);
    grouped.set(key, current);
  });
  const entries = [...grouped.values()].map(entry => ({ ...entry, birds: totalBirds(entry.rows), latest: entry.rows.reduce((latest, row) => !latest || row.date > latest ? row.date : latest, null) })).sort((a, b) => b.birds - a.birds);
  const searched = entries.filter(entry => `${entry.name} ${entry.code} ${[...entry.regions].join(' ')}`.toLocaleLowerCase().includes(state.search.toLocaleLowerCase()));
  if (!searched.some(entry => entry.code === state.selectedCustomerCode)) state.selectedCustomerCode = searched[0]?.code || '';
  list.innerHTML = searched.length ? searched.map(entry => `<button class="customer-result ${entry.code === state.selectedCustomerCode ? 'active' : ''}" data-customer-code="${escapeHtml(entry.code)}"><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml([...entry.regions].join('، ') || 'منطقة غير محددة')}</small><span>${number(entry.birds)} طائر · ${entry.rows.length} تقرير</span></button>`).join('') : '<div class="empty-state">لا توجد نتائج.</div>';
  list.querySelectorAll('[data-customer-code]').forEach(button => button.addEventListener('click', () => { state.selectedCustomerCode = button.dataset.customerCode; renderCustomerAnalysis(rows); }));
  const selected = entries.find(entry => entry.code === state.selectedCustomerCode);
  if (!selected) {
    profile.innerHTML = '<div class="empty-state">لا توجد بيانات.</div>';
    return;
  }
  const customerRows = [...selected.rows].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.id).localeCompare(String(b.id)));
  const latestDate = customerRows[customerRows.length - 1]?.date;
  const activeMonths = new Set(customerRows.map(row => monthKey(row.date)).filter(Boolean)).size;
  const customerStats = aggregateDashboard(customerRows);
  const competitorNames = customerStats.competitorNames;
  const products = [...customerStats.productById.values()].map(product => ({ ...product, reports: product.batches })).sort((a,b) => b.birds-a.birds);
  const monthValues = new Map();
  customerRows.forEach(row => {
    const key = monthKey(row.date);
    if (!key) return;
    const item = monthValues.get(key) || { birds: 0, batches: 0, applicationRows: [] };
    item.applicationRows.push(row);
    item.batches += 1;
    monthValues.set(key, item);
  });
  for (const group of monthValues.values()) group.birds = totalBirds(group.applicationRows);
  profile.innerHTML = `<div class="profile-head"><div><h3>${escapeHtml(selected.name)}</h3><p>الكود: ${escapeHtml(selected.code)} · ${escapeHtml([...selected.regions].join('، ') || 'منطقة غير محددة')}</p></div><div class="segmented" role="group" aria-label="المقياس الشهري"><button data-customer-metric="birds" aria-pressed="${state.customerMetric === 'birds'}">الطيور</button><button data-customer-metric="batches" aria-pressed="${state.customerMetric === 'batches'}">التقارير</button></div></div><div class="customer-kpis"><div><small>الطيور</small><b>${number(selected.birds)}</b></div><div><small>التقارير</small><b>${number(customerRows.length)}</b></div><div><small>آخر تقرير</small><b>${dateLabel(latestDate)}</b></div><div><small>أشهر النشاط</small><b>${number(activeMonths)}</b></div></div><div class="customer-month-chart"><div class="section-heading"><h4>النشاط الشهري</h4><span>${state.customerMetric === 'birds' ? 'طيور' : 'تقارير'}</span></div>${renderCustomerChart(monthValues, state.customerMetric)}</div><div class="customer-detail-grid"><div><h4>المنتجات</h4><div class="table-scroll"><table><thead><tr><th>المنتج</th><th>طيور المنتج</th><th>تقارير</th><th>أمبولات</th></tr></thead><tbody>${products.map(product => `<tr><td>${escapeHtml(product.name)}</td><td>${number(product.birds)}</td><td>${number(product.reports)}</td><td>${ampouleSummary(product)}</td></tr>`).join('') || '<tr><td colspan="4">لا توجد منتجات.</td></tr>'}</tbody></table></div>${competitorNames.size ? `<p class="muted">منتجات منافسة: ${[...competitorNames].map(escapeHtml).join('، ')}.</p>` : ''}</div><div><h4>الدفعات</h4><div class="table-scroll"><table><thead><tr><th>التاريخ</th><th>الطيور</th><th>التفاصيل</th></tr></thead><tbody>${[...customerRows].reverse().map(row => `<tr><td>${dateLabel(row.date)}</td><td>${number(row.bird_count)}</td><td><details><summary>التفاصيل</summary><div class="batch-expansion"><p>المرجع: ${escapeHtml(row.reference || row.printed_report_number || '—')}</p><p>المفرخ: ${escapeHtml(row.hatchery || '—')}</p><p>المنتجات: ${(row.products || []).map(product => escapeHtml(product.name) + (product.is_competitor ? '' : ` · ${product.ampoule_count == null ? 'الكمية غير مسجلة' : `${number(product.ampoule_count)} أمبولة`}${product.batch_lot ? ` · ${escapeHtml(product.batch_lot)}` : ''}`)).join('، ') || '—'}</p><p>الوقت: ${escapeHtml(row.start_time || '—')} – ${escapeHtml(row.end_time || '—')}</p></div></details></td></tr>`).join('')}</tbody></table></div></div></div>`;
  profile.querySelectorAll('[data-customer-metric]').forEach(button => button.addEventListener('click', () => { state.customerMetric = button.dataset.customerMetric; renderCustomerAnalysis(rows); }));
}

function renderCustomerChart(monthValues, metric) {
  const keys = [...monthValues.keys()].sort();
  if (!keys.length) return '<div class="empty-state">لا توجد تواريخ.</div>';
  const values = keys.map(key => monthValues.get(key)[metric]);
  const max = Math.max(...values, 1);
  const coords = values.map((value, index) => [70 + index * (600 / Math.max(values.length - 1, 1)), 140 - value / max * 100]);
  const path = coords.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ');
  return `<svg class="chart customer-chart" viewBox="0 0 700 180" role="img" aria-label="${metric === 'birds' ? 'طيور' : 'تقارير'} العميل حسب الشهر"><g class="grid-lines"><path d="M65 40H685M65 90H685M65 140H685"/></g><g class="axis-labels" direction="ltr" text-anchor="end"><text x="58" y="140">0</text><text x="58" y="90">${Math.round(max / 2)}</text><text x="58" y="40">${max}</text>${keys.map((key, index) => index % Math.max(1, Math.ceil(keys.length / 8)) === 0 || index === keys.length - 1 ? `<text x="${coords[index][0]}" y="166" text-anchor="middle">${escapeHtml(monthLabel(key))}</text>` : '').join('')}</g><path d="${path}" class="chart-line"/>${coords.map(([x, y], index) => `<circle cx="${x}" cy="${y}" r="4" class="chart-dot"><title>${escapeHtml(monthLabel(keys[index]))}: ${number(values[index])} ${metric === 'birds' ? 'طائر' : 'تقارير'}</title></circle>`).join('')}</svg>`;
}

function renderReportRows(rows) {
  const pageRows = [...rows].sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id).localeCompare(String(a.id))).slice(state.page * state.pageSize, (state.page + 1) * state.pageSize);
  if (!pageRows.length) return '<tr><td colspan="8" class="empty-row">لا توجد تقارير.</td></tr>';
  const statusLabels = { accepted: 'معتمد', needs_review: 'بحاجة للمراجعة', rejected: 'مستبعد' };
  return pageRows.map(row => `<tr><td>${escapeHtml(row.printed_report_number || row.reference || row.id)}</td><td>${dateLabel(row.date)}</td><td>${escapeHtml(customerLabel(row))}</td><td>${escapeHtml(row.hatchery || '—')}</td><td>${number(row.bird_count)}</td><td>${(row.products || []).map(product => escapeHtml(product.name || 'منتج غير محدد')).join('، ') || '—'}</td><td><span class="status ${row.status === 'accepted' ? 'accepted' : 'review'}">${escapeHtml(statusLabels[row.status] || row.status || '—')}</span></td><td><button class="button small" data-open-report="${escapeHtml(row.id)}">فتح</button></td></tr>`).join('');
}

function bindDashboardEvents() {
  document.querySelector('#date-from').addEventListener('change', event => changeFilter('dateFrom', event.target.value));
  document.querySelector('#date-to').addEventListener('change', event => changeFilter('dateTo', event.target.value));
  document.querySelector('#region-filter').addEventListener('change', event => changeFilter('region', event.target.value));
  document.querySelector('#customer-filter').addEventListener('change', event => changeFilter('customerCode', event.target.value));
  document.querySelectorAll('[data-slicer]').forEach(button => button.addEventListener('click', () => {
    const key = button.dataset.slicer;
    const selected = new Set(state.filters[key]);
    if (selected.has(button.dataset.productId)) selected.delete(button.dataset.productId);
    else selected.add(button.dataset.productId);
    state.filters[key] = [...selected];
    state.page = 0;
    renderDashboard();
  }));
  document.querySelectorAll('[data-clear-slicer]').forEach(button => button.addEventListener('click', () => {
    state.filters[button.dataset.clearSlicer] = [];
    state.page = 0;
    renderDashboard();
  }));
  document.querySelectorAll('[data-year-slicer]').forEach(button => button.addEventListener('click', () => {
    const selected = new Set(state.filters.yearIds);
    if (selected.has(button.dataset.yearSlicer)) selected.delete(button.dataset.yearSlicer);
    else selected.add(button.dataset.yearSlicer);
    state.filters.yearIds = [...selected];
    pruneMonths();
    state.page = 0;
    renderDashboard();
  }));
  document.querySelector('#clear-years').addEventListener('click', () => {
    state.filters.yearIds = [];
    pruneMonths();
    state.page = 0;
    renderDashboard();
  });
  document.querySelectorAll('[data-month-slicer]').forEach(button => button.addEventListener('click', () => {
    const selected = new Set(state.filters.monthIds);
    if (selected.has(button.dataset.monthSlicer)) selected.delete(button.dataset.monthSlicer);
    else selected.add(button.dataset.monthSlicer);
    state.filters.monthIds = [...selected];
    state.page = 0;
    renderDashboard();
  }));
  document.querySelector('#clear-months').addEventListener('click', () => {
    state.filters.monthIds = [];
    state.page = 0;
    renderDashboard();
  });
  document.querySelector('#competitor-product-search')?.addEventListener('input', event => {
    state.competitorSearch = event.target.value;
    const position = event.target.selectionStart;
    renderDashboard();
    const input = document.querySelector('#competitor-product-search');
    input?.focus();
    input?.setSelectionRange(position, position);
  });
  document.querySelectorAll('input[name="status"]').forEach(input => input.addEventListener('change', () => {
    state.filters.status = [...document.querySelectorAll('input[name="status"]:checked')].map(item => item.value);
    state.page = 0;
    renderDashboard();
  }));
  document.querySelector('#clear-filters').addEventListener('click', () => {
    state.filters = { status: ['accepted'], dateFrom: '', dateTo: '', region: 'all', customerCode: '', productIds: [], competitorProductIds: [], yearIds: [], monthIds: [] };
    const latestYear = latestAvailableYear(state.rows);
    state.filters.yearIds = latestYear ? [latestYear] : [];
    state.yearDefaultInitialized = true;
    state.competitorSearch = '';
    state.page = 0;
    state.selectedProductId = '';
    state.selectedCustomerCode = '';
    renderDashboard();
  });
  document.querySelector('#export-csv').addEventListener('click', exportCsv);
  document.querySelector('#previous-page').addEventListener('click', () => { state.page = Math.max(0, state.page - 1); renderDashboard(); });
  document.querySelector('#next-page').addEventListener('click', () => { state.page += 1; renderDashboard(); });
  document.querySelector('#customer-search').addEventListener('input', event => { state.search = event.target.value; const position = event.target.selectionStart; renderDashboard(); const input = document.querySelector('#customer-search'); input.focus(); input.setSelectionRange(position, position); });
  document.querySelectorAll('[data-open-report]').forEach(button => button.addEventListener('click', () => openReport(button.dataset.openReport)));
  document.querySelectorAll('.product-choice').forEach(button => button.addEventListener('click', () => { state.selectedProductId = button.dataset.productId; const detail = document.querySelector('#product-detail'); detail.value = state.selectedProductId; renderProductDetail(currentRows()); }));
  document.querySelector('#product-detail').addEventListener('change', event => { state.selectedProductId = event.target.value; renderProductDetail(currentRows()); });
  document.querySelector('#retry')?.addEventListener('click', loadDashboard);
}

function changeFilter(name, value) {
  state.filters[name] = value;
  state.page = 0;
  renderDashboard();
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s\uFEFF]*[=+@\-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportCsv() {
  const rows = currentRows();
  const header = ['التقرير', 'التاريخ', 'كود العميل', 'العميل', 'المنطقة', 'المفرخ', 'الطيور', 'المدة بالدقائق', 'الحالة', 'المنتجات'];
  const records = rows.map(row => {
    const productNames = (row.products || []).map(product => product.is_competitor ? product.name : `${product.name} (${product.ampoule_count == null ? 'الكمية غير مسجلة' : `${number(product.ampoule_count)} أمبولة`})`).join(' | ');
    return [row.printed_report_number || row.reference || row.id, row.date, row.customer_code, row.customer, row.region, row.hatchery, row.bird_count, durationMinutes(row.start_time, row.end_time) ?? '', row.status, productNames];
  });
  const csv = '\ufeff' + [header, ...records].map(record => record.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `hatchery-reports-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function openReport(id) {
  const row = state.rows.find(item => String(item.id) === String(id));
  if (!row) return;
  const dialog = document.querySelector('#batch-dialog');
  const content = document.querySelector('#dialog-content');
  sourceRequestId += 1;
  const products = getReportProducts(row);
  const duration = durationMinutes(row.start_time, row.end_time);
  content.innerHTML = `<div class="dialog-head"><div><h2>${escapeHtml(row.printed_report_number || row.reference || row.id)}</h2></div><button class="icon-button" id="close-dialog" aria-label="إغلاق">×</button></div><div class="dialog-facts"><div><small>العميل</small><b>${escapeHtml(customerLabel(row))}</b></div><div><small>التاريخ</small><b>${dateLabel(row.date)}</b></div><div><small>المفرخ</small><b>${escapeHtml(row.hatchery || '—')}</b></div><div><small>الطيور</small><b>${number(row.bird_count)}</b></div><div><small>المنطقة / الحالة</small><b>${escapeHtml(row.region || 'غير محددة')} · ${escapeHtml(({confirmed:'مؤكدة',proposed:'مستندة للتاريخ',unresolved:'تحتاج تحديد'})[row.region_status] || '—')}</b></div><div><small>المندوب / المهندس</small><b>${escapeHtml([row.sales_rep, row.engineer].filter(Boolean).join(' · ') || '—')}</b></div><div><small>الوقت</small><b>${escapeHtml(row.start_time || '—')} – ${escapeHtml(row.end_time || '—')}</b></div><div><small>المدة</small><b>${duration == null ? '—' : `${duration} دقيقة`}</b></div></div><section class="dialog-products"><h3>المنتجات</h3><div>${products.map(product => `<div class="dialog-product"><span>${escapeHtml(product.name)}${product.competitor ? ' · منافس' : ''}</span><span>${product.competitor ? '' : product.ampoules == null ? 'عدد الأمبولات غير مسجل' : `${number(product.ampoules)} أمبولة`}</span><small>${product.competitor ? '' : escapeHtml(product.batchLot || 'التشغيلة —')}</small></div>`).join('') || '<p>لا توجد منتجات.</p>'}</div></section><section id="source-section" class="source-section"></section>`;
  document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
  dialog.showModal();
  const source = document.querySelector('#source-section');
  if (row.source_kind === 'excel') {
    source.innerHTML = '<p class="muted">لا يتوفر ملف أصلي لسجلات Excel.</p>';
  } else if (row.source_storage_path) {
    source.innerHTML = '<button id="open-source" class="button outline">فتح الملف الأصلي</button><div id="source-preview"></div>';
    document.querySelector('#open-source').addEventListener('click', () => createSourceUrl(row.source_storage_path, row.id));
  } else {
    source.innerHTML = '<p class="muted">لا يتوفر ملف أصلي.</p>';
  }
}

async function createSourceUrl(path, reportId) {
  const preview = document.querySelector('#source-preview');
  if (!preview || !state.session || !supabase) return;
  const thisRequest = ++sourceRequestId;
  const userId = state.session.user.id;
  preview.innerHTML = '<p class="muted">جارٍ إنشاء رابط آمن…</p>';
  const stillCurrent = () => thisRequest === sourceRequestId
    && state.session?.user?.id === userId
    && document.querySelector('#batch-dialog')?.open
    && document.querySelector('#dialog-content')?.querySelector('#source-preview') === preview
    && String(state.rows.find(row => String(row.id) === String(reportId))?.id) === String(reportId);
  try {
    const { data, error } = await supabase.storage.from('hatchery-reports').createSignedUrl(path, 60);
    if (!stillCurrent()) return;
    if (error || !data?.signedUrl) {
      preview.innerHTML = '<p class="alert error">تعذر فتح الملف.</p>';
      return;
    }
    if (/\.(png|jpe?g|webp|gif)$/i.test(path)) preview.innerHTML = `<img class="source-image" src="${escapeHtml(data.signedUrl)}" alt="الملف الأصلي للتقرير">`;
    else preview.innerHTML = `<a class="button outline" href="${escapeHtml(data.signedUrl)}" target="_blank" rel="noopener noreferrer">عرض / تنزيل الملف</a>`;
  } catch {
    if (stillCurrent()) preview.innerHTML = '<p class="alert error">تعذر فتح الملف.</p>';
  }
}

function renderLoginConfigError() {
  state.error = 'تعذر الاتصال بالخدمة.';
  renderLogin();
}

renderShell();
if (!supabaseConfigured) {
  renderLogin();
} else {
  renderLogin();
  supabase.auth.onAuthStateChange((event, session) => {
    state.session = session;
    if (event === 'SIGNED_IN') setTimeout(() => loadDashboard(), 0);
    else if (!session) {
      requestId += 1;
      sourceRequestId += 1;
      state.rows = [];
      state.total = 0;
      state.dateMin = null;
      state.dateMax = null;
      state.refreshedAt = null;
      state.sourceReportCount = 0;
      state.excludedInvalid = 0;
      state.loading = false;
      state.loadingUserId = '';
      state.loadedUserId = '';
      state.selectedProductId = '';
      state.selectedCustomerCode = '';
      state.search = '';
      state.filters = { status: ['accepted'], dateFrom: '', dateTo: '', region: 'all', customerCode: '', productIds: [], competitorProductIds: [], yearIds: [], monthIds: [] };
      state.ampouleRates = new Map();
      state.yearDefaultInitialized = false;
      state.competitorSearch = '';
      state.page = 0;
      state.customerMetric = 'birds';
      const dialog = document.querySelector('#batch-dialog');
      if (dialog?.open) dialog.close();
      document.querySelector('#dialog-content')?.replaceChildren();
      renderLogin();
    }
  });
  supabase.auth.getSession().then(({ data, error }) => {
    if (error) {
      state.error = 'تعذر استعادة جلسة الدخول.';
      renderLogin();
    } else if (data.session) {
      state.session = data.session;
      loadDashboard();
    }
  });
}
