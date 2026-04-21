let currentDailyType = 'weekday'; // Track the current daily type selected
let currentHoursType = 'revenue'; // Track the current hours type selected
let currentMetricType = 'boardings_per_revenue_hour'; // Track the current metric type selected
let currentLineA = ''; // Track the current line A
let currentLineB = ''; // Track the current line B
let selectedYearLine1 = 2024;
let selectedYearLine2 = 2024;
let dataLoaded = false;
let loadingYears = new Set();

const boardingsByYear = {};
const dailyBoardingsByYear = {};
const hoursByYear = {};
const metricsByYear = {};
const busLineOptionsByYear = {};

function populateLineDropdown(selectEl, options, preferredValue) {
    if (!selectEl) return;

    const previousValue = preferredValue !== undefined ? preferredValue : selectEl.value;
    selectEl.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select line';
    selectEl.appendChild(placeholder);

    options.forEach(function(option) {
        const opt = document.createElement('option');
        opt.value = String(option.value || '');
        opt.textContent = option.label || opt.value;
        selectEl.appendChild(opt);
    });

    if (previousValue && Array.from(selectEl.options).some(function(opt) { return opt.value === previousValue; })) {
        selectEl.value = previousValue;
    }
}

function loadLineOptionsForSide(side, year, preferredValue) {
    const selectEl = document.getElementById(side);
    if (!selectEl) {
        return Promise.resolve();
    }

    if (busLineOptionsByYear[year]) {
        populateLineDropdown(selectEl, busLineOptionsByYear[year], preferredValue);
        syncBusDropdownWidths();
        return Promise.resolve();
    }

    return fetch('/api/bus-line-options?year=' + encodeURIComponent(String(year)))
        .then(function(response) {
            if (!response.ok) {
                throw new Error('Failed to load bus line options for ' + year);
            }
            return response.json();
        })
        .then(function(options) {
            const normalized = Array.isArray(options) ? options : [];
            busLineOptionsByYear[year] = normalized;
            populateLineDropdown(selectEl, normalized, preferredValue);
            syncBusDropdownWidths();
        })
        .catch(function() {
            populateLineDropdown(selectEl, [], preferredValue);
            syncBusDropdownWidths();
        });
}

function setYearButtonState(side, year) {
    document.querySelectorAll('.year-btn[data-side="' + side + '"]').forEach(btn => btn.classList.remove('year-btn-active'));
    var activeBtn = document.querySelector('.year-btn[data-side="' + side + '"][data-year="' + String(year) + '"]');
    if (activeBtn) {
        activeBtn.classList.add('year-btn-active');
    }
}

function syncBusDropdownWidths() {
    const sideToSelectId = {
        line1: 'line1',
        line2: 'line2'
    };

    Object.keys(sideToSelectId).forEach(function(side) {
        const yearSelectors = document.querySelector('.line-year-selectors[data-side="' + side + '"]');
        const selectNode = document.getElementById(sideToSelectId[side]);
        if (!yearSelectors || !selectNode) return;

        const measured = yearSelectors.getBoundingClientRect().width;
        const targetWidth = Math.max(measured, yearSelectors.scrollWidth) + 4;
        if (targetWidth > 0) {
            selectNode.style.width = Math.ceil(targetWidth) + 'px';
        }
    });
}

function loadJsonForYear(urlBase, year) {
    return fetch(urlBase + '?year=' + year)
        .then(response => {
            if (!response.ok) throw new Error('Failed to load ' + urlBase + ' data');
            return response.json();
        });
}

function ensureYearLoaded(year) {
    if (boardingsByYear[year] && dailyBoardingsByYear[year] && hoursByYear[year] && metricsByYear[year]) {
        dataLoaded = true;
        return Promise.resolve();
    }

    loadingYears.add(year);
    dataLoaded = false;

    return Promise.all([
        loadJsonForYear('/api/boardings-data', year),
        loadJsonForYear('/api/daily-boardings-data', year),
        loadJsonForYear('/api/hours-data', year),
        loadJsonForYear('/api/metrics-data', year)
    ]).then(results => {
        boardingsByYear[year] = results[0] || {};
        dailyBoardingsByYear[year] = results[1] || {};
        hoursByYear[year] = results[2] || {};
        metricsByYear[year] = results[3] || {};
        dataLoaded = true;
        console.log('Bus line data loaded for year ' + year);
    }).catch(error => {
        boardingsByYear[year] = {};
        dailyBoardingsByYear[year] = {};
        hoursByYear[year] = {};
        metricsByYear[year] = {};
        console.error('Error loading year data:', error);
    }).finally(() => {
        loadingYears.delete(year);
    });
}

function getSideYear(side) {
    return side === 'line1' ? selectedYearLine1 : selectedYearLine2;
}

function getSideLabel(lineName, side) {
    if (selectedYearLine1 === selectedYearLine2) {
        return lineName;
    }
    return lineName + ' (' + getSideYear(side) + ')';
}

function getBoardingsValue(lineName, side) {
    const year = getSideYear(side);
    const yearData = boardingsByYear[year] || {};
    return yearData[lineName];
}

function getDailyEntry(lineName, side) {
    const year = getSideYear(side);
    const yearData = dailyBoardingsByYear[year] || {};
    return yearData[lineName] || null;
}

function getHoursEntry(lineName, side) {
    const year = getSideYear(side);
    const yearData = hoursByYear[year] || {};
    return yearData[lineName] || null;
}

function getMetricsEntry(lineName, side) {
    const year = getSideYear(side);
    const yearData = metricsByYear[year] || {};
    return yearData[lineName] || null;
}

setYearButtonState('line1', selectedYearLine1);
setYearButtonState('line2', selectedYearLine2);
syncBusDropdownWidths();
ensureYearLoaded(selectedYearLine1);
loadLineOptionsForSide('line1', selectedYearLine1);
loadLineOptionsForSide('line2', selectedYearLine2);
window.addEventListener('resize', syncBusDropdownWidths);
window.addEventListener('load', syncBusDropdownWidths);

function formatNumber(num) {
    return Math.round(num).toLocaleString();
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildInfoIcon(definitionText) {
    var safeDef = escapeHtml(definitionText);
    return ' <span class="info-tooltip" tabindex="0" aria-label="Definition">' +
        '<span class="info-tooltip-trigger">i</span>' +
        '<span class="info-tooltip-text">' + safeDef + '</span>' +
    '</span>';
}

function generatePeopleIcons(boardings) {
    // Round to nearest 50,000
    const rounded = Math.round(boardings / 50000) * 50000;
    // 1 full person = 100,000 boardings
    const peopleUnits = rounded / 100000;
    const fullPeople = Math.floor(peopleUnits);
    const hasHalfPerson = (peopleUnits % 1) !== 0;

    if (fullPeople === 0 && !hasHalfPerson) {
        return '<div style="margin: 30px 0; font-size: 1.05em; color: rgba(255,255,255,0.95); font-weight: 700;">No figures displayed</div>' +
            '<div style="font-size: 1em; color: rgba(255,255,255,0.8); margin-top: 6px; letter-spacing: 0.5px; display:flex;gap:12px;align-items:center;justify-content:center;">' +
                '<img src="/static/icons/person symbol.png" alt="person" style="height:35px;width:auto;display:inline-block;">' +
                '<span>= 100,000 boardings</span>' +
            '</div>';
    }

    let html = '<div style="margin: 30px 0; font-size: 1.2em; line-height: 2.2;">';
    let count = 0;

    // Create rows of 10 people
    for (let i = 0; i < fullPeople; i++) {
        if (count === 10) {
            html += '<br>';
            count = 0;
        }
        html += '<img src="/static/icons/person symbol.png" alt="person" style="height: 80px; width: 40px; display: inline-block; margin: 2px;">';
        count++;
    }

    // Add half person if needed
    if (hasHalfPerson) {
        if (count === 10) {
            html += '<br>';
            count = 0;
        }
        html += '<img src="/static/icons/half person figure.png" alt="half person" style="height: 80px; width: 20px; display: inline-block; margin: 2px;">';
    }

    html += '</div>';
    html += '<div style="font-size: 1em; color: rgba(255,255,255,0.8); margin-top: 6px; letter-spacing: 0.5px; display:flex;gap:12px;align-items:center;justify-content:center;">' +
                '<img src="/static/icons/person symbol.png" alt="person" style="height:35px;width:auto;display:inline-block;">' +
                '<span>= 100,000 boardings</span>' +
            '</div>';

    return html;
}

function generatePeopleIconsDaily(boardings) {
    // Round to nearest 500
    const rounded = Math.round(boardings / 500) * 500;
    // 1 full person = 1,000 boardings
    const peopleUnits = rounded / 1000;
    const fullPeople = Math.floor(peopleUnits);
    const hasHalfPerson = (peopleUnits % 1) !== 0;

    if (fullPeople === 0 && !hasHalfPerson) {
        return '<div style="margin: 30px 0; font-size: 1.05em; color: rgba(255,255,255,0.95); font-weight: 700;">No figures displayed</div>' +
            '<div style="font-size: 1em; color: rgba(255,255,255,0.8); margin-top: 6px; letter-spacing: 0.5px; display:flex;gap:12px;align-items:center;justify-content:center;">' +
                '<img src="/static/icons/person symbol.png" alt="person" style="height:35px;width:auto;display:inline-block;">' +
                '<span>= 1,000 boardings</span>' +
            '</div>';
    }

    let html = '<div style="margin: 30px 0; font-size: 1.2em; line-height: 2.2;">';
    let count = 0;

    // Create rows of 10 people
    for (let i = 0; i < fullPeople; i++) {
        if (count === 10) {
            html += '<br>';
            count = 0;
        }
        html += '<img src="/static/icons/person symbol.png" alt="person" style="height: 80px; width: 40px; display: inline-block; margin: 2px;">';
        count++;
    }

    // Add half person if needed
    if (hasHalfPerson) {
        if (count === 10) {
            html += '<br>';
            count = 0;
        }
        html += '<img src="/static/icons/half person figure.png" alt="half person" style="height: 80px; width: 20px; display: inline-block; margin: 2px;">';
    }

    html += '</div>';
    html += '<div style="font-size: 1em; color: rgba(255,255,255,0.8); margin-top: 6px; letter-spacing: 0.5px; display:flex;gap:12px;align-items:center;justify-content:center;">' +
                '<img src="/static/icons/person symbol.png" alt="person" style="height:35px;width:auto;display:inline-block;">' +
                '<span>= 1,000 boardings</span>' +
            '</div>';

    return html;
}

function generateSquareIcons(hours) {
    // Round to nearest 500
    const rounded = Math.round(hours / 500) * 500;
    // 1 full square = 1,000 hours
    const squareUnits = rounded / 1000;
    const fullSquares = Math.floor(squareUnits);
    const hasHalfSquare = (squareUnits % 1) !== 0;

    if (fullSquares === 0 && !hasHalfSquare) {
        return '<div style="margin: 30px 0; font-size: 1.05em; color: rgba(255,255,255,0.95); font-weight: 700;">No figures displayed</div>' +
            '<div style="font-size: 1em; color: rgba(255,255,255,0.8); margin-top: 6px; letter-spacing: 0.5px; display:flex;gap:12px;align-items:center;justify-content:center;">' +
                '<img src="/static/icons/full square.png" alt="person" style="height:35px;width:auto;display:inline-block;">' +
                '<span>= 1,000 hours</span>' +
            '</div>';
    }

    let html = '<div style="margin: 30px 0; font-size: 1.2em; line-height: 2.2;">';
    let count = 0;

    // Create rows of 10 squares
    for (let i = 0; i < fullSquares; i++) {
        if (count === 10) {
            html += '<br>';
            count = 0;
        }
        // Full square: 20x20 pixels
        html += '<img src="/static/icons/full square.png" alt="person" style="height: 40px; width: 40px; display: inline-block; margin: 2px;">';
        count++;
    }

    // Add half square if needed
    if (hasHalfSquare) {
        if (count === 10) {
            html += '<br>';
            count = 0;
        }
        // Half square: 10x20 pixels
        html += '<img src="/static/icons/half square.png" alt="half person" style="height: 40px; width: 20px; display: inline-block; margin: 2px;">';
    }

    html += '</div>';
    html += '<div style="font-size: 1em; color: rgba(255,255,255,0.8); margin-top: 6px; letter-spacing: 0.5px; display:flex;gap:12px;align-items:center;justify-content:center;">' +
                '<img src="/static/icons/full square.png" alt="person" style="height:35px;width:auto;display:inline-block;">'  +
                '<span>= 1,000 hours</span>' +
            '</div>';

    return html;
}

function generatePeopleIconsMetrics(value) {
    // 1 full person = 1 boarding/metric (rounded to nearest whole number)
    const rounded = Math.round(value);
    const fullPeople = rounded;
    const hasHalfPerson = false; // No half people for metrics

    let html = '<div style="margin: 30px 0; font-size: 1.2em; line-height: 2.2;">';
    let count = 0;

    // Create rows of 10 people
    for (let i = 0; i < fullPeople; i++) {
        if (count === 10) {
            html += '<br>';
            count = 0;
        }
        html += '<img src="/static/icons/person symbol.png" alt="person" style="height: 80px; width: 40px; display: inline-block; margin: 2px;">';
        count++;
    }

    html += '</div>';
    html += '<div style="font-size: 1em; color: rgba(255,255,255,0.8); margin-top: 6px; letter-spacing: 0.5px; display:flex;gap:12px;align-items:center;justify-content:center;">' +
            '</div>';

    return html;
}

function formatSig(n) {
    // format number to 3 significant figures and remove trailing zeros where reasonable
    if (n === 0) return '0';
    const s = Number(n).toPrecision(3);
    // remove unnecessary trailing zeros and possible trailing dot
    return parseFloat(s).toString();
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function getPeakBarColor(value, peakType) {
    if (peakType === 'peak_cap') {
        if (value < 15) return '#ff1a1a';
        if (value < 30) return '#ff8c00';
        if (value <= 45) return '#ffd400';
        return '#10d010';
    }

    if (value < 40) return '#10d010';
    if (value < 60) return '#ffd400';
    if (value <= 75) return '#ff8c00';
    return '#ff1a1a';
}

function generatePeakBarIndicator(value, peakType) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return 'No data available';
    }

    const fullValue = peakType === 'peak_cap' ? 60 : 100;
    const fillPercent = clamp((numericValue / fullValue) * 100, 0, 100);
    const fillColor = getPeakBarColor(numericValue, peakType);
    const metricLabel = peakType === 'peak_cap' ? 'Capacity Utilization' : 'Peak Load Factor';

    return '<div style="display:flex;flex-direction:column;align-items:center;gap:14px;">' +
        '<div style="position:relative;width:148px;height:400px;background:#fdfdfd;border:2px solid rgba(0,0,0,0.22);border-radius:0;overflow:hidden;">' +
            '<div style="position:absolute;left:0;right:0;bottom:0;height:' + fillPercent + '%;background:' + fillColor + ';"></div>' +
        '</div>' +
        '<div style="font-size:32px;font-weight:800;color:#fff;line-height:1.2;">' + metricLabel + ': ' + formatSig(numericValue) + '%</div>' +
    '</div>';
}

function getOvercrowdBarColor(value) {
    if (value < 5) return '#10d010';
    if (value < 15) return '#ffd400';
    if (value < 25) return '#ff8c00';
    return '#ff1a1a';
}

function generateOvercrowdBarIndicator(value, overType) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return 'No data available';
    }

    const fullValue = 40;
    const fillPercent = clamp((numericValue / fullValue) * 100, 0, 100);
    const fillColor = getOvercrowdBarColor(numericValue);
    const metricLabel = overType === 'over_pct' ? '% Overcrowded Trips' : 'Overcrowded Revenue Hours';

    return '<div style="display:flex;flex-direction:column;align-items:center;gap:14px;">' +
        '<div style="position:relative;width:148px;height:400px;background:#fdfdfd;border:2px solid rgba(0,0,0,0.22);border-radius:0;overflow:hidden;">' +
            '<div style="position:absolute;left:0;right:0;bottom:0;height:' + fillPercent + '%;background:' + fillColor + ';"></div>' +
        '</div>' +
        '<div style="font-size:32px;font-weight:800;color:#fff;line-height:1.2;">' + metricLabel + ': ' + formatSig(numericValue) + '%</div>' +
    '</div>';
}

function getBunchingBarColor(value) {
    if (value < 2) return '#10d010';
    if (value < 5) return '#ffd400';
    if (value < 8) return '#ff8c00';
    return '#ff1a1a';
}

function generateBunchingBarIndicator(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return 'No data available';
    }

    const fullValue = 10;
    const fillPercent = clamp((numericValue / fullValue) * 100, 0, 100);
    const fillColor = getBunchingBarColor(numericValue);

    return '<div style="display:flex;flex-direction:column;align-items:center;gap:14px;">' +
        '<div style="position:relative;width:148px;height:400px;background:#fdfdfd;border:2px solid rgba(0,0,0,0.22);border-radius:0;overflow:hidden;">' +
            '<div style="position:absolute;left:0;right:0;bottom:0;height:' + fillPercent + '%;background:' + fillColor + ';"></div>' +
        '</div>' +
        '<div style="font-size:32px;font-weight:800;color:#fff;line-height:1.2;">Bus Bunching: ' + formatSig(numericValue) + '%</div>' +
    '</div>';
}

function getOtpColor(value) {
    if (value < 70) return '#ff1a1a';
    if (value < 80) return '#ff8c00';
    if (value <= 90) return '#ffd400';
    return '#10d010';
}

function generateOtpPieIndicator(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return 'No data available';
    }

    const clampedValue = clamp(numericValue, 0, 100);
    const angle = clampedValue * 3.6;
    const otpColor = getOtpColor(numericValue);

    return '<div style="display:flex;flex-direction:column;align-items:center;gap:14px;">' +
        '<div style="position:relative;width:220px;height:220px;border:0px solid rgba(0,0,0,0.22);border-radius:50%;background:conic-gradient(' + otpColor + ' 0deg ' + angle + 'deg,#ffffff ' + angle + 'deg 360deg);"></div>' +
        '<div style="font-size:32px;font-weight:800;color:#fff;line-height:1.2;">On Time Performance: ' + formatSig(numericValue) + '%</div>' +
    '</div>';
}

function generateSpeedometer(value, speedUnit) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return 'No data available';
    }

    const unitLabel = speedUnit === 'mph' ? 'MPH' : 'KPH';
    const maxSpeed = speedUnit === 'mph' ? 50 : 80;
    const clamped = clamp(numericValue, 0, maxSpeed);
    const ratio = clamped / maxSpeed;

    const cx = 150;
    const cy = 150;
    const outerR = 115;
    const needleLen = 94;
    const theta = Math.PI * (1 - ratio);
    const needleX = cx + needleLen * Math.cos(theta);
    const needleY = cy - needleLen * Math.sin(theta);

    let ticksAndLabels = '';
    for (let mark = 0; mark <= maxSpeed; mark += 5) {
        const markTheta = Math.PI * (1 - (mark / maxSpeed));
        const isMajor = mark % 10 === 0;

        const innerR = isMajor ? 96 : 102;
        const x1 = cx + outerR * Math.cos(markTheta);
        const y1 = cy - outerR * Math.sin(markTheta);
        const x2 = cx + innerR * Math.cos(markTheta);
        const y2 = cy - innerR * Math.sin(markTheta);

        ticksAndLabels += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#ffffff" stroke-width="' + (isMajor ? 3 : 2) + '" stroke-linecap="round"></line>';

        if (isMajor) {
            const labelR = 81;
            const lx = cx + labelR * Math.cos(markTheta);
            const ly = cy - labelR * Math.sin(markTheta);
            ticksAndLabels += '<text x="' + lx + '" y="' + ly + '" fill="#ffffff" font-size="15" font-weight="700" text-anchor="middle" dominant-baseline="middle">' + mark + '</text>';
        }
    }

    return '<div style="display:flex;flex-direction:column;align-items:center;gap:12px;">' +
        '<svg width="400" height="250" viewBox="0 0 300 200" aria-label="Average speed speedometer">' +
            '<path d="M 35 150 A 115 115 0 0 1 265 150" pathLength="100" fill="none" stroke="#ffffff" stroke-width="18" stroke-linecap="round"></path>' +
            ticksAndLabels +
            '<line x1="' + cx + '" y1="' + cy + '" x2="' + needleX + '" y2="' + needleY + '" stroke="#ffffff" stroke-width="5" stroke-linecap="round"></line>' +
            '<circle cx="' + cx + '" cy="' + cy + '" r="10" fill="#ffffff"></circle>' +
        '</svg>' +
        '<div style="font-size:32px;font-weight:800;color:#fff;line-height:1.2;">Avg Speed: ' + formatSig(numericValue) + ' ' + unitLabel + '</div>' +
    '</div>';
}

function buildSpeedTimeComparisonText(lineA, speedA, lineB, speedB) {
    if (!(speedA > 0) || !(speedB > 0)) return '';

    if (speedA === speedB) {
        return lineA + ' and ' + lineB + ' cover the same distance in 60 mins';
    }

    if (speedA > speedB) {
        var slowerMins = 60 * (speedA / speedB);
        return 'Distance ' + lineA + ' covers in 60 mins, ' + lineB + ' covers in ' + formatSig(slowerMins) + ' mins';
    }

    var fasterMins = 60 * (speedA / speedB);
    return 'Distance ' + lineA + ' covers in 60 mins, ' + lineB + ' covers in ' + formatSig(fasterMins) + ' mins';
}

document.getElementById('compareBtn').addEventListener('click', function () {
    var a = document.getElementById('line1').value || 'X';
    var b = document.getElementById('line2').value || 'Y';

    const aLabel = getSideLabel(a, 'line1');
    const bLabel = getSideLabel(b, 'line2');

    document.getElementById('compareResult').innerHTML = '<div style="padding:16px;">Loading selected year data...</div>';
    Promise.all([ensureYearLoaded(selectedYearLine1), ensureYearLoaded(selectedYearLine2)]).then(function () {
    
    // Store the current line selections for use by daily button handlers
    currentLineA = a;
    currentLineB = b;
    currentDailyType = 'weekday';

    // Get boardings data with people visualization
    var boardingsAHtml = '';
    var boardingsBHtml = '';
    var boardingsAValue = getBoardingsValue(a, 'line1');
    var boardingsBValue = getBoardingsValue(b, 'line2');

    if (boardingsAValue !== undefined && boardingsAValue !== null && !isNaN(boardingsAValue)) {
        boardingsAHtml = generatePeopleIcons(boardingsAValue) +
            '<div style="margin-top: 12px; font-size: 34px; font-weight: 800; color: #fff;">' + formatNumber(boardingsAValue) + '<br><span style="font-size:0.75em; font-weight:600;">Boardings</span></div>';
    } else {
        boardingsAHtml = 'Please select bus line';
    }

    if (boardingsBValue !== undefined && boardingsBValue !== null && !isNaN(boardingsBValue)) {
        boardingsBHtml = generatePeopleIcons(boardingsBValue) +
            '<div style="margin-top: 12px; font-size: 34px; font-weight: 800; color: #fff;">' + formatNumber(boardingsBValue) + '<br><span style="font-size:0.75em; font-weight:600;">Boardings</span></div>';
    } else {
        boardingsBHtml = 'Please select bus line';
    }

    // build comparison text
    var comparisonText = '';
    if (boardingsAValue !== undefined && boardingsAValue !== null && !isNaN(boardingsAValue) && boardingsBValue !== undefined && boardingsBValue !== null && !isNaN(boardingsBValue)) {
        var leftVal = Number(boardingsAValue);
        var rightVal = Number(boardingsBValue);
        if (leftVal === rightVal) {
            comparisonText = aLabel + ' and ' + bLabel + ' have equal annual boardings';
        } else if (leftVal > rightVal) {
            var ratio = leftVal / rightVal;
            if (ratio > 2) {
                comparisonText = aLabel + ' has ' + formatSig(ratio) + 'x more annual boardings than ' + bLabel;
            } else {
                var pct = (leftVal - rightVal) / rightVal * 100;
                comparisonText = aLabel + ' has ' + formatSig(pct) + '% more annual\nboardings than ' + bLabel;
            }
        } else {
            var pct = (rightVal - leftVal) / rightVal * 100;
            comparisonText = aLabel + ' has ' + formatSig(pct) + '% less annual\nboardings than ' + bLabel;
        }
    }

    var html = '<div class="vs-container">' +
        '<div class="half left">' + aLabel +
            '<div class="stats-box">' + boardingsAHtml + '</div>' +
        '</div>' +
        '<div class="half right">' + bLabel +
            '<div class="stats-box">' + boardingsBHtml + '</div>' +
        '</div>' +
        '<div class="vs-badge">VS</div>' +
        '<div class="divider-line"></div>' +
        '<div class="annual-boardings-badge">Annual Boardings</div>' +
        (comparisonText ? '<div class="comparison-badge">' + comparisonText + '</div>' : '') +
        '</div>' +

        // Daily boardings selection buttons
        '<div class="daily-boardings-selectors">' +
            '<button type="button" class="daily-btn daily-btn-active" id="btn-daily-weekday">Weekday</button>' +
            '<button type="button" class="daily-btn" id="btn-daily-sat">Sat</button>' +
            '<button type="button" class="daily-btn" id="btn-daily-sun">Sun/Hol</button>' +
        '</div>' +
        '<div id="daily-boardings-display" class="vs-container">' +

        '</div>' +

        // Revenue/Service hours selection buttons
        '<div class="hours-selectors">' +
            '<button type="button" class="hours-btn hours-btn-active" id="btn-hours-revenue">Revenue</button>' +
            '<button type="button" class="hours-btn" id="btn-hours-service">Service</button>' +
        '</div>' +
        '<div id="hours-display" class="vs-container">' +
            
        '</div>' +

        // Metrics selection buttons
        '<div class="metrics-selectors">' +
            '<button type="button" class="metrics-btn metrics-btn-active" id="btn-metrics-bprh">Boardings per Revenue Hour</button>' +
            '<button type="button" class="metrics-btn" id="btn-metrics-ppl">Peak Passenger Load</button>' +
        '</div>' +
        '<div id="metrics-display" class="vs-container">' +
            
        '</div>' +

        // Peak load factor / Capacity utilization
        '<div class="metrics-selectors">' +
            '<button type="button" class="section-btn peak-btn section-btn-active" id="btn-peak-plf">Peak Load Factor</button>' +
            '<button type="button" class="section-btn peak-btn" id="btn-peak-cap">Capacity Utilization</button>' +
        '</div>' +
        '<div id="peak-display" class="vs-container">' +
            '<div class="half left">' + a + '<div class="stats-box">TODO</div></div>' +
            '<div class="half right">' + b + '<div class="stats-box">TODO</div></div>' +
        '</div>' +

        // Overcrowded revenue hours / % overcrowded trips
        '<div class="metrics-selectors">' +
            '<button type="button" class="section-btn overcrowd-btn section-btn-active" id="btn-over-hrs">Overcrowded Revenue Hours</button>' +
            '<button type="button" class="section-btn overcrowd-btn" id="btn-over-pct">% Overcrowded Trips</button>' +
        '</div>' +
        '<div id="overcrowd-display" class="vs-container">' +
            '<div class="half left">' + a + '<div class="stats-box">TODO</div></div>' +
            '<div class="half right">' + b + '<div class="stats-box">TODO</div></div>' +
        '</div>' +

        // % On-time performance / % Bus bunching
        '<div class="metrics-selectors">' +
            '<button type="button" class="section-btn ontime-btn section-btn-active" id="btn-ontime-pct">% On Time Performance</button>' +
            '<button type="button" class="section-btn ontime-btn" id="btn-bunching-pct">% Bus Bunching</button>' +
        '</div>' +
        '<div id="ontime-display" class="vs-container">' +
            '<div class="half left">' + a + '<div class="stats-box">TODO</div></div>' +
            '<div class="half right">' + b + '<div class="stats-box">TODO</div></div>' +
        '</div>' +

        // Avg speed (KPH / MPH)
        '<div class="metrics-selectors">' +
            '<button type="button" class="section-btn speed-btn section-btn-active" id="btn-speed-kph">Avg Speed KPH</button>' +
            '<button type="button" class="section-btn speed-btn" id="btn-speed-mph">Avg Speed MPH</button>' +
        '</div>' +
        '<div id="avgspeed-display" class="vs-container">' +
            '<div class="half left">' + a + '<div class="stats-box">TODO</div></div>' +
            '<div class="half right">' + b + '<div class="stats-box">TODO</div></div>' +
        '</div>';

    document.getElementById('compareResult').innerHTML = html;
    
    // Update daily boardings display for the default (weekday) selection
    updateDailyBoardingsDisplay(a, b, 'weekday');
    
    // Update hours display for the default (revenue) selection
    updateHoursDisplay(a, b, 'revenue');
    
    // Update metrics display for the default (boardings per revenue hours) selection
    updateMetricsDisplay(a, b, 'boardings_per_revenue_hour');

    // Update new placeholder sections (TODO) with default selections
    updatePeakDisplay(a, b, 'peak_plf');
    updateOvercrowdDisplay(a, b, 'over_hrs');
    updateOntimeDisplay(a, b, 'ontime_pct');
    updateAvgSpeedDisplay(a, b, 'kph');
    });
});

function updateDailyBoardingsDisplay(a, b, dayType) {
    currentDailyType = dayType;
    const aLabel = getSideLabel(a, 'line1');
    const bLabel = getSideLabel(b, 'line2');
    
    // Get daily boardings data for the selected day type
    var dailyBoardingsAHtml = '';
    var dailyBoardingsBHtml = '';
    var dayName = '';
    var dailyValueA = null;
    var dailyValueB = null;
    
    if (dayType === 'weekday') {
        dayName = 'Weekday';
    } else if (dayType === 'saturday') {
        dayName = 'Saturday';
    } else if (dayType === 'sunday') {
        dayName = 'Sunday/Holiday';
    }
    
    // Check if line a has data
    var dailyEntryA = getDailyEntry(a, 'line1');
    if (dailyEntryA) {
        var weekdayVal = dailyEntryA[dayType];
        if (weekdayVal !== undefined && weekdayVal !== null && !isNaN(weekdayVal)) {
            dailyValueA = weekdayVal;
            dailyBoardingsAHtml = generatePeopleIconsDaily(dailyValueA) +
                '<div style="margin-top: 12px; font-size: 34px; font-weight: 800; color: #fff;">' + formatNumber(dailyValueA) + '<br><span style="font-size:0.75em; font-weight:600;">Daily Boardings</span></div>';
        } else {
            dailyBoardingsAHtml = 'No data for ' + dayName;
        }
    } else {
        dailyBoardingsAHtml = 'No data available for line ' + a;
    }

    // Check if line b has data
    var dailyEntryB = getDailyEntry(b, 'line2');
    if (dailyEntryB) {
        var weekdayVal = dailyEntryB[dayType];
        if (weekdayVal !== undefined && weekdayVal !== null && !isNaN(weekdayVal)) {
            dailyValueB = weekdayVal;
            dailyBoardingsBHtml = generatePeopleIconsDaily(dailyValueB) +
                '<div style="margin-top: 12px; font-size: 34px; font-weight: 800; color: #fff;">' + formatNumber(dailyValueB) + '<br><span style="font-size:0.75em; font-weight:600;">Daily Boardings</span></div>';
        } else {
            dailyBoardingsBHtml = 'No data for ' + dayName;
        }
    } else {
        dailyBoardingsBHtml = 'No data available for line ' + b;
    }

    // Build daily comparison text
    var dailyComparisonText = '';
    if (dailyValueA !== null && dailyValueB !== null) {
        var leftVal = Number(dailyValueA);
        var rightVal = Number(dailyValueB);
        if (leftVal === rightVal) {
            dailyComparisonText = aLabel + ' and ' + bLabel + ' have equal daily boardings';
        } else if (leftVal > rightVal) {
            var ratio = leftVal / rightVal;
            if (ratio > 2) {
                dailyComparisonText = aLabel + ' has ' + formatSig(ratio) + 'x more daily boardings than ' + bLabel;
            } else {
                var pct = (leftVal - rightVal) / rightVal * 100;
                dailyComparisonText = aLabel + ' has ' + formatSig(pct) + '% more daily\nboardings than ' + bLabel;
            }
        } else {
            var pct = (rightVal - leftVal) / rightVal * 100;
            dailyComparisonText = aLabel + ' has ' + formatSig(pct) + '% less daily\nboardings than ' + bLabel;
        }
    }

    var html = '<div class="half left">' + aLabel +
        '<div class="stats-box">' + dailyBoardingsAHtml + '</div>' +
        '</div>' +
        '<div class="half right">' + bLabel +
            '<div class="stats-box">' + dailyBoardingsBHtml + '</div>' +
        '</div>' +
        '<div class="vs-badge">VS</div>' +
        '<div class="divider-line"></div>' +
        '<div class="annual-boardings-badge">' + dayName + ' Daily Boardings</div>' +
        (dailyComparisonText ? '<div class="comparison-badge">' + dailyComparisonText + '</div>' : '') +
        '</div>';

    document.getElementById('daily-boardings-display').innerHTML = html;
}

function updateHoursDisplay(a, b, hoursType) {
    currentHoursType = hoursType;
    const aLabel = getSideLabel(a, 'line1');
    const bLabel = getSideLabel(b, 'line2');
    
    // Get hours data for the selected type
    var hoursAHtml = '';
    var hoursBHtml = '';
    var hoursName = '';
    var hoursValueA = null;
    var hoursValueB = null;
    
    if (hoursType === 'revenue') {
        hoursName = 'Revenue';
    } else if (hoursType === 'service') {
        hoursName = 'Service';
    }

    var hoursDefinitionText = (hoursType === 'revenue')
        ? 'Annual Revenue Hours = The time that transit vehicles are in revenue service, from the time they leave the trip start terminus to the time they arrive at the trip end terminus, and exclude recovery (layover) time at terminuses and deadheading times (i.e., time used by vehicles to travel from a depot to a service start point and to return to the depot from a service end point)'
        : 'Annual Service Hours = The time that transit vehicles are in revenue service (from the time they leave the trip start terminus to the time they arrive at the trip end terminus) and including recovery (layover) time at terminuses and deadheading times (i.e., time used by vehicles to travel from a depot to a service start point and to return to the depot from a service end point)';
    
    // Check if line a has data
    var hoursEntryA = getHoursEntry(a, 'line1');
    if (hoursEntryA) {
        var typeVal = hoursEntryA[hoursType];
        if (typeVal !== undefined && typeVal !== null && !isNaN(typeVal)) {
            hoursValueA = typeVal;
            hoursAHtml = generateSquareIcons(hoursValueA) +
                '<div style="margin-top: 12px; font-size: 34px; font-weight: 800; color: #fff;">' + formatNumber(hoursValueA) + '<br><span style="font-size:0.75em; font-weight:600;">Annual ' + hoursName + ' Hours</span></div>';
        } else {
            hoursAHtml = 'No data available';
        }
    } else {
        hoursAHtml = 'No data available for line ' + a;
    }

    // Check if line b has data
    var hoursEntryB = getHoursEntry(b, 'line2');
    if (hoursEntryB) {
        var typeVal = hoursEntryB[hoursType];
        if (typeVal !== undefined && typeVal !== null && !isNaN(typeVal)) {
            hoursValueB = typeVal;
            hoursBHtml = generateSquareIcons(hoursValueB) +
                '<div style="margin-top: 12px; font-size: 34px; font-weight: 800; color: #fff;">' + formatNumber(hoursValueB) + '<br><span style="font-size:0.75em; font-weight:600;">Annual ' + hoursName + ' Hours</span></div>';
        } else {
            hoursBHtml = 'No data available';
        }
    } else {
        hoursBHtml = 'No data available for line ' + b;
    }

    // Build hours comparison text
    var hoursComparisonText = '';
    if (hoursValueA !== null && hoursValueB !== null) {
        var leftVal = Number(hoursValueA);
        var rightVal = Number(hoursValueB);
        if (leftVal === rightVal) {
            hoursComparisonText = aLabel + ' and ' + bLabel + ' have equal ' + hoursName.toLowerCase() + ' hours';
        } else if (leftVal > rightVal) {
            var ratio = leftVal / rightVal;
            if (ratio > 2) {
                hoursComparisonText = aLabel + ' has ' + formatSig(ratio) + 'x more ' + hoursName.toLowerCase() + ' hours than ' + bLabel;
            } else {
                var pct = (leftVal - rightVal) / rightVal * 100;
                hoursComparisonText = aLabel + ' has ' + formatSig(pct) + '% more ' + hoursName.toLowerCase() + '\nhours than ' + bLabel;
            }
        } else {
            var pct = (rightVal - leftVal) / rightVal * 100;
            hoursComparisonText = aLabel + ' has ' + formatSig(pct) + '% less ' + hoursName.toLowerCase() + '\nhours than ' + bLabel;
        }
    }

    var html = '<div class="half left">' + aLabel +
        '<div class="stats-box">' + hoursAHtml + '</div>' +
        '</div>' +
        '<div class="half right">' + bLabel +
            '<div class="stats-box">' + hoursBHtml + '</div>' +
        '</div>' +
        '<div class="vs-badge">VS</div>' +
        '<div class="divider-line"></div>' +
        '<div class="annual-boardings-badge">Annual ' + hoursName + ' Hours' + buildInfoIcon(hoursDefinitionText) + '</div>' +
        (hoursComparisonText ? '<div class="comparison-badge">' + hoursComparisonText + '</div>' : '') +
        '</div>';

    document.getElementById('hours-display').innerHTML = html;
}

function updateMetricsDisplay(a, b, metricType) {
    currentMetricType = metricType;
    const aLabel = getSideLabel(a, 'line1');
    const bLabel = getSideLabel(b, 'line2');
    
    // Get metrics data for the selected type
    var metricsAHtml = '';
    var metricsBHtml = '';
    var metricsName = '';
    var metricsValueA = null;
    var metricsValueB = null;
    
    if (metricType === 'boardings_per_revenue_hour') {
        metricsName = 'Boardings per Revenue Hour';
    } else if (metricType === 'peak_passenger_load') {
        metricsName = 'Peak Passenger Load';
    }

    var metricsDefinitionText = (metricType === 'boardings_per_revenue_hour')
        ? 'Boardings per Revenue Hour = Annual Boardings ÷ Annual Revenue Hours. An industry-standard key performance indicator that measures the volume of riders compared to the supply of transit service.'
        : 'Avg Peak Passenger Load = Σ(peak passenger load for each trip) ÷ number of trips. A measure of how full a transit vehicle is, on average, at its busiest point or peak on a route.';
    
    // Check if line a has data
    var metricsEntryA = getMetricsEntry(a, 'line1');
    if (metricsEntryA) {
        var typeVal = metricsEntryA[metricType];
        if (typeVal !== undefined && typeVal !== null && !isNaN(typeVal)) {
            metricsValueA = typeVal;
            metricsAHtml = generatePeopleIconsMetrics(metricsValueA) +
                '<div style="margin-top: 12px; font-size: 34px; font-weight: 800; color: #fff;">' + formatSig(metricsValueA) + '<br><span style="font-size:0.75em; font-weight:600;">' + metricsName + '</span></div>';
        } else {
            metricsAHtml = 'No data available';
        }
    } else {
        metricsAHtml = 'No data available for line ' + a;
    }

    // Check if line b has data
    var metricsEntryB = getMetricsEntry(b, 'line2');
    if (metricsEntryB) {
        var typeVal = metricsEntryB[metricType];
        if (typeVal !== undefined && typeVal !== null && !isNaN(typeVal)) {
            metricsValueB = typeVal;
            metricsBHtml = generatePeopleIconsMetrics(metricsValueB) +
                '<div style="margin-top: 12px; font-size: 34px; font-weight: 800; color: #fff;">' + formatSig(metricsValueB) + '<br><span style="font-size:0.75em; font-weight:600;">' + metricsName + '</span></div>';
        } else {
            metricsBHtml = 'No data available';
        }
    } else {
        metricsBHtml = 'No data available for line ' + b;
    }

    // Build metrics comparison text
    var metricsComparisonText = '';
    if (metricsValueA !== null && metricsValueB !== null) {
        var leftVal = Number(metricsValueA);
        var rightVal = Number(metricsValueB);
        if (leftVal === rightVal) {
            metricsComparisonText = aLabel + ' and ' + bLabel + ' have equal ' + metricsName.toLowerCase();
        } else if (leftVal > rightVal) {
            var ratio = leftVal / rightVal;
            if (ratio > 2) {
                metricsComparisonText = aLabel + ' has ' + formatSig(ratio) + 'x more ' + metricsName.toLowerCase() + ' than ' + bLabel;
            } else {
                var pct = (leftVal - rightVal) / rightVal * 100;
                metricsComparisonText = aLabel + ' has ' + formatSig(pct) + '% more ' + metricsName.toLowerCase() + ' than ' + bLabel;
            }
        } else {
            var pct = (rightVal - leftVal) / rightVal * 100;
            metricsComparisonText = aLabel + ' has ' + formatSig(pct) + '% less ' + metricsName.toLowerCase() + ' than ' + bLabel;
        }
    }

    var html = '<div class="half left">' + aLabel +
        '<div class="stats-box">' + metricsAHtml + '</div>' +
        '</div>' +
        '<div class="half right">' + bLabel +
            '<div class="stats-box">' + metricsBHtml + '</div>' +
        '</div>' +
        '<div class="vs-badge">VS</div>' +
        '<div class="divider-line"></div>' +
        '<div class="annual-boardings-badge">' + 'Average ' + metricsName + buildInfoIcon(metricsDefinitionText) + '</div>' +
        (metricsComparisonText ? '<div class="comparison-badge">' + metricsComparisonText + '</div>' : '') +
        '</div>';

    document.getElementById('metrics-display').innerHTML = html;
}

    function updatePeakDisplay(a, b, peakType) {
        const aLabel = getSideLabel(a, 'line1');
        const bLabel = getSideLabel(b, 'line2');
        var title = (peakType === 'peak_cap') ? 'Capacity Utilization' : 'Peak Load Factor';
        var metricKey = (peakType === 'peak_cap') ? 'capacity_utilization' : 'peak_load_factor';
        var definitionText = (peakType === 'peak_cap')
            ? 'Capacity Utilization: The percentage of delivered capacity (seats and spaces) utilized by customers along an entire route.'
            : 'Peak Load Factor: The ratio of average passengers carried versus the capacity or space available on a vehicle, expressed as a percentage. A passenger load factor of 100% means the vehicle is at capacity. The peak load factor is calculated by dividing the average load on a transit vehicle at its busiest point by the number of spaces (seats plus standing space) provided on each trip.';

        var peakValueA = null;
        var peakValueB = null;

        var peakAHtml = 'No data available for line ' + a;
        var peakBHtml = 'No data available for line ' + b;

        var metricsEntryA = getMetricsEntry(a, 'line1');
        if (metricsEntryA) {
            var valueA = metricsEntryA[metricKey];
            if (valueA !== undefined && valueA !== null && !isNaN(valueA)) {
                peakValueA = Number(valueA);
                peakAHtml = generatePeakBarIndicator(peakValueA, peakType);
            } else {
                peakAHtml = 'No data available';
            }
        }

        var metricsEntryB = getMetricsEntry(b, 'line2');
        if (metricsEntryB) {
            var valueB = metricsEntryB[metricKey];
            if (valueB !== undefined && valueB !== null && !isNaN(valueB)) {
                peakValueB = Number(valueB);
                peakBHtml = generatePeakBarIndicator(peakValueB, peakType);
            } else {
                peakBHtml = 'No data available';
            }
        }

        var comparisonText = '';
        if (peakValueA !== null && peakValueB !== null) {
            var leftVal = Number(peakValueA);
            var rightVal = Number(peakValueB);
            var metricLabel = title.toLowerCase();
            if (leftVal === rightVal) {
                comparisonText = aLabel + ' and ' + bLabel + ' have equal ' + metricLabel;
            } else if (leftVal > rightVal) {
                var ratio = leftVal / rightVal;
                if (ratio > 2) {
                    comparisonText = aLabel + ' has ' + formatSig(ratio) + 'x higher ' + metricLabel + ' than ' + bLabel;
                } else {
                    var pct = (leftVal - rightVal) / rightVal * 100;
                    comparisonText = aLabel + ' has ' + formatSig(pct) + '% higher ' + metricLabel + ' than ' + bLabel;
                }
            } else {
                var pct = (rightVal - leftVal) / rightVal * 100;
                comparisonText = aLabel + ' has ' + formatSig(pct) + '% lower ' + metricLabel + ' than ' + bLabel;
            }
        }

        var html = '<div class="half left">' + aLabel +
            '<div class="stats-box">' + peakAHtml + '</div>' +
            '</div>' +
            '<div class="half right">' + bLabel +
            '<div class="stats-box">' + peakBHtml + '</div>' +
            '</div>' +
            '<div class="vs-badge">VS</div>' +
            '<div class="divider-line"></div>' +
            '<div class="annual-boardings-badge">' + title + buildInfoIcon(definitionText) + '</div>' +
            (comparisonText ? '<div class="comparison-badge">' + comparisonText + '</div>' : '');

        document.getElementById('peak-display').innerHTML = html;
    }

    function updateOvercrowdDisplay(a, b, overType) {
        const aLabel = getSideLabel(a, 'line1');
        const bLabel = getSideLabel(b, 'line2');
        var title = (overType === 'over_pct') ? '% Overcrowded Trips' : 'Overcrowded Revenue Hours';
        var metricKey = (overType === 'over_pct') ? 'overcrowded_trips_percent' : 'overcrowded_revenue_hours';
        var definitionText = (overType === 'over_pct')
            ? '% Overcrowded Trips: percentage of trips that exceed the overcrowding threshold.'
            : 'Overcrowded Revenue Hours: percentage of revenue service hours that exceed the overcrowding threshold.';

        var overValueA = null;
        var overValueB = null;

        var overAHtml = 'No data available for line ' + a;
        var overBHtml = 'No data available for line ' + b;

        var metricsEntryA = getMetricsEntry(a, 'line1');
        if (metricsEntryA) {
            var valueA = metricsEntryA[metricKey];
            if (valueA !== undefined && valueA !== null && !isNaN(valueA)) {
                overValueA = Number(valueA);
                overAHtml = generateOvercrowdBarIndicator(overValueA, overType);
            } else {
                overAHtml = 'No data available';
            }
        }

        var metricsEntryB = getMetricsEntry(b, 'line2');
        if (metricsEntryB) {
            var valueB = metricsEntryB[metricKey];
            if (valueB !== undefined && valueB !== null && !isNaN(valueB)) {
                overValueB = Number(valueB);
                overBHtml = generateOvercrowdBarIndicator(overValueB, overType);
            } else {
                overBHtml = 'No data available';
            }
        }

        var comparisonText = '';
        if (overValueA !== null && overValueB !== null) {
            var leftVal = Number(overValueA);
            var rightVal = Number(overValueB);
            var metricLabel = title.toLowerCase();
            if (leftVal === rightVal) {
                comparisonText = aLabel + ' and ' + bLabel + ' have equal ' + metricLabel;
            } else if (leftVal > rightVal) {
                var ratio = leftVal / rightVal;
                if (ratio > 2) {
                    comparisonText = aLabel + ' has ' + formatSig(ratio) + 'x higher ' + metricLabel + ' than ' + bLabel;
                } else {
                    var pct = (leftVal - rightVal) / rightVal * 100;
                    comparisonText = aLabel + ' has ' + formatSig(pct) + '% higher ' + metricLabel + ' than ' + bLabel;
                }
            } else {
                var pct = (rightVal - leftVal) / rightVal * 100;
                comparisonText = aLabel + ' has ' + formatSig(pct) + '% lower ' + metricLabel + ' than ' + bLabel;
            }
        }

        var html = '<div class="half left">' + aLabel +
            '<div class="stats-box">' + overAHtml + '</div>' +
            '</div>' +
            '<div class="half right">' + bLabel +
            '<div class="stats-box">' + overBHtml + '</div>' +
            '</div>' +
            '<div class="vs-badge">VS</div>' +
            '<div class="divider-line"></div>' +
            '<div class="annual-boardings-badge">' + title + buildInfoIcon(definitionText) + '</div>' +
            (comparisonText ? '<div class="comparison-badge">' + comparisonText + '</div>' : '');

        document.getElementById('overcrowd-display').innerHTML = html;
    }

    function updateOntimeDisplay(a, b, ontimeType) {
        const aLabel = getSideLabel(a, 'line1');
        const bLabel = getSideLabel(b, 'line2');
        var title = (ontimeType === 'bunching_pct') ? '% Bus Bunching' : '% On Time Performance';
        var metricKey = (ontimeType === 'bunching_pct') ? 'bus_bunching_percentage' : 'on_time_performance';

        var ontimeValueA = null;
        var ontimeValueB = null;

        var ontimeAHtml = 'No data available for line ' + a;
        var ontimeBHtml = 'No data available for line ' + b;

        var metricsEntryA = getMetricsEntry(a, 'line1');
        if (metricsEntryA) {
            var valueA = metricsEntryA[metricKey];
            if (valueA !== undefined && valueA !== null && !isNaN(valueA)) {
                ontimeValueA = Number(valueA);
                ontimeAHtml = ontimeType === 'bunching_pct'
                    ? generateBunchingBarIndicator(ontimeValueA)
                    : generateOtpPieIndicator(ontimeValueA);
            } else {
                ontimeAHtml = 'No data available';
            }
        }

        var metricsEntryB = getMetricsEntry(b, 'line2');
        if (metricsEntryB) {
            var valueB = metricsEntryB[metricKey];
            if (valueB !== undefined && valueB !== null && !isNaN(valueB)) {
                ontimeValueB = Number(valueB);
                ontimeBHtml = ontimeType === 'bunching_pct'
                    ? generateBunchingBarIndicator(ontimeValueB)
                    : generateOtpPieIndicator(ontimeValueB);
            } else {
                ontimeBHtml = 'No data available';
            }
        }

        var comparisonText = '';
        if (ontimeValueA !== null && ontimeValueB !== null) {
            var leftVal = Number(ontimeValueA);
            var rightVal = Number(ontimeValueB);
            var metricLabel = title.toLowerCase();
            if (leftVal === rightVal) {
                comparisonText = aLabel + ' and ' + bLabel + ' have equal ' + metricLabel;
            } else if (leftVal > rightVal) {
                var ratio = leftVal / rightVal;
                if (ratio > 2) {
                    comparisonText = aLabel + ' has ' + formatSig(ratio) + 'x higher ' + metricLabel + ' than ' + bLabel;
                } else {
                    var pct = (leftVal - rightVal) / rightVal * 100;
                    comparisonText = aLabel + ' has ' + formatSig(pct) + '% higher ' + metricLabel + ' than ' + bLabel;
                }
            } else {
                var pct = (rightVal - leftVal) / rightVal * 100;
                comparisonText = aLabel + ' has ' + formatSig(pct) + '% lower ' + metricLabel + ' than ' + bLabel;
            }
        }

        var html = '<div class="half left">' + aLabel +
            '<div class="stats-box">' + ontimeAHtml + '</div>' +
            '</div>' +
            '<div class="half right">' + bLabel +
            '<div class="stats-box">' + ontimeBHtml + '</div>' +
            '</div>' +
            '<div class="vs-badge">VS</div>' +
            '<div class="divider-line"></div>' +
            '<div class="annual-boardings-badge">' + title + '</div>' +
            (comparisonText ? '<div class="comparison-badge">' + comparisonText + '</div>' : '');

        document.getElementById('ontime-display').innerHTML = html;
    }

function updateAvgSpeedDisplay(a, b, speedUnit) {
    const aLabel = getSideLabel(a, 'line1');
    const bLabel = getSideLabel(b, 'line2');
    var unitLabel = (speedUnit === 'mph') ? 'MPH' : 'KPH';

    var speedValueA = null;
    var speedValueB = null;

    var speedAHtml = 'No data available for line ' + a;
    var speedBHtml = 'No data available for line ' + b;

    var metricsEntryA = getMetricsEntry(a, 'line1');
    if (metricsEntryA) {
        var valueA = metricsEntryA['avg_speed_kph'];
        if (valueA !== undefined && valueA !== null && !isNaN(valueA)) {
            speedValueA = Number(valueA);
            if (speedUnit === 'mph') {
                speedValueA = speedValueA * 0.621371;
            }
            speedAHtml = generateSpeedometer(speedValueA, speedUnit);
        } else {
            speedAHtml = 'No data available';
        }
    }

    var metricsEntryB = getMetricsEntry(b, 'line2');
    if (metricsEntryB) {
        var valueB = metricsEntryB['avg_speed_kph'];
        if (valueB !== undefined && valueB !== null && !isNaN(valueB)) {
            speedValueB = Number(valueB);
            if (speedUnit === 'mph') {
                speedValueB = speedValueB * 0.621371;
            }
            speedBHtml = generateSpeedometer(speedValueB, speedUnit);
        } else {
            speedBHtml = 'No data available';
        }
    }

    var timeComparisonText = '';
    if (speedValueA !== null && speedValueB !== null) {
        var leftVal = Number(speedValueA);
        var rightVal = Number(speedValueB);
        timeComparisonText = buildSpeedTimeComparisonText(aLabel, leftVal, bLabel, rightVal);
    }

    var html = '<div class="half left">' + aLabel +
        '<div class="stats-box">' + speedAHtml + '</div>' +
        '</div>' +
        '<div class="half right">' + bLabel +
        '<div class="stats-box">' + speedBHtml + '</div>' +
        '</div>' +
        '<div class="vs-badge">VS</div>' +
        '<div class="divider-line"></div>' +
        '<div class="annual-boardings-badge">Avg Speed (' + unitLabel + ')</div>' +
        (timeComparisonText ? '<div class="comparison-badge">' + timeComparisonText + '</div>' : '');

    document.getElementById('avgspeed-display').innerHTML = html;
}

// Swap button: swap selected values of the two dropdowns and re-run comparison
document.getElementById('swapBtn').addEventListener('click', function () {
    const s1 = document.getElementById('line1');
    const s2 = document.getElementById('line2');
    if (!s1 || !s2) return;
    const v1 = s1.value;
    const v2 = s2.value;

    const y1 = selectedYearLine1;
    const y2 = selectedYearLine2;
    selectedYearLine1 = y2;
    selectedYearLine2 = y1;
    setYearButtonState('line1', selectedYearLine1);
    setYearButtonState('line2', selectedYearLine2);

    Promise.all([
        loadLineOptionsForSide('line1', selectedYearLine1, v2),
        loadLineOptionsForSide('line2', selectedYearLine2, v1),
        ensureYearLoaded(selectedYearLine1),
        ensureYearLoaded(selectedYearLine2)
    ]).then(function() {
        const compareBtn = document.getElementById('compareBtn');
        if (compareBtn) compareBtn.click();
    });
});
// Daily boardings selector button group logic
document.addEventListener('click', function(e) {
    if (e.target.classList.contains('year-btn')) {
        var side = e.target.getAttribute('data-side');
        var yearRaw = e.target.getAttribute('data-year');
        var selectedYear = Number(yearRaw);
        if (!Number.isFinite(selectedYear) || !side) return;

        if (side === 'line1') {
            selectedYearLine1 = selectedYear;
        } else if (side === 'line2') {
            selectedYearLine2 = selectedYear;
        } else {
            return;
        }

        setYearButtonState(side, selectedYear);
        document.getElementById('compareResult').innerHTML = '<div style="padding:16px;">Loading ' + selectedYear + ' data...</div>';

        const targetSelect = side === 'line1' ? document.getElementById('line1') : document.getElementById('line2');
        const preserveValue = targetSelect ? targetSelect.value : '';

        Promise.all([
            loadLineOptionsForSide(side, selectedYear, preserveValue),
            ensureYearLoaded(selectedYear)
        ]).then(function() {
            const compareBtn = document.getElementById('compareBtn');
            if (compareBtn) compareBtn.click();
        });

        return;
    }

    if (e.target.classList.contains('daily-btn')) {
        document.querySelectorAll('.daily-btn').forEach(btn => btn.classList.remove('daily-btn-active'));
        e.target.classList.add('daily-btn-active');
        
        // Determine which day type was selected and update display
        let dayType = 'weekday';
        if (e.target.id === 'btn-daily-sat') {
            dayType = 'saturday';
        } else if (e.target.id === 'btn-daily-sun') {
            dayType = 'sunday';
        }
        
        // Update the display with the current stored lines
        updateDailyBoardingsDisplay(currentLineA, currentLineB, dayType);
    }
    
    // Hours selector button group logic
    if (e.target.classList.contains('hours-btn')) {
        document.querySelectorAll('.hours-btn').forEach(btn => btn.classList.remove('hours-btn-active'));
        e.target.classList.add('hours-btn-active');
        
        // Determine which hours type was selected and update display
        let hoursType = 'revenue';
        if (e.target.id === 'btn-hours-service') {
            hoursType = 'service';
        }
        
        // Update the display with the current stored lines
        updateHoursDisplay(currentLineA, currentLineB, hoursType);
    }

    // Metrics selector button group logic
    if (e.target.classList.contains('metrics-btn')) {
        document.querySelectorAll('.metrics-btn').forEach(btn => btn.classList.remove('metrics-btn-active'));
        e.target.classList.add('metrics-btn-active');
        
        // Determine which metric type was selected and update display
        let metricType = 'boardings_per_revenue_hour';
        if (e.target.id === 'btn-metrics-ppl') {
            metricType = 'peak_passenger_load';
        }
        
        // Update the display with the current stored lines
        updateMetricsDisplay(currentLineA, currentLineB, metricType);
    }

    // Peak load selector logic
    if (e.target.classList.contains('peak-btn')) {
        document.querySelectorAll('.peak-btn').forEach(btn => btn.classList.remove('section-btn-active'));
        e.target.classList.add('section-btn-active');
        let peakType = (e.target.id === 'btn-peak-cap') ? 'peak_cap' : 'peak_plf';
        updatePeakDisplay(currentLineA, currentLineB, peakType);
    }

    // Overcrowding selector logic
    if (e.target.classList.contains('overcrowd-btn')) {
        document.querySelectorAll('.overcrowd-btn').forEach(btn => btn.classList.remove('section-btn-active'));
        e.target.classList.add('section-btn-active');
        let overType = (e.target.id === 'btn-over-pct') ? 'over_pct' : 'over_hrs';
        updateOvercrowdDisplay(currentLineA, currentLineB, overType);
    }

    // On-time / bunching selector logic
    if (e.target.classList.contains('ontime-btn')) {
        document.querySelectorAll('.ontime-btn').forEach(btn => btn.classList.remove('section-btn-active'));
        e.target.classList.add('section-btn-active');
        let ontimeType = (e.target.id === 'btn-bunching-pct') ? 'bunching_pct' : 'ontime_pct';
        updateOntimeDisplay(currentLineA, currentLineB, ontimeType);
    }

    // Avg speed / unit selector logic
    if (e.target.classList.contains('speed-btn')) {
        document.querySelectorAll('.speed-btn').forEach(btn => btn.classList.remove('section-btn-active'));
        e.target.classList.add('section-btn-active');
        let speedUnit = (e.target.id === 'btn-speed-mph') ? 'mph' : 'kph';
        updateAvgSpeedDisplay(currentLineA, currentLineB, speedUnit);
    }
});
