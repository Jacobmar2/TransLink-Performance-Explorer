import csv

from app import _load_skytrain_segment_train_counts


def _write_csv(path, headers, rows):
    with path.open("w", encoding="utf-8", newline="") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def test_segment_train_counts_follow_gtfs_stop_sequence_and_service_day(tmp_path, monkeypatch):
    stops_path = tmp_path / "stops.txt"
    trips_path = tmp_path / "trips.txt"
    stop_times_path = tmp_path / "stop_times.txt"

    _write_csv(
        stops_path,
        ["stop_id", "stop_name", "parent_station"],
        [
            {"stop_id": "10", "stop_name": "Alpha Station", "parent_station": ""},
            {"stop_id": "20", "stop_name": "Beta Station", "parent_station": ""},
            {"stop_id": "30", "stop_name": "Gamma Station", "parent_station": ""},
            {"stop_id": "101", "stop_name": "Alpha Station @ Platform 1", "parent_station": "10"},
            {"stop_id": "201", "stop_name": "Beta Station @ Platform 1", "parent_station": "20"},
            {"stop_id": "301", "stop_name": "Gamma Station @ Platform 1", "parent_station": "30"},
        ],
    )
    _write_csv(
        trips_path,
        ["trip_id", "service_id", "trip_headsign"],
        [
            {"trip_id": "weekday-through", "service_id": "1", "trip_headsign": "Expo Line To King George"},
            {"trip_id": "weekday-terminal", "service_id": "1101", "trip_headsign": "Expo Line To Waterfront"},
            {"trip_id": "weekday-inbound", "service_id": "1", "trip_headsign": "Expo Line To Waterfront"},
            {"trip_id": "saturday", "service_id": "2", "trip_headsign": "Canada Line To YVR-Airport"},
            {"trip_id": "sunday", "service_id": "3", "trip_headsign": "Canada Line To Waterfront"},
            {"trip_id": "ignored-friday", "service_id": "1201", "trip_headsign": "Expo Line To Gamma"},
            {"trip_id": "not-skytrain", "service_id": "1", "trip_headsign": "Bus Route"},
        ],
    )
    _write_csv(
        stop_times_path,
        ["trip_id", "departure_time", "stop_id", "stop_sequence"],
        [
            {"trip_id": "weekday-through", "departure_time": "05:30:00", "stop_id": "301", "stop_sequence": "3"},
            {"trip_id": "weekday-through", "departure_time": "05:15:00", "stop_id": "201", "stop_sequence": "2"},
            {"trip_id": "weekday-through", "departure_time": "05:00:00", "stop_id": "101", "stop_sequence": "1"},
            {"trip_id": "weekday-terminal", "departure_time": "05:14:59", "stop_id": "101", "stop_sequence": "1"},
            {"trip_id": "weekday-terminal", "departure_time": "05:15:00", "stop_id": "201", "stop_sequence": "2"},
            {"trip_id": "weekday-inbound", "departure_time": "06:30:00", "stop_id": "101", "stop_sequence": "3"},
            {"trip_id": "weekday-inbound", "departure_time": "06:15:00", "stop_id": "201", "stop_sequence": "2"},
            {"trip_id": "weekday-inbound", "departure_time": "06:00:00", "stop_id": "301", "stop_sequence": "1"},
            {"trip_id": "saturday", "departure_time": "05:15:00", "stop_id": "101", "stop_sequence": "1"},
            {"trip_id": "saturday", "departure_time": "05:30:00", "stop_id": "201", "stop_sequence": "2"},
            {"trip_id": "sunday", "departure_time": "05:30:00", "stop_id": "201", "stop_sequence": "1"},
            {"trip_id": "sunday", "departure_time": "05:45:00", "stop_id": "101", "stop_sequence": "2"},
            {"trip_id": "ignored-friday", "departure_time": "05:00:00", "stop_id": "101", "stop_sequence": "1"},
            {"trip_id": "ignored-friday", "departure_time": "05:15:00", "stop_id": "201", "stop_sequence": "2"},
            {"trip_id": "not-skytrain", "departure_time": "05:00:00", "stop_id": "101", "stop_sequence": "1"},
            {"trip_id": "not-skytrain", "departure_time": "05:15:00", "stop_id": "201", "stop_sequence": "2"},
        ],
    )

    monkeypatch.setattr("app.GTFS_STOPS_PATH", str(stops_path))
    monkeypatch.setattr("app.GTFS_TRIPS_PATH", str(trips_path))
    monkeypatch.setattr("app.GTFS_STOP_TIMES_PATH", str(stop_times_path))

    counts = _load_skytrain_segment_train_counts([
        {"seg_id": 1, "from_station": "Alpha Stn", "to_station": "Beta Stn"},
        {"seg_id": 2, "from_station": "Beta Stn", "to_station": "Gamma Stn"},
    ])

    assert counts[0]["weekday"]["outbound"][20] == 1
    assert counts[0]["weekday"]["inbound"][20] == 1
    assert counts[0]["weekday"]["outbound"][21] == 0
    assert counts[0]["weekday"]["inbound"][25] == 1
    assert counts[1]["weekday"]["outbound"][21] == 1
    assert counts[1]["weekday"]["inbound"][24] == 1
    assert counts[1]["weekday"]["outbound"][20] == 0
    assert counts[0]["saturday"]["outbound"][21] == 1
    assert counts[0]["sunday"]["inbound"][22] == 1
