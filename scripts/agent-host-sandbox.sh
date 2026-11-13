#!/usr/bin/env bash
# Phase 5 test safety (decision 20): a throwaway "real" home, working folder and Chrome profile for
# host-tool checks, so no test or live check ever touches the owner's own home, browser profile,
# ~/.ssh, ~/.gitconfig or ~/.hermes.
#
#   scripts/agent-host-sandbox.sh create   # make $HOME/.cache/p5-sandbox/{home,work,chrome-profile}, print paths
#   scripts/agent-host-sandbox.sh clean    # remove $HOME/.cache/p5-sandbox entirely
#
# Point a worktree API at it with TIMELY_AGENT_REAL_HOME=<home> (honoured only with DB_SCHEMA set,
# and only inside $HOME/.cache/p5-sandbox) and choose <work> as the working folder.
set -euo pipefail

base="${HOME:?HOME is not set}/.cache/p5-sandbox"
home="$base/home"
work="$base/work"
profile="$home/.config/google-chrome"

case "${1:-create}" in
create)
  mkdir -p "$home/.config" "$work" "$profile/Default"
  chmod 700 "$base" "$home"
  # Empty dotfiles: a command that reads ~/.gitconfig or ~/.bashrc finds nothing of the owner's.
  : > "$home/.gitconfig"
  : > "$home/.bashrc"
  : > "$home/.profile"
  # A throwaway Chrome user-data-dir, named the default browser for the sandbox home, so Hermes'
  # real-profile browsing (browser.use_real_profile) snapshots this profile and nothing else.
  if [ ! -f "$profile/Local State" ]; then
    printf '{"profile": {"last_used": "Default"}}\n' > "$profile/Local State"
  fi
  cat > "$home/.config/mimeapps.list" <<'MIME'
[Default Applications]
x-scheme-handler/https=google-chrome.desktop
x-scheme-handler/http=google-chrome.desktop
text/html=google-chrome.desktop
MIME
  ln -sfn "$profile" "$base/chrome-profile"
  printf 'home=%s\nwork=%s\nchrome-profile=%s\n' "$home" "$work" "$profile"
  ;;
clean)
  case "$base" in
    "$HOME"/.cache/p5-sandbox) rm -rf -- "$base" ;;
    *) echo "agent-host-sandbox: refusing to remove $base" >&2; exit 1 ;;
  esac
  echo "removed $base"
  ;;
*)
  echo "usage: $0 create|clean" >&2
  exit 2
  ;;
esac
