import 'package:flutter/material.dart';

import '../theme.dart';

class MermaidView extends StatelessWidget {
  const MermaidView({required this.diagram, this.height = 360, super.key});

  final String diagram;
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
      'Native diagram rendering is being installed.',
      style: TextStyle(color: PiColors.muted),
    ),
  );
}
