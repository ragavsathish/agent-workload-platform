import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:voice_agent_client/api_client.dart';
import 'package:voice_agent_client/models.dart';
import 'package:voice_agent_client/views/transcript_view.dart';

void main() {
  testWidgets('successful chat is not reported as failed when autoplay is blocked', (
    tester,
  ) async {
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

    await tester.enterText(find.byKey(const Key('message-pi')), 'Is it completed?');
    await tester.tap(find.byKey(const Key('send-message')));
    await tester.pump();

    expect(api.sentMessages, ['Is it completed?']);
    expect(find.byKey(const Key('timeline-error')), findsNothing);
    expect(find.byKey(const Key('playback-notice')), findsOneWidget);
    expect(find.textContaining('Tap Listen again'), findsOneWidget);
  });
}

class _FakeVoiceApi extends VoiceApi {
  final List<String> sentMessages = [];

  @override
  Future<TranscriptSnapshot> transcript() async => const TranscriptSnapshot(
    revision: 0,
    entries: [],
  );

  @override
  Future<List<AgentTask>> tasks() async => const [];

  @override
  Future<VisualResponse> sendMessage(String message) async {
    sentMessages.add(message);
    return const VisualResponse(
      spoken: 'The task is complete.',
      mermaid: 'flowchart LR\nA --> B',
    );
  }
}
