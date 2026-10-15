import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:patrol/patrol.dart';
import 'package:voice_agent_web/api_client.dart';
import 'package:voice_agent_web/theme.dart';
import 'package:voice_agent_web/views/voice_view.dart';

void main() {
  patrolTest('reproduces the voice shell at phone and desktop sizes', ($) async {
    await $.platform.web.resizeWindow(size: const Size(390, 844));
    await $.pumpWidget(
      MaterialApp(
        theme: buildTheme(),
        home: VoiceView(api: VoiceApi()),
      ),
    );
    await $.pump(const Duration(milliseconds: 80));

    expect(find.text('Pi Voice'), findsOneWidget);
    expect(find.text('Conversation map'), findsOneWidget);
    expect(find.text('Start conversation'), findsOneWidget);
    expect(find.byKey(const Key('live-mermaid')), findsOneWidget);

    await $.platform.web.resizeWindow(size: const Size(1440, 1000));
    await $.pump(const Duration(milliseconds: 80));

    expect(find.text('Chat'), findsOneWidget);
    expect(find.text('Replays'), findsOneWidget);
    expect(find.byKey(const Key('context-size')), findsOneWidget);
  });
}
