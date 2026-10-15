{{flutter_js}}
{{flutter_build_config}}

const forceJavaScript = new URLSearchParams(window.location.search).has('force_js');
const config = forceJavaScript
  ? {
      wasmAllowList: {
        blink: false,
        gecko: false,
        webkit: false,
        unknown: false,
      },
    }
  : {};

_flutter.loader.load({
  config,
  serviceWorkerSettings: {
    serviceWorkerVersion: {{flutter_service_worker_version}},
  },
});
