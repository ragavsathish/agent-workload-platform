import 'dart:async';
import 'dart:convert';
import 'dart:ui_web' as ui_web;

import 'package:flutter/material.dart';
import 'package:web/web.dart' as web;

import '../browser_bridge.dart';
import '../models.dart';
import '../theme.dart';
import '../ux_telemetry.dart';

class McpAppView extends StatefulWidget {
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
  State<McpAppView> createState() => _McpAppViewState();
}

class _McpAppViewState extends State<McpAppView> {
  static int _sequence = 0;
  late final String _elementId = 'flutter-mcp-app-${_sequence++}';
  late final String _viewType = 'mcp-app-view-$_elementId';
  String? _error;

  @override
  void initState() {
    super.initState();
    ui_web.platformViewRegistry.registerViewFactory(_viewType, (_) {
      final element = web.HTMLDivElement()
        ..id = _elementId
        ..tabIndex = 0
        ..title = 'Interactive Pi Voice Canvas'
        ..setAttribute('aria-label', 'Interactive Pi Voice Canvas');
      element.style
        ..width = '100%'
        ..height = '100%'
        ..display = 'block'
        ..overflow = 'hidden';
      unawaited(Future<void>.delayed(Duration.zero, _mount));
      return element;
    });
  }

  @override
  void didUpdateWidget(covariant McpAppView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.presentation != widget.presentation ||
        oldWidget.resourceUri != widget.resourceUri) {
      unawaited(_mount());
    }
  }

  Future<void> _mount() async {
    if (widget.presentation.isEmpty) return;
    final started = Stopwatch()..start();
    try {
      final result = await BrowserBridge.mountMcpApp(
        _elementId,
        jsonEncode(widget.presentation),
        widget.resourceUri,
      );
      if (mounted) {
        setState(
          () => _error = result.contains('"ok":true')
              ? null
              : 'Visual unavailable',
        );
      }
      UxTelemetry.instance.record('mcp_app.render', duration: started.elapsed);
    } on Object {
      UxTelemetry.instance.record(
        'mcp_app.render',
        duration: started.elapsed,
        outcome: 'error',
      );
      if (mounted) setState(() => _error = 'Visual unavailable');
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return Semantics(
        liveRegion: true,
        label: 'Visual unavailable. Retry visual.',
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
                Icons.widgets_outlined,
                size: 17,
                color: PiColors.muted,
              ),
              const SizedBox(width: 8),
              const Text(
                'Visual unavailable',
                style: TextStyle(color: PiColors.muted),
              ),
              const SizedBox(width: 6),
              TextButton(onPressed: _mount, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }
    return SizedBox(
      height: widget.height,
      child: Semantics(
        container: true,
        label: 'Interactive Pi Voice Canvas',
        child: HtmlElementView(viewType: _viewType),
      ),
    );
  }
}
