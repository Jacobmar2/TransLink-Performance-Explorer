const distanceButtons = document.querySelectorAll('#distanceButtons .daily-btn');
const hoursInput = document.getElementById('hoursInput');
const minsInput = document.getElementById('minsInput');
const secsInput = document.getElementById('secsInput');
const searchBtn = document.getElementById('searchBtn');
const resultsStatus = document.getElementById('resultsStatus');
const resultsTableBody = document.getElementById('resultsTableBody');
const timeColumnHeader = document.getElementById('timeColumnHeader');

let selectedDistanceMeters = 100;
let selectedDistanceLabel = '100m';
let busLineRows = [];
let comparisonReady = false;

function setActiveDistance(button) {
    distanceButtons.forEach(otherButton => otherButton.classList.remove('daily-btn-active'));
    button.classList.add('daily-btn-active');
    selectedDistanceMeters = Number(button.dataset.distanceMeters);
    selectedDistanceLabel = button.dataset.distanceLabel || button.textContent.trim();
    timeColumnHeader.textContent = 'Time for ' + selectedDistanceLabel;
    if (comparisonReady) {
        runSearch();
    }
}

function getSelectedDistanceKm() {
    return selectedDistanceMeters / 1000;
}

function getTimeSeconds() {
    const hours = Number(hoursInput.value || 0);
    const mins = Number(minsInput.value || 0);
    const secs = Number(secsInput.value || 0);

    if (!Number.isFinite(hours) || !Number.isFinite(mins) || !Number.isFinite(secs)) {
        return null;
    }

    const totalSeconds = (hours * 3600) + (mins * 60) + secs;
    return totalSeconds > 0 ? totalSeconds : null;
}

function formatNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return '-';
    }
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return '-';
    }

    const rounded = Math.round(seconds);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const secs = rounded % 60;
    const paddedMinutes = String(minutes).padStart(2, '0');
    const paddedSeconds = String(secs).padStart(2, '0');

    return hours + ':' + paddedMinutes + ':' + paddedSeconds;
}

function formatPaceLabel(minutesPerKilometer) {
    if (!Number.isFinite(minutesPerKilometer) || minutesPerKilometer <= 0) {
        return '-';
    }

    const totalSeconds = Math.round(minutesPerKilometer * 60);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes + ':' + String(seconds).padStart(2, '0') + ' /km';
}

function renderRows(rows) {
    if (!rows.length) {
        resultsTableBody.innerHTML = '<tr><td colspan="3">No matching bus lines found.</td></tr>';
        return;
    }

    resultsTableBody.innerHTML = rows.map(row => {
        return '<tr>' +
            '<td>' + row.name + '</td>' +
            '<td>' + formatNumber(row.speedKph) + ' kph</td>' +
            '<td>' + formatDuration(row.timeSeconds) + '</td>' +
        '</tr>';
    }).join('');
}

function runSearch() {
    const userSeconds = getTimeSeconds();
    if (!userSeconds) {
        comparisonReady = false;
        resultsStatus.textContent = 'Enter a finish time with at least one non-zero field.';
        resultsTableBody.innerHTML = '<tr><td colspan="3">No results yet. Select a distance and enter your time.</td></tr>';
        return;
    }

    const distanceKm = getSelectedDistanceKm();
    const userSpeedKph = (distanceKm / userSeconds) * 3600;

    const rows = busLineRows
        .filter(row => Number.isFinite(row.speedKph) && row.speedKph < userSpeedKph)
        .map(row => ({
            name: row.name,
            speedKph: row.speedKph,
            timeSeconds: (distanceKm / row.speedKph) * 3600
        }))
        .sort((a, b) => b.speedKph - a.speedKph || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    const paceMinutesPerKm = (userSeconds / 60) / distanceKm;
    resultsStatus.textContent = 'You are faster than ' + rows.length + ' bus line' + (rows.length === 1 ? '' : 's') + ' over ' + selectedDistanceLabel + '. Your pace is ' + formatPaceLabel(paceMinutesPerKm) + '.';
    renderRows(rows);
    comparisonReady = true;
}

function loadData() {
    Promise.all([
        fetch('/api/bus-line-options?year=2024'),
        fetch('/api/metrics-data?year=2024')
    ])
        .then(async responses => {
            if (!responses[0].ok || !responses[1].ok) {
                throw new Error('Unable to load 2024 bus line data');
            }

            const options = await responses[0].json();
            const metrics = await responses[1].json();

            const metricsByLine = metrics || {};
            busLineRows = options
                .map(option => {
                    const metricRow = metricsByLine[option.value] || {};
                    const speedKph = Number(metricRow.avg_speed_kph);
                    return {
                        name: option.label,
                        speedKph: Number.isFinite(speedKph) ? speedKph : null
                    };
                })
                .filter(row => Number.isFinite(row.speedKph));

            resultsStatus.textContent = 'Loaded ' + busLineRows.length + ' bus lines. Enter your time and click Search.';
        })
        .catch(() => {
            resultsStatus.textContent = 'Could not load bus line data.';
            resultsTableBody.innerHTML = '<tr><td colspan="3">Failed to load data.</td></tr>';
            searchBtn.disabled = true;
        });
}

distanceButtons.forEach(button => {
    button.addEventListener('click', () => setActiveDistance(button));
});

[hoursInput, minsInput, secsInput].forEach(input => {
    input.addEventListener('input', () => {
        if (comparisonReady) {
            runSearch();
        }
    });
});

searchBtn.addEventListener('click', runSearch);

setActiveDistance(document.querySelector('#distanceButtons .daily-btn.daily-btn-active'));
loadData();