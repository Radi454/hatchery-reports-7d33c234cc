export const isKnownCustomer = row => Boolean(row.customer_known !== false && row.customer_code && !String(row.customer_code).startsWith('unknown:') && row.customer !== 'غير محدد');

// Regional suffixes belong to reviewed database identities, not presentation.
export const customerLabel = row => isKnownCustomer(row) ? String(row.customer).trim() : 'عميل غير محدد';

export function filterRows(rows, filters = {}) {
  const statuses = Array.isArray(filters.status) ? new Set(filters.status) : null;
  return rows.filter(row => {
    if (statuses && !statuses.has(row.status)) return false;
    if (filters.dateFrom && row.date < filters.dateFrom) return false;
    if (filters.dateTo && row.date > filters.dateTo) return false;
    if (filters.region && filters.region !== 'all') {
      const unassigned = filters.region === '__unassigned__';
      if (unassigned ? row.region != null : row.region !== filters.region) return false;
    }
    if (filters.customerCode && row.customer_code !== filters.customerCode) return false;
    const ownProductIds = filters.productIds ?? (filters.productId ? [filters.productId] : []);
    const competitorProductIds = filters.competitorProductIds ?? (filters.competitorProductId ? [filters.competitorProductId] : []);
    const yearIds = Array.isArray(filters.yearIds) ? filters.yearIds : [];
    const monthIds = Array.isArray(filters.monthIds) ? filters.monthIds : [];
    if (yearIds.length && !yearIds.includes(String(row.date || '').slice(0, 4))) return false;
    if (monthIds.length && !monthIds.includes(String(row.date || '').slice(5, 7))) return false;
    if (ownProductIds.length && !row.products?.some(product => ownProductIds.includes(product.id) && !product.is_competitor)) return false;
    if (competitorProductIds.length && !row.products?.some(product => competitorProductIds.includes(product.id) && product.is_competitor)) return false;
    return true;
  });
}

export function latestAvailableYear(rows) {
  return [...new Set(rows.map(row => String(row.date || '').slice(0, 4)).filter(year => /^\d{4}$/.test(year)))].sort((a, b) => b.localeCompare(a))[0] || '';
}

export function availableMonths(rows, yearIds = []) {
  return [...new Set(rows.filter(row => !yearIds.length || yearIds.includes(String(row.date || '').slice(0, 4)))
    .map(row => String(row.date || '').slice(5, 7)).filter(month => /^(0[1-9]|1[0-2])$/.test(month)))].sort();
}

export function buildAmpouleRates(referenceRows) {
  const uniqueRows = [...new Map(referenceRows.map((row, index) => [row.id ?? `missing:${index}`, row])).values()];
  const totals = new Map();
  for (const row of uniqueRows) {
    const birds = Number(row.bird_count);
    if (row.status !== 'accepted' || !Number.isFinite(birds) || birds <= 0) continue;
    const products = new Map();
    for (const item of row.products || []) {
      if (item.is_competitor || !item.name) continue;
      const key = String(item.id || item.name);
      const group = products.get(key) || { quantities: [] };
      group.quantities.push(item.ampoule_count);
      products.set(key, group);
    }
    for (const [key, group] of products) {
      const quantities = group.quantities.map(value => value == null || String(value).trim() === '' ? NaN : Number(value));
      if (quantities.some(value => !Number.isFinite(value) || value <= 0)) continue;
      const ampoules = quantities.reduce((sum, value) => sum + value, 0);
      if (ampoules <= 0) continue;
      const total = totals.get(key) || { birds: 0, ampoules: 0, samples: 0 };
      total.birds += birds;
      total.ampoules += ampoules;
      total.samples += 1;
      totals.set(key, total);
    }
  }
  return new Map([...totals.entries()].map(([key, total]) => [key, { ...total, birdsPerAmpoule: total.birds / total.ampoules }]));
}

export function estimateAmpoules(summary, rates) {
  const recorded = Number(summary.ampoules) || 0;
  if (!summary.ampoulesIncomplete) return { status: summary.ampoulesKnown ? 'exact' : 'unavailable', value: summary.ampoulesKnown ? recorded : null, recorded };
  const rate = rates?.get(String(summary.id));
  if (!rate || !(Number(summary.birds) > 0)) return { status: recorded > 0 ? 'recorded' : 'unavailable', value: null, recorded };
  return {
    status: 'estimated',
    value: Math.round((Number(summary.birds) / rate.birdsPerAmpoule) * 100) / 100,
    recorded,
    sampleReports: rate.samples,
    birdsPerAmpoule: rate.birdsPerAmpoule,
  };
}

// Only explicit, source-reviewed application keys unite reports. Equal names,
// dates or counts alone never create a shared application.
export const applicationKey = row => row.application_key ? `application:${row.application_key}` : `report:${row.id}`;
export function uniqueBirdRows(rows) {
  const applications = new Map();
  for (const row of rows) {
    const key = applicationKey(row);
    const previous = applications.get(key);
    if (previous && Number(previous.bird_count) !== Number(row.bird_count)) {
      throw new Error('تعارض في عدد الطيور بين تقارير مرتبطة بنفس الدفعة؛ يلزم مراجعتها.');
    }
    if (!previous) applications.set(key, row);
  }
  return [...applications.values()];
}
export const totalBirds = rows => uniqueBirdRows(rows).reduce((sum, row) => sum + (Number(row.bird_count) || 0), 0);

export function aggregateDashboard(rows) {
  const uniqueRows = [...new Map(rows.map(row => [row.id, row])).values()];
  const customerByCode = new Map();
  const productById = new Map();
  const regionByName = new Map();
  const competitorNames = new Set();
  const birds = totalBirds(uniqueRows);
  const customerApplications = new Set();
  const regionApplications = new Set();
  const productApplications = new Set();
  const productRegionApplications = new Set();

  for (const row of uniqueRows) {
    const birdCount = Number(row.bird_count) || 0;
    const application = applicationKey(row);
    const customerKey = row.customer_code || `unassigned:${row.id}`;
    const knownCustomer = isKnownCustomer(row);
    const customer = customerByCode.get(customerKey) ?? {
      code: customerKey,
      name: row.customer || 'عميل غير محدد',
      batches: 0,
      birds: 0,
      regions: new Set(),
    };
    if (knownCustomer) {
      customer.batches += 1;
      const key = JSON.stringify([customerKey, application]);
      if (!customerApplications.has(key)) customer.birds += birdCount;
      customerApplications.add(key);
      if (row.region) customer.regions.add(row.region);
      customerByCode.set(customerKey, customer);
    }

    const regionKey = row.region || '__unassigned__';
    const region = regionByName.get(regionKey) ?? { name: row.region, status: row.region_status, batches: 0, birds: 0 };
    region.batches += 1;
    const regionApplication = JSON.stringify([regionKey, application]);
    if (!regionApplications.has(regionApplication)) region.birds += birdCount;
    regionApplications.add(regionApplication);
    regionByName.set(regionKey, region);

    const seenProducts = new Set();
    for (const item of row.products ?? []) {
      if (!item.name) continue;
      if (item.is_competitor) { competitorNames.add(item.name); continue; }
      const key = `${item.id || item.name}::${item.is_competitor ? 'competitor' : 'zoetis'}`;
      const firstInReport = !seenProducts.has(key);
      seenProducts.add(key);
      const product = productById.get(key) ?? {
        id: item.id || item.name,
        name: item.name,
        isCompetitor: false,
        category: item.category ?? null,
        batches: 0,
        birds: 0,
        ampoules: 0,
        ampoulesKnown: 0,
        customers: new Set(),
        regions: new Map(),
      };
      if (firstInReport) product.batches += 1;
      const productApplication = JSON.stringify([key, application]);
      if (!productApplications.has(productApplication)) product.birds += birdCount;
      productApplications.add(productApplication);
      if (!item.is_competitor) {
        if (item.ampoule_count == null) product.ampoulesIncomplete = true;
        else {
          product.ampoules += Number(item.ampoule_count) || 0;
          product.ampoulesKnown += 1;
        }
      }
      if (knownCustomer) product.customers.add(customerKey);
      const productRegion = product.regions.get(regionKey) ?? { name: row.region, batches: 0, birds: 0 };
      if (firstInReport) productRegion.batches += 1;
      const productRegionApplication = JSON.stringify([key, regionKey, application]);
      if (!productRegionApplications.has(productRegionApplication)) productRegion.birds += birdCount;
      productRegionApplications.add(productRegionApplication);
      product.regions.set(regionKey, productRegion);
      productById.set(key, product);
    }
  }

  return {
    birds,
    batches: uniqueRows.length,
    customers: customerByCode.size,
    productBirds: [...productById.values()].reduce((sum, product) => sum + product.birds, 0),
    customerByCode,
    productById,
    competitorNames,
    regionByName,
  };
}

export function durationMinutes(start, end) {
  const parse = value => {
    if (typeof value !== 'string' || !/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
    const [hour, minute, second = '0'] = value.split(':').map(Number);
    if (hour > 23 || minute > 59 || second > 59) return null;
    return hour * 60 + minute + Math.floor(second / 60);
  };
  const startMinute = parse(start);
  const endMinute = parse(end);
  if (startMinute == null || endMinute == null) return null;
  const delta = endMinute - startMinute;
  return delta < 0 ? delta + 24 * 60 : delta;
}

export function getReportProducts(row) {
  return (row.products ?? []).map(product => ({
    name: product.name,
    competitor: Boolean(product.is_competitor),
    ampoules: product.is_competitor ? null : product.ampoule_count,
    batchLot: product.is_competitor ? null : (product.batch_lot ?? null),
  }));
}
