import json
import os
import unittest
from unittest.mock import MagicMock, patch

import psycopg2

import main


class HealthTests(unittest.TestCase):
    def test_liveness_does_not_claim_database_connection(self):
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://unreachable"}):
            self.assertEqual(main.health_check()["status"], "healthy")
            self.assertNotIn("database_connected", main.health_check())

    def test_readiness_without_configuration_is_unavailable(self):
        with patch.dict(os.environ, {}, clear=True):
            response = main.readiness_check()
        self.assertEqual(response.status_code, 503)
        self.assertFalse(json.loads(response.body)["database_connected"])

    def test_readiness_with_unreachable_database_is_unavailable(self):
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://unreachable"}), patch(
            "main.psycopg2.connect", side_effect=psycopg2.OperationalError("secret")
        ):
            response = main.readiness_check()
        self.assertEqual(response.status_code, 503)
        self.assertFalse(json.loads(response.body)["database_connected"])
        self.assertNotIn(b"secret", response.body)

    def test_readiness_requires_successful_query_and_closes_connection(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (1,)
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://db"}), patch(
            "main.psycopg2.connect", return_value=connection
        ) as connect:
            response = main.readiness_check()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(json.loads(response.body)["database_connected"])
        connect.assert_called_once_with(
            "postgresql://db", connect_timeout=3, options="-c statement_timeout=3000"
        )
        cursor.execute.assert_called_once_with("SELECT 1")
        connection.close.assert_called_once()

    def test_query_failure_is_unavailable_and_closes_connection(self):
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value.execute.side_effect = (
            psycopg2.OperationalError("query failed")
        )
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://db"}), patch(
            "main.psycopg2.connect", return_value=connection
        ):
            response = main.readiness_check()
        self.assertEqual(response.status_code, 503)
        connection.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
