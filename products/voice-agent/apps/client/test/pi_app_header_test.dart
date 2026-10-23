import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_agent_client/design_tokens.dart';
import 'package:voice_agent_client/widgets/pi_app_header.dart';

void main() {
  testWidgets('uses the shared desktop header height', (tester) async {
    tester.view.physicalSize = const Size(900, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: PiAppHeader(child: SizedBox.expand(key: Key('header-content'))),
        ),
      ),
    );

    expect(
      tester.getSize(find.byType(PiAppHeader)),
      const Size(900, PiDesignTokens.headerHeight),
    );
  });

  testWidgets('uses the shared mobile header height', (tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: PiAppHeader(child: SizedBox.expand(key: Key('header-content'))),
        ),
      ),
    );

    expect(
      tester.getSize(find.byType(PiAppHeader)),
      const Size(390, PiDesignTokens.headerMobileHeight),
    );
  });
}
