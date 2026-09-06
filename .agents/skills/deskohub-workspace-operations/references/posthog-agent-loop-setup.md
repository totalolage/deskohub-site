# PostHog incident agent setup

The MVP is one systemd user timer. Each run recovers one persistent T3 dispatcher thread, asks it to complete one pass, and waits for the pass to finish. T3 workers continue independently.

## Install from the repository root

```bash
install -Dm755 \
  .agents/skills/deskohub-workspace-operations/scripts/t3-managed \
  /home/dev/.local/bin/t3
install -Dm755 \
  .agents/skills/deskohub-workspace-operations/scripts/posthog-agent-loop \
  /home/dev/.local/libexec/deskohub-posthog-agent-loop
install -Dm755 \
  .agents/skills/deskohub-workspace-operations/scripts/posthog-configure-dispatcher \
  /home/dev/.local/libexec/deskohub-posthog-configure-dispatcher
install -Dm755 \
  .agents/skills/deskohub-workspace-operations/scripts/posthog-worker-model \
  /home/dev/.local/libexec/deskohub-posthog-worker-model
install -Dm755 \
  .agents/skills/deskohub-workspace-operations/scripts/posthog-create-worker \
  /home/dev/.local/libexec/deskohub-posthog-create-worker
install -Dm644 \
  .agents/skills/deskohub-workspace-operations/references/posthog-agent-dispatcher.md \
  /home/dev/.local/share/deskohub-posthog-agent-loop/posthog-agent-dispatcher.md
install -Dm644 \
  .agents/skills/deskohub-workspace-operations/references/posthog-agent-worker.md \
  /home/dev/.local/share/deskohub-posthog-agent-loop/posthog-agent-worker.md
install -Dm644 \
  .agents/skills/deskohub-workspace-operations/references/posthog-mvp-error-query.md \
  /home/dev/.local/share/deskohub-posthog-agent-loop/posthog-mvp-error-query.md
install -Dm644 \
  .agents/skills/deskohub-workspace-operations/assets/deskohub-posthog-agent-loop.service \
  /home/dev/.config/systemd/user/deskohub-posthog-agent-loop.service
install -Dm644 \
  .agents/skills/deskohub-workspace-operations/assets/deskohub-posthog-agent-loop.timer \
  /home/dev/.config/systemd/user/deskohub-posthog-agent-loop.timer
systemctl --user daemon-reload
systemctl --user enable --now deskohub-posthog-agent-loop.timer
```

The wrapper at `/home/dev/.local/bin/t3` executes the same binary as the running `t3code.service`, so the orchestration CLI and server stay on the same version.

## Check or run now

```bash
systemctl --user status deskohub-posthog-agent-loop.timer
systemctl --user start --no-block deskohub-posthog-agent-loop.service
systemctl --user status deskohub-posthog-agent-loop.service
journalctl --user -u deskohub-posthog-agent-loop.service --since today
```

The runner discards the dispatcher's final text so PostHog evidence does not enter the system journal. T3 retains the thread transcript.

## Stop unattended runs

```bash
systemctl --user disable --now deskohub-posthog-agent-loop.timer
```

This leaves the installed files and existing T3 threads intact.
