(async function initializeSkyTrainSegmentUsageMap() {
    const apiUrl = "/api/skytrain-segment-usage-map-3d-data?refresh=1";

    window.__skytrainSegmentTubesRendered = false;

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

    const dayTypeConfig = {
        weekday: { label: "MF" },
        saturday: { label: "Sat" },
        sunday: { label: "SunHol" }
    };

    const usageConfig = {
        total: {
            label: "Total Segment Usage",
            colorLow: [83, 149, 255],
            colorHigh: [191, 229, 255],
            tooltipLabel: "Total Hourly Usage"
        },
        inbound: {
            label: "Inbound Segment Usage",
            colorLow: [52, 195, 255],
            colorHigh: [177, 239, 255],
            tooltipLabel: "Inbound Hourly Usage"
        },
        outbound: {
            label: "Outbound Segment Usage",
            colorLow: [90, 165, 255],
            colorHigh: [205, 236, 255],
            tooltipLabel: "Outbound Hourly Usage"
        }
    };

    let activeMode = "total";
    let activeTotalMetric = "weekday";
    let activeHourlyDayType = "weekday";
    let activeHourlyUsage = "total";
    let activeHourlyTimeMode = "none";
    let activeTimeSliderIndex = 0;
    let playbackTimerId = null;
    let playbackSpeed = 1;
    let playbackLoopMode = "same-day-type";
    let playbackActive = false;

    let segments = [];
    let overlay = null;
    let map = null;
    let tooltip = null;
    let mapReady = false;
    let dataReady = false;
    let overlayAttached = false;
    let hoverInfo = null;

    const toNumber = (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    };

    const getSegmentHoverKey = (segment) => {
        if (!segment) {
            return null;
        }

        return [segment.from_station, segment.to_station, segment.direction, segment.line]
            .map((part) => String(part || "").trim().toLowerCase())
            .join("|");
    };

    const formatNumber = (value) => {
        return new Intl.NumberFormat("en-CA", {
            maximumFractionDigits: 0
        }).format(value);
    };

    const brightenColor = (color, amount) => {
        const factor = Math.max(0, Math.min(1, amount));
        return [
            Math.round(color[0] + (255 - color[0]) * factor),
            Math.round(color[1] + (255 - color[1]) * factor),
            Math.round(color[2] + (255 - color[2]) * factor),
            color[3]
        ];
    };

    const minutePad = (value) => String(value).padStart(2, "0");

    const indexToSlot = (sliderIndex) => {
        return (sliderIndex + 16) % 96;
    };

    const slotToTimeParts = (slotIndex) => {
        const hour24 = Math.floor(slotIndex / 4);
        const minute = (slotIndex % 4) * 15;
        return { hour24, minute };
    };

    const formatTime = (hour24, minute) => {
        const suffix = hour24 >= 12 ? "PM" : "AM";
        const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
        return `${hour12}:${minutePad(minute)} ${suffix}`;
    };

    const formatTimeRangeLabel = (slotIndex) => {
        const start = slotToTimeParts(slotIndex);
        const endSlot = (slotIndex + 1) % 96;
        const end = slotToTimeParts(endSlot);
        return `${formatTime(start.hour24, start.minute)} - ${formatTime(end.hour24, end.minute)}`;
    };

    const getScalePercent = () => {
        if (!heightSlider) {
            return 100;
        }
        return Math.max(15, Math.min(300, toNumber(heightSlider.value) || 100));
    };

    const getScaleMultiplier = () => {
        // Rebase scale so new 100% behaves like prior 250%.
        const percent = getScalePercent() * 2.5;
        if (percent <= 100) {
            const t = (percent - 15) / 85;
            return 0.28 + Math.max(0, Math.min(1, t)) * 0.95;
        }
        const over = (percent - 100) / 200;
        return 1.23 + Math.pow(over, 2.1) * 3.4;
    };

    const updateSliderLabel = () => {
        if (heightSliderValue) {
            heightSliderValue.textContent = `${Math.round(getScalePercent())}%`;
        }
    };

    const updateTimeLabel = () => {
        if (hourlyTimeLabel) {
            hourlyTimeLabel.textContent = formatTimeRangeLabel(indexToSlot(activeTimeSliderIndex));
        }

        if (!hourlyTimeDisplay) {
            return;
        }

        const showTime = activeMode === "hourly" && activeHourlyTimeMode === "show";
        hourlyTimeDisplay.classList.toggle("is-visible", showTime);

        if (!showTime) {
            hourlyTimeDisplay.textContent = "";
            return;
        }

        const slot = indexToSlot(activeTimeSliderIndex);
        const parts = slotToTimeParts(slot);
        hourlyTimeDisplay.textContent = formatTime(parts.hour24, parts.minute);
    };

    const getCurrentProfile = () => {
        if (activeMode === "total") {
            const dayKey = activeTotalMetric;
            const cfg = usageConfig.total;

            return {
                label: `Average Hourly Segment Usage (${dayTypeConfig[dayKey].label})`,
                tooltipLabel: `Average Hourly Segment Usage (${dayTypeConfig[dayKey].label})`,
                colorLow: cfg.colorLow,
                colorHigh: cfg.colorHigh,
                getValue: (segment) => {
                    const series = segment.usage[dayKey] && segment.usage[dayKey].total ? segment.usage[dayKey].total : [];
                    if (!series.length) {
                        return 0;
                    }
                    const sum = series.reduce((acc, value) => acc + toNumber(value), 0);
                    return sum / series.length;
                }
            };
        }

        const dayKey = activeHourlyDayType;
        const usageKey = activeHourlyUsage;
        const cfg = usageConfig[usageKey];
        const slot = indexToSlot(activeTimeSliderIndex);

        return {
            label: `${cfg.label} (${dayTypeConfig[dayKey].label}, ${formatTimeRangeLabel(slot)})`,
            tooltipLabel: `${cfg.tooltipLabel} (${dayTypeConfig[dayKey].label}, ${formatTimeRangeLabel(slot)})`,
            colorLow: cfg.colorLow,
            colorHigh: cfg.colorHigh,
            dayKey,
            usageKey,
            getValue: (segment) => {
                const daySeries = segment.usage[dayKey] || {};
                const usageSeries = daySeries[usageKey] || [];
                return toNumber(usageSeries[slot]);
            }
        };
    };

    const getHourlyReferenceMax = (dayKey, usageKey) => {
        if (!dayKey || !usageKey) {
            return 1;
        }

        let maxValue = 0;
        segments.forEach((segment) => {
            const daySeries = segment.usage[dayKey] || {};
            const usageSeries = Array.isArray(daySeries[usageKey]) ? daySeries[usageKey] : [];
            usageSeries.forEach((value) => {
                maxValue = Math.max(maxValue, toNumber(value));
            });
        });

        return maxValue > 0 ? maxValue : 1;
    };

    const toColor = (value, maxValue, low, high) => {
        // Keep visually-empty segments neutral when their displayed value rounds to 0.
        if (Math.round(value) <= 0 || maxValue <= 0) {
            return [128, 128, 128, 170];
        }

        const ratio = Math.max(0, Math.min(1, value / maxValue));
        const red = Math.round(low[0] + (high[0] - low[0]) * ratio);
        const green = Math.round(low[1] + (high[1] - low[1]) * ratio);
        const blue = Math.round(low[2] + (high[2] - low[2]) * ratio);
        const alpha = Math.round(170 + ratio * 80);

        return [red, green, blue, alpha];
    };

    const shadeColor = (color, amount) => {
        const factor = Math.max(-1, Math.min(1, amount));
        const shift = factor >= 0 ? 255 * factor : 0;
        const scale = factor >= 0 ? 1 - factor : 1 + factor;

        return [
            Math.max(0, Math.min(255, Math.round(color[0] * scale + shift))),
            Math.max(0, Math.min(255, Math.round(color[1] * scale + shift))),
            Math.max(0, Math.min(255, Math.round(color[2] * scale + shift))),
            color[3]
        ];
    };

    const toTubeWidth = (value, maxValue) => {
        if (maxValue <= 0) {
            return 18;
        }

        const ratio = Math.max(0, Math.min(1, value / maxValue));
        const modeFactor = activeMode === "hourly" ? 1.08 : 1;
        const width = (18 + ratio * 130) * getScaleMultiplier() * modeFactor;
        return Math.max(6, width);
    };

    const toTubeHeight = (value, maxValue) => {
        if (maxValue <= 0) {
            return 16;
        }

        const ratio = Math.max(0, Math.min(1, value / maxValue));
        const modeFactor = activeMode === "hourly" ? 1.1 : 1;
        const height = (8 + ratio * 82) * getScaleMultiplier() * modeFactor;
        return Math.max(5, height);
    };

    const updateLegend = (title, minValue, maxValue) => {
        if (legendTitle) {
            legendTitle.textContent = title;
        }

        const labels = document.querySelectorAll(".legend-labels span");
        if (labels.length === 2) {
            labels[0].textContent = formatNumber(minValue);
            labels[1].textContent = formatNumber(maxValue);
        }
    };

    const syncButtons = () => {
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

    const clearPlaybackTimer = () => {
        if (playbackTimerId !== null) {
            window.clearTimeout(playbackTimerId);
            playbackTimerId = null;
        }
    };

    const updatePlaybackUI = () => {
        if (hourlyPlayToggle) {
            hourlyPlayToggle.textContent = playbackActive ? "Pause" : "Play";
            hourlyPlayToggle.setAttribute("aria-pressed", playbackActive ? "true" : "false");
            hourlyPlayToggle.classList.toggle("is-active", playbackActive);
        }

        playbackSpeedButtons.forEach((button) => {
            button.classList.toggle("is-active", toNumber(button.dataset.playbackSpeed) === playbackSpeed);
        });

        loopModeButtons.forEach((button) => {
            button.classList.toggle("is-active", button.dataset.loopMode === playbackLoopMode);
        });
    };

    const stopPlayback = () => {
        playbackActive = false;
        clearPlaybackTimer();
        updatePlaybackUI();
    };

    const nextDayKey = (dayKey) => {
        const keys = Object.keys(dayTypeConfig);
        const idx = keys.indexOf(dayKey);
        if (idx < 0) {
            return keys[0];
        }
        return keys[(idx + 1) % keys.length];
    };

    const stepSlider = (delta) => {
        activeTimeSliderIndex = (activeTimeSliderIndex + delta + 96) % 96;
        if (hourlyTimeSlider) {
            hourlyTimeSlider.value = String(activeTimeSliderIndex);
        }
    };

    const schedulePlaybackTick = () => {
        clearPlaybackTimer();
        const effectivePlaybackSpeed = Math.max(0.25, playbackSpeed * 2);
        const intervalMs = Math.max(60, Math.round(190 / effectivePlaybackSpeed));

        playbackTimerId = window.setTimeout(() => {
            if (!playbackActive) {
                return;
            }

            if (activeTimeSliderIndex === 95) {
                activeTimeSliderIndex = 0;
                if (playbackLoopMode === "shift-day-types") {
                    activeHourlyDayType = nextDayKey(activeHourlyDayType);
                }
            } else {
                activeTimeSliderIndex += 1;
            }

            if (hourlyTimeSlider) {
                hourlyTimeSlider.value = String(activeTimeSliderIndex);
            }

            renderCurrentView();
            schedulePlaybackTick();
        }, intervalMs);
    };

    const togglePlayback = () => {
        if (playbackActive) {
            stopPlayback();
            return;
        }

        activeMode = "hourly";
        playbackActive = true;
        updatePlaybackUI();
        schedulePlaybackTick();
    };

    const syncModeUI = () => {
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
            stopPlayback();
        }

        updateSliderLabel();
        updateTimeLabel();
        syncButtons();
        updatePlaybackUI();
    };

    const buildLayers = (renderData) => {
        return [
            new deck.PathLayer({
                id: "segment-glow",
                data: renderData,
                pickable: false,
                widthUnits: "meters",
                rounded: true,
                capRounded: true,
                billboard: false,
                opacity: 0.16,
                getPath: (d) => d.__pathMid,
                getColor: (d) => {
                    const color = d.__isHovered ? d.__hoverFillColor : d.__fillColor;
                    return [color[0], color[1], color[2], 95];
                },
                getWidth: (d) => (d.__isHovered ? d.__hoverTubeWidth : d.__tubeWidth) * 2.0,
                parameters: {
                    depthTest: false,
                    depthMask: false
                }
            }),
            new deck.PathLayer({
                id: "segment-tube-rim",
                data: renderData,
                pickable: true,
                widthUnits: "meters",
                rounded: true,
                capRounded: true,
                jointRounded: true,
                billboard: false,
                opacity: 1,
                getPath: (d) => d.__pathBase,
                getColor: (d) => {
                    const baseColor = d.__isHovered ? d.__hoverFillColor : d.__fillColor;
                    const darker = shadeColor(baseColor, d.__isHovered ? 0.1 : -0.18);
                    return [darker[0], darker[1], darker[2], 255];
                },
                getWidth: (d) => (d.__isHovered ? d.__hoverTubeWidth : d.__tubeWidth),
                parameters: {
                    depthTest: false,
                    depthMask: false
                }
            }),
            new deck.PathLayer({
                id: "segment-tube-core",
                data: renderData,
                pickable: true,
                widthUnits: "meters",
                rounded: true,
                capRounded: true,
                jointRounded: true,
                billboard: false,
                opacity: 1,
                getPath: (d) => d.__pathMid,
                getColor: (d) => (d.__isHovered ? d.__hoverFillColor : d.__fillColor),
                getWidth: (d) => (d.__isHovered ? d.__hoverTubeWidth : d.__tubeWidth) * 0.9,
                parameters: {
                    depthTest: false,
                    depthMask: false
                }
            }),
            new deck.PathLayer({
                id: "segment-tube-highlight",
                data: renderData,
                pickable: false,
                widthUnits: "meters",
                rounded: true,
                capRounded: true,
                jointRounded: true,
                billboard: false,
                opacity: 0.92,
                getPath: (d) => d.__pathTop,
                getColor: (d) => {
                    const baseColor = d.__isHovered ? d.__hoverFillColor : d.__fillColor;
                    const lighter = shadeColor(baseColor, d.__isHovered ? 0.5 : 0.36);
                    return [lighter[0], lighter[1], lighter[2], 255];
                },
                getWidth: (d) => (d.__isHovered ? d.__hoverTubeWidth : d.__tubeWidth) * 0.24,
                parameters: {
                    depthTest: false,
                    depthMask: false
                }
            })
        ];
    };

    const renderCurrentView = () => {
        if (!overlay || !map || !segments.length) {
            return;
        }

        const profile = getCurrentProfile();

        const maxValue = activeMode === "hourly"
            ? getHourlyReferenceMax(profile.dayKey, profile.usageKey)
            : segments.reduce((maxSoFar, segment) => {
                return Math.max(maxSoFar, profile.getValue(segment));
            }, 0);

        const minValue = segments.reduce((minSoFar, segment) => {
            return Math.min(minSoFar, profile.getValue(segment));
        }, Number.POSITIVE_INFINITY);

        const effectiveMax = maxValue > 0 ? maxValue : 1;
        const effectiveMin = Number.isFinite(minValue) ? minValue : 0;

        const renderData = segments.map((segment) => {
            const metricValue = profile.getValue(segment);
            const ratio = Math.max(0, Math.min(1, metricValue / effectiveMax));
            const tubeHeight = toTubeHeight(metricValue, effectiveMax);
            const hoveredKey = getSegmentHoverKey(hoverInfo && hoverInfo.object ? hoverInfo.object : null);
            const isHovered = hoveredKey && hoveredKey === getSegmentHoverKey(segment);
            const fillColor = toColor(metricValue, effectiveMax, profile.colorLow, profile.colorHigh);

            const pathBase = segment.coordinates.map((coord) => [coord[0], coord[1], 1]);
            const pathMid = segment.coordinates.map((coord) => [coord[0], coord[1], 1 + tubeHeight * 0.48]);
            const pathTop = segment.coordinates.map((coord) => [coord[0], coord[1], 1 + tubeHeight]);

            return {
                ...segment,
                __metricValue: metricValue,
                __ratio: ratio,
                __tooltipLabel: profile.tooltipLabel,
                __tubeWidth: toTubeWidth(metricValue, effectiveMax),
                __tubeHeight: tubeHeight,
                __fillColor: fillColor,
                __isHovered: isHovered,
                __hoverFillColor: isHovered ? brightenColor(fillColor, 0.3) : fillColor,
                __hoverTubeWidth: isHovered ? toTubeWidth(metricValue, effectiveMax) * 1.15 : toTubeWidth(metricValue, effectiveMax),
                __pathBase: pathBase,
                __pathMid: pathMid,
                __pathTop: pathTop
            };
        });

        overlay.setProps({ layers: buildLayers(renderData) });
        if (map.isStyleLoaded && map.isStyleLoaded()) {
            map.triggerRepaint();
        }

        window.__skytrainSegmentTubesRendered = renderData.length > 0;

        updateLegend(profile.label, effectiveMin, effectiveMax);
        syncModeUI();
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
        zoom: 10.15,
        pitch: 62,
        bearing: -24,
        antialias: true
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");

    overlay = new deck.MapboxOverlay({
        interleaved: true,
        layers: []
    });

    const attachOverlayAndRender = () => {
        if (!mapReady || !dataReady || overlayAttached) {
            return;
        }

        overlayAttached = true;
        map.addControl(overlay);
        map.flyTo({
            center: [-123.08, 49.24],
            zoom: 10.85,
            pitch: 65,
            bearing: -28,
            duration: 2800,
            essential: true
        });

        renderCurrentView();

        // Retry once on the next frame to avoid occasional first-frame empty overlays.
        window.requestAnimationFrame(() => {
            renderCurrentView();
        });
    };

    map.on("load", () => {
        mapReady = true;
        attachOverlayAndRender();
    });

    if (map.loaded()) {
        mapReady = true;
    }

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
        const response = await fetch(apiUrl, { cache: "no-store" });
        if (!response.ok) {
            throw new Error("Failed to load segment usage data.");
        }

        const payload = await response.json();
        segments = Array.isArray(payload.segments) ? payload.segments : [];
        dataReady = true;
    } catch (error) {
        console.error(error);
        tooltip.style.display = "block";
        tooltip.style.left = "18px";
        tooltip.style.bottom = "18px";
        tooltip.style.top = "auto";
        tooltip.innerHTML = "Could not load segment map data.";
        return;
    }

    if (!segments.length) {
        tooltip.style.display = "block";
        tooltip.style.left = "18px";
        tooltip.style.bottom = "18px";
        tooltip.style.top = "auto";
        tooltip.innerHTML = "No segment usage data available for 2024.";
        return;
    }

    if (map.loaded()) {
        mapReady = true;
    }

    attachOverlayAndRender();

    map.on("mousemove", (event) => {
        if (!overlay) {
            return;
        }

        const pickInfo = overlay.pickObject({
            x: event.point.x,
            y: event.point.y,
            radius: 5
        });

        if (!pickInfo || !pickInfo.object) {
            hoverInfo = null;
            tooltip.style.display = "none";
            renderCurrentView();
            return;
        }

        const segment = pickInfo.object;
        const metricValue = toNumber(segment.__metricValue);
        const ratio = toNumber(segment.__ratio) * 100;

        hoverInfo = pickInfo;

        tooltip.innerHTML = [
            `<strong>${segment.from_station} &mdash; ${segment.to_station}</strong>`,
            `${segment.__tooltipLabel}: ${formatNumber(metricValue)}`,
            `Relative usage: ${ratio.toFixed(1)}%`
        ].join("<br>");

        tooltip.style.display = "block";
        tooltip.style.left = `${event.originalEvent.clientX + 14}px`;
        tooltip.style.top = `${event.originalEvent.clientY + 14}px`;
        renderCurrentView();
    });

    map.on("mouseleave", () => {
        hoverInfo = null;
        tooltip.style.display = "none";
        renderCurrentView();
    });

    metricButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const metric = button.dataset.metric;
            if (!metric || !dayTypeConfig[metric]) {
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
            if (!dayType || !dayTypeConfig[dayType]) {
                return;
            }
            activeMode = "hourly";
            activeHourlyDayType = dayType;
            renderCurrentView();
        });
    });

    hourlyUsageButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const usage = button.dataset.hourlyUsage;
            if (!usage || !usageConfig[usage]) {
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

    if (hourlyPlayToggle) {
        hourlyPlayToggle.addEventListener("click", () => {
            togglePlayback();
            renderCurrentView();
        });
    }

    playbackSpeedButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const speed = toNumber(button.dataset.playbackSpeed);
            if (speed <= 0) {
                return;
            }
            playbackSpeed = speed;
            updatePlaybackUI();
            if (playbackActive) {
                schedulePlaybackTick();
            }
        });
    });

    loopModeButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const loopMode = button.dataset.loopMode;
            if (loopMode !== "same-day-type" && loopMode !== "shift-day-types") {
                return;
            }
            playbackLoopMode = loopMode;
            updatePlaybackUI();
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
            activeTimeSliderIndex = Math.max(0, Math.min(95, toNumber(hourlyTimeSlider.value)));
            activeMode = "hourly";
            if (playbackActive) {
                stopPlayback();
            }
            renderCurrentView();
        });
    }

    if (hourlyPrevHourButton) {
        hourlyPrevHourButton.addEventListener("click", () => {
            activeMode = "hourly";
            if (playbackActive) {
                stopPlayback();
            }
            stepSlider(-1);
            renderCurrentView();
        });
    }

    if (hourlyNextHourButton) {
        hourlyNextHourButton.addEventListener("click", () => {
            activeMode = "hourly";
            if (playbackActive) {
                stopPlayback();
            }
            stepSlider(1);
            renderCurrentView();
        });
    }

    window.addEventListener("pageshow", () => {
        if (overlayAttached) {
            renderCurrentView();
        }
    });

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && overlayAttached) {
            renderCurrentView();
        }
    });
})();
