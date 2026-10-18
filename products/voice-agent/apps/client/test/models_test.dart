import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_agent_client/models.dart';

void main() {
  test('parses a visual Pi response without exposing raw JSON', () {
    final response = VisualResponse.fromValue(
      '{"spoken":"Done.","presentation":{"kind":"flow","title":"Done","nodes":[{"id":"a","label":"A"},{"id":"b","label":"B"}],"edges":[{"from":"a","to":"b"}]}}',
    );

    expect(response?.spoken, 'Done.');
    expect(response?.presentation['kind'], 'flow');
  });

  test('rejects non-visual transcript text', () {
    expect(VisualResponse.fromValue('plain response'), isNull);
  });

  test('routes an Excalidraw transcript response to the Excalidraw app', () {
    final response = VisualResponse.fromValue(
      '{"spoken":"Here is the drawing.","presentation":{"kind":"excalidraw","elements":[{"type":"rectangle","x":20,"y":20,"width":200,"height":80,"label":{"text":"Voice"}}]}}',
    );

    expect(response?.resourceUri, 'ui://excalidraw/mcp-app.html');
  });

  test('routes a Marp transcript response to the slides app', () {
    final response = VisualResponse.fromValue({
      'spoken': 'Slides ready.',
      'presentation': {
        'kind': 'slides',
        'title': 'Voice path',
        'markdown': '# Voice path\n\n---\n\n# Result',
      },
    });

    expect(response?.resourceUri, 'ui://slides/marp.html');
  });

  test('routes a Playwright trace response to the trace viewer app', () {
    final response = VisualResponse.fromValue({
      'spoken': 'Trace viewer ready.',
      'presentation': {
        'kind': 'playwright-trace-viewer',
        'title': 'Responsive journey',
        'status': 'completed',
        'traceId': '0123456789abcdef0123456789abcdef',
      },
    });

    expect(response?.resourceUri, 'ui://playwright-trace-viewer/main.html');
  });

  test('routes a journal review response to the Recogito app', () {
    final response = VisualResponse.fromValue({
      'spoken': 'Review ready.',
      'presentation': {
        'kind': 'journal-review',
        'reviewId': 'review-1',
        'transcript': 'Use reviewed labels before training.',
      },
    });

    expect(response?.resourceUri, 'ui://journal-review/main.html');
  });

  test('routes a restored Grafana trace response to the Grafana app', () {
    final response = VisualResponse.fromValue({
      'spoken': 'Trace ready.',
      'presentation': {
        'kind': 'grafana-trace',
        'title': 'Latest trace',
        'traceId': '0123456789abcdef0123456789abcdef',
        'datasourceUid': 'tempo',
      },
    });

    expect(response?.resourceUri, 'ui://grafana/trace.html');
  });

  test('restores the latest visual response from a persisted transcript', () {
    final snapshot = TranscriptSnapshot.fromJson({
      'revision': 4,
      'entries': [
        {
          'id': '1',
          'timestamp': 1,
          'role': 'assistant',
          'text': 'Plain answer',
        },
        {
          'id': '2',
          'timestamp': 2,
          'role': 'assistant',
          'status': 'completed',
          'text': jsonEncode({
            'spoken': 'Trace restored.',
            'presentation': {
              'kind': 'playwright-trace-viewer',
              'traceId': '0123456789abcdef0123456789abcdef',
            },
          }),
        },
      ],
    });

    expect(snapshot.latestVisualResponse?.spoken, 'Trace restored.');
    expect(
      snapshot.latestVisualResponse?.resourceUri,
      'ui://playwright-trace-viewer/main.html',
    );
  });

  test('unwraps a JSON-encoded Marp transcript response', () {
    final response = VisualResponse.fromValue(
      jsonEncode(
        jsonEncode({
          'spoken': 'Slides ready.',
          'presentation': {
            'kind': 'slides',
            'title': 'Live check',
            'markdown': '# Live check',
          },
        }),
      ),
    );

    expect(response?.spoken, 'Slides ready.');
    expect(response?.resourceUri, 'ui://slides/marp.html');
  });

  test('unwraps a Marp response nested in spoken', () {
    final response = VisualResponse.fromValue({
      'spoken': jsonEncode({
        'spoken': 'Slides ready.',
        'presentation': {
          'kind': 'slides',
          'title': 'Live check',
          'markdown': '# Live check',
        },
      }),
    });

    expect(response?.spoken, 'Slides ready.');
    expect(response?.presentation['kind'], 'slides');
    expect(response?.resourceUri, 'ui://slides/marp.html');
  });

  test('repairs one extra trailing brace in a nested Marp response', () {
    final nested =
        '${jsonEncode({
          'spoken': 'Slides ready.',
          'presentation': {'kind': 'slides', 'title': 'Live check', 'markdown': '# Live check'},
        })}}';
    final response = VisualResponse.fromValue({'spoken': nested});

    expect(response?.spoken, 'Slides ready.');
    expect(response?.presentation['kind'], 'slides');
    expect(response?.resourceUri, 'ui://slides/marp.html');
  });

  test('derives an active task from worker state', () {
    final task = AgentTask.fromJson({
      'id': 'task-1',
      'instruction': 'Inspect the repository',
      'workspace': '/workspace',
      'plan_hash': 'abc',
      'status': 'approved',
      'created_at': '2026-10-15T20:00:00Z',
      'result': {'state': 'running'},
    });

    expect(task.state, 'running');
    expect(task.isActive, isTrue);
  });

  test('parses a server-assigned jazz session identity', () {
    final task = AgentTask.fromJson({
      'id': 'task-1',
      'instruction': 'Inspect the repository',
      'workspace': '/workspace',
      'plan_hash': 'abc',
      'status': 'pending',
      'created_at': '2026-10-15T20:00:00Z',
      'session_name': 'Kind of Blue',
      'session_reference': {
        'artist': 'Miles Davis',
        'spotify_url': 'https://open.spotify.com/album/1weenld61qoidwYuZ1GESA',
      },
    });

    expect(task.sessionName, 'Kind of Blue');
    expect(task.sessionArtist, 'Miles Davis');
    expect(
      task.sessionSpotifyUrl,
      'https://open.spotify.com/album/1weenld61qoidwYuZ1GESA',
    );
  });
}
