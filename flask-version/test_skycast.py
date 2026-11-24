import sys, unittest
from unittest import mock
import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import requests
import app as sky

GEO = {"results": [{"name": "Gwalior", "admin1": "Madhya Pradesh", "country": "India",
                    "latitude": 26.22, "longitude": 78.18}]}
FC = {
    "current": {"temperature_2m": 24.6, "relative_humidity_2m": 40, "apparent_temperature": 25.2,
                "is_day": 1, "weather_code": 1, "wind_speed_10m": 9.4, "surface_pressure": 985.3},
    "daily": {"time": ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"],
              "weather_code": [0, 1, 2, 3, 61],
              "temperature_2m_max": [28.4, 29.0, 27.5, 26.1, 25.0],
              "temperature_2m_min": [13.2, 14.0, 14.8, 15.1, 16.0],
              "sunrise": ["2026-11-23T06:41"] * 5, "sunset": ["2026-11-23T17:36"] * 5},
}


class R:
    def __init__(self, data): self.data = data
    def raise_for_status(self): pass
    def json(self): return self.data


def fake_get(url, **kw):
    return R(GEO if "geocoding" in url else FC)


class T(unittest.TestCase):
    def setUp(self): self.c = sky.app.test_client()

    def test_describe(self):
        self.assertEqual(sky.describe(0, True), ("Clear Sky", "☀️"))
        self.assertEqual(sky.describe(0, False), ("Clear Sky", "🌙"))
        self.assertEqual(sky.describe(999)[0], "Unknown")

    @mock.patch("requests.get", side_effect=fake_get)
    def test_city_ok(self, _):
        r = self.c.get("/api/weather?city=Gwalior"); j = r.get_json()
        self.assertEqual(r.status_code, 200)
        self.assertEqual(j["location"], "Gwalior, Madhya Pradesh, India")
        self.assertEqual((j["temperature"], j["feels_like"], j["wind"], j["pressure"]), (25, 25, 9, 985))
        self.assertEqual(len(j["forecast"]), 5)
        self.assertEqual(j["forecast"][0]["day"], "Today")
        self.assertEqual(j["sunrise"], "6:41 AM"); self.assertEqual(j["sunset"], "5:36 PM")

    @mock.patch("requests.get", side_effect=fake_get)
    def test_coords_ok(self, _):
        j = self.c.get("/api/weather?lat=26.2&lon=78.1").get_json()
        self.assertEqual(j["city"], "Your Location")

    def test_empty(self):
        self.assertEqual(self.c.get("/api/weather").status_code, 400)

    @mock.patch("requests.get", side_effect=lambda *a, **k: R({}))
    def test_not_found(self, _):
        self.assertEqual(self.c.get("/api/weather?city=zzzz").status_code, 404)

    def test_bad_coords(self):
        self.assertEqual(self.c.get("/api/weather?lat=abc&lon=1").status_code, 400)

    @mock.patch("requests.get", side_effect=requests.exceptions.Timeout)
    def test_timeout(self, _):
        self.assertEqual(self.c.get("/api/weather?city=x").status_code, 504)

    @mock.patch("requests.get", side_effect=requests.exceptions.ConnectionError)
    def test_conn(self, _):
        self.assertEqual(self.c.get("/api/weather?city=x").status_code, 502)

    def test_index(self):
        r = self.c.get("/"); self.assertEqual(r.status_code, 200); self.assertIn(b"<title>SkyCast", r.data)

    def test_coord_range_and_nan(self):
        for q in ("lat=999&lon=1", "lat=1&lon=-181", "lat=nan&lon=1", "lat=inf&lon=1"):
            self.assertEqual(self.c.get("/api/weather?" + q).status_code, 400, q)

    @mock.patch("requests.get")
    def test_city_with_country_hint(self, g):
        geo = {"results": [
            {"name": "Paris", "admin1": "Texas", "country": "United States", "country_code": "US",
             "latitude": 33.6, "longitude": -95.5},
            {"name": "Paris", "admin1": "Île-de-France", "country": "France", "country_code": "FR",
             "latitude": 48.85, "longitude": 2.35}]}
        g.side_effect = lambda url, **kw: R(geo if "geocoding" in url else FC)
        j = self.c.get("/api/weather?city=Paris,%20France").get_json()
        self.assertEqual(j["location"], "Paris, Île-de-France, France")
        self.assertEqual(g.call_args_list[0].kwargs["params"]["name"], "Paris")

    @mock.patch("requests.get")
    def test_bad_upstream_json_is_not_coordinate_error(self, g):
        class Bad(R):
            def json(self): raise requests.exceptions.JSONDecodeError("x", "", 0)
        g.return_value = Bad({})
        self.assertEqual(self.c.get("/api/weather?city=x").status_code, 502)

    @mock.patch("requests.get")
    def test_upstream_http_error(self, g):
        class H(R):
            def raise_for_status(self): raise requests.exceptions.HTTPError("500")
        g.return_value = H({})
        r = self.c.get("/api/weather?city=x")
        self.assertEqual(r.status_code, 502)
        self.assertIn("returned an error", r.get_json()["error"])

    @mock.patch("requests.get", side_effect=lambda url, **kw: R({"results": [{"name": "A", "latitude": 1, "longitude": 1}]} if "geocoding" in url else {"current": {}}))
    def test_malformed_forecast(self, _):
        self.assertEqual(self.c.get("/api/weather?city=x").status_code, 502)

    def test_unknown_api_route_is_json(self):
        r = self.c.get("/api/nope"); self.assertEqual(r.status_code, 404); self.assertIn("error", r.get_json())


if __name__ == "__main__":
    unittest.main(verbosity=2)
