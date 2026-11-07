import json
import httpx
from backend.ai import review


def test_yandex_request_keeps_credentials_and_raw_out_of_payload(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "yandex")
    monkeypatch.setenv("AI_FOLDER_ID", "test-folder")
    monkeypatch.setenv("AI_API_KEY", "test-secret")
    monkeypatch.delenv("AI_MODEL", raising=False)
    monkeypatch.delenv("AI_API_URL", raising=False)
    def post(url, **kwargs):
        assert kwargs["headers"]["Authorization"] == "Api-Key test-secret"
        assert kwargs["headers"]["x-data-logging-enabled"] == "false"
        assert kwargs["json"]["model"] == "gpt://test-folder/yandexgpt-5.1"
        content = kwargs["json"]["messages"][1]["content"]
        assert "secret-app" not in content and "test-secret" not in content
        assert json.loads(content)["summary"]["changedApps"] == 1
        return httpx.Response(200, json={"choices": [{"message": {"content": "Заключение"}}]}, request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx, "post", post)
    assert review({"changedApps": 1, "raw": "secret-app"}, [{"APP_IDS": ["secret-app"]}])["status"] == "READY"


def test_yandex_failure_is_safe(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "yandex")
    monkeypatch.setenv("AI_FOLDER_ID", "test-folder")
    monkeypatch.setenv("AI_API_KEY", "test-secret")
    def post(url, **kwargs):
        return httpx.Response(403, text="test-secret", request=httpx.Request("POST", url))
    monkeypatch.setattr(httpx, "post", post)
    result = review({}, [])
    assert result["status"] == "FAILED"
    assert "403" in result["error"] and "test-secret" not in str(result)
