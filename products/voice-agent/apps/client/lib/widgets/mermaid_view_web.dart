import 'dart:async';
import 'dart:ui_web' as ui_web;

import 'package:flutter/material.dart';
import 'package:web/web.dart' as web;

import '../browser_bridge.dart';
import '../theme.dart';
import '../ux_telemetry.dart';

class MermaidView extends StatefulWidget {
  const MermaidView({required this.diagram, this.height = 360, super.key});
  final String diagram;
  final double height;

  @override
  State<MermaidView> createState() => _MermaidViewState();
}

class _MermaidViewState extends State<MermaidView> {
  static int _sequence = 0;
  late final String _elementId = 'flutter-mermaid-${_sequence++}';
  late final String _viewType = 'mermaid-view-$_elementId';
  String? _error;

  @override
  void initState() {
    super.initState();
    ui_web.platformViewRegistry.registerViewFactory(_viewType, (_) {
      final element = web.HTMLDivElement()
        ..id = _elementId
        ..tabIndex = 0
        ..title = 'Drag to pan. Pinch with two fingers to zoom.'
        ..setAttribute(
          'aria-label',
          'Interactive Mermaid response diagram. Drag to pan and pinch to zoom.',
        );
      element.style
        ..width = '100%'
        ..height = '100%'
        ..display = 'block'
        ..overflow = 'auto'
        ..overscrollBehavior = 'contain'
        ..touchAction = 'none';
      unawaited(Future<void>.delayed(Duration.zero, _render));
      return element;
    });
  }

  @override
  void didUpdateWidget(covariant MermaidView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.diagram != widget.diagram) unawaited(_render());
  }

  Future<void> _render() async {
    if (widget.diagram.trim().isEmpty) return;
    final started = Stopwatch()..start();
    try {
      final result = await BrowserBridge.renderMermaid(
        _elementId,
        widget.diagram,
      );
      if (mounted) {
        setState(
          () => _error = result.contains('"ok":true')
              ? null
              : 'Diagram unavailable',
        );
      }
      UxTelemetry.instance.record('mermaid.render', duration: started.elapsed);
    } on Object {
      UxTelemetry.instance.record(
        'mermaid.render',
        duration: started.elapsed,
        outcome: 'error',
      );
      if (mounted) setState(() => _error = 'Diagram unavailable');
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return Semantics(
        liveRegion: true,
        label: 'Diagram unavailable. Retry diagram.',
        child: Container(
          height: 72,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: PiColors.surfaceRaised,
            border: Border.all(color: PiColors.border),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.account_tree_outlined,
                size: 17,
                color: PiColors.muted,
              ),
              const SizedBox(width: 8),
              const Text(
                'Diagram unavailable',
                style: TextStyle(color: PiColors.muted),
              ),
              const SizedBox(width: 6),
              TextButton(onPressed: _render, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }
    return SizedBox(
      height: widget.height,
      child: Semantics(
        container: true,
        label: 'Interactive Mermaid response diagram. Drag to pan and pinch to zoom.',
        child: HtmlElementView(viewType: _viewType),
      ),
    );
  }
}
