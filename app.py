from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
import pandas as pd
import os
import csv
import sqlite3
import re
from collections import Counter, OrderedDict
from datetime import datetime, timedelta
from functools import lru_cache
from difflib import SequenceMatcher

app = Flask(__name__)
app.config["UPLOAD_FOLDER"] = "uploads"
os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

@app.route("/howto")
def howto():
    return render_template("howto.html")

@app.route("/about")
def about():
    return render_template("about.html")

@app.route("/", methods=["GET", "POST"])
def home():
    return render_template("home.html")


@app.route("/bus-lines")
def bus_lines():
    return render_template("bus_lines.html")


BUS_YEARLINE_2024_PATH = os.path.join("data", "tspr2024_bus_yearline.csv")
BUS_KEYINDICATORS_PATH = os.path.join("data", "tspr2022_bus_keyindicators_year.csv")
BUS_OPEN_ARCHIVE_PATH = os.path.join("data", "TSPR_OpenData_Archive_8554786340162954844.csv")
BUS_COVID_2020_TOTAL_PATH = os.path.join("data", "covid years", "tspr-2020---total-bus-boardings-by-route.csv")
BUS_COVID_2020_DAILY_PATH = os.path.join("data", "covid years", "tspr-2020---avg-daily-bus-boardings-by-route-and-day-type.csv")
BUS_COVID_2021_TOTAL_PATH = os.path.join("data", "covid years", "tspr-fall-2021-total-bus-boardings-by-route.csv")
BUS_COVID_2021_DAILY_PATH = os.path.join("data", "covid years", "tspr-fall-2021-avg-daily-bus-boardings-by-route-and-day-type.csv")
BUS_DEEP_2023_PATH = os.path.join("data", "tspr2023_bus_yearlinedaytypeseasontimerange(2).csv")
BUS_DEEP_2023_PEAK_PATH = os.path.join("data", "tspr2023_bus_peakload_yearlinedaytypeseasontimerangedirection.csv")
BUS_DEEP_LEGACY_PATH = os.path.join("data", "TSPR2022_Bus_KeyIndicators_YearLinenoDaytypeSeasonTimerange.csv")


def _pick_col(columns, candidates):
    for col in candidates:
        if col in columns:
            return col
    return None


def _build_bus_standard_df(df):
    year_col = _pick_col(df.columns, ['CalendarYear', 'Year'])
    line_col = _pick_col(df.columns, ['Lineno_renamed', 'line_no'])
    if not year_col or not line_col:
        return pd.DataFrame(columns=[
            'year', 'line', 'annual_boardings', 'weekday', 'saturday', 'sunday',
            'revenue_hours', 'service_hours', 'boardings_per_revenue_hour',
            'peak_passenger_load', 'peak_load_factor', 'capacity_utilization',
            'overcrowded_revenue_hours', 'overcrowded_trips_percent',
            'on_time_performance', 'bus_bunching_percentage', 'avg_speed_kph'
        ])

    def col_or_na(candidates):
        selected = _pick_col(df.columns, candidates)
        if selected:
            return df[selected]
        return pd.Series([pd.NA] * len(df), index=df.index)

    standard_df = pd.DataFrame({
        'year': col_or_na(['CalendarYear', 'Year']),
        'line': col_or_na(['Lineno_renamed', 'line_no']),
        'annual_boardings': col_or_na(['AnnualBoardings', 'Annual_Boardings']),
        'weekday': col_or_na(['AVG_Daily_Boardings_MF', 'Avg Daily Brdgs MF']),
        'saturday': col_or_na(['AVG_Daily_Boardings_Sat', 'Avg Daily Brdgs Sat']),
        'sunday': col_or_na(['AVG_Daily_Boardings_SunHol', 'Avg Daily Brdgs SunHol']),
        'revenue_hours': col_or_na(['Annual_Revenue_Hours']),
        'service_hours': col_or_na(['Annual_Service_Hours']),
        'boardings_per_revenue_hour': col_or_na(['Average_Boarding_Per_Revenue_Hour']),
        'peak_passenger_load': col_or_na(['Average_Peak_Passenger_Load', 'Average_Passenger_Load_Bi_Directional']),
        'peak_load_factor': col_or_na(['Average_Peak_Load_Factor']),
        'capacity_utilization': col_or_na(['Average_Capacity_Utilization', 'Total_Capacity_Utilization']),
        'overcrowded_revenue_hours': col_or_na(['Revenue_Hrs_w_Overcrowding', 'Percentage_of_Revenue_Hours_with_Overcrowding', 'Annual_Revenue_Hours_with_Overcrowding']),
        'overcrowded_trips_percent': col_or_na(['Perc_Trips_w_Overcrowding']),
        'on_time_performance': col_or_na(['On_Time_Performance_Percentage']),
        'bus_bunching_percentage': col_or_na(['Bus_Bunching_Percentage']),
        'avg_speed_kph': col_or_na(['AVG_speed_km_per_hr'])
    })

    standard_df['year'] = pd.to_numeric(standard_df['year'], errors='coerce')
    standard_df = standard_df[standard_df['year'].notna()].copy()
    standard_df['year'] = standard_df['year'].astype(int)
    standard_df['line'] = standard_df['line'].astype(str)
    return standard_df


STATION_YEAR_2024_PATH = os.path.join("data", "tspr2024_skytrain_yearstation.csv")
STATION_BOARDINGS_2022_PATH = os.path.join("data", "tspr2022_rail_skytrain_boardings_stationyear.csv")
STATION_DAILY_2022_PATH = os.path.join("data", "tspr2022_rail_skytrain_avgdailyboardings_stationyeardaytype(1).csv")
SEGMENT_SHAPES_PATH = os.path.join("data", "SkyTrain segments map- segments.csv")
SEGMENT_USAGE_ROLLING_PATH = os.path.join("data", "tspr2024_rail_rollinghouravgpassengervol.csv")
STATION_COVID_2020_TOTAL_PATH = os.path.join("data", "covid years", "tspr-2020---total-skytrain-and-wce-boardings-by-station.csv")
STATION_COVID_2020_DAILY_PATH = os.path.join("data", "covid years", "tspr-2020--avg-daily-skytrain-and-wce-boardings-by-mode-line-station-and-day-type.csv")
STATION_COVID_2021_TOTAL_PATH = os.path.join("data", "covid years", "tspr-fall-2021-skytrain-and-wce-total-boardings-by-station.csv")
STATION_COVID_2021_DAILY_PATH = os.path.join("data", "covid years", "tspr-fall-2021-avg-daily-skytrain-and-wce-boardings-by-mode-station-and-day-type.csv")
STOPS_PATH = os.path.join("data", "stops.txt")
BUS_STOP_OPEN_ARCHIVE_PATH = os.path.join("data", "TSPR_OpenData_Archive_6085823632155390806.csv")
BUS_STOP_EXCLUDED_NAMES = {
    "sb lonsdale quay seabus station",
    "nb waterfront seabus station"
}


def _normalize_segment_station_label(value):
    text = str(value or "").strip().lower()
    text = text.replace('\u2013', '-').replace('\u2014', '-').replace('\u2212', '-')
    text = text.replace('&', ' and ')
    text = re.sub(r'\b(station|stn)\b', '', text)
    text = re.sub(r'\b(cl|el|ml)\b', '', text)
    text = re.sub(r'\bcentre\b', 'center', text)

    # Align common naming differences between usage CSV and shape CSV.
    text = text.replace('main street-science world', 'science world')
    text = text.replace('main street science world', 'science world')
    text = text.replace('main street', 'science world')
    text = text.replace('commercial-broadway', 'commercial')
    text = text.replace('commercial broadway', 'commercial')
    text = text.replace('commercial drive', 'commercial')

    text = re.sub(r'[^a-z0-9\- ]+', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def _parse_linestring_wkt(wkt_text):
    text = str(wkt_text or "").strip()
    if not text:
        return []

    match = re.match(r'^LINESTRING\s*\((.*)\)$', text, re.IGNORECASE)
    if not match:
        return []

    coords = []
    for chunk in match.group(1).split(','):
        parts = chunk.strip().split()
        if len(parts) < 2:
            continue
        try:
            lon = float(parts[0])
            lat = float(parts[1])
        except (TypeError, ValueError):
            continue
        coords.append([lon, lat])
    return coords


@lru_cache(maxsize=1)
def _load_skytrain_segment_shapes():
    if not os.path.exists(SEGMENT_SHAPES_PATH):
        return []

    df = pd.read_csv(SEGMENT_SHAPES_PATH)
    segments = []

    for idx, row in df.iterrows():
        coords = _parse_linestring_wkt(row.get('WKT'))
        if len(coords) < 2:
            continue

        raw_name = str(row.get('name') or '').strip()
        normalized_name = _normalize_segment_station_label(raw_name)
        if not normalized_name:
            continue

        segments.append({
            'shape_index': int(idx),
            'shape_name': raw_name,
            'shape_name_normalized': normalized_name,
            'description': None if pd.isna(row.get('description')) else str(row.get('description')),
            'coordinates': coords
        })

    return segments


def _best_shape_match_for_usage_segment(from_station, to_station, shape_rows):
    if not shape_rows:
        return None

    from_norm = _normalize_segment_station_label(from_station)
    to_norm = _normalize_segment_station_label(to_station)

    if not from_norm or not to_norm:
        return None

    forward_key = f"{from_norm} {to_norm}"
    reverse_key = f"{to_norm} {from_norm}"

    best_row = None
    best_reversed = False
    best_score = -1.0

    for shape_row in shape_rows:
        shape_name = shape_row['shape_name_normalized']

        forward_score = SequenceMatcher(None, forward_key, shape_name).ratio()
        reverse_score = SequenceMatcher(None, reverse_key, shape_name).ratio()

        from_in_name = from_norm in shape_name
        to_in_name = to_norm in shape_name
        contains_bonus = 0.2 if (from_in_name and to_in_name) else 0

        forward_total = forward_score + contains_bonus
        reverse_total = reverse_score + contains_bonus

        if forward_total > best_score:
            best_score = forward_total
            best_row = shape_row
            best_reversed = False

        if reverse_total > best_score:
            best_score = reverse_total
            best_row = shape_row
            best_reversed = True

    if best_row is None:
        return None

    if best_score < 0.34:
        return None

    return {
        'shape': best_row,
        'reverse_coordinates': best_reversed,
        'score': round(best_score, 4)
    }


@lru_cache(maxsize=1)
def _load_skytrain_segment_usage_map_2024_data():
    if not os.path.exists(SEGMENT_USAGE_ROLLING_PATH):
        return {
            'year': 2024,
            'segments': [],
            'missing_shapes': []
        }

    usage_df = pd.read_csv(SEGMENT_USAGE_ROLLING_PATH)
    usage_df['TravYear'] = pd.to_numeric(usage_df.get('TravYear'), errors='coerce')
    usage_df = usage_df[usage_df['TravYear'] == 2024].copy()

    if usage_df.empty:
        return {
            'year': 2024,
            'segments': [],
            'missing_shapes': []
        }

    usage_df['Hour_24'] = pd.to_numeric(usage_df.get('Hour_24'), errors='coerce').fillna(-1).astype(int)
    usage_df['Minute_15'] = pd.to_numeric(usage_df.get('Minute_15'), errors='coerce').fillna(-1).astype(int)
    usage_df['AvgHrlyVol'] = pd.to_numeric(usage_df.get('AvgHrlyVol'), errors='coerce').fillna(0.0)

    usage_df = usage_df[
        usage_df['Hour_24'].between(0, 23)
        & usage_df['Minute_15'].isin([0, 15, 30, 45])
    ].copy()

    day_type_map = {
        'MF': 'weekday',
        'Sat': 'saturday',
        'Sun/Hol': 'sunday',
        'SunHol': 'sunday'
    }

    usage_df['DayTypeNormalized'] = usage_df['DayType'].astype(str).str.strip().map(day_type_map)
    usage_df = usage_df[usage_df['DayTypeNormalized'].notna()].copy()

    if usage_df.empty:
        return {
            'year': 2024,
            'segments': [],
            'missing_shapes': []
        }

    usage_df['DirectionNormalized'] = usage_df['Direction'].astype(str).str.strip().str.lower()
    usage_df['DirectionNormalized'] = usage_df['DirectionNormalized'].map({
        'inbound': 'inbound',
        'outbound': 'outbound'
    })
    usage_df = usage_df[usage_df['DirectionNormalized'].notna()].copy()

    usage_df['time_index'] = usage_df['Hour_24'] * 4 + (usage_df['Minute_15'] // 15)
    usage_df = usage_df[usage_df['time_index'].between(0, 95)].copy()

    shape_rows = _load_skytrain_segment_shapes()

    segment_rows = []
    missing_shapes = []

    usage_df = usage_df.sort_values(['SegID', 'DayTypeNormalized', 'DirectionNormalized', 'time_index'])
    grouped = usage_df.groupby(['SegID', 'FromStn_Long', 'ToStn_Long'], dropna=False)

    for (seg_id, from_long, to_long), seg_df in grouped:
        # Skip Commercial-Broadway to Commercial Drive segment (SegID 59)
        if int(seg_id) == 59:
            continue
        
        match = _best_shape_match_for_usage_segment(from_long, to_long, shape_rows)
        if not match:
            missing_shapes.append({
                'seg_id': int(seg_id),
                'from_station': str(from_long),
                'to_station': str(to_long)
            })
            continue

        coords = match['shape']['coordinates']
        if match['reverse_coordinates']:
            coords = list(reversed(coords))

        usage_payload = {
            'weekday': {'inbound': [0.0] * 96, 'outbound': [0.0] * 96, 'total': [0.0] * 96},
            'saturday': {'inbound': [0.0] * 96, 'outbound': [0.0] * 96, 'total': [0.0] * 96},
            'sunday': {'inbound': [0.0] * 96, 'outbound': [0.0] * 96, 'total': [0.0] * 96}
        }

        per_slot = seg_df.groupby(['DayTypeNormalized', 'DirectionNormalized', 'time_index'])['AvgHrlyVol'].mean()
        for (day_type, direction, time_index), value in per_slot.items():
            idx = int(time_index)
            numeric_value = float(value)
            usage_payload[day_type][direction][idx] = numeric_value

        for day_key in ['weekday', 'saturday', 'sunday']:
            usage_payload[day_key]['total'] = [
                usage_payload[day_key]['inbound'][i] + usage_payload[day_key]['outbound'][i]
                for i in range(96)
            ]

        segment_rows.append({
            'seg_id': int(seg_id),
            'from_station': _normalize_station_name(from_long),
            'to_station': _normalize_station_name(to_long),
            'shape_name': match['shape']['shape_name'],
            'match_score': match['score'],
            'coordinates': coords,
            'usage': usage_payload
        })

    segment_rows.sort(key=lambda row: row['seg_id'])

    return {
        'year': 2024,
        'segments': segment_rows,
        'missing_shapes': missing_shapes,
        'day_types': [
            {'key': 'weekday', 'label': 'MF'},
            {'key': 'saturday', 'label': 'Sat'},
            {'key': 'sunday', 'label': 'SunHol'}
        ]
    }


def _safe_float(value):
    if pd.isna(value):
        return None
    try:
        numeric_value = float(value)
        if pd.isna(numeric_value):
            return None
        return numeric_value
    except (TypeError, ValueError):
        return None


def _split_bus_line_tokens(raw_value):
    text = _normalize_bus_line_code(raw_value)
    if not text:
        return set()

    tokens = set()
    for chunk in re.split(r"[;,/&|]+", text):
        normalized_chunk = chunk.strip()
        if not normalized_chunk:
            continue

        tokens.add(normalized_chunk.upper())
        if re.fullmatch(r"\d+", normalized_chunk):
            tokens.add(str(int(normalized_chunk)))
            tokens.add(normalized_chunk.zfill(3))

    for chunk in re.split(r"[^A-Za-z0-9]+", text):
        normalized_chunk = chunk.strip()
        if not normalized_chunk:
            continue

        tokens.add(normalized_chunk.upper())
        if re.fullmatch(r"\d+", normalized_chunk):
            tokens.add(str(int(normalized_chunk)))
            tokens.add(normalized_chunk.zfill(3))

    return {token for token in tokens if token and token.lower() != "nan"}


def _normalize_station_name(raw_name):
    text = str(raw_name)
    text = text.replace('\u2013', '-').replace('\u2014', '-').replace('\u2212', '-')
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def _station_name_candidates_for_platform_lookup(station_name):
    base_name = _normalize_station_name(station_name)
    explicit_aliases = {
        'Sea Island Station': 'Sea Island Centre Station'
    }

    variants = {
        base_name,
        re.sub(r'\bAvenue\b', 'Ave', base_name),
        re.sub(r'\bAve\b', 'Avenue', base_name),
        re.sub(r'\bCentre\b', 'Center', base_name),
        re.sub(r'\bCenter\b', 'Centre', base_name),
        base_name.replace('Production Way-University Station', 'Production Way Station')
    }

    if base_name in explicit_aliases:
        variants.add(explicit_aliases[base_name])

    return [_normalize_station_name(variant) for variant in variants if variant]


@lru_cache(maxsize=1)
def _load_skytrain_station_usage_map_2024_data():
    boardings_df = pd.read_csv(STATION_YEAR_2024_PATH)
    boardings_2024 = boardings_df[pd.to_numeric(boardings_df['CalendarYear'], errors='coerce') == 2024].copy()

    stops_df = pd.read_csv(STOPS_PATH)
    platform_1_rows = stops_df[stops_df['stop_name'].fillna('').str.contains('@ Platform 1', case=False, regex=False)]

    platform_lookup = {}
    for _, row in platform_1_rows.iterrows():
        stop_name = _normalize_station_name(row.get('stop_name'))
        station_part = _normalize_station_name(stop_name.split('@')[0])

        try:
            lat = float(row.get('stop_lat'))
            lon = float(row.get('stop_lon'))
        except (TypeError, ValueError):
            continue

        if pd.isna(lat) or pd.isna(lon):
            continue

        platform_lookup[station_part] = {
            'lat': lat,
            'lon': lon,
            'platform_stop_name': stop_name
        }

    mapped_stations = []
    missing_stations = []

    for _, row in boardings_2024.iterrows():
        station_name = _normalize_station_name(row.get('StationName'))
        annual_boardings = _safe_float(row.get('AnnualStationBrdgs'))
        if annual_boardings is None:
            continue

        selected_platform = None
        for candidate in _station_name_candidates_for_platform_lookup(station_name):
            if candidate in platform_lookup:
                selected_platform = platform_lookup[candidate]
                break

        if not selected_platform:
            missing_stations.append(station_name)
            continue

        mapped_stations.append({
            'station_name': station_name,
            'annual_boardings': annual_boardings,
            'weekday': _safe_float(row.get('AvgStationBrdgs_MF')),
            'saturday': _safe_float(row.get('AvgStationBrdgs_Sat')),
            'sunday': _safe_float(row.get('AvgStationBrdgs_SunHol')),
            'lat': selected_platform['lat'],
            'lon': selected_platform['lon'],
            'platform_stop_name': selected_platform['platform_stop_name']
        })

    mapped_stations.sort(key=lambda station: station['annual_boardings'], reverse=True)

    return {
        'year': 2024,
        'stations': mapped_stations,
        'missing_stations': sorted(set(missing_stations))
    }


@lru_cache(maxsize=1)
def _load_bus_stop_usage_map_2024_data(year=2024):
    if not os.path.exists(BUS_STOP_OPEN_ARCHIVE_PATH):
        return {
            'year': year,
            'stops': []
        }

    df = pd.read_csv(BUS_STOP_OPEN_ARCHIVE_PATH, dtype=str)
    if df.empty:
        return {
            'year': year,
            'stops': []
        }

    bay_cluster_lookup = {}
    bay_cluster_by_stop_code = {}
    if os.path.exists(STOPS_PATH):
        stops_txt_df = pd.read_csv(STOPS_PATH, dtype=str)
        if not stops_txt_df.empty:
            stops_txt_df['stop_name'] = stops_txt_df['stop_name'].fillna('')
            stops_txt_df['parent_station'] = stops_txt_df['parent_station'].fillna('')

            bay_rows = stops_txt_df[stops_txt_df['stop_name'].str.contains(r'\bbay\b', case=False, regex=True)].copy()
            cluster_stats = {}

            for _, row in bay_rows.iterrows():
                stop_code = str(row.get('stop_code', '')).strip()
                stop_name = str(row.get('stop_name', '')).strip()
                parent_station = str(row.get('parent_station', '')).strip()
                if not stop_code or stop_code.lower() == 'nan':
                    continue

                cluster_name_root = re.sub(r'\s*(?:-|–|—)?\s*\bbay\b.*$', '', stop_name, flags=re.IGNORECASE).strip()
                normalized_root = _normalize_station_name(cluster_name_root or stop_name).lower()
                cluster_key = f"parent:{parent_station}" if parent_station else f"name:{normalized_root}"

                lat = _safe_float(row.get('stop_lat'))
                lon = _safe_float(row.get('stop_lon'))
                if lat is None or lon is None:
                    continue

                stats = cluster_stats.setdefault(cluster_key, {
                    'lat_sum': 0.0,
                    'lon_sum': 0.0,
                    'count': 0,
                    'cluster_name': cluster_name_root or stop_name
                })
                stats['lat_sum'] += lat
                stats['lon_sum'] += lon
                stats['count'] += 1

                bay_cluster_by_stop_code[stop_code] = cluster_key

            for cluster_key, stats in cluster_stats.items():
                if stats['count'] <= 0:
                    continue
                bay_cluster_lookup[cluster_key] = {
                    'lat': stats['lat_sum'] / stats['count'],
                    'lon': stats['lon_sum'] / stats['count'],
                    'count': stats['count'],
                    'name': stats['cluster_name']
                }

    year_col = _pick_col(df.columns, ['TSPR_Year', 'CalendarYear', 'Year'])
    if year_col:
        df_year = df[pd.to_numeric(df[year_col], errors='coerce') == year].copy()
    else:
        df_year = df.copy()

    if df_year.empty:
        return {
            'year': year,
            'stops': []
        }

    stop_number_col = _pick_col(df_year.columns, ['Stop_Number', 'Stop Number'])
    stop_name_col = _pick_col(df_year.columns, ['Stop_Name', 'Stop Name'])
    sub_region_col = _pick_col(df_year.columns, ['Sub_Region', 'Sub Region'])
    municipality_col = _pick_col(df_year.columns, ['Municipality'])
    line_number_col = _pick_col(df_year.columns, ['Line_Number', 'Line Number'])
    line_connections_col = _pick_col(df_year.columns, ['Line_Connections', 'Line Connections'])
    latitude_col = _pick_col(df_year.columns, ['Stop_Latitude', 'Latitude', 'stop_lat'])
    longitude_col = _pick_col(df_year.columns, ['Stop_Longitude', 'Longitude', 'stop_lon'])

    boardings_mf_col = _pick_col(df_year.columns, ['Stop_Avg_Daily_Boardings_MF'])
    alightings_mf_col = _pick_col(df_year.columns, ['Stop_Avg_Daily_Alightings_MF'])
    boardings_sat_col = _pick_col(df_year.columns, ['Stop_Avg_Daily_Boardings_Sat'])
    alightings_sat_col = _pick_col(df_year.columns, ['Stop_Avg_Daily_Alightings_Sat'])
    boardings_sunhol_col = _pick_col(df_year.columns, ['Stop_Avg_Daily_Boardings_SunHol'])
    alightings_sunhol_col = _pick_col(df_year.columns, ['Stop_Avg_Daily_Alightings_SunHol'])

    line_boardings_mf_col = _pick_col(df_year.columns, ['Line_Avg_Daily_Boardings_MF'])
    line_alightings_mf_col = _pick_col(df_year.columns, ['Line_Avg_Daily_Alightings_MF'])
    line_boardings_sat_col = _pick_col(df_year.columns, ['Line_Avg_Daily_Boardings_Sat'])
    line_alightings_sat_col = _pick_col(df_year.columns, ['Line_Avg_Daily_Alightings_Sat'])
    line_boardings_sunhol_col = _pick_col(df_year.columns, ['Line_Avg_Daily_Boardings_SunHol'])
    line_alightings_sunhol_col = _pick_col(df_year.columns, ['Line_Avg_Daily_Alightings_SunHol'])

    if not stop_number_col or not stop_name_col or not latitude_col or not longitude_col:
        return {
            'year': year,
            'stops': []
        }

    stop_lookup = {}

    for _, row in df_year.iterrows():
        stop_number = str(row.get(stop_number_col, '')).strip()
        if not stop_number or stop_number.lower() == 'nan':
            continue

        stop_entry = stop_lookup.setdefault(stop_number, {
            'stop_number': stop_number,
            'stop_name': None,
            'sub_region': None,
            'municipality': None,
            'lat': None,
            'lon': None,
            'line_tokens': set(),
            'line_metrics': {},
            'boardings_mf': None,
            'alightings_mf': None,
            'boardings_sat': None,
            'alightings_sat': None,
            'boardings_sunhol': None,
            'alightings_sunhol': None
        })

        stop_name = str(row.get(stop_name_col, '')).strip()
        if stop_name and stop_name.lower() != 'nan' and stop_entry['stop_name'] is None:
            stop_entry['stop_name'] = stop_name

        if stop_entry['stop_name'] and _normalize_station_name(stop_entry['stop_name']).lower() in BUS_STOP_EXCLUDED_NAMES:
            stop_lookup.pop(stop_number, None)
            continue

        if sub_region_col and stop_entry['sub_region'] is None:
            sub_region = str(row.get(sub_region_col, '')).strip()
            if sub_region and sub_region.lower() != 'nan':
                stop_entry['sub_region'] = sub_region

        if municipality_col and stop_entry['municipality'] is None:
            municipality = str(row.get(municipality_col, '')).strip()
            if municipality and municipality.lower() != 'nan':
                stop_entry['municipality'] = municipality

        if stop_entry['lat'] is None:
            stop_entry['lat'] = _safe_float(row.get(latitude_col))

        if stop_entry['lon'] is None:
            stop_entry['lon'] = _safe_float(row.get(longitude_col))

        stop_code_cluster = bay_cluster_by_stop_code.get(stop_number)
        assigned_cluster = False
        # Only assign via stop_code mapping if the stop name contains "bay" or "unload"
        # to filter out corrupted/mismatched archive stop names
        if stop_code_cluster and stop_code_cluster in bay_cluster_lookup and stop_entry['stop_name']:
            has_bay_pattern = bool(re.search(r'\b(bay|unload)', stop_entry['stop_name'], re.IGNORECASE))
            if has_bay_pattern:
                cluster_meta = bay_cluster_lookup[stop_code_cluster]
                stop_entry['bay_cluster_id'] = stop_code_cluster
                stop_entry['bay_cluster_lat'] = cluster_meta['lat']
                stop_entry['bay_cluster_lon'] = cluster_meta['lon']
                stop_entry['bay_cluster_count'] = cluster_meta['count']
                stop_entry['bay_cluster_name'] = cluster_meta['name']
                assigned_cluster = True

        # Fallback: if no explicit stop_code mapping, try matching by normalized
        # place name and proximity to cluster centroid so numbered bays like
        # "Bay 2" get grouped even when stop_code isn't present in stops.txt.
        if not assigned_cluster and stop_entry['stop_name'] and stop_entry['lat'] is not None and stop_entry['lon'] is not None:
            cluster_name_root = re.sub(r"\s*(?:-|–|—)?\s*\bbay\b.*$", '', stop_entry['stop_name'], flags=re.IGNORECASE).strip()
            normalized_root = _normalize_station_name(cluster_name_root or stop_entry['stop_name']).lower()
            candidate_key = f"name:{normalized_root}"
            candidate_meta = bay_cluster_lookup.get(candidate_key)
            # Try relaxed matching when naming variants exist (e.g., "Stn" vs "Station").
            if candidate_meta is None:
                def _canon(text):
                    t = str(text or '').lower()
                    t = t.replace('@', ' ')
                    t = re.sub(r'\b(stn)\b', 'station', t)
                    t = re.sub(r'\bstation\b', 'station', t)
                    t = re.sub(r'[^a-z0-9\- ]+', ' ', t)
                    t = re.sub(r'\s+', ' ', t).strip()
                    return t

                target_canon = _canon(normalized_root)
                # Relaxed scan: compare against any known cluster (name: or parent:)
                for k, meta in bay_cluster_lookup.items():
                    # derive a comparable root for the cluster key
                    if k.startswith('name:'):
                        root_k = k[len('name:'):]
                    else:
                        root_k = meta.get('name') or ''
                    if not root_k:
                        continue
                    c_root = _canon(root_k)
                    if target_canon in c_root or c_root in target_canon:
                        candidate_key = k
                        candidate_meta = meta
                        break
            if candidate_meta:
                # use a geographic threshold (~300m) to verify proximity within station/terminal
                # also require stop name to contain "bay" or "unload" to filter out corrupted/mislabeled stops
                has_bay_pattern = bool(re.search(r'\b(bay|unload)', stop_entry['stop_name'], re.IGNORECASE))
                if has_bay_pattern and abs(stop_entry['lat'] - candidate_meta['lat']) <= 0.003 and abs(stop_entry['lon'] - candidate_meta['lon']) <= 0.003:
                    stop_entry['bay_cluster_id'] = candidate_key
                    stop_entry['bay_cluster_lat'] = candidate_meta['lat']
                    stop_entry['bay_cluster_lon'] = candidate_meta['lon']
                    stop_entry['bay_cluster_count'] = candidate_meta['count']
                    stop_entry['bay_cluster_name'] = candidate_meta['name']
                    assigned_cluster = True

        if line_number_col:
            route_tokens = _split_bus_line_tokens(row.get(line_number_col))
            stop_entry['line_tokens'].update(route_tokens)

            line_number_value = str(row.get(line_number_col, '')).strip()
            if line_number_value and line_number_value.lower() != 'nan':
                stop_entry['line_metrics'][line_number_value] = {
                    'line_number': line_number_value,
                    'line_tokens': sorted(route_tokens, key=_bus_line_sort_key),
                    'boardings_mf': _safe_float(row.get(line_boardings_mf_col)) if line_boardings_mf_col else None,
                    'alightings_mf': _safe_float(row.get(line_alightings_mf_col)) if line_alightings_mf_col else None,
                    'boardings_sat': _safe_float(row.get(line_boardings_sat_col)) if line_boardings_sat_col else None,
                    'alightings_sat': _safe_float(row.get(line_alightings_sat_col)) if line_alightings_sat_col else None,
                    'boardings_sunhol': _safe_float(row.get(line_boardings_sunhol_col)) if line_boardings_sunhol_col else None,
                    'alightings_sunhol': _safe_float(row.get(line_alightings_sunhol_col)) if line_alightings_sunhol_col else None
                }
        if line_connections_col:
            stop_entry['line_tokens'].update(_split_bus_line_tokens(row.get(line_connections_col)))

        if boardings_mf_col and stop_entry['boardings_mf'] is None:
            stop_entry['boardings_mf'] = _safe_float(row.get(boardings_mf_col))
        if alightings_mf_col and stop_entry['alightings_mf'] is None:
            stop_entry['alightings_mf'] = _safe_float(row.get(alightings_mf_col))
        if boardings_sat_col and stop_entry['boardings_sat'] is None:
            stop_entry['boardings_sat'] = _safe_float(row.get(boardings_sat_col))
        if alightings_sat_col and stop_entry['alightings_sat'] is None:
            stop_entry['alightings_sat'] = _safe_float(row.get(alightings_sat_col))
        if boardings_sunhol_col and stop_entry['boardings_sunhol'] is None:
            stop_entry['boardings_sunhol'] = _safe_float(row.get(boardings_sunhol_col))
        if alightings_sunhol_col and stop_entry['alightings_sunhol'] is None:
            stop_entry['alightings_sunhol'] = _safe_float(row.get(alightings_sunhol_col))

    # Recompute cluster counts from assembled stop_lookup so dynamically matched
    # stops are included in the cluster counts before building the output list.
    cluster_counts = {}
    for ent in stop_lookup.values():
        cid = ent.get('bay_cluster_id')
        if cid:
            cluster_counts[cid] = cluster_counts.get(cid, 0) + 1

    for ent in stop_lookup.values():
        cid = ent.get('bay_cluster_id')
        if cid:
            ent['bay_cluster_count'] = cluster_counts.get(cid, ent.get('bay_cluster_count'))

    stops = []
    for stop_entry in stop_lookup.values():
        if stop_entry['lat'] is None or stop_entry['lon'] is None:
            continue

        stop_entry['line_tokens'] = sorted(
            stop_entry['line_tokens'],
            key=_bus_line_sort_key
        )

        stops.append({
            'stop_number': stop_entry['stop_number'],
            'stop_name': stop_entry['stop_name'] or stop_entry['stop_number'],
            'sub_region': stop_entry['sub_region'],
            'municipality': stop_entry['municipality'],
            'lat': stop_entry['lat'],
            'lon': stop_entry['lon'],
            'line_tokens': stop_entry['line_tokens'],
            'line_metrics': sorted(stop_entry['line_metrics'].values(), key=lambda item: _bus_line_sort_key(item['line_number'])),
            'boardings_mf': stop_entry['boardings_mf'] or 0,
            'alightings_mf': stop_entry['alightings_mf'] or 0,
            'boardings_sat': stop_entry['boardings_sat'] or 0,
            'alightings_sat': stop_entry['alightings_sat'] or 0,
            'boardings_sunhol': stop_entry['boardings_sunhol'] or 0,
            'alightings_sunhol': stop_entry['alightings_sunhol'] or 0,
            'bay_cluster_id': stop_entry.get('bay_cluster_id'),
            'bay_cluster_lat': stop_entry.get('bay_cluster_lat'),
            'bay_cluster_lon': stop_entry.get('bay_cluster_lon'),
            'bay_cluster_count': stop_entry.get('bay_cluster_count'),
            'bay_cluster_name': stop_entry.get('bay_cluster_name')
        })

    # Recompute cluster counts from assembled stops so dynamically matched
    # stops are included in the cluster counts.
    cluster_counts = {}
    for ent in stop_lookup.values():
        cid = ent.get('bay_cluster_id')
        if cid:
            cluster_counts[cid] = cluster_counts.get(cid, 0) + 1

    for ent in stop_lookup.values():
        cid = ent.get('bay_cluster_id')
        if cid:
            ent['bay_cluster_count'] = cluster_counts.get(cid, ent.get('bay_cluster_count'))

    stops.sort(key=lambda stop: (stop['stop_name'], stop['stop_number']))

    return {
        'year': year,
        'stops': stops
    }


def _get_active_feature_value(entity_type, row, feature):
    if entity_type == 'bus':
        feature_map = {
            'annual_boardings': 'annual_boardings',
            'weekday_boardings': 'weekday',
            'sat_boardings': 'saturday',
            'sun_hol_boardings': 'sunday',
            'revenue_hours': 'revenue_hours',
            'boardings_per_revenue_hour': 'boardings_per_revenue_hour',
            'capacity_utilization': 'capacity_utilization',
            'overcrowded_revenue_hours': 'overcrowded_revenue_hours',
            'peak_passenger_load': 'peak_passenger_load',
            'peak_load_factor': 'peak_load_factor',
            'overcrowded_trips': 'overcrowded_trips_percent',
            'on_time_performance': 'on_time_performance',
            'bus_bunching': 'bus_bunching_percentage',
            'avg_speed': 'avg_speed_kph'
        }
        column_name = feature_map.get(feature)
        if not column_name:
            return None
        return _safe_float(row.get(column_name))

    if entity_type == 'station':
        feature_map = {
            'annual_boardings': 'annual_boardings',
            'weekday_boardings': 'weekday',
            'sat_boardings': 'saturday',
            'sun_hol_boardings': 'sunday'
        }
        column_name = feature_map.get(feature)
        if not column_name:
            return None
        return _safe_float(row.get(column_name))

    return None


def _load_station_standard_rows_for_year(year):
    # Merge order defines precedence: later source overrides earlier source for duplicate station-year values.
    merged_rows = OrderedDict()

    def ensure_station_row(station_key):
        if station_key not in merged_rows:
            merged_rows[station_key] = {
                'name': station_key,
                'annual_boardings': None,
                'weekday': None,
                'saturday': None,
                'sunday': None
            }
        return merged_rows[station_key]

    # Source 1: 2024 wide file
    df_2024 = pd.read_csv(STATION_YEAR_2024_PATH)
    df_2024_year = df_2024[pd.to_numeric(df_2024['CalendarYear'], errors='coerce') == year]
    for _, row in df_2024_year.iterrows():
        station_name = _normalize_station_name(row['StationName'])
        merged_rows[station_name] = {
            'name': station_name,
            'annual_boardings': _safe_float(row.get('AnnualStationBrdgs')),
            'weekday': _safe_float(row.get('AvgStationBrdgs_MF')),
            'saturday': _safe_float(row.get('AvgStationBrdgs_Sat')),
            'sunday': _safe_float(row.get('AvgStationBrdgs_SunHol'))
        }

    # Source 2 (later): 2022 legacy annual file (overrides annual_boardings where overlapping)
    legacy_annual = pd.read_csv(STATION_BOARDINGS_2022_PATH)
    legacy_annual_year = legacy_annual[pd.to_numeric(legacy_annual['Calendar_Year'], errors='coerce') == year]
    for _, row in legacy_annual_year.iterrows():
        station_name = _normalize_station_name(row['Station_Name'])
        station_row = ensure_station_row(station_name)
        station_row['annual_boardings'] = _safe_float(row.get('Annual_Station_Boardings'))

    # Source 3 (later): 2022 legacy daily file (overrides daily values where overlapping)
    legacy_daily = pd.read_csv(STATION_DAILY_2022_PATH)
    legacy_daily_year = legacy_daily[pd.to_numeric(legacy_daily['Calendar_Year'], errors='coerce') == year]
    day_map = {
        'MF': 'weekday',
        'Sat': 'saturday',
        'Sun/Hol': 'sunday'
    }
    for _, row in legacy_daily_year.iterrows():
        station_name = _normalize_station_name(row['Station_Name'])
        station_row = ensure_station_row(station_name)

        mapped_day = day_map.get(str(row.get('Day_Type')).strip())
        if not mapped_day:
            continue
        station_row[mapped_day] = _safe_float(row.get('Average_Daily_Station_Boardings'))

    covid_total_path = STATION_COVID_2020_TOTAL_PATH if year == 2020 else STATION_COVID_2021_TOTAL_PATH if year == 2021 else None
    covid_daily_path = STATION_COVID_2020_DAILY_PATH if year == 2020 else STATION_COVID_2021_DAILY_PATH if year == 2021 else None

    if covid_total_path and os.path.exists(covid_total_path):
        covid_total_df = pd.read_csv(covid_total_path)
        mode_col = _pick_col(covid_total_df.columns, ['Mode/Line'])
        station_col = _pick_col(covid_total_df.columns, ['Station'])
        total_col = _pick_col(covid_total_df.columns, ['TotalBoardings'])

        if mode_col and station_col and total_col:
            for _, row in covid_total_df.iterrows():
                mode_value = str(row.get(mode_col, '')).strip().lower()
                if 'west coast express' in mode_value:
                    continue

                station_name = _normalize_station_name(row.get(station_col))
                station_row = ensure_station_row(station_name)
                station_row['annual_boardings'] = _safe_float(row.get(total_col))

    if covid_daily_path and os.path.exists(covid_daily_path):
        covid_daily_df = pd.read_csv(covid_daily_path)
        mode_col = _pick_col(covid_daily_df.columns, ['Mode/Line'])
        station_col = _pick_col(covid_daily_df.columns, ['Station'])
        day_col = _pick_col(covid_daily_df.columns, ['DayType'])
        daily_col = _pick_col(covid_daily_df.columns, ['AvgDailyBoardings'])
        covid_day_map = {
            'Mon-Fri': 'weekday',
            'Sat': 'saturday',
            'Sun/Hol': 'sunday'
        }

        if mode_col and station_col and day_col and daily_col:
            for _, row in covid_daily_df.iterrows():
                mode_value = str(row.get(mode_col, '')).strip().lower()
                if 'west coast express' in mode_value:
                    continue

                mapped_day = covid_day_map.get(str(row.get(day_col)).strip())
                if not mapped_day:
                    continue

                station_name = _normalize_station_name(row.get(station_col))
                station_row = ensure_station_row(station_name)
                station_row[mapped_day] = _safe_float(row.get(daily_col))

    return merged_rows


def _load_bus_standard_rows_for_year(year):
    # Merge order defines precedence: later source overrides earlier source for duplicate line-year values.
    merged_rows = OrderedDict()

    bus_sources = [
        _build_bus_standard_df(pd.read_csv(BUS_YEARLINE_2024_PATH)),
        _build_bus_standard_df(pd.read_csv(BUS_KEYINDICATORS_PATH))
    ]

    for source_df in bus_sources:
        source_rows = source_df[source_df['year'] == year]
        for _, row in source_rows.iterrows():
            line_name = _normalize_bus_line_code(row['line'])
            merged_rows[line_name] = {
                'name': line_name,
                'annual_boardings': _safe_float(row.get('annual_boardings')),
                'weekday': _safe_float(row.get('weekday')),
                'saturday': _safe_float(row.get('saturday')),
                'sunday': _safe_float(row.get('sunday')),
                'revenue_hours': _safe_float(row.get('revenue_hours')),
                'boardings_per_revenue_hour': _safe_float(row.get('boardings_per_revenue_hour')),
                'capacity_utilization': _safe_float(row.get('capacity_utilization')),
                'overcrowded_revenue_hours': _safe_float(row.get('overcrowded_revenue_hours')),
                'peak_passenger_load': _safe_float(row.get('peak_passenger_load')),
                'peak_load_factor': _safe_float(row.get('peak_load_factor')),
                'overcrowded_trips_percent': _safe_float(row.get('overcrowded_trips_percent')),
                'on_time_performance': _safe_float(row.get('on_time_performance')),
                'bus_bunching_percentage': _safe_float(row.get('bus_bunching_percentage')),
                'avg_speed_kph': _safe_float(row.get('avg_speed_kph'))
            }

    covid_total_path = BUS_COVID_2020_TOTAL_PATH if year == 2020 else BUS_COVID_2021_TOTAL_PATH if year == 2021 else None
    covid_daily_path = BUS_COVID_2020_DAILY_PATH if year == 2020 else BUS_COVID_2021_DAILY_PATH if year == 2021 else None

    if covid_total_path and os.path.exists(covid_total_path):
        covid_total_df = pd.read_csv(covid_total_path)
        route_col = _pick_col(covid_total_df.columns, ['Route'])
        total_col = _pick_col(covid_total_df.columns, ['Total', 'TotalBoardingsFall'])

        if route_col and total_col:
            for _, row in covid_total_df.iterrows():
                line_name = _normalize_bus_line_code(row.get(route_col))
                if line_name not in merged_rows:
                    merged_rows[line_name] = {
                        'name': line_name,
                        'annual_boardings': None,
                        'weekday': None,
                        'saturday': None,
                        'sunday': None,
                        'revenue_hours': None,
                        'boardings_per_revenue_hour': None,
                        'capacity_utilization': None,
                        'overcrowded_revenue_hours': None,
                        'peak_passenger_load': None,
                        'peak_load_factor': None,
                        'overcrowded_trips_percent': None,
                        'on_time_performance': None,
                        'bus_bunching_percentage': None,
                        'avg_speed_kph': None
                    }
                merged_rows[line_name]['annual_boardings'] = _safe_float(row.get(total_col))

    if covid_daily_path and os.path.exists(covid_daily_path):
        covid_daily_df = pd.read_csv(covid_daily_path)
        route_col = _pick_col(covid_daily_df.columns, ['Route'])
        day_col = _pick_col(covid_daily_df.columns, ['DayType'])
        daily_col = _pick_col(covid_daily_df.columns, ['AvgDailyBoardings'])
        day_map = {
            'Mon-Fri': 'weekday',
            'Sat': 'saturday',
            'Sun/Hol': 'sunday'
        }

        if route_col and day_col and daily_col:
            for _, row in covid_daily_df.iterrows():
                mapped_day = day_map.get(str(row.get(day_col)).strip())
                if not mapped_day:
                    continue

                line_name = _normalize_bus_line_code(row.get(route_col))
                if line_name not in merged_rows:
                    merged_rows[line_name] = {
                        'name': line_name,
                        'annual_boardings': None,
                        'weekday': None,
                        'saturday': None,
                        'sunday': None,
                        'revenue_hours': None,
                        'boardings_per_revenue_hour': None,
                        'capacity_utilization': None,
                        'overcrowded_revenue_hours': None,
                        'peak_passenger_load': None,
                        'peak_load_factor': None,
                        'overcrowded_trips_percent': None,
                        'on_time_performance': None,
                        'bus_bunching_percentage': None,
                        'avg_speed_kph': None
                    }
                merged_rows[line_name][mapped_day] = _safe_float(row.get(daily_col))

    return merged_rows


def _build_compare_values_for_year(year, feature, scope):
    values = {}
    bus_only_features = {
        'revenue_hours',
        'boardings_per_revenue_hour',
        'capacity_utilization',
        'overcrowded_revenue_hours',
        'peak_passenger_load',
        'peak_load_factor',
        'overcrowded_trips',
        'on_time_performance',
        'bus_bunching',
        'avg_speed'
    }

    include_bus = scope in {'bus', 'both'}
    include_station = scope in {'station', 'both'} and feature not in bus_only_features

    if include_bus:
        bus_rows = _load_bus_standard_rows_for_year(year)
        for line_name, row in bus_rows.items():
            metric_value = _get_active_feature_value('bus', row, feature)
            if metric_value is None:
                continue
            values[f'bus:{line_name}'] = {
                'name': _format_bus_line_label(line_name, year),
                'value': metric_value
            }

    if include_station:
        station_rows = _load_station_standard_rows_for_year(year)
        for station_name, row in station_rows.items():
            metric_value = _get_active_feature_value('station', row, feature)
            if metric_value is None:
                continue
            values[f'station:{station_name}'] = {
                'name': station_name,
                'value': metric_value
            }

    return values


GREATER_LESS_BUS_ONLY_FEATURES = {
    'revenue_hours',
    'boardings_per_revenue_hour',
    'capacity_utilization',
    'overcrowded_revenue_hours',
    'peak_passenger_load',
    'peak_load_factor',
    'overcrowded_trips',
    'on_time_performance',
    'bus_bunching',
    'avg_speed'
}

GREATER_LESS_METRIC_COLUMNS = {
    'annual_boardings': 'annual_boardings',
    'weekday_boardings': 'weekday_boardings',
    'sat_boardings': 'sat_boardings',
    'sun_hol_boardings': 'sun_hol_boardings',
    'revenue_hours': 'revenue_hours',
    'boardings_per_revenue_hour': 'boardings_per_revenue_hour',
    'capacity_utilization': 'capacity_utilization',
    'overcrowded_revenue_hours': 'overcrowded_revenue_hours',
    'peak_passenger_load': 'peak_passenger_load',
    'peak_load_factor': 'peak_load_factor',
    'overcrowded_trips': 'overcrowded_trips',
    'on_time_performance': 'on_time_performance',
    'bus_bunching': 'bus_bunching',
    'avg_speed': 'avg_speed'
}


@lru_cache(maxsize=8)
def _build_greater_less_rows_for_year(year):
    rows = []
    sort_order = 0

    bus_rows = _load_bus_standard_rows_for_year(year)
    for line_name, row in bus_rows.items():
        rows.append({
            'entity_key': f'bus:{line_name}',
            'entity_type': 'bus',
            'display_name': _format_bus_line_label(line_name, year),
            'sort_order': sort_order,
            'annual_boardings': _safe_float(row.get('annual_boardings')),
            'weekday_boardings': _safe_float(row.get('weekday')),
            'sat_boardings': _safe_float(row.get('saturday')),
            'sun_hol_boardings': _safe_float(row.get('sunday')),
            'revenue_hours': _safe_float(row.get('revenue_hours')),
            'boardings_per_revenue_hour': _safe_float(row.get('boardings_per_revenue_hour')),
            'capacity_utilization': _safe_float(row.get('capacity_utilization')),
            'overcrowded_revenue_hours': _safe_float(row.get('overcrowded_revenue_hours')),
            'peak_passenger_load': _safe_float(row.get('peak_passenger_load')),
            'peak_load_factor': _safe_float(row.get('peak_load_factor')),
            'overcrowded_trips': _safe_float(row.get('overcrowded_trips_percent')),
            'on_time_performance': _safe_float(row.get('on_time_performance')),
            'bus_bunching': _safe_float(row.get('bus_bunching_percentage')),
            'avg_speed': _safe_float(row.get('avg_speed_kph'))
        })
        sort_order += 1

    station_rows = _load_station_standard_rows_for_year(year)
    for station_name, row in station_rows.items():
        rows.append({
            'entity_key': f'station:{station_name}',
            'entity_type': 'station',
            'display_name': station_name,
            'sort_order': sort_order,
            'annual_boardings': _safe_float(row.get('annual_boardings')),
            'weekday_boardings': _safe_float(row.get('weekday')),
            'sat_boardings': _safe_float(row.get('saturday')),
            'sun_hol_boardings': _safe_float(row.get('sunday')),
            'revenue_hours': None,
            'boardings_per_revenue_hour': None,
            'capacity_utilization': None,
            'overcrowded_revenue_hours': None,
            'peak_passenger_load': None,
            'peak_load_factor': None,
            'overcrowded_trips': None,
            'on_time_performance': None,
            'bus_bunching': None,
            'avg_speed': None
        })
        sort_order += 1

    return tuple(rows)


def _query_greater_less_rows(year, feature, scope, lower_bound, upper_bound, reference_keys):
    if feature in GREATER_LESS_BUS_ONLY_FEATURES:
        scope = 'bus'

    include_bus = scope in {'bus', 'both'}
    include_station = scope in {'station', 'both'} and feature not in GREATER_LESS_BUS_ONLY_FEATURES
    metric_column = GREATER_LESS_METRIC_COLUMNS.get(feature, 'annual_boardings')

    connection = sqlite3.connect(':memory:')
    try:
        connection.execute(
            'CREATE TABLE entity_metrics ('
            'entity_key TEXT PRIMARY KEY, '
            'entity_type TEXT NOT NULL, '
            'display_name TEXT NOT NULL, '
            'sort_order INTEGER NOT NULL, '
            'annual_boardings REAL, '
            'weekday_boardings REAL, '
            'sat_boardings REAL, '
            'sun_hol_boardings REAL, '
            'revenue_hours REAL, '
            'boardings_per_revenue_hour REAL, '
            'capacity_utilization REAL, '
            'overcrowded_revenue_hours REAL, '
            'peak_passenger_load REAL, '
            'peak_load_factor REAL, '
            'overcrowded_trips REAL, '
            'on_time_performance REAL, '
            'bus_bunching REAL, '
            'avg_speed REAL'
            ')'
        )

        connection.executemany(
            'INSERT INTO entity_metrics VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [(
                row['entity_key'],
                row['entity_type'],
                row['display_name'],
                row['sort_order'],
                row['annual_boardings'],
                row['weekday_boardings'],
                row['sat_boardings'],
                row['sun_hol_boardings'],
                row['revenue_hours'],
                row['boardings_per_revenue_hour'],
                row['capacity_utilization'],
                row['overcrowded_revenue_hours'],
                row['peak_passenger_load'],
                row['peak_load_factor'],
                row['overcrowded_trips'],
                row['on_time_performance'],
                row['bus_bunching'],
                row['avg_speed']
            ) for row in _build_greater_less_rows_for_year(year)]
        )

        conditions = ['metric_value IS NOT NULL']
        params = []

        if include_bus and not include_station:
            conditions.append("entity_type = 'bus'")
        elif include_station and not include_bus:
            conditions.append("entity_type = 'station'")

        if lower_bound is not None:
            conditions.append('metric_value >= ?')
            params.append(lower_bound)

        if upper_bound is not None:
            conditions.append('metric_value <= ?')
            params.append(upper_bound)

        base_query = (
            'WITH selected AS ('
            f'SELECT entity_key, display_name, sort_order, {metric_column} AS metric_value, entity_type '
            'FROM entity_metrics'
            ') '
            'SELECT entity_key, display_name, metric_value '
            'FROM selected '
            f"WHERE {' AND '.join(conditions)} "
            'ORDER BY sort_order ASC'
        )

        results = []
        seen_keys = set()

        for entity_key, display_name, metric_value in connection.execute(base_query, params).fetchall():
            if metric_value is None:
                continue
            results.append({
                'key': entity_key,
                'name': display_name,
                'metric': metric_value
            })
            seen_keys.add(entity_key)

        reference_conditions = ['metric_value IS NOT NULL']
        if include_bus and not include_station:
            reference_conditions.append("entity_type = 'bus'")
        elif include_station and not include_bus:
            reference_conditions.append("entity_type = 'station'")

        for entity_key in reference_keys:
            if not entity_key or entity_key in seen_keys:
                continue

            ref_row = connection.execute(
                'WITH selected AS ('
                f'SELECT entity_key, display_name, sort_order, {metric_column} AS metric_value, entity_type '
                'FROM entity_metrics'
                ') '
                'SELECT entity_key, display_name, metric_value '
                'FROM selected '
                f"WHERE entity_key = ? AND {' AND '.join(reference_conditions)}",
                (entity_key,)
            ).fetchone()

            if not ref_row:
                continue

            results.append({
                'key': ref_row[0],
                'name': ref_row[1],
                'metric': ref_row[2]
            })

        return results
    finally:
        connection.close()


BUS_DETAIL_METRICS = [
    ('annual_boardings', 'Annual boardings'),
    ('weekday_boardings', 'Weekday boardings'),
    ('sat_boardings', 'Sat boardings'),
    ('sun_hol_boardings', 'Sun/Hol boardings'),
    ('revenue_hours', 'Revenue hours'),
    ('boardings_per_revenue_hour', 'Boardings/revenue hours'),
    ('capacity_utilization', '% capacity utilization'),
    ('overcrowded_revenue_hours', '% overcrowded revenue hours'),
    ('peak_passenger_load', 'Peak passenger load'),
    ('peak_load_factor', 'Peak load factor'),
    ('overcrowded_trips', '% overcrowded trips'),
    ('on_time_performance', '% on time performance'),
    ('bus_bunching', '% bus bunching'),
    ('avg_speed', 'Avg speed')
]

STATION_DETAIL_METRICS = [
    ('annual_boardings', 'Annual boardings'),
    ('weekday_boardings', 'Weekday boardings'),
    ('sat_boardings', 'Sat boardings'),
    ('sun_hol_boardings', 'Sun/Hol boardings')
]


def _compute_pct_change(value_year_1, value_year_2):
    if value_year_1 is None or value_year_2 is None:
        return None
    if value_year_1 == 0:
        return None
    return ((value_year_2 - value_year_1) / value_year_1) * 100.0


@app.route('/api/my-2-years-entity-options')
def my_2_years_entity_options():
    try:
        year1 = request.args.get('year1', type=int)
        year2 = request.args.get('year2', type=int)

        if year1 is None or year2 is None:
            return jsonify({'error': 'year1 and year2 are required'}), 400

        bus_rows_year1 = _load_bus_standard_rows_for_year(year1)
        bus_rows_year2 = _load_bus_standard_rows_for_year(year2)
        station_rows_year1 = _load_station_standard_rows_for_year(year1)
        station_rows_year2 = _load_station_standard_rows_for_year(year2)

        bus_codes = sorted(
            set(bus_rows_year1.keys()) | set(bus_rows_year2.keys()),
            key=_bus_line_sort_key
        )
        station_names = sorted(
            set(station_rows_year1.keys()) | set(station_rows_year2.keys()),
            key=lambda x: x.lower()
        )

        return jsonify({
            'groups': [
                {
                    'label': 'Bus Lines',
                    'items': [
                        {
                            'value': f'bus:{code}',
                            'label': _format_bus_line_label(code, year1)
                        }
                        for code in bus_codes
                    ]
                },
                {
                    'label': 'SkyTrain Stations',
                    'items': [
                        {
                            'value': f'station:{name}',
                            'label': name
                        }
                        for name in station_names
                    ]
                }
            ]
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/my-2-years-entity-metrics')
def my_2_years_entity_metrics():
    try:
        year1 = request.args.get('year1', type=int)
        year2 = request.args.get('year2', type=int)
        entity = request.args.get('entity', default='', type=str)

        if year1 is None or year2 is None:
            return jsonify({'error': 'year1 and year2 are required'}), 400

        if ':' not in entity:
            return jsonify({'error': 'entity must be in format type:key'}), 400

        entity_type, entity_key_raw = entity.split(':', 1)
        entity_type = entity_type.strip().lower()
        entity_key_raw = entity_key_raw.strip()

        if entity_type not in {'bus', 'station'}:
            return jsonify({'error': 'entity type must be bus or station'}), 400

        if entity_type == 'bus':
            entity_key = _normalize_bus_line_code(entity_key_raw)
            row_year_1 = _load_bus_standard_rows_for_year(year1).get(entity_key, {})
            row_year_2 = _load_bus_standard_rows_for_year(year2).get(entity_key, {})
            metric_defs = BUS_DETAIL_METRICS
            display_name = _format_bus_line_label(entity_key, year1)
            if display_name == _format_bus_line_display_code(entity_key):
                display_name = _format_bus_line_label(entity_key, year2)
        else:
            entity_key = _normalize_station_name(entity_key_raw)
            row_year_1 = _load_station_standard_rows_for_year(year1).get(entity_key, {})
            row_year_2 = _load_station_standard_rows_for_year(year2).get(entity_key, {})
            metric_defs = STATION_DETAIL_METRICS
            display_name = entity_key

        metric_rows = []
        for metric_key, metric_label in metric_defs:
            stat_year_1 = _get_active_feature_value(entity_type, row_year_1, metric_key)
            stat_year_2 = _get_active_feature_value(entity_type, row_year_2, metric_key)
            metric_rows.append({
                'name': display_name,
                'metric': metric_label,
                'stat_year_1': stat_year_1,
                'stat_year_2': stat_year_2,
                'pct_change': _compute_pct_change(stat_year_1, stat_year_2)
            })

        return jsonify({
            'entity': f'{entity_type}:{entity_key}',
            'name': display_name,
            'entity_type': entity_type,
            'year1': year1,
            'year2': year2,
            'rows': metric_rows
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route("/api/my-2-years-compare")
def my_2_years_compare():
    try:
        year1 = request.args.get('year1', type=int)
        year2 = request.args.get('year2', type=int)
        feature = request.args.get('feature', default='annual_boardings', type=str)
        scope = request.args.get('scope', default='both', type=str)
        top_n = request.args.get('top_n', default=3, type=int)

        if year1 is None or year2 is None:
            return jsonify({'error': 'year1 and year2 are required'}), 400

        if scope not in {'bus', 'station', 'both'}:
            scope = 'both'

        top_n = max(1, min(10, top_n))

        values_year1 = _build_compare_values_for_year(year1, feature, scope)
        values_year2 = _build_compare_values_for_year(year2, feature, scope)

        common_keys = sorted(set(values_year1.keys()) & set(values_year2.keys()))

        rows = []
        for key in common_keys:
            value_year1 = values_year1[key]['value']
            value_year2 = values_year2[key]['value']

            if value_year1 is None or value_year2 is None:
                continue

            # Avoid undefined/infinite percentage changes.
            if value_year1 == 0:
                continue

            pct_change = ((value_year2 - value_year1) / value_year1) * 100.0
            rows.append({
                'name': values_year1[key]['name'],
                'stat_year_1': value_year1,
                'stat_year_2': value_year2,
                'pct_change': pct_change
            })

        positive_candidates = sorted([r for r in rows if r['pct_change'] > 0], key=lambda r: r['pct_change'], reverse=True)
        positive_smallest_first = sorted([r for r in rows if r['pct_change'] > 0], key=lambda r: r['pct_change'])
        negative_candidates = sorted([r for r in rows if r['pct_change'] < 0], key=lambda r: r['pct_change'])
        negative_smallest_first = sorted([r for r in rows if r['pct_change'] < 0], key=lambda r: r['pct_change'], reverse=True)
        zero_candidates = sorted([r for r in rows if r['pct_change'] == 0], key=lambda r: r['name'])

        def _fill_to_target(primary, secondary, zeros, target):
            picked_names = set()
            result = []

            def extend_from(source_rows):
                for item in source_rows:
                    if len(result) >= target:
                        break
                    if item['name'] in picked_names:
                        continue
                    result.append(item)
                    picked_names.add(item['name'])

            extend_from(primary)
            extend_from(secondary)
            extend_from(zeros)
            return result

        # Primary intent for each table, then backfill from opposite sign (closest to zero) to keep length at X.
        positive_rows = _fill_to_target(positive_candidates, negative_smallest_first, zero_candidates, top_n)
        negative_rows = _fill_to_target(negative_candidates, positive_smallest_first, zero_candidates, top_n)

        used_smallest_change_fallback = len(negative_candidates) < top_n

        return jsonify({
            'year1': year1,
            'year2': year2,
            'feature': feature,
            'scope': scope,
            'top_n': top_n,
            'total_compared': len(rows),
            'used_smallest_change_fallback': used_smallest_change_fallback,
            'positive': positive_rows,
            'negative': negative_rows
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def _load_bus_data_for_year(year):
    df_2024 = _build_bus_standard_df(pd.read_csv(BUS_YEARLINE_2024_PATH))
    df_key = _build_bus_standard_df(pd.read_csv(BUS_KEYINDICATORS_PATH))

    rows_2024 = df_2024[df_2024['year'] == year]

    # Product rule: for 2022, only use tspr2024_bus_yearline.csv.
    if year == 2022:
        combined = rows_2024.copy()
    else:
        rows_key = df_key[df_key['year'] == year]
        # Keep 2024 rows first so they win on duplicate line IDs.
        combined = pd.concat([rows_2024, rows_key], ignore_index=True)

    if combined.empty:
        return combined

    combined = combined.drop_duplicates(subset=['line'], keep='first')
    return combined


def _normalize_bus_line_code(raw_code):
    code = str(raw_code).strip()
    if re.fullmatch(r'\d+', code):
        return str(int(code))
    return code


def _format_bus_line_display_code(code):
    if re.fullmatch(r'\d+', code):
        return code.zfill(3)
    return code


def _bus_line_sort_key(code):
    text = str(code).strip()

    if re.fullmatch(r'\d+', text):
        return (0, int(text), text)

    # Keep split-number codes near their numeric family (e.g., 005/006, 015/050).
    split_match = re.match(r'^(\d+)[^\d].*$', text)
    if split_match:
        return (0, int(split_match.group(1)), text)

    # Place alpha routes (e.g., R1) after numeric-coded lines.
    return (1, text)


@lru_cache(maxsize=1)
def _load_bus_line_name_lookup():
    by_year = {}
    by_code_with_year = {}

    if not os.path.exists(BUS_OPEN_ARCHIVE_PATH):
        return by_year, {}

    df = pd.read_csv(BUS_OPEN_ARCHIVE_PATH, dtype=str)
    year_col = _pick_col(df.columns, ['TSPR_Year', 'CalendarYear', 'Year'])
    line_col = _pick_col(df.columns, ['Line', 'Lineno_renamed', 'line_no'])
    name_col = _pick_col(df.columns, ['Line_Name'])

    if not year_col or not line_col or not name_col:
        return by_year, {}

    for _, row in df.iterrows():
        code_raw = row.get(line_col)
        name_raw = str(row.get(name_col, '')).strip()
        if pd.isna(code_raw) or not name_raw:
            continue

        code = _normalize_bus_line_code(code_raw)
        year_value = pd.to_numeric(row.get(year_col), errors='coerce')
        if pd.notna(year_value):
            year_int = int(year_value)
            by_year.setdefault(year_int, {})[code] = name_raw
        else:
            year_int = -1

        previous = by_code_with_year.get(code)
        if previous is None or year_int >= previous[0]:
            by_code_with_year[code] = (year_int, name_raw)

    by_code = {code: payload[1] for code, payload in by_code_with_year.items()}
    return by_year, by_code


def _get_bus_line_name(line_code, year=None):
    normalized_code = _normalize_bus_line_code(line_code)
    names_by_year, fallback_names = _load_bus_line_name_lookup()

    if year is not None:
        year_names = names_by_year.get(int(year), {})
        if normalized_code in year_names:
            return year_names[normalized_code]

    return fallback_names.get(normalized_code)


def _format_bus_line_label(line_code, year=None):
    normalized_code = _normalize_bus_line_code(line_code)
    display_code = _format_bus_line_display_code(normalized_code)
    line_name = _get_bus_line_name(normalized_code, year)
    if line_name:
        return f'{display_code} - {line_name}'
    return display_code


DEEP_TIME_RANGE_TO_START = {
    '4-6': 4,
    '6-9': 6,
    '9-15': 9,
    '15-18': 15,
    '18-21': 18,
    '21-24': 21,
    '24-4': 24
}

DEEP_TIME_RANGE_TO_HOURS = {
    '4-6': 2,
    '6-9': 3,
    '9-15': 6,
    '15-18': 3,
    '18-21': 3,
    '21-24': 3,
    '24-4': 4
}

DEEP_TIME_PAIR_TO_BUCKET = {
    (4, 6): '4-6',
    (6, 9): '6-9',
    (9, 15): '9-15',
    (15, 18): '15-18',
    (18, 21): '18-21',
    (21, 24): '21-24',
    (24, 4): '24-4',
    (0, 4): '24-4'
}


def _normalize_deep_day(raw_day):
    normalized = str(raw_day or '').strip().lower()
    if normalized in {'mf', 'mon-fri', 'weekday'}:
        return 'MF'
    if normalized in {'sat', 'saturday'}:
        return 'SAT'
    if normalized in {'sun', 'sun/hol', 'sunday', 'sunday/holiday'}:
        return 'SUN'
    return None


def _normalize_deep_season(raw_season):
    normalized = str(raw_season or '').strip().lower()
    if normalized == 'fall':
        return 'Fall'
    if normalized == 'summer':
        return 'Summer'
    return None


def _normalize_deep_start_hour(raw_hour):
    text = str(raw_hour or '').strip()
    if text in DEEP_TIME_RANGE_TO_START:
        return DEEP_TIME_RANGE_TO_START[text]
    match = re.search(r'\d+', text)
    if not match:
        return None
    return int(match.group(0))


def _normalize_deep_time_bucket(raw_time):
    text = str(raw_time or '').strip()
    if text in DEEP_TIME_RANGE_TO_START:
        return text

    match = re.match(r'^\s*(\d{1,2})\s*:\s*\d{2}\s*-\s*(\d{1,2})\s*:\s*\d{2}\s*$', text)
    if not match:
        return None

    start = int(match.group(1))
    end = int(match.group(2))
    return DEEP_TIME_PAIR_TO_BUCKET.get((start, end))


def _mean_or_none(df, col_name):
    if col_name not in df.columns or df.empty:
        return None
    values = pd.to_numeric(df[col_name], errors='coerce').dropna()
    if values.empty:
        return None
    return float(values.mean())


def _mean_list_or_none(values):
    if not values:
        return None
    numeric_values = pd.to_numeric(pd.Series(values), errors='coerce').dropna()
    if numeric_values.empty:
        return None
    return float(numeric_values.mean())


def _normalize_peak_load_factor_percent(value):
    numeric_value = _safe_float(value)
    if numeric_value is None:
        return None
    if abs(numeric_value) <= 2:
        return numeric_value * 100.0
    return numeric_value


@lru_cache(maxsize=1)
def _load_deep_2023_base_df():
    if not os.path.exists(BUS_DEEP_2023_PATH):
        return pd.DataFrame()

    df = pd.read_csv(BUS_DEEP_2023_PATH)
    if df.empty:
        return df

    year_col = _pick_col(df.columns, ['SeasonYear', 'CalendarYear', 'Year'])
    line_col = _pick_col(df.columns, ['Lineno_renamed', 'line_no', 'Line'])
    day_col = _pick_col(df.columns, ['DayType', 'Day_Type'])
    season_col = _pick_col(df.columns, ['Season'])
    hour_col = _pick_col(df.columns, ['Hour_Range', 'HourRange'])

    if not year_col or not line_col or not day_col or not season_col or not hour_col:
        return pd.DataFrame()

    df = df.copy()
    df['year_norm'] = pd.to_numeric(df[year_col], errors='coerce')
    df['line_norm'] = df[line_col].apply(_normalize_bus_line_code)
    df['day_norm'] = df[day_col].apply(_normalize_deep_day)
    df['season_norm'] = df[season_col].apply(_normalize_deep_season)
    df['hour_start_norm'] = df[hour_col].apply(_normalize_deep_start_hour)
    return df


@lru_cache(maxsize=1)
def _load_deep_2023_peak_df():
    if not os.path.exists(BUS_DEEP_2023_PEAK_PATH):
        return pd.DataFrame()

    df = pd.read_csv(BUS_DEEP_2023_PEAK_PATH)
    if df.empty:
        return df

    year_col = _pick_col(df.columns, ['SeasonYear', 'CalendarYear', 'Year'])
    line_col = _pick_col(df.columns, ['Lineno_renamed', 'line_no', 'Line'])
    day_col = _pick_col(df.columns, ['DayType', 'Day_Type'])
    season_col = _pick_col(df.columns, ['Season'])
    hour_col = _pick_col(df.columns, ['HourRange', 'Hour_Range'])
    direction_col = _pick_col(df.columns, ['direction_updated', 'Direction'])

    if not year_col or not line_col or not day_col or not season_col or not hour_col or not direction_col:
        return pd.DataFrame()

    df = df.copy()
    df['year_norm'] = pd.to_numeric(df[year_col], errors='coerce')
    df['line_norm'] = df[line_col].apply(_normalize_bus_line_code)
    df['day_norm'] = df[day_col].apply(_normalize_deep_day)
    df['season_norm'] = df[season_col].apply(_normalize_deep_season)
    df['hour_start_norm'] = df[hour_col].apply(_normalize_deep_start_hour)
    df['direction_norm'] = df[direction_col].astype(str).str.strip().str.upper()
    return df


@lru_cache(maxsize=1)
def _load_deep_legacy_df():
    if not os.path.exists(BUS_DEEP_LEGACY_PATH):
        return pd.DataFrame()

    df = pd.read_csv(BUS_DEEP_LEGACY_PATH)
    if df.empty:
        return df

    year_col = _pick_col(df.columns, ['Year'])
    line_col = _pick_col(df.columns, ['line_no', 'Lineno_renamed', 'Line'])
    day_col = _pick_col(df.columns, ['DayType', 'Day_Type'])
    season_col = _pick_col(df.columns, ['sheet', 'Season'])
    time_col = _pick_col(df.columns, ['Time_Range', 'Hour_Range', 'HourRange'])

    if not year_col or not line_col or not day_col or not season_col or not time_col:
        return pd.DataFrame()

    df = df.copy()
    df['year_norm'] = pd.to_numeric(df[year_col], errors='coerce')
    df['line_norm'] = df[line_col].apply(_normalize_bus_line_code)
    df['day_norm'] = df[day_col].apply(_normalize_deep_day)
    df['season_norm'] = df[season_col].apply(_normalize_deep_season)
    df['time_bucket_norm'] = df[time_col].apply(_normalize_deep_time_bucket)
    return df


def _build_deep_side_payload_modern(base_df, peak_df, year, line_code, day_norm, season_norm, hour_start, time_range):
    section_rows = base_df[
        (base_df['year_norm'] == year) &
        (base_df['line_norm'] == line_code) &
        (base_df['day_norm'] == day_norm) &
        (base_df['season_norm'] == season_norm) &
        (base_df['hour_start_norm'] == hour_start)
    ] if not base_df.empty else pd.DataFrame()

    peak_rows = peak_df[
        (peak_df['year_norm'] == year) &
        (peak_df['line_norm'] == line_code) &
        (peak_df['day_norm'] == day_norm) &
        (peak_df['season_norm'] == season_norm) &
        (peak_df['hour_start_norm'] == hour_start)
    ] if not peak_df.empty else pd.DataFrame()

    direction_metrics = {}
    available_directions = []
    if not peak_rows.empty and 'direction_norm' in peak_rows.columns:
        for direction_name, group in peak_rows.groupby('direction_norm'):
            direction_name = str(direction_name).strip().upper()
            if not direction_name:
                continue
            available_directions.append(direction_name)
            direction_metrics[direction_name] = {
                'peak_passenger_load': _mean_or_none(group, 'Average_Peak_Passenger_Load'),
                'peak_load_factor': _mean_or_none(group, 'Average_Peak_Load_Factor')
            }

    available_directions.sort()

    return {
        'line': line_code,
        'line_label': _format_bus_line_label(line_code, year),
        'day': day_norm,
        'season': season_norm,
        'time_range': time_range,
        'time_span_hours': DEEP_TIME_RANGE_TO_HOURS.get(time_range),
        'revenue_hours': _mean_or_none(section_rows, 'Annual_Revenue_Hours'),
        'service_hours': _mean_or_none(section_rows, 'Annual_Service_Hours'),
        'trips_per_clock_hour_per_direction': _mean_or_none(section_rows, 'Average_Trips_Per_Clock_Hour_Per_Direction'),
        'boardings_per_revenue_hour': _mean_or_none(section_rows, 'Average_Boardings_Per_Revenue_Hour'),
        'boardings_per_trip': _mean_or_none(section_rows, 'Average_Boardings_Per_Trip'),
        'available_directions': available_directions,
        'direction_metrics': direction_metrics
    }


def _build_deep_side_payload_legacy(legacy_df, year, line_code, day_norm, season_norm, time_range):
    section_rows = legacy_df[
        (legacy_df['year_norm'] == year) &
        (legacy_df['line_norm'] == line_code) &
        (legacy_df['day_norm'] == day_norm) &
        (legacy_df['season_norm'] == season_norm) &
        (legacy_df['time_bucket_norm'] == time_range)
    ] if not legacy_df.empty else pd.DataFrame()

    direction_values = {}

    if not section_rows.empty:
        for _, row in section_rows.iterrows():
            east_dir = str(row.get('direction_name_EastNorth', '')).strip().upper()
            west_dir = str(row.get('direction_name_WestSouth', '')).strip().upper()

            east_peak_passenger = _safe_float(row.get('Average_Peak_Passenger_Load_EastNorth'))
            east_peak_factor = _normalize_peak_load_factor_percent(row.get('Average_Peak_Load_Factor_Percentage_EastNorth'))
            west_peak_passenger = _safe_float(row.get('Average_Peak_Passenger_Load_WestSouth'))
            west_peak_factor = _normalize_peak_load_factor_percent(row.get('Average_Peak_Load_Factor_Percentage_WestSouth'))

            if east_dir and east_dir not in {'NULL', 'NAN'}:
                direction_values.setdefault(east_dir, {'peak_passenger_load': [], 'peak_load_factor': []})
                if east_peak_passenger is not None:
                    direction_values[east_dir]['peak_passenger_load'].append(east_peak_passenger)
                if east_peak_factor is not None:
                    direction_values[east_dir]['peak_load_factor'].append(east_peak_factor)

            if west_dir and west_dir not in {'NULL', 'NAN'}:
                direction_values.setdefault(west_dir, {'peak_passenger_load': [], 'peak_load_factor': []})
                if west_peak_passenger is not None:
                    direction_values[west_dir]['peak_passenger_load'].append(west_peak_passenger)
                if west_peak_factor is not None:
                    direction_values[west_dir]['peak_load_factor'].append(west_peak_factor)

    available_directions = sorted(direction_values.keys())
    direction_metrics = {
        direction_name: {
            'peak_passenger_load': _mean_list_or_none(metrics['peak_passenger_load']),
            'peak_load_factor': _mean_list_or_none(metrics['peak_load_factor'])
        }
        for direction_name, metrics in direction_values.items()
    }

    return {
        'line': line_code,
        'line_label': _format_bus_line_label(line_code, year),
        'day': day_norm,
        'season': season_norm,
        'time_range': time_range,
        'time_span_hours': DEEP_TIME_RANGE_TO_HOURS.get(time_range),
        'revenue_hours': _mean_or_none(section_rows, 'Revenue_Hours'),
        'service_hours': _mean_or_none(section_rows, 'Service_Hours'),
        'trips_per_clock_hour_per_direction': _mean_or_none(section_rows, 'Average_Trips_Per_Clock_Hour_Per_Direction'),
        'boardings_per_revenue_hour': _mean_or_none(section_rows, 'Average_Boardings_Per_Revenue_Hour'),
        'boardings_per_trip': _mean_or_none(section_rows, 'Average_Boardings_Per_Trip'),
        'available_directions': available_directions,
        'direction_metrics': direction_metrics
    }


@app.route('/api/deep-bus-line-compare-2023')
def deep_bus_line_compare_2023():
    try:
        fallback_year = request.args.get('year', default=2023, type=int)
        year1 = request.args.get('year1', default=fallback_year, type=int)
        year2 = request.args.get('year2', default=fallback_year, type=int)
        line1 = _normalize_bus_line_code(request.args.get('line1', default='', type=str))
        line2 = _normalize_bus_line_code(request.args.get('line2', default='', type=str))

        day1 = _normalize_deep_day(request.args.get('day1', default='', type=str))
        day2 = _normalize_deep_day(request.args.get('day2', default='', type=str))
        season1 = _normalize_deep_season(request.args.get('season1', default='', type=str))
        season2 = _normalize_deep_season(request.args.get('season2', default='', type=str))

        time1 = request.args.get('time1', default='', type=str).strip()
        time2 = request.args.get('time2', default='', type=str).strip()
        start1 = _normalize_deep_start_hour(time1)
        start2 = _normalize_deep_start_hour(time2)

        if not line1 or not line2:
            return jsonify({'error': 'line1 and line2 are required'}), 400
        if year1 not in {2019, 2022, 2023} or year2 not in {2019, 2022, 2023}:
            return jsonify({'error': 'year1 and year2 must be one of: 2019, 2022, 2023'}), 400
        if not day1 or not day2:
            return jsonify({'error': 'day1 and day2 are required'}), 400
        if not season1 or not season2:
            return jsonify({'error': 'season1 and season2 are required'}), 400
        if time1 not in DEEP_TIME_RANGE_TO_START or time2 not in DEEP_TIME_RANGE_TO_START:
            return jsonify({'error': 'time1 and time2 must be one of: 4-6, 6-9, 9-15, 15-18, 18-21, 21-24, 24-4'}), 400
        if start1 is None or start2 is None:
            return jsonify({'error': 'Invalid time range values'}), 400

        base_df = _load_deep_2023_base_df()
        peak_df = _load_deep_2023_peak_df()
        legacy_df = _load_deep_legacy_df()

        if (year1 in {2022, 2023} or year2 in {2022, 2023}) and base_df.empty and peak_df.empty:
            return jsonify({'error': 'Deep comparison source files are unavailable for selected year(s)'}), 500
        if (year1 == 2019 or year2 == 2019) and legacy_df.empty:
            return jsonify({'error': 'Legacy deep comparison source file is unavailable'}), 500

        if year1 in {2022, 2023}:
            left_payload = _build_deep_side_payload_modern(base_df, peak_df, year1, line1, day1, season1, start1, time1)
        else:
            left_payload = _build_deep_side_payload_legacy(legacy_df, year1, line1, day1, season1, time1)

        if year2 in {2022, 2023}:
            right_payload = _build_deep_side_payload_modern(base_df, peak_df, year2, line2, day2, season2, start2, time2)
        else:
            right_payload = _build_deep_side_payload_legacy(legacy_df, year2, line2, day2, season2, time2)

        return jsonify({
            'year_left': year1,
            'year_right': year2,
            'left': left_payload,
            'right': right_payload
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route("/api/boardings-data")
def boardings_data():
    """API endpoint to fetch annual boardings data by year from CSV"""
    try:
        year = request.args.get('year', default=2022, type=int)
        df_year = _load_bus_data_for_year(year)
        
        # Create dictionary with line numbers as keys and annual boardings as values
        boardings_dict = {}
        for _, row in df_year.iterrows():
            line_name = str(row['line'])
            boardings = None if pd.isna(row['annual_boardings']) else float(row['annual_boardings'])
            boardings_dict[line_name] = boardings
        
        return jsonify(boardings_dict)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/bus-line-options")
def bus_line_options():
    """API endpoint to fetch bus line dropdown options with display names."""
    try:
        year = request.args.get('year', default=2024, type=int)

        valid_lines_df = _load_bus_data_for_year(year)
        valid_lines = {
            _normalize_bus_line_code(code)
            for code in valid_lines_df['line'].astype(str).tolist()
        }

        # Ensure deep-comparison year data can still populate dropdowns
        # even when open-archive labels are unavailable.
        if year in {2022, 2023}:
            deep_2023_path = os.path.join("data", "tspr2023_bus_yearlinedaytypeseasontimerange(2).csv")
            if os.path.exists(deep_2023_path):
                deep_df = pd.read_csv(deep_2023_path, dtype=str)
                deep_year_col = _pick_col(deep_df.columns, ['SeasonYear', 'CalendarYear', 'Year'])
                deep_line_col = _pick_col(deep_df.columns, ['Lineno_renamed', 'line_no', 'Line'])

                if deep_year_col and deep_line_col:
                    deep_df_year = deep_df[pd.to_numeric(deep_df[deep_year_col], errors='coerce') == year]
                    valid_lines.update(
                        _normalize_bus_line_code(code)
                        for code in deep_df_year[deep_line_col].dropna().astype(str).tolist()
                    )

        if year == 2019 and os.path.exists(BUS_DEEP_LEGACY_PATH):
            deep_legacy_df = pd.read_csv(BUS_DEEP_LEGACY_PATH, dtype=str)
            deep_year_col = _pick_col(deep_legacy_df.columns, ['Year'])
            deep_line_col = _pick_col(deep_legacy_df.columns, ['line_no', 'Lineno_renamed', 'Line'])

            if deep_year_col and deep_line_col:
                deep_df_year = deep_legacy_df[pd.to_numeric(deep_legacy_df[deep_year_col], errors='coerce') == year]
                valid_lines.update(
                    _normalize_bus_line_code(code)
                    for code in deep_df_year[deep_line_col].dropna().astype(str).tolist()
                )

        if not valid_lines:
            return jsonify([])

        fallback_codes = sorted(valid_lines, key=_bus_line_sort_key)
        options = [
            {
                'value': code,
                'label': _format_bus_line_label(code, year)
            }
            for code in fallback_codes
        ]

        options.sort(key=lambda item: _bus_line_sort_key(item['value']))

        return jsonify(options)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/bus-stop-usage-map-3d-data")
def bus_stop_usage_map_3d_data():
    """API endpoint for bus stop usage bars from the open-data archive."""
    try:
        year = request.args.get('year', default=2024, type=int)
        if request.args.get('refresh', default='0') == '1':
            _load_bus_stop_usage_map_2024_data.cache_clear()
        return jsonify(_load_bus_stop_usage_map_2024_data(year))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/daily-boardings-data")
def daily_boardings_data():
    """API endpoint to fetch daily boardings data by year (Weekday, Saturday, Sunday/Holiday)"""
    try:
        year = request.args.get('year', default=2022, type=int)
        df_year = _load_bus_data_for_year(year)
        
        # Create dictionary with line numbers as keys and daily boardings data as values
        daily_boardings_dict = {}
        for _, row in df_year.iterrows():
            line_name = str(row['line'])
            # Convert NaN to None (which becomes null in JSON)
            weekday_val = None if pd.isna(row['weekday']) else float(row['weekday'])
            saturday_val = None if pd.isna(row['saturday']) else float(row['saturday'])
            sunday_val = None if pd.isna(row['sunday']) else float(row['sunday'])
            
            daily_boardings_dict[line_name] = {
                'weekday': weekday_val,
                'saturday': saturday_val,
                'sunday': sunday_val
            }
        
        return jsonify(daily_boardings_dict)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/hours-data")
def hours_data():
    """API endpoint to fetch revenue and service hours data by year"""
    try:
        year = request.args.get('year', default=2022, type=int)
        df_year = _load_bus_data_for_year(year)
        
        # Create dictionary with line numbers as keys and hours data as values
        hours_dict = {}
        for _, row in df_year.iterrows():
            line_name = str(row['line'])
            # Convert NaN to None (which becomes null in JSON)
            revenue_hours = None if pd.isna(row['revenue_hours']) else float(row['revenue_hours'])
            service_hours = None if pd.isna(row['service_hours']) else float(row['service_hours'])
            
            hours_dict[line_name] = {
                'revenue': revenue_hours,
                'service': service_hours
            }
        
        return jsonify(hours_dict)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/metrics-data")
def metrics_data():
    """API endpoint to fetch metrics data by year"""
    try:
        year = request.args.get('year', default=2022, type=int)
        df_year = _load_bus_data_for_year(year)
        
        # Create dictionary with line numbers as keys and metrics as values
        metrics_dict = {}
        for _, row in df_year.iterrows():
            line_name = str(row['line'])
            # Convert NaN to None (which becomes null in JSON)
            boardings_per_revenue_hour = None if pd.isna(row['boardings_per_revenue_hour']) else float(row['boardings_per_revenue_hour'])
            peak_passenger_load = None if pd.isna(row['peak_passenger_load']) else float(row['peak_passenger_load'])
            peak_load_factor = None if pd.isna(row['peak_load_factor']) else float(row['peak_load_factor'])
            capacity_utilization = None if pd.isna(row['capacity_utilization']) else float(row['capacity_utilization'])
            overcrowded_revenue_hours = None if pd.isna(row['overcrowded_revenue_hours']) else float(row['overcrowded_revenue_hours'])
            overcrowded_trips_percent = None if pd.isna(row['overcrowded_trips_percent']) else float(row['overcrowded_trips_percent'])
            on_time_performance = None if pd.isna(row['on_time_performance']) else float(row['on_time_performance'])
            bus_bunching_percentage = None if pd.isna(row['bus_bunching_percentage']) else float(row['bus_bunching_percentage'])
            avg_speed_kph = None if pd.isna(row['avg_speed_kph']) else float(row['avg_speed_kph'])
            
            metrics_dict[line_name] = {
                'boardings_per_revenue_hour': boardings_per_revenue_hour,
                'peak_passenger_load': peak_passenger_load,
                'peak_load_factor': peak_load_factor,
                'capacity_utilization': capacity_utilization,
                'overcrowded_revenue_hours': overcrowded_revenue_hours,
                'overcrowded_trips_percent': overcrowded_trips_percent,
                'on_time_performance': on_time_performance,
                'bus_bunching_percentage': bus_bunching_percentage,
                'avg_speed_kph': avg_speed_kph
            }
        
        return jsonify(metrics_dict)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/stations")
def stations():
    return render_template("stations.html")


@app.route("/api/station-boardings-data")
def station_boardings_data():
    """API endpoint to fetch annual station boardings data by year from CSV"""
    try:
        year = request.args.get('year', default=2024, type=int)
        boardings_dict = {}

        # Base file (wide format, includes modern years)
        csv_path = os.path.join("data", "tspr2024_skytrain_yearstation.csv")
        df = pd.read_csv(csv_path)
        df_year = df[df['CalendarYear'] == year]
        for _, row in df_year.iterrows():
            station_name = str(row['StationName'])
            boardings = None if pd.isna(row['AnnualStationBrdgs']) else float(row['AnnualStationBrdgs'])
            boardings_dict[station_name] = boardings

        # Legacy file (stacked format for 2018/2019/2022 annual boardings)
        legacy_csv_path = os.path.join("data", "tspr2022_rail_skytrain_boardings_stationyear.csv")
        legacy_df = pd.read_csv(legacy_csv_path)
        legacy_year = legacy_df[legacy_df['Calendar_Year'] == year]
        for _, row in legacy_year.iterrows():
            station_name = str(row['Station_Name'])
            boardings = None if pd.isna(row['Annual_Station_Boardings']) else float(row['Annual_Station_Boardings'])
            boardings_dict[station_name] = boardings

        return jsonify(boardings_dict)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/skytrain-station-usage-map-3d-data")
def skytrain_station_usage_map_3d_data():
    """API endpoint for 2024 station boardings joined to Platform 1 stop coordinates."""
    try:
        if request.args.get('refresh', default='0') == '1':
            _load_skytrain_station_usage_map_2024_data.cache_clear()
        return jsonify(_load_skytrain_station_usage_map_2024_data())
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/skytrain-segment-usage-map-3d-data")
def skytrain_segment_usage_map_3d_data():
    """API endpoint for 2024 SkyTrain segment 15-minute usage joined to segment shapes."""
    try:
        if request.args.get('refresh', default='0') == '1':
            _load_skytrain_segment_usage_map_2024_data.cache_clear()
        return jsonify(_load_skytrain_segment_usage_map_2024_data())
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/station-daily-boardings-data")
def station_daily_boardings_data():
    """API endpoint to fetch station daily boardings data by year (Weekday, Saturday, Sunday/Holiday)"""
    try:
        year = request.args.get('year', default=2024, type=int)
        daily_boardings_dict = {}

        # Base file (wide format, includes modern years)
        csv_path = os.path.join("data", "tspr2024_skytrain_yearstation.csv")
        df = pd.read_csv(csv_path)
        df_year = df[df['CalendarYear'] == year]
        for _, row in df_year.iterrows():
            station_name = str(row['StationName'])
            weekday_val = None if pd.isna(row['AvgStationBrdgs_MF']) else float(row['AvgStationBrdgs_MF'])
            saturday_val = None if pd.isna(row['AvgStationBrdgs_Sat']) else float(row['AvgStationBrdgs_Sat'])
            sunday_val = None if pd.isna(row['AvgStationBrdgs_SunHol']) else float(row['AvgStationBrdgs_SunHol'])

            daily_boardings_dict[station_name] = {
                'weekday': weekday_val,
                'saturday': saturday_val,
                'sunday': sunday_val
            }

        # Legacy file (stacked day type format for 2018/2019/2022 daily boardings)
        legacy_csv_path = os.path.join("data", "tspr2022_rail_skytrain_avgdailyboardings_stationyeardaytype(1).csv")
        legacy_df = pd.read_csv(legacy_csv_path)
        legacy_year = legacy_df[legacy_df['Calendar_Year'] == year]
        day_type_map = {
            'MF': 'weekday',
            'Sat': 'saturday',
            'Sun/Hol': 'sunday'
        }

        for _, row in legacy_year.iterrows():
            station_name = str(row['Station_Name'])
            day_key = day_type_map.get(str(row['Day_Type']).strip())
            if not day_key:
                continue

            if station_name not in daily_boardings_dict:
                daily_boardings_dict[station_name] = {
                    'weekday': None,
                    'saturday': None,
                    'sunday': None
                }

            val = None if pd.isna(row['Average_Daily_Station_Boardings']) else float(row['Average_Daily_Station_Boardings'])
            daily_boardings_dict[station_name][day_key] = val

        return jsonify(daily_boardings_dict)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/station-hourly-data")
def station_hourly_data():
    """API endpoint to fetch station hourly boardings/alightings by day type"""
    try:
        year = request.args.get('year', default=None, type=int)
        csv_path = os.path.join("data", "tspr2024_skytainavgalightsbrdgs_yearstationdaytypehourly.csv")
        df = pd.read_csv(csv_path)

        if df.empty:
            return jsonify({"year": None, "stations": {}})

        available_years = sorted(df['CalendarYear'].dropna().astype(int).unique().tolist())
        if not available_years:
            return jsonify({"year": None, "stations": {}})

        if year is not None:
            if year in available_years:
                target_year = year
            else:
                # Explicit request for a year with no hourly source data.
                return jsonify({"year": year, "stations": {}})
        else:
            target_year = 2024 if 2024 in available_years else available_years[-1]
        df = df[df['CalendarYear'] == target_year]

        day_type_map = {
            'MF': 'weekday',
            'Sat': 'saturday',
            'Sun/Hol': 'sunday'
        }

        def to_number(value):
            return None if pd.isna(value) else float(value)

        def hour_label_to_start_hour(hour_label):
            if pd.isna(hour_label):
                return None

            text = str(hour_label).strip()
            match = re.search(r"to\s*(\d{1,2}):(\d{2})\s*(AM|PM)", text, re.IGNORECASE)
            if match:
                end_hour_12 = int(match.group(1))
                meridiem = match.group(3).upper()
                end_hour_24 = (end_hour_12 % 12) + (12 if meridiem == 'PM' else 0)
                return (end_hour_24 - 1) % 24

            start_match = re.search(r"^(\d{1,2}):(\d{2})\s*(AM|PM)", text, re.IGNORECASE)
            if start_match:
                start_hour_12 = int(start_match.group(1))
                meridiem = start_match.group(3).upper()
                return (start_hour_12 % 12) + (12 if meridiem == 'PM' else 0)

            return None

        stations = {}

        for _, row in df.iterrows():
            station_name = str(row['StationName'])
            day_type_raw = str(row['DayType']).strip()
            day_type = day_type_map.get(day_type_raw)
            if not day_type:
                continue

            start_hour = hour_label_to_start_hour(row['Hour'])
            if start_hour is None:
                continue

            if station_name not in stations:
                stations[station_name] = {
                    'weekday': {'boardings': [None] * 24, 'alightings': [None] * 24},
                    'saturday': {'boardings': [None] * 24, 'alightings': [None] * 24},
                    'sunday': {'boardings': [None] * 24, 'alightings': [None] * 24}
                }

            stations[station_name][day_type]['boardings'][start_hour] = to_number(row['Average_Daily_Station_Boardings'])
            stations[station_name][day_type]['alightings'][start_hour] = to_number(row['Average_Daily_Station_Alightings'])

        return jsonify({
            "year": target_year,
            "stations": stations
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/station-general-stats-data")
def station_general_stats_data():
    """API endpoint to fetch station general stats data"""
    try:
        csv_path = os.path.join("data", "tspr2022_rail_keycharacteristics_station.csv")
        df = pd.read_csv(csv_path)

        def map_fare_zone(sub_region):
            if pd.isna(sub_region):
                return None

            text = str(sub_region).strip().lower()
            if "vancouver" in text:
                return "Zone 1"
            if "burnaby" in text or "southwest" in text:
                return "Zone 2"
            if "northeast" in text or "southeast" in text:
                return "Zone 3"
            return None

        general_stats_dict = {}
        for _, row in df.iterrows():
            station_name = str(row['StationName'])
            if station_name in general_stats_dict:
                continue

            routes_raw = None if pd.isna(row['connecting_routes']) else str(row['connecting_routes'])
            routes = []
            if routes_raw and routes_raw.lower() != 'none':
                routes = [r.strip() for r in routes_raw.split(';') if r.strip()]

            faregate_count = None
            faregate_raw = row['faregate_count']
            if not pd.isna(faregate_raw):
                try:
                    faregate_count = int(float(faregate_raw))
                except (ValueError, TypeError):
                    faregate_count = None

            general_stats_dict[station_name] = {
                'line': None if pd.isna(row['line']) else str(row['line']),
                'platform_level': None if pd.isna(row['platform_level']) else str(row['platform_level']),
                'platform_type': None if pd.isna(row['platform_type']) else str(row['platform_type']),
                'faregate_count': faregate_count,
                'connecting_routes': routes,
                'fare_zone': map_fare_zone(row['sub_region'])
            }

        return jsonify(general_stats_dict)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/station-images-data")
def station_images_data():
    """API endpoint to fetch station image URLs"""
    try:
        station_images = {
            "22nd Street Station": "https://upload.wikimedia.org/wikipedia/commons/5/5a/YVR22ndstrstn.JPG",
            "29th Avenue Station": "https://upload.wikimedia.org/wikipedia/commons/b/ba/29th_Avenue_platform_level_%2820190626_123343%29.jpg",
            "Aberdeen Station": "https://upload.wikimedia.org/wikipedia/commons/1/1c/Aberdeen_Station_2017-05-22_17.45.38.jpg",
            "Braid Station": "https://upload.wikimedia.org/wikipedia/commons/6/6c/Braid_station_entrance.jpg",
            "Brentwood Town Centre Station": "https://upload.wikimedia.org/wikipedia/commons/5/59/Brentwood_Station_2022.jpg",
            "Bridgeport Station": "https://upload.wikimedia.org/wikipedia/commons/4/48/Bridgeport_Stn.jpg",
            "Richmond-Brighouse Station": "https://upload.wikimedia.org/wikipedia/commons/f/f8/Richmond%E2%80%93Brighouse_platform_level%2C_May_2019_%283%29.jpg",
            "Broadway-City Hall Station": "https://upload.wikimedia.org/wikipedia/commons/f/f6/Broadway_Cityhall_stn.jpg",
            "Burquitlam Station": "https://upload.wikimedia.org/wikipedia/commons/b/be/Burquitlam_Station_Exterior.jpg",
            "Burrard Station": "https://upload.wikimedia.org/wikipedia/commons/f/f8/Vancouver_-_Burrard_Station_entrance_01.jpg",
            "Columbia Station": "https://upload.wikimedia.org/wikipedia/commons/3/32/Columbia_platform_level.jpg",
            "Commercial-Broadway Station": "https://upload.wikimedia.org/wikipedia/commons/a/a3/Commercial-Broadway_station.jpg",
            "Coquitlam Central Station": "https://upload.wikimedia.org/wikipedia/commons/a/a7/Coquitlam_Central_Station_Exterior.jpg",
            "Edmonds Station": "https://upload.wikimedia.org/wikipedia/commons/d/d3/Edmonds_station%2C_August_2018.jpg",
            "Gateway Station": "https://upload.wikimedia.org/wikipedia/commons/0/07/Gateway_station%2C_October_2018.jpg",
            "Gilmore Station": "https://upload.wikimedia.org/wikipedia/commons/b/be/Gilmore_Station_Platform_2025.jpg",
            "Granville Station": "https://upload.wikimedia.org/wikipedia/commons/a/a1/Granville-Dunsmuir_Street_entrance.jpg",
            "Holdom Station": "https://upload.wikimedia.org/wikipedia/commons/5/57/Holdom_platform_level.jpg",
            "Inlet Centre Station": "https://upload.wikimedia.org/wikipedia/commons/0/02/Inlet_Centre_station.jpg",
            "Joyce-Collingwood Station": "https://upload.wikimedia.org/wikipedia/commons/3/37/Joyce%E2%80%93Collingwood_station_%2820190626_120404%29.jpg",
            "King Edward Station": "https://upload.wikimedia.org/wikipedia/commons/1/17/King_Edward_station_entrance.jpg",
            "King George Station": "https://upload.wikimedia.org/wikipedia/commons/b/bb/King_George_station_%282024%29.jpg",
            "Lafarge Lake-Douglas Station": "https://upload.wikimedia.org/wikipedia/commons/d/d9/Lafarge_Lake_%E2%80%93_Douglas_SkyTrain_Station_Exterior.jpg",
            "Lake City Way Station": "https://upload.wikimedia.org/wikipedia/commons/5/56/Lake_City_Way_Station.JPG",
            "Langara-49th Avenue Station": "https://upload.wikimedia.org/wikipedia/commons/9/9e/Langara%E2%80%9349th_Avenue_station_entrance%2C_May_2019_%282%29.jpg",
            "Lansdowne Station": "https://upload.wikimedia.org/wikipedia/commons/6/65/Lansdowne_stn.jpg",
            "Lincoln Station": "https://upload.wikimedia.org/wikipedia/commons/c/c9/Lincoln_Station_Exterior.jpg",
            "Lougheed Town Centre Station": "https://upload.wikimedia.org/wikipedia/commons/7/7d/Lougheed_Town_Centre_platform_level.jpg",
            "Main Street-Science World Station": "https://upload.wikimedia.org/wikipedia/commons/4/4f/Main_Street%E2%80%93Science_World_platform_level.jpg",
            "Marine Drive Station": "https://upload.wikimedia.org/wikipedia/commons/8/8d/Marine_Drive_station%2C_January_2018.jpg",
            "Metrotown Station": "https://upload.wikimedia.org/wikipedia/commons/e/e5/Metrotown_Station_at_evening_2024.jpg",
            "Moody Centre Station": "https://upload.wikimedia.org/wikipedia/commons/2/21/Moody_Centre_Station_2025.jpg",
            "Nanaimo Station": "https://upload.wikimedia.org/wikipedia/commons/1/1f/Nanaimo_station_entrance.jpg",
            "New Westminster Station": "https://upload.wikimedia.org/wikipedia/commons/2/28/New_Westminster_platform_level_%282%29.jpg",
            "Oakridge-41st Avenue Station": "https://upload.wikimedia.org/wikipedia/commons/6/6d/Oakridge-41st_Avenue_Station.JPG",
            "Olympic Village Station": "https://upload.wikimedia.org/wikipedia/commons/c/c4/Olympic_Village_station_entrance%2C_May_2019_%281%29.jpg",
            "Patterson Station": "https://upload.wikimedia.org/wikipedia/commons/c/c4/Patterson_station%2C_August_2018.jpg",
            "Production Way-University Station": "https://upload.wikimedia.org/wikipedia/commons/4/45/Production_Way%E2%80%93University_station_platform.jpg",
            "Renfrew Station": "https://upload.wikimedia.org/wikipedia/commons/7/7c/MLine-Renfrew.jpg",
            "Royal Oak Station": "https://upload.wikimedia.org/wikipedia/commons/5/52/Royal_Oak_station%2C_March_2019.jpg",
            "Rupert Station": "https://upload.wikimedia.org/wikipedia/commons/1/11/Vancouver_Skytrain_Rupert_station_train.jpg",
            "Sapperton Station": "https://upload.wikimedia.org/wikipedia/commons/4/4f/Sapperton_platform_level.jpg",
            "Scott Road Station": "https://upload.wikimedia.org/wikipedia/commons/1/1a/Scott_Road_platform_level.jpg",
            "Sea Island Station": "https://upload.wikimedia.org/wikipedia/commons/6/66/Sea_Island_Stn.jpg",
            "Sperling-Burnaby Lake Station": "https://upload.wikimedia.org/wikipedia/commons/e/e6/Sperling_Station_Exterior_20100116.jpg",
            "Stadium-Chinatown Station": "https://upload.wikimedia.org/wikipedia/commons/c/c7/Stadium%E2%80%93Chinatown_station%2C_March_2018.jpg",
            "Surrey Central Station": "https://upload.wikimedia.org/wikipedia/commons/e/e6/Surrey_Central%E2%80%93City_Parkway_entrance.jpg",
            "Templeton Station": "https://upload.wikimedia.org/wikipedia/commons/f/f0/Templeton_Stn.jpg",
            "VCC-Clark Station": "https://upload.wikimedia.org/wikipedia/commons/d/db/VCC-Clark_Station_Entrance.jpg",
            "Vancouver City Centre Station": "https://upload.wikimedia.org/wikipedia/commons/0/0d/Vancouver-City_Centre_station.jpg",
            "Waterfront Station": "https://upload.wikimedia.org/wikipedia/commons/0/04/Waterfront_station_2025.jpg",
            "YVR-Airport Station": "https://upload.wikimedia.org/wikipedia/commons/f/f8/YVR-Airport_Stn.JPG",
            "Yaletown-Roundhouse Station": "https://upload.wikimedia.org/wikipedia/commons/4/41/Yaletown_Roundhouse_Station_ext.jpg"
        }
        return jsonify(station_images)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
@app.route('/api/greater-less-search')
def greater_less_search():
    try:
        year = request.args.get('year', default=2024, type=int)
        feature = request.args.get('feature', default='annual_boardings', type=str)
        scope = request.args.get('scope', default='both', type=str)
        lower = request.args.get('lower', type=float)
        upper = request.args.get('upper', type=float)
        greater_ref = request.args.get('greater_ref', default='', type=str).strip()
        less_ref = request.args.get('less_ref', default='', type=str).strip()

        if scope not in {'bus', 'station', 'both'}:
            scope = 'both'

        reference_keys = [ref for ref in [greater_ref, less_ref] if ref]
        rows = _query_greater_less_rows(year, feature, scope, lower, upper, reference_keys)

        return jsonify({
            'year': year,
            'feature': feature,
            'scope': scope,
            'lower': lower,
            'upper': upper,
            'reference_keys': reference_keys,
            'rows': rows
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route("/greater-less")
def greater_less():
    return render_template("greater_less.html")


@app.route("/similar-to")
def similar_to():
    return render_template("similar_to.html")


@app.route("/my-2-years")
def my_2_years():
    return render_template("my_2_years.html")


@app.route("/deep-bus-line-comparison")
def deep_bus_line_comparison():
    return render_template("deep_bus_line_comparison.html")


@app.route("/skytrain-station-usage-map-3d")
def skytrain_station_usage_map_3d():
    return render_template("skytrain_station_usage_map_3d.html")


@app.route("/bus-stop-usage-map-3d")
def bus_stop_usage_map_3d():
    return render_template("bus_stop_usage_map_3d.html")


@app.route("/skytrain-segment-usage-map-3d")
def skytrain_segment_usage_map_3d():
    return render_template("skytrain_segment_usage_map_3d.html")


@app.route("/bus-line-usage-map")
def bus_line_usage_map():
    return render_template("bus_line_usage_map.html")


if __name__ == "__main__":
    app.run(debug=True)
