import base64
import io

from PIL import Image


def png_b64(colour: tuple[int, int, int]) -> str:
    buffer = io.BytesIO()
    Image.new("RGB", (16, 16), colour).save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode()


def test_health_while_loading(loading_client):
    body = loading_client.get("/health").json()
    assert body["ready"] is False
    assert body["device"] == "cpu"
    assert body["models"] == {}


def test_endpoints_503_until_ready(loading_client):
    assert loading_client.post("/embed/text", json={"texts": ["hei"]}).status_code == 503
    assert loading_client.post("/embed/image", json={"images": [png_b64((1, 2, 3))]}).status_code == 503


def test_health_when_ready(ready_client):
    body = ready_client.get("/health").json()
    assert body["ready"] is True
    assert body["models"]["text"] == {"name": "stub-text", "revision": "r1", "dimensions": 8}
    assert body["models"]["image"]["name"] == "stub-image"


def test_text_batch_returns_one_unit_vector_per_text(ready_client):
    response = ready_client.post("/embed/text", json={"texts": ["sähkölasku", "invoice"], "role": "passage"})
    assert response.status_code == 200
    body = response.json()
    assert body["model"]["revision"] == "r1"
    assert len(body["embeddings"]) == 2
    assert abs(sum(v * v for v in body["embeddings"][0]) - 1) < 1e-6


def test_text_role_changes_the_vector(ready_client):
    passage = ready_client.post("/embed/text", json={"texts": ["x"], "role": "passage"}).json()["embeddings"]
    query = ready_client.post("/embed/text", json={"texts": ["x"], "role": "query"}).json()["embeddings"]
    assert passage != query


def test_text_limits(ready_client):
    assert ready_client.post("/embed/text", json={"texts": []}).status_code == 422
    assert ready_client.post("/embed/text", json={"texts": ["a"] * 65}).status_code == 422
    assert ready_client.post("/embed/text", json={"texts": ["a" * 20_001]}).status_code == 413
    assert ready_client.post("/embed/text", json={"texts": ["a"], "role": "other"}).status_code == 422


def test_image_batch(ready_client):
    response = ready_client.post("/embed/image", json={"images": [png_b64((255, 0, 0)), png_b64((0, 0, 255))]})
    assert response.status_code == 200
    assert len(response.json()["embeddings"]) == 2


def test_image_bad_base64_is_422(ready_client):
    assert ready_client.post("/embed/image", json={"images": ["***"]}).status_code == 422


def test_image_undecodable_is_422_with_index(ready_client):
    garbage = base64.b64encode(b"not an image").decode()
    response = ready_client.post("/embed/image", json={"images": [png_b64((0, 0, 0)), garbage]})
    assert response.status_code == 422
    assert "1" in response.json()["detail"]


def test_image_text_tower(ready_client):
    response = ready_client.post("/embed/image-text", json={"texts": ["punainen talo"]})
    assert response.status_code == 200
    assert len(response.json()["embeddings"][0]) == 8
