#!/bin/bash
set -euo pipefail

# Release the Obsidian plugin -- builds, tags, and publishes a GitHub Release.
#
# Usage:
#   ./scripts/release.sh              # interactive -- shows current version, asks bump type
#   ./scripts/release.sh 0.5.0        # explicit version
#   ./scripts/release.sh --update     # rebuild and update assets on current release

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT"

CURRENT_VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*: *"\(.*\)".*/\1/')
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

echo "Current version: $CURRENT_VERSION"

# Determine target version
if [ "${1:-}" = "--update" ]; then
    # Just update assets on existing release
    VERSION="$CURRENT_VERSION"
elif [ -n "${1:-}" ]; then
    # Explicit version provided
    VERSION="$1"
else
    # Interactive bump
    NEXT_PATCH="$MAJOR.$MINOR.$((PATCH + 1))"
    NEXT_MINOR="$MAJOR.$((MINOR + 1)).0"
    NEXT_MAJOR="$((MAJOR + 1)).0.0"

    echo ""
    echo "  1) Patch  -> $NEXT_PATCH"
    echo "  2) Minor  -> $NEXT_MINOR"
    echo "  3) Major  -> $NEXT_MAJOR"
    echo "  4) Update -> $CURRENT_VERSION (rebuild assets only)"
    echo ""
    read -r -p "Choose [1-4]: " choice

    case "$choice" in
        1) VERSION="$NEXT_PATCH" ;;
        2) VERSION="$NEXT_MINOR" ;;
        3) VERSION="$NEXT_MAJOR" ;;
        4) VERSION="$CURRENT_VERSION" ;;
        *) echo "Invalid choice." >&2; exit 1 ;;
    esac
fi

TAG="v$VERSION"

# Bump version files if version changed
if [ "$VERSION" != "$CURRENT_VERSION" ]; then
    echo "==> Bumping $CURRENT_VERSION -> $VERSION"
    npm version "$VERSION" --no-git-tag-version
    npm_package_version="$VERSION" node version-bump.mjs 2>/dev/null || true
fi

echo "==> Releasing $TAG"

# Commit any pending changes
if ! git diff --quiet HEAD 2>/dev/null; then
    echo "Committing version bump..."
    git add manifest.json package.json versions.json
    git commit -m "Bump version to $VERSION"
fi

# Build
echo "==> Building..."
npm run build

# Check if tag/release already exists
if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo "==> Tag $TAG exists -- updating existing release..."
    # Update the release assets (overwrites existing ones)
    gh release upload "$TAG" \
        main.js \
        manifest.json \
        styles.css \
        --clobber
    echo ""
    echo "Updated $TAG"
    echo "   Assets: main.js, manifest.json, styles.css"
    echo ""
    echo "BRAT users can now update from Obsidian."
    exit 0
fi

# Tag and push
echo "==> Tagging $TAG..."
git tag "$TAG"
git push origin main --tags

# Create GitHub Release with the three required assets
echo "==> Creating GitHub Release..."
gh release create "$TAG" \
    main.js \
    manifest.json \
    styles.css \
    --title "$TAG" \
    --notes "Release $VERSION" \
    --latest

echo ""
echo "Released $TAG"
echo "   Assets: main.js, manifest.json, styles.css"
echo ""
echo "BRAT users can now update from Obsidian."
