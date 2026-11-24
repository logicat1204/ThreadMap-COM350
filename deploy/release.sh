#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
[[ $EUID -eq 0 ]] || { echo 'Ejecuta este despliegue con sudo.'; exit 1; }
artifact=${1:-}
sha=${2:-}
[[ $sha =~ ^[a-f0-9]{40}$ ]] || { echo 'El segundo argumento debe ser el SHA completo del commit.'; exit 1; }
[[ -f /etc/threadmap/threadmap.env ]] || { echo 'Ejecuta primero bootstrap-ubuntu.sh.'; exit 1; }
grep -Fxq 'DATABASE_PATH=/var/lib/threadmap/threadmap.sqlite' /etc/threadmap/threadmap.env || { echo 'Este despliegue requiere la ruta SQLite estándar.'; exit 1; }
grep -Fxq 'PORT=3000' /etc/threadmap/threadmap.env || { echo 'Este despliegue requiere PORT=3000.'; exit 1; }

# Serializes manual releases and deployments sent by GitHub Actions.
exec 9>/var/lock/threadmap-deploy.lock
flock -n 9 || { echo 'Ya hay un despliegue en curso.'; exit 1; }
release="/opt/threadmap/releases/${sha}-$(date -u +%Y%m%d%H%M%S)-$$"
previous=''
if [[ -L /opt/threadmap/current ]]; then
  previous=$(readlink -f /opt/threadmap/current)
elif [[ -e /opt/threadmap/current ]]; then
  echo '/opt/threadmap/current debe ser un enlace a una versión.'; exit 1
fi
install -d -o threadmap -g threadmap -m 0755 "$release"
archive="$release/source.tar.gz"
if [[ $artifact == s3://* ]]; then
  aws s3 cp "$artifact" "$archive" --only-show-errors
elif [[ -f $artifact ]]; then
  cp -- "$artifact" "$archive"
else
  echo 'Indica un paquete .tar.gz local o una dirección s3://.'; exit 1
fi

# Only application source is packaged; reject archive paths that could escape this release.
if tar -tzf "$archive" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo 'El paquete contiene rutas no permitidas.'; exit 1
fi
tar --no-same-owner --no-same-permissions -xzf "$archive" -C "$release"
for required in package.json package-lock.json server.js accounts.js administration.js runtime.js public/index.html; do
  [[ -f "$release/$required" ]] || { echo "Falta $required en el paquete."; exit 1; }
done
chown -R threadmap:threadmap "$release"
# shellcheck disable=SC2016 # $1 is expanded by the unprivileged inner bash, not this root shell.
runuser -u threadmap -- bash -c 'cd -- "$1" && npm ci --omit=dev --no-audit --no-fund' bash "$release"
chown -R root:root "$release"
chmod -R go-w "$release"

database=/var/lib/threadmap/threadmap.sqlite
backup="/var/lib/threadmap/backups/pre-${sha}-$(date -u +%Y%m%d%H%M%S)-$$.sqlite"
service_stopped=false
switched=false
# shellcheck disable=SC2329 # Invoked indirectly by the EXIT trap below.
recover() {
  status=$?
  trap - EXIT
  if [[ $status -ne 0 && $service_stopped == true ]]; then
    systemctl stop threadmap || true
    if [[ -n $previous && -d $previous ]]; then
      if [[ $switched == true ]]; then
        ln -s -- "$previous" "/opt/threadmap/.rollback-$$"
        mv -Tf -- "/opt/threadmap/.rollback-$$" /opt/threadmap/current
      fi
      systemctl start threadmap || true
      echo 'Se restauró el código anterior. La base no fue reemplazada; revisa el respaldo si cambió su esquema.'
    fi
    echo "Despliegue fallido. Revisa: journalctl -u threadmap -n 60 --no-pager. Respaldo, si existía base: $backup"
  fi
  exit "$status"
}
trap 'recover' EXIT
systemctl stop threadmap
service_stopped=true
if [[ -f $database ]]; then
  sqlite3 "$database" ".backup '$backup'"
  chmod 0600 "$backup"
fi
ln -s -- "$release" "/opt/threadmap/.current-$$"
mv -Tf -- "/opt/threadmap/.current-$$" /opt/threadmap/current
switched=true
systemctl start threadmap
for _attempt in $(seq 1 40); do
  if curl --fail --silent --show-error --max-time 2 http://127.0.0.1:3000/health >/dev/null 2>&1; then
    service_stopped=false
    echo "ThreadMap desplegado: $sha"
    exit 0
  fi
  sleep 1
done
echo 'La nueva versión no superó la comprobación de salud.'
exit 1
