import test from 'node:test';
import assert from 'node:assert/strict';
import { filterRows, aggregateDashboard, durationMinutes, availableMonths, latestAvailableYear, buildAmpouleRates, estimateAmpoules } from '../src/dashboard-data.js';
import { PRODUCT_TYPE_ORDER, productDisplay } from '../src/product-catalog.js';

const rows = [
  { id: 'r1', date: '2026-09-01', bird_count: 1000, status: 'accepted', customer_code: 'A-DK', customer: 'Alfa', region: 'Dakahlia', products: [{ id: 'v1', name: 'Product A', is_competitor: false, ampoule_count: 2 }, { id: 'v2', name: 'Product B', is_competitor: false, ampoule_count: 1 }, { id: 'v3', name: 'Competitor X', is_competitor: true, ampoule_count: null }] },
  { id: 'r2', date: '2026-09-14', bird_count: 1200, status: 'accepted', customer_code: 'A-SH', customer: 'Alfa', region: 'Sharqia', products: [{ id: 'v1', name: 'Product A', is_competitor: false, ampoule_count: 3 }] },
  { id: 'r3', date: '2026-08-03', bird_count: 800, status: 'needs_review', customer_code: 'B-DK', customer: 'Beta', region: 'Dakahlia', products: [{ id: 'v2', name: 'Product B', is_competitor: false, ampoule_count: 2 }] }
];

test('overall birds count each report once when it contains multiple products', () => {
  const result = aggregateDashboard(filterRows(rows, { status: ['accepted'] }));
  assert.equal(result.birds, 2200);
  assert.equal(result.batches, 2);
  assert.equal(result.productBirds, 3200);
});

test('customer identity follows separate regional customer codes', () => {
  const result = aggregateDashboard(filterRows(rows, { status: ['accepted'] }));
  assert.equal(result.customers, 2);
  assert.equal(result.customerByCode.get('A-DK').batches, 1);
  assert.equal(result.customerByCode.get('A-SH').batches, 1);
});

test('region, customer, product and status filters compose', () => {
  const filtered = filterRows(rows, { status: ['accepted'], region: 'Dakahlia', customerCode: 'A-DK', productId: 'v2' });
  assert.deepEqual(filtered.map(row => row.id), ['r1']);
  assert.equal(filterRows(rows, { status: ['needs_review'] }).length, 1);
});

test('product slicers use OR within each group and AND across groups', () => {
  const slicerRows = [
    { id: 'both-a', status: 'accepted', products: [{ id: 'own-a', is_competitor: false }, { id: 'comp-x', is_competitor: true }] },
    { id: 'both-b', status: 'accepted', products: [{ id: 'own-b', is_competitor: false }, { id: 'comp-y', is_competitor: true }] },
    { id: 'own-only', status: 'accepted', products: [{ id: 'own-a', is_competitor: false }] },
    { id: 'competitor-only', status: 'accepted', products: [{ id: 'comp-x', is_competitor: true }] },
  ];

  assert.deepEqual(filterRows(slicerRows, { productIds: ['own-a', 'own-b'] }).map(row => row.id), ['both-a', 'both-b', 'own-only']);
  assert.deepEqual(filterRows(slicerRows, { competitorProductIds: ['comp-x', 'comp-y'] }).map(row => row.id), ['both-a', 'both-b', 'competitor-only']);
  assert.deepEqual(filterRows(slicerRows, { productIds: ['own-a', 'own-b'], competitorProductIds: ['comp-x', 'comp-y'] }).map(row => row.id), ['both-a', 'both-b']);
  assert.deepEqual(filterRows(slicerRows, { productIds: ['own-a'], competitorProductIds: ['comp-y'] }), []);
  assert.deepEqual(filterRows(slicerRows, { productIds: [], competitorProductIds: [] }).map(row => row.id), slicerRows.map(row => row.id));
});

test('year slicer uses OR for selected years and intersects the date range', () => {
  const yearRows = [
    { id: '2025-a', date: '2025-01-01', status: 'accepted' },
    { id: '2025-b', date: '2025-12-31', status: 'accepted' },
    { id: '2026-a', date: '2026-01-01', status: 'accepted' },
    { id: '2027-a', date: '2027-06-15', status: 'accepted' },
  ];
  assert.deepEqual(filterRows(yearRows, { yearIds: ['2025', '2027'] }).map(row => row.id), ['2025-a', '2025-b', '2027-a']);
  assert.deepEqual(filterRows(yearRows, { yearIds: ['2025', '2027'], dateFrom: '2025-12-31', dateTo: '2027-01-01' }).map(row => row.id), ['2025-b']);
  assert.deepEqual(filterRows(yearRows, { yearIds: [] }).map(row => row.id), yearRows.map(row => row.id));
});

test('latest year default and month availability follow the selected years', () => {
  const dated = [
    { id: 'a', date: '2025-02-01', status: 'accepted' },
    { id: 'b', date: '2025-11-01', status: 'accepted' },
    { id: 'c', date: '2026-03-01', status: 'accepted' },
    { id: 'd', date: '2026-09-01', status: 'accepted' },
  ];
  assert.equal(latestAvailableYear(dated), '2026');
  assert.deepEqual(availableMonths(dated, ['2026']), ['03', '09']);
  assert.deepEqual(availableMonths(dated, []), ['02', '03', '09', '11']);
  assert.deepEqual(filterRows(dated, { yearIds: ['2025', '2026'], monthIds: ['03', '11'], dateFrom: '2025-10-01' }).map(row => row.id), ['b', 'c']);
  assert.deepEqual(filterRows(dated, { yearIds: ['2026'], monthIds: ['02', '09'] }).map(row => row.id), ['d']);
});

test('ampoule rates are weighted by accepted report birds and all valid product lines', () => {
  const references = [
    { id: 'cal-1', status: 'accepted', bird_count: 1000, products: [
      { id: 'v1', name: 'Product A', ampoule_count: 2 }, { id: 'v1', name: 'Product A', ampoule_count: 3 },
      { id: 'competitor', name: 'Competitor', is_competitor: true, ampoule_count: 100 },
    ] },
    { id: 'cal-2', status: 'accepted', bird_count: 3000, products: [{ id: 'v1', name: 'Product A', ampoule_count: 10 }] },
    { id: 'review', status: 'needs_review', bird_count: 9000, products: [{ id: 'v1', name: 'Product A', ampoule_count: 1 }] },
    { id: 'partial', status: 'accepted', bird_count: 2000, products: [{ id: 'v1', name: 'Product A', ampoule_count: 5 }, { id: 'v1', name: 'Product A' }] },
    { id: 'zero', status: 'accepted', bird_count: 2000, products: [{ id: 'v1', name: 'Product A', ampoule_count: 0 }] },
    { id: 'bad-birds', status: 'accepted', bird_count: null, products: [{ id: 'v1', name: 'Product A', ampoule_count: 10 }] },
  ];
  const rates = buildAmpouleRates(references);
  assert.deepEqual(rates.get('v1'), { birds: 4000, ampoules: 15, samples: 2, birdsPerAmpoule: 4000 / 15 });
  assert.equal(rates.has('competitor'), false);
  assert.equal(estimateAmpoules({ id: 'v1', birds: 1000, ampoules: 2, ampoulesKnown: 1, ampoulesIncomplete: true }, rates).value, 3.75);
  assert.equal(estimateAmpoules({ id: 'v1', birds: 1000, ampoules: 4, ampoulesKnown: 1, ampoulesIncomplete: false }, rates).status, 'exact');
  assert.equal(estimateAmpoules({ id: 'unseen', birds: 1000, ampoules: 1, ampoulesKnown: 1, ampoulesIncomplete: true }, rates).status, 'recorded');
  assert.equal(estimateAmpoules({ id: 'unseen', birds: 1000, ampoules: 0, ampoulesKnown: 0, ampoulesIncomplete: true }, rates).status, 'unavailable');
  assert.equal(buildAmpouleRates([{ id: 'only-partial', status: 'accepted', bird_count: 500, products: [{ id: 'x', name: 'X', ampoule_count: 2 }, { id: 'x', name: 'X' }] }]).size, 0);
});

test('product display uses English catalog names and verified categories', () => {
  assert.deepEqual(PRODUCT_TYPE_ORDER.slice(0, 5), ['Recombinant vaccine', 'Marek', 'Live', 'Killed', 'Antibiotic']);
  assert.deepEqual(productDisplay({ id: '6134be55-23f6-4606-8cfc-662fc70a8e74', name: 'كوبرا' }), {
    id: '6134be55-23f6-4606-8cfc-662fc70a8e74', name: 'Vaxxitek COBRA', type: 'Recombinant vaccine',
  });
  assert.equal(productDisplay({ id: '86b535e4-eb95-4dc7-a527-31d95b5795d4', name: 'Newflend' }).type, 'Recombinant vaccine');
  assert.equal(productDisplay({ id: '42c69074-b10e-4a6f-9087-96eedfb499da', name: 'Nextmune' }).type, 'Immune complex');
  assert.equal(productDisplay({ id: 'unlisted', name: 'إينوفاكس' }).name, 'Innovax');
});

test('date filters include selected boundaries', () => {
  const filtered = filterRows(rows, { status: ['accepted'], dateFrom: '2026-09-14', dateTo: '2026-09-14' });
  assert.deepEqual(filtered.map(row => row.id), ['r2']);
});

test('duration handles overnight start/end values without AM/PM inference', () => {
  assert.equal(durationMinutes('22:30', '01:15'), 165);
  assert.equal(durationMinutes('09:00', '11:30'), 150);
  assert.equal(durationMinutes('9 PM', '1 AM'), null);
});

test('unknown customer codes are excluded from customer counts and rankings', () => {
  const unknown = { id: 'r4', date: '2026-09-20', bird_count: 500, status: 'accepted', customer_code: 'unknown:r4', customer: 'غير محدد', customer_known: false, region: null, products: [{ id: 'v1', name: 'Product A', is_competitor: false, ampoule_count: 1 }] };
  const result = aggregateDashboard([...rows.slice(0, 2), unknown]);
  assert.equal(result.customers, 2);
  assert.equal(result.productById.get('v1::zoetis').customers.size, 2);
  assert.deepEqual([...result.competitorNames], ['Competitor X']);
});

test('clearing all status selections returns no rows', () => {
  assert.equal(filterRows(rows, { status: [] }).length, 0);
});

test('repeated rows for one product add recorded ampoules but count batch birds once', () => {
  const row = {...rows[0], products: [
    { id: 'v1', name: 'Product A', is_competitor: false, ampoule_count: 2 },
    { id: 'v1', name: 'Product A', is_competitor: false, ampoule_count: 3 },
  ]};
  const product = aggregateDashboard([row]).productById.get('v1::zoetis');
  assert.equal(product.birds, 1000);
  assert.equal(product.batches, 1);
  assert.equal(product.ampoules, 5);
});

test('two separate report IDs remain separate batches on the same date', () => {
  const result = aggregateDashboard([rows[0], {...rows[0], id:'another-batch'}]);
  assert.equal(result.batches, 2);
  assert.equal(result.birds, 2000);
});

test('customer labels preserve saved single and regional identities without adding suffixes', async () => {
  const { customerLabel } = await import('../src/dashboard-data.js');
  const known = { customer_known: true, customer_code: 'single', customer: 'Single customer', region: 'Monofia' };
  assert.equal(customerLabel(known), 'Single customer');
  assert.equal(customerLabel({ ...known, customer_code: 'split:East', customer: 'Split customer (East)', region: 'East' }), 'Split customer (East)');
  assert.equal(customerLabel({ ...known, region: null }), 'Single customer');
  assert.equal(customerLabel({ customer_known: false, customer_code: 'unknown:1', customer: 'غير محدد' }), 'عميل غير محدد');
});

test('shared physical flock keeps regional product ownership without doubling overall birds', () => {
  const shared = [
    { id: 'ibd', application_key: 'approved-flock', date: '2026-01-06', bird_count: 25000, customer_known: true, customer_code: 'Y-SH', customer: 'Yaser', region: 'Sharqia', products: [{ id: 'ibd', name: 'Procerta IBD' }] },
    { id: 'spray', application_key: 'approved-flock', date: '2026-01-06', bird_count: 25000, customer_known: true, customer_code: 'Y-UP', customer: 'Yaser', region: 'Upper Egypt', products: [{ id: 'primer', name: 'IB Primer' }, { id: 'v4', name: 'V4' }] },
  ];
  const total = aggregateDashboard(shared);
  assert.equal(total.birds, 25000);
  assert.equal(total.batches, 2);
  assert.equal(total.regionByName.get('Sharqia').birds, 25000);
  assert.equal(total.regionByName.get('Upper Egypt').birds, 25000);
  for (const product of total.productById.values()) assert.equal(product.birds, 25000);
  assert.equal(aggregateDashboard(filterRows(shared, { region: 'Upper Egypt' })).birds, 25000);
  assert.equal(aggregateDashboard(filterRows(shared, { productId: 'primer' })).birds, 25000);
  assert.equal(aggregateDashboard([...shared, { ...shared[0], id: 'independent', application_key: null }]).birds, 50000);
});

test('multiple reports within one region/customer count its shared flock once', () => {
  const shared = [
    { id: 'one', application_key: 'same', date: '2026-01-06', bird_count: 25000, customer_code: 'Y', customer: 'Yaser', region: 'Sharqia', products: [{ id: 'v', name: 'V' }] },
    { id: 'two', application_key: 'same', date: '2026-01-06', bird_count: 25000, customer_code: 'Y', customer: 'Yaser', region: 'Sharqia', products: [{ id: 'v', name: 'V' }] },
  ];
  const total = aggregateDashboard(shared);
  assert.equal(total.customerByCode.get('Y').birds, 25000);
  assert.equal(total.regionByName.get('Sharqia').birds, 25000);
  assert.equal(total.productById.get('v::zoetis').birds, 25000);
});

test('contradictory counts on an approved shared application are rejected, not silently selected', () => {
  assert.throws(() => aggregateDashboard([
    { id: 'one', application_key: 'same', bird_count: 25000 },
    { id: 'two', application_key: 'same', bird_count: 26000 },
  ]), /تعارض/);
});
