import 'package:flutter/material.dart';

import 'design_tokens.dart';

@immutable
class PiColors extends ThemeExtension<PiColors> {
  const PiColors({
    required this.background,
    required this.surface,
    required this.surfaceRaised,
    required this.border,
    required this.borderStrong,
    required this.text,
    required this.muted,
    required this.green,
    required this.greenStrong,
    required this.onGreen,
    required this.blue,
    required this.orange,
    required this.danger,
    required this.focus,
  });

  final Color background;
  final Color surface;
  final Color surfaceRaised;
  final Color border;
  final Color borderStrong;
  final Color text;
  final Color muted;
  final Color green;
  final Color greenStrong;
  final Color onGreen;
  final Color blue;
  final Color orange;
  final Color danger;
  final Color focus;

  static PiColors of(BuildContext context) {
    final theme = Theme.of(context);
    return theme.extension<PiColors>() ??
        PiColors.forBrightness(theme.brightness);
  }

  static PiColors forBrightness(Brightness brightness) {
    final dark = brightness == Brightness.dark;
    return PiColors(
      background: dark ? PiDesignTokens.canvas : PiDesignTokens.lightCanvas,
      surface: dark ? PiDesignTokens.surface : PiDesignTokens.lightSurface,
      surfaceRaised: dark
          ? PiDesignTokens.surfaceRaised
          : PiDesignTokens.lightSurfaceRaised,
      border: dark ? PiDesignTokens.border : PiDesignTokens.lightBorder,
      borderStrong: dark
          ? PiDesignTokens.borderStrong
          : PiDesignTokens.lightBorderStrong,
      text: dark ? PiDesignTokens.text : PiDesignTokens.lightText,
      muted: dark ? PiDesignTokens.textMuted : PiDesignTokens.lightTextMuted,
      green: dark ? PiDesignTokens.accent : PiDesignTokens.lightAccent,
      greenStrong: dark
          ? PiDesignTokens.accentStrong
          : PiDesignTokens.lightAccentStrong,
      onGreen: dark
          ? PiDesignTokens.accentText
          : PiDesignTokens.lightAccentText,
      blue: dark ? PiDesignTokens.info : PiDesignTokens.lightInfo,
      orange: dark ? PiDesignTokens.warning : PiDesignTokens.lightWarning,
      danger: dark ? PiDesignTokens.danger : PiDesignTokens.lightDanger,
      focus: dark ? PiDesignTokens.focus : PiDesignTokens.lightFocus,
    );
  }

  @override
  PiColors copyWith({
    Color? background,
    Color? surface,
    Color? surfaceRaised,
    Color? border,
    Color? borderStrong,
    Color? text,
    Color? muted,
    Color? green,
    Color? greenStrong,
    Color? onGreen,
    Color? blue,
    Color? orange,
    Color? danger,
    Color? focus,
  }) => PiColors(
    background: background ?? this.background,
    surface: surface ?? this.surface,
    surfaceRaised: surfaceRaised ?? this.surfaceRaised,
    border: border ?? this.border,
    borderStrong: borderStrong ?? this.borderStrong,
    text: text ?? this.text,
    muted: muted ?? this.muted,
    green: green ?? this.green,
    greenStrong: greenStrong ?? this.greenStrong,
    onGreen: onGreen ?? this.onGreen,
    blue: blue ?? this.blue,
    orange: orange ?? this.orange,
    danger: danger ?? this.danger,
    focus: focus ?? this.focus,
  );

  @override
  PiColors lerp(ThemeExtension<PiColors>? other, double t) {
    if (other is! PiColors) return this;
    return PiColors(
      background: Color.lerp(background, other.background, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      surfaceRaised: Color.lerp(surfaceRaised, other.surfaceRaised, t)!,
      border: Color.lerp(border, other.border, t)!,
      borderStrong: Color.lerp(borderStrong, other.borderStrong, t)!,
      text: Color.lerp(text, other.text, t)!,
      muted: Color.lerp(muted, other.muted, t)!,
      green: Color.lerp(green, other.green, t)!,
      greenStrong: Color.lerp(greenStrong, other.greenStrong, t)!,
      onGreen: Color.lerp(onGreen, other.onGreen, t)!,
      blue: Color.lerp(blue, other.blue, t)!,
      orange: Color.lerp(orange, other.orange, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      focus: Color.lerp(focus, other.focus, t)!,
    );
  }
}

ThemeData buildTheme({Brightness brightness = Brightness.dark}) {
  final colors = PiColors.forBrightness(brightness);
  final scheme =
      (brightness == Brightness.dark
              ? const ColorScheme.dark()
              : const ColorScheme.light())
          .copyWith(
            primary: colors.greenStrong,
            onPrimary: colors.onGreen,
            secondary: colors.blue,
            surface: colors.surface,
            error: colors.danger,
            onSurface: colors.text,
            onSurfaceVariant: colors.muted,
            outline: colors.border,
          );
  final shape = RoundedRectangleBorder(
    borderRadius: BorderRadius.circular(PiDesignTokens.radiusMd),
  );

  return ThemeData(
    brightness: brightness,
    colorScheme: scheme,
    extensions: [colors],
    scaffoldBackgroundColor: colors.background,
    fontFamily: PiDesignTokens.fontFamily,
    textTheme: TextTheme(
      displaySmall: TextStyle(
        fontSize: 32,
        fontWeight: FontWeight.w600,
        color: colors.text,
      ),
      headlineMedium: TextStyle(
        fontSize: 22,
        fontWeight: FontWeight.w600,
        color: colors.text,
      ),
      titleLarge: TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w600,
        color: colors.text,
      ),
      titleMedium: TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        color: colors.text,
      ),
      bodyLarge: TextStyle(fontSize: 14, height: 1.55, color: colors.text),
      bodyMedium: TextStyle(fontSize: 13, height: 1.5, color: colors.text),
      bodySmall: TextStyle(fontSize: 11, height: 1.4, color: colors.muted),
      labelLarge: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w600,
        color: colors.text,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: colors.surfaceRaised,
      hintStyle: TextStyle(color: colors.muted),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(PiDesignTokens.radiusMd),
        borderSide: BorderSide(color: colors.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: colors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: BorderSide(color: colors.focus),
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: colors.green,
        foregroundColor: colors.onGreen,
        minimumSize: const Size(0, PiDesignTokens.touchTarget),
        visualDensity: VisualDensity.standard,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
        textStyle: const TextStyle(
          fontFamily: PiDesignTokens.fontFamily,
          fontSize: 12,
          fontWeight: FontWeight.w700,
        ),
        shape: shape,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: colors.text,
        minimumSize: const Size(0, 44),
        visualDensity: VisualDensity.standard,
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
        side: BorderSide(color: colors.border),
        textStyle: const TextStyle(
          fontFamily: PiDesignTokens.fontFamily,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
        shape: shape,
      ),
    ),
    dividerColor: colors.border,
  );
}

class ThemeModeScope extends InheritedWidget {
  const ThemeModeScope({
    required this.mode,
    required this.onChange,
    required super.child,
    super.key,
  });

  final ThemeMode mode;
  final ValueChanged<ThemeMode> onChange;

  static ThemeModeScope of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<ThemeModeScope>()!;

  static ThemeModeScope? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<ThemeModeScope>();

  @override
  bool updateShouldNotify(ThemeModeScope oldWidget) => mode != oldWidget.mode;
}

class ThemeToggleButton extends StatelessWidget {
  const ThemeToggleButton({super.key});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final scope = ThemeModeScope.maybeOf(context);
    return IconButton(
      key: const Key('theme-toggle'),
      tooltip: isDark ? 'Switch to light theme' : 'Switch to dark theme',
      onPressed: scope == null
          ? null
          : () => scope.onChange(isDark ? ThemeMode.light : ThemeMode.dark),
      icon: Icon(isDark ? Icons.light_mode_outlined : Icons.dark_mode_outlined),
    );
  }
}

class SurfaceCard extends StatelessWidget {
  const SurfaceCard({
    required this.child,
    this.padding = const EdgeInsets.all(20),
    super.key,
  });
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final colors = PiColors.of(context);
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border.all(color: colors.border),
        borderRadius: BorderRadius.circular(PiDesignTokens.radiusLg),
        boxShadow: [
          BoxShadow(
            color: colors.text.withValues(alpha: .08),
            blurRadius: 24,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: child,
    );
  }
}

class Eyebrow extends StatelessWidget {
  const Eyebrow(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) => Text(
    text.toUpperCase(),
    style: TextStyle(
      color: PiColors.of(context).greenStrong,
      fontFamily: PiDesignTokens.fontFamily,
      fontSize: 11,
      fontWeight: FontWeight.w700,
      letterSpacing: 1.8,
    ),
  );
}

String formatTokens(int value) => value >= 1000000
    ? '${(value / 1000000).toStringAsFixed(2)}M'
    : value >= 1000
    ? '${(value / 1000).round()}k'
    : '$value';
