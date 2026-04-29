#!/bin/bash

# Deploy plugin to Obsidian vault
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_SRC="$(dirname "$SCRIPT_DIR")"
PLUGIN_NAME="kindle-scribe-notes-sync"

if [ -n "$1" ]; then
    VAULT_DIR="$1"
else
    read -r -p "Obsidian vault folder: " VAULT_DIR
    if [ -z "$VAULT_DIR" ]; then
        echo "Error: No folder specified." >&2
        exit 1
    fi
fi

PLUGIN_DEST="$VAULT_DIR/.obsidian/plugins/$PLUGIN_NAME"

# Create plugin directory if it doesn't exist
mkdir -p "$PLUGIN_DEST"

# Copy plugin files
cp "$PLUGIN_SRC/main.js" "$PLUGIN_DEST/"
cp "$PLUGIN_SRC/manifest.json" "$PLUGIN_DEST/"
cp "$PLUGIN_SRC/styles.css" "$PLUGIN_DEST/"

echo "Plugin deployed to: $PLUGIN_DEST"
