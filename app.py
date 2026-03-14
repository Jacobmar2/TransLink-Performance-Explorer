from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
import pandas as pd
import os
import csv
import re
from collections import Counter, OrderedDict
from datetime import datetime, timedelta
from functools import lru_cache

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
STATION_COVID_2020_TOTAL_PATH = os.path.join("data", "covid years", "tspr-2020---total-skytrain-and-wce-boardings-by-station.csv")
STATION_COVID_2020_DAILY_PATH = os.path.join("data", "covid years", "tspr-2020--avg-daily-skytrain-and-wce-boardings-by-mode-line-station-and-day-type.csv")
STATION_COVID_2021_TOTAL_PATH = os.path.join("data", "covid years", "tspr-fall-2021-skytrain-and-wce-total-boardings-by-station.csv")
STATION_COVID_2021_DAILY_PATH = os.path.join("data", "covid years", "tspr-fall-2021-avg-daily-skytrain-and-wce-boardings-by-mode-station-and-day-type.csv")


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


def _normalize_station_name(raw_name):
    text = str(raw_name)
    text = text.replace('\u2013', '-').replace('\u2014', '-').replace('\u2212', '-')
    text = re.sub(r'\s+', ' ', text).strip()
    return text


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
                'name': f'Bus line {line_name}',
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
                            'label': f"{_format_bus_line_display_code(code)} - Bus line"
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
            display_name = f'Bus line {entity_key}'
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

        options = []
        seen = set()

        if os.path.exists(BUS_OPEN_ARCHIVE_PATH):
            df = pd.read_csv(BUS_OPEN_ARCHIVE_PATH, dtype=str)
            year_col = _pick_col(df.columns, ['TSPR_Year', 'CalendarYear', 'Year'])
            line_col = _pick_col(df.columns, ['Line', 'Lineno_renamed', 'line_no'])
            name_col = _pick_col(df.columns, ['Line_Name'])

            if year_col and line_col and name_col:
                df_year = df[pd.to_numeric(df[year_col], errors='coerce') == year]

                for _, row in df_year.iterrows():
                    normalized_code = _normalize_bus_line_code(row[line_col])
                    if normalized_code in seen or normalized_code not in valid_lines:
                        continue

                    line_name = str(row[name_col]).strip()
                    display_code = _format_bus_line_display_code(normalized_code)
                    label = f"{display_code} - {line_name}" if line_name else display_code

                    options.append({
                        'value': normalized_code,
                        'label': label
                    })
                    seen.add(normalized_code)

        if not options:
            fallback_codes = sorted(valid_lines, key=_bus_line_sort_key)
            options = [
                {
                    'value': code,
                    'label': _format_bus_line_display_code(code)
                }
                for code in fallback_codes
            ]

        options.sort(key=lambda item: _bus_line_sort_key(item['value']))

        return jsonify(options)
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


if __name__ == "__main__":
    app.run(debug=True)
