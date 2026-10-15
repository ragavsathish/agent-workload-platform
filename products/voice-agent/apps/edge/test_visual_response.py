import json
import unittest

from visual_response import (
    MAX_DIAGRAM_LENGTH,
    StreamingSpokenExtractor,
    fallback_mermaid,
    parse_visual_response,
)


class VisualResponseTest(unittest.TestCase):
    def test_streaming_spoken_extractor_handles_split_json_and_escapes(self):
        extractor = StreamingSpokenExtractor()
        chunks = ['{"sp', 'oken":"Hello', ' \\"voice\\"', '\\nline",', '"mermaid":"flowchart TD"}']

        self.assertEqual(
            "".join(extractor.feed(chunk) for chunk in chunks),
            'Hello "voice"\nline',
        )
        self.assertTrue(extractor.started)
        self.assertTrue(extractor.finished)

    def test_streaming_spoken_extractor_handles_unicode_escape_across_chunks(self):
        extractor = StreamingSpokenExtractor()

        self.assertEqual(extractor.feed('{"spoken":"Hi \\u2'), "Hi ")
        self.assertEqual(extractor.feed('63A","mermaid":"flowchart TD"}'), "☺")
        self.assertTrue(extractor.finished)

    def test_parses_structured_response(self):
        result = parse_visual_response(
            '{"spoken":"Task queued.","mermaid":"flowchart TD\\n  A[Voice] --> B[Queue]"}'
        )

        self.assertEqual(result.spoken, "Task queued.")
        self.assertEqual(result.mermaid, "flowchart TD\n  A[Voice] --> B[Queue]")

    def test_accepts_json_code_fence_but_not_mermaid_fence(self):
        result = parse_visual_response(
            '```json\n{"spoken":"Ready.","mermaid":"```mermaid\\nflowchart TD\\n A[Ready]\\n```"}\n```'
        )

        self.assertEqual(result.spoken, "Ready.")
        self.assertEqual(result.mermaid, "flowchart TD\n A[Ready]")

    def test_accepts_literal_newline_from_local_model(self):
        result = parse_visual_response(
            '{"spoken":"Voice interface ready.","mermaid":"flowchart TD\n  Voice --> Pi"}'
        )

        self.assertEqual(result.spoken, "Voice interface ready.")
        self.assertEqual(result.mermaid, "flowchart TD\n  Voice --> Pi")

    def test_plain_text_falls_back_to_safe_diagram(self):
        result = parse_visual_response('Completed <unsafe> "work".')

        self.assertEqual(result.spoken, 'Completed <unsafe> "work".')
        self.assertEqual(result.mermaid, fallback_mermaid(result.spoken))
        self.assertIn("&lt;unsafe&gt;", result.mermaid)
        self.assertIn("&quot;work&quot;", result.mermaid)

    def test_rejects_oversized_or_unknown_diagram(self):
        oversized = "flowchart TD\n" + ("A" * MAX_DIAGRAM_LENGTH)
        result = parse_visual_response(
            json.dumps({"spoken": "Safe.", "mermaid": oversized})
        )
        unknown = parse_visual_response(
            '{"spoken":"Safe.","mermaid":"packet-beta\\n  0: hi"}'
        )

        self.assertEqual(result.mermaid, fallback_mermaid("Safe."))
        self.assertEqual(unknown.mermaid, fallback_mermaid("Safe."))


if __name__ == "__main__":
    unittest.main()
