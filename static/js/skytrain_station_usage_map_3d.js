(async function initializeSkyTrainStationUsageMap() {
    const apiUrl = "/api/skytrain-station-usage-map-3d-data?refresh=1";
    const hourlyApiUrl = "/api/station-hourly-data?year=2024";

    window.__skytrainBarsRendered = false;

    const totalMetricConfig = {
        annual: {
            label: "Annual Boardings Intensity",
            valueKey: "annual_boardings",
            tooltipLabel: "Annual boardings",
            heightFactor: 1.0,
            defaultSliderPercent: 50,
            colorLow: [70, 144, 255],
            colorHigh: [180, 230, 255]
        },
        weekday: {
            label: "Weekday Daily Boardings Intensity",
            valueKey: "weekday",
            tooltipLabel: "Weekday daily boardings",
            heightFactor: 0.78,
            defaultSliderPercent: 50,
            colorLow: [32, 186, 255],
            colorHigh: [141, 233, 255]
        },
        saturday: {
            label: "Saturday Daily Boardings Intensity",
            valueKey: "saturday",
            tooltipLabel: "Saturday daily boardings",
            heightFactor: 0.63,
            defaultSliderPercent: 50,
            colorLow: [83, 156, 255],
            colorHigh: [155, 205, 255]
        },
        sunday: {
            label: "Sunday/Holiday Daily Boardings Intensity",
            valueKey: "sunday",
            tooltipLabel: "Sunday/Holiday daily boardings",
            heightFactor: 0.54,
            defaultSliderPercent: 50,
            colorLow: [125, 147, 255],
            colorHigh: [186, 202, 255]
        }
    };

    const hourlyDayTypeConfig = {
        weekday: { label: "MF", apiKey: "weekday" },
        saturday: { label: "Sat", apiKey: "saturday" },
        sunday: { label: "SunHol", apiKey: "sunday" }
    };

    const hourlyUsageConfig = {
        boardings: {
            label: "Boardings",
            tooltipLabel: "Hourly boardings",
            heightFactor: 0.78,
            colorLow: [55, 175, 255],
            colorHigh: [175, 234, 255]
        },
        alightings: {
            label: "Alightings",
            tooltipLabel: "Hourly alightings",
            heightFactor: 0.78,
            colorLow: [52, 220, 206],
            colorHigh: [176, 252, 238]
        },
        total: {
            label: "Total Usage",
            tooltipLabel: "Hourly total usage",
            heightFactor: 0.86,
            colorLow: [101, 165, 255],
            colorHigh: [212, 237, 255]
        },
        total_split: {
            label: "Total Usage (Split)",
            tooltipLabel: "Hourly total usage (split)",
            heightFactor: 0.86,
            referenceKey: "total",
            splitStacked: true,
            colorLow: [101, 165, 255],
            colorHigh: [212, 237, 255]
        }
    };

    const metricButtons = Array.from(document.querySelectorAll(".metric-button"));
    const modeButtons = Array.from(document.querySelectorAll(".mode-button"));
    const hourlyDayTypeButtons = Array.from(document.querySelectorAll("[data-hourly-daytype]"));
    const hourlyUsageButtons = Array.from(document.querySelectorAll("[data-hourly-usage]"));
    const hourlyTimeModeButtons = Array.from(document.querySelectorAll("[data-hourly-time-mode]"));
    const hourlyPlayToggle = document.getElementById("hourly-play-toggle");
    const playbackSpeedButtons = Array.from(document.querySelectorAll("[data-playback-speed]"));
    const loopModeButtons = Array.from(document.querySelectorAll("[data-loop-mode]"));

    const legendTitle = document.querySelector(".legend-title");
    const heightSlider = document.getElementById("height-scale-slider");
    const heightSliderValue = document.getElementById("height-slider-value");
    const controlPanel = document.getElementById("control-panel");
    const hourlyStrip = document.getElementById("hourly-strip");
    const hourlyTimeModeRow = document.getElementById("hourly-time-mode-row");
    const hourlyTimeSlider = document.getElementById("hourly-time-slider");
    const hourlyPrevHourButton = document.getElementById("hourly-prev-hour");
    const hourlyNextHourButton = document.getElementById("hourly-next-hour");
    const hourlyTimeLabel = document.getElementById("hourly-time-label");
    const hourlyTimeDisplay = document.getElementById("hourly-time-display");

    let activeMode = "total";
    let activeTotalMetric = "annual";
    let activeHourlyDayType = "weekday";
    let activeHourlyUsage = "boardings";
    let activeHourlyTimeMode = "none";
    let activeHourlySliderIndex = 0;
    let hourlyPlaybackTimerId = null;
    let hourlyPlaybackSpeed = 1;
    let hourlyPlaybackLoopMode = "same-day-type";
    let hourlyPlaybackActive = false;
    let needsBarsReveal = true;

    let stations = [];
    let hourlyStationsByName = new Map();
    let hourlyReferenceMaxByDayTypeUsage = new Map();
    let overlay = null;
    let map = null;
    let tooltip = null;
    let currentRenderData = [];
    let animationFrameId = null;
    let hasInitializedOverlay = false;
    let mapReady = false;
    let dataReady = false;
    let revealRetryTimerId = null;
    let revealRetryCount = 0;
    const maxRevealRetries = 6;

    const normalizeStationName = (value) => {
        return String(value || "")
            .replace(/[\u2013\u2014\u2212]/g, "-")
            .replace(/\s+/g, " ")
            .trim();
    };

    const toNumber = (value) => {
        const numericValue = Number(value);
        return Number.isFinite(numericValue) ? numericValue : 0;
    };

    const formatBoardings = (value) => {
        return new Intl.NumberFormat("en-CA", {
            maximumFractionDigits: 0
        }).format(value);
    };

    const formatHourRange = (startHour24) => {
        const endHour24 = (startHour24 + 1) % 24;

        const formatHour = (hour24) => {
            const suffix = hour24 >= 12 ? "PM" : "AM";
            const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
            return `${hour12}:00 ${suffix}`;
        };

        return `${formatHour(startHour24)} - ${formatHour(endHour24)}`;
    };

    const formatDigitalHour = (hour24) => {
        const suffix = hour24 >= 12 ? "PM" : "AM";
        const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
        return `${hour12}:00 ${suffix}`;
    };

    const sliderIndexToHour = (index) => {
        return (index + 4) % 24;
    };

    const getSliderPercent = () => {
        if (!heightSlider) {
            return 100;
        }

        const parsed = toNumber(heightSlider.value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return 100;
        }

        return Math.max(15, Math.min(300, parsed));
    };

    const getHeightScaleMultiplier = () => {
        const scalePercent = getSliderPercent();

        // Keep low-end scale compressed: at 15%, bars are below one-third of 100% height.
        if (scalePercent <= 100) {
            const t = (scalePercent - 15) / 85;
            return 0.3 + Math.max(0, Math.min(1, t)) * 0.95;
        }

        // Beyond 100% ramp up sharply toward 300%.
        const over = (scalePercent - 100) / 200;
        return 1.25 + Math.pow(over, 2.1) * 3.75;
    };

    const updateSliderLabel = () => {
        if (heightSliderValue) {
            heightSliderValue.textContent = `${Math.round(getSliderPercent())}%`;
        }
    };

    const updateHourlyTimeLabel = () => {
        if (!hourlyTimeLabel) {
            return;
        }
        const hour = sliderIndexToHour(activeHourlySliderIndex);
        hourlyTimeLabel.textContent = formatHourRange(hour);

        if (!hourlyTimeDisplay) {
            return;
        }

        const shouldShowTime = activeMode === "hourly" && activeHourlyTimeMode === "show";
        hourlyTimeDisplay.classList.toggle("is-visible", shouldShowTime);

        if (!shouldShowTime) {
            hourlyTimeDisplay.textContent = "";
            return;
        }

        hourlyTimeDisplay.textContent = formatDigitalHour(hour);
    };

    const getHourlyReferenceMax = (dayTypeKey, usageKey) => {
        return hourlyReferenceMaxByDayTypeUsage.get(`${dayTypeKey}:${usageKey}`) || 1;
    };

    const getDayTypeKeys = () => Object.keys(hourlyDayTypeConfig);

    const getNextDayTypeKey = (dayTypeKey) => {
        const dayTypeKeys = getDayTypeKeys();
        const currentIndex = dayTypeKeys.indexOf(dayTypeKey);
        if (currentIndex < 0) {
            return dayTypeKeys[0] || "weekday";
        }
        return dayTypeKeys[(currentIndex + 1) % dayTypeKeys.length];
    };

    const clearHourlyPlaybackTimer = () => {
        if (hourlyPlaybackTimerId !== null) {
            window.clearTimeout(hourlyPlaybackTimerId);
            hourlyPlaybackTimerId = null;
        }
    };

    const updatePlaybackUI = () => {
        if (hourlyPlayToggle) {
            hourlyPlayToggle.textContent = hourlyPlaybackActive ? "Pause" : "Play";
            hourlyPlayToggle.setAttribute("aria-pressed", hourlyPlaybackActive ? "true" : "false");
            hourlyPlayToggle.classList.toggle("is-active", hourlyPlaybackActive);
        }

        playbackSpeedButtons.forEach((button) => {
            button.classList.toggle("is-active", Number(button.dataset.playbackSpeed) === hourlyPlaybackSpeed);
        });

        loopModeButtons.forEach((button) => {
            button.classList.toggle("is-active", button.dataset.loopMode === hourlyPlaybackLoopMode);
        });
    };

    const setHourlyPlaybackSpeed = (speed) => {
        hourlyPlaybackSpeed = speed;
        updatePlaybackUI();

        if (hourlyPlaybackActive) {
            clearHourlyPlaybackTimer();
            scheduleHourlyPlaybackTick();
        }
    };

    const setHourlyPlaybackLoopMode = (loopMode) => {
        hourlyPlaybackLoopMode = loopMode;
        updatePlaybackUI();
    };

    const advanceHourlyPlaybackStep = () => {
        const nextIndex = activeHourlySliderIndex + 1;
        if (nextIndex <= 23) {
            activeHourlySliderIndex = nextIndex;
            if (hourlyTimeSlider) {
                hourlyTimeSlider.value = String(activeHourlySliderIndex);
            }
            renderCurrentView();
            return;
        }

        activeHourlySliderIndex = 0;

        if (hourlyPlaybackLoopMode === "shift-day-types") {
            activeHourlyDayType = getNextDayTypeKey(activeHourlyDayType);
        }

        if (hourlyTimeSlider) {
            hourlyTimeSlider.value = "0";
        }

        renderCurrentView();
    };

    const scheduleHourlyPlaybackTick = () => {
        clearHourlyPlaybackTimer();

        const intervalMs = Math.max(140, Math.round(225 / Math.max(0.25, hourlyPlaybackSpeed)));
        hourlyPlaybackTimerId = window.setTimeout(() => {
            if (!hourlyPlaybackActive) {
                return;
            }

            advanceHourlyPlaybackStep();
            scheduleHourlyPlaybackTick();
        }, intervalMs);
    };

    const startHourlyPlayback = () => {
        if (hourlyPlaybackActive) {
            return;
        }

        hourlyPlaybackActive = true;
        updatePlaybackUI();
        scheduleHourlyPlaybackTick();
    };

    const stopHourlyPlayback = () => {
        hourlyPlaybackActive = false;
        clearHourlyPlaybackTimer();
        updatePlaybackUI();
    };

    const toggleHourlyPlayback = () => {
        if (hourlyPlaybackActive) {
            stopHourlyPlayback();
            return;
        }

        startHourlyPlayback();
    };

    const stepHourlySliderBy = (delta) => {
        activeMode = "hourly";
        activeHourlySliderIndex = (activeHourlySliderIndex + delta + 24) % 24;

        if (hourlyTimeSlider) {
            hourlyTimeSlider.value = String(activeHourlySliderIndex);
        }

        if (hourlyPlaybackActive) {
            stopHourlyPlayback();
        }

        renderCurrentView();
    };

    const getCurrentProfile = () => {
        if (activeMode === "total") {
            const cfg = totalMetricConfig[activeTotalMetric];
            return {
                label: cfg.label,
                tooltipLabel: cfg.tooltipLabel,
                heightFactor: cfg.heightFactor,
                colorLow: cfg.colorLow,
                colorHigh: cfg.colorHigh,
                splitStacked: false,
                maxValue: null,
                getValue: (station) => toNumber(station[cfg.valueKey])
            };
        }

        const dayCfg = hourlyDayTypeConfig[activeHourlyDayType];
        const usageCfg = hourlyUsageConfig[activeHourlyUsage];
        const selectedHour = sliderIndexToHour(activeHourlySliderIndex);

        return {
            label: `Hourly ${usageCfg.label} Intensity (${dayCfg.label}, ${formatHourRange(selectedHour)})`,
            tooltipLabel: `${usageCfg.tooltipLabel} (${dayCfg.label}, ${formatHourRange(selectedHour)})`,
            heightFactor: usageCfg.heightFactor,
            colorLow: usageCfg.colorLow,
            colorHigh: usageCfg.colorHigh,
            splitStacked: Boolean(usageCfg.splitStacked),
            dayApiKey: dayCfg.apiKey,
            selectedHour,
            maxValue: getHourlyReferenceMax(dayCfg.apiKey, usageCfg.referenceKey || activeHourlyUsage),
            getValue: (station) => {
                const stationHourly = station.__hourly || {};
                const daySeries = stationHourly[dayCfg.apiKey] || {};
                const boardings = toNumber(daySeries.boardings && daySeries.boardings[selectedHour]);
                const alightings = toNumber(daySeries.alightings && daySeries.alightings[selectedHour]);

                if (activeHourlyUsage === "boardings") {
                    return boardings;
                }
                if (activeHourlyUsage === "alightings") {
                    return alightings;
                }
                return boardings + alightings;
            }
        };
    };

    const updateLegend = (title, minValue, maxValue) => {
        if (legendTitle) {
            legendTitle.textContent = title;
        }

        const legendLabels = document.querySelectorAll(".legend-labels span");
        if (legendLabels.length === 2) {
            legendLabels[0].textContent = formatBoardings(minValue);
            legendLabels[1].textContent = formatBoardings(maxValue);
        }
    };

    const updateActiveButtons = () => {
        metricButtons.forEach((button) => {
            button.classList.toggle("is-active", button.dataset.metric === activeTotalMetric);
        });

        modeButtons.forEach((button) => {
            button.classList.toggle("is-active", button.dataset.mode === activeMode);
        });

        hourlyDayTypeButtons.forEach((button) => {
            button.classList.toggle("is-active", button.dataset.hourlyDaytype === activeHourlyDayType);
        });

        hourlyUsageButtons.forEach((button) => {
            button.classList.toggle("is-active", button.dataset.hourlyUsage === activeHourlyUsage);
        });

        hourlyTimeModeButtons.forEach((button) => {
            button.classList.toggle("is-active", button.dataset.hourlyTimeMode === activeHourlyTimeMode);
        });
    };

    const syncModeUIState = () => {
        if (controlPanel) {
            controlPanel.classList.toggle("mode-hourly", activeMode === "hourly");
        }
        if (hourlyStrip) {
            hourlyStrip.style.display = activeMode === "hourly" ? "flex" : "none";
        }
        if (hourlyTimeModeRow) {
            hourlyTimeModeRow.classList.toggle("is-visible", activeMode === "hourly");
        }
        if (activeMode !== "hourly") {
            stopHourlyPlayback();
        }
        updateHourlyTimeLabel();
        updateSliderLabel();
        updateActiveButtons();
        updatePlaybackUI();
    };

    const toColor = (value, maxValue, colorLow, colorHigh) => {
        if (value <= 0 || maxValue <= 0) {
            return [128, 128, 128, 190];
        }

        const ratio = Math.max(0, Math.min(1, value / maxValue));
        const red = Math.round(colorLow[0] + (colorHigh[0] - colorLow[0]) * ratio);
        const green = Math.round(colorLow[1] + (colorHigh[1] - colorLow[1]) * ratio);
        const blue = Math.round(colorLow[2] + (colorHigh[2] - colorLow[2]) * ratio);
        const alpha = Math.round(175 + ratio * 70);
        return [red, green, blue, alpha];
    };

    const getHeightMeters = (value, maxValue, heightFactor, includeBase = true) => {
        if (maxValue <= 0) {
            return includeBase ? 120 : 0;
        }
        const ratio = Math.max(0, Math.min(1, value / maxValue));
        const scaleMultiplier = getHeightScaleMultiplier();
        const modeMultiplier = activeMode === "hourly" ? 2 : 1;
        const scaledHeight = ratio * 3600 * heightFactor * scaleMultiplier * modeMultiplier;
        return (includeBase ? 90 : 0) + scaledHeight;
    };

    const buildLayers = (renderData) => {
        const splitModeActive = activeMode === "hourly" && activeHourlyUsage === "total_split";

        if (!splitModeActive) {
            return [new deck.ColumnLayer({
                id: "skytrain-usage-columns",
                data: renderData,
                diskResolution: 20,
                radius: 230,
                extruded: true,
                pickable: true,
                opacity: 0.95,
                getPosition: (d) => [Number(d.lon), Number(d.lat)],
                getElevation: (d) => d.__elevation,
                getFillColor: (d) => d.__fillColor,
                getLineColor: [171, 212, 255, 255],
                lineWidthMinPixels: 1,
                material: {
                    ambient: 0.48,
                    diffuse: 0.56,
                    shininess: 96,
                    specularColor: [160, 210, 255]
                }
            })];
        }

        return [
            new deck.ColumnLayer({
                id: "skytrain-usage-columns-boardings",
                data: renderData,
                diskResolution: 20,
                radius: 230,
                extruded: true,
                pickable: true,
                opacity: 0.96,
                getPosition: (d) => [Number(d.lon), Number(d.lat), 0],
                getElevation: (d) => d.__boardingElevation,
                getFillColor: (d) => d.__boardingFillColor,
                getLineColor: [171, 212, 255, 255],
                lineWidthMinPixels: 1,
                material: {
                    ambient: 0.48,
                    diffuse: 0.56,
                    shininess: 96,
                    specularColor: [160, 210, 255]
                }
            }),
            new deck.ColumnLayer({
                id: "skytrain-usage-columns-alightings",
                data: renderData,
                diskResolution: 20,
                radius: 230,
                extruded: true,
                pickable: true,
                opacity: 0.96,
                getPosition: (d) => [Number(d.lon), Number(d.lat), d.__boardingElevation],
                getElevation: (d) => d.__alightingElevation,
                getFillColor: (d) => d.__alightingFillColor,
                getLineColor: [171, 212, 255, 255],
                lineWidthMinPixels: 1,
                material: {
                    ambient: 0.48,
                    diffuse: 0.56,
                    shininess: 96,
                    specularColor: [160, 210, 255]
                }
            })
        ];
    };

    const lerp = (startValue, endValue, t) => startValue + (endValue - startValue) * t;

    const lerpColor = (startColor, endColor, t) => {
        return [
            Math.round(lerp(startColor[0], endColor[0], t)),
            Math.round(lerp(startColor[1], endColor[1], t)),
            Math.round(lerp(startColor[2], endColor[2], t)),
            Math.round(lerp(startColor[3], endColor[3], t))
        ];
    };

    const renderCurrentView = (forceImmediate = false) => {
        if (!overlay || !map || !stations.length) {
            return;
        }

        const profile = getCurrentProfile();

        const maxValue = profile.maxValue != null
            ? profile.maxValue
            : stations.reduce((maxValueSoFar, station) => {
                return Math.max(maxValueSoFar, profile.getValue(station));
            }, 0);

        const minValue = stations.reduce((minValueSoFar, station) => {
            return Math.min(minValueSoFar, profile.getValue(station));
        }, Number.POSITIVE_INFINITY);

        const effectiveMax = maxValue > 0 ? maxValue : 1;
        const effectiveMin = Number.isFinite(minValue) ? minValue : 0;

        const targetRenderData = stations.map((station) => {
            const value = profile.getValue(station);
            const ratio = effectiveMax > 0 ? Math.max(0, Math.min(1, value / effectiveMax)) : 0;

            let boardingsHourlyValue = 0;
            let alightingsHourlyValue = 0;

            if (profile.splitStacked && profile.dayApiKey != null && profile.selectedHour != null) {
                const stationHourly = station.__hourly || {};
                const daySeries = stationHourly[profile.dayApiKey] || {};
                boardingsHourlyValue = toNumber(daySeries.boardings && daySeries.boardings[profile.selectedHour]);
                alightingsHourlyValue = toNumber(daySeries.alightings && daySeries.alightings[profile.selectedHour]);
            }

            return {
                ...station,
                __metricValue: value,
                __ratio: ratio,
                __tooltipLabel: profile.tooltipLabel,
                __elevation: getHeightMeters(value, effectiveMax, profile.heightFactor),
                __fillColor: toColor(value, effectiveMax, profile.colorLow, profile.colorHigh),
                __boardingElevation: getHeightMeters(boardingsHourlyValue, effectiveMax, profile.heightFactor, false),
                __alightingElevation: getHeightMeters(alightingsHourlyValue, effectiveMax, profile.heightFactor, false),
                __boardingFillColor: toColor(
                    boardingsHourlyValue,
                    effectiveMax,
                    hourlyUsageConfig.boardings.colorLow,
                    hourlyUsageConfig.boardings.colorHigh
                ),
                __alightingFillColor: toColor(
                    alightingsHourlyValue,
                    effectiveMax,
                    hourlyUsageConfig.alightings.colorLow,
                    hourlyUsageConfig.alightings.colorHigh
                )
            };
        });

        if (forceImmediate || !currentRenderData.length) {
            currentRenderData = targetRenderData;
            overlay.setProps({ layers: buildLayers(currentRenderData) });
        } else {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }

            const startByStation = new Map(currentRenderData.map((row) => [row.station_name, row]));
            const animationDurationMs = 520;
            const animationStart = performance.now();

            const animate = (now) => {
                const elapsed = now - animationStart;
                const progress = Math.max(0, Math.min(1, elapsed / animationDurationMs));
                const eased = 1 - Math.pow(1 - progress, 3);

                currentRenderData = targetRenderData.map((targetRow) => {
                    const startRow = startByStation.get(targetRow.station_name) || targetRow;
                    return {
                        ...targetRow,
                        __metricValue: lerp(toNumber(startRow.__metricValue), toNumber(targetRow.__metricValue), eased),
                        __ratio: lerp(toNumber(startRow.__ratio), toNumber(targetRow.__ratio), eased),
                        __elevation: lerp(toNumber(startRow.__elevation), toNumber(targetRow.__elevation), eased),
                        __fillColor: lerpColor(startRow.__fillColor || targetRow.__fillColor, targetRow.__fillColor, eased),
                        __boardingElevation: lerp(toNumber(startRow.__boardingElevation), toNumber(targetRow.__boardingElevation), eased),
                        __alightingElevation: lerp(toNumber(startRow.__alightingElevation), toNumber(targetRow.__alightingElevation), eased),
                        __boardingFillColor: lerpColor(
                            startRow.__boardingFillColor || targetRow.__boardingFillColor,
                            targetRow.__boardingFillColor,
                            eased
                        ),
                        __alightingFillColor: lerpColor(
                            startRow.__alightingFillColor || targetRow.__alightingFillColor,
                            targetRow.__alightingFillColor,
                            eased
                        )
                    };
                });

                overlay.setProps({ layers: buildLayers(currentRenderData) });
                if (map && map.isStyleLoaded && map.isStyleLoaded()) {
                    map.triggerRepaint();
                }

                if (progress < 1) {
                    animationFrameId = requestAnimationFrame(animate);
                } else {
                    currentRenderData = targetRenderData;
                    overlay.setProps({ layers: buildLayers(currentRenderData) });
                    animationFrameId = null;
                }
            };

            animationFrameId = requestAnimationFrame(animate);
        }

        needsBarsReveal = false;

        if (currentRenderData.length) {
            window.__skytrainBarsRendered = true;
            revealRetryCount = 0;
            if (revealRetryTimerId !== null) {
                window.clearTimeout(revealRetryTimerId);
                revealRetryTimerId = null;
            }
        }

        updateLegend(profile.label, effectiveMin, effectiveMax);
        syncModeUIState();

        if (map && map.isStyleLoaded && map.isStyleLoaded()) {
            map.triggerRepaint();
        }
    };

    const revealBars = () => {
        if (!overlay || !map || !stations.length) {
            return;
        }

        renderCurrentView(true);
        needsBarsReveal = false;

        if (currentRenderData.length) {
            window.__skytrainBarsRendered = true;
        }

        if (map && map.resize) {
            map.resize();
        }

        if (map && map.isStyleLoaded && map.isStyleLoaded()) {
            map.triggerRepaint();
        }
    };

    const scheduleRevealRetry = () => {
        if (window.__skytrainBarsRendered || revealRetryCount >= maxRevealRetries) {
            return;
        }

        if (revealRetryTimerId !== null) {
            window.clearTimeout(revealRetryTimerId);
        }

        revealRetryTimerId = window.setTimeout(() => {
            revealRetryCount += 1;
            needsBarsReveal = true;
            revealBars();
            scheduleRevealRetry();
        }, 360);
    };

    map = new maplibregl.Map({
        container: "map",
        style: {
            version: 8,
            sources: {
                cartoDark: {
                    type: "raster",
                    tiles: [
                        "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    ],
                    tileSize: 256,
                    attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
                }
            },
            layers: [
                {
                    id: "carto-dark-layer",
                    type: "raster",
                    source: "cartoDark"
                }
            ]
        },
        center: [-123.08, 49.24],
        zoom: 10.2,
        pitch: 58,
        bearing: -20,
        antialias: true
    });

    // Track map readiness immediately so we don't miss load timing while data is still fetching.
    map.on("load", () => {
        mapReady = true;
    });

    if (map.loaded()) {
        mapReady = true;
    }

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");

    tooltip = document.createElement("div");
    tooltip.style.position = "fixed";
    tooltip.style.pointerEvents = "none";
    tooltip.style.zIndex = "6";
    tooltip.style.display = "none";
    tooltip.style.background = "rgba(5, 14, 28, 0.93)";
    tooltip.style.border = "1px solid rgba(133, 185, 255, 0.55)";
    tooltip.style.borderRadius = "10px";
    tooltip.style.padding = "10px 12px";
    tooltip.style.color = "#e8f4ff";
    tooltip.style.fontSize = "0.85rem";
    tooltip.style.boxShadow = "0 10px 24px rgba(0, 0, 0, 0.35)";
    document.body.appendChild(tooltip);

    try {
        const [stationResponse, hourlyResponse] = await Promise.all([
            fetch(apiUrl, { cache: "no-store" }),
            fetch(hourlyApiUrl, { cache: "no-store" })
        ]);

        if (!stationResponse.ok) {
            throw new Error("Failed to load station usage data.");
        }

        const stationPayload = await stationResponse.json();
        const hourlyPayload = hourlyResponse.ok ? await hourlyResponse.json() : { stations: {} };

        const hourlyStations = hourlyPayload && hourlyPayload.stations ? hourlyPayload.stations : {};
        hourlyStationsByName = new Map(
            Object.entries(hourlyStations).map(([name, values]) => [normalizeStationName(name), values])
        );

        const getSeriesMax = (series) => {
            if (!Array.isArray(series)) {
                return 0;
            }
            return series.reduce((maxValue, value) => Math.max(maxValue, toNumber(value)), 0);
        };

        const getCombinedSeriesMax = (stationHourly, dayTypeKey) => {
            const daySeries = stationHourly && stationHourly[dayTypeKey] ? stationHourly[dayTypeKey] : {};
            const boardings = Array.isArray(daySeries.boardings) ? daySeries.boardings : [];
            const alightings = Array.isArray(daySeries.alightings) ? daySeries.alightings : [];

            return boardings.reduce((maxValue, value, index) => {
                const combined = toNumber(value) + toNumber(alightings[index]);
                return Math.max(maxValue, combined);
            }, 0);
        };

        hourlyReferenceMaxByDayTypeUsage = new Map();
        Object.values(hourlyStations).forEach((stationHourly) => {
            Object.entries(hourlyDayTypeConfig).forEach(([, dayTypeCfg]) => {
                const daySeries = stationHourly && stationHourly[dayTypeCfg.apiKey] ? stationHourly[dayTypeCfg.apiKey] : {};

                Object.entries(hourlyUsageConfig).forEach(([usageKey]) => {
                    const series = usageKey === "boardings"
                        ? daySeries.boardings
                        : usageKey === "alightings"
                            ? daySeries.alightings
                            : null;

                    const seriesMax = getSeriesMax(series);
                    const cacheKey = `${dayTypeCfg.apiKey}:${usageKey}`;
                    hourlyReferenceMaxByDayTypeUsage.set(
                        cacheKey,
                        Math.max(hourlyReferenceMaxByDayTypeUsage.get(cacheKey) || 0, seriesMax)
                    );
                });

                const totalCacheKey = `${dayTypeCfg.apiKey}:total`;
                hourlyReferenceMaxByDayTypeUsage.set(
                    totalCacheKey,
                    Math.max(
                        hourlyReferenceMaxByDayTypeUsage.get(totalCacheKey) || 0,
                        getCombinedSeriesMax(stationHourly, dayTypeCfg.apiKey)
                    )
                );
            });
        });

        stations = Array.isArray(stationPayload.stations) ? stationPayload.stations : [];
        stations = stations.map((station) => {
            const normalizedName = normalizeStationName(station.station_name);
            return {
                ...station,
                annual_boardings: toNumber(station.annual_boardings),
                weekday: toNumber(station.weekday),
                saturday: toNumber(station.saturday),
                sunday: toNumber(station.sunday),
                __hourly: hourlyStationsByName.get(normalizedName) || {}
            };
        });

        dataReady = true;
    } catch (error) {
        console.error(error);
        tooltip.style.display = "block";
        tooltip.style.left = "18px";
        tooltip.style.bottom = "18px";
        tooltip.style.top = "auto";
        tooltip.innerHTML = "Could not load map data.";
        window.__skytrainBarsRendered = false;
        return;
    }

    if (stations.length === 0) {
        tooltip.style.display = "block";
        tooltip.style.left = "18px";
        tooltip.style.bottom = "18px";
        tooltip.style.top = "auto";
        tooltip.innerHTML = "No station data available for 2024.";
        window.__skytrainBarsRendered = false;
        return;
    }

    const initialView = {
        longitude: -123.08,
        latitude: 49.24,
        zoom: 10.2,
        pitch: 58,
        bearing: -20
    };

    overlay = new deck.MapboxOverlay({
        interleaved: true,
        layers: []
    });

    const initializeMapOverlayAndRender = () => {
        if (!mapReady || !dataReady) {
            return;
        }

        if (hasInitializedOverlay) {
            revealBars();
            scheduleRevealRetry();
            return;
        }

        hasInitializedOverlay = true;
        map.addControl(overlay);
        map.jumpTo(initialView);
        map.flyTo({
            center: [-123.08, 49.24],
            zoom: 10.9,
            pitch: 62,
            bearing: -28,
            duration: 2800,
            essential: true
        });

        // Ensure overlay is attached before first render to avoid intermittent empty layers on refresh.
        requestAnimationFrame(() => {
            revealBars();
            scheduleRevealRetry();
        });
    };

    map.on("load", () => {
        mapReady = true;
        initializeMapOverlayAndRender();
    });

    if (map.loaded()) {
        mapReady = true;
    }

    initializeMapOverlayAndRender();

    map.on("idle", () => {
        if (needsBarsReveal && stations.length) {
            revealBars();
            scheduleRevealRetry();
        }
    });

    window.addEventListener("pageshow", (event) => {
        if (event.persisted) {
            needsBarsReveal = true;
            window.__skytrainBarsRendered = false;
            revealRetryCount = 0;
            window.requestAnimationFrame(() => {
                revealBars();
                scheduleRevealRetry();
            });
        }
    });

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && stations.length) {
            needsBarsReveal = true;
            window.__skytrainBarsRendered = false;
            revealRetryCount = 0;
            window.requestAnimationFrame(() => {
                revealBars();
                scheduleRevealRetry();
            });
        }
    });

    map.on("mousemove", (event) => {
        if (!overlay) {
            return;
        }

        const picks = overlay.pickObject({
            x: event.point.x,
            y: event.point.y,
            radius: 4
        });

        if (!picks || !picks.object) {
            tooltip.style.display = "none";
            return;
        }

        const station = picks.object;
        const metricValue = toNumber(station.__metricValue);
        const scaled = toNumber(station.__ratio) * 100;
        const tooltipLabel = station.__tooltipLabel || "Usage";

        tooltip.innerHTML = [
            `<strong>${station.station_name}</strong>`,
            `${tooltipLabel}: ${formatBoardings(metricValue)}`,
            `Relative height: ${scaled.toFixed(1)}%`
        ].join("<br>");

        tooltip.style.display = "block";
        tooltip.style.left = `${event.originalEvent.clientX + 14}px`;
        tooltip.style.top = `${event.originalEvent.clientY + 14}px`;
    });

    map.on("mouseleave", () => {
        tooltip.style.display = "none";
    });

    metricButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const metric = button.dataset.metric;
            if (!metric || !totalMetricConfig[metric]) {
                return;
            }
            activeMode = "total";
            activeTotalMetric = metric;
            renderCurrentView();
        });
    });

    modeButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const mode = button.dataset.mode;
            if (mode !== "total" && mode !== "hourly") {
                return;
            }
            activeMode = mode;
            renderCurrentView();
        });
    });

    hourlyDayTypeButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const dayType = button.dataset.hourlyDaytype;
            if (!dayType || !hourlyDayTypeConfig[dayType]) {
                return;
            }
            activeMode = "hourly";
            activeHourlyDayType = dayType;
            renderCurrentView();
        });
    });

    if (hourlyPlayToggle) {
        hourlyPlayToggle.addEventListener("click", () => {
            activeMode = "hourly";
            toggleHourlyPlayback();
            renderCurrentView();
        });
    }

    playbackSpeedButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const speed = Number(button.dataset.playbackSpeed);
            if (!Number.isFinite(speed) || speed <= 0) {
                return;
            }
            setHourlyPlaybackSpeed(speed);
        });
    });

    loopModeButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const loopMode = button.dataset.loopMode;
            if (loopMode !== "same-day-type" && loopMode !== "shift-day-types") {
                return;
            }
            setHourlyPlaybackLoopMode(loopMode);
        });
    });

    hourlyUsageButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const usage = button.dataset.hourlyUsage;
            if (!usage || !hourlyUsageConfig[usage]) {
                return;
            }
            activeMode = "hourly";
            activeHourlyUsage = usage;
            renderCurrentView();
        });
    });

    hourlyTimeModeButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const timeMode = button.dataset.hourlyTimeMode;
            if (timeMode !== "none" && timeMode !== "show") {
                return;
            }
            activeMode = "hourly";
            activeHourlyTimeMode = timeMode;
            renderCurrentView();
        });
    });

    if (heightSlider) {
        updateSliderLabel();
        heightSlider.addEventListener("input", () => {
            updateSliderLabel();
            renderCurrentView();
        });
    }

    if (hourlyTimeSlider) {
        hourlyTimeSlider.addEventListener("input", () => {
            activeHourlySliderIndex = Math.max(0, Math.min(23, toNumber(hourlyTimeSlider.value)));
            activeMode = "hourly";
            if (hourlyPlaybackActive) {
                stopHourlyPlayback();
            }
            renderCurrentView();
        });
    }

    if (hourlyPrevHourButton) {
        hourlyPrevHourButton.addEventListener("click", () => {
            stepHourlySliderBy(-1);
        });
    }

    if (hourlyNextHourButton) {
        hourlyNextHourButton.addEventListener("click", () => {
            stepHourlySliderBy(1);
        });
    }
})();
