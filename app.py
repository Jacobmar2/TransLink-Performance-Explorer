from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
import pandas as pd
import os
import csv
import re
from collections import Counter, OrderedDict
from datetime import datetime, timedelta

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
        valid_lines = set(valid_lines_df['line'].astype(str).tolist())
        if not valid_lines:
            return jsonify([])

        df = pd.read_csv(BUS_OPEN_ARCHIVE_PATH, dtype=str)
        year_col = _pick_col(df.columns, ['TSPR_Year', 'CalendarYear', 'Year'])
        line_col = _pick_col(df.columns, ['Line', 'Lineno_renamed', 'line_no'])
        name_col = _pick_col(df.columns, ['Line_Name'])

        if not year_col or not line_col or not name_col:
            return jsonify([])

        df_year = df[pd.to_numeric(df[year_col], errors='coerce') == year]

        options = []
        seen = set()
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
