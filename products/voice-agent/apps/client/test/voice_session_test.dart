import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:voice_agent_client/api_client.dart';
import 'package:voice_agent_client/platform/voice_session.dart';
import 'package:voice_agent_client/theme.dart';
import 'package:voice_agent_client/views/voice_view.dart';

void main() {
  testWidgets('tablet conversation map grows with available height', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(768, 820);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final session = FakeVoiceSession();
    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(),
        home: VoiceView(api: VoiceApi(), session: session),
      ),
    );
    final compactHeight = tester
        .getSize(find.byKey(const Key('conversation-map-placeholder')))
        .height;

    tester.view.physicalSize = const Size(768, 1180);
    await tester.pump();
    final tallHeight = tester
        .getSize(find.byKey(const Key('conversation-map-placeholder')))
        .height;

    expect(tallHeight, greaterThan(compactHeight + 200));

    await tester.pumpWidget(const SizedBox.shrink());
    await session.close();
  });

  testWidgets('shared controls drive the injected platform voice session', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final session = FakeVoiceSession();
    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(),
        home: VoiceView(api: VoiceApi(), session: session),
      ),
    );
    expect(find.byKey(const Key('open-system-health')), findsOneWidget);

    await tester.tap(find.byKey(const Key('start-conversation')));
    await tester.pump();
    expect(session.connectCount, 1);
    expect(find.byKey(const Key('mute-conversation')), findsOneWidget);

    await tester.tap(find.byKey(const Key('mute-conversation')));
    await tester.pump();
    expect(session.muted, isTrue);
    expect(find.text('Unmute'), findsOneWidget);

    session.emit(const VoiceEvent(VoiceEventType.speaking, active: true));
    await tester.pump();
    expect(find.byKey(const Key('voice-state')), findsOneWidget);
    expect(find.text('Unmute'), findsOneWidget);

    await tester.tap(find.byKey(const Key('end-conversation')));
    await tester.pump();
    expect(session.disconnectCount, 1);
    expect(find.byKey(const Key('start-conversation')), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    await session.close();
  });

  testWidgets(
    'journal review mounts without replacing the voice conversation controls',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final session = FakeVoiceSession();
      await tester.pumpWidget(
        MaterialApp(
          theme: buildTheme(),
          home: VoiceView(api: VoiceApi(), session: session),
        ),
      );

      await tester.tap(find.byKey(const Key('start-conversation')));
      await tester.pump();
      session.emit(
        const VoiceEvent(
          VoiceEventType.mcpApp,
          resourceUri: 'ui://journal-review/main.html',
          presentation: {
            'kind': 'journal-review',
            'reviewId': 'review-1',
            'transcript': 'Use reviewed labels before training.',
          },
        ),
      );
      await tester.pump();

      expect(find.byKey(const Key('live-mcp-app')), findsOneWidget);
      expect(find.byKey(const Key('mute-conversation')), findsOneWidget);
      expect(find.byKey(const Key('end-conversation')), findsOneWidget);
      final voiceState = tester.widget<Semantics>(
        find.byKey(const Key('voice-state')),
      );
      expect(voiceState.properties.label, 'Listening');

      await tester.pumpWidget(const SizedBox.shrink());
      await session.close();
    },
  );

  testWidgets('restores the latest MCP App after the Flutter view reconnects', (
    tester,
  ) async {
    final session = FakeVoiceSession();
    final api = VoiceApi(
      client: MockClient((request) async {
        if (request.url.path == '/api/pi-context') {
          return http.Response(jsonEncode({
            'tokens': 1,
            'contextWindow': 100,
            'percent': 1,
            'estimated': false,
            'canCompact': false,
          }), 200);
        }
        if (request.url.path == '/api/pi-transcript') {
          return http.Response(jsonEncode({
            'revision': 2,
            'entries': [
              {
                'id': '2',
                'timestamp': 2,
                'role': 'assistant',
                'status': 'completed',
                'text': jsonEncode({
                  'spoken': 'Trace restored.',
                  'presentation': {
                    'kind': 'playwright-trace-viewer',
                    'title': 'Gitea commits',
                    'traceId': '0123456789abcdef0123456789abcdef',
                  },
                }),
              },
            ],
          }), 200);
        }
        return http.Response('{}', 404);
      }),
    );
    await tester.pumpWidget(
      MaterialApp(theme: buildTheme(), home: VoiceView(api: api, session: session)),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('live-mcp-app')), findsOneWidget);
    expect(find.byKey(const Key('open-system-health')), findsOneWidget);

    await tester.pumpWidget(const SizedBox.shrink());
    await session.close();
  });
}

class FakeVoiceSession implements VoiceSession {
  final _events = StreamController<VoiceEvent>.broadcast();
  int connectCount = 0;
  int disconnectCount = 0;
  bool muted = false;

  @override
  Stream<VoiceEvent> get events => _events.stream;

  @override
  Future<void> connect() async {
    connectCount += 1;
    emit(const VoiceEvent(VoiceEventType.connected));
  }

  @override
  Future<void> disconnect() async {
    disconnectCount += 1;
    emit(const VoiceEvent(VoiceEventType.disconnected));
  }

  @override
  void setMuted(bool value) {
    muted = value;
    emit(VoiceEvent(VoiceEventType.muted, active: value));
  }

  void emit(VoiceEvent event) => _events.add(event);

  Future<void> close() => _events.close();

  @override
  void dispose() {}
}
