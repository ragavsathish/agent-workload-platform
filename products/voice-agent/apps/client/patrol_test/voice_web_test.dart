import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:patrol/patrol.dart';
import 'package:voice_agent_client/main.dart' as app;

void main() {
  patrolTest('opens the real voice app and its task workspace', ($) async {
    await $.platform.web.resizeWindow(size: const Size(390, 844));

    // Exercise the production entry point. This test deliberately does not
    // construct screens directly or replace the HTTP client with a Dart fake.
    app.main();
    await $.pumpAndSettle();

    expect($(const Key('voice-state')), findsOneWidget);
    expect($(const Key('conversation-map-placeholder')), findsOneWidget);
    expect($(const Key('start-conversation')), findsOneWidget);
    expect($('Private coding workspace'), findsNothing);

    await $.platform.web.resizeWindow(size: const Size(1440, 1000));
    await $.pumpAndSettle();

    expect($('Private coding workspace'), findsOneWidget);
    expect($(const Key('context-size')), findsOneWidget);

    // Follow the same browser boundary as a user. The Chat control opens the
    // production transcript route in a separate page.
    final popup = $.platform.web.waitForPopup();
    await $(const Key('open-transcript')).tap();
    final transcriptPage = await popup;
    await $.platform.web.switchToPage(pageId: transcriptPage);
    final transcriptUrl = await $.platform.web.getCurrentPageUrl();
    expect(Uri.parse(transcriptUrl).queryParameters['view'], 'transcript');

    await $.platform.web.closePage(pageId: transcriptPage);
    await $.platform.web.switchToInitialPage();

    final systemPopup = $.platform.web.waitForPopup();
    await $(const Key('open-system-health')).tap();
    final systemPage = await systemPopup;
    await $.platform.web.switchToPage(pageId: systemPage);
    final systemUrl = await $.platform.web.getCurrentPageUrl();
    expect(
      Uri.parse(systemUrl).path,
      '/metrics/d/voice-c4-heatmap/c4-operational-heat-map',
    );

    await $.platform.web.closePage(pageId: systemPage);
    await $.platform.web.switchToInitialPage();
  });
}
