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
    this.resourceUri = 'ui://mermaid/main',
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
  late String _presentationJson;
  String? _error;

  @override
  void initState() {
    super.initState();
    _presentationJson = jsonEncode(widget.presentation);
    ui_web.platformViewRegistry.registerViewFactory(_viewType, (_) {
      final element = web.HTMLDivElement()
        ..id = _elementId
        ..tabIndex = 0
        ..title = 'Interactive Pi visual'
        ..setAttribute('aria-label', 'Interactive Pi visual');
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
    final nextPresentationJson = jsonEncode(widget.presentation);
    if (_presentationJson != nextPresentationJson ||
        oldWidget.resourceUri != widget.resourceUri) {
      _presentationJson = nextPresentationJson;
      unawaited(_mount());
    }
  }

  Future<void> _mount() async {
    if (widget.presentation.isEmpty) return;
    final started = Stopwatch()..start();
    try {
      final result = await BrowserBridge.mountMcpApp(
        _elementId,
        _presentationJson,
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
        label: 'Interactive Pi visual',
        child: HtmlElementView(viewType: _viewType),
      ),
    );
  }
}
