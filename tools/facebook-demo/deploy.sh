#!/usr/bin/env bash
# Puts the demo on Maderas behind https://peter.amandrai.net/fb-demo/ (see README.md).
#
#   tools/facebook-demo/deploy.sh             copy the code, install, restart
#   tools/facebook-demo/deploy.sh sender NAME  add a sender and print their install link
#   tools/facebook-demo/deploy.sh view         print the viewing link
#   tools/facebook-demo/deploy.sh retire       stop it and take it off the web (keeps the data)
set -euo pipefail

HOST=maderas
BASE=https://peter.amandrai.net/fb-demo
APP='$HOME/fb-demo'          # the code: src/ and tools/facebook-demo/, replaced on each deploy
DATA='$HOME/fb-demo-data'    # config.json, demo.sqlite, raw/: never replaced
WEB=/var/www/peter.amandrai.net/htdocs/fb-demo
NODE='$HOME/.nvm/versions/node/v24.18.0/bin/node'
PORT=3142

cd "$(git rev-parse --show-toplevel)"
remote() { ssh -o BatchMode=yes "$HOST" "$@"; }

# config.json edits run in Node on Maderas, so no secret passes through this shell.
token='require("node:crypto").randomBytes(18).toString("base64url")'

case "${1:-deploy}" in
deploy)
  remote "mkdir -p $APP/tools $DATA $WEB && chmod 700 $DATA"
  rsync -a --delete src/ "$HOST:fb-demo/src/"
  rsync -a --delete --exclude node_modules --exclude data tools/facebook-demo/ "$HOST:fb-demo/tools/facebook-demo/"
  remote "cd $APP/tools/facebook-demo && PATH=\$(dirname $NODE):\$PATH ~/.local/bin/pnpm install --frozen-lockfile --prod >/dev/null"
  # src/ looks for its packages (temporal-polyfill) beside itself, not in this folder.
  remote "ln -sfn tools/facebook-demo/node_modules $APP/node_modules"
  remote "test -f $DATA/config.json || $NODE -e '
    const fs = require(\"node:fs\");
    fs.writeFileSync(process.argv[1], JSON.stringify({ base: \"$BASE\", port: $PORT, viewToken: $token, senders: { [$token]: \"Peter\" } }, null, 2), { mode: 0o600 });
  ' $DATA/config.json"
  remote "cat > $WEB/.htaccess" <<EOF
# The demo's Node server (tools/facebook-demo in salish-sea/salishsea-io).
# Without this, Apache asks the server for /index.html when /fb-demo/ itself is requested.
DirectoryIndex disabled
RewriteEngine On
RewriteRule ^(.*)\$ http://127.0.0.1:$PORT/\$1 [P,L]
LimitRequestBody 5242880
Header always set X-Robots-Tag "noindex, nofollow"
EOF
  remote "mkdir -p ~/.config/systemd/user && cat > ~/.config/systemd/user/fb-demo.service" <<EOF
[Unit]
Description=Facebook sightings demo (salishsea-io tools/facebook-demo)

[Service]
WorkingDirectory=%h/fb-demo/tools/facebook-demo
Environment=FB_DEMO_DATA=%h/fb-demo-data NODE_NO_WARNINGS=1
ExecStart=%h/.nvm/versions/node/v24.18.0/bin/node server.mjs
Restart=on-failure
RestartSec=5
MemoryMax=400M
NoNewPrivileges=yes

[Install]
WantedBy=default.target
EOF
  remote "systemctl --user daemon-reload && systemctl --user enable --now fb-demo.service >/dev/null 2>&1 && systemctl --user restart fb-demo.service"
  sleep 3
  curl -fsS "$BASE/healthz" >/dev/null && echo "deployed: $BASE/ is up"
  ;;
sender)
  name="${2:?usage: deploy.sh sender NAME}"
  # The name goes over standard input, so no shell on Maderas reads it.
  printf '%s' "$name" | remote "$NODE -e '
    const fs = require(\"node:fs\"); const [path] = process.argv.slice(1); const name = fs.readFileSync(0, \"utf8\");
    const c = JSON.parse(fs.readFileSync(path, \"utf8\")); const t = $token;
    c.senders[t] = name; fs.writeFileSync(path, JSON.stringify(c, null, 2), { mode: 0o600 });
    console.log(c.base + \"/install?s=\" + t);
  ' $DATA/config.json && systemctl --user restart fb-demo.service"
  ;;
view)
  remote "$NODE -e 'const c = JSON.parse(require(\"node:fs\").readFileSync(process.argv[1], \"utf8\")); console.log(c.base + \"/?k=\" + c.viewToken)' $DATA/config.json"
  ;;
retire)
  remote "systemctl --user disable --now fb-demo.service; rm -f ~/.config/systemd/user/fb-demo.service $WEB/.htaccess; rmdir $WEB"
  echo "Stopped and off the web. The data is still in $HOST:fb-demo-data; delete it when it is no longer wanted: it holds members' names."
  ;;
*) echo "usage: deploy.sh [deploy|sender NAME|view|retire]" >&2; exit 2 ;;
esac
