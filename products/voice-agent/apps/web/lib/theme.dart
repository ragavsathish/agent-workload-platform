import 'package:flutter/material.dart';

abstract final class PiColors {
  static const background = Color(0xFF07100E);
  static const surface = Color(0xFF0D1614);
  static const surfaceRaised = Color(0xFF131D1A);
  static const border = Color(0xFF2A3833);
  static const text = Color(0xFFEEF7F2);
  static const muted = Color(0xFF94A39C);
  static const green = Color(0xFF56E39F);
  static const blue = Color(0xFF72B7EF);
  static const purple = Color(0xFFC792EA);
  static const orange = Color(0xFFFFB86C);
  static const danger = Color(0xFFFF6B78);
}

ThemeData buildTheme() => ThemeData(
  brightness: Brightness.dark,
  scaffoldBackgroundColor: PiColors.background,
  colorScheme: const ColorScheme.dark(
    primary: PiColors.green,
    secondary: PiColors.blue,
    surface: PiColors.surface,
    error: PiColors.danger,
  ),
  fontFamily: 'Inter',
  textTheme: const TextTheme(
    displaySmall: TextStyle(fontSize: 38, fontWeight: FontWeight.w700, color: PiColors.text),
    headlineMedium: TextStyle(fontSize: 28, fontWeight: FontWeight.w700, color: PiColors.text),
    titleLarge: TextStyle(fontSize: 20, fontWeight: FontWeight.w600, color: PiColors.text),
    titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: PiColors.text),
    bodyLarge: TextStyle(fontSize: 16, height: 1.55, color: PiColors.text),
    bodyMedium: TextStyle(fontSize: 14, height: 1.5, color: PiColors.text),
    bodySmall: TextStyle(fontSize: 12, height: 1.4, color: PiColors.muted),
    labelLarge: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: PiColors.text),
  ),
  inputDecorationTheme: InputDecorationTheme(
    filled: true,
    fillColor: PiColors.surfaceRaised,
    hintStyle: const TextStyle(color: PiColors.muted),
    border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: PiColors.border)),
    enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: PiColors.border)),
    focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: PiColors.green)),
  ),
  elevatedButtonTheme: ElevatedButtonThemeData(
    style: ElevatedButton.styleFrom(
      backgroundColor: PiColors.green,
      foregroundColor: PiColors.background,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
  ),
  outlinedButtonTheme: OutlinedButtonThemeData(
    style: OutlinedButton.styleFrom(
      foregroundColor: PiColors.text,
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
      side: const BorderSide(color: PiColors.border),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
  ),
  dividerColor: PiColors.border,
);

class SurfaceCard extends StatelessWidget {
  const SurfaceCard({required this.child, this.padding = const EdgeInsets.all(20), super.key});
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => Container(
    padding: padding,
    decoration: BoxDecoration(
      color: PiColors.surface,
      border: Border.all(color: PiColors.border),
      borderRadius: BorderRadius.circular(18),
    ),
    child: child,
  );
}

class Eyebrow extends StatelessWidget {
  const Eyebrow(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) => Text(
    text.toUpperCase(),
    style: const TextStyle(
      color: PiColors.green,
      fontFamily: 'monospace',
      fontSize: 12,
      fontWeight: FontWeight.w700,
      letterSpacing: 2.2,
    ),
  );
}

String formatTokens(int value) => value >= 1000000
    ? '${(value / 1000000).toStringAsFixed(2)}M'
    : value >= 1000
    ? '${(value / 1000).round()}k'
    : '$value';
