import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:voice_agent_client/api_client.dart';
import 'package:voice_agent_client/models.dart';
import 'package:voice_agent_client/views/pi_workspace_view.dart';
import 'package:voice_agent_client/views/transcript_view.dart';

void main() {
  testWidgets('Pi brand returns to the voice assistant', (tester) async {
    final api = _FakeVoiceApi();
    var returnedHome = false;

    await tester.pumpWidget(
      MaterialApp(
        home: TranscriptView(
          api: api,
          onNavigateHome: () => returnedHome = true,
        ),
      ),
    );
    await tester.pump();

    await tester.tap(find.byKey(const Key('workspace-home')));

    expect(returnedHome, isTrue);
  });

  testWidgets('mobile composer is laid out on its first frame', (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(390, 844);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _FakeVoiceApi();

    await tester.pumpWidget(MaterialApp(home: TranscriptView(api: api)));
    await tester.pump();

    final composer = tester.getRect(find.byKey(const Key('message-pi')));
    expect(composer.width, greaterThan(0));
    expect(composer.height, greaterThan(0));
    expect(composer.bottom, lessThanOrEqualTo(844));
  });

  test('progress burst becomes a concise spoken update', () {
    final summary = summarizeTaskProgress(const [
      TaskProgressEvent(id: 1, spoken: 'The agent has started working.'),
      TaskProgressEvent(
        id: 2,
        spoken: 'The agent is running a workspace command.',
      ),
      TaskProgressEvent(id: 3, spoken: 'The agent is reading SKILL.md.'),
      TaskProgressEvent(
        id: 4,
        spoken: 'The agent is running a workspace command.',
      ),
      TaskProgressEvent(
        id: 5,
        spoken: 'A task tool reported an error; the agent is checking what happened.',
      ),
      TaskProgressEvent(
        id: 6,
        spoken: 'The agent is running: git diff main...HEAD.',
      ),
    ]);
    expect(summary, isNot(contains('started working')));
    expect(summary, isNot(contains('updates')));
    expect(summary, contains('2 workspace commands'));
    expect(summary, contains('1 tool error'));
    expect(summary, contains('reading SKILL.md'));
    expect(summary, contains('git diff main...HEAD'));
  });

  test('old task-start event is silent on its own', () {
    expect(
      summarizeTaskProgress(const [
        TaskProgressEvent(id: 1, spoken: 'The agent has started working.'),
      ]),
      isEmpty,
    );
  });

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
    expect(find.text('Kind of Blue'), findsWidgets);
    expect(find.text('Miles Davis'), findsOneWidget);
    expect(find.byKey(const Key('task-spotify-pending-1')), findsOneWidget);
    expect(find.text('Listen to agent'), findsOneWidget);
    final spotifyWraps = find.ancestor(
      of: find.byKey(const Key('task-spotify-pending-1')),
      matching: find.byType(Wrap),
    );
    final narrationWraps = find.ancestor(
      of: find.byKey(const Key('task-narration-pending-1')),
      matching: find.byType(Wrap),
    );
    expect(
      spotifyWraps.evaluate().toSet().intersection(
        narrationWraps.evaluate().toSet(),
      ),
      isNotEmpty,
    );
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

  testWidgets('task progress is spoken only after Listen is pressed', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1180, 820);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _FakeVoiceApi()..taskValues.add(_pendingTask);
    final spoken = <String>[];

    await tester.pumpWidget(
      MaterialApp(
        home: TranscriptView(
          api: api,
          playSpeech: (text) async => spoken.add(text),
        ),
      ),
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('tasks-section')));
    await tester.pump();
    expect(spoken, isEmpty);

    await tester.tap(find.byKey(const Key('task-narration-pending-1')));
    await tester.pump();
    expect(spoken, ['The agent is reading source files.']);
    expect(find.text('Stop listening'), findsOneWidget);

    await tester.tap(find.byKey(const Key('task-narration-pending-1')));
    await tester.pump();
    expect(find.text('Listen to agent'), findsOneWidget);
  });

  testWidgets('Listen batches queued task actions into one summary', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1180, 820);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _FakeVoiceApi()
      ..taskValues.add(_pendingTask)
      ..progressValues.addAll(const [
        TaskProgressEvent(id: 1, spoken: 'The agent started.'),
        TaskProgressEvent(id: 2, spoken: 'Reading README.md.'),
        TaskProgressEvent(id: 3, spoken: 'Running git status --short.'),
      ]);
    final spoken = <String>[];

    await tester.pumpWidget(
      MaterialApp(
        home: TranscriptView(
          api: api,
          playSpeech: (text) async => spoken.add(text),
        ),
      ),
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('tasks-section')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('task-narration-pending-1')));
    await tester.pump();

    expect(spoken, [
      'The agent started. Reading README.md. Running git status --short.',
    ]);
  });

  testWidgets('Listen speaks the separate Pi recap instead of commands', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1180, 820);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _FakeVoiceApi()
      ..taskValues.add(_pendingTask)
      ..progressValues.addAll(const [
        TaskProgressEvent(id: 1, spoken: 'The agent is reading README.md.'),
        TaskProgressEvent(id: 2, spoken: 'The agent is running: git diff.'),
      ])
      ..narrationOverride =
          'The agent is checking the project guidance and reviewing the changes.';
    final spoken = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        home: TranscriptView(
          api: api,
          playSpeech: (text) async => spoken.add(text),
        ),
      ),
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('tasks-section')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('task-narration-pending-1')));
    await tester.pump();

    expect(api.narratedRanges, [(0, 2)]);
    expect(spoken, [api.narrationOverride]);
  });

  testWidgets('Listen falls back when the narrator is unavailable', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1180, 820);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _FakeVoiceApi()
      ..taskValues.add(_pendingTask)
      ..progressValues.add(
        const TaskProgressEvent(id: 1, spoken: 'Reading the PR diff.'),
      )
      ..narrationFails = true;
    final spoken = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        home: TranscriptView(
          api: api,
          playSpeech: (text) async => spoken.add(text),
        ),
      ),
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('tasks-section')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('task-narration-pending-1')));
    await tester.pump();

    expect(spoken, ['Reading the PR diff.']);
  });

  testWidgets('Listen keeps fetching progress while speech is playing', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1180, 820);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _FakeVoiceApi()
      ..taskValues.add(_pendingTask)
      ..progressValues.add(
        const TaskProgressEvent(id: 1, spoken: 'Reading the PR diff.'),
      );
    final firstSpeech = Completer<void>();
    final spoken = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        home: TranscriptView(
          api: api,
          playSpeech: (text) {
            spoken.add(text);
            return spoken.length == 1 ? firstSpeech.future : Future.value();
          },
        ),
      ),
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('tasks-section')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('task-narration-pending-1')));
    await tester.pump();
    expect(spoken, ['Reading the PR diff.']);

    api.progressValues.add(
      const TaskProgressEvent(id: 2, spoken: 'Running the checks.'),
    );
    await tester.pump(const Duration(seconds: 4));
    expect(api.progressAfter, contains(1));
    expect(spoken, ['Reading the PR diff.']);

    firstSpeech.complete();
    await tester.pump();
    expect(spoken, contains('Running the checks.'));
  });

  testWidgets('task completion waits for queued narration', (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1180, 820);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _FakeVoiceApi()
      ..taskValues.add(_pendingTask)
      ..progressValues.add(
        const TaskProgressEvent(id: 1, spoken: 'Reading source.'),
      );
    final firstSpeech = Completer<void>();
    final secondSpeech = Completer<void>();
    final spoken = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        home: TranscriptView(
          api: api,
          playSpeech: (text) {
            spoken.add(text);
            if (text == 'Reading source.') return firstSpeech.future;
            if (text == 'Running tests.') return secondSpeech.future;
            return Future.value();
          },
        ),
      ),
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('tasks-section')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('task-narration-pending-1')));
    await tester.pump();
    expect(spoken, ['Reading source.']);

    api.progressValues.add(
      const TaskProgressEvent(id: 2, spoken: 'Running tests.'),
    );
    api.taskValues[0] = AgentTask(
      id: _pendingTask.id,
      instruction: _pendingTask.instruction,
      workspace: _pendingTask.workspace,
      planHash: _pendingTask.planHash,
      status: 'completed',
      state: 'completed',
      createdAt: _pendingTask.createdAt,
      response: const VisualResponse(
        spoken: 'Task finished.',
        presentation: {},
      ),
    );
    await tester.pump(const Duration(seconds: 4));
    expect(spoken, ['Reading source.']);
    expect(api.progressAfter, contains(1));
    firstSpeech.complete();
    await tester.pump();
    expect(spoken, ['Reading source.', 'Running tests.']);
    secondSpeech.complete();
    await tester.pump();
    expect(spoken, ['Reading source.', 'Running tests.', 'Task finished.']);
  });

  testWidgets('Listen drains progress beyond one API page', (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1180, 820);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _FakeVoiceApi()
      ..taskValues.add(_pendingTask)
      ..progressValues.addAll(
        List.generate(
          41,
          (index) =>
              TaskProgressEvent(id: index + 1, spoken: 'Action ${index + 1}.'),
        ),
      );
    final spoken = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        home: TranscriptView(
          api: api,
          playSpeech: (text) async => spoken.add(text),
        ),
      ),
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('tasks-section')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('task-narration-pending-1')));
    await tester.pump();

    expect(api.progressAfter, contains(40));
    expect(api.narratedRanges, [(0, 40), (40, 41)]);
    expect(spoken, hasLength(2));
    expect(spoken.last, contains('Action 41.'));
  });

  testWidgets('completed task can replay its actions and rationale', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1180, 820);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _FakeVoiceApi()
      ..taskValues.add(
        AgentTask(
          id: 'completed-1',
          instruction: 'Inspect the deployment',
          workspace: '/workspace',
          planHash: 'plan-hash',
          status: 'completed',
          state: 'completed',
          createdAt: DateTime.now(),
          response: const VisualResponse(
            spoken: 'I checked the stack because the deployment was failing. The health checks passed.',
            presentation: {},
          ),
        ),
      )
      ..progressValues.addAll(const [
        TaskProgressEvent(id: 1, spoken: 'Reading compose.yaml.'),
        TaskProgressEvent(id: 2, spoken: 'Running docker compose ps.'),
      ]);
    final spoken = <String>[];

    await tester.pumpWidget(
      MaterialApp(
        home: TranscriptView(
          api: api,
          playSpeech: (text) async => spoken.add(text),
        ),
      ),
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('tasks-section')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('task-narration-completed-1')));
    await tester.pump();

    expect(spoken, [
      'Reading compose.yaml. Running docker compose ps.',
      'I checked the stack because the deployment was failing. The health checks passed.',
    ]);
  });

  testWidgets('task card shows Tailscale HTTPS link for its allowed artifact', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1180, 820);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final api = _FakeVoiceApi()
      ..taskValues.addAll([
        AgentTask(
          id: '11111111-1111-4111-8111-111111111111',
          instruction: 'Write a scratch file',
          workspace: 'scratch',
          planHash: 'scratch-hash',
          status: 'completed',
          state: 'completed',
          createdAt: DateTime.now(),
          artifacts: const ['workspace', 'execution'],
        ),
        AgentTask(
          id: '22222222-2222-4222-8222-222222222222',
          instruction: 'Edit a repository',
          workspace: 'repository',
          planHash: 'repo-hash',
          status: 'completed',
          state: 'completed',
          createdAt: DateTime.now(),
          artifacts: const ['patch', 'status', 'execution'],
        ),
      ]);

    await tester.pumpWidget(MaterialApp(home: TranscriptView(api: api)));
    await tester.pump();
    await tester.tap(find.byKey(const Key('tasks-section')));
    await tester.pump();
    await tester.tap(find.text('Integrity & output').first);
    await tester.pumpAndSettle();
    expect(
      find.byKey(
        const Key(
          'task-artifact-11111111-1111-4111-8111-111111111111-workspace',
        ),
      ),
      findsOneWidget,
    );
    expect(
      find.textContaining(
        'https://pipecat-edge.tailf6d713.ts.net/api/tasks/11111111-1111-4111-8111-111111111111/artifacts/workspace',
      ),
      findsOneWidget,
    );
    expect(find.text('Download execution'), findsNothing);
    await tester.ensureVisible(find.text('Integrity & output').last);
    await tester.tap(find.text('Integrity & output').last);
    await tester.pumpAndSettle();
    expect(
      find.byKey(
        const Key('task-artifact-22222222-2222-4222-8222-222222222222-patch'),
      ),
      findsOneWidget,
    );
    expect(
      find.textContaining(
        'https://pipecat-edge.tailf6d713.ts.net/api/tasks/22222222-2222-4222-8222-222222222222/artifacts/patch',
      ),
      findsOneWidget,
    );
    expect(find.text('Download status'), findsNothing);
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
  final List<TaskProgressEvent> progressValues = [];
  final List<int> progressAfter = [];
  final List<(int, int)> narratedRanges = [];
  String? narrationOverride;
  bool narrationFails = false;

  @override
  Future<TranscriptSnapshot> transcript() async =>
      const TranscriptSnapshot(revision: 0, entries: []);

  @override
  Future<List<AgentTask>> tasks() async => List.of(taskValues);

  @override
  Future<List<TaskProgressEvent>> taskProgress(
    String id, {
    int after = 0,
  }) async {
    progressAfter.add(after);
    return progressValues.isNotEmpty
        ? progressValues.where((event) => event.id > after).take(40).toList()
        : after == 0
        ? [
            const TaskProgressEvent(
              id: 1,
              spoken: 'The agent is reading source files.',
            ),
          ]
        : [];
  }

  @override
  Future<String> narrateTaskProgress(
    String id, {
    required int after,
    required int through,
  }) async {
    narratedRanges.add((after, through));
    if (narrationFails) throw const ApiException('Narrator unavailable');
    if (narrationOverride case final override?) return override;
    if (progressValues.isEmpty) return 'The agent is reading source files.';
    return summarizeTaskProgress(
      progressValues
          .where((event) => event.id > after && event.id <= through)
          .toList(),
    );
  }

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
      presentation: {
        'kind': 'flow',
        'title': 'Task complete',
        'nodes': [
          {'id': 'a', 'label': 'A'},
          {'id': 'b', 'label': 'B'},
        ],
        'edges': [
          {'from': 'a', 'to': 'b'},
        ],
      },
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
  sessionName: 'Kind of Blue',
  sessionArtist: 'Miles Davis',
  sessionSpotifyUrl: 'https://open.spotify.com/album/1weenld61qoidwYuZ1GESA',
);
