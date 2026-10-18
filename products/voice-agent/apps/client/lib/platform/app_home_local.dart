import 'package:flutter/widgets.dart';

import '../api_client.dart';
import '../views/transcript_view.dart';
import '../views/voice_view.dart';

Widget buildAppHome({required VoiceApi api, required String? view}) {
  return switch (view) {
    'transcript' => TranscriptView(api: api),
    'journal-review-preview' => VoiceView(
      api: api,
      initialResourceUri: 'ui://journal-review/main.html',
      initialPresentation: const {
        'kind': 'journal-review',
        'reviewId': 'review-local-001',
        'title': 'Review journal extraction',
        'source': 'Voice session · local preview',
        'transcript':
            'I want to improve the prompt and annotate examples first. '
            'Use reviewed labels before training a model. '
            'The voice session should query Oxigraph for knowledge and keep the review visible.',
        'suggestion': {
          'id': 'suggestion-001',
          'type': 'decision',
          'statement': 'Use reviewed labels before training a model.',
          'topics': ['evaluation', 'annotation', 'training'],
          'confidence': 0.91,
          'evidence': {
            'quote': 'Use reviewed labels before training a model.',
            'start': 58,
            'end': 102,
          },
        },
        'progress': {'current': 7, 'total': 40, 'reviewed': 6},
      },
    ),
    _ => VoiceView(api: api),
  };
}
