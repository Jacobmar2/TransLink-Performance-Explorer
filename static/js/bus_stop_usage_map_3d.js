(async function initializeBusStopUsageMap() {
    const apiUrl = "/api/bus-stop-usage-map-3d-data?year=2024&refresh=1";
    const busLineOptionsUrl = "/api/bus-line-options?year=2024";

    window.__busStopBarsRendered = false;

    const totalMetricConfig = {
        boardings: {
            label: "Total boardings",
            getValue: (stop, dayKey) => stop[`${dayKey}_boardings`]
        },
        alightings: {
            label: "Alightings",
            getValue: (stop, dayKey) => stop[`${dayKey}_alightings`]
        },
        total_usage: {
            label: "Total usage",
            getValue: (stop, dayKey) => {
                const boardings = Number(stop[`${dayKey}_boardings`] || 0);
                const alightings = Number(stop[`${dayKey}_alightings`] || 0);
                return boardings + alightings;
            }
        }
    };

    const dayTypeConfig = {
        weekday: { label: "MF", key: "mf" },
        saturday: { label: "Sat", key: "sat" },
        sunday: { label: "SunHol", key: "sunhol" }
    };

    const metricButtons = Array.from(document.querySelectorAll(".metric-button"));
    const daytypeButtons = Array.from(document.querySelectorAll(".daytype-button"));
    const busLineSelect = document.getElementById("bus-line-select");
    const revealMapButton = document.getElementById("reveal-map-button");
    const panel = document.getElementById("control-panel");
    const toggleButton = document.getElementById("control-panel-toggle");
    const tooltip = document.getElementById("map-tooltip");
    const titleHeading = document.querySelector(".overlay h1");
    const titleDescriptions = Array.from(document.querySelectorAll(".overlay p"));
    const legendElement = document.querySelector(".legend");
    const titleHideButton = document.getElementById("title-hide-button");
    const titleShowButton = document.getElementById("title-show-button");

    let map = null;
    let overlay = null;
    let mapReady = false;
    let dataReady = false;
    let stops = [];
    let busLineOptions = [];
    let currentMetric = "boardings";
    let currentDayType = "weekday";
    let currentBusLine = "";
    let hoverInfo = null;
    let titleVisible = true;

    const numberFormatter = new Intl.NumberFormat("en-CA", {
        maximumFractionDigits: 0
    });

    const setActiveButton = (buttons, activeButton) => {
        buttons.forEach((button) => button.classList.toggle("is-active", button === activeButton));
    };

    const splitLineTokens = (rawValue) => {
        const text = String(rawValue || "").trim();
        if (!text) {
            return [];
        }

        const tokens = new Set();
        const addToken = (token) => {
            const normalized = String(token || "").trim();
            if (!normalized) {
                return;
            }

            const upper = normalized.toUpperCase();
            tokens.add(upper);
            if (/^\d+$/.test(upper)) {
                tokens.add(String(Number(upper)));
                tokens.add(upper.padStart(3, "0"));
            }
        };

        text.split(/[;,/&|]+/).forEach(addToken);
        text.split(/[^A-Za-z0-9]+/).forEach(addToken);

        return Array.from(tokens);
    };

    const tokensIntersect = (leftTokens, rightTokens) => {
        const rightSet = new Set(rightTokens);
        return leftTokens.some((token) => rightSet.has(token));
    };

    const getSelectedLineTokens = () => splitLineTokens(currentBusLine);

    const getMatchingLineMetric = (stop) => {
        const selectedTokens = getSelectedLineTokens();
        if (!selectedTokens.length) {
            return null;
        }

        const lineMetrics = Array.isArray(stop.line_metrics) ? stop.line_metrics : [];
        return lineMetrics.find((metric) => {
            const metricTokens = Array.isArray(metric.line_tokens) ? metric.line_tokens : splitLineTokens(metric.line_number);
            return tokensIntersect(metricTokens, selectedTokens);
        }) || null;
    };

    const getStopBusLines = (stop) => {
        const lineMetrics = Array.isArray(stop.line_metrics) ? stop.line_metrics : [];
        const busLines = lineMetrics
            .map((metric) => String(metric.line_number || "").trim())
            .filter((lineNumber) => lineNumber && lineNumber.toLowerCase() !== "nan");

        return Array.from(new Set(busLines));
    };

    const getDayKey = () => dayTypeConfig[currentDayType]?.key || "mf";

    const getMetricLabel = () => totalMetricConfig[currentMetric]?.label || "Usage";

    const getDayLabel = () => dayTypeConfig[currentDayType]?.label || "MF";

    const getVisibleStops = () => {
        if (!getSelectedLineTokens().length) {
            return stops;
        }

        return stops.filter((stop) => getMatchingLineMetric(stop));
    };

    const getMetricValue = (stop) => {
        const dayKey = getDayKey();
        const metricConfig = totalMetricConfig[currentMetric] || totalMetricConfig.boardings;
        const lineMetric = getMatchingLineMetric(stop);
        if (lineMetric) {
            const lineFieldMap = {
                boardings: `boardings_${dayKey}`,
                alightings: `alightings_${dayKey}`,
                total_usage: null
            };

            if (currentMetric === "total_usage") {
                const boardings = Number(lineMetric[`boardings_${dayKey}`] || 0);
                const alightings = Number(lineMetric[`alightings_${dayKey}`] || 0);
                return boardings + alightings;
            }

            const lineField = lineFieldMap[currentMetric] || `boardings_${dayKey}`;
            const lineValue = lineMetric[lineField];
            return Number.isFinite(Number(lineValue)) ? Number(lineValue) : 0;
        }

        const value = metricConfig.getValue(stop, dayKey);
        return Number.isFinite(Number(value)) ? Number(value) : 0;
    };

    const getFillColor = (value, maxValue) => {
        if (value <= 0) {
            return [120, 120, 120, 190];
        }

        const green = [43, 194, 105];
        const yellow = [247, 210, 67];
        const orange = [245, 154, 54];
        const red = [239, 81, 66];

        const blend = (startColor, endColor, t) => [
            Math.round(startColor[0] + (endColor[0] - startColor[0]) * t),
            Math.round(startColor[1] + (endColor[1] - startColor[1]) * t),
            Math.round(startColor[2] + (endColor[2] - startColor[2]) * t),
            210
        ];

        if (value <= 1000) {
            const t = Math.max(0, Math.min(1, value / 1000));
            return blend(green, yellow, t);
        }

        if (value <= 2000) {
            const t = Math.max(0, Math.min(1, (value - 1000) / 1000));
            return blend(yellow, orange, t);
        }

        const safeMax = Math.max(maxValue, value, 2000);
        const t = Math.max(0, Math.min(1, (value - 2000) / Math.max(1, safeMax - 2000)));
        return blend(orange, red, t);
    };

    const getHeight = (value, maxValue) => {
        const safeMax = maxValue > 0 ? maxValue : 1;
        const ratio = Math.max(0, Math.min(1, value / safeMax));
        return 30 + ratio * 2200;
    };

    const hideTooltip = () => {
        if (!tooltip) {
            return;
        }

        tooltip.classList.remove("is-visible");
        tooltip.setAttribute("aria-hidden", "true");
        tooltip.innerHTML = "";
    };

    const showTooltip = (info, value) => {
        if (!tooltip) {
            return;
        }

        const stop = info.object;
        const busLines = getStopBusLines(stop);
        const lineLabel = `Bus Line(s): ${busLines.length ? busLines.join(", ") : "N/A"}`;

        tooltip.innerHTML = [
            `<p class="map-tooltip-title">${stop.stop_name}</p>`,
            `<p class="map-tooltip-line">${getMetricLabel()} (${getDayLabel()}): ${numberFormatter.format(value)}</p>`,
            `<p class="map-tooltip-line">${lineLabel}</p>`
        ].join("");
        tooltip.style.left = `${Math.min(info.x + 14, window.innerWidth - 280)}px`;
        tooltip.style.top = `${Math.min(info.y + 14, window.innerHeight - 120)}px`;
        tooltip.classList.add("is-visible");
        tooltip.setAttribute("aria-hidden", "false");
    };

    const renderMap = () => {
        if (!overlay || !mapReady || !dataReady) {
            return;
        }

        const visibleStops = getVisibleStops();
        const metricValues = visibleStops.map((stop) => getMetricValue(stop));
        const maxValue = metricValues.reduce((max, value) => Math.max(max, value), 0);

        const renderData = visibleStops.map((stop) => {
            const value = getMetricValue(stop);
            return {
                ...stop,
                __value: value,
                __height: getHeight(value, maxValue),
                __fillColor: getFillColor(value, maxValue)
            };
        });

        const busStopLayer = new deck.ColumnLayer({
            id: "bus-stop-usage-columns",
            data: renderData,
            diskResolution: 4,
            radius: 42,
            extruded: true,
            pickable: true,
            opacity: 0.95,
            getPosition: (d) => [Number(d.lon), Number(d.lat)],
            getElevation: (d) => d.__height,
            getFillColor: (d) => d.__fillColor,
            getLineColor: [15, 54, 29, 255],
            lineWidthMinPixels: 1,
            material: {
                ambient: 0.5,
                diffuse: 0.55,
                shininess: 70,
                specularColor: [210, 255, 214]
            },
            onHover: (info) => {
                if (!info || !info.object) {
                    hoverInfo = null;
                    hideTooltip();
                    return;
                }

                hoverInfo = info;
                showTooltip(info, info.object.__value || 0);
            }
        });

        overlay.setProps({
            layers: [busStopLayer]
        });

        window.__busStopBarsRendered = renderData.length > 0;
        if (!renderData.length) {
            hideTooltip();
        }
    };

    const syncControlState = () => {
        setActiveButton(metricButtons, metricButtons.find((button) => button.dataset.metric === currentMetric) || metricButtons[0]);
        setActiveButton(daytypeButtons, daytypeButtons.find((button) => button.dataset.daytype === currentDayType) || daytypeButtons[0]);
    };

    const clearBusLineSelection = () => {
        if (busLineSelect) {
            busLineSelect.value = "";
        }
        currentBusLine = "";
        renderMap();
    };

    const syncTitleVisibility = () => {
        document.body.classList.toggle("title-hidden", !titleVisible);

        if (titleHeading) {
            titleHeading.hidden = !titleVisible;
        }

        titleDescriptions.forEach((node) => {
            node.hidden = !titleVisible;
        });

        if (legendElement) {
            legendElement.hidden = !titleVisible;
        }

        if (titleHideButton) {
            titleHideButton.classList.toggle("is-active", !titleVisible);
            titleHideButton.setAttribute("aria-pressed", titleVisible ? "false" : "true");
        }

        if (titleShowButton) {
            titleShowButton.classList.toggle("is-active", titleVisible);
            titleShowButton.setAttribute("aria-pressed", titleVisible ? "true" : "false");
        }
    };

    const populateBusLineOptions = (options) => {
        if (!busLineSelect) {
            return;
        }

        busLineSelect.innerHTML = "";

        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Select line";
        busLineSelect.appendChild(placeholder);

        options.forEach((option) => {
            const opt = document.createElement("option");
            opt.value = String(option.value || "");
            opt.textContent = option.label || opt.value;
            busLineSelect.appendChild(opt);
        });

        busLineSelect.value = "";
        currentBusLine = "";
    };

    const updateMetric = (metric) => {
        currentMetric = metric;
        syncControlState();
        renderMap();
    };

    const updateDayType = (dayType) => {
        currentDayType = dayType;
        syncControlState();
        renderMap();
    };

    const updateBusLine = (busLine) => {
        currentBusLine = busLine;
        renderMap();
    };

    if (toggleButton && panel) {
        toggleButton.addEventListener("click", () => {
            const isCollapsed = panel.classList.toggle("is-collapsed");
            toggleButton.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
            toggleButton.textContent = isCollapsed ? "Open Control Panel" : "Close Control Panel";
        });
    }

    metricButtons.forEach((button) => {
        button.addEventListener("click", () => updateMetric(button.dataset.metric || "boardings"));
    });

    daytypeButtons.forEach((button) => {
        button.addEventListener("click", () => updateDayType(button.dataset.daytype || "weekday"));
    });

    if (busLineSelect) {
        busLineSelect.addEventListener("change", () => updateBusLine(busLineSelect.value));
    }

    if (revealMapButton) {
        revealMapButton.addEventListener("click", clearBusLineSelection);
    }

    if (titleHideButton && titleShowButton && titleHeading) {
        titleHideButton.addEventListener("click", () => {
            titleVisible = false;
            syncTitleVisibility();
        });

        titleShowButton.addEventListener("click", () => {
            titleVisible = true;
            syncTitleVisibility();
        });

        syncTitleVisibility();
    }

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
        center: [-123.12, 49.25],
        zoom: 10.7,
        pitch: 58,
        bearing: -20,
        antialias: true
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");

    overlay = new deck.MapboxOverlay({
        interleaved: true,
        layers: []
    });

    const loadBusData = Promise.all([
        fetch(apiUrl, { cache: "no-store" }),
        fetch(busLineOptionsUrl, { cache: "no-store" })
    ]).then(async ([stopResponse, busLineResponse]) => {
        if (!stopResponse.ok) {
            throw new Error("Failed to load bus stop usage data.");
        }

        const stopPayload = await stopResponse.json();
        const busLinePayload = busLineResponse.ok ? await busLineResponse.json() : [];

        stops = Array.isArray(stopPayload.stops) ? stopPayload.stops.map((stop) => ({
            ...stop,
            lat: Number(stop.lat),
            lon: Number(stop.lon),
            line_tokens: Array.isArray(stop.line_tokens) ? stop.line_tokens.map((token) => String(token).trim().toUpperCase()) : [],
            line_metrics: Array.isArray(stop.line_metrics)
                ? stop.line_metrics.map((metric) => ({
                    ...metric,
                    line_number: String(metric.line_number || ""),
                    line_tokens: Array.isArray(metric.line_tokens)
                        ? metric.line_tokens.map((token) => String(token).trim().toUpperCase())
                        : splitLineTokens(metric.line_number),
                    boardings_mf: Number(metric.boardings_mf || 0),
                    alightings_mf: Number(metric.alightings_mf || 0),
                    boardings_sat: Number(metric.boardings_sat || 0),
                    alightings_sat: Number(metric.alightings_sat || 0),
                    boardings_sunhol: Number(metric.boardings_sunhol || 0),
                    alightings_sunhol: Number(metric.alightings_sunhol || 0)
                }))
                : [],
            mf_boardings: Number(stop.boardings_mf || 0),
            mf_alightings: Number(stop.alightings_mf || 0),
            sat_boardings: Number(stop.boardings_sat || 0),
            sat_alightings: Number(stop.alightings_sat || 0),
            sunhol_boardings: Number(stop.boardings_sunhol || 0),
            sunhol_alightings: Number(stop.alightings_sunhol || 0)
        })) : [];

        busLineOptions = Array.isArray(busLinePayload) ? busLinePayload : [];
        populateBusLineOptions(busLineOptions);
        syncControlState();
        dataReady = true;
    }).catch((error) => {
        console.error(error);
        if (tooltip) {
            tooltip.textContent = "Could not load bus stop data.";
            tooltip.classList.add("is-visible");
            tooltip.setAttribute("aria-hidden", "false");
            tooltip.style.left = "18px";
            tooltip.style.top = "18px";
        }
    });

    const attachOverlay = () => {
        if (mapReady) {
            return;
        }

        mapReady = true;
        map.addControl(overlay);
        map.flyTo({
            center: [-123.12, 49.25],
            zoom: 10.95,
            pitch: 62,
            bearing: -26,
            duration: 2200,
            essential: true
        });
        syncControlState();
        renderMap();
    };

    map.on("load", attachOverlay);

    await loadBusData;

    if (map.loaded()) {
        attachOverlay();
    }

    renderMap();

    window.addEventListener("resize", () => {
        if (map && map.resize) {
            map.resize();
        }
    });
})();
