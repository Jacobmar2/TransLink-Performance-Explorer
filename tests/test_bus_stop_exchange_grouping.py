import pytest

from app import app


@pytest.fixture
def client():
    app.config.update(TESTING=True)
    with app.test_client() as test_client:
        yield test_client


def test_bus_stop_map_assigns_exchange_from_connecting_stop_codes(client):
    response = client.get('/api/bus-stop-usage-map-3d-data?year=2024')

    assert response.status_code == 200
    stops_by_number = {
        stop['stop_number']: stop
        for stop in response.get_json()['stops']
    }

    connecting_stop_codes = ['52183', '52230', '52373', '53497', '55933', '56919', '58322']
    connected_stops = [stops_by_number[stop_code] for stop_code in connecting_stop_codes]
    stop = connected_stops[0]
    assert stop['exchange_name'] == '22nd Street'
    assert stop['exchange_primary_type'] == 'Station'
    assert stop['exchange_stop_count'] == len(connecting_stop_codes)
    assert stop['exchange_lat'] == pytest.approx(49.199962)
    assert stop['exchange_lon'] == pytest.approx(-122.949042)
    assert stop['exchange_id']
    assert all(
        connected_stop['exchange_id'] == stop['exchange_id']
        for connected_stop in connected_stops
    )
