(async function initializeBusLineUsageMap() {
    const apiUrl = "/api/bus-line-usage-map-3d-data?year=2024";
    const metricButtons = Array.from(document.querySelectorAll(".metric-button"));
    const panel = document.getElementById("control-panel");
    const toggleButton = document.getElementById("control-panel-toggle");
    const lineWidthSlider = document.getElementById("line-width-slider");
    const lineWidthValue = document.getElementById("line-width-value");
    const legendTitle = document.getElementById("legend-title");
    const legendMin = document.getElementById("legend-min");
    const legendMax = document.getElementById("legend-max");
    const tooltip = document.getElementById("map-tooltip");

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
        overcrowded_trips_percent: { label: "% Over Crowded Trips" }
    };

    const percentMetrics = new Set([
        "peak_load_factor",
        "capacity_utilization",
        "overcrowded_trips_percent"
    ]);

    let map = null;
    let overlay = null;
    let mapReady = false;
    let dataReady = false;
    let fittedBounds = false;
    let bounds = null;
    let lines = [];
    let activeMetric = "annual_boardings";
    let lineWidthPercent = 100;

    const numberFormatter = new Intl.NumberFormat("en-CA", {
        maximumFractionDigits: 2
    });

    const formatMetricValue = (metricKey, value) => {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return "-";
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

    const syncMetricButtons = () => {
        const activeButton = metricButtons.find((button) => button.dataset.metric === activeMetric) || metricButtons[0];
        setActiveButton(metricButtons, activeButton);
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

    const updateLegend = (minValue, maxValue) => {
        if (legendTitle) {
            legendTitle.textContent = metricConfig[activeMetric]?.label || "Metric";
        }

        if (legendMin) {
            legendMin.textContent = formatMetricValue(activeMetric, minValue);
        }

        if (legendMax) {
            legendMax.textContent = formatMetricValue(activeMetric, maxValue);
        }

        // Draw thickness gradient shape: thin on left, wide on right
        const legendSvg = document.getElementById('legend-svg');
        if (legendSvg) {
            legendSvg.innerHTML = '';
            
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
    };

    const getMetricValue = (line) => {
        const metrics = line && line.metrics ? line.metrics : {};
        const rawValue = metrics[activeMetric];
        const numericValue = Number(rawValue);
        return Number.isFinite(numericValue) ? numericValue : 0;
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

    const showTooltip = (event) => {
        if (!tooltip || !event || !event.object) {
            hideTooltip();
            return;
        }

        const line = event.object;
        const metricLabel = metricConfig[activeMetric]?.label || "Metric";
        const metricValue = formatMetricValue(activeMetric, line.__metricValue);
        const routeName = line.line_name || line.shape_name || "";
        const description = line.description ? `<p class="map-tooltip-line">${line.description}</p>` : "";

        tooltip.innerHTML = [
            `<p class="map-tooltip-title">${line.line_label || line.line || "Bus Line"}</p>`,
            routeName ? `<p class="map-tooltip-line">${routeName}</p>` : "",
            `<p class="map-tooltip-line">${metricLabel}: ${metricValue}</p>`,
            description
        ].join("");
        tooltip.classList.add("is-visible");
        tooltip.setAttribute("aria-hidden", "false");
        tooltip.style.left = `${Math.min(window.innerWidth - 20, Math.max(16, event.x + 16))}px`;
        tooltip.style.top = `${Math.min(window.innerHeight - 20, Math.max(16, event.y + 16))}px`;
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
                    const color = line.__fillColor;
                    return [color[0], color[1], color[2], 85];
                },
                getWidth: (line) => line.__tubeWidth * 1.9,
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
                    const darker = shadeColor(line.__fillColor, -0.16);
                    return [darker[0], darker[1], darker[2], 255];
                },
                getWidth: (line) => line.__tubeWidth,
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
                getColor: (line) => line.__fillColor,
                getWidth: (line) => line.__tubeWidth * 0.84,
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
                    const lighter = shadeColor(line.__fillColor, 0.32);
                    return [lighter[0], lighter[1], lighter[2], 255];
                },
                getWidth: (line) => line.__tubeWidth * 0.22,
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

        const values = lines.map((line) => getMetricValue(line));
        const maxValue = Math.max(...values, 1);
        const minValue = values.length ? Math.min(...values) : 0;

        updateLegend(minValue, maxValue);

        const renderData = lines.map((line) => {
            const metricValue = getMetricValue(line);
            const baseColor = Array.isArray(line.color) ? line.color : [82, 200, 117];
            const fillColor = metricValue === 0 ? [126, 136, 142] : baseColor;

            return {
                ...line,
                __metricValue: metricValue,
                __tubeWidth: getTubeWidth(metricValue, maxValue),
                __fillColor: fillColor
            };
        });

        overlay.setProps({
            layers: buildLayers(renderData)
        });
    };

    const fitMapBounds = () => {
        if (!map || !bounds || fittedBounds) {
            return;
        }

        map.fitBounds(bounds, {
            padding: 60,
            duration: 1200,
            pitch: 58,
            bearing: -18
        });
        fittedBounds = true;
    };

    const loadData = async () => {
        const response = await fetch(`${apiUrl}&refresh=1`);
        if (!response.ok) {
            throw new Error(`Failed to load bus line usage data (${response.status})`);
        }

        const payload = await response.json();
        if (payload.error) {
            throw new Error(payload.error);
        }

        lines = Array.isArray(payload.lines) ? payload.lines : [];
        bounds = Array.isArray(payload.bounds) ? payload.bounds : null;
        dataReady = true;
        fitMapBounds();
        renderCurrentView();
    };

    const initializeMap = () => {
        map = new maplibregl.Map({
            container: "map",
            style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
            center: [-123.12, 49.25],
            zoom: 9.6,
            pitch: 58,
            bearing: -18,
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

        map.on("mouseleave", hideTooltip);
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

        syncMetricButtons();
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

    document.addEventListener("click", (event) => {
        const metricButton = event.target.closest(".metric-button");
        if (metricButton) {
            activeMetric = metricButton.dataset.metric || "annual_boardings";
            syncMetricButtons();
            renderCurrentView();
            return;
        }
    });

    if (toggleButton) {
        toggleButton.addEventListener("click", togglePanel);
    }

    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            hideTooltip();
        }
    });
})();
