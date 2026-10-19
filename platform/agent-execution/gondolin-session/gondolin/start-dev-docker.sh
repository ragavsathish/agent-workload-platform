#!/bin/sh
set -eu

mkdir -p /sys/fs/cgroup
if ! mountpoint -q /sys/fs/cgroup; then
  mount -t cgroup2 none /sys/fs/cgroup
fi

if docker info >/dev/null 2>&1; then
  exit 0
fi

dockerd --host=unix:///var/run/docker.sock --storage-driver=vfs \
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
