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
}
