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

    def test_accepts_bounded_grafana_trace_presentation(self):
        result = parse_presentation_response(json.dumps({
            "spoken": "Here is the trace.",
            "presentation": {
                "kind": "grafana-trace",
                "title": "Latest voice trace",
                "traceId": "ABCDEF0123456789ABCDEF0123456789",
                "datasourceUid": "tempo",
                "focusSpanId": "ABCDEF0123456789",
            },
        }))
        self.assertEqual(result.resource_uri, "ui://grafana/trace.html")
        self.assertEqual(result.presentation, {
            "kind": "grafana-trace",
            "title": "Latest voice trace",
            "traceId": "abcdef0123456789abcdef0123456789",
            "datasourceUid": "tempo",
            "focusSpanId": "abcdef0123456789",
        })

    def test_rejects_unbounded_grafana_trace_reference(self):
        result = parse_presentation_response(json.dumps({
            "spoken": "Trace unavailable.",
            "presentation": {
                "kind": "grafana-trace",
                "traceId": "../../secret",
                "datasourceUid": "tempo?unsafe=true",
            },
        }))
        self.assertEqual(result.resource_uri, "ui://mermaid/main")
        self.assertEqual(result.presentation, fallback_presentation(result.spoken))

    def test_accepts_bounded_playwright_trace_viewer_presentation(self):
        trace_id = "0123456789abcdef0123456789abcdef"
        viewer_url = (
            "http://trace-viewer:9450/trace-viewer/index.html?trace="
            f"http%3A%2F%2Ftrace-viewer%3A9450%2Fapi%2Fplaywright-traces%2F{trace_id}%2Ftrace.zip"
        )
        result = parse_presentation_response(json.dumps({
            "spoken": "Opening the matching workspace trace.",
            "presentation": {
                "kind": "playwright-trace-viewer",
                "title": "durable work through HTTP",
                "summary": "workspace · latest",
                "traceId": trace_id,
                "project": "workspace",
                "run": "latest",
                "modifiedAt": "2026-10-17T10:00:00.000Z",
                "viewerUrl": viewer_url,
                "narratedVideoUrl": (
                    "http://trace-viewer:9450/api/trace-explainers/"
                    "abcdef0123456789abcdef0123456789/video"
                ),
                "narratedDurationSeconds": 23,
                "narratedSceneCount": 2,
            },
        }))

        self.assertEqual(result.resource_uri, "ui://playwright-trace-viewer/main.html")
        self.assertEqual(result.presentation["traceId"], trace_id)
        self.assertEqual(result.presentation["viewerUrl"], viewer_url)
        self.assertEqual(result.presentation["narratedSceneCount"], 2)

    def test_rejects_cross_origin_playwright_trace_recording(self):
        trace_id = "0123456789abcdef0123456789abcdef"
        result = parse_presentation_response(json.dumps({
            "spoken": "Trace unavailable.",
            "presentation": {
                "kind": "playwright-trace-viewer",
                "traceId": trace_id,
                "viewerUrl": (
                    "https://viewer.example/trace-viewer/index.html?trace="
                    f"https%3A%2F%2Fevil.example%2Fapi%2Fplaywright-traces%2F{trace_id}%2Ftrace.zip"
                ),
            },
        }))

        self.assertEqual(result.resource_uri, "ui://mermaid/main")
        self.assertEqual(result.presentation, fallback_presentation(result.spoken))

    def test_routes_exact_evidence_to_the_journal_review_app(self):
        transcript = (
            "I want to improve the prompt and annotate examples first. "
            "Use reviewed labels before training a model."
        )
        quote = "Use reviewed labels before training a model."
        start = transcript.index(quote)
        result = parse_presentation_response(json.dumps({
            "spoken": "The journal review is ready.",
            "presentation": {
                "kind": "journal-review",
                "reviewId": "review-local-001",
                "title": "Review journal extraction",
                "source": "Voice session",
                "transcript": transcript,
                "suggestion": {
                    "id": "suggestion-001",
                    "type": "decision",
                    "statement": quote,
                    "topics": ["annotation", "training"],
                    "confidence": 0.91,
                    "evidence": {"quote": quote, "start": start, "end": start + len(quote)},
                },
                "progress": {"current": 1, "total": 40, "reviewed": 0},
                "outcome": "pending",
            },
        }))

        self.assertEqual(result.resource_uri, "ui://journal-review/main.html")
        self.assertEqual(result.presentation["kind"], "journal-review")
        suggestion = result.presentation["suggestion"]
        assert isinstance(suggestion, dict)
        evidence = suggestion["evidence"]
        assert isinstance(evidence, dict)
        self.assertEqual(evidence["quote"], quote)

    def test_rejects_journal_evidence_that_is_not_an_exact_quote(self):
        result = parse_presentation_response(json.dumps({
            "spoken": "Review unavailable.",
            "presentation": {
                "kind": "journal-review",
                "reviewId": "review-local-001",
                "transcript": "The exact transcript.",
                "suggestion": {
                    "id": "suggestion-001",
                    "type": "decision",
                    "statement": "A decision.",
                    "topics": [],
                    "confidence": 0.8,
                    "evidence": {"quote": "invented", "start": 0, "end": 8},
                },
            },
        }))

        self.assertEqual(result.resource_uri, "ui://mermaid/main")
        self.assertEqual(result.presentation, fallback_presentation(result.spoken))

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
