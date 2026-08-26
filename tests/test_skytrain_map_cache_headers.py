import pytest

from app import app


@pytest.fixture
def client():
    app.config.update(TESTING=True)
    with app.test_client() as client:
        yield client


def test_skytrain_map_endpoints_disable_browser_caching(client):
    for endpoint in [
        "/api/skytrain-station-usage-map-3d-data?refresh=1",
        "/api/skytrain-segment-usage-map-3d-data?refresh=1",
        "/api/bus-stop-usage-map-3d-data?year=2024",
        "/api/station-hourly-data?year=2024",
    ]:
        response = client.get(endpoint)
        assert response.status_code == 200
        header = response.headers.get("Cache-Control", "")
        assert "no-store" in header.lower()
        assert "must-revalidate" in header.lower()
