import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:patrol/patrol.dart';
import 'package:voice_agent_client/api_client.dart';
import 'package:voice_agent_client/theme.dart';
import 'package:voice_agent_client/views/voice_view.dart';

void main() {
  patrolTest('reproduces the voice shell at phone and desktop sizes', (
    $,
  ) async {
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
    expect(find.text('PINCH · DRAG'), findsOneWidget);
    expect(find.text('Private coding workspace'), findsNothing);
    expect(find.text('Start conversation'), findsOneWidget);
    expect(find.byIcon(Icons.mic_rounded), findsOneWidget);
    expect(find.byIcon(Icons.graphic_eq_rounded), findsOneWidget);
    expect(find.byIcon(Icons.chat_bubble_outline_rounded), findsOneWidget);
    expect(
      find.byKey(const Key('conversation-map-placeholder')),
      findsOneWidget,
    );
    expect(
      find.bySemanticsLabel(
        'Conversation map. Voice flows to Pi, waiting for response.',
      ),
      findsOneWidget,
    );
    await $.platform.web.resizeWindow(size: const Size(1440, 1000));
    await $.pump(const Duration(milliseconds: 80));

    expect(find.text('Chat'), findsOneWidget);
    expect(find.text('Replays'), findsOneWidget);
    expect(find.text('Private coding workspace'), findsOneWidget);
    expect(find.text('PINCH · DRAG'), findsNothing);
    expect(find.byKey(const Key('context-size')), findsOneWidget);

    // Dispose the view's periodic context refresh before Patrol closes the page.
    await $.pumpWidget(const SizedBox.shrink());
  });
}
