let greaterMode = 'dropdown';
let lessMode = 'dropdown';
let currentEntityScope = 'both';
let allEntityGroups = [];
let currentSortOrder = 'desc';
let lastSearchRows = [];
let lastMetricLabel = 'Metric';
const apiCache = {};

const greaterDropdownWrap = document.getElementById('greaterDropdownWrap');
const greaterInputWrap = document.getElementById('greaterInputWrap');
const greaterInput = document.getElementById('greaterInput');
const greaterModeBtn = document.getElementById('greaterModeBtn');

const lessDropdownWrap = document.getElementById('lessDropdownWrap');
const lessInputWrap = document.getElementById('lessInputWrap');
const lessInput = document.getElementById('lessInput');
const lessModeBtn = document.getElementById('lessModeBtn');

const greaterDropdown = document.getElementById('greaterDropdown');
const lessDropdown = document.getElementById('lessDropdown');
const entityScopeButtons = document.querySelectorAll('#entityScopeButtons .daily-btn');
const featureButtons = document.querySelectorAll('#comparisonFeatureButtons .daily-btn');
const searchBtn = document.getElementById('searchBtn');
const sortSwapBtn = document.getElementById('sortSwapBtn');
const resultsStatus = document.getElementById('resultsStatus');
const resultsTableBody = document.getElementById('resultsTableBody');
const metricColumnHeader = document.getElementById('metricColumnHeader');
const rangeWarning = document.getElementById('rangeWarning');
const rangeSwapWrap = document.getElementById('rangeSwapWrap');
const rangeSwapBtn = document.getElementById('rangeSwapBtn');

function refreshModeDisplays() {
    const greaterUsesDropdown = greaterMode === 'dropdown';
    greaterDropdownWrap.style.display = greaterUsesDropdown ? 'block' : 'none';
    greaterInputWrap.style.display = greaterUsesDropdown ? 'none' : 'block';
    greaterModeBtn.textContent = greaterUsesDropdown ? 'Switch to text box' : 'Switch to dropdown';

    const lessUsesDropdown = lessMode === 'dropdown';
    lessDropdownWrap.style.display = lessUsesDropdown ? 'block' : 'none';
    lessInputWrap.style.display = lessUsesDropdown ? 'none' : 'block';
    lessModeBtn.textContent = lessUsesDropdown ? 'Switch to text box' : 'Switch to dropdown';
}

function toggleMode(side) {
    if (side === 'greater') {
        greaterMode = greaterMode === 'dropdown' ? 'input' : 'dropdown';
        refreshModeDisplays();
        updateTextboxPlaceholders();
        updateRangeWarning();
        return;
    }

    lessMode = lessMode === 'dropdown' ? 'input' : 'dropdown';
    refreshModeDisplays();
    updateTextboxPlaceholders();
    updateRangeWarning();
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

function updateTextboxPlaceholders() {
    const feature = getActiveFeature();
    const unitSuffix = getInputUnitSuffix(feature);
    greaterInput.placeholder = 'Enter minimum value' + unitSuffix;
    lessInput.placeholder = 'Enter maximum value' + unitSuffix;
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

function getBoundDefinition(side, feature, datasets) {
    if (side === 'greater') {
        if (greaterMode === 'dropdown') {
            const selected = greaterDropdown.value;
            if (!selected) {
                return null;
            }
            const metricValue = Number(getMetricValueFromData(feature, selected, datasets));
            if (!Number.isFinite(metricValue)) {
                return null;
            }
            return {
                value: metricValue,
                source: 'dropdown',
                entityKey: selected
            };
        }

        const greaterRaw = String(greaterInput.value || '').trim();
        if (greaterRaw === '') {
            return null;
        }
        const inputValue = Number(greaterRaw);
        if (Number.isFinite(inputValue)) {
            return {
                value: inputValue,
                source: 'input',
                entityKey: null
            };
        }
        return null;
    }

    if (lessMode === 'dropdown') {
        const selected = lessDropdown.value;
        if (!selected) {
            return null;
        }
        const metricValue = Number(getMetricValueFromData(feature, selected, datasets));
        if (!Number.isFinite(metricValue)) {
            return null;
        }
        return {
            value: metricValue,
            source: 'dropdown',
            entityKey: selected
        };
    }

    const lessRaw = String(lessInput.value || '').trim();
    if (lessRaw === '') {
        return null;
    }
    const inputValue = Number(lessRaw);
    if (Number.isFinite(inputValue)) {
        return {
            value: inputValue,
            source: 'input',
            entityKey: null
        };
    }
    return null;
}

function renderResultsTable(rows, metricLabel, references) {
    metricColumnHeader.textContent = metricLabel;

    if (!rows.length) {
        resultsTableBody.innerHTML = '<tr><td colspan="2">No matching records found.</td></tr>';
        return;
    }

    const referenceSet = new Set(references.filter(Boolean));
    resultsTableBody.innerHTML = rows.map(row => {
        const highlightClass = referenceSet.has(row.key) ? 'reference-highlight' : '';
        return '<tr class="' + highlightClass + '">' +
            '<td>' + row.name + '</td>' +
            '<td>' + formatMetricValue(row.metric) + '</td>' +
        '</tr>';
    }).join('');
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

function sortRows(rows) {
    const ordered = [...rows].sort((a, b) => b.metric - a.metric);
    if (currentSortOrder === 'asc') {
        ordered.reverse();
    }
    return ordered;
}

function refreshLastSearchRender() {
    renderResultsTable(lastSearchRows, lastMetricLabel, []);
}

function getAllDatasetsForCurrentYear() {
    return Promise.all([
        fetchJsonCached('busBoardings2024', '/api/boardings-data?year=2024'),
        fetchJsonCached('busDaily2024', '/api/daily-boardings-data?year=2024'),
        fetchJsonCached('busHours2024', '/api/hours-data?year=2024'),
        fetchJsonCached('busMetrics2024', '/api/metrics-data?year=2024'),
        fetchJsonCached('stationBoardings2024', '/api/station-boardings-data?year=2024'),
        fetchJsonCached('stationDaily2024', '/api/station-daily-boardings-data?year=2024')
    ]).then(([busBoardings, busDaily, busHours, busMetrics, stationBoardings, stationDaily]) => {
        return {
            busBoardings,
            busDaily,
            busHours,
            busMetrics,
            stationBoardings,
            stationDaily
        };
    });
}

function updateRangeWarning() {
    const feature = getActiveFeature();

    getAllDatasetsForCurrentYear()
        .then(datasets => {
            const greaterBound = getBoundDefinition('greater', feature, datasets);
            const lessBound = getBoundDefinition('less', feature, datasets);

            if (!greaterBound || !lessBound) {
                rangeWarning.textContent = '';
                rangeWarning.style.display = 'none';
                rangeSwapWrap.style.display = 'none';
                rangeSwapBtn.style.display = 'none';
                return;
            }

            if (greaterBound.value > lessBound.value) {
                rangeWarning.textContent = 'Warning: Left bound is greater than right bound. No rows will match unless you swap values.';
                rangeWarning.style.display = 'block';
                rangeSwapWrap.style.display = 'block';
                rangeSwapBtn.style.display = 'inline-block';
            } else {
                rangeWarning.textContent = '';
                rangeWarning.style.display = 'none';
                rangeSwapWrap.style.display = 'none';
                rangeSwapBtn.style.display = 'none';
            }
        })
        .catch(() => {
            rangeWarning.textContent = '';
            rangeWarning.style.display = 'none';
            rangeSwapWrap.style.display = 'none';
            rangeSwapBtn.style.display = 'none';
        });
}

function swapLeftRightValues() {
    const oldGreaterMode = greaterMode;
    const oldLessMode = lessMode;
    const oldGreaterDropdown = greaterDropdown.value;
    const oldLessDropdown = lessDropdown.value;
    const oldGreaterInput = greaterInput.value;
    const oldLessInput = lessInput.value;

    greaterMode = oldLessMode;
    lessMode = oldGreaterMode;
    refreshModeDisplays();

    greaterDropdown.value = oldLessDropdown;
    lessDropdown.value = oldGreaterDropdown;
    greaterInput.value = oldLessInput;
    lessInput.value = oldGreaterInput;

    updateTextboxPlaceholders();
    updateRangeWarning();
}

function runSearch() {
    const feature = getActiveFeature();
    const metricLabel = getActiveFeatureLabel();
    lastMetricLabel = metricLabel;

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

            const greaterBound = getBoundDefinition('greater', feature, datasets);
            const lessBound = getBoundDefinition('less', feature, datasets);

            const lower = greaterBound ? greaterBound.value : null;
            const upper = lessBound ? lessBound.value : null;

            const keys = getEligibleEntityKeys(currentEntityScope, feature, datasets);
            let rows = keys.map(key => {
                const metric = Number(getMetricValueFromData(feature, key, datasets));
                return {
                    key,
                    name: getEntityDisplayName(key),
                    metric
                };
            }).filter(row => Number.isFinite(row.metric));

            rows = rows.filter(row => {
                const aboveLower = lower === null || row.metric >= lower;
                const belowUpper = upper === null || row.metric <= upper;
                return aboveLower && belowUpper;
            });

            const referenceKeys = [
                greaterBound && greaterBound.source === 'dropdown' ? greaterBound.entityKey : null,
                lessBound && lessBound.source === 'dropdown' ? lessBound.entityKey : null
            ];

            referenceKeys.forEach(refKey => {
                if (!refKey) {
                    return;
                }
                if (!rows.some(row => row.key === refKey)) {
                    const metric = Number(getMetricValueFromData(feature, refKey, datasets));
                    if (Number.isFinite(metric)) {
                        rows.push({
                            key: refKey,
                            name: getEntityDisplayName(refKey),
                            metric
                        });
                    }
                }
            });

            rows = sortRows(rows);
            lastSearchRows = rows;

            renderResultsTable(rows, metricLabel, referenceKeys);
            resultsStatus.textContent = rows.length + ' record(s) found.';
        })
        .catch(error => {
            console.error(error);
            resultsStatus.textContent = 'Could not run search. Please try again.';
            resultsTableBody.innerHTML = '<tr><td colspan="2">Failed to load data.</td></tr>';
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

function updateEntityDropdownsForScope(scope) {
    const scopedGroups = getGroupsForScope(scope);

    fillEntityDropdown(greaterDropdown, scopedGroups, 'Select bus line or station');
    fillEntityDropdown(lessDropdown, scopedGroups, 'Select bus line or station');

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

    updateTextboxPlaceholders();
    updateEntityDropdownsForScope(scope);
    updateRangeWarning();
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
            updateEntityDropdownsForScope(currentEntityScope);
            updateRangeWarning();
        })
        .catch(() => {
            greaterDropdown.innerHTML = '<option value="">Failed to load options</option>';
            lessDropdown.innerHTML = '<option value="">Failed to load options</option>';
            rangeWarning.textContent = '';
            rangeWarning.style.display = 'none';
            rangeSwapWrap.style.display = 'none';
            rangeSwapBtn.style.display = 'none';
        });
}

greaterModeBtn.addEventListener('click', function() {
    toggleMode('greater');
});

lessModeBtn.addEventListener('click', function() {
    toggleMode('less');
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
        updateTextboxPlaceholders();
        updateRangeWarning();
        resultsStatus.textContent = '';
    });
});

greaterDropdown.addEventListener('change', updateRangeWarning);
lessDropdown.addEventListener('change', updateRangeWarning);
greaterInput.addEventListener('input', updateRangeWarning);
lessInput.addEventListener('input', updateRangeWarning);
rangeSwapBtn.addEventListener('click', swapLeftRightValues);

searchBtn.addEventListener('click', function() {
    runSearch();
});

sortSwapBtn.addEventListener('click', function() {
    currentSortOrder = currentSortOrder === 'desc' ? 'asc' : 'desc';
    const titleText = currentSortOrder === 'desc' ? 'Sort: highest to lowest' : 'Sort: lowest to highest';
    sortSwapBtn.title = titleText;
    sortSwapBtn.setAttribute('aria-label', titleText);

    if (lastSearchRows.length) {
        lastSearchRows = sortRows(lastSearchRows);
        const selectedRefs = [];
        if (greaterMode === 'dropdown' && greaterDropdown.value) {
            selectedRefs.push(greaterDropdown.value);
        }
        if (lessMode === 'dropdown' && lessDropdown.value) {
            selectedRefs.push(lessDropdown.value);
        }
        renderResultsTable(lastSearchRows, lastMetricLabel, selectedRefs);
    }
});

setEntityScope('both');
refreshModeDisplays();
updateTextboxPlaceholders();
load2024EntityOptions();
updateRangeWarning();
