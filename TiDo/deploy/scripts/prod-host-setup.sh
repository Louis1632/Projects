#!/usr/bin/env bash
# One-time host preparation for TiDo production. Run after Tailscale is installed and logged in.
# Run as root:  sudo bash deploy/scripts/prod-host-setup.sh /dev/sdXN [username]
#
# 1. Lets the given user (default: the sudo caller) fetch this machine's Tailscale
#    certificate, so certificate renewal needs no root.
# 2. Mounts the backup drive partition at /srv/tido-backups on every boot (by UUID, and
#    boot continues if the drive is unplugged).
# 3. Creates production/ on the drive for the nightly backup job, with a marker file the
#    job checks so it never writes to the internal disk by mistake.
# It never formats anything: the partition must already hold an ext4, xfs or btrfs file
# system. Every step is idempotent, so re-running is safe.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

DEVICE="${1:?usage: sudo bash $0 /dev/sdXN [username]}"
TARGET_USER="${2:-${SUDO_USER:-}}"
[[ -n "$TARGET_USER" ]] || { echo "Pass the username that runs releases." >&2; exit 1; }
MOUNT=/srv/tido-backups
# uid of the postgres user in the CloudNativePG image, which runs the backup job.
BACKUP_UID=26

step() { printf '\n==> %s\n' "$*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

command -v tailscale >/dev/null || fail "install Tailscale first (curl -fsSL https://tailscale.com/install.sh | sh)"
tailscale status >/dev/null 2>&1 || fail "log Tailscale in first (sudo tailscale up)"

step "Allowing ${TARGET_USER} to fetch this machine's Tailscale certificate"
DEFAULTS=/etc/default/tailscaled
if grep -q '^TS_PERMIT_CERT_UID=' "$DEFAULTS" 2>/dev/null; then
  sed -i "s/^TS_PERMIT_CERT_UID=.*/TS_PERMIT_CERT_UID=${TARGET_USER}/" "$DEFAULTS"
else
  printf 'TS_PERMIT_CERT_UID=%s\n' "$TARGET_USER" >> "$DEFAULTS"
fi
systemctl restart tailscaled
for _ in $(seq 1 30); do tailscale status >/dev/null 2>&1 && break; sleep 1; done

step "Mounting ${DEVICE} at ${MOUNT}"
[[ -b "$DEVICE" ]] || fail "${DEVICE} is not a block device"
[[ "$(lsblk -no TYPE "$DEVICE")" == part ]] || fail "${DEVICE} is not a partition (use e.g. /dev/sdb1, not /dev/sdb)"
ROOT_DISK="$(lsblk -no PKNAME "$(findmnt -no SOURCE /)")"
[[ "$(lsblk -no PKNAME "$DEVICE")" != "$ROOT_DISK" ]] || fail "${DEVICE} is on the system disk; backups must go to a separate drive"
FSTYPE="$(lsblk -no FSTYPE "$DEVICE")"
case "$FSTYPE" in
  ext4 | xfs | btrfs) ;;
  *) fail "${DEVICE} has file system '${FSTYPE:-none}'; it needs ext4, xfs or btrfs (Unix file permissions)" ;;
esac
UUID="$(lsblk -no UUID "$DEVICE")"

# Unmount any desktop automount of the same partition first.
for target in $(findmnt -rno TARGET -S "UUID=${UUID}" || true); do
  [[ "$target" == "$MOUNT" ]] || umount "$target"
done
mkdir -p "$MOUNT"
LINE="UUID=${UUID} ${MOUNT} ${FSTYPE} defaults,nofail,x-systemd.device-timeout=10s 0 2"
if ! grep -qE "^UUID=${UUID}[[:space:]]" /etc/fstab; then
  cp /etc/fstab "/etc/fstab.bak.$(date +%Y%m%d%H%M%S)"
  printf '# TiDo production backup drive (deploy/scripts/prod-host-setup.sh)\n%s\n' "$LINE" >> /etc/fstab
  systemctl daemon-reload
fi
mountpoint -q "$MOUNT" || mount "$MOUNT"

step "Preparing ${MOUNT}/production"
TARGET_GID="$(id -g "$TARGET_USER")"
mkdir -p "${MOUNT}/production"
# Owned by the backup job; group-readable (setgid) so ${TARGET_USER} can run restore drills.
chown "${BACKUP_UID}:${TARGET_GID}" "${MOUNT}/production"
chmod 2750 "${MOUNT}/production"
install -m 0644 -o "$BACKUP_UID" -g "$TARGET_GID" /dev/null "${MOUNT}/production/.tido-backup-drive"

step "Done"
df -h "$MOUNT"
