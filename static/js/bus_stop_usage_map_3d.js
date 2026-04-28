(async function initializeBusStopUsageMap() {
    const apiUrl = "/api/bus-stop-usage-map-3d-data?year=2024";
    const busLineOptionsUrl = "/api/bus-line-options?year=2024";

    window.__busStopBarsRendered = false;

    const totalMetricConfig = {
        boardings: {
            label: "Daily Boardings",
            getValue: (stop, dayKey) => stop[`${dayKey}_boardings`]
        },
        alightings: {
            label: "Daily Alightings",
            getValue: (stop, dayKey) => stop[`${dayKey}_alightings`]
        },
        total_usage: {
            label: "Daily Usage",
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
    const heightScaleSlider = document.getElementById("height-scale-slider");
    const heightSliderValue = document.getElementById("height-slider-value");
    const barSizeButtons = Array.from(document.querySelectorAll("[data-bar-size-mode]"));
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
    let barSizeMode = "default";
    let hoverInfo = null;
    let titleVisible = true;

    const BASE_COLUMN_RADIUS = 42;
    const BAY_SINGLE_RADIUS = Math.round(BASE_COLUMN_RADIUS / 2);
    const BAY_CLUSTER_RADIUS = BASE_COLUMN_RADIUS * 2;
    const BAY_CLUSTER_ZOOM_THRESHOLD = 14.4;

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

    const isBayStop = (stop) => {
        if (!stop) {
            return false;
        }

        const hasNumberedBay = (text) => /\bBay\s*#?\s*\d+\b/i.test(String(text || ""));

        // Only treat as a bay stop if either the cluster name or the stop name
        // contains an explicit numbered bay (e.g. "Bay 1"). This ensures
        // clusters aren't ignored when a cluster record exists but its name
        // doesn't include the bay number while individual stop names do.
        if (stop.bay_cluster_id || stop.bay_cluster_name) {
            return hasNumberedBay(stop.bay_cluster_name) || hasNumberedBay(stop.stop_name);
        }

        return hasNumberedBay(stop.stop_name);
    };

    const getBayClusterLabel = (stopName) => {
        const text = String(stopName || "").trim();
        if (!text) {
            return "Bay Cluster";
        }

        const label = text
            .replace(/\s*(?:-|–|—)?\s*\bbay\b.*$/i, "")
            .replace(/\s+/g, " ")
            .trim();

        return label || text;
    };

    const getRoundedCoordinateKey = (stop) => {
        const lat = Number(stop.lat);
        const lon = Number(stop.lon);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            return "unknown";
        }

        return `${lat.toFixed(4)}|${lon.toFixed(4)}`;
    };

    const aggregateBayStops = (bayStops) => {
        if (!Array.isArray(bayStops) || !bayStops.length) {
            return [];
        }

        const aggregatedByCluster = new Map();

        bayStops.forEach((stop) => {
            const clusterKey = stop.bay_cluster_id
                || `${getBayClusterLabel(stop.stop_name).toLowerCase()}|${String(stop.sub_region || "").toLowerCase()}|${String(stop.municipality || "").toLowerCase()}`;
            const existing = aggregatedByCluster.get(clusterKey);

            if (existing) {
                existing.members.push(stop);
                existing.latSum += Number(stop.lat);
                existing.lonSum += Number(stop.lon);
                if (Number.isFinite(Number(stop.bay_cluster_lat)) && Number.isFinite(Number(stop.bay_cluster_lon))) {
                    existing.clusterLat = Number(stop.bay_cluster_lat);
                    existing.clusterLon = Number(stop.bay_cluster_lon);
                }
                existing.boardings_mf += Number(stop.boardings_mf || 0);
                existing.alightings_mf += Number(stop.alightings_mf || 0);
                existing.boardings_sat += Number(stop.boardings_sat || 0);
                existing.alightings_sat += Number(stop.alightings_sat || 0);
                existing.boardings_sunhol += Number(stop.boardings_sunhol || 0);
                existing.alightings_sunhol += Number(stop.alightings_sunhol || 0);

                const lineMetrics = Array.isArray(stop.line_metrics) ? stop.line_metrics : [];
                lineMetrics.forEach((metric) => {
                    const lineNumber = String(metric.line_number || "").trim();
                    if (!lineNumber || lineNumber.toLowerCase() === "nan") {
                        return;
                    }

                    const clusterMetric = existing.lineMetrics.get(lineNumber) || {
                        line_number: lineNumber,
                        line_tokens: new Set(),
                        boardings_mf: 0,
                        alightings_mf: 0,
                        boardings_sat: 0,
                        alightings_sat: 0,
                        boardings_sunhol: 0,
                        alightings_sunhol: 0
                    };

                    clusterMetric.line_tokens = new Set([
                        ...clusterMetric.line_tokens,
                        ...(Array.isArray(metric.line_tokens) ? metric.line_tokens : splitLineTokens(lineNumber))
                    ]);
                    clusterMetric.boardings_mf += Number(metric.boardings_mf || 0);
                    clusterMetric.alightings_mf += Number(metric.alightings_mf || 0);
                    clusterMetric.boardings_sat += Number(metric.boardings_sat || 0);
                    clusterMetric.alightings_sat += Number(metric.alightings_sat || 0);
                    clusterMetric.boardings_sunhol += Number(metric.boardings_sunhol || 0);
                    clusterMetric.alightings_sunhol += Number(metric.alightings_sunhol || 0);

                    existing.lineMetrics.set(lineNumber, clusterMetric);
                });
                return;
            }

            const lineMetrics = new Map();
            const stopLineMetrics = Array.isArray(stop.line_metrics) ? stop.line_metrics : [];
            stopLineMetrics.forEach((metric) => {
                const lineNumber = String(metric.line_number || "").trim();
                if (!lineNumber || lineNumber.toLowerCase() === "nan") {
                    return;
                }

                lineMetrics.set(lineNumber, {
                    line_number: lineNumber,
                    line_tokens: new Set(Array.isArray(metric.line_tokens) ? metric.line_tokens : splitLineTokens(lineNumber)),
                    boardings_mf: Number(metric.boardings_mf || 0),
                    alightings_mf: Number(metric.alightings_mf || 0),
                    boardings_sat: Number(metric.boardings_sat || 0),
                    alightings_sat: Number(metric.alightings_sat || 0),
                    boardings_sunhol: Number(metric.boardings_sunhol || 0),
                    alightings_sunhol: Number(metric.alightings_sunhol || 0)
                });
            });

            aggregatedByCluster.set(clusterKey, {
                members: [stop],
                latSum: Number(stop.lat),
                lonSum: Number(stop.lon),
                clusterLat: Number.isFinite(Number(stop.bay_cluster_lat)) ? Number(stop.bay_cluster_lat) : null,
                clusterLon: Number.isFinite(Number(stop.bay_cluster_lon)) ? Number(stop.bay_cluster_lon) : null,
                stop_name: `${stop.bay_cluster_name || getBayClusterLabel(stop.stop_name)} Bay Cluster`,
                stop_number: `bay-cluster-${aggregatedByCluster.size + 1}`,
                sub_region: stop.sub_region,
                municipality: stop.municipality,
                line_tokens: new Set(Array.isArray(stop.line_tokens) ? stop.line_tokens : []),
                lineMetrics,
                boardings_mf: Number(stop.boardings_mf || 0),
                alightings_mf: Number(stop.alightings_mf || 0),
                boardings_sat: Number(stop.boardings_sat || 0),
                alightings_sat: Number(stop.alightings_sat || 0),
                boardings_sunhol: Number(stop.boardings_sunhol || 0),
                alightings_sunhol: Number(stop.alightings_sunhol || 0)
            });
        });

        return Array.from(aggregatedByCluster.values()).map((cluster) => ({
            stop_number: cluster.stop_number,
            stop_name: cluster.stop_name,
            sub_region: cluster.sub_region,
            municipality: cluster.municipality,
            lat: Number.isFinite(cluster.clusterLat) ? cluster.clusterLat : cluster.latSum / cluster.members.length,
            lon: Number.isFinite(cluster.clusterLon) ? cluster.clusterLon : cluster.lonSum / cluster.members.length,
            line_tokens: Array.from(cluster.line_tokens).sort(),
            line_metrics: Array.from(cluster.lineMetrics.values()).map((metric) => ({
                line_number: metric.line_number,
                line_tokens: Array.from(metric.line_tokens).sort(),
                boardings_mf: metric.boardings_mf,
                alightings_mf: metric.alightings_mf,
                boardings_sat: metric.boardings_sat,
                alightings_sat: metric.alightings_sat,
                boardings_sunhol: metric.boardings_sunhol,
                alightings_sunhol: metric.alightings_sunhol
            })).sort((left, right) => left.line_number.localeCompare(right.line_number, undefined, { numeric: true, sensitivity: "base" })),
            boardings_mf: cluster.boardings_mf,
            alightings_mf: cluster.alightings_mf,
            boardings_sat: cluster.boardings_sat,
            alightings_sat: cluster.alightings_sat,
            boardings_sunhol: cluster.boardings_sunhol,
            alightings_sunhol: cluster.alightings_sunhol,
            bay_count: cluster.members.length,
            bay_members: cluster.members,
            is_bay_cluster: true
        }));
    };

    const getRenderedStops = () => {
        const visibleStops = getVisibleStops();
        const zoom = map && typeof map.getZoom === "function" ? map.getZoom() : 0;

        if (zoom >= BAY_CLUSTER_ZOOM_THRESHOLD) {
            return visibleStops.map((stop) => ({
                ...stop,
                __renderSize: isBayStop(stop) ? BAY_SINGLE_RADIUS : BASE_COLUMN_RADIUS,
                __renderMode: isBayStop(stop) ? "bay" : "regular"
            }));
        }

        const bayStops = [];
        const regularStops = [];

        visibleStops.forEach((stop) => {
            if (isBayStop(stop)) {
                bayStops.push(stop);
            } else {
                regularStops.push({
                    ...stop,
                    __renderSize: BASE_COLUMN_RADIUS,
                    __renderMode: "regular"
                });
            }
        });

        const groupedBayStops = new Map();

        bayStops.forEach((stop) => {
            // Only group multiple bays together when an explicit bay cluster id exists.
            // Otherwise, keep stops separate (use stop_number) to avoid grouping
            // "Place Bay 1" and "Place Bay 2" by place name.
            const clusterKey = stop.bay_cluster_id
                ? String(stop.bay_cluster_id)
                : (stop.stop_number ? `stop-${String(stop.stop_number)}` : `${getBayClusterLabel(stop.stop_name).toLowerCase()}|${String(stop.sub_region || "").toLowerCase()}|${String(stop.municipality || "").toLowerCase()}|${String(stop.stop_number || Math.random())}`);

            const group = groupedBayStops.get(clusterKey);
            if (group) {
                group.push(stop);
            } else {
                groupedBayStops.set(clusterKey, [stop]);
            }
        });

        const clusteredStops = [];
        groupedBayStops.forEach((group) => {
            clusteredStops.push({
                ...aggregateBayStops(group)[0],
                __renderSize: BAY_CLUSTER_RADIUS,
                __renderMode: "bay-cluster"
            });
        });

        return [...regularStops, ...clusteredStops];
    };

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
        if (stop && stop.is_bay_cluster && Array.isArray(stop.bay_members)) {
            const memberLines = stop.bay_members.flatMap((member) => getStopBusLines(member));
            return Array.from(new Set(memberLines));
        }

        const lineMetrics = Array.isArray(stop.line_metrics) ? stop.line_metrics : [];
        const busLines = lineMetrics
            .map((metric) => String(metric.line_number || "").trim())
            .filter((lineNumber) => lineNumber && lineNumber.toLowerCase() !== "nan");

        return Array.from(new Set(busLines));
    };

    const getDayKey = () => dayTypeConfig[currentDayType]?.key || "mf";

    const getMetricLabel = () => totalMetricConfig[currentMetric]?.label || "Usage";

    const getDayLabel = () => dayTypeConfig[currentDayType]?.label || "MF";

    const getLeafMetricValue = (stop) => {
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

    const getVisibleStops = () => {
        if (!getSelectedLineTokens().length) {
            return stops;
        }

        return stops.filter((stop) => getMatchingLineMetric(stop));
    };

    const getMetricValue = (stop) => {
        if (stop && stop.is_bay_cluster && Array.isArray(stop.bay_members) && stop.bay_members.length > 0) {
            return stop.bay_members.reduce((sum, member) => sum + getLeafMetricValue(member), 0);
        }

        return getLeafMetricValue(stop);
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

    const getHeightScalePercent = () => {
        if (!heightScaleSlider) {
            return 100;
        }

        const parsed = Number(heightScaleSlider.value);
        if (!Number.isFinite(parsed)) {
            return 100;
        }

        return Math.max(15, Math.min(300, parsed));
    };

    const updateHeightScaleLabel = () => {
        if (heightSliderValue) {
            heightSliderValue.textContent = `${Math.round(getHeightScalePercent())}%`;
        }
    };

    const getHeightScaleMultiplier = () => {
        const scalePercent = getHeightScalePercent();

        // Keep low-end scale compressed: at 15%, bars are below one-third of 100% height.
        if (scalePercent <= 100) {
            const t = (scalePercent - 15) / 85;
            return 0.3 + Math.max(0, Math.min(1, t)) * 0.95;
        }

        // Beyond 100% ramp up sharply toward 300%.
        const over = (scalePercent - 100) / 200;
        return 1.25 + Math.pow(over, 2.1) * 3.75;
    };

    const getHeight = (value, maxValue) => {
        const safeMax = maxValue > 0 ? maxValue : 1;
        const ratio = Math.max(0, Math.min(1, value / safeMax));
        const scaledHeight = ratio * 2200 * getHeightScaleMultiplier();

        if (barSizeMode === "to_scale") {
            return scaledHeight;
        }

        return 30 * getHeightScaleMultiplier() + scaledHeight;
    };

    const updateBarSizeButtons = () => {
        barSizeButtons.forEach((button) => {
            button.classList.toggle("is-active", button.dataset.barSizeMode === barSizeMode);
        });
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
        const lineLabel = busLines.length === 0 
            ? "Bus Line(s): N/A"
            : `Bus Line${busLines.length === 1 ? "" : "s"}: ${busLines.join(", ")}`;
        const clusterLabel = stop.bay_count > 1 ? `<p class="map-tooltip-line">Bay cluster: ${numberFormatter.format(stop.bay_count)} bays</p>` : "";

        tooltip.innerHTML = [
            `<p class="map-tooltip-title">${stop.stop_name}</p>`,
            `<p class="map-tooltip-line">${getMetricLabel()} (${getDayLabel()}): ${numberFormatter.format(value)}</p>`,
            clusterLabel,
            `<p class="map-tooltip-line">${lineLabel}</p>`
        ].filter(Boolean).join("");
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
        const renderStops = getRenderedStops();
        const metricValues = visibleStops.map((stop) => getMetricValue(stop));
        const maxValue = metricValues.reduce((max, value) => Math.max(max, value), 0);

        const renderData = renderStops.map((stop) => {
            const value = getMetricValue(stop);
            return {
                ...stop,
                __value: value,
                __height: getHeight(value, maxValue),
                __fillColor: getFillColor(value, maxValue)
            };
        });

        const regularData = renderData.filter((stop) => stop.__renderMode === "regular");
        const bayData = renderData.filter((stop) => stop.__renderMode !== "regular");
        const bayRadius = map.getZoom() >= BAY_CLUSTER_ZOOM_THRESHOLD ? BAY_SINGLE_RADIUS : BAY_CLUSTER_RADIUS;

        const layers = [];

        if (regularData.length) {
            layers.push(new deck.ColumnLayer({
                id: "bus-stop-usage-regular-columns",
                data: regularData,
                diskResolution: 4,
                radius: BASE_COLUMN_RADIUS,
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
            }));
        }

        if (bayData.length) {
            layers.push(new deck.ColumnLayer({
                id: "bus-stop-usage-bay-columns",
                data: bayData,
                diskResolution: 4,
                radius: bayRadius,
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
            }));
        }

        overlay.setProps({
            layers
        });

        window.__busStopBarsRendered = renderData.length > 0;
        if (!renderData.length) {
            hideTooltip();
        }
    };

    const focusMapOnSelectedBusLine = () => {
        if (!map || !mapReady || !dataReady || !currentBusLine) {
            return;
        }

        const selectedStops = getVisibleStops();
        if (!selectedStops.length) {
            return;
        }

        const coordinates = selectedStops
            .map((stop) => [Number(stop.lon), Number(stop.lat)])
            .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));

        if (!coordinates.length) {
            return;
        }

        if (coordinates.length === 1) {
            map.easeTo({
                center: coordinates[0],
                zoom: 13.4,
                duration: 1200,
                essential: true
            });
            return;
        }

        const bounds = coordinates.reduce((accumulator, coordinate) => {
            accumulator.extend(coordinate);
            return accumulator;
        }, new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));

        map.fitBounds(bounds, {
            padding: { top: 120, bottom: 120, left: 120, right: 120 },
            maxZoom: 13.6,
            duration: 1200,
            essential: true
        });
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
        focusMapOnSelectedBusLine();
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

    barSizeButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const mode = button.dataset.barSizeMode;
            if (mode !== "default" && mode !== "to_scale") {
                return;
            }

            barSizeMode = mode;
            updateBarSizeButtons();
            renderMap();
        });
    });

    if (heightScaleSlider) {
        updateHeightScaleLabel();
        heightScaleSlider.addEventListener("input", () => {
            updateHeightScaleLabel();
            renderMap();
        });
    }

    updateBarSizeButtons();

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

    map.on("zoomend", () => {
        renderMap();
    });

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
