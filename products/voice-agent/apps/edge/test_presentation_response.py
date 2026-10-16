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
        self.assertEqual(len(result.presentation["nodes"]), 2)
        self.assertEqual(result.resource_uri, "ui://voice-canvas/main")

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
        self.assertEqual(len(result.presentation["elements"]), 2)

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
