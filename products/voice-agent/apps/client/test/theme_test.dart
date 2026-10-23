import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_agent_client/theme.dart';

void main() {
  test('light and dark themes use their matching design token palettes', () {
    final dark = buildTheme(brightness: Brightness.dark);
    final light = buildTheme(brightness: Brightness.light);

    expect(dark.brightness, Brightness.dark);
    expect(light.brightness, Brightness.light);
    expect(dark.scaffoldBackgroundColor, isNot(light.scaffoldBackgroundColor));
    expect(
      dark.extension<PiColors>()!.text,
      isNot(light.extension<PiColors>()!.text),
    );
  });

  testWidgets('theme control switches modes and updates its accessible label', (
    tester,
  ) async {
    var mode = ThemeMode.dark;

    await tester.pumpWidget(
      StatefulBuilder(
        builder: (context, setState) => MaterialApp(
          theme: buildTheme(brightness: Brightness.light),
          darkTheme: buildTheme(brightness: Brightness.dark),
          themeMode: mode,
          home: ThemeModeScope(
            mode: mode,
            onChange: (next) => setState(() => mode = next),
            child: const Scaffold(body: Center(child: ThemeToggleButton())),
          ),
        ),
      ),
    );

    expect(find.byTooltip('Switch to light theme'), findsOneWidget);
    await tester.tap(find.byKey(const Key('theme-toggle')));
    await tester.pumpAndSettle();

    expect(mode, ThemeMode.light);
    expect(find.byTooltip('Switch to dark theme'), findsOneWidget);
  });
}
