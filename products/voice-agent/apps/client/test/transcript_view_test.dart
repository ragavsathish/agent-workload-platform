import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:voice_agent_client/api_client.dart';
import 'package:voice_agent_client/models.dart';
import 'package:voice_agent_client/views/transcript_view.dart';

void main() {
  testWidgets(
    'successful chat is not reported as failed when autoplay is blocked',
    (tester) async {
      final api = _FakeVoiceApi();

      await tester.pumpWidget(
        MaterialApp(
          home: TranscriptView(
            api: api,
            playSpeech: (_) async => throw Exception(
              'NotAllowedError: The request is not allowed by the user agent',
            ),
          ),
        ),
      );
      await tester.pump();

      await tester.enterText(
        find.byKey(const Key('message-pi')),
        'Is it completed?',
      );
      await tester.tap(find.byKey(const Key('send-message')));
      await tester.pump();

      expect(api.sentMessages, ['Is it completed?']);
      expect(find.byKey(const Key('timeline-error')), findsNothing);
      expect(find.byKey(const Key('playback-notice')), findsOneWidget);
      expect(find.textContaining('Tap Listen again'), findsOneWidget);
    },
  );

  testWidgets('desktop keeps tasks separate from the conversation', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1180, 820);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _FakeVoiceApi()..taskValues.add(_pendingTask);

    await tester.pumpWidget(MaterialApp(home: TranscriptView(api: api)));
    await tester.pump();

    expect(find.byKey(const Key('conversation-section')), findsOneWidget);
    expect(find.byKey(const Key('task-pending-1')), findsNothing);

    await tester.tap(find.byKey(const Key('tasks-section')));
    await tester.pump();

    expect(find.byKey(const Key('task-board')), findsOneWidget);
    expect(find.byKey(const Key('task-pending-1')), findsOneWidget);
    expect(find.text('Waiting for approval · now'), findsOneWidget);
  });

  testWidgets('mobile switches to tasks without changing the voice surface', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(390, 844);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _FakeVoiceApi()..taskValues.add(_pendingTask);

    await tester.pumpWidget(MaterialApp(home: TranscriptView(api: api)));
    await tester.pump();
    await tester.tap(find.byKey(const Key('workspace-section-toggle')));
    await tester.pump();

    expect(find.byKey(const Key('task-board')), findsOneWidget);
    expect(find.byKey(const Key('task-pending-1')), findsOneWidget);
  });

  testWidgets('creates a durable task through the existing task API', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1180, 820);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _FakeVoiceApi();

    await tester.pumpWidget(MaterialApp(home: TranscriptView(api: api)));
    await tester.pump();
    await tester.tap(find.byKey(const Key('new-task')));
    await tester.pump();
    await tester.enterText(
      find.byKey(const Key('new-task-instruction')),
      'Audit the release',
    );
    await tester.tap(find.byKey(const Key('submit-new-task')));
    await tester.pump();

    expect(api.createdTasks, ['Audit the release']);
    expect(find.byKey(const Key('task-board')), findsOneWidget);
  });
}

class _FakeVoiceApi extends VoiceApi {
  final List<String> sentMessages = [];
  final List<String> createdTasks = [];
  final List<AgentTask> taskValues = [];

  @override
  Future<TranscriptSnapshot> transcript() async =>
      const TranscriptSnapshot(revision: 0, entries: []);

  @override
  Future<List<AgentTask>> tasks() async => List.of(taskValues);

  @override
  Future<ContextUsage> context() async => const ContextUsage(
    tokens: 1200,
    contextWindow: 8000,
    percent: 15,
    estimated: false,
    canCompact: true,
  );

  @override
  Future<AgentTask> createTask(String instruction) async {
    createdTasks.add(instruction);
    final task = AgentTask(
      id: 'created-1',
      instruction: instruction,
      workspace: '/workspace',
      planHash: 'created-hash',
      status: 'pending',
      createdAt: DateTime.now(),
      state: 'pending',
    );
    taskValues.insert(0, task);
    return task;
  }

  @override
  Future<VisualResponse> sendMessage(String message) async {
    sentMessages.add(message);
    return const VisualResponse(
      spoken: 'The task is complete.',
      mermaid: 'flowchart LR\nA --> B',
    );
  }
}

final _pendingTask = AgentTask(
  id: 'pending-1',
  instruction: 'Inspect the deployment',
  workspace: '/workspace',
  planHash: 'plan-hash',
  status: 'pending',
  createdAt: DateTime.now(),
  state: 'pending',
);
