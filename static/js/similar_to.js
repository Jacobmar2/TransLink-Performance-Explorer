let referenceMode = 'dropdown';
let currentEntityScope = 'both';
let allEntityGroups = [];
const apiCache = {};

const referenceDropdownWrap = document.getElementById('referenceDropdownWrap');
const referenceInputWrap = document.getElementById('referenceInputWrap');
const referenceInput = document.getElementById('referenceInput');
const referenceModeBtn = document.getElementById('referenceModeBtn');
const referenceDropdown = document.getElementById('referenceDropdown');

const rankSpanSlider = document.getElementById('rankSpanSlider');
const rankCountLabel = document.getElementById('rankCountLabel');

const entityScopeButtons = document.querySelectorAll('#entityScopeButtons .daily-btn');
const featureButtons = document.querySelectorAll('#comparisonFeatureButtons .daily-btn');
const searchBtn = document.getElementById('searchBtn');
const resultsStatus = document.getElementById('resultsStatus');
const resultsTableBody = document.getElementById('resultsTableBody');
const metricColumnHeader = document.getElementById('metricColumnHeader');

function toggleMode() {
    referenceMode = referenceMode === 'dropdown' ? 'input' : 'dropdown';
    const useDropdown = referenceMode === 'dropdown';
    referenceDropdownWrap.style.display = useDropdown ? 'block' : 'none';
    referenceInputWrap.style.display = useDropdown ? 'none' : 'block';
    referenceModeBtn.textContent = useDropdown ? 'Switch to text box' : 'Switch to dropdown';
    updateTextboxPlaceholder();
}

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
    const active = document.querySelector('#comparisonFeatureButtons .daily-btn.daily-btn-active');
    return active ? active.dataset.feature : 'annual_boardings';
}

function getActiveFeatureLabel() {
    const active = document.querySelector('#comparisonFeatureButtons .daily-btn.daily-btn-active');
    return active ? (active.dataset.label || active.textContent.trim()) : 'Metric';
}

function getInputUnitSuffix(feature) {
    const percentFeatures = [
        'peak_load_factor',
        'overcrowded_trips',
        'on_time_performance',
        'bus_bunching'
    ];

    if (percentFeatures.includes(feature)) {
        return ' (in %)';
    }

    if (feature === 'avg_speed') {
        return ' (in kph)';
    }

    return '';
}

function updateTextboxPlaceholder() {
    const feature = getActiveFeature();
    referenceInput.placeholder = 'Enter reference value' + getInputUnitSuffix(feature);
}

function formatMetricValue(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return '-';
    }
    if (Math.abs(n) >= 1000) {
        return Math.round(n).toLocaleString();
    }
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatPercentDiff(metric, referenceValue) {
    const m = Number(metric);
    const r = Number(referenceValue);
    if (!Number.isFinite(m) || !Number.isFinite(r)) {
        return '-';
    }
    if (r === 0) {
        return m === 0 ? '0.00%' : '-';
    }

    const diff = ((m - r) / r) * 100;
    const sign = diff > 0 ? '+' : '';
    return sign + diff.toFixed(2) + '%';
}

function fetchJsonCached(cacheKey, url) {
    if (apiCache[cacheKey]) {
        return Promise.resolve(apiCache[cacheKey]);
    }

    return fetch(url)
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to load data: ' + cacheKey);
            }
            return response.json();
        })
        .then(data => {
            apiCache[cacheKey] = data;
            return data;
        });
}

function getMetricValueFromData(feature, entityKey, datasets) {
    const splitAt = entityKey.indexOf(':');
    if (splitAt < 0) {
        return null;
    }

    const type = entityKey.slice(0, splitAt);
    const name = entityKey.slice(splitAt + 1);

    if (type === 'bus') {
        if (feature === 'annual_boardings') {
            return datasets.busBoardings[name];
        }
        if (feature === 'weekday_boardings') {
            return datasets.busDaily[name] ? datasets.busDaily[name].weekday : null;
        }
        if (feature === 'sat_boardings') {
            return datasets.busDaily[name] ? datasets.busDaily[name].saturday : null;
        }
        if (feature === 'sun_hol_boardings') {
            return datasets.busDaily[name] ? datasets.busDaily[name].sunday : null;
        }
        if (feature === 'revenue_hours') {
            return datasets.busHours[name] ? datasets.busHours[name].revenue : null;
        }
        if (feature === 'boardings_per_revenue_hour') {
            return datasets.busMetrics[name] ? datasets.busMetrics[name].boardings_per_revenue_hour : null;
        }
        if (feature === 'peak_passenger_load') {
            return datasets.busMetrics[name] ? datasets.busMetrics[name].peak_passenger_load : null;
        }
        if (feature === 'peak_load_factor') {
            return datasets.busMetrics[name] ? datasets.busMetrics[name].peak_load_factor : null;
        }
        if (feature === 'overcrowded_trips') {
            return datasets.busMetrics[name] ? datasets.busMetrics[name].overcrowded_trips_percent : null;
        }
        if (feature === 'on_time_performance') {
            return datasets.busMetrics[name] ? datasets.busMetrics[name].on_time_performance : null;
        }
        if (feature === 'bus_bunching') {
            return datasets.busMetrics[name] ? datasets.busMetrics[name].bus_bunching_percentage : null;
        }
        if (feature === 'avg_speed') {
            return datasets.busMetrics[name] ? datasets.busMetrics[name].avg_speed_kph : null;
        }
    }

    if (type === 'station') {
        if (feature === 'annual_boardings') {
            return datasets.stationBoardings[name];
        }
        if (feature === 'weekday_boardings') {
            return datasets.stationDaily[name] ? datasets.stationDaily[name].weekday : null;
        }
        if (feature === 'sat_boardings') {
            return datasets.stationDaily[name] ? datasets.stationDaily[name].saturday : null;
        }
        if (feature === 'sun_hol_boardings') {
            return datasets.stationDaily[name] ? datasets.stationDaily[name].sunday : null;
        }
    }

    return null;
}

function getEntityDisplayName(entityKey) {
    const splitAt = entityKey.indexOf(':');
    if (splitAt < 0) {
        return entityKey;
    }
    const type = entityKey.slice(0, splitAt);
    const name = entityKey.slice(splitAt + 1);
    return type === 'bus' ? 'Bus line ' + name : name;
}

function getEligibleEntityKeys(scope, feature, datasets) {
    const isBusOnlyFeature = [
        'revenue_hours',
        'boardings_per_revenue_hour',
        'peak_passenger_load',
        'peak_load_factor',
        'overcrowded_trips',
        'on_time_performance',
        'bus_bunching',
        'avg_speed'
    ].includes(feature);

    const busKeys = Object.keys(datasets.busBoardings).map(line => 'bus:' + line);
    const stationKeys = Object.keys(datasets.stationBoardings).map(station => 'station:' + station);

    if (isBusOnlyFeature) {
        return busKeys;
    }
    if (scope === 'bus') {
        return busKeys;
    }
    if (scope === 'station') {
        return stationKeys;
    }
    return busKeys.concat(stationKeys);
}

function resolveReference(feature, rows, datasets) {
    if (referenceMode === 'dropdown') {
        const selected = referenceDropdown.value;
        if (!selected) {
            return null;
        }
        const metric = Number(getMetricValueFromData(feature, selected, datasets));
        if (!Number.isFinite(metric)) {
            return null;
        }
        const indexInRows = rows.findIndex(row => row.key === selected);
        return {
            referenceValue: metric,
            referenceKey: selected,
            referenceName: getEntityDisplayName(selected),
            closestIndex: indexInRows
        };
    }

    const raw = String(referenceInput.value || '').trim();
    if (!raw) {
        return null;
    }
    const referenceValue = Number(raw);
    if (!Number.isFinite(referenceValue)) {
        return null;
    }
    if (!rows.length) {
        return null;
    }

    let closestIndex = 0;
    let closestDistance = Math.abs(rows[0].metric - referenceValue);
    for (let i = 1; i < rows.length; i += 1) {
        const distance = Math.abs(rows[i].metric - referenceValue);
        if (distance < closestDistance) {
            closestDistance = distance;
            closestIndex = i;
        }
    }

    return {
        referenceValue,
        referenceKey: null,
        referenceName: 'Reference value',
        closestIndex
    };
}

function renderResultsTable(aboveRows, referenceRow, belowRows, metricLabel, referenceValue) {
    metricColumnHeader.textContent = metricLabel;

    const merged = [];
    aboveRows.forEach(row => merged.push({ ...row, isReference: false }));
    merged.push({ ...referenceRow, isReference: true });
    belowRows.forEach(row => merged.push({ ...row, isReference: false }));

    if (!merged.length) {
        resultsTableBody.innerHTML = '<tr><td colspan="3">No matching records found.</td></tr>';
        return;
    }

    resultsTableBody.innerHTML = merged.map(row => {
        const diffText = row.isReference ? '0.00%' : formatPercentDiff(row.metric, referenceValue);
        const highlightClass = row.isReference ? 'reference-highlight' : '';
        return '<tr class="' + highlightClass + '">' +
            '<td>' + row.name + '</td>' +
            '<td class="metric-col">' + formatMetricValue(row.metric) + '</td>' +
            '<td class="diff-col">' + diffText + '</td>' +
        '</tr>';
    }).join('');
}

function runSearch() {
    const feature = getActiveFeature();
    const metricLabel = getActiveFeatureLabel();
    const rankSpan = Number(rankSpanSlider.value || 3);

    resultsStatus.textContent = 'Searching...';

    Promise.all([
        fetchJsonCached('busBoardings2024', '/api/boardings-data?year=2024'),
        fetchJsonCached('busDaily2024', '/api/daily-boardings-data?year=2024'),
        fetchJsonCached('busHours2024', '/api/hours-data?year=2024'),
        fetchJsonCached('busMetrics2024', '/api/metrics-data?year=2024'),
        fetchJsonCached('stationBoardings2024', '/api/station-boardings-data?year=2024'),
        fetchJsonCached('stationDaily2024', '/api/station-daily-boardings-data?year=2024')
    ])
        .then(([busBoardings, busDaily, busHours, busMetrics, stationBoardings, stationDaily]) => {
            const datasets = {
                busBoardings,
                busDaily,
                busHours,
                busMetrics,
                stationBoardings,
                stationDaily
            };

            const keys = getEligibleEntityKeys(currentEntityScope, feature, datasets);
            const rows = keys.map(key => {
                const metric = Number(getMetricValueFromData(feature, key, datasets));
                return {
                    key,
                    name: getEntityDisplayName(key),
                    metric
                };
            }).filter(row => Number.isFinite(row.metric));

            if (!rows.length) {
                resultsStatus.textContent = 'No records available for this filter.';
                resultsTableBody.innerHTML = '<tr><td colspan="3">No matching records found.</td></tr>';
                return;
            }

            const rankedRows = [...rows].sort((a, b) => b.metric - a.metric);
            const referenceInfo = resolveReference(feature, rankedRows, datasets);

            if (!referenceInfo || referenceInfo.closestIndex < 0) {
                resultsStatus.textContent = 'Choose a valid reference first.';
                resultsTableBody.innerHTML = '<tr><td colspan="3">Reference is missing or invalid.</td></tr>';
                return;
            }

            let aboveRows = [];
            let belowRows = [];
            let referenceRow = null;

            if (referenceInfo.referenceKey) {
                const centerIndex = referenceInfo.closestIndex;
                const startIndex = Math.max(0, centerIndex - rankSpan);
                const endIndex = Math.min(rankedRows.length - 1, centerIndex + rankSpan);

                aboveRows = rankedRows.slice(startIndex, centerIndex);
                belowRows = rankedRows.slice(centerIndex + 1, endIndex + 1);
                referenceRow = rankedRows[centerIndex];
            } else {
                // For textbox mode, keep all real entities and place the synthetic
                // reference between higher and lower metrics by insertion rank.
                const insertionIndex = rankedRows.findIndex(row => row.metric <= referenceInfo.referenceValue);
                const splitIndex = insertionIndex === -1 ? rankedRows.length : insertionIndex;

                const aboveStart = Math.max(0, splitIndex - rankSpan);
                const belowEnd = Math.min(rankedRows.length, splitIndex + rankSpan);

                aboveRows = rankedRows.slice(aboveStart, splitIndex);
                belowRows = rankedRows.slice(splitIndex, belowEnd);
                referenceRow = {
                    key: '__reference__',
                    name: referenceInfo.referenceName,
                    metric: referenceInfo.referenceValue
                };
            }

            renderResultsTable(
                aboveRows,
                referenceRow,
                belowRows,
                metricLabel,
                referenceInfo.referenceValue
            );

            resultsStatus.textContent =
                'Showing ' + aboveRows.length + ' above and ' + belowRows.length +
                ' below the closest match to your reference.';
        })
        .catch(error => {
            console.error(error);
            resultsStatus.textContent = 'Could not run search. Please try again.';
            resultsTableBody.innerHTML = '<tr><td colspan="3">Failed to load data.</td></tr>';
        });
}

function getGroupsForScope(scope) {
    if (scope === 'bus') {
        return allEntityGroups.filter(group => group.label === 'Bus Lines');
    }
    if (scope === 'station') {
        return allEntityGroups.filter(group => group.label === 'SkyTrain Stations');
    }
    return allEntityGroups;
}

function updateEntityDropdownForScope(scope) {
    const scopedGroups = getGroupsForScope(scope);
    fillEntityDropdown(referenceDropdown, scopedGroups, 'Select bus line or station');
    resultsStatus.textContent = '';
}

function setEntityScope(scope) {
    currentEntityScope = scope;

    entityScopeButtons.forEach(btn => {
        btn.classList.toggle('daily-btn-active', btn.dataset.scope === scope);
    });

    featureButtons.forEach(btn => {
        const busOnly = btn.dataset.busOnly === 'true';
        const shouldShow = !busOnly || scope === 'bus';
        btn.style.display = shouldShow ? 'inline-flex' : 'none';
        if (!shouldShow) {
            btn.classList.remove('daily-btn-active');
        }
    });

    const activeFeature = document.querySelector('#comparisonFeatureButtons .daily-btn.daily-btn-active');
    if (!activeFeature || activeFeature.style.display === 'none') {
        const firstVisible = Array.from(featureButtons).find(btn => btn.style.display !== 'none');
        if (firstVisible) {
            firstVisible.classList.add('daily-btn-active');
        }
    }

    updateTextboxPlaceholder();
    updateEntityDropdownForScope(scope);
}

function load2024EntityOptions() {
    Promise.all([
        fetch('/api/boardings-data?year=2024'),
        fetch('/api/station-boardings-data?year=2024')
    ])
        .then(async responses => {
            if (!responses[0].ok || !responses[1].ok) {
                throw new Error('Unable to load 2024 entity data');
            }

            const busData = await responses[0].json();
            const stationData = await responses[1].json();

            const busLines = Object.keys(busData)
                .map(value => String(value))
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

            const stations = Object.keys(stationData)
                .map(value => String(value))
                .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

            const groups = [
                {
                    label: 'Bus Lines',
                    items: busLines.map(line => ({ value: 'bus:' + line, label: 'Bus line ' + line }))
                },
                {
                    label: 'SkyTrain Stations',
                    items: stations.map(station => ({ value: 'station:' + station, label: station }))
                }
            ];

            allEntityGroups = groups;
            updateEntityDropdownForScope(currentEntityScope);
        })
        .catch(() => {
            referenceDropdown.innerHTML = '<option value="">Failed to load options</option>';
        });
}

referenceModeBtn.addEventListener('click', toggleMode);

rankSpanSlider.addEventListener('input', function() {
    rankCountLabel.textContent = String(rankSpanSlider.value);
});

entityScopeButtons.forEach(btn => {
    btn.addEventListener('click', function() {
        setEntityScope(btn.dataset.scope);
    });
});

featureButtons.forEach(btn => {
    btn.addEventListener('click', function(event) {
        if (event.target.closest('.feature-tooltip')) {
            return;
        }
        featureButtons.forEach(otherBtn => otherBtn.classList.remove('daily-btn-active'));
        btn.classList.add('daily-btn-active');
        updateTextboxPlaceholder();
        resultsStatus.textContent = '';
    });
});

searchBtn.addEventListener('click', runSearch);

setEntityScope('both');
updateTextboxPlaceholder();
load2024EntityOptions();
