import 'package:flutter/material.dart';

import '../models.dart';
import '../theme.dart';

class McpAppView extends StatelessWidget {
  const McpAppView({
    required this.presentation,
    this.resourceUri = 'ui://mermaid/main',
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
      color: PiColors.of(context).surfaceRaised,
      border: Border.all(color: PiColors.of(context).border),
      borderRadius: BorderRadius.circular(10),
    ),
    child: Text(
      'Interactive visuals are available in the web workspace.',
      style: TextStyle(color: PiColors.of(context).muted),
    ),
  );
}
