import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme.dart';

class ChartSeries {
  const ChartSeries({required this.label, required this.color, required this.values});
  final String label;
  final Color color;
  final List<double?> values;
}

class MetricChart extends StatelessWidget {
  const MetricChart({required this.title, required this.series, this.bars = false, super.key});
  final String title;
  final List<ChartSeries> series;
  final bool bars;

  @override
  Widget build(BuildContext context) => SurfaceCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 12),
        Wrap(
          spacing: 14,
          children: series.map((item) => Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(width: 9, height: 9, decoration: BoxDecoration(color: item.color, shape: BoxShape.circle)),
              const SizedBox(width: 6),
              Text(item.label, style: Theme.of(context).textTheme.bodySmall),
            ],
          )).toList(),
        ),
        const SizedBox(height: 8),
        SizedBox(height: 190, child: CustomPaint(painter: _ChartPainter(series, bars: bars), size: Size.infinite)),
      ],
    ),
  );
}

class _ChartPainter extends CustomPainter {
  _ChartPainter(this.series, {required this.bars});
  final List<ChartSeries> series;
  final bool bars;

  @override
  void paint(Canvas canvas, Size size) {
    final plot = Rect.fromLTWH(8, 8, math.max(1, size.width - 16), math.max(1, size.height - 16));
    final grid = Paint()..color = PiColors.border.withValues(alpha: .7)..strokeWidth = 1;
    for (var index = 0; index <= 4; index++) {
      final y = plot.top + plot.height * index / 4;
      canvas.drawLine(Offset(plot.left, y), Offset(plot.right, y), grid);
    }
    final values = series.expand((item) => item.values).whereType<double>().where((v) => v.isFinite).toList();
    if (values.isEmpty) return;
    var minimum = values.reduce(math.min);
    var maximum = values.reduce(math.max);
    if (minimum == maximum) { minimum -= 1; maximum += 1; }
    for (final item in series) {
      final paint = Paint()..color = item.color..strokeWidth = 2..style = bars ? PaintingStyle.fill : PaintingStyle.stroke;
      if (bars) {
        final width = plot.width / math.max(1, item.values.length);
        for (var index = 0; index < item.values.length; index++) {
          final value = item.values[index];
          if (value == null) continue;
          final fraction = (value - minimum) / (maximum - minimum);
          canvas.drawRect(Rect.fromLTRB(
            plot.left + index * width + 1,
            plot.bottom - plot.height * fraction,
            plot.left + (index + 1) * width - 1,
            plot.bottom,
          ), paint);
        }
        continue;
      }
      final path = Path();
      var drawing = false;
      final count = math.max(1, item.values.length - 1);
      for (var index = 0; index < item.values.length; index++) {
        final value = item.values[index];
        if (value == null || !value.isFinite) { drawing = false; continue; }
        final point = Offset(
          plot.left + plot.width * index / count,
          plot.bottom - plot.height * (value - minimum) / (maximum - minimum),
        );
        if (drawing) { path.lineTo(point.dx, point.dy); } else { path.moveTo(point.dx, point.dy); drawing = true; }
      }
      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _ChartPainter oldDelegate) => oldDelegate.series != series || oldDelegate.bars != bars;
}
