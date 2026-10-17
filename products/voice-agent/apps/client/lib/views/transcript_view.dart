import 'package:flutter/material.dart';

import '../api_client.dart';
import 'pi_workspace_view.dart';

/// Compatibility entry point for existing transcript links and callers.
///
/// The workspace implementation is intentionally independent of VoiceView so
/// this redesign cannot take ownership of microphone or speaker state.
class TranscriptView extends StatelessWidget {
  const TranscriptView({required this.api, this.playSpeech, super.key});

  final VoiceApi api;
  final Future<void> Function(String spoken)? playSpeech;

  @override
  Widget build(BuildContext context) =>
      PiWorkspaceView(api: api, playSpeech: playSpeech);
}
