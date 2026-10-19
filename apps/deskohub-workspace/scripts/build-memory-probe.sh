#!/usr/bin/env bash
# TEMPORARY verification probe for Elastic build machines (PR #759).
# Logs build-cache sizes and memory every 3 s around the build command.
# Remove before merging.
set -uo pipefail

cache_sizes() {
  echo "[probe] $1 .next/cache total: $(du -sm .next/cache 2>/dev/null | cut -f1) MB"
  du -sm .next/cache/* .next/cache/*/* 2>/dev/null | sort -rn | head -12 | sed "s/^/[probe] $1   /"
}

memory_used() {
  if [[ -r /sys/fs/cgroup/memory.current ]]; then
    echo "cgroup=$(( $(cat /sys/fs/cgroup/memory.current) / 1048576 ))M"
  elif [[ -r /sys/fs/cgroup/memory/memory.usage_in_bytes ]]; then
    echo "cgroup=$(( $(cat /sys/fs/cgroup/memory/memory.usage_in_bytes) / 1048576 ))M"
  fi
  awk '/^MemTotal/{t=$2} /^MemAvailable/{a=$2} END{printf "used=%dM avail=%dM\n", (t-a)/1024, a/1024}' /proc/meminfo
}

# RSS of every process descended from this script, so other machine load is excluded.
process_rss() {
  local pids
  # The process name in /proc/<pid>/stat may contain spaces, so read the
  # parent PID after its closing parenthesis.
  pids=$(awk -v root=$$ '{ line = $0; sub(/^.*\) /, "", line); split(line, field, " ");
    split(FILENAME, path, "/"); parent[path[3]] = field[2] } END {
    for (pid in parent) { p = pid; while (p in parent && p != root) p = parent[p]; if (p == root) print pid }
  }' /proc/[0-9]*/stat 2>/dev/null)
  for pid in $pids; do
    status=/proc/$pid/status
    awk '/^Name:/{n=$2} /^VmRSS:/{r=int($2/1024)} END{if (r > 0) print r "M:" n}' "$status" 2>/dev/null
  done | sort -rn
}

echo "[probe] nproc=$(nproc) $(memory_used | tr '\n' ' ') memory.max=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || cat /sys/fs/cgroup/memory/memory.limit_in_bytes 2>/dev/null || echo n/a)"
cache_sizes restored
if [[ -f scripts/build-probe-cold ]]; then
  rm -rf .next/cache/turbopack
  echo "[probe] removed the restored Turbopack cache for a cold build"
fi

start=$SECONDS
(
  peak=0
  while :; do
    processes="$(process_rss)"
    rss=$(awk -F'M:' '{s+=$1} END{print s+0}' <<<"$processes")
    (( rss > peak )) && peak=$rss
    echo "[probe] t=$(( SECONDS - start ))s rss=${rss}M peak_rss=${peak}M $(memory_used | tr '\n' ' ')top: $(head -5 <<<"$processes" | tr '\n' ' ')"
    sleep 3
  done
) &
sampler=$!

"$@"
status=$?

kill "$sampler" 2>/dev/null
wait "$sampler" 2>/dev/null
echo "[probe] build exited $status after $(( SECONDS - start ))s; cgroup memory.peak=$(( $(cat /sys/fs/cgroup/memory.peak 2>/dev/null || echo 0) / 1048576 ))M"
cache_sizes final
exit "$status"
