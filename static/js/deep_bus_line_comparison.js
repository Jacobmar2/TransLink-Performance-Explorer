const deepCompareState = {
    data: null,
    hoursMetric: 'revenue_hours',
    boardingsMetric: 'boardings_per_revenue_hour',
    peakPassengerDirection: {
        left: '',
        right: ''
    },
    peakLoadFactorDirection: {
        left: '',
        right: ''
    }
};

function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatNumber(value, maxFractionDigits) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return '-';
    return numericValue.toLocaleString(undefined, { maximumFractionDigits: maxFractionDigits || 0 });
}

function formatSig(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return '-';
    if (numericValue === 0) return '0';
    return parseFloat(numericValue.toPrecision(3)).toString();
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function buildInfoIcon(definitionText) {
    const safeDef = escapeHtml(definitionText);
    return ' <span class="info-tooltip" tabindex="0" aria-label="Definition">' +
        '<span class="info-tooltip-trigger">i</span>' +
        '<span class="info-tooltip-text">' + safeDef + '</span>' +
    '</span>';
}

function fillDeepLineSelect(selectEl, options) {
    selectEl.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select line';
    selectEl.appendChild(placeholder);

    options.forEach(function(option) {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.label;
        selectEl.appendChild(opt);
    });
}

function loadDeepLineOptionsForSide(side, year) {
    const selectId = side === 'left' ? 'deepLine1' : 'deepLine2';
    const selectEl = document.getElementById(selectId);
    if (!selectEl) return;

    const previousValue = selectEl.value;
    const loading = [{ value: '', label: 'Loading ' + year + ' lines...' }];
    fillDeepLineSelect(selectEl, loading);

    fetch('/api/bus-line-options?year=' + encodeURIComponent(String(year)))
        .then(function(response) {
            if (!response.ok) {
                throw new Error('Could not load ' + year + ' bus line options');
            }
            return response.json();
        })
        .then(function(options) {
            const normalized = Array.isArray(options) ? options : [];
            fillDeepLineSelect(selectEl, normalized);

            const optionValues = new Set(normalized.map(function(option) { return String(option.value || ''); }));
            if (optionValues.has(previousValue)) {
                selectEl.value = previousValue;
            }
        })
        .catch(function() {
            const fallback = [{ value: '', label: 'Unable to load lines' }];
            fillDeepLineSelect(selectEl, fallback);
        });
}

function setDeepGroupActive(groupName, clickedBtn) {
    document.querySelectorAll('.deep-option-btn[data-group="' + groupName + '"]').forEach(function(btn) {
        btn.classList.remove('deep-option-btn-active');
    });
    clickedBtn.classList.add('deep-option-btn-active');
}

function getActiveDeepValue(groupName) {
    const activeBtn = document.querySelector('.deep-option-btn[data-group="' + groupName + '"].deep-option-btn-active');
    return activeBtn ? activeBtn.dataset.value : '';
}

function setDeepGroupActiveByValue(groupName, value) {
    const targetBtn = document.querySelector('.deep-option-btn[data-group="' + groupName + '"][data-value="' + value + '"]');
    if (targetBtn) {
        setDeepGroupActive(groupName, targetBtn);
    }
}

function swapDeepSelectedLines() {
    const leftSelect = document.getElementById('deepLine1');
    const rightSelect = document.getElementById('deepLine2');
    if (!leftSelect || !rightSelect) return;

    const leftValue = leftSelect.value;
    const leftYear = getActiveDeepValue('left-year');
    const leftDay = getActiveDeepValue('left-day');
    const leftSeason = getActiveDeepValue('left-season');
    const leftTime = getActiveDeepValue('left-time');
    const rightYear = getActiveDeepValue('right-year');
    const rightDay = getActiveDeepValue('right-day');
    const rightSeason = getActiveDeepValue('right-season');
    const rightTime = getActiveDeepValue('right-time');

    leftSelect.value = rightSelect.value;
    rightSelect.value = leftValue;

    setDeepGroupActiveByValue('left-year', rightYear);
    setDeepGroupActiveByValue('left-day', rightDay);
    setDeepGroupActiveByValue('left-season', rightSeason);
    setDeepGroupActiveByValue('left-time', rightTime);
    setDeepGroupActiveByValue('right-year', leftYear);
    setDeepGroupActiveByValue('right-day', leftDay);
    setDeepGroupActiveByValue('right-season', leftSeason);
    setDeepGroupActiveByValue('right-time', leftTime);

    loadDeepLineOptionsForSide('left', rightYear || 2023);
    loadDeepLineOptionsForSide('right', leftYear || 2023);
}

function matchDeepRightButtonsToLeft() {
    const leftYear = getActiveDeepValue('left-year');
    const leftDay = getActiveDeepValue('left-day');
    const leftSeason = getActiveDeepValue('left-season');
    const leftTime = getActiveDeepValue('left-time');

    setDeepGroupActiveByValue('right-year', leftYear);
    setDeepGroupActiveByValue('right-day', leftDay);
    setDeepGroupActiveByValue('right-season', leftSeason);
    setDeepGroupActiveByValue('right-time', leftTime);

    loadDeepLineOptionsForSide('right', leftYear || 2023);
}

function getCurrentDeepSelections() {
    return {
        line1: (document.getElementById('deepLine1') || {}).value || '',
        line2: (document.getElementById('deepLine2') || {}).value || '',
        year1: getActiveDeepValue('left-year'),
        year2: getActiveDeepValue('right-year'),
        day1: getActiveDeepValue('left-day'),
        day2: getActiveDeepValue('right-day'),
        season1: getActiveDeepValue('left-season'),
        season2: getActiveDeepValue('right-season'),
        time1: getActiveDeepValue('left-time'),
        time2: getActiveDeepValue('right-time')
    };
}

function generateHourBoxes(hoursValue) {
    const numericValue = Number(hoursValue);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return '<div style="margin:18px 0;font-size:1em;color:rgba(255,255,255,0.95);font-weight:700;">No figures displayed</div>';
    }

    const rounded = Math.round(numericValue / 5) * 5;
    const units = rounded / 10;
    const fullBoxes = Math.floor(units);
    const hasHalf = (units % 1) !== 0;

    let html = '<div style="margin: 28px 0 18px 0; display:grid; grid-template-columns:repeat(10, 42px); column-gap:3px; row-gap:16px; justify-content:center; align-items:center;">';
    for (let index = 0; index < fullBoxes; index++) {
        html += '<img src="/static/icons/full square.png" alt="10 hours" style="height:42px;width:42px;display:block;">';
    }

    if (hasHalf) {
        html += '<img src="/static/icons/half square.png" alt="5 hours" style="height:42px;width:21px;display:block;justify-self:start;">';
    }

    html += '</div>';
    html += '<div style="font-size:1.05em;color:rgba(255,255,255,0.88);display:flex;gap:8px;align-items:center;justify-content:center;font-weight:700;">' +
        '<img src="/static/icons/full square.png" alt="10 hours" style="height:20px;width:20px;display:inline-block;">' +
        '<span>= 10 hours</span>' +
    '</div>';
    return html;
}

function generateBusStack(tripsValue) {
    const numericValue = Number(tripsValue);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return '<div style="margin:18px 0;font-size:1em;color:rgba(255,255,255,0.95);font-weight:700;">No figures displayed</div>';
    }

    const rounded = Math.round(numericValue * 2) / 2;
    const fullBuses = Math.floor(rounded);
    const hasHalf = (rounded % 1) !== 0;

    let html = '<div style="margin: 26px 0 16px 0; line-height: 2.2; display:flex; flex-direction:column; align-items:center; gap:6px;">';
    for (let index = 0; index < fullBuses; index++) {
        html += '<img src="/static/icons/bus%20symbol.png" alt="1 trip" style="height:144px;width:144px;display:block;margin:0;border-radius:4px;object-fit:contain;mix-blend-mode:screen;">';
    }

    if (hasHalf) {
        html += '<img src="/static/icons/half%20bus%20symbol.png" alt="0.5 trip" style="height:144px;width:144px;display:block;margin:0;border-radius:4px;object-fit:contain;mix-blend-mode:screen;">';
    }

    html += '</div>';
    html += '<div style="font-size:1.05em;color:rgba(255,255,255,0.88);font-weight:700;">Stack of buses = trips/clock-hour/direction</div>';
    return html;
}

function generatePeopleIcons(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return '<div style="margin:18px 0;font-size:1em;color:rgba(255,255,255,0.95);font-weight:700;">No figures displayed</div>';
    }

    const rounded = Math.round(numericValue);
    let html = '<div style="margin: 28px 0 16px 0; line-height: 2.45;">';
    let count = 0;
    for (let index = 0; index < rounded; index++) {
        if (count === 10) {
            html += '<br>';
            count = 0;
        }
        html += '<img src="/static/icons/person symbol.png" alt="1 passenger" style="height:80px;width:40px;display:inline-block;margin:2px;">';
        count++;
    }
    html += '</div>';
    return html;
}

function buildLargeMetricText(valueText, labelText) {
    return '<div style="margin-top: 12px; font-size: 34px; font-weight: 800; color: #fff; line-height:1.2;">' +
        escapeHtml(valueText) + '<br>' +
        '<span style="font-size:0.75em; font-weight:600;">' + escapeHtml(labelText) + '</span>' +
    '</div>';
}

function getPeakLoadColor(value) {
    if (value > 100) return '#8b0000';
    if (value < 40) return '#10d010';
    if (value < 60) return '#ffd400';
    if (value <= 75) return '#ff8c00';
    return '#ff1a1a';
}

function generatePeakLoadFactorBar(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return '<div style="margin:18px 0;font-size:1em;color:rgba(255,255,255,0.95);font-weight:700;">No data available</div>';
    }

    const fillPercent = clamp(numericValue, 0, 100);
    const barColor = getPeakLoadColor(numericValue);

    return '<div style="display:flex;flex-direction:column;align-items:center;gap:14px;">' +
        '<div style="position:relative;width:148px;height:400px;background:#ffffff;border:2px solid rgba(0,0,0,0.22);overflow:hidden;">' +
            '<div style="position:absolute;left:0;right:0;bottom:0;height:' + fillPercent + '%;background:' + barColor + ';"></div>' +
        '</div>' +
        '<div style="font-size:32px;font-weight:800;color:#fff;line-height:1.2;">Peak Load Factor: ' + formatSig(numericValue) + '%</div>' +
    '</div>';
}

function buildComparisonText(leftValue, rightValue, leftLabel, rightLabel, metricLabel) {
    const leftNum = Number(leftValue);
    const rightNum = Number(rightValue);
    if (!Number.isFinite(leftNum) || !Number.isFinite(rightNum)) return '';

    const safeMetricLabel = String(metricLabel || '').toLowerCase();

    if (leftNum === rightNum) {
        return leftLabel + ' and ' + rightLabel + ' have equal ' + safeMetricLabel;
    }

    if (leftNum === 0 || rightNum === 0) {
        if (leftNum > rightNum) {
            return leftLabel + ' has more ' + safeMetricLabel + ' than ' + rightLabel;
        }
        return leftLabel + ' has less ' + safeMetricLabel + ' than ' + rightLabel;
    }

    const biggerValue = Math.max(leftNum, rightNum);
    const smallerValue = Math.min(leftNum, rightNum);
    const ratio = biggerValue / smallerValue;

    if (ratio >= 2) {
        if (leftNum > rightNum) {
            return leftLabel + ' has ' + formatSig(ratio) + 'x more ' + safeMetricLabel + ' than ' + rightLabel;
        }
        return leftLabel + ' has ' + formatSig(ratio) + 'x less ' + safeMetricLabel + ' than ' + rightLabel;
    }

    if (leftNum > rightNum) {
        const pct = ((leftNum - rightNum) / rightNum) * 100;
        return leftLabel + ' has ' + formatSig(pct) + '% more ' + safeMetricLabel + ' than ' + rightLabel;
    }

    const pct = ((rightNum - leftNum) / rightNum) * 100;
    return leftLabel + ' has ' + formatSig(pct) + '% less ' + safeMetricLabel + ' than ' + rightLabel;
}

function buildVsSection(title, leftLabel, rightLabel, leftBodyHtml, rightBodyHtml, comparisonText, infoText) {
    const safeTitle = escapeHtml(title);
    const titleWithInfo = safeTitle + (infoText ? buildInfoIcon(infoText) : '');
    const leftHeading = '<span style="display:inline-flex;align-items:center;gap:10px;">' +
        '<img src="/static/icons/bus%20symbol.png" alt="bus" style="height:44px;width:44px;border-radius:50%;display:inline-block;object-fit:contain;mix-blend-mode:screen;">' +
        '<span>' + escapeHtml(leftLabel) + '</span>' +
    '</span>';
    const rightHeading = '<span style="display:inline-flex;align-items:center;gap:10px;">' +
        '<img src="/static/icons/bus%20symbol.png" alt="bus" style="height:44px;width:44px;border-radius:50%;display:inline-block;object-fit:contain;mix-blend-mode:screen;">' +
        '<span>' + escapeHtml(rightLabel) + '</span>' +
    '</span>';

    return '<div class="vs-container">' +
        '<div class="half left">' + leftHeading +
            '<div class="stats-box" style="padding-top:122px;padding-bottom:108px;">' + leftBodyHtml + '</div>' +
        '</div>' +
        '<div class="half right">' + rightHeading +
            '<div class="stats-box" style="padding-top:122px;padding-bottom:108px;">' + rightBodyHtml + '</div>' +
        '</div>' +
        '<div class="vs-badge">VS</div>' +
        '<div class="divider-line"></div>' +
        '<div class="annual-boardings-badge">' + titleWithInfo + '</div>' +
        (comparisonText ? '<div class="comparison-badge">' + escapeHtml(comparisonText) + '</div>' : '') +
    '</div>';
}

function normalizeDirectionButtons(directions, activeDirection, action, side) {
    if (!directions || !directions.length) {
        return '<span style="color:#6a7e8f;font-weight:700;">No direction data</span>';
    }

    return directions.map(function(direction) {
        const isActive = direction === activeDirection;
        const activeClass = isActive ? ' deep-option-btn-active' : '';
        return '<button type="button" class="deep-option-btn deep-day-btn deep-section-btn' + activeClass + '" data-action="' + action + '" data-side="' + side + '" data-direction="' + escapeHtml(direction) + '">' + escapeHtml(direction) + '</button>';
    }).join('');
}

function getDirectionMetric(sideData, directionName, metricName) {
    if (!sideData || !sideData.direction_metrics || !directionName) return null;
    const directionMetrics = sideData.direction_metrics[directionName];
    if (!directionMetrics) return null;
    return directionMetrics[metricName];
}

function renderDeepComparisonResult() {
    const resultEl = document.getElementById('deepCompareResult');
    const payload = deepCompareState.data;
    if (!resultEl || !payload) return;

    const left = payload.left || {};
    const right = payload.right || {};
    const leftLabel = (left.line || '-');
    const rightLabel = (right.line || '-');

    const isRevenueHours = deepCompareState.hoursMetric === 'revenue_hours';
    const hoursTitle = isRevenueHours ? 'Annual Revenue Hours' : 'Annual Service Hours';
    const leftTotalHours = Number(left[deepCompareState.hoursMetric]);
    const rightTotalHours = Number(right[deepCompareState.hoursMetric]);
    const leftSpan = Number(left.time_span_hours) || 1;
    const rightSpan = Number(right.time_span_hours) || 1;
    const leftAdjustedHours = Number.isFinite(leftTotalHours) ? leftTotalHours / leftSpan : null;
    const rightAdjustedHours = Number.isFinite(rightTotalHours) ? rightTotalHours / rightSpan : null;

    const leftHoursBody = Number.isFinite(leftAdjustedHours)
        ? generateHourBoxes(leftAdjustedHours) +
                    buildLargeMetricText(formatNumber(leftTotalHours, 1), 'Total ' + hoursTitle.toLowerCase()) +
                    buildLargeMetricText(formatNumber(leftAdjustedHours, 2), 'Adjusted for ' + (left.time_range || '-'))
        : 'No matching data';

    const rightHoursBody = Number.isFinite(rightAdjustedHours)
        ? generateHourBoxes(rightAdjustedHours) +
                    buildLargeMetricText(formatNumber(rightTotalHours, 1), 'Total ' + hoursTitle.toLowerCase()) +
                    buildLargeMetricText(formatNumber(rightAdjustedHours, 2), 'Adjusted for ' + (right.time_range || '-'))
        : 'No matching data';

    const section1Buttons = '<div class="deep-layer-buttons" style="justify-content:center;margin:12px 0 10px 0;">' +
        '<button type="button" class="deep-option-btn deep-day-btn deep-section-btn' + (isRevenueHours ? ' deep-option-btn-active' : '') + '" data-action="set-hours-metric" data-metric="revenue_hours">Revenue</button>' +
        '<button type="button" class="deep-option-btn deep-day-btn deep-section-btn' + (!isRevenueHours ? ' deep-option-btn-active' : '') + '" data-action="set-hours-metric" data-metric="service_hours">Service</button>' +
    '</div>';

    const section1 = section1Buttons + buildVsSection(
        hoursTitle,
        leftLabel,
        rightLabel,
        leftHoursBody,
        rightHoursBody,
        buildComparisonText(leftAdjustedHours, rightAdjustedHours, leftLabel, rightLabel, hoursTitle + ' (adjusted)'),
        'Adjusted value divides annual hours by selected time-range length.'
    );

    const leftTrips = left.trips_per_clock_hour_per_direction;
    const rightTrips = right.trips_per_clock_hour_per_direction;
    const section2 = buildVsSection(
        'Trips per Clock Hour per Direction',
        leftLabel,
        rightLabel,
        (Number.isFinite(Number(leftTrips)) ? generateBusStack(leftTrips) + buildLargeMetricText(formatSig(leftTrips), 'trips') : 'No matching data'),
        (Number.isFinite(Number(rightTrips)) ? generateBusStack(rightTrips) + buildLargeMetricText(formatSig(rightTrips), 'trips') : 'No matching data'),
        buildComparisonText(leftTrips, rightTrips, leftLabel, rightLabel, 'Trips/Clock-Hour/Direction')
    );

    const isBprh = deepCompareState.boardingsMetric === 'boardings_per_revenue_hour';
    const boardingsTitle = isBprh ? 'Average Boardings per Revenue Hour' : 'Average Boardings per Trip';
    const leftBoardings = left[deepCompareState.boardingsMetric];
    const rightBoardings = right[deepCompareState.boardingsMetric];

    const section3Buttons = '<div class="deep-layer-buttons" style="justify-content:center;margin:12px 0 10px 0;">' +
        '<button type="button" class="deep-option-btn deep-day-btn deep-section-btn' + (isBprh ? ' deep-option-btn-active' : '') + '" data-action="set-boardings-metric" data-metric="boardings_per_revenue_hour">Boardings Per Revenue Hour</button>' +
        '<button type="button" class="deep-option-btn deep-day-btn deep-section-btn' + (!isBprh ? ' deep-option-btn-active' : '') + '" data-action="set-boardings-metric" data-metric="boardings_per_trip">Boardings Per Trip</button>' +
    '</div>';

    const section3 = section3Buttons + buildVsSection(
        boardingsTitle,
        leftLabel,
        rightLabel,
        (Number.isFinite(Number(leftBoardings)) ? generatePeopleIcons(leftBoardings) + buildLargeMetricText(formatSig(leftBoardings), 'boardings') : 'No matching data'),
        (Number.isFinite(Number(rightBoardings)) ? generatePeopleIcons(rightBoardings) + buildLargeMetricText(formatSig(rightBoardings), 'boardings') : 'No matching data'),
        buildComparisonText(leftBoardings, rightBoardings, leftLabel, rightLabel, boardingsTitle)
    );

    const leftDirs = left.available_directions || [];
    const rightDirs = right.available_directions || [];

    const section4DirectionControls = '<div style="display:grid;grid-template-columns:1fr 1fr;width:min(96%,1400px);margin:12px auto 10px auto;">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;justify-self:center;">' +
            '<span style="font-weight:700;color:#0f3850;">Line 1 direction</span>' +
            normalizeDirectionButtons(leftDirs, deepCompareState.peakPassengerDirection.left, 'set-peak-passenger-direction', 'left') +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;justify-self:center;">' +
            '<span style="font-weight:700;color:#0f3850;">Line 2 direction</span>' +
            normalizeDirectionButtons(rightDirs, deepCompareState.peakPassengerDirection.right, 'set-peak-passenger-direction', 'right') +
        '</div>' +
    '</div>';

    const leftPeakPassenger = getDirectionMetric(left, deepCompareState.peakPassengerDirection.left, 'peak_passenger_load');
    const rightPeakPassenger = getDirectionMetric(right, deepCompareState.peakPassengerDirection.right, 'peak_passenger_load');

    const section4 = section4DirectionControls + buildVsSection(
        'Avg Peak Passenger Load',
        leftLabel,
        rightLabel,
        (Number.isFinite(Number(leftPeakPassenger))
            ? generatePeopleIcons(leftPeakPassenger) + buildLargeMetricText(formatSig(leftPeakPassenger),' passengers')
            : 'No matching direction data'),
        (Number.isFinite(Number(rightPeakPassenger))
            ? generatePeopleIcons(rightPeakPassenger) + buildLargeMetricText(formatSig(rightPeakPassenger), ' passengers')
            : 'No matching direction data'),
        buildComparisonText(leftPeakPassenger, rightPeakPassenger, leftLabel, rightLabel, 'Avg Peak Passenger Load')
    );

    const section5DirectionControls = '<div style="display:grid;grid-template-columns:1fr 1fr;width:min(96%,1400px);margin:12px auto 10px auto;">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;justify-self:center;">' +
            '<span style="font-weight:700;color:#0f3850;">Line 1 direction</span>' +
            normalizeDirectionButtons(leftDirs, deepCompareState.peakLoadFactorDirection.left, 'set-peak-factor-direction', 'left') +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;justify-self:center;">' +
            '<span style="font-weight:700;color:#0f3850;">Line 2 direction</span>' +
            normalizeDirectionButtons(rightDirs, deepCompareState.peakLoadFactorDirection.right, 'set-peak-factor-direction', 'right') +
        '</div>' +
    '</div>';

    const leftPeakFactor = getDirectionMetric(left, deepCompareState.peakLoadFactorDirection.left, 'peak_load_factor');
    const rightPeakFactor = getDirectionMetric(right, deepCompareState.peakLoadFactorDirection.right, 'peak_load_factor');

    const section5 = section5DirectionControls + buildVsSection(
        'Avg Peak Load Factor %',
        leftLabel,
        rightLabel,
        (Number.isFinite(Number(leftPeakFactor))
            ? generatePeakLoadFactorBar(leftPeakFactor) + '<div style="margin-top:8px;font-size:1.03em;color:#fff;">' + deepCompareState.peakLoadFactorDirection.left + '</div>'
            : 'No matching direction data'),
        (Number.isFinite(Number(rightPeakFactor))
            ? generatePeakLoadFactorBar(rightPeakFactor) + '<div style="margin-top:8px;font-size:1.03em;color:#fff;">' + deepCompareState.peakLoadFactorDirection.right + '</div>'
            : 'No matching direction data'),
        buildComparisonText(leftPeakFactor, rightPeakFactor, leftLabel, rightLabel, 'Avg Peak Load Factor %')
    );

    resultEl.innerHTML = '<div style="display:flex;flex-direction:column;gap:26px;">' +
        '<div>' + section1 + '</div>' +
        '<div>' + section2 + '</div>' +
        '<div>' + section3 + '</div>' +
        '<div>' + section4 + '</div>' +
        '<div>' + section5 + '</div>' +
    '</div>';
}

function initializeDirectionState(side, availableDirections) {
    if (!availableDirections || !availableDirections.length) {
        deepCompareState.peakPassengerDirection[side] = '';
        deepCompareState.peakLoadFactorDirection[side] = '';
        return;
    }

    if (!availableDirections.includes(deepCompareState.peakPassengerDirection[side])) {
        deepCompareState.peakPassengerDirection[side] = availableDirections[0];
    }
    if (!availableDirections.includes(deepCompareState.peakLoadFactorDirection[side])) {
        deepCompareState.peakLoadFactorDirection[side] = availableDirections[0];
    }
}

function loadDeepComparisonData() {
    const resultEl = document.getElementById('deepCompareResult');
    const selections = getCurrentDeepSelections();

    if (!selections.line1 || !selections.line2) {
        resultEl.innerHTML = '<div style="padding:16px;">Please select both bus lines first.</div>';
        return;
    }

    resultEl.innerHTML = '<div style="padding:16px;">Loading deep comparison...</div>';

    const params = new URLSearchParams(selections);
    fetch('/api/deep-bus-line-compare-2023?' + params.toString())
        .then(function(response) {
            if (!response.ok) {
                throw new Error('Failed to load deep comparison data');
            }
            return response.json();
        })
        .then(function(data) {
            if (data.error) {
                throw new Error(data.error);
            }

            deepCompareState.data = data;
            initializeDirectionState('left', (data.left || {}).available_directions || []);
            initializeDirectionState('right', (data.right || {}).available_directions || []);
            renderDeepComparisonResult();
        })
        .catch(function(error) {
            resultEl.innerHTML = '<div style="padding:16px;">' + escapeHtml(error.message || 'Failed to load data.') + '</div>';
        });
}

document.addEventListener('click', function(event) {
    const button = event.target.closest('button');
    if (!button) return;

    if (button.classList.contains('deep-option-btn') && button.dataset.group) {
        setDeepGroupActive(button.dataset.group, button);

        if (button.dataset.group === 'left-year' || button.dataset.group === 'right-year') {
            const selectedYear = parseInt(button.dataset.value || '2023', 10);
            const yearToLoad = Number.isFinite(selectedYear) ? selectedYear : 2023;
            const side = button.dataset.group === 'left-year' ? 'left' : 'right';
            deepCompareState.data = null;
            deepCompareState.peakPassengerDirection.left = '';
            deepCompareState.peakPassengerDirection.right = '';
            deepCompareState.peakLoadFactorDirection.left = '';
            deepCompareState.peakLoadFactorDirection.right = '';
            loadDeepLineOptionsForSide(side, yearToLoad);

            const resultEl = document.getElementById('deepCompareResult');
            if (resultEl) {
                resultEl.innerHTML = '<div style="padding:16px;">Select both lines and click Compare.</div>';
            }
        }
        return;
    }

    if (button.id === 'deepSwapBtn') {
        swapDeepSelectedLines();
        return;
    }

    if (button.id === 'deepMatchRightBtn') {
        matchDeepRightButtonsToLeft();
        return;
    }

    if (button.id === 'deepCompareBtn') {
        loadDeepComparisonData();
        return;
    }

    const action = button.dataset.action;
    if (!action) return;

    if (action === 'set-hours-metric') {
        deepCompareState.hoursMetric = button.dataset.metric || 'revenue_hours';
        renderDeepComparisonResult();
        return;
    }

    if (action === 'set-boardings-metric') {
        deepCompareState.boardingsMetric = button.dataset.metric || 'boardings_per_revenue_hour';
        renderDeepComparisonResult();
        return;
    }

    if (action === 'set-peak-passenger-direction') {
        const side = button.dataset.side;
        deepCompareState.peakPassengerDirection[side] = button.dataset.direction || '';
        renderDeepComparisonResult();
        return;
    }

    if (action === 'set-peak-factor-direction') {
        const side = button.dataset.side;
        deepCompareState.peakLoadFactorDirection[side] = button.dataset.direction || '';
        renderDeepComparisonResult();
    }
});

loadDeepLineOptionsForSide('left', getActiveDeepValue('left-year') || 2023);
loadDeepLineOptionsForSide('right', getActiveDeepValue('right-year') || 2023);