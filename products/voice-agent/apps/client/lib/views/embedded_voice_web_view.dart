import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import '../platform/embedded_navigation_policy.dart';

class EmbeddedVoiceWebView extends StatefulWidget {
  const EmbeddedVoiceWebView({super.key});

  @override
  State<EmbeddedVoiceWebView> createState() => _EmbeddedVoiceWebViewState();
}

class _EmbeddedVoiceWebViewState extends State<EmbeddedVoiceWebView> {
  static final Uri _workspaceUri = Uri.parse(defaultVoiceWorkspaceUrl);

  late final WebViewController _controller;
  var _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _controller = _createController();
    unawaited(_controller.loadRequest(_workspaceUri));
  }

  WebViewController _createController() {
    final PlatformWebViewControllerCreationParams params;
    if (WebViewPlatform.instance is WebKitWebViewPlatform) {
      params = WebKitWebViewControllerCreationParams(
        allowsInlineMediaPlayback: true,
        mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
      );
    } else {
      params = const PlatformWebViewControllerCreationParams();
    }

    final controller =
        WebViewController.fromPlatformCreationParams(
            params,
            onPermissionRequest: (request) {
              unawaited(_handlePagePermissionRequest(request));
            },
          )
          ..setJavaScriptMode(JavaScriptMode.unrestricted)
          ..setBackgroundColor(const Color(0xff05090b))
          ..setNavigationDelegate(
            NavigationDelegate(
              onPageStarted: (_) {
                if (mounted) {
                  setState(() {
                    _loading = true;
                    _error = null;
                  });
                }
              },
              onPageFinished: (_) {
                if (mounted) {
                  setState(() => _loading = false);
                }
              },
              onWebResourceError: (error) {
                if (error.isForMainFrame == true && mounted) {
                  setState(() {
                    _loading = false;
                    _error = error.description;
                  });
                }
              },
              onNavigationRequest: (request) {
                final candidate = Uri.tryParse(request.url);
                if (candidate == null ||
                    !isAllowedVoiceWorkspaceNavigation(
                      candidate,
                      _workspaceUri,
                    )) {
                  return NavigationDecision.prevent;
                }
                return NavigationDecision.navigate;
              },
            ),
          );

    if (controller.platform is AndroidWebViewController) {
      if (kDebugMode) {
        AndroidWebViewController.enableDebugging(true);
      }
      unawaited(
        (controller.platform as AndroidWebViewController)
            .setMediaPlaybackRequiresUserGesture(false),
      );
    }
    return controller;
  }

  Future<void> _handlePagePermissionRequest(
    WebViewPermissionRequest request,
  ) async {
    final microphoneOnly =
        request.types.isNotEmpty &&
        request.types.every(
          (type) => type == WebViewPermissionResourceType.microphone,
        );
    if (!microphoneOnly) {
      await request.deny();
      return;
    }

    final status = await Permission.microphone.request();
    if (status.isGranted) {
      await request.grant();
      return;
    }

    await request.deny();
    if (mounted) {
      setState(() {
        _loading = false;
        _error = status.isPermanentlyDenied
            ? 'Microphone access is disabled in system settings.'
            : 'Microphone access is required for voice conversations.';
      });
    }
  }

  Future<void> _retry() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final status = await Permission.microphone.request();
    if (status.isGranted) {
      await _controller.loadRequest(_workspaceUri);
      return;
    }
    if (mounted) {
      setState(() {
        _loading = false;
        _error = status.isPermanentlyDenied
            ? 'Microphone access is disabled in system settings.'
            : 'Microphone access is required for voice conversations.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xff05090b),
      body: SafeArea(
        child: Stack(
          fit: StackFit.expand,
          children: [
            WebViewWidget(controller: _controller),
            if (_loading)
              const ColoredBox(
                color: Color(0xff05090b),
                child: Center(child: CircularProgressIndicator()),
              ),
            if (_error case final message?)
              _EmbeddedWebError(message: message, onRetry: _retry),
          ],
        ),
      ),
    );
  }
}

class _EmbeddedWebError extends StatelessWidget {
  const _EmbeddedWebError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: const Color(0xff05090b),
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.mic_off_outlined, size: 36),
              const SizedBox(height: 16),
              Text(message, textAlign: TextAlign.center),
              const SizedBox(height: 20),
              FilledButton(onPressed: onRetry, child: const Text('Try again')),
            ],
          ),
        ),
      ),
    );
  }
}
