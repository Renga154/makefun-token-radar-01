(() => {
  'use strict';

  const data = window.RADAR;
  const byId = (id) => document.getElementById(id);
  if (!data) return;

  const integer = new Intl.NumberFormat('en-US');
  const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const compactDollars = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2,
  });
  const percent = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, signDisplay: 'exceptZero' });
  const missing = '—';
  const money = (value) => value == null ? missing : compactDollars.format(value);
  const growth = (value) => value == null ? missing : percent.format(value) + '%';
  const multiple = (value) => value == null ? missing : value.toFixed(4) + '×';
  const categoryName = (row) => row.category ?? 'Uncategorized';
  const chains = (row) => row.chains.join(', ') || missing;
  function age(days) {
    if (days == null) return missing;
    return days >= 730 ? (days / 365).toFixed(1) + 'y' : integer.format(days) + 'd';
  }

  function node(tag, content = '', className = '') {
    const element = document.createElement(tag);
    element.textContent = content;
    element.className = className;
    return element;
  }

  function term(list, label, value) {
    const item = node('div');
    item.append(node('dt', label), node('dd', value));
    list.append(item);
  }

  const table = byId('ranked-table');
  const body = table.tBodies[0];
  const search = byId('search');
  const category = byId('category');
  const chain = byId('chain');
  const watchlist = byId('watchlist');
  const dialog = byId('detail');
  const families = new Map(data.families.map((family) => [family.family, family]));
  const searchIndex = new Map(data.rows.map((row) => [row, [
    row.name, row.slug, categoryName(row), ...row.chains,
  ].join(' ').toLowerCase()]));

  let sortKey = 'rank';
  let direction = 1;
  const columns = [
    ['Rank', 'rank'], ['Protocol'], ['Category'], ['Chains'], ['TVL', 'tvl_usd'],
    ['7d change', 'change_7d'], ['Age', 'age_days'], ['Implied value', 'implied_value_usd'], ['Scope'],
  ];
  const sortable = new Map();
  const headers = table.tHead.insertRow();
  for (const [label, key] of columns) {
    const header = node('th', key ? '' : label);
    header.scope = 'col';
    if (key) {
      const button = node('button', label, 'sort');
      button.type = 'button';
      const arrow = node('span', '', 'arrow');
      arrow.setAttribute('aria-hidden', 'true');
      button.append(arrow);
      button.addEventListener('click', () => {
        direction = sortKey === key ? -direction : key === 'rank' ? 1 : -1;
        sortKey = key;
        renderRanked();
      });
      header.append(button);
      sortable.set(key, { header, arrow });
    }
    headers.append(header);
  }

  function populate(select, label, values) {
    select.append(new Option(label, ''));
    values.forEach((value, index) => select.append(new Option(value, String(index))));
  }

  const categories = [...new Set(data.rows.map((row) => row.category))]
    .sort((a, b) => (a ?? 'Uncategorized').localeCompare(b ?? 'Uncategorized'));
  const chainNames = [...new Set(data.rows.flatMap((row) => row.chains))].sort((a, b) => a.localeCompare(b));
  populate(category, 'All categories', categories.map((value) => value ?? 'Uncategorized'));
  populate(chain, 'All chains', chainNames);

  function compare(a, b) {
    const first = a[sortKey];
    const second = b[sortKey];
    if (first == null) return second == null ? a.rank - b.rank : 1;
    if (second == null) return -1;
    return direction * (first - second) || a.rank - b.rank;
  }

  function growthCell(value) {
    const style = value > 0 ? ' up' : value < 0 ? ' down' : '';
    return node('td', growth(value), 'numeric' + style);
  }

  function renderRanked() {
    const query = search.value.trim().toLowerCase();
    const rows = data.rows.filter((row) =>
      (!watchlist.checked || row.on_watchlist) &&
      (category.value === '' || row.category === categories[Number(category.value)]) &&
      (chain.value === '' || row.chains.includes(chainNames[Number(chain.value)])) &&
      searchIndex.get(row).includes(query)
    ).sort(compare);
    byId('count').textContent = integer.format(rows.length) + ' of ' + integer.format(data.rows.length) + ' protocols';
    for (const [key, { header, arrow }] of sortable) {
      if (key === sortKey) {
        header.setAttribute('aria-sort', direction === 1 ? 'ascending' : 'descending');
        arrow.textContent = direction === 1 ? '↑' : '↓';
      } else {
        header.removeAttribute('aria-sort');
        arrow.textContent = '↕';
      }
    }

    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      const tr = node('tr');
      const name = node('th');
      name.scope = 'row';
      const button = node('button', row.name, 'protocol');
      button.type = 'button';
      button.setAttribute('aria-haspopup', 'dialog');
      button.addEventListener('click', () => openDetail(row));
      name.append(button);
      const scope = node('td');
      scope.append(node('span', row.on_watchlist ? 'Watchlist' : 'Early', row.on_watchlist ? 'marker watch' : 'marker'));
      tr.append(
        node('td', integer.format(row.rank), 'numeric rank'), name, node('td', categoryName(row)),
        node('td', chains(row), 'chains'), node('td', money(row.tvl_usd), 'numeric'),
        growthCell(row.change_7d), node('td', age(row.age_days), 'numeric'),
        node('td', money(row.implied_value_usd), 'numeric value'), scope
      );
      fragment.append(tr);
    }
    if (!rows.length) {
      const empty = node('td', 'No protocols match these filters.', 'empty');
      empty.colSpan = columns.length;
      const tr = node('tr');
      tr.append(empty);
      fragment.append(tr);
    }
    body.replaceChildren(fragment);
  }

  function openDetail(row) {
    const family = families.get(row.family);
    byId('detail-rank').textContent = 'Rank ' + row.rank + ' / ' + (row.on_watchlist ? 'Watchlist' : 'Early');
    byId('detail-title').textContent = row.name;
    byId('detail-meta').textContent = categoryName(row) + ' · ' + chains(row);

    const factors = node('dl', '', 'breakdown');
    term(factors, 'Family', row.family);
    term(factors, 'TVL', dollars.format(row.tvl_usd));
    term(factors, 'Base multiple', multiple(row.base_multiple));
    term(factors, 'Growth factor', multiple(row.growth_factor) + ' · ' + growth(row.growth_pct) + ' used');
    term(factors, 'Age', age(row.age_days));
    const ageUsed = Math.min(row.age_days ?? data.model.unknown_age_days, data.model.maturity_days);
    term(factors, 'Age factor', multiple(row.age_factor) + ' · ' + age(ageUsed) + ' used' + (row.age_days == null ? ' (fallback)' : ''));
    term(factors, 'Chain factor', multiple(row.chain_factor) + ' · ' + row.chain_count + ' distinct');
    const valuation = node('section');
    valuation.append(
      node('h3', 'Implied value'),
      node('p', dollars.format(row.implied_value_usd), 'detail-value'),
      node('p', 'Implied = TVL × base × growth × age × chain', 'formula'),
      factors
    );
    if (family) {
      valuation.append(node('p', family.why, 'rationale'));
    }

    const plan = node('section');
    const steps = node('ol', '', 'steps');
    for (const step of row.farm_steps) {
      const item = node('li');
      const costAt = step.lastIndexOf(' Cost: ');
      if (costAt === -1) {
        item.textContent = step;
      } else {
        item.append(node('p', step.slice(0, costAt)), node('p', step.slice(costAt + 1), 'step-meta'));
      }
      steps.append(item);
    }
    plan.append(node('h3', 'Farm plan'), steps);
    byId('detail-body').replaceChildren(valuation, plan);
    dialog.showModal();
  }

  function renderLive() {
    byId('live-count').textContent = integer.format(data.live_size) + ' protocols in this view';
    const live = byId('live-rows');
    for (const row of data.live) {
      const tr = node('tr');
      const name = node('th', row.name);
      name.scope = 'row';
      tr.append(name, node('td', categoryName(row)), node('td', chains(row), 'chains'),
        node('td', money(row.tvl_usd), 'numeric'), growthCell(row.change_7d),
        node('td', money(row.mcap_usd), 'numeric value'));
      live.append(tr);
    }
    if (!data.live.length) {
      const cell = live.insertRow().insertCell();
      cell.colSpan = 6;
      cell.className = 'empty';
      cell.textContent = 'No issued tokens in this snapshot view.';
    }
  }

  function renderModel() {
    const model = data.model;
    byId('scope').textContent = 'Snapshot as of ' + data.as_of + '. The watchlist TVL floor is ' +
      dollars.format(data.floor_usd) + '. Early coverage includes up to 260 eligible pre-token protocols ' +
      'below that floor, selected by TVL with a $5M minimum.';
    byId('calibration').textContent = 'Each family’s base multiple geometrically blends its prior with the ' +
      'median observed market cap / TVL. The model bounds that median between the prior divided by ' +
      model.winsor + ' and the prior multiplied by ' + model.winsor + '. Evidence weight is n / (n + ' +
      model.shrink_n + '), where n is the sample size. With no observations, the prior supplies the base multiple.';
    byId('factors').textContent = 'Growth applies weight ' + model.growth_weight + ' to the weekly change after ' +
      'clamping it to ' + model.growth_floor + '% through ' + model.growth_cap + '%, using 0% when missing. ' +
      'Age adds up to ' + model.maturity_range + ' to a base of ' + model.maturity_floor + ' over ' +
      model.maturity_days + ' days, using ' + model.unknown_age_days + ' days when unknown. Chain breadth ' +
      'adds ' + model.chain_weight + ' per doubling up to ' + model.chain_cap + ' chains. Factors are rounded ' +
      'to four decimal places before multiplication. The result is rounded to whole dollars with a $1 minimum.';

    for (const family of data.families) {
      const tr = node('tr');
      const name = node('th', family.family);
      name.scope = 'row';
      tr.append(name, node('td', multiple(family.prior), 'numeric'),
        node('td', multiple(family.observed_median), 'numeric'),
        node('td', integer.format(family.observed_n), 'numeric'),
        node('td', (family.evidence_weight * 100).toFixed(2) + '%', 'numeric'),
        node('td', multiple(family.base_multiple), 'numeric value'), node('td', family.why));
      byId('families').append(tr);
    }
  }

  search.addEventListener('input', renderRanked);
  for (const control of [category, chain, watchlist]) control.addEventListener('change', renderRanked);
  byId('reset').addEventListener('click', () => {
    search.value = '';
    category.value = '';
    chain.value = '';
    watchlist.checked = false;
    renderRanked();
    search.focus();
  });

  byId('snapshot').textContent = [data.as_of, data.source, data.model_version].join(' / ');
  const summary = byId('summary');
  term(summary, 'Ranked', integer.format(data.board_size));
  term(summary, 'Watchlist', integer.format(data.watchlist_size));
  term(summary, 'Early', integer.format(data.early_size));
  renderRanked();
  renderLive();
  renderModel();
  byId('error').hidden = true;
  byId('dashboard').hidden = false;
})();
