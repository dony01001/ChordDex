#!/usr/bin/env bash
set -euo pipefail

MODULE_ID="chorddex"
OLD_MODULE_ID="midi-chord-detector"
MOVE_HOST="${MOVE_HOST:-move.local}"
MOVE_USER="${MOVE_USER:-root}"
REMOTE_DIR="/data/UserData/schwung/modules/tools/${MODULE_ID}"

echo "Installing ${MODULE_ID} to ${MOVE_USER}@${MOVE_HOST}:${REMOTE_DIR}"

# Remove old midi_fx install if exists
ssh "${MOVE_USER}@${MOVE_HOST}" "rm -rf /data/UserData/schwung/modules/midi_fx/${MODULE_ID} /data/UserData/schwung/modules/midi_fx/${OLD_MODULE_ID}"

# Remove old tools install under previous id
ssh "${MOVE_USER}@${MOVE_HOST}" "rm -rf /data/UserData/schwung/modules/tools/${OLD_MODULE_ID}"

# Install to tools
ssh "${MOVE_USER}@${MOVE_HOST}" "mkdir -p ${REMOTE_DIR}"
scp module.json "${MOVE_USER}@${MOVE_HOST}:${REMOTE_DIR}/module.json"
scp ui.js       "${MOVE_USER}@${MOVE_HOST}:${REMOTE_DIR}/ui.js"
scp help.json   "${MOVE_USER}@${MOVE_HOST}:${REMOTE_DIR}/help.json"

# Ensure no stale dsp.so from previous experiments
ssh "${MOVE_USER}@${MOVE_HOST}" "rm -f ${REMOTE_DIR}/dsp.so"

ssh "${MOVE_USER}@${MOVE_HOST}" "chown -R ableton:users ${REMOTE_DIR}"

echo "Done. Restart the Move to load the module."
