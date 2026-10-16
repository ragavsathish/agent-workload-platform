import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
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
    expect(find.text('SPEAKING'), findsOneWidget);
    expect(find.text('Unmute'), findsOneWidget);

    await tester.tap(find.byKey(const Key('end-conversation')));
    await tester.pump();
    expect(session.disconnectCount, 1);
    expect(find.byKey(const Key('start-conversation')), findsOneWidget);

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
