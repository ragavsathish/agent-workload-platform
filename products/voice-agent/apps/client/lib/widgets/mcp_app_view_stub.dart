import 'package:flutter/material.dart';

import '../models.dart';
import '../theme.dart';

class McpAppView extends StatelessWidget {
  const McpAppView({
    required this.presentation,
    this.resourceUri = 'ui://voice-canvas/main',
    this.height = 360,
    super.key,
  });

  final JsonMap presentation;
  final String resourceUri;
  final double height;

  @override
  Widget build(BuildContext context) => Container(
    height: height,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      color: PiColors.surfaceRaised,
      border: Border.all(color: PiColors.border),
      borderRadius: BorderRadius.circular(10),
    ),
    child: const Text(
      'Voice Canvas is available in the embedded web workspace.',
      style: TextStyle(color: PiColors.muted),
    ),
  );
}
