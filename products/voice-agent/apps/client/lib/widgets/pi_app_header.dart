import 'package:flutter/material.dart';

import '../design_tokens.dart';
import '../theme.dart';

/// Shared Flutter implementation of the Pi app header shell.
///
/// Keep screen-specific identity, navigation, and action controls in the
/// supplied slots. The geometry matches `.pi-app-header` in elements.css.
class PiAppHeader extends StatelessWidget {
  const PiAppHeader({super.key, this.identity, this.actions, this.child})
    : assert((child != null) != (identity != null && actions != null));

  final Widget? identity;
  final Widget? actions;
  final Widget? child;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final compact = constraints.maxWidth < 600;
      final colors = PiColors.of(context);
      return Container(
        height: compact
            ? PiDesignTokens.headerMobileHeight
            : PiDesignTokens.headerHeight,
        padding: EdgeInsets.symmetric(
          horizontal: compact
              ? PiDesignTokens.headerMobilePaddingInline
              : PiDesignTokens.headerPaddingInline,
        ),
        decoration: BoxDecoration(
          border: Border(bottom: BorderSide(color: colors.border)),
        ),
        child:
            child ??
            Row(
              children: [
                Expanded(child: identity!),
                SizedBox(width: PiDesignTokens.headerGap),
                actions!,
              ],
            ),
      );
    },
  );
}

class PiHeaderIcon extends StatelessWidget {
  const PiHeaderIcon(this.icon, {super.key});

  final IconData icon;

  @override
  Widget build(BuildContext context) =>
      Icon(icon, size: PiDesignTokens.iconSize);
}
