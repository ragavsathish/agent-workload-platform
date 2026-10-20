"""Shared Gondolin configuration and guest probes for Compose benchmarks."""

from __future__ import annotations

from pathlib import Path

DEFAULT_BOOTSTRAP = ["/usr/local/bin/start-dev-docker"]


def project_file(workspace: str | Path, compose_file: str) -> Path:
    root = Path(workspace).resolve()
    if not root.is_dir():
        raise ValueError(f"workspace is not a directory: {root}")
    path = (root / compose_file).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError(f"compose_file is not a file inside workspace: {compose_file}")
    return path


def options(image: str, *, workspace: str | Path, compose_file: str | None,
            workload_command: list[str] | None, bootstrap_command: list[str],
            compose_wait: bool, guest_environment: dict[str, str],
            label: str, vmm: str, memory_gib: int, cpus: int,
            image_cache: str | None = None, guest_swap_gib: int = 0):
    root = Path(workspace).resolve()
    if not root.is_dir():
        raise ValueError(f"workspace is not a directory: {root}")
    if bool(compose_file) == bool(workload_command):
        raise ValueError("provide exactly one of compose_file or workload_command")
    if workload_command is not None and not workload_command:
        raise ValueError("workload_command cannot be empty")
    for name, command in (("bootstrap_command", bootstrap_command),
                          ("workload_command", workload_command)):
        if command is not None and (not isinstance(command, list) or
                                    any(not isinstance(value, str) or not value for value in command)):
            raise ValueError(f"{name} must be a list of nonempty strings")
    if not isinstance(guest_environment, dict) or any(
        not isinstance(key, str) or not isinstance(value, str)
        for key, value in guest_environment.items()
    ):
        raise ValueError("guest_environment must map strings to strings")
    if compose_file:
        file = project_file(root, compose_file)
        guest_file = "/workspace/" + str(file.relative_to(root))
        workload_command = ["docker", "compose", "-f", guest_file,
                            "--project-directory", "/workspace", "up", "-d"]
        if compose_wait:
            workload_command.append("--wait")
    startup = []
    if guest_swap_gib:
        startup.extend([
            ["/bin/dd", "if=/dev/zero", "of=/swapfile", "bs=1M",
             f"count={guest_swap_gib * 1024}", "status=none"],
            ["/bin/chmod", "600", "/swapfile"],
            ["/usr/sbin/mkswap", "/swapfile"],
            ["/usr/sbin/swapon", "/swapfile"],
        ])
    if bootstrap_command:
        startup.append(bootstrap_command)
    startup.append(workload_command)
    mounts = {"/workspace": str(root)}
    if image_cache:
        cache = Path(image_cache).resolve()
        if not cache.is_dir():
            raise ValueError(f"image_cache is not a directory: {cache}")
        mounts["/image-cache"] = {"hostPath": str(cache), "readonly": True}
    return {
        "imagePath": image,
        "mounts": mounts,
        "network": {"allowedHosts": ["*"]},
        "environment": guest_environment,
        "sandbox": {"vmm": vmm},
        "memory": f"{memory_gib}G",
        "cpus": cpus,
        "rootfs": {"mode": "cow", "size": "64G"},
        "maxHttpResponseBodyBytes": 512 * 1024 * 1024,
        "startupCommands": startup,
        "sessionLabel": label,
    }


def guest_output(client, command):
    result = client.run(command)
    if result.get("exitCode") != 0:
        raise RuntimeError("guest command failed: {}: {}".format(command, result.get("stderr")))
    return result.get("stdout", "").strip()


def guest_disk_metrics(client, *, include_swap=False):
    driver = guest_output(client, ["docker", "info", "--format", "{{.Driver}}"])
    rootfs = guest_output(client, ["df", "-B1", "--output=size,used,avail", "/"])
    docker_size = guest_output(client, ["du", "-sb", "/var/lib/docker"]).split()[0]
    images = guest_output(client, ["docker", "image", "ls", "-q"])
    metrics = {
        "driver": driver,
        "rootfs": " ".join(rootfs.splitlines()[-1].split()),
        "docker_apparent_bytes": docker_size,
        "image_count": str(len(set(images.splitlines()))),
    }
    for label, path in (("docker_vfs_apparent_bytes", "/var/lib/docker/vfs/dir"),
                        ("docker_overlay2_apparent_bytes", "/var/lib/docker/overlay2")):
        try:
            metrics[label] = guest_output(client, ["du", "-sb", path]).split()[0]
        except RuntimeError:
            metrics[label] = "n/a"
    if include_swap:
        contents = guest_output(client, ["cat", "/proc/meminfo"])
        values = {parts[0].rstrip(":"): int(parts[1]) for line in contents.splitlines()
                  if (parts := line.split()) and parts[0] in ("SwapTotal:", "SwapFree:")}
        metrics["guest_swap_kib"] = str(values["SwapTotal"])
        metrics["guest_swap_used_kib"] = str(values["SwapTotal"] - values["SwapFree"])
    return metrics
