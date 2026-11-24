#!/usr/bin/env bash
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo 'Ejecuta con sudo bash deploy/bootstrap-ubuntu.sh TU_SUBDOMINIO'; exit 1; }
domain=${1:-}
domain=${domain,,}
[[ $domain =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ && $domain == *.* && $domain =~ [a-z] ]] || { echo 'Indica un dominio, sin https://, rutas ni puertos.'; exit 1; }
[[ $(uname -m) == x86_64 ]] || { echo 'Este instalador es para Ubuntu amd64 (t3.small).'; exit 1; }
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg git build-essential python3 unzip openssl sqlite3

# Official NodeSource and Caddy repositories. Install the same Node major as CI.
install -d -m 0755 /usr/share/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --batch --yes -o /usr/share/keyrings/nodesource.gpg
printf '%s\n' 'deb [arch=amd64 signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main' > /etc/apt/sources.list.d/nodesource.list
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --batch --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
chmod 0644 /usr/share/keyrings/nodesource.gpg /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y nodejs caddy
[[ $(node -p 'process.versions.node.split(".")[0]') == 24 ]] || { echo 'Se requiere Node.js 24.'; exit 1; }

if ! command -v aws >/dev/null; then
  temporary_dir=$(mktemp -d)
  trap 'rm -rf -- "$temporary_dir"' EXIT
  curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o "$temporary_dir/awscliv2.zip"
  unzip -q "$temporary_dir/awscliv2.zip" -d "$temporary_dir"
  "$temporary_dir/aws/install" --bin-dir /usr/local/bin --install-dir /usr/local/aws-cli
fi

if ! id threadmap >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /var/lib/threadmap --shell /usr/sbin/nologin threadmap
fi
install -d -o threadmap -g threadmap -m 0750 /var/lib/threadmap
install -d -o root -g root -m 0700 /var/lib/threadmap/backups
install -d -o root -g root -m 0755 /opt/threadmap /opt/threadmap/releases
install -d -o root -g root -m 0700 /etc/threadmap
if [[ ! -f /etc/threadmap/threadmap.env ]]; then
  umask 077
  secret=$(openssl rand -hex 48)
  sed -e "s|https://REPLACE.duckdns.org|https://$domain|" \
      -e "s|REPLACE_WITH_A_PERMANENT_RANDOM_SECRET|$secret|" \
      "$script_dir/production.env.example" > /etc/threadmap/threadmap.env
  unset secret
else
  grep -Fxq "APP_URL=https://$domain" /etc/threadmap/threadmap.env || {
    echo 'APP_URL ya existe con otro valor. Revisa /etc/threadmap/threadmap.env antes de cambiar el dominio.'; exit 1;
  }
fi
chmod 0600 /etc/threadmap/threadmap.env
install -m 0644 "$script_dir/threadmap.service" /etc/systemd/system/threadmap.service
install -m 0755 "$script_dir/release.sh" /usr/local/sbin/threadmap-deploy

cat > /etc/caddy/Caddyfile <<EOF
$domain {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000 {
        header_up X-ThreadMap-Client-IP {remote_host}
    }
}
EOF
chmod 0644 /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl daemon-reload
systemctl enable threadmap
systemctl enable --now caddy
systemctl reload caddy
echo 'Preparado. Configura la IA en /etc/threadmap/threadmap.env y ejecuta el primer despliegue.'
