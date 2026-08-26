(async function initializeBusLineUsageMap() {
    const apiBaseUrl = "/api/bus-line-usage-map-3d-data";
    const mapModeButtons = Array.from(document.querySelectorAll(".map-mode-button"));
    const mapModePanels = Array.from(document.querySelectorAll("[data-map-mode-panel]"));
    const filterConfigs = [
        {
            key: "sub_region_of_primary_service",
            containerId: "sub-region-buttons"
        },
        {
            key: "predominant_vehicle_type",
            containerId: "vehicle-type-buttons"
        },
        {
            key: "tsg_service_type",
            containerId: "service-type-buttons"
        }
    ];
    const filterButtonContainers = Object.fromEntries(
        filterConfigs.map((config) => [config.key, document.getElementById(config.containerId)])
    );
    const panel = document.getElementById("control-panel");
    const toggleButton = document.getElementById("control-panel-toggle");
    const lineWidthSlider = document.getElementById("line-width-slider");
    const lineWidthValue = document.getElementById("line-width-value");
    const legendTitle = document.getElementById("legend-title");
    const legendMin = document.getElementById("legend-min");
    const legendMax = document.getElementById("legend-max");
    const tooltip = document.getElementById("map-tooltip");
    const titleHeading = document.querySelector(".overlay h1");
    const titleDescriptions = Array.from(document.querySelectorAll(".overlay p"));
    const legendElement = document.querySelector(".legend");
    const titleHideButton = document.getElementById("title-hide-button");
    const titleShowButton = document.getElementById("title-show-button");
    const modeTitle = document.getElementById("map-mode-title");
    const modeDescription = document.getElementById("map-mode-description");
    const pageHeading = document.getElementById("map-mode-heading");
    const pageDetail = document.getElementById("map-mode-detail");
    const pageSummary = document.getElementById("map-mode-summary");

    const metricConfig = {
        annual_boardings: { label: "Annual Boardings" },
        weekday: { label: "MF Daily Boardings" },
        saturday: { label: "Sat Daily Boardings" },
        sunday: { label: "Sun Daily Boardings" },
        revenue_hours: { label: "Annual Revenue Hours" },
        service_hours: { label: "Annual Service Hours" },
        boardings_per_revenue_hour: { label: "Boardings per Revenue Hour" },
        peak_passenger_load: { label: "Peak Passenger Load" },
        peak_load_factor: { label: "Peak Load Factor" },
        capacity_utilization: { label: "Capacity Utilization" },
        overcrowded_revenue_hours: { label: "Overcrowding Revenue Hours" },
        overcrowded_trips_percent: { label: "% Over Crowded Trips" },
        on_time_performance: { label: "% On Time Performance", visualMode: "color", higherIsBetter: true },
        bus_bunching_percentage: { label: "% Bus Bunching", visualMode: "color", higherIsBetter: false },
        avg_speed_kph: { label: "Avg Speed", visualMode: "color", higherIsBetter: true },
        annual_revenue_hours: { label: "Annual Revenue Hours" },
        annual_service_hours: { label: "Annual Service Hours" },
        trips_per_clock_hour_per_direction: { label: "Trips per Clock Hour per Direction" },
        boardings_per_trip: { label: "Boardings per Trip" },
        avg_peak_passenger_load_north_east: { label: "Avg Peak Passenger Load (North/East)" },
        avg_peak_passenger_load_south_west: { label: "Avg Peak Passenger Load (South/West)" },
        avg_peak_load_factor_north_east: { label: "Avg Peak Load Factor (North/East)" },
        avg_peak_load_factor_south_west: { label: "Avg Peak Load Factor (South/West)" }
    };

    const percentMetrics = new Set([
        "peak_load_factor",
        "capacity_utilization",
        "overcrowded_trips_percent",
        "on_time_performance",
        "bus_bunching_percentage",
        "avg_peak_load_factor_north_east",
        "avg_peak_load_factor_south_west"
    ]);

    const colorScaleMetrics = new Set([
        "on_time_performance",
        "bus_bunching_percentage",
        "avg_speed_kph"
    ]);

    const colorScaleMaxOverrides = {
        avg_speed_kph: 45
    };

    let map = null;
    let overlay = null;
    let mapReady = false;
    let dataReady = false;
    let fittedBounds = false;
    let bounds = null;
    let lines = [];
    let filterOptions = {
        sub_region_of_primary_service: [],
        predominant_vehicle_type: [],
        tsg_service_type: []
    };
    let activeFilters = {
        sub_region_of_primary_service: [],
        predominant_vehicle_type: [],
        tsg_service_type: []
    };
    let activeMapMode = "annual";
    let activeMetricByMode = {
        annual: "annual_boardings",
        deep: "annual_revenue_hours"
    };
    let hoverInfo = null;
    let activeMetric = activeMetricByMode[activeMapMode];
    let lineWidthPercent = 100;
    let titleVisible = true;
    let currentRequestId = 0;
    let deepSelections = {
        day: "MF",
        season: "Fall",
        timeRange: "4-6"
    };

    const numberFormatter = new Intl.NumberFormat("en-CA", {
        maximumFractionDigits: 2
    });

    const formatMetricValue = (metricKey, value) => {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return "-";
        }

        if (metricKey === "avg_speed_kph") {
            const mphValue = numericValue * 0.621371;
            return `${numberFormatter.format(numericValue)} KPH / ${numberFormatter.format(mphValue)} MPH`;
        }

        if (percentMetrics.has(metricKey)) {
            return `${numericValue.toFixed(2)}%`;
        }

        if (Math.abs(numericValue) >= 1000) {
            return Math.round(numericValue).toLocaleString("en-CA");
        }

        return numberFormatter.format(numericValue);
    };

    const setActiveButton = (buttons, activeButton) => {
        buttons.forEach((button) => button.classList.toggle("is-active", button === activeButton));
    };

    const setButtonActiveState = (button, isActive) => {
        if (!button) {
            return;
        }

        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", String(Boolean(isActive)));
    };

    const getMetricButtonsForMode = (mode) => Array.from(
        document.querySelectorAll(`.metric-button[data-map-mode="${mode}"]`)
    );

    const getDeepButtonsForGroup = (groupName) => Array.from(
        document.querySelectorAll(`.deep-mode-button[data-deep-group="${groupName}"]`)
    );

    const syncMapModeButtons = () => {
        mapModeButtons.forEach((button) => {
            setButtonActiveState(button, (button.dataset.mapMode || "annual") === activeMapMode);
        });

        mapModePanels.forEach((panelElement) => {
            panelElement.hidden = (panelElement.dataset.mapModePanel || "annual") !== activeMapMode;
        });

        if (modeTitle) {
            modeTitle.textContent = activeMapMode === "deep" ? "2023 Deep Stats" : "2024 Metrics";
        }

        if (modeDescription) {
            modeDescription.textContent = activeMapMode === "deep"
                ? "Switch the time slice, then color or thicken all lines by the selected 2023 deep metric."
                : "Switch between annual and day-based 2024 metrics while keeping the same line geometry.";
        }

        if (pageHeading) {
            pageHeading.textContent = activeMapMode === "deep"
                ? "3D Bus Line Usage Map (2023 Deep Stats)"
                : "3D Bus Line Usage Map (2024)";
        }

        if (pageDetail) {
            pageDetail.textContent = activeMapMode === "deep"
                ? "Each line keeps a fixed color while tube width scales to the selected 2023 bus-line metric and time range."
                : "Each line keeps a fixed color while tube width scales to the selected 2024 bus-line metric.";
        }

        if (pageSummary) {
            const metricLabel = metricConfig[activeMetric]?.label || "Metric";
            if (activeMapMode === "deep") {
                const dayLabel = deepSelections.day || "MF";
                const seasonLabel = deepSelections.season || "Fall";
                const timeLabel = deepSelections.timeRange || "4-6";
                pageSummary.textContent = `Showing results for ${metricLabel} during ${seasonLabel} ${dayLabel} hours of ${timeLabel}`;
            } else {
                pageSummary.textContent = `Showing results for ${metricLabel}`;
            }
        }
    };

    const syncSummaryLine = () => {
        if (!pageSummary) {
            return;
        }

        const metricLabel = metricConfig[activeMetric]?.label || "Metric";
        if (activeMapMode === "deep") {
            const dayLabel = deepSelections.day || "MF";
            const seasonLabel = deepSelections.season || "Fall";
            const timeLabel = deepSelections.timeRange || "4-6";
            pageSummary.textContent = `Showing results for ${metricLabel} during ${seasonLabel} ${dayLabel} hours of ${timeLabel}`;
        } else {
            pageSummary.textContent = `Showing results for ${metricLabel}`;
        }
    };

    const syncDeepSelectionButtons = () => {
        ["day", "season", "timeRange"].forEach((groupName) => {
            const buttons = getDeepButtonsForGroup(groupName);
            const selectedValue = deepSelections[groupName];
            buttons.forEach((button) => {
                setButtonActiveState(button, (button.dataset.value || "") === selectedValue);
            });
        });
    };

    const normalizeFilterValue = (value) => {
        const text = String(value || "").trim();
        if (!text || text.toLowerCase() === "nan") {
            return "";
        }

        return text;
    };

    const populateFilterButtons = (options) => {
        filterConfigs.forEach((config) => {
            const container = filterButtonContainers[config.key];
            if (!container) {
                return;
            }

            const values = Array.isArray(options?.[config.key]) ? options[config.key] : [];
            container.innerHTML = "";

            const allButton = document.createElement("button");
            allButton.type = "button";
            allButton.className = "filter-button";
            allButton.dataset.filterGroup = config.key;
            allButton.dataset.filterValue = "all";
            allButton.textContent = "All";
            container.appendChild(allButton);

            values.forEach((value) => {
                const normalizedValue = normalizeFilterValue(value);
                if (!normalizedValue) {
                    return;
                }

                const button = document.createElement("button");
                button.type = "button";
                button.className = "filter-button";
                button.dataset.filterGroup = config.key;
                button.dataset.filterValue = normalizedValue;
                button.textContent = normalizedValue;
                container.appendChild(button);
            });
        });

        syncFilterButtons();
    };

    const syncMetricButtons = () => {
        const metricButtons = getMetricButtonsForMode(activeMapMode);
        const activeButton = metricButtons.find((button) => button.dataset.metric === activeMetric) || metricButtons[0];
        setActiveButton(metricButtons, activeButton);
    };

    const syncFilterButtons = () => {
        filterConfigs.forEach((config) => {
            const container = filterButtonContainers[config.key];
            if (!container) {
                return;
            }

            const buttons = Array.from(container.querySelectorAll(".filter-button"));
            const selectedValues = Array.isArray(activeFilters[config.key]) ? activeFilters[config.key] : [];

            buttons.forEach((button) => {
                const value = button.dataset.filterValue || "all";
                const isActive = value === "all"
                    ? selectedValues.length === 0
                    : selectedValues.includes(value);
                setButtonActiveState(button, isActive);
            });
        });
    };

    const syncLineWidthControl = () => {
        if (lineWidthSlider) {
            lineWidthSlider.value = String(lineWidthPercent);
            lineWidthSlider.setAttribute("aria-valuenow", String(lineWidthPercent));
        }

        if (lineWidthValue) {
            lineWidthValue.textContent = `${lineWidthPercent}%`;
        }
    };

    const togglePanel = () => {
        if (!panel || !toggleButton) {
            return;
        }

        const isCollapsed = panel.classList.toggle("is-collapsed");
        toggleButton.setAttribute("aria-expanded", String(!isCollapsed));
        toggleButton.textContent = isCollapsed ? "Open Control Panel" : "Close Control Panel";
    };

    const syncTitleVisibility = () => {
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

    const updateLegend = (minValue, maxValue) => {
        if (legendTitle) {
            const metricLabel = metricConfig[activeMetric]?.label || "Metric";
            legendTitle.textContent = activeMetric === "avg_speed_kph" ? `${metricLabel} (KPH / MPH)` : metricLabel;
        }

        if (legendMin) {
            legendMin.textContent = formatMetricValue(activeMetric, minValue);
        }

        if (legendMax) {
            legendMax.textContent = formatMetricValue(activeMetric, maxValue);
        }

        const legendMode = colorScaleMetrics.has(activeMetric) ? "color" : "width";
        const legendSvg = document.getElementById('legend-svg');
        if (legendSvg) {
            legendSvg.innerHTML = '';
            if (legendMode === "color") {
                const svgNs = 'http://www.w3.org/2000/svg';
                const defs = document.createElementNS(svgNs, 'defs');
                const gradient = document.createElementNS(svgNs, 'linearGradient');
                const gradientId = `legend-gradient-${activeMetric}`;
                const higherIsBetter = metricConfig[activeMetric]?.higherIsBetter !== false;

                gradient.setAttribute('id', gradientId);
                gradient.setAttribute('x1', '0%');
                gradient.setAttribute('y1', '0%');
                gradient.setAttribute('x2', '100%');
                gradient.setAttribute('y2', '0%');

                const stops = higherIsBetter
                    ? [
                        ['0%', '#ef5a4a'],
                        ['50%', '#f0c847'],
                        ['100%', '#39c46d']
                    ]
                    : [
                        ['0%', '#39c46d'],
                        ['50%', '#f0c847'],
                        ['100%', '#ef5a4a']
                    ];

                stops.forEach(([offset, color]) => {
                    const stop = document.createElementNS(svgNs, 'stop');
                    stop.setAttribute('offset', offset);
                    stop.setAttribute('stop-color', color);
                    gradient.appendChild(stop);
                });

                defs.appendChild(gradient);
                legendSvg.appendChild(defs);

                const bar = document.createElementNS(svgNs, 'rect');
                bar.setAttribute('x', '8');
                bar.setAttribute('y', '32');
                bar.setAttribute('width', '184');
                bar.setAttribute('height', '16');
                bar.setAttribute('rx', '8');
                bar.setAttribute('fill', `url(#${gradientId})`);
                bar.setAttribute('opacity', '0.95');
                legendSvg.appendChild(bar);
            } else {
                const baseColor = '#52c875'; // Green from theme

                // Create a polygon that tapers from thin (left) to wide (right)
                // Top edge: starts at (10, 38), ends at (190, 30)
                // Bottom edge: starts at (10, 42), ends at (190, 50)
                const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                polygon.setAttribute('points', '10,38 190,30 190,50 10,42');
                polygon.setAttribute('fill', baseColor);
                polygon.setAttribute('opacity', '0.85');

                legendSvg.appendChild(polygon);
            }
        }
    };

    const getMetricValue = (line) => {
        const metrics = line && line.metrics ? line.metrics : {};
        const rawValue = metrics[activeMetric];
        const numericValue = Number(rawValue);
        return Number.isFinite(numericValue) ? numericValue : 0;
    };

    const normalizeLineCode = (value) => {
        const text = String(value || "").trim();
        if (!text) {
            return "";
        }

        if (/^\d+$/.test(text)) {
            return String(Number(text));
        }

        return text;
    };

    const isPriorityLine = (line) => {
        const key = normalizeLineCode(line?.group_code || line?.line || "");
        return key === "9" || key === "41";
    };

    const getHoveredLineKey = () => {
        if (!hoverInfo || !hoverInfo.object) {
            return null;
        }

        return String(hoverInfo.object.group_code || hoverInfo.object.line || "").trim() || null;
    };

    const matchesSelectedFilters = (line) => {
        return filterConfigs.every((config) => {
            const selectedValues = Array.isArray(activeFilters[config.key]) ? activeFilters[config.key] : [];
            if (!selectedValues.length) {
                return true;
            }

            const lineValue = normalizeFilterValue(line?.[config.key]);
            return selectedValues.includes(lineValue);
        });
    };

    const collectFilterOptionsFromLines = (sourceLines) => {
        const collected = {
            sub_region_of_primary_service: [],
            predominant_vehicle_type: [],
            tsg_service_type: []
        };

        filterConfigs.forEach((config) => {
            const seen = new Set();
            sourceLines.forEach((line) => {
                const value = normalizeFilterValue(line?.[config.key]);
                if (value && !seen.has(value)) {
                    seen.add(value);
                    collected[config.key].push(value);
                }
            });
        });

        return collected;
    };

    const getTubeWidth = (value, maxValue) => {
        const scale = (lineWidthPercent / 100) * 2;

        if (maxValue <= 0) {
            return Math.max(1, 8 * scale);
        }

        const ratio = Math.max(0, Math.min(1, value / maxValue));
        const eased = Math.pow(ratio, 0.62);
        const baseWidth = Math.max(6, 10 + eased * 74);
        return Math.max(1, baseWidth * scale);
    };

    const getUniformTubeWidth = () => {
        const scale = (lineWidthPercent / 100) * 2;
        return Math.max(1, 32 * scale);
    };

    const interpolateColor = (startColor, endColor, ratio) => {
        const clampedRatio = Math.max(0, Math.min(1, ratio));
        return [
            Math.round(startColor[0] + (endColor[0] - startColor[0]) * clampedRatio),
            Math.round(startColor[1] + (endColor[1] - startColor[1]) * clampedRatio),
            Math.round(startColor[2] + (endColor[2] - startColor[2]) * clampedRatio),
            255
        ];
    };

    const getPerformanceColor = (value, minValue, maxValue, higherIsBetter) => {
        const green = [82, 200, 117];
        const yellow = [240, 200, 71];
        const red = [239, 90, 74];

        if (!Number.isFinite(value)) {
            return green;
        }

        if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || maxValue <= minValue) {
            return higherIsBetter ? yellow : yellow;
        }

        let ratio = (value - minValue) / (maxValue - minValue);
        ratio = Math.max(0, Math.min(1, ratio));
        if (!higherIsBetter) {
            ratio = 1 - ratio;
        }

        if (ratio <= 0.5) {
            return interpolateColor(red, yellow, ratio * 2);
        }

        return interpolateColor(yellow, green, (ratio - 0.5) * 2);
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

    const hideTooltip = () => {
        if (!tooltip) {
            return;
        }

        tooltip.classList.remove("is-visible");
        tooltip.setAttribute("aria-hidden", "true");
        tooltip.innerHTML = "";
    };

    const positionTooltip = (event) => {
        if (!tooltip || !event) {
            return;
        }

        const padding = 14;
        const viewportPadding = 18;
        const tooltipWidth = tooltip.offsetWidth || 300;
        const tooltipHeight = tooltip.offsetHeight || 120;
        const maxLeft = window.innerWidth - tooltipWidth - viewportPadding;
        const maxTop = window.innerHeight - tooltipHeight - viewportPadding;
        const left = Math.min(event.x + padding, maxLeft);
        const top = Math.min(event.y + padding, maxTop);

        tooltip.style.left = `${Math.max(viewportPadding, left)}px`;
        tooltip.style.top = `${Math.max(viewportPadding, top)}px`;
    };

    const showTooltip = (event) => {
        if (!tooltip || !event || !event.object) {
            hoverInfo = null;
            renderCurrentView();
            hideTooltip();
            return;
        }

        const line = event.object;
        const metricLabel = metricConfig[activeMetric]?.label || "Metric";
        const metricValue = formatMetricValue(activeMetric, line.__metricValue);
        const routeName = line.line_name || line.shape_name || "";
        const description = line.description ? `<p class="map-tooltip-line">${line.description}</p>` : "";
        const lineTitle = line.group_code || line.line_label || line.line || "Bus Line";

        hoverInfo = event;
        renderCurrentView();

        tooltip.innerHTML = [
            `<p class="map-tooltip-title">${lineTitle}</p>`,
            routeName ? `<p class="map-tooltip-line">${routeName}</p>` : "",
            `<p class="map-tooltip-line">${metricLabel}: ${metricValue}</p>`,
            description
        ].join("");
        tooltip.classList.add("is-visible");
        tooltip.setAttribute("aria-hidden", "false");
        positionTooltip(event);
    };

    const buildLayers = (renderData) => {
        return [
            new deck.PathLayer({
                id: "bus-line-glow",
                data: renderData,
                pickable: false,
                widthUnits: "meters",
                rounded: true,
                capRounded: true,
                jointRounded: true,
                billboard: false,
                opacity: 0.16,
                getPath: (line) => line.coordinates,
                getColor: (line) => {
                    const color = line.__isHovered ? line.__hoverFillColor : line.__fillColor;
                    return [color[0], color[1], color[2], 85];
                },
                getWidth: (line) => (line.__isHovered ? line.__hoverTubeWidth : line.__tubeWidth) * 1.9,
                parameters: {
                    depthTest: false,
                    depthMask: false
                }
            }),
            new deck.PathLayer({
                id: "bus-line-rim",
                data: renderData,
                pickable: true,
                widthUnits: "meters",
                rounded: true,
                capRounded: true,
                jointRounded: true,
                billboard: false,
                opacity: 1,
                getPath: (line) => line.coordinates,
                getColor: (line) => {
                    const baseColor = line.__isHovered ? line.__hoverFillColor : line.__fillColor;
                    const darker = shadeColor(baseColor, line.__isHovered ? 0.1 : -0.16);
                    return [darker[0], darker[1], darker[2], 255];
                },
                getWidth: (line) => (line.__isHovered ? line.__hoverTubeWidth : line.__tubeWidth),
                onHover: showTooltip,
                parameters: {
                    depthTest: false,
                    depthMask: false
                }
            }),
            new deck.PathLayer({
                id: "bus-line-core",
                data: renderData,
                pickable: true,
                widthUnits: "meters",
                rounded: true,
                capRounded: true,
                jointRounded: true,
                billboard: false,
                opacity: 1,
                getPath: (line) => line.coordinates,
                getColor: (line) => (line.__isHovered ? line.__hoverFillColor : line.__fillColor),
                getWidth: (line) => (line.__isHovered ? line.__hoverTubeWidth : line.__tubeWidth) * 0.84,
                onHover: showTooltip,
                parameters: {
                    depthTest: false,
                    depthMask: false
                }
            }),
            new deck.PathLayer({
                id: "bus-line-highlight",
                data: renderData,
                pickable: false,
                widthUnits: "meters",
                rounded: true,
                capRounded: true,
                jointRounded: true,
                billboard: false,
                opacity: 0.9,
                getPath: (line) => line.coordinates,
                getColor: (line) => {
                    const baseColor = line.__isHovered ? line.__hoverFillColor : line.__fillColor;
                    const lighter = shadeColor(baseColor, line.__isHovered ? 0.48 : 0.32);
                    return [lighter[0], lighter[1], lighter[2], 255];
                },
                getWidth: (line) => (line.__isHovered ? line.__hoverTubeWidth : line.__tubeWidth) * 0.22,
                onHover: showTooltip,
                parameters: {
                    depthTest: false,
                    depthMask: false
                }
            })
        ];
    };

    const renderCurrentView = () => {
        if (!mapReady || !dataReady || !overlay || !lines.length) {
            return;
        }

        const visibleLines = lines.filter(matchesSelectedFilters);
        const hoveredLineKey = getHoveredLineKey();
        const sortedLines = visibleLines
            .map((line, index) => ({ line, index }))
            .sort((left, right) => {
                const leftHovered = hoveredLineKey && hoveredLineKey === normalizeLineCode(left.line?.group_code || left.line?.line || "") ? 1 : 0;
                const rightHovered = hoveredLineKey && hoveredLineKey === normalizeLineCode(right.line?.group_code || right.line?.line || "") ? 1 : 0;
                if (leftHovered !== rightHovered) {
                    return leftHovered - rightHovered;
                }
                const leftPriority = isPriorityLine(left.line) ? 1 : 0;
                const rightPriority = isPriorityLine(right.line) ? 1 : 0;
                if (leftPriority !== rightPriority) {
                    return leftPriority - rightPriority;
                }
                return left.index - right.index;
            })
            .map((entry) => entry.line);
        const values = visibleLines.map((line) => getMetricValue(line));
        const maxValue = values.length ? Math.max(...values, 1) : 1;
        const minValue = values.length ? Math.min(...values) : 0;
        const useColorScale = colorScaleMetrics.has(activeMetric);
        const colorScaleMaxValue = colorScaleMaxOverrides[activeMetric] || maxValue;

        updateLegend(minValue, useColorScale ? colorScaleMaxValue : maxValue);

        const renderData = sortedLines.map((line) => {
            const metricValue = getMetricValue(line);
            const baseColor = Array.isArray(line.color) ? line.color : [82, 200, 117];
            const fillColor = useColorScale
                ? getPerformanceColor(metricValue, minValue, colorScaleMaxValue, metricConfig[activeMetric]?.higherIsBetter !== false)
                : (metricValue === 0 ? [126, 136, 142] : baseColor);
            const tubeWidth = useColorScale ? getUniformTubeWidth() : getTubeWidth(metricValue, maxValue);
            const lineKey = String(line.group_code || line.line || "").trim();
            const isHovered = hoveredLineKey && hoveredLineKey === lineKey;

            const brightenColor = (color, amount) => {
                const factor = Math.max(0, Math.min(1, amount));
                return [
                    Math.round(color[0] + (255 - color[0]) * factor),
                    Math.round(color[1] + (255 - color[1]) * factor),
                    Math.round(color[2] + (255 - color[2]) * factor),
                    color[3]
                ];
            };

            return {
                ...line,
                __metricValue: metricValue,
                __tubeWidth: tubeWidth,
                __fillColor: fillColor,
                __isHovered: isHovered,
                __hoverFillColor: isHovered ? brightenColor(fillColor, useColorScale ? 0.42 : 0.35) : fillColor,
                __hoverTubeWidth: useColorScale ? tubeWidth : (isHovered ? tubeWidth * 1.15 : tubeWidth)
            };
        });

        overlay.setProps({
            layers: buildLayers(renderData)
        });
        syncSummaryLine();
    };

    const fitMapBounds = () => {
        if (!map || fittedBounds) {
            return;
        }

        map.flyTo({
            center: [-123.12, 49.25],
            zoom: 12.25,
            pitch: 58,
            bearing: -20,
            duration: 1200,
            essential: true
        });
        fittedBounds = true;
    };

    const loadData = async () => {
        const requestId = ++currentRequestId;
        const response = await fetch(buildDataUrl());
        if (!response.ok) {
            throw new Error(`Failed to load bus line usage data (${response.status})`);
        }

        const payload = await response.json();
        if (payload.error) {
            throw new Error(payload.error);
        }

        if (requestId !== currentRequestId) {
            return;
        }

        lines = Array.isArray(payload.lines) ? payload.lines : [];
        bounds = Array.isArray(payload.bounds) ? payload.bounds : null;

        filterOptions = payload.filter_options && typeof payload.filter_options === "object"
            ? payload.filter_options
            : collectFilterOptionsFromLines(lines);
        if (activeMapMode !== "annual") {
            const hasAnyFilters = Object.values(filterOptions).some((values) => Array.isArray(values) && values.length);
            if (!hasAnyFilters) {
                filterOptions = collectFilterOptionsFromLines(lines);
            }
        }
        populateFilterButtons(filterOptions);

        if (payload.time_range) {
            deepSelections.timeRange = payload.time_range;
        }

        dataReady = true;
        fitMapBounds();
        renderCurrentView();
    };

    const initializeMap = () => {
        map = new maplibregl.Map({
            container: "map",
            style: {
                version: 8,
                sources: {
                    osm: {
                        type: "raster",
                        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"],
                        tileSize: 256,
                        attribution: "Tiles &copy; Esri"
                    }
                },
                layers: [{
                    id: "osm-raster",
                    type: "raster",
                    source: "osm",
                    paint: {
                        "raster-brightness-min": 0,
                        "raster-brightness-max": 0.28
                    }
                }]
            },
            center: [-123.12, 49.25],
            zoom: 10.95,
            pitch: 58,
            bearing: -20,
            antialias: true
        });

        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

        overlay = new deck.MapboxOverlay({
            interleaved: false,
            layers: []
        });
        map.addControl(overlay);

        map.on("load", () => {
            mapReady = true;
            fitMapBounds();
            renderCurrentView();
        });

        map.on("mouseleave", () => {
            hoverInfo = null;
            hideTooltip();
            renderCurrentView();
        });
    };

    const buildDataUrl = () => {
        if (activeMapMode === "deep") {
            const params = new URLSearchParams({
                year: "2023",
                mode: "deep",
                day: deepSelections.day,
                season: deepSelections.season,
                time_range: deepSelections.timeRange
            });
            return `${apiBaseUrl}?${params.toString()}`;
        }

        return `${apiBaseUrl}?year=2024`;
    };

    const setMapMode = async (mode) => {
        if (mode !== "annual" && mode !== "deep") {
            return;
        }

        activeMapMode = mode;
        activeMetric = activeMetricByMode[activeMapMode] || activeMetric;
        syncMapModeButtons();
        syncMetricButtons();
        syncDeepSelectionButtons();
        await loadData();
    };

    try {
        if (lineWidthSlider) {
            lineWidthPercent = Number(lineWidthSlider.value) || 100;
            syncLineWidthControl();
            lineWidthSlider.addEventListener("input", () => {
                lineWidthPercent = Number(lineWidthSlider.value) || 100;
                syncLineWidthControl();
                renderCurrentView();
            });
        } else {
            syncLineWidthControl();
        }

        if (titleHideButton) {
            titleHideButton.addEventListener("click", () => {
                titleVisible = false;
                syncTitleVisibility();
            });
        }

        if (titleShowButton) {
            titleShowButton.addEventListener("click", () => {
                titleVisible = true;
                syncTitleVisibility();
            });
        }

        syncMapModeButtons();
        syncDeepSelectionButtons();
        syncMetricButtons();
        syncTitleVisibility();
        initializeMap();
        await loadData();
    } catch (error) {
        if (legendTitle) {
            legendTitle.textContent = "Unable to load bus line map";
        }
        if (legendMin) {
            legendMin.textContent = "-";
        }
        if (legendMax) {
            legendMax.textContent = "-";
        }
        if (tooltip) {
            tooltip.innerHTML = `<p class="map-tooltip-title">Error</p><p class="map-tooltip-line">${error.message || "Failed to load data."}</p>`;
            tooltip.classList.add("is-visible");
            tooltip.setAttribute("aria-hidden", "false");
            tooltip.style.left = "24px";
            tooltip.style.top = "24px";
        }
        console.error(error);
    }

    document.addEventListener("click", async (event) => {
        const modeButton = event.target.closest(".map-mode-button");
        if (modeButton) {
            await setMapMode(modeButton.dataset.mapMode || "annual");
            return;
        }

        const metricButton = event.target.closest(`.metric-button[data-map-mode="${activeMapMode}"]`);
        if (metricButton) {
            activeMetric = metricButton.dataset.metric || "annual_boardings";
            activeMetricByMode[activeMapMode] = activeMetric;
            syncMetricButtons();
            renderCurrentView();
            return;
        }

        const deepButton = event.target.closest(".deep-mode-button");
        if (deepButton) {
            const groupName = deepButton.dataset.deepGroup;
            const selectedValue = deepButton.dataset.value || "";
            if (groupName && Object.prototype.hasOwnProperty.call(deepSelections, groupName)) {
                deepSelections[groupName] = selectedValue;
                syncDeepSelectionButtons();

                if (activeMapMode === "deep") {
                    await loadData();
                }
            }
            return;
        }

        const filterButton = event.target.closest(".filter-button");
        if (filterButton) {
            const filterGroup = filterButton.dataset.filterGroup;
            if (filterGroup && Object.prototype.hasOwnProperty.call(activeFilters, filterGroup)) {
                const filterValue = filterButton.dataset.filterValue || "all";
                const currentValues = Array.isArray(activeFilters[filterGroup]) ? [...activeFilters[filterGroup]] : [];

                if (filterValue === "all") {
                    activeFilters[filterGroup] = [];
                } else if (currentValues.includes(filterValue)) {
                    activeFilters[filterGroup] = currentValues.filter((value) => value !== filterValue);
                } else {
                    activeFilters[filterGroup] = currentValues.concat(filterValue);
                }

                syncFilterButtons();
                renderCurrentView();
            }
        }
    });

    if (toggleButton) {
        toggleButton.addEventListener("click", togglePanel);
    }

    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            hoverInfo = null;
            hideTooltip();
            renderCurrentView();
        }
    });
})();
