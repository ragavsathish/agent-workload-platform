import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:patrol/patrol.dart';
import 'package:voice_agent_client/main.dart' as app;
import 'package:web/web.dart' as web;

void main() {
  patrolTest('observes the responsive voice shell and navigation', ($) async {
    await $.platform.web.resizeWindow(size: const Size(390, 844));
    web.window.localStorage.setItem('pi-voice-theme', 'dark');
    await $.pumpWidgetAndSettle(const app.VoiceAgentApp());

    await _observePhoneShell($);
    await _observeDesktopWorkspace($);
    await _openTranscriptPage($);
    await _openSystemHealthPage($);
  });
}

Future<void> _observePhoneShell(PatrolIntegrationTester $) async {
  await $(const Key('voice-state')).waitUntilExists();
  await $(const Key('conversation-map-placeholder')).waitUntilExists();
  await $(const Key('start-conversation')).waitUntilExists();
  expect($('Private coding workspace'), findsNothing);
  await $(const Key('theme-toggle')).tap();
  await $(const Key('theme-toggle')).tap();
}

Future<void> _observeDesktopWorkspace(PatrolIntegrationTester $) async {
  await $.platform.web.resizeWindow(size: const Size(1440, 1000));
  await $('Private coding workspace').waitUntilVisible();
  await $(const Key('context-size')).waitUntilExists();
}

Future<void> _openTranscriptPage(PatrolIntegrationTester $) async {
  final popup = $.platform.web.waitForPopup();
  await $(const Key('open-transcript')).tap();
  final page = await popup;
  await $.platform.web.switchToPage(pageId: page);
  final url = Uri.parse(await $.platform.web.getCurrentPageUrl());
  expect(url.queryParameters['view'], 'transcript');
  await $.platform.web.closePage(pageId: page);
  await $.platform.web.switchToInitialPage();
}

Future<void> _openSystemHealthPage(PatrolIntegrationTester $) async {
  final popup = $.platform.web.waitForPopup();
  await $(const Key('open-system-health')).tap();
  final page = await popup;
  await $.platform.web.switchToPage(pageId: page);
  final url = Uri.parse(await $.platform.web.getCurrentPageUrl());
  expect(url.path, '/metrics/d/voice-c4-heatmap/c4-operational-heat-map');
  await $.platform.web.closePage(pageId: page);
  await $.platform.web.switchToInitialPage();
}
