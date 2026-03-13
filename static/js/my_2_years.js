function fillEntityDropdown(selectEl, groups, placeholder) {
    selectEl.innerHTML = '';

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = placeholder;
    selectEl.appendChild(defaultOpt);

    groups.forEach(group => {
        const groupEl = document.createElement('optgroup');
        groupEl.label = group.label;

        group.items.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.value;
            opt.textContent = item.label;
            groupEl.appendChild(opt);
        });

        selectEl.appendChild(groupEl);
    });
}

function getActiveFeature() {
    const activeFeatureBtn = document.querySelector('#comparisonFeatureButtons .daily-btn.daily-btn-active');
    return activeFeatureBtn ? activeFeatureBtn.dataset.feature : 'annual_boardings';
}

function getActiveScope() {
    const activeScopeBtn = document.querySelector('#entityScopeButtons .daily-btn.daily-btn-active');
    return activeScopeBtn ? activeScopeBtn.dataset.scope : 'both';
}

function isCovidYearSelected() {
    const year1 = getActiveYear('year1');
    const year2 = getActiveYear('year2');
    return year1 === '2020' || year1 === '2021' || year2 === '2020' || year2 === '2021';
}

function formatStatValue(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return '-';
    if (Math.abs(numericValue) >= 1000) {
        return Math.round(numericValue).toLocaleString();
    }
    return numericValue.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatPercentValue(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return '-';
    const sign = numericValue > 0 ? '+' : '';
    return sign + numericValue.toFixed(2) + '%';
}

function renderResultsRows(tbodyEl, rows, emptyText) {
    if (!rows || !rows.length) {
        tbodyEl.innerHTML = '<tr><td colspan="4">' + emptyText + '</td></tr>';
        return;
    }

    tbodyEl.innerHTML = rows.map((row) => {
        return '<tr>' +
            '<td>' + row.name + '</td>' +
            '<td class="metric-col">' + formatStatValue(row.stat_year_1) + '</td>' +
            '<td class="metric-col">' + formatStatValue(row.stat_year_2) + '</td>' +
            '<td class="diff-col">' + formatPercentValue(row.pct_change) + '</td>' +
        '</tr>';
    }).join('');
}

function renderDetailRows(rows, year1, year2) {
    const body = document.getElementById('detailMetricsBody');
    const wrap = document.getElementById('detailMetricsWrap');
    document.getElementById('detailYear1Header').textContent = 'Stat in ' + year1;
    document.getElementById('detailYear2Header').textContent = 'Stat in ' + year2;
    document.getElementById('detailPercentHeader').textContent = '% Change (from ' + year1 + ' to ' + year2 + ')';

    if (!rows || !rows.length) {
        body.innerHTML = '<tr><td colspan="5">No metrics available for this selection.</td></tr>';
        wrap.style.display = 'block';
        return;
    }

    body.innerHTML = rows.map((row) => {
        return '<tr>' +
            '<td>' + row.name + '</td>' +
            '<td>' + row.metric + '</td>' +
            '<td class="metric-col">' + formatStatValue(row.stat_year_1) + '</td>' +
            '<td class="metric-col">' + formatStatValue(row.stat_year_2) + '</td>' +
            '<td class="diff-col">' + formatPercentValue(row.pct_change) + '</td>' +
        '</tr>';
    }).join('');

    wrap.style.display = 'block';
}

function loadDetailEntityOptions() {
    const year1 = getActiveYear('year1');
    const year2 = getActiveYear('year2');
    const dropdown = document.getElementById('detailEntityDropdown');
    const previousValue = dropdown.value;

    if (!year1 || !year2) {
        dropdown.innerHTML = '<option value="">Select years first</option>';
        return;
    }

    fetch('/api/my-2-years-entity-options?year1=' + encodeURIComponent(year1) + '&year2=' + encodeURIComponent(year2))
        .then((response) => {
            if (!response.ok) {
                throw new Error('Failed to load options.');
            }
            return response.json();
        })
        .then((data) => {
            const groups = data.groups || [];
            fillEntityDropdown(dropdown, groups, 'Select bus line or station');

            if (previousValue) {
                const stillExists = Array.from(dropdown.options).some(opt => opt.value === previousValue);
                if (stillExists) {
                    dropdown.value = previousValue;
                    loadDetailMetrics();
                }
            }
        })
        .catch(() => {
            dropdown.innerHTML = '<option value="">Failed to load options</option>';
        });
}

function loadDetailMetrics() {
    const dropdown = document.getElementById('detailEntityDropdown');
    const entity = dropdown.value;
    const year1 = getActiveYear('year1');
    const year2 = getActiveYear('year2');
    const wrap = document.getElementById('detailMetricsWrap');

    if (!entity) {
        wrap.style.display = 'none';
        return;
    }

    fetch('/api/my-2-years-entity-metrics?year1=' + encodeURIComponent(year1) + '&year2=' + encodeURIComponent(year2) + '&entity=' + encodeURIComponent(entity))
        .then((response) => {
            if (!response.ok) {
                throw new Error('Failed to load detail metrics.');
            }
            return response.json();
        })
        .then((data) => {
            if (data.error) {
                throw new Error(data.error);
            }
            renderDetailRows(data.rows || [], year1, year2);
        })
        .catch((error) => {
            document.getElementById('detailMetricsBody').innerHTML = '<tr><td colspan="5">' + (error.message || 'Failed to load detail metrics.') + '</td></tr>';
            wrap.style.display = 'block';
        });
}

function updateFeatureButtonsByScope() {
    const scope = getActiveScope();
    const covidMode = isCovidYearSelected();
    const featureButtons = document.querySelectorAll('#comparisonFeatureButtons .daily-btn');
    featureButtons.forEach((btn) => {
        const isBusOnly = btn.dataset.busOnly === 'true';
        const show = covidMode ? !isBusOnly : (!isBusOnly || scope === 'bus');
        btn.style.display = show ? 'inline-flex' : 'none';
    });

    const activeFeature = document.querySelector('#comparisonFeatureButtons .daily-btn.daily-btn-active');
    if (!activeFeature || activeFeature.style.display === 'none') {
        const firstVisible = Array.from(featureButtons).find(btn => btn.style.display !== 'none');
        featureButtons.forEach(btn => btn.classList.remove('daily-btn-active'));
        if (firstVisible) firstVisible.classList.add('daily-btn-active');
    }
}

function setActiveYear(side, year) {
    document.querySelectorAll('.year-btn[data-side="' + side + '"]').forEach(btn => btn.classList.remove('year-btn-active'));
    const target = document.querySelector('.year-btn[data-side="' + side + '"][data-year="' + year + '"]');
    if (target) target.classList.add('year-btn-active');
}

function getActiveYear(side) {
    const active = document.querySelector('.year-btn[data-side="' + side + '"].year-btn-active');
    return active ? active.dataset.year : '';
}

document.addEventListener('click', function (e) {
    if (e.target.classList.contains('year-btn')) {
        setActiveYear(e.target.dataset.side, e.target.dataset.year);
        updateFeatureButtonsByScope();
        loadDetailEntityOptions();
    }

    if (e.target.closest('#entityScopeButtons .daily-btn')) {
        document.querySelectorAll('#entityScopeButtons .daily-btn').forEach(btn => btn.classList.remove('daily-btn-active'));
        e.target.closest('#entityScopeButtons .daily-btn').classList.add('daily-btn-active');
        updateFeatureButtonsByScope();
    }

    if (e.target.closest('#comparisonFeatureButtons .daily-btn')) {
        document.querySelectorAll('#comparisonFeatureButtons .daily-btn').forEach(btn => btn.classList.remove('daily-btn-active'));
        e.target.closest('#comparisonFeatureButtons .daily-btn').classList.add('daily-btn-active');
    }
});

document.getElementById('rankSpanSlider').addEventListener('input', function () {
    document.getElementById('rankCountLabel').textContent = this.value;
});

updateFeatureButtonsByScope();
loadDetailEntityOptions();

document.getElementById('detailEntityDropdown').addEventListener('change', function () {
    loadDetailMetrics();
});

document.getElementById('swapYearsBtn').addEventListener('click', function () {
    const year1 = getActiveYear('year1');
    const year2 = getActiveYear('year2');
    if (year1 && year2) {
        setActiveYear('year1', year2);
        setActiveYear('year2', year1);
        updateFeatureButtonsByScope();
        loadDetailEntityOptions();
    }
});

document.getElementById('compareYearsBtn').addEventListener('click', function () {
    const year1 = getActiveYear('year1');
    const year2 = getActiveYear('year2');
    const topN = Number(document.getElementById('rankSpanSlider').value || 3);
    const scope = getActiveScope();
    const feature = getActiveFeature();

    const resultEl = document.getElementById('compareYearsResult');
    const tablesWrap = document.getElementById('yearsCompareTables');
    const positiveBody = document.getElementById('positiveResultsBody');
    const negativeBody = document.getElementById('negativeResultsBody');

    if (!year1 || !year2) {
        resultEl.textContent = 'Please select both years.';
        tablesWrap.style.display = 'none';
        return;
    }

    resultEl.textContent = 'Comparing...';

    fetch('/api/my-2-years-compare?year1=' + encodeURIComponent(year1) + '&year2=' + encodeURIComponent(year2) + '&scope=' + encodeURIComponent(scope) + '&feature=' + encodeURIComponent(feature) + '&top_n=' + encodeURIComponent(topN))
        .then((response) => {
            if (!response.ok) {
                throw new Error('Failed to compare years.');
            }
            return response.json();
        })
        .then((data) => {
            if (data.error) {
                throw new Error(data.error);
            }

            document.getElementById('positiveYear1Header').textContent = 'Stat in ' + year1;
            document.getElementById('positiveYear2Header').textContent = 'Stat in ' + year2;
            document.getElementById('negativeYear1Header').textContent = 'Stat in ' + year1;
            document.getElementById('negativeYear2Header').textContent = 'Stat in ' + year2;
            document.getElementById('positivePercentHeader').textContent = '% Change (from ' + year1 + ' to ' + year2 + ')';
            document.getElementById('negativePercentHeader').textContent = '% Change (from ' + year1 + ' to ' + year2 + ')';

            document.getElementById('positiveTableTitle').textContent = 'Top ' + topN + ' biggest +% change';
            document.getElementById('negativeTableTitle').textContent = data.used_smallest_change_fallback
                ? 'Top ' + topN + ' biggest -% change'
                : 'Top ' + topN + ' biggest -% change';

            renderResultsRows(positiveBody, data.positive || [], 'No positive % changes found for this selection.');
            renderResultsRows(negativeBody, data.negative || [], 'No results found for this selection.');

            if (document.getElementById('detailEntityDropdown').value) {
                loadDetailMetrics();
            }

            tablesWrap.style.display = 'block';
            resultEl.textContent = 'Compared ' + (data.total_compared || 0) + ' matching records.';
        })
        .catch((error) => {
            tablesWrap.style.display = 'none';
            resultEl.textContent = error.message || 'Failed to compare years.';
        });
});