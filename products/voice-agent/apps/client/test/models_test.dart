import 'package:flutter_test/flutter_test.dart';
import 'package:voice_agent_client/models.dart';

void main() {
  test('parses a visual Pi response without exposing raw JSON', () {
    final response = VisualResponse.fromValue(
      '{"spoken":"Done.","mermaid":"flowchart LR\\nA --> B"}',
    );

    expect(response?.spoken, 'Done.');
    expect(response?.mermaid, contains('A --> B'));
  });

  test('rejects non-visual transcript text', () {
    expect(VisualResponse.fromValue('plain response'), isNull);
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
