import 'package:flutter/material.dart';

import 'api_client.dart';
import 'platform/app_home.dart';
import 'platform/client_actions.dart';
import 'theme.dart';
import 'ux_telemetry.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  UxTelemetry.instance.start();
  WidgetsBinding.instance.addPostFrameCallback((_) {
    UxTelemetry.instance.firstFrame();
  });
  runApp(const VoiceAgentApp());
}

class VoiceAgentApp extends StatefulWidget {
  const VoiceAgentApp({super.key});

  @override
  State<VoiceAgentApp> createState() => _VoiceAgentAppState();
}

class _VoiceAgentAppState extends State<VoiceAgentApp> {
  late final VoiceApi _api = VoiceApi();
  late ThemeMode _themeMode = _parseThemeMode(
    ClientActions.getThemePreference(),
  );

  ThemeMode _parseThemeMode(String value) => switch (value) {
    'light' => ThemeMode.light,
    'dark' => ThemeMode.dark,
    _ => ThemeMode.system,
  };

  void _setThemeMode(ThemeMode mode) {
    setState(() => _themeMode = mode);
    ClientActions.setThemePreference(switch (mode) {
      ThemeMode.light => 'light',
      ThemeMode.dark => 'dark',
      ThemeMode.system => 'system',
    });
  }

  @override
  void dispose() {
    _api.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final view = Uri.base.queryParameters['view'];
    final home = buildAppHome(api: _api, view: view);
    return MaterialApp(
      title: 'Pi Voice',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(brightness: Brightness.light),
      darkTheme: buildTheme(brightness: Brightness.dark),
      themeMode: _themeMode,
      home: ThemeModeScope(
        mode: _themeMode,
        onChange: _setThemeMode,
        child: home,
      ),
    );
  }
}
