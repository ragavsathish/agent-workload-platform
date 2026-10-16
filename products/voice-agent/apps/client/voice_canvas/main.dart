import 'dart:convert';
import 'dart:js_interop';

import 'package:web/web.dart' as web;

@JS('voiceCanvas.installRenderer')
external void _installRenderer(JSFunction callback);

web.HTMLElement _element(String tag, {String? className, String? text}) {
  final element = web.document.createElement(tag) as web.HTMLElement;
  if (className != null) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

Map<String, dynamic> _map(Object? value) =>
    value is Map<String, dynamic> ? value : const {};

void _render(JSString raw) {
  final root = web.document.querySelector('#app') as web.HTMLElement?;
  if (root == null) return;

  Object? decoded;
  try {
    decoded = jsonDecode(raw.toDart);
  } on FormatException {
    decoded = null;
  }
  final presentation = _map(decoded);
  final title = presentation['title'] is String
      ? presentation['title'] as String
      : 'Pi response';
  final nodes = (presentation['nodes'] as List? ?? const [])
      .map(_map)
      .where((node) => node['label'] is String)
      .toList(growable: false);
  final edges = (presentation['edges'] as List? ?? const [])
      .map(_map)
      .toList(growable: false);

  final labelsById = <String, String>{
    for (final node in nodes)
      if (node['id'] is String) node['id'] as String: node['label'] as String,
  };
  root.textContent = '';
  root.append(_element('h1', text: title));

  final stage = _element('div', className: 'voice-flow');
  for (var index = 0; index < nodes.length; index += 1) {
    final node = nodes[index];
    final card = _element('div', className: 'voice-node');
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', node['label'] as String);
    card.append(_element('span', text: node['label'] as String));
    stage.append(card);
    if (index < nodes.length - 1) {
      final currentId = node['id'];
      final nextId = nodes[index + 1]['id'];
      final edge = edges
          .cast<Map<String, dynamic>>()
          .where(
            (candidate) =>
                candidate['from'] == currentId && candidate['to'] == nextId,
          )
          .firstOrNull;
      final connector = _element('div', className: 'voice-edge');
      connector.append(_element('span', className: 'voice-arrow', text: '↓'));
      final edgeLabel = edge?['label'];
      if (edgeLabel is String && edgeLabel.isNotEmpty) {
        connector.append(
          _element('span', className: 'voice-edge-label', text: edgeLabel),
        );
      }
      stage.append(connector);
    }
  }
  root.append(stage);

  final extraEdges = edges
      .where((edge) {
        final from = edge['from'];
        final to = edge['to'];
        for (var index = 0; index < nodes.length - 1; index += 1) {
          if (nodes[index]['id'] == from && nodes[index + 1]['id'] == to) {
            return false;
          }
        }
        return true;
      })
      .toList(growable: false);
  if (extraEdges.isNotEmpty) {
    final connections = _element('div', className: 'voice-connections');
    connections.append(_element('h2', text: 'Connections'));
    for (final edge in extraEdges) {
      final source = labelsById['${edge['from']}'] ?? '${edge['from']}';
      final target = labelsById['${edge['to']}'] ?? '${edge['to']}';
      final label =
          edge['label'] is String && (edge['label'] as String).isNotEmpty
          ? ' · ${edge['label']}'
          : '';
      connections.append(_element('p', text: '$source → $target$label'));
    }
    root.append(connections);
  }
}

void main() {
  _installRenderer(_render.toJS);
}
