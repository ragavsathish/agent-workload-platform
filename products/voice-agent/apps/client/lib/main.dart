import 'package:flutter/material.dart';

import 'api_client.dart';
import 'platform/app_home.dart';
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
      theme: buildTheme(),
      home: home,
    );
  }
}
