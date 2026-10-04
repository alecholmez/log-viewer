#!/bin/zsh -l
# Starts Log Viewer in development mode (npm install, then npm run app).
# Everything printed here is also kept in run-app.log beside this file.
cd "$(dirname "$0")" || exit 1
exec > >(tee run-app.log) 2>&1
export PATH="$HOME/.cargo/bin:$HOME/.homebrew/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

echo "== tools =="
echo "macOS  $(sw_vers -productVersion) $(uname -m)"
echo "node   $(command -v node || echo MISSING) $(node -v 2>/dev/null)"
echo "npm    $(command -v npm || echo MISSING) $(npm -v 2>/dev/null)"
echo "cargo  $(command -v cargo || echo MISSING) $(cargo -V 2>/dev/null)"
echo "rustup $(command -v rustup || echo MISSING)"
echo "xcode  $(xcode-select -p 2>&1)"
echo "brew   $(command -v brew || echo MISSING)"

missing=0
for t in node npm cargo; do
  command -v $t >/dev/null || { echo "MISSING TOOL: $t"; missing=1; }
done
if [ $missing -ne 0 ]; then
  echo "== stopped: install the missing tools, then run this again =="
  exit 1
fi

echo "== npm install =="
npm install || { echo "== npm install failed =="; exit 1; }
echo "== npm run app =="
npm run app
echo "== npm run app exited with $? =="
