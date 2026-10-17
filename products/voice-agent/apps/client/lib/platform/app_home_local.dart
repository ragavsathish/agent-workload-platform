import 'package:flutter/widgets.dart';

import '../api_client.dart';
import '../views/transcript_view.dart';
import '../views/voice_view.dart';

Widget buildAppHome({required VoiceApi api, required String? view}) {
  return switch (view) {
    'transcript' => TranscriptView(api: api),
    _ => VoiceView(api: api),
  };
}
