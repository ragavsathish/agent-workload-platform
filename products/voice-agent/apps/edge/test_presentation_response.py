import json
import unittest

from presentation_response import (
    StreamingSpokenExtractor,
    fallback_presentation,
    parse_presentation_response,
)


class PresentationResponseTest(unittest.TestCase):
    def test_streaming_spoken_extractor_handles_split_json_and_escapes(self):
        extractor = StreamingSpokenExtractor()
        chunks = ['{"sp', 'oken":"Hello', ' \\"voice\\"', '\\nline",', '"presentation":{}}']
        self.assertEqual("".join(extractor.feed(chunk) for chunk in chunks), 'Hello "voice"\nline')

    def test_parses_bounded_flow_presentation(self):
        result = parse_presentation_response(json.dumps({
            "spoken": "Task queued.",
            "presentation": {
                "kind": "flow",
                "title": "Task dispatch",
                "nodes": [{"id": "voice", "label": "Voice"}, {"id": "queue", "label": "Queue"}],
                "edges": [{"from": "voice", "to": "queue", "label": "submit"}],
            },
        }))
        self.assertEqual(result.spoken, "Task queued.")
        self.assertEqual(result.presentation["kind"], "flow")
        nodes = result.presentation["nodes"]
        self.assertIsInstance(nodes, list)
        self.assertEqual(len(nodes), 2)  # type: ignore[arg-type]
        self.assertEqual(result.resource_uri, "ui://mermaid/main")

    def test_accepts_bounded_excalidraw_presentation(self):
        result = parse_presentation_response(json.dumps({
            "spoken": "Here is the editable diagram.",
            "presentation": {
                "kind": "excalidraw",
                "title": "Voice path",
                "elements": [
                    {"type": "cameraUpdate", "x": 0, "y": 0, "width": 800, "height": 600},
                    {"type": "rectangle", "id": "voice", "x": 80, "y": 100,
                     "width": 180, "height": 80, "label": {"text": "Voice"}},
                ],
            },
        }))

        self.assertEqual(result.presentation["kind"], "excalidraw")
        self.assertEqual(result.resource_uri, "ui://excalidraw/mcp-app.html")
        elements = result.presentation["elements"]
        self.assertIsInstance(elements, list)
        self.assertEqual(len(elements), 2)  # type: ignore[arg-type]

    def test_routes_bounded_marp_slides_to_the_slides_app(self):
        markdown = """---
marp: true
---
# Voice architecture

---

```mermaid
flowchart LR
Voice --> Pi
```"""
        result = parse_presentation_response(json.dumps({
            "spoken": "Here are the requested slides.",
            "presentation": {
                "kind": "slides",
                "title": "Voice architecture",
                "markdown": markdown,
            },
        }))

        self.assertEqual(result.presentation["kind"], "slides")
        self.assertEqual(result.presentation["markdown"], markdown)
        self.assertEqual(result.resource_uri, "ui://slides/marp.html")

    def test_unwraps_a_json_encoded_marp_response(self):
        inner = json.dumps({
            "spoken": "Slides ready.",
            "presentation": {
                "kind": "slides",
                "title": "Live check",
                "markdown": "# Live check",
            },
        })

        result = parse_presentation_response(json.dumps(inner))

        self.assertEqual(result.spoken, "Slides ready.")
        self.assertEqual(result.presentation["kind"], "slides")
        self.assertEqual(result.resource_uri, "ui://slides/marp.html")

    def test_unwraps_repeatedly_encoded_marp_response(self):
        payload = json.dumps({
            "spoken": "Slides ready.",
            "presentation": {
                "kind": "slides",
                "title": "Live check",
                "markdown": "# Live check\n\n```mermaid\nflowchart LR\nA[Orchestrator] --> B[Marp App]\n```",
            },
        })

        result = parse_presentation_response(json.dumps(json.dumps(payload)))

        self.assertEqual(result.spoken, "Slides ready.")
        self.assertEqual(result.presentation["kind"], "slides")
        self.assertEqual(result.resource_uri, "ui://slides/marp.html")

    def test_unwraps_structured_response_nested_in_spoken(self):
        inner = json.dumps({
            "spoken": "Slides ready.",
            "presentation": {
                "kind": "slides",
                "title": "Live check",
                "markdown": "# Live check",
            },
        })

        result = parse_presentation_response(json.dumps({"spoken": inner}))

        self.assertEqual(result.spoken, "Slides ready.")
        self.assertEqual(result.presentation["kind"], "slides")
        self.assertEqual(result.resource_uri, "ui://slides/marp.html")

    def test_repairs_one_extra_trailing_brace_in_nested_response(self):
        inner = json.dumps({
            "spoken": "Slides ready.",
            "presentation": {
                "kind": "slides",
                "title": "Live check",
                "markdown": "# Live check",
            },
        }) + "}"

        result = parse_presentation_response(json.dumps({"spoken": inner}))

        self.assertEqual(result.spoken, "Slides ready.")
        self.assertEqual(result.presentation["kind"], "slides")
        self.assertEqual(result.resource_uri, "ui://slides/marp.html")

    def test_rejects_oversized_marp_slides(self):
        result = parse_presentation_response(json.dumps({
            "spoken": "Slides are too large.",
            "presentation": {
                "kind": "slides",
                "markdown": "x" * (64 * 1024 + 1),
            },
        }))

        self.assertEqual(result.presentation, fallback_presentation(result.spoken))
        self.assertEqual(result.resource_uri, "ui://mermaid/main")

    def test_repairs_model_excalidraw_camera_and_string_labels(self):
        result = parse_presentation_response(json.dumps({
            "spoken": "Here is the editable diagram.",
            "presentation": {
                "kind": "excalidraw",
                "title": "Voice path",
                "elements": [
                    {"type": "cameraUpdate", "id": "camera", "x": 0, "y": 0,
                     "width": 0, "height": 0},
                    {"type": "rectangle", "id": "voice", "x": 80, "y": 100,
                     "width": 180, "height": 80, "label": "Voice"},
                ],
            },
        }))

        elements = result.presentation["elements"]
        self.assertIsInstance(elements, list)
        camera, rectangle = elements  # type: ignore[misc]
        self.assertEqual(camera, {
            "type": "cameraUpdate", "x": 0, "y": 0, "width": 400, "height": 300,
        })
        self.assertEqual(rectangle["label"], {"text": "Voice"})

    def test_repairs_excalidraw_camera_to_fit_wide_content(self):
        result = parse_presentation_response(json.dumps({
            "spoken": "Here is the architecture.",
            "presentation": {
                "kind": "excalidraw",
                "elements": [
                    {"type": "cameraUpdate", "x": 0, "y": 0, "width": 0, "height": 0},
                    {"type": "rectangle", "id": "first", "x": 40, "y": 190,
                     "width": 150, "height": 70},
                    {"type": "rectangle", "id": "last", "x": 1410, "y": 330,
                     "width": 150, "height": 70},
                ],
            },
        }))

        elements = result.presentation["elements"]
        self.assertIsInstance(elements, list)
        camera = elements[0]  # type: ignore[index]
        self.assertEqual(camera["width"], 1600)
        self.assertEqual(camera["height"], 1200)

    def test_plain_or_invalid_response_gets_safe_status_fallback(self):
        plain = parse_presentation_response('Completed <unsafe> "work".')
        invalid = parse_presentation_response(json.dumps({
            "spoken": "Safe.",
            "presentation": {"kind": "html", "nodes": []},
        }))
        self.assertEqual(plain.presentation, fallback_presentation(plain.spoken))
        self.assertEqual(invalid.presentation, fallback_presentation("Safe."))


if __name__ == "__main__":
    unittest.main()
