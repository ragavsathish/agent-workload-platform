import 'dart:async';
import 'dart:ui_web' as ui_web;

import 'package:flutter/material.dart';
import 'package:web/web.dart' as web;

import '../browser_bridge.dart';
import '../theme.dart';

class AudioWaveform extends StatefulWidget {
  const AudioWaveform({required this.url, required this.color, required this.showSpectrogram, super.key});
  final String url;
  final String color;
  final bool showSpectrogram;

  @override
  State<AudioWaveform> createState() => _AudioWaveformState();
}

class _AudioWaveformState extends State<AudioWaveform> {
  static int _sequence = 0;
  late final String _id = 'waveform-${_sequence++}';
  late final String _viewType = 'waveform-view-$_id';

  @override
  void initState() {
    super.initState();
    ui_web.platformViewRegistry.registerViewFactory(_viewType, (_) {
      final element = web.HTMLDivElement()
        ..id = _id
        ..setAttribute('aria-label', 'Audio waveform; click to play or pause');
      element.style
        ..width = '100%'
        ..height = widget.showSpectrogram ? '196px' : '80px'
        ..cursor = 'pointer';
      unawaited(Future<void>.delayed(Duration.zero, () => BrowserBridge.mountWaveform(
        elementId: _id,
        url: widget.url,
        color: widget.color,
        spectrogram: widget.showSpectrogram,
      )));
      return element;
    });
  }

  @override
  void dispose() {
    BrowserBridge.disposeWaveform(_id);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    SizedBox(height: widget.showSpectrogram ? 196 : 80, child: HtmlElementView(viewType: _viewType)),
    const SizedBox(height: 5),
    const Text('Click the waveform to play or pause', style: TextStyle(color: PiColors.muted, fontSize: 11)),
  ]);
}
