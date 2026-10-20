#!/bin/sh
set -eu

# Compose uses host networking and local service URLs on 127.0.0.1. Normalize
# loopback so that local services work consistently across guest images.
ip link set dev lo up
ip address replace 127.0.0.1/8 dev lo

mkdir -p /sys/fs/cgroup
if ! mountpoint -q /sys/fs/cgroup; then
  mount -t cgroup2 none /sys/fs/cgroup
fi

if docker info >/dev/null 2>&1; then
  driver=$(docker info --format '{{.Driver}}')
  if [ "$driver" != overlay2 ]; then
    echo "Docker is already running with storage driver '$driver'; this dev VM requires overlay2." >&2
    exit 1
  fi
  exit 0
fi

if ! grep -qw overlay /proc/filesystems; then
  if ! modprobe overlay 2>/dev/null; then
    overlay_module=$(find "/lib/modules/$(uname -r)" -type f -name 'overlay.ko.gz' -print -quit)
    if [ -n "$overlay_module" ]; then
      gzip -dc "$overlay_module" >/tmp/gondolin-overlay.ko
      insmod /tmp/gondolin-overlay.ko 2>/dev/null || true
    fi
  fi
fi

if ! grep -qw overlay /proc/filesystems; then
  echo "OverlayFS is unavailable in the guest kernel; refusing to start Docker with a space-heavy storage driver." >&2
  exit 1
fi

dockerd --host=unix:///var/run/docker.sock --storage-driver=overlay2 \
  --iptables=false --bridge=none --ip-forward=false --ip-masq=false \
  >/var/log/dev-dockerd.log 2>&1 &

attempt=0
while [ "$attempt" -lt 120 ]; do
  if docker info >/dev/null 2>&1; then
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 0.5
done

tail -n 30 /var/log/dev-dockerd.log >&2
exit 1
