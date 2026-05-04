#!/usr/bin/env bash
set -e

# Usage: ./release.sh <version>  e.g. ./release.sh 1.0.2
#        ./release.sh --current  print the current version and exit
VERSION=$1

if [ "$VERSION" = "--current" ]; then
  node -e "const m=require('./manifest.json'); console.log(m.version);"
  exit 0
fi

if [ -z "$VERSION" ]; then
  echo "Usage: ./release.sh <version>     e.g. ./release.sh 1.0.2"
  echo "       ./release.sh --current     print current version"
  exit 1
fi

# Bump manifest.json, package.json, and versions.json
node -e "
  const fs = require('fs');

  // manifest.json
  const m = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  const minApp = m.minAppVersion;
  m.version = '$VERSION';
  fs.writeFileSync('manifest.json', JSON.stringify(m, null, '\t') + '\n');

  // package.json
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  p.version = '$VERSION';
  fs.writeFileSync('package.json', JSON.stringify(p, null, '  ') + '\n');

  // versions.json
  const v = JSON.parse(fs.readFileSync('versions.json', 'utf8'));
  v['$VERSION'] = minApp;
  fs.writeFileSync('versions.json', JSON.stringify(v, null, '  ') + '\n');
"

echo "Bumped manifest.json, package.json, and versions.json to $VERSION"

# Commit, tag, push
git add manifest.json package.json versions.json
git commit -m "chore: release $VERSION"
git tag "$VERSION"
git push && git push --tags

echo "Released $VERSION — GitHub Actions will build and publish the release assets."
