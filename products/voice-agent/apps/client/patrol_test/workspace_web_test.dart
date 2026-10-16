import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:patrol/patrol.dart';
import 'package:voice_agent_client/main.dart' as app;
import 'package:web/web.dart' as web;

void main() {
  patrolTest('uses typed conversation and durable work through HTTP', (
    $,
  ) async {
    await $.platform.web.resizeWindow(size: const Size(1440, 1000));
    web.window.history.replaceState(null, '', '/?view=transcript');
    app.main();
    await $.pumpAndSettle();

    expect($(const Key('conversation-section')), findsOneWidget);
    await $(const Key('tool-activity-fixture-tool')).waitUntilExists();
    expect($('read_workspace'), findsOneWidget);
    expect($('Completed'), findsOneWidget);
    await $(const Key('message-fixture-assistant')).waitUntilExists();
    expect($('Ready from the HTTP fixture.'), findsOneWidget);
    await $('1k / 8k').waitUntilVisible();

    await $(const Key('session-fixture-history')).tap();
    await $(const Key('read-only-history')).waitUntilVisible();
    expect($('How did the release go?'), findsOneWidget);
    expect($('The release completed successfully.'), findsOneWidget);
    expect($(const Key('message-pi')), findsNothing);
    expect($(const Key('compact-session')), findsNothing);

    await $(const Key('resume-session')).tap();
    await $('Connected to Pi session').waitUntilVisible();
    expect($(const Key('read-only-history')), findsNothing);
    expect($('The release completed successfully.'), findsOneWidget);
    expect($(const Key('message-pi')), findsOneWidget);

    await $(const Key('compact-session')).tap();
    await $('600 / 8k').waitUntilVisible();

    await $(const Key('message-pi')).enterText('Inspect the fixture');
    await $(const Key('send-message')).tap(settlePolicy: SettlePolicy.noSettle);
    await $('Inspecting the fixture…').waitUntilVisible();
    await $(const Key('stop-response')).waitUntilExists();
    await $('Fixture response to: Inspect the fixture').waitUntilVisible();
    await $(const Key('send-message'))
        .waitUntilExists(timeout: const Duration(seconds: 1));

    await $(const Key('message-pi')).tap();
    await $(const Key('message-pi')).enterText('Interrupt the fixture');
    await $(const Key('send-message')).tap(settlePolicy: SettlePolicy.noSettle);
    await $('Inspecting the fixture…').waitUntilVisible();
    await $(const Key('stop-response')).tap();
    await $('Response stopped.').waitUntilVisible();
    await $(const Key('send-message')).waitUntilExists();

    await $(const Key('tasks-section')).tap();
    await $(const Key('task-fixture-task')).waitUntilVisible();
    expect($('Review the fixture deployment'), findsWidgets);

    await $(const Key('approve-fixture-task')).tap();
    await $('APPROVED').waitUntilVisible();

    await $(const Key('new-task-board')).tap();
    await $(const Key('new-task-instruction'))
        .enterText('Publish the fixture report');
    await $(const Key('submit-new-task')).tap();
    await $(const Key('task-fixture-task-2')).waitUntilVisible();
    expect($('Publish the fixture report'), findsWidgets);

    await $(const Key('cancel-fixture-task-2')).tap();
    await $('CANCELLED').waitUntilVisible();

    await $.platform.web.resizeWindow(size: const Size(390, 844));
    await $(const Key('workspace-section-toggle')).tap();
    await $(const Key('session-history')).tap();
    await $(const Key('session-fixture-live')).waitUntilVisible();
    await $(const Key('session-fixture-live')).tap();
    await $(const Key('read-only-history')).waitUntilVisible();
    expect($('Ready from the HTTP fixture.'), findsOneWidget);
    await $(const Key('return-live-session')).tap();
    expect($(const Key('message-pi')), findsOneWidget);

    await $.platform.web.resizeWindow(size: const Size(1440, 1000));
    await $(const Key('new-voice-session')).tap();
    await $(const Key('confirm-new-voice-session')).tap();
    await $('Continue with Pi').waitUntilVisible();
    expect($(const Key('empty-conversation')), findsOneWidget);
    expect($('Context unavailable'), findsOneWidget);
    expect($(const Key('session-fixture-live')), findsOneWidget);
    expect($(const Key('message-pi')), findsOneWidget);

    await $(const Key('message-pi')).enterText('Start the fresh session');
    await $(const Key('send-message')).tap(settlePolicy: SettlePolicy.noSettle);
    await $('Fixture response to: Start the fresh session').waitUntilVisible();
  });
}
