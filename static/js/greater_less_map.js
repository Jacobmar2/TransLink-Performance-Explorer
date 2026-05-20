(async function initializeGreaterLessMap() {
    if (window.top === window) {
        const currentUrl = window.location.href;
        history.replaceState({ from: "greater-less-map" }, "", "/greater-less");
        history.pushState({ from: "greater-less-map" }, "", currentUrl);
        window.addEventListener("popstate", () => {
            window.location.href = "/greater-less";
        });
    }

    const params = new URLSearchParams(window.location.search);
    const year = params.get("year") || "2024";
    const feature = params.get("feature") || "annual_boardings";
    const scope = params.get("scope") || "both";
    const lower = params.get("lower");
    const upper = params.get("upper");
    const mapTitle = document.getElementById("mapTitle");
    const mapDescription = document.getElementById("mapDescription");
    const mapStatus = document.getElementById("mapStatus");
    const legendWrap = document.querySelector(".legend");
    const legendTitle = document.getElementById("legend-title");
    const legendMin = document.getElementById("legend-min");
    const legendMax = document.getElementById("legend-max");
    const debugSummary = document.createElement("div");
    debugSummary.className = "greater-less-debug-summary";
    debugSummary.setAttribute("aria-live", "polite");
    debugSummary.textContent = "Loading filtered map...";

    const busFeatureLabels = {
        annual_boardings: "Annual boardings",
        weekday_boardings: "Weekday boardings",
        sat_boardings: "Sat boardings",
        sun_hol_boardings: "Sun/Hol boardings",
        revenue_hours: "Revenue hours",
        boardings_per_revenue_hour: "Boardings/revenue hour",
        capacity_utilization: "% capacity utilization",
        overcrowded_revenue_hours: "% overcrowded revenue hours",
        peak_passenger_load: "Peak passenger load",
        peak_load_factor: "Peak load factor",
        overcrowded_trips: "% overcrowded trips",
        on_time_performance: "% on time performance",
        bus_bunching: "% bus bunching",
        avg_speed: "Avg speed"
    };

    const normalizeBusKey = (value) => {
        return String(value || "")
            .trim()
            .replace(/^0+(\d)/, "$1")
            .replace(/\s+/g, " ");
    };

    const normalizeStationKey = (value) => {
        return String(value || "")
            .replace(/[\u2013\u2014\u2212]/g, "-")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
    };

    const numberFormatter = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 });
    const wholeNumberMetrics = new Set([
        "annual_boardings",
        "weekday_boardings",
        "sat_boardings",
        "sun_hol_boardings",
        "revenue_hours"
    ]);

    const toNumber = (value) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    };

    const interpolateColor = (start, end, t) => {
        const clamped = Math.max(0, Math.min(1, t));
        return start.map((component, index) => Math.round(component + (end[index] - component) * clamped));
    };

    const hashColor = (value) => {
        const text = String(value || "");
        let hash = 0;
        for (let index = 0; index < text.length; index += 1) {
            hash = ((hash << 5) - hash) + text.charCodeAt(index);
            hash |= 0;
        }

        const palette = [
            [79, 140, 255],
            [70, 200, 170],
            [250, 168, 63],
            [247, 103, 119],
            [166, 128, 255],
            [88, 210, 255],
            [244, 214, 90],
            [92, 216, 126]
        ];

        return palette[Math.abs(hash) % palette.length];
    };

    const parseBounds = (value) => {
        if (value === null || value === undefined || value === "") {
            return null;
        }
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    };

    const describeScope = () => {
        if (scope === "bus") {
            return "bus lines only";
        }
        if (scope === "station") {
            return "SkyTrain stations only";
        }
        return "bus lines and SkyTrain stations";
    };

    const shadeColor = (color, amount) => {
        const factor = Math.max(-1, Math.min(1, amount));
        const shift = factor >= 0 ? 255 * factor : 0;
        const scale = factor >= 0 ? 1 - factor : 1 + factor;

        return [
            Math.max(0, Math.min(255, Math.round(color[0] * scale + shift))),
            Math.max(0, Math.min(255, Math.round(color[1] * scale + shift))),
            Math.max(0, Math.min(255, Math.round(color[2] * scale + shift))),
            color[3] ?? 255
        ];
    };

    const brightenColor = (color, amount) => {
        const factor = Math.max(0, Math.min(1, amount));
        return [
            Math.round(color[0] + (255 - color[0]) * factor),
            Math.round(color[1] + (255 - color[1]) * factor),
            Math.round(color[2] + (255 - color[2]) * factor),
            color[3] ?? 255
        ];
    };

    const selectedLower = parseBounds(lower);
    const selectedUpper = parseBounds(upper);
    const queryParts = new URLSearchParams({
        year,
        feature,
        scope,
        lower: selectedLower === null ? "" : String(selectedLower),
        upper: selectedUpper === null ? "" : String(selectedUpper)
    });

    try {
        const [searchResponse, busResponse, stationResponse] = await Promise.all([
            fetch(`/api/greater-less-search?${queryParts.toString()}`, { cache: "no-store" }),
            fetch(`/api/bus-line-usage-map-3d-data?year=${encodeURIComponent(year)}`, { cache: "no-store" }),
            fetch("/api/skytrain-station-usage-map-3d-data?refresh=0", { cache: "no-store" })
        ]);

        if (!searchResponse.ok) {
            throw new Error("Unable to load matched results");
        }
        if (!busResponse.ok) {
            throw new Error("Unable to load bus line geometry");
        }
        if (!stationResponse.ok) {
            throw new Error("Unable to load station geometry");
        }

        const searchData = await searchResponse.json();
        const busData = await busResponse.json();
        const stationData = await stationResponse.json();

        const matchedRows = Array.isArray(searchData.rows)
            ? searchData.rows.filter((row) => {
                const metric = toNumber(row.metric);
                if (metric === null) {
                    return false;
                }
                if (selectedLower !== null && metric < selectedLower) {
                    return false;
                }
                if (selectedUpper !== null && metric > selectedUpper) {
                    return false;
                }
                return true;
            })
            : [];

        const matchedBusMetrics = new Map();
        const matchedStationMetrics = new Map();

        matchedRows.forEach((row) => {
            const key = String(row.key || "");
            const metricValue = toNumber(row.metric);
            if (metricValue === null) {
                return;
            }
            if (key.startsWith("bus:")) {
                matchedBusMetrics.set(normalizeBusKey(key.slice(4)), metricValue);
            } else if (key.startsWith("station:")) {
                matchedStationMetrics.set(normalizeStationKey(key.slice(8)), metricValue);
            }
        });

        const matchedBusKeys = new Set(matchedBusMetrics.keys());
        const matchedStationKeys = new Set(matchedStationMetrics.keys());

        const visibleBusLines = Array.isArray(busData.lines)
            ? busData.lines.filter((line) => {
                if (scope === "station") {
                    return false;
                }
                const lineKeys = [line.line, line.group_code, line.line_label]
                    .map(normalizeBusKey)
                    .filter(Boolean);
                return lineKeys.some((lineKey) => matchedBusKeys.has(lineKey));
            })
            : [];

        const visibleStations = Array.isArray(stationData.stations)
            ? stationData.stations.filter((station) => {
                if (scope === "bus") {
                    return false;
                }
                return matchedStationKeys.has(normalizeStationKey(station.station_name));
            })
            : [];

        const busRenderData = visibleBusLines.map((line) => {
            const lineKeys = [line.line, line.group_code, line.line_label]
                .map(normalizeBusKey)
                .filter(Boolean);
            const matchedMetric = lineKeys
                .map((lineKey) => matchedBusMetrics.get(lineKey))
                .find((value) => value !== undefined);

            return {
                ...line,
                __baseColor: Array.isArray(line.color) && line.color.length >= 3 ? line.color : hashColor(line.group_code || line.line || line.line_label || line.shape_name),
                __metricValue: matchedMetric ?? toNumber((line.metrics && line.metrics[feature]) ?? line[feature]) ?? 0
            };
        });

        const stationValues = visibleStations
            .map((station) => toNumber(station.annual_boardings))
            .filter((value) => value !== null);
        const stationMin = stationValues.length ? Math.min(...stationValues) : 0;
        const stationMax = stationValues.length ? Math.max(...stationValues) : 1;
        const stationColorLow = [68, 141, 255];
        const stationColorHigh = [188, 229, 255];
        const fixedStationHeight = 3690;
        const fixedBusWidth = 64;

        const stationRenderData = visibleStations.map((station) => {
            const value = toNumber(station.annual_boardings) || 0;
            const ratio = stationMax === stationMin ? 0.5 : (value - stationMin) / (stationMax - stationMin);
            const metricValue = matchedStationMetrics.get(normalizeStationKey(station.station_name));
            return {
                ...station,
                __color: interpolateColor(stationColorLow, stationColorHigh, ratio),
                __height: fixedStationHeight * 0.5,
                __metricValue: metricValue ?? value
            };
        });

        if (legendWrap) {
            legendWrap.style.display = stationRenderData.length ? "block" : "none";
        }

        if (mapTitle) {
            mapTitle.textContent = `Greater/Less 3D Map - ${busFeatureLabels[feature] || feature}`;
        }
        if (mapDescription) {
            mapDescription.textContent = `${busRenderData.length} bus line(s) and ${stationRenderData.length} station(s) matched the query for ${describeScope()}.`;
        }
        if (mapStatus) {
            mapStatus.textContent = `${busRenderData.length + stationRenderData.length} matched`;
        }
        debugSummary.textContent = `Search rows: ${Array.isArray(searchData.rows) ? searchData.rows.length : 0} | Bus lines shown: ${busRenderData.length} | Stations shown: ${stationRenderData.length}`;
        if (legendTitle) {
            legendTitle.textContent = "Station boardings intensity";
        }
        if (legendMin) {
            legendMin.textContent = "Lower";
        }
        if (legendMax) {
            legendMax.textContent = "Higher";
        }

        const allCoords = [];
        busRenderData.forEach((line) => {
            (line.coordinates || []).forEach(([lon, lat]) => {
                allCoords.push([lon, lat]);
            });
        });
        stationRenderData.forEach((station) => {
            if (Number.isFinite(Number(station.lon)) && Number.isFinite(Number(station.lat))) {
                allCoords.push([Number(station.lon), Number(station.lat)]);
            }
        });

        const map = new maplibregl.Map({
            container: "map",
            style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
            center: [-123.12, 49.25],
            zoom: 11.0,
            pitch: 58,
            bearing: -20,
            antialias: true
        });

        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

        let overlay = null;
        let hoverInfo = null;
        const tooltip = document.getElementById("map-tooltip");

        const hideTooltip = () => {
            if (!tooltip) return;
            tooltip.style.display = "none";
            tooltip.setAttribute("aria-hidden", "true");
            tooltip.innerHTML = "";
        };

        const getHoveredBusKey = () => {
            if (!hoverInfo || !hoverInfo.object || hoverInfo.object.station_name) {
                return null;
            }

            return normalizeBusKey(hoverInfo.object.group_code || hoverInfo.object.line || hoverInfo.object.line_label || "");
        };

        const getHoveredStationKey = () => {
            if (!hoverInfo || !hoverInfo.object || !hoverInfo.object.station_name) {
                return null;
            }

            return normalizeStationKey(hoverInfo.object.station_name);
        };

        const showTooltip = (event) => {
            if (!tooltip || !event || !event.object) {
                hoverInfo = null;
                renderDeckLayers();
                hideTooltip();
                return;
            }

            const obj = event.object;
            let title = "";
            let metricValue = null;

            if (obj.station_name) {
                title = obj.station_name;
                metricValue = toNumber(obj.__metricValue);
            } else {
                title = obj.line_label || obj.group_code || obj.line || "Bus line";
                metricValue = toNumber(obj.__metricValue ?? null);
            }

            const metricLabel = busFeatureLabels[feature] || feature;
            const valueText = metricValue === null || metricValue === undefined
                ? "-"
                : (wholeNumberMetrics.has(feature)
                    ? numberFormatter.format(Math.round(metricValue))
                    : numberFormatter.format(metricValue));

            hoverInfo = event;
            renderDeckLayers();

            tooltip.innerHTML = [`<p class="map-tooltip-title">${title}</p>`, `<p class="map-tooltip-line">${metricLabel}: ${valueText}</p>`].join("");
            tooltip.style.display = "block";
            tooltip.setAttribute("aria-hidden", "false");
            tooltip.style.left = `${Math.min(window.innerWidth - 20, Math.max(16, event.x + 16))}px`;
            tooltip.style.top = `${Math.min(window.innerHeight - 20, Math.max(16, event.y + 16))}px`;
        };

        const fitToSelection = () => {
            if (!allCoords.length) {
                return;
            }

            const bounds = new maplibregl.LngLatBounds(allCoords[0], allCoords[0]);
            allCoords.slice(1).forEach(([lon, lat]) => bounds.extend([lon, lat]));
            map.fitBounds(bounds, {
                padding: { top: 90, bottom: 90, left: 90, right: 90 },
                duration: 0
            });
        };

        const buildBusLineLayers = () => {
            if (!busRenderData.length) {
                return [];
            }

            const hoveredKey = getHoveredBusKey();
            const renderData = busRenderData
                .map((line, index) => ({ line, index }))
                .sort((left, right) => {
                    const leftKey = normalizeBusKey(left.line.group_code || left.line.line || left.line.line_label || "");
                    const rightKey = normalizeBusKey(right.line.group_code || right.line.line || right.line.line_label || "");
                    const leftHovered = hoveredKey && leftKey && hoveredKey === leftKey ? 1 : 0;
                    const rightHovered = hoveredKey && rightKey && hoveredKey === rightKey ? 1 : 0;
                    if (leftHovered !== rightHovered) {
                        return leftHovered - rightHovered;
                    }
                    return left.index - right.index;
                })
                .map((entry) => entry.line)
                .map((line) => {
                const lineKey = normalizeBusKey(line.group_code || line.line || line.line_label || "");
                const isHovered = hoveredKey && lineKey && hoveredKey === lineKey;
                const fillColor = line.__baseColor;
                return {
                    ...line,
                    __fillColor: fillColor,
                    __isHovered: isHovered,
                    __hoverFillColor: isHovered ? brightenColor(fillColor, 0.35) : fillColor,
                    __tubeWidth: fixedBusWidth,
                    __hoverTubeWidth: isHovered ? fixedBusWidth * 1.15 : fixedBusWidth
                };
            });

            return [
                new deck.PathLayer({
                    id: "greater-less-bus-line-glow",
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
                    id: "greater-less-bus-line-rim",
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
                    id: "greater-less-bus-line-core",
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
                    id: "greater-less-bus-line-highlight",
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
                    parameters: {
                        depthTest: false,
                        depthMask: false
                    }
                })
            ];
        };

        const buildStationLayers = () => {
            if (!stationRenderData.length) {
                return [];
            }

            const hoveredKey = getHoveredStationKey();
            const renderData = stationRenderData.map((station) => {
                const stationKey = normalizeStationKey(station.station_name);
                const isHovered = hoveredKey && stationKey && hoveredKey === stationKey;
                const fillColor = station.__color;
                return {
                    ...station,
                    __isHovered: isHovered,
                    __hoverColor: isHovered ? brightenColor(fillColor, 0.3) : fillColor
                };
            });

            return [new deck.ColumnLayer({
                id: "greater-less-station-columns",
                data: renderData,
                diskResolution: 20,
                radius: 230,
                extruded: true,
                pickable: true,
                opacity: 0.95,
                getPosition: (station) => [Number(station.lon), Number(station.lat)],
                getElevation: (station) => station.__height,
                getFillColor: (station) => station.__isHovered ? station.__hoverColor : station.__color,
                getLineColor: [171, 212, 255, 255],
                lineWidthMinPixels: 1,
                onHover: showTooltip,
                material: {
                    ambient: 0.48,
                    diffuse: 0.56,
                    shininess: 96,
                    specularColor: [160, 210, 255]
                }
            })];
        };

        const renderDeckLayers = () => {
            if (!overlay) {
                return;
            }

            const layers = [...buildBusLineLayers(), ...buildStationLayers()];
            overlay.setProps({ layers });
        };

        const syncRender = () => {
            fitToSelection();
            renderDeckLayers();
        };

        map.on("load", () => {
            if (map.getContainer) {
                map.getContainer().appendChild(debugSummary);
            }
            overlay = new deck.MapboxOverlay({
                interleaved: false,
                layers: []
            });
            map.addControl(overlay);
            syncRender();
            if (mapStatus) {
                mapStatus.textContent = `${busRenderData.length + stationRenderData.length} matched`;
            }
        });

        if (map.isStyleLoaded && map.isStyleLoaded()) {
            syncRender();
        } else {
            window.setTimeout(syncRender, 250);
        }

        map.on("mouseleave", () => {
            hoverInfo = null;
            hideTooltip();
            renderDeckLayers();
            map.getCanvas().style.cursor = "";
        });

        map.on("mouseenter", () => {
            map.getCanvas().style.cursor = "grab";
        });

        if (mapStatus) {
            mapStatus.textContent = `${busRenderData.length + stationRenderData.length} matched`;
        }
    } catch (error) {
        console.error(error);
        if (mapStatus) {
            mapStatus.textContent = "Failed to load";
        }
        if (mapDescription) {
            mapDescription.textContent = error.message || "Unable to load the filtered 3D map.";
        }
    }
})();