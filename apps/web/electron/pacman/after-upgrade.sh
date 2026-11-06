#!/bin/bash
# post_upgrade of the Arch package (fpm --after-upgrade, see the pacman block
# in electron-builder.yml). An upgrade puts chrome-sandbox back to its packaged
# 0755, and electron-builder's after-install script, the only place that makes
# it setuid when the kernel has no user namespaces (linux-hardened), runs on
# first install only. Same check as that script; the glob also covers a local
# build's "/opt/Timely Dev".
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    for sandbox in /opt/Timely*/chrome-sandbox; do
        [ -e "$sandbox" ] && chmod 4755 "$sandbox"
    done
fi
