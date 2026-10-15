import 'dart:async';
import 'dart:ui_web' as ui_web;

import 'package:flutter/material.dart';
import 'package:web/web.dart' as web;

import '../browser_bridge.dart';
import '../theme.dart';

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
        ..setAttribute('aria-label', 'Mermaid response diagram');
      element.style
        ..width = '100%'
        ..height = '100%'
        ..display = 'flex'
        ..alignItems = 'center'
        ..justifyContent = 'center'
        ..overflow = 'auto';
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
    try {
      final result = await BrowserBridge.renderMermaid(_elementId, widget.diagram);
      if (mounted) setState(() => _error = result.contains('"ok":true') ? null : 'Diagram unavailable');
    } on Object {
      if (mounted) setState(() => _error = 'Diagram unavailable');
    }
  }

  @override
  Widget build(BuildContext context) => SizedBox(
    height: widget.height,
    child: Stack(
      children: [
        Positioned.fill(child: HtmlElementView(viewType: _viewType)),
        if (_error != null)
          Align(
            alignment: Alignment.bottomCenter,
            child: Container(
              margin: const EdgeInsets.all(8),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(color: PiColors.surfaceRaised, borderRadius: BorderRadius.circular(8)),
              child: Text(_error!, style: const TextStyle(color: PiColors.danger)),
            ),
          ),
      ],
    ),
  );
}
