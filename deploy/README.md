# Desplegar ThreadMap en Ubuntu 26.04 y EC2

Configuración: instancia `threadmap`, Ubuntu Server 26.04 amd64, `t3.small`, disco de 20 GiB y Security Group `threadmap-web`. Administración por SSH. Un único proceso de Node.js 24, SQLite en disco y Caddy con HTTPS.

## 1. Subir esta versión a GitHub desde tu PC

Los archivos de esta carpeta y `.github/workflows` deben estar en `main` antes de usarlos desde EC2. Revisa los cambios en Codex/Git y haz commit y push. Los secretos, la base local y `node_modules` están excluidos; el despliegue solo empaqueta una lista explícita de archivos fuente.

```powershell
git status
git add .gitattributes .env.example README.md runtime.js server.js accounts.js deploy .github/workflows test/production.test.js
git commit -m "Prepare Ubuntu EC2 deployment and CI/CD"
git push origin main
```

Si ya hay otros cambios preparados, revisa el contenido del commit antes de enviarlo. El workflow ejecuta las pruebas, pero no despliega hasta configurar `DEPLOY_ENABLED=true`.

## 2. Revisar la red y obtener una dirección estable

En AWS, selecciona la región donde ya creaste la instancia. En `threadmap-web` configura las entradas:

| Puerto | Origen | Uso |
| --- | --- | --- |
| TCP 22 | My IP, tu IP pública con `/32` | Administración SSH |
| TCP 80 | `0.0.0.0/0` | Validación del certificado y redirección HTTPS |
| TCP 443 | `0.0.0.0/0` | Aplicación |

El puerto 3000 permanece cerrado; Node escucha en `127.0.0.1`. Mantén la salida a Internet para apt, npm, SSM, certificados y proveedores de IA.

En **EC2 → Elastic IP addresses → Allocate → Associate**, asocia una Elastic IP a `threadmap`. Apunta el subdominio que crees en [DuckDNS](https://www.duckdns.org/) a esa IPv4. Ejemplo de nombre, si está disponible: `threadmap-demo.duckdns.org`. Configura IPv6 solo si también has preparado esa conectividad.

En los siguientes comandos sustituye `TU_SUBDOMINIO.duckdns.org`, `TU_IP_ELASTICA`, las rutas de tu clave y los valores IAM por los reales.

## 3. Instalar el servidor, por SSH

Desde PowerShell en tu PC:

```powershell
ssh -i "C:\ruta\threadmap.pem" ubuntu@TU_IP_ELASTICA
```

Dentro de Ubuntu:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y git
git clone https://github.com/logicat1204/ThreadMap-COM350.git ~/threadmap-setup
cd ~/threadmap-setup
THREADMAP_DOMAIN='TU_SUBDOMINIO.duckdns.org'
getent ahostsv4 "$THREADMAP_DOMAIN"
```

Comprueba que DNS devuelve tu Elastic IP antes de continuar. Si el repositorio es privado, usa un acceso de lectura de GitHub para clonarlo o transfiere una copia mediante SCP; no pongas tokens en la URL de `git clone`.

```bash
sudo bash deploy/bootstrap-ubuntu.sh "$THREADMAP_DOMAIN"
node --version
npm --version
```

El instalador prepara Node.js 24, las dependencias nativas de SQLite, Caddy, AWS CLI, el usuario de servicio `threadmap`, las carpetas y el servicio systemd. Genera un secreto aleatorio permanente y no lo muestra. Al repetir el instalador conserva la configuración y la base existentes.

El instalador instala software y habilita servicios; se ejecuta una vez, desde un checkout de confianza. Caddy necesita que DNS y los puertos 80/443 ya estén correctos. Hasta desplegar la aplicación, el proxy puede responder 502.

## 4. Configurar la IA y desplegar por primera vez

```bash
sudo nano /etc/threadmap/threadmap.env
```

El archivo ya contiene `APP_URL`, `DATABASE_PATH`, `TRUST_PROXY` y un `BETTER_AUTH_SECRET` generado. Conserva ese secreto, `PORT=3000` y `DATABASE_PATH=/var/lib/threadmap/threadmap.sqlite`. Para ofrecer IA con tu clave, completa `OPENAI_API_KEY` o `GEMINI_API_KEY`. También puedes dejar las claves vacías y que cada usuario conecte la suya desde Configuración. Guarda con Ctrl+O, Enter, y sal con Ctrl+X.

Empaqueta el código del commit que acabas de clonar y despliega:

```bash
cd ~/threadmap-setup
git archive --format=tar.gz --output /tmp/threadmap-release.tar.gz HEAD \
  package.json package-lock.json server.js accounts.js runtime.js public
sudo /usr/local/sbin/threadmap-deploy /tmp/threadmap-release.tar.gz "$(git rev-parse HEAD)"
```

Comprueba el resultado:

```bash
sudo systemctl status threadmap --no-pager
curl --fail http://127.0.0.1:3000/health
curl --fail "https://$THREADMAP_DOMAIN/health"
```

Ambas peticiones deben devolver `{"status":"ok"}`. Abre la URL HTTPS en otro dispositivo, registra una cuenta, envía una pregunta y comprueba que el historial reaparece al cerrar sesión y volver a entrar. La base de EC2 empieza vacía; las cuentas locales de prueba no se incluyen en el paquete.

Si falla:

```bash
sudo journalctl -u threadmap -n 60 --no-pager
sudo journalctl -u caddy -n 60 --no-pager
```

## 5. Preparar AWS para CI/CD

### Bucket privado

En S3 crea un bucket de propósito general en la misma región, con nombre único como `threadmap-deploy-TU-SUFIJO`. Mantén **Block all public access** activado y el cifrado predeterminado SSE-S3. El prefijo utilizado es `releases/`. Puedes añadir una regla de ciclo de vida que elimine estos paquetes tras 7 o 14 días; no almacena la base de datos.

### Rol de EC2

En **IAM → Roles → Create role → AWS service → EC2**, crea `ThreadMapEC2Role` con la política administrada `AmazonSSMManagedInstanceCore`.

Añade una política inline usando `ec2-bucket-read-policy.json`, sustituyendo `BUCKET_NAME`. Solo concede lectura del prefijo de paquetes. En la instancia: **Actions → Security → Modify IAM role**, selecciona ese rol.

En Ubuntu verifica el agente SSM. Usa una sola instalación; las AMI oficiales pueden traerlo como Snap o paquete deb:

```bash
sudo systemctl status snap.amazon-ssm-agent.amazon-ssm-agent.service --no-pager
sudo systemctl status amazon-ssm-agent --no-pager
```

Si el agente Snap ya existe:

```bash
sudo snap start amazon-ssm-agent
```

Solo si no está instalado por ninguno de los dos métodos:

```bash
sudo snap install amazon-ssm-agent --classic
sudo snap start amazon-ssm-agent
```

Comprueba **EC2 → instancia → Connect → Session Manager**. Debe permitir conectar. SSH seguirá funcionando; SSM será el canal usado por GitHub Actions. La EC2 obtiene sus permisos desde el rol IAM.

### Proveedor OIDC y rol de GitHub

1. En **IAM → Identity providers → Add provider → OpenID Connect**, usa `https://token.actions.githubusercontent.com` y audiencia `sts.amazonaws.com`. Si el proveedor ya existe, reutilízalo.
2. En GitHub abre **Actions → Show AWS OIDC identity → Run workflow**, seleccionando `main`.
3. En el log copia el valor de `GITHUB_OIDC_SUB`. El workflow imprime solo `sub` y `aud`; nunca el token. Usamos el valor real porque GitHub puede incluir identificadores inmutables del propietario y repositorio en cuentas/repositorios recientes.
4. Crea un rol IAM con **Custom trust policy** usando `github-trust-policy.json`. Sustituye `ACCOUNT_ID` por los 12 dígitos de tu cuenta y `GITHUB_OIDC_SUB` por el valor exacto del paso anterior. Nombre: `ThreadMapGitHubDeployRole`.
5. Añade al rol una política inline usando `github-permissions.json`. Sustituye `ACCOUNT_ID`, `REGION`, `INSTANCE_ID` y `BUCKET_NAME`. El rol podrá subir paquetes y ejecutar comandos solo en esa instancia, además de consultar el resultado del comando.
6. Copia el ARN del rol de GitHub.

## 6. Activar GitHub Actions

En **repositorio → Settings → Secrets and variables → Actions → Variables**, crea variables de repositorio:

| Variable | Valor |
| --- | --- |
| `AWS_REGION` | Región real de la EC2, por ejemplo `us-east-1` |
| `AWS_ROLE_ARN` | ARN de `ThreadMapGitHubDeployRole` |
| `EC2_INSTANCE_ID` | Identificador `i-...` de `threadmap` |
| `DEPLOY_BUCKET` | Nombre del bucket, sin `s3://` |
| `DEPLOY_ENABLED` | `true`, solo cuando los pasos anteriores funcionen |

Las claves de IA y el secreto de sesión permanecen en `/etc/threadmap/threadmap.env`. GitHub usa OIDC, con permisos temporales; no necesita tu clave SSH ni claves permanentes de AWS.

Abre **Actions → Test and deploy ThreadMap → Run workflow → main** para el primer despliegue automático. Luego, cada push a `main` ejecuta:

1. `npm ci`, `npm test` y validación de los scripts en un runner Linux.
2. Empaquetado de las fuentes de ese commit, sin bases, secretos ni `node_modules` de Windows.
3. Subida a S3 y orden de despliegue por SSM.
4. Instalación de dependencias en una carpeta nueva de EC2, respaldo de SQLite con el servicio detenido, cambio de versión y reinicio.
5. Comprobación local de salud y espera del resultado real de SSM. Si falla, el workflow queda en rojo.

Las pull requests ejecutan las pruebas, pero no tienen acceso al despliegue. Para que no lleguen cambios sin revisar, protege `main` con pull requests y el check del job `test` si esa opción está disponible en tu plan.

El script `/usr/local/sbin/threadmap-deploy` está instalado por root durante el bootstrap y no se reemplaza desde cada paquete de aplicación. Si cambias el script o la unidad systemd, actualiza el checkout de setup y vuelve a ejecutar el bootstrap por SSH.

## Datos, fallos y final de la demo

- Código: `/opt/threadmap/releases/` y enlace `/opt/threadmap/current`.
- Cuentas e historial: `/var/lib/threadmap/threadmap.sqlite`.
- Configuración: `/etc/threadmap/threadmap.env`, legible por root y cargada por systemd.
- Respaldo previo a cada actualización: `/var/lib/threadmap/backups/`.
- Los despliegues producen una interrupción breve al reiniciar el proceso.
- Si una versión no arranca, el script intenta volver al código anterior. No reemplaza automáticamente la base: si una migración cambió su esquema, revisa el respaldo y detén el servicio antes de restaurarlo. Los respaldos permanecen en el mismo disco; para sobrevivir a la eliminación del volumen hace falta una copia externa o snapshot.
- Se conservan las versiones y los respaldos locales; revisa el espacio con `df -h` si despliegas muchas veces.
- Al terminar el mes, elimina los recursos que ya no quieras conservar: EC2/volumen según su configuración, Elastic IP, snapshots y bucket de paquetes. Detener EC2 conserva el disco y la IP, que pueden seguir generando cargos.

## Referencias

- [NodeSource](https://deb.nodesource.com/)
- [Caddy para Ubuntu](https://caddyserver.com/docs/install#debian-ubuntu-raspbian)
- [Conectar EC2 con Session Manager](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/connect-with-systems-manager-session-manager.html)
- [GitHub Actions OIDC con AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
- [Acción oficial de AWS y formato de los sujetos OIDC](https://github.com/aws-actions/configure-aws-credentials)
