import 'package:flutter/material.dart';

import 'api_client.dart';
import 'theme.dart';
import 'views/audio_diagnostics_view.dart';
import 'views/transcript_view.dart';
import 'views/voice_view.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
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
    final home = switch (view) {
      'transcript' => TranscriptView(api: _api),
      'audio-diagnostics' => AudioDiagnosticsView(api: _api),
      _ => VoiceView(api: _api),
    };
    return MaterialApp(
      title: 'Pi Voice',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      home: home,
    );
  }
}
