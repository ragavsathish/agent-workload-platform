import 'package:flutter/material.dart';
import 'package:patrol/patrol.dart';
import 'package:voice_agent_client/main.dart' as app;
import 'package:web/web.dart' as web;

void main() {
  patrolTest('sends a typed turn through the live Compose voice edge', ($) async {
    await $.platform.web.resizeWindow(size: const Size(1440, 1000));
    web.window.history.replaceState(null, '', '/?view=transcript');
    await $.pumpWidgetAndSettle(const app.VoiceAgentApp());

    await $(const Key('message-pi')).waitUntilExists();
    await $(const Key('message-pi')).enterText('Patrol live edge health journey');
    await $(const Key('send-message')).tap(settlePolicy: SettlePolicy.noSettle);
    await $('Deterministic Patrol mock response.').waitUntilVisible();
    await $(const Key('send-message')).waitUntilExists();
  });
}
