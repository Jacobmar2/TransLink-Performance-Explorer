import pytest

from app import app


EXPECTED_ROUTE_LABELS = {
    '150': '150 - COQUITLAM CENTRAL STN/WHITE PINE BEACH',
    '214': '214 - BLUERIDGE/PHIBBS EXCH/VANCOUVER',
    '280': '280 - BLUEWATER/SNUG COVE',
    '281': '281 - EAGLE CLIFF/SNUG COVE',
    '338': '338 - EAST FRASER HEIGHTS/GUILDFORD',
    '370': '370 - CLOVERDALE/WILLOWBROOK',
    '372': '372 - CLAYTON HEIGHTS/LANGLEY CENTRE',
    '560/561': '560/561 - LANGLEY CENTRE/LANGLEY HOSPITAL–BROOKSWOOD',
    '562': '562 - LANGLEY CENTRE/WALNUT GROVE',
    '563': '563 - LANGLEY CENTRE/FERNRIDGE',
    '564': '564 - LANGLEY CENTRE/WILLOWBROOK',
    '606': '606 - LADNER RING',
    '608': '608 - LADNER RING',
}


@pytest.fixture
def client():
    app.config.update(TESTING=True)
    with app.test_client() as test_client:
        yield test_client


@pytest.mark.parametrize('year', [2024, 2025])
def test_bus_line_options_include_missing_route_names(client, year):
    response = client.get(f'/api/bus-line-options?year={year}')

    assert response.status_code == 200
    options = {option['value']: option['label'] for option in response.get_json()}
    for route, label in EXPECTED_ROUTE_LABELS.items():
        assert options[route] == label


def test_2022_deep_comparison_uses_legacy_bus_stats(client):
    options_response = client.get('/api/bus-line-options?year=2022')
    assert options_response.status_code == 200
    assert '2' in {option['value'] for option in options_response.get_json()}

    response = client.get(
        '/api/deep-bus-line-compare-2023',
        query_string={
            'year1': 2022,
            'line1': '2',
            'day1': 'MF',
            'season1': 'Fall',
            'time1': '4-6',
            'year2': 2022,
            'line2': '2',
            'day2': 'MF',
            'season2': 'Fall',
            'time2': '4-6',
        },
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['left']['revenue_hours'] == pytest.approx(142.8)
    assert payload['left']['boardings_per_revenue_hour'] == pytest.approx(36.08058959)
    assert payload['right']['revenue_hours'] == pytest.approx(142.8)
    assert payload['right']['direction_metrics']['EAST']['peak_passenger_load'] == pytest.approx(16.44530058)


def test_bus_stop_map_bus_line_options_remain_unchanged(client):
    response = client.get('/api/bus-line-options?year=2024&include_named_routes=0')

    assert response.status_code == 200
    options = {option['value']: option['label'] for option in response.get_json()}
    assert '338' not in options
    for route in EXPECTED_ROUTE_LABELS.keys() - {'338'}:
        assert options[route] == route


def test_bus_stop_map_uses_2019_archive_routes_and_names(client):
    response = client.get('/api/bus-stop-usage-map-3d-line-options')

    assert response.status_code == 200
    options = {option['value']: option['label'] for option in response.get_json()}
    assert '2' in options
    assert '150' not in options
    assert options['2019::150'] == '150 COQUITLAM CENTRAL STN/WHITE PINE BEACH (2019)'
    assert options['2019::282'] == '282 MT GARDNER/SNUG COVE (2019)'
    assert options['2019::560/561'] == '560/561 LANGLEY CENTRE/LANGLEY HOSPITAL–BROOKSWOOD (2019)'
    assert '894' not in options
    assert '2019::894' not in options
    for route in ['150', '214', '280', '281', '282', '370', '372', '560/561', '562', '563', '564', '606', '608']:
        assert route not in options
        assert f'2019::{route}' in options
    ordered_values = [option['value'] for option in response.get_json()]
    assert ordered_values.index('2019::150') < ordered_values.index('151')
    assert ordered_values.index('2019::280') < ordered_values.index('2019::281') < ordered_values.index('2019::282')
    assert ordered_values.index('2019::608') < ordered_values.index('609')


def test_2019_bus_stop_routes_have_selectable_stop_metrics(client):
    response = client.get('/api/bus-stop-usage-map-3d-data?year=2019')

    assert response.status_code == 200
    stops = response.get_json()['stops']
    for route in ['150', '214', '280', '281', '282', '370', '372', '560/561', '562', '563', '564', '606', '608']:
        assert any(
            metric['line_number'] == route
            for stop in stops
            for metric in stop['line_metrics']
        ), f'No 2019 stop metrics found for route {route}'


def test_3d_bus_line_map_includes_geometry_without_2024_stats(client):
    response = client.get('/api/bus-line-usage-map-3d-data?year=2024')

    assert response.status_code == 200
    lines = {line['line']: line for line in response.get_json()['lines']}
    for route in ['32', '480']:
        assert route in lines
        assert len(lines[route]['coordinates']) > 1
        assert lines[route]['line_name']
        assert lines[route]['metrics']['annual_boardings'] is None