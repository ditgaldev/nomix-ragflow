# README

<details open>
<summary></b>📗 Table of Contents</b></summary>

- 🐳 [Docker Compose](#-docker-compose)
- 🐬 [Docker environment variables](#-docker-environment-variables)
- 🐋 [Service configuration](#-service-configuration)
- 📋 [Setup Examples](#-setup-examples)

</details>

## 🐳 Docker Compose

- **docker-compose.yml**
  Sets up environment for RAGFlow and its dependencies.
- **docker-compose-base.yml**
  Sets up environment for RAGFlow's dependencies: Elasticsearch/[Infinity](https://github.com/infiniflow/infinity), MySQL, MinIO, and Redis.

> [!CAUTION]
> We do not actively maintain **docker-compose-CN-oc9.yml**, **docker-compose-macos.yml**, so use them at your own risk. However, you are welcome to file a pull request to improve any of them.

### Cross-project API access / 跨项目 API 调用

The main Compose file connects `server` (CPU profile) or `ragflow-gpu` (GPU profile) to the dedicated `nomix_ragflow_gateway` network with the DNS alias `nomix-ragflow`. Enable only one application profile. MySQL, Redis and search/storage dependencies remain on the separate internal `ragflow` network. Network membership does not restrict ports on the application container; attach only trusted callers and retain native API authentication.

主 Compose 配置将 `server`（CPU profile）或 `ragflow-gpu`（GPU profile）接入独立网络 `nomix_ragflow_gateway`，网络别名为 `nomix-ragflow`；只启用一种应用 profile。数据库、缓存和搜索/存储依赖不加入此网络。该网络不限制应用容器上的可访问端口，因此只接入可信调用方，并保留原生 API 鉴权。

Start RAGFlow first so Compose creates the network, then add the following network attachment to the calling service's Compose configuration, retaining its existing networks. Both projects must use the same Docker host. Set `RAGFLOW_GATEWAY_NETWORK` on RAGFlow to isolate multiple deployments on that host, and use the matching external network name in the caller.

先启动 RAGFlow 创建网络，再在调用方 Compose 中添加以下连接，并保留调用方已有网络。两个项目须位于同一 Docker 主机；同机多套部署可通过 `RAGFLOW_GATEWAY_NETWORK` 分别指定网络名，调用方使用对应名称。

```yaml
services:
  api: # Replace with the calling service's name.
    networks:
      default:
      gateway:

networks:
  gateway:
    external: true
    name: nomix_ragflow_gateway
```

Call `http://nomix-ragflow:9380/api/v1`; set the server SDK's `baseURL` to `http://nomix-ragflow:9380`. The alias does not depend on the Compose project name or container index. It is available only on this network after container recreation, not as host/public DNS. Do not register the alias for unrelated services on the same network. DNS aliases alone do not provide health-aware load balancing, and the existing fixed host ports still prevent direct multi-replica scaling. RAGFlow Compose owns this network; disconnect external consumers before removing the deployment's network.

调用地址为 `http://nomix-ragflow:9380/api/v1`，服务端 SDK 的 `baseURL` 为 `http://nomix-ragflow:9380`。别名不绑定 Compose 项目名或容器序号，重建容器后仅在该网络内生效，不是宿主机或公网域名。同一网络内其他服务不得使用这个别名。别名不提供健康感知负载均衡，当前固定宿主机端口仍阻碍直接多副本扩容。网络由 RAGFlow Compose 管理，移除部署网络前须断开外部调用方。

## 🐬 Docker environment variables

The [.env](./.env) file contains important environment variables for Docker.

### Metadata database

- `DB_TYPE`
  The business metadata database type. Defaults to `mysql`. Supported values include `mysql`, `postgres`, `gaussdb`, and `oceanbase`.
- `COMPOSE_PROFILES`
  The Docker Compose profiles to enable. By default it contains `${DOC_ENGINE},${DEVICE},metadata-${METADATA_DB_PROFILE}`.
- `METADATA_DB_PROFILE`
  Defaults to `mysql`, preserving the in-cluster MySQL service. Set it to `gaussdb` together with `DB_TYPE=gaussdb` to use an external GaussDB metadata database without starting MySQL.
- `GAUSSDB_METADATA_HOST`, `GAUSSDB_METADATA_PORT`, `GAUSSDB_METADATA_USER`, `GAUSSDB_METADATA_PASSWORD`, `GAUSSDB_METADATA_DBNAME`, `GAUSSDB_METADATA_SCHEMA`
  External GaussDB metadata database connection settings, used when `DB_TYPE=gaussdb`. Set `METADATA_DB_PROFILE=gaussdb` to keep the in-cluster MySQL service disabled.

### Elasticsearch

- `STACK_VERSION`
  The version of Elasticsearch. Defaults to `8.11.3`
- `ES_PORT`
  The port used to expose the Elasticsearch service to the host machine, allowing **external** access to the service running inside the Docker container.  Defaults to `1200`.
- `ELASTIC_PASSWORD`
  The password for Elasticsearch.

### Kibana

- `KIBANA_PORT`
  The port used to expose the Kibana service to the host machine, allowing **external** access to the service running inside the Docker container. Defaults to `6601`.
- `KIBANA_USER`
  The username for Kibana. Defaults to `rag_flow`.
- `KIBANA_PASSWORD`
  The password for Kibana. Defaults to `infini_rag_flow`.

### Resource management

- `MEM_LIMIT`
  The maximum amount of the memory, in bytes, that *a specific* Docker container can use while running. Defaults to `8073741824`.

### MySQL

- `MYSQL_PASSWORD`
  The password for MySQL. Required only when `DB_TYPE=mysql` starts the in-cluster MySQL metadata database.
- `MYSQL_PORT`
  The port to connect to MySQL from RAGFlow container. Defaults to `3306`. Change this if you use an external MySQL.
- `EXPOSE_MYSQL_PORT`
  The port used to expose the MySQL service to the host machine, allowing **external** access to the MySQL database running inside the Docker container. Defaults to `5455`.

### MinIO

- `MINIO_CONSOLE_PORT`
  The port used to expose the MinIO console interface to the host machine, allowing **external** access to the web-based console running inside the Docker container. Defaults to `9001`
- `MINIO_PORT`
  The port used to expose the MinIO API service to the host machine, allowing **external** access to the MinIO object storage service running inside the Docker container. Defaults to `9000`.
- `MINIO_USER`
  The username for MinIO.
- `MINIO_PASSWORD`
  The password for MinIO.

### Redis

- `REDIS_PORT`
  The port used to expose the Redis service to the host machine, allowing **external** access to the Redis service running inside the Docker container. Defaults to `6379`.
- `REDIS_PASSWORD`
  The password for Redis.

### RAGFlow

- `SVR_HTTP_PORT`
  The port used to expose RAGFlow's HTTP API service to the host machine, allowing **external** access to the service running inside the Docker container. Defaults to `9380`.
- `RAGFLOW_IMAGE`
  The Docker image edition. Defaults to `infiniflow/ragflow:v0.27.1`. The RAGFlow Docker image does not include embedding models.


> [!TIP]
> If you cannot download the RAGFlow Docker image, try the following mirrors.
>
> - For the `nightly` edition:
>   - `RAGFLOW_IMAGE=swr.cn-north-4.myhuaweicloud.com/infiniflow/ragflow:nightly` or,
>   - `RAGFLOW_IMAGE=registry.cn-hangzhou.aliyuncs.com/infiniflow/ragflow:nightly`.

### DeepDoc Vision Service (OSS)

- `DEEPDOC_URL`
  URL for the deepdoc vision API serving DLA (layout analysis), OCR (text detection/recognition), and TSR (table structure recognition). The `deepdoc` service in `docker-compose.yml` provides this endpoint. Defaults to `http://deepdoc:9390`. When unset, the parser falls back to inline ONNX Runtime inference.

  > The OSS deepdoc service runs on CPU using ONNX Runtime models. No GPU required.
  > API endpoints: `GET /health`, `GET /model`, `POST /predict/dla`, `POST /predict/tsr`, `POST /predict/ocr`.

- `DEEPDOC_IMAGE`
  Docker image for the OSS deepdoc service. Defaults to `infiniflow/deepdoc_oss:latest`.

### Timezone

- `TZ`
  The local time zone. Defaults to `'Asia/Shanghai'`.

### Hugging Face mirror site

- `HF_ENDPOINT`
  The mirror site for huggingface.co. It is disabled by default. You can uncomment this line if you have limited access to the primary Hugging Face domain.

### MacOS

- `MACOS`
  Optimizations for macOS. It is disabled by default. You can uncomment this line if your OS is macOS.

### Maximum file size

- `MAX_CONTENT_LENGTH`
  The maximum file size for each uploaded file, in bytes. You can uncomment this line if you wish to change the 128M file size limit. After making the change, ensure you update `client_max_body_size` in nginx/nginx.conf correspondingly.

### Doc bulk size

- `DOC_BULK_SIZE`
  The number of document chunks processed in a single batch during document parsing. Defaults to `4`.

### Embedding batch size

- `EMBEDDING_BATCH_SIZE`
  The number of text chunks processed in a single batch during embedding vectorization. Defaults to `16`.

### OceanBase prerequisites

Before setting `DOC_ENGINE=oceanbase`, make sure the host OS allows the file descriptor and core dump limits OceanBase expects.

1. Set host limits:

   ```bash
   sudo tee /etc/security/limits.d/99-oceanbase.conf >/dev/null <<'EOF'
   root soft nofile 655350
   root hard nofile 655350
   * soft nofile 655350
   * hard nofile 655350
   * soft core unlimited
   * hard core unlimited
   EOF
   ```

2. Make sure PAM limits are enabled:

   ```bash
   grep -E 'pam_limits\.so' /etc/pam.d/common-session /etc/pam.d/common-session-noninteractive
   ```

   If missing, add them:

   ```bash
   echo 'session required pam_limits.so' | sudo tee -a /etc/pam.d/common-session
   echo 'session required pam_limits.so' | sudo tee -a /etc/pam.d/common-session-noninteractive
   ```

3. Log out and log back in, or reboot.

4. Verify the effective limit:

   ```bash
   ulimit -n
   ```

   Expected: `655350`, or at least `20000`.

## 🐋 Service configuration

[service_conf.yaml.template](./service_conf.yaml.template) specifies the system-level configuration for RAGFlow and is used by its API server and task executor. In a dockerized setup, the generated `service_conf.yaml` file is automatically created from this template (replacing all environment variables by their values).

- `ragflow`
  - `host`: The API server's IP address inside the Docker container. Defaults to `0.0.0.0`.
  - `http_port`: The API server's serving port inside the Docker container. Defaults to `9380`.

- `deepdoc`
  The OSS DeepDoc vision service provides DLA, OCR, and TSR inference via ONNX Runtime.
  Defined in `docker-compose.yml` under the opt-in `deepdoc` profile; neither `server` nor `ragflow-gpu` starts it as a dependency. Add `deepdoc` to `COMPOSE_PROFILES` alongside the existing profiles when needed.
  - `image`: Set `DEEPDOC_IMAGE` to select the Docker image; the Compose fallback is `deepdoc_oss:latest`.
  - `port`: Serving port inside the container. Defaults to `9390`.
  - Health check: `curl -f http://localhost:9390/health` every 10s.

- `mysql`
  - `name`: The MySQL database name. Defaults to `rag_flow`.
  - `user`: The username for MySQL.
  - `password`: The password for MySQL.
  - `port`: The MySQL serving port inside the Docker container. Defaults to `3306`.
  - `max_connections`: The maximum number of concurrent connections to the MySQL database. Defaults to `100`.
  - `stale_timeout`: Timeout in seconds.

- `minio`
  - `user`: The username for MinIO.
  - `password`: The password for MinIO.
  - `host`: The MinIO serving IP *and* port inside the Docker container. Defaults to `minio:9000`.

- `oceanbase`
  - `scheme`: The connection scheme. Set to `mysql` to use mysql config, or other values to use config below.
  - `config`:
    - `db_name`: The OceanBase database name.
    - `user`: The username for OceanBase.
    - `password`: The password for OceanBase.
    - `host`: The hostname of the OceanBase service.
    - `port`: The port of OceanBase.

- `gaussdb`
  - `host`: The hostname or IP address of the GaussDB instance.
  - `port`: The GaussDB port.
  - `database`: The GaussDB database name. Defaults to `postgres`.
  - `user`: The username for GaussDB.
  - `password`: The password for GaussDB.
  - `schema`: Optional schema used by the DocEngine. Defaults to `public`.
  - RAGFlow does not start or manage GaussDB; set `DOC_ENGINE=gaussdb` only after preparing a GaussDB instance.

- `oss`
  - `access_key`: The access key ID used to authenticate requests to the OSS service.
  - `secret_key`: The secret access key used to authenticate requests to the OSS service.
  - `endpoint_url`: The URL of the OSS service endpoint.
  - `region`: The OSS region where the bucket is located.
  - `bucket`: The name of the OSS bucket where files will be stored. When you want to store all files in a specified bucket, you need this configuration item.
  - `prefix_path`: Optional. A prefix path to prepend to file names in the OSS bucket, which can help organize files within the bucket.

- `s3`:
  - `access_key`: The access key ID used to authenticate requests to the S3 service.
  - `secret_key`: The secret access key used to authenticate requests to the S3 service.
  - `endpoint_url`: The URL of the S3-compatible service endpoint. This is necessary when using an S3-compatible protocol instead of the default AWS S3 endpoint.
  - `bucket`: The name of the S3 bucket where files will be stored. When you want to store all files in a specified bucket, you need this configuration item.
  - `region`: The AWS region where the S3 bucket is located. This is important for directing requests to the correct data center.
  - `signature_version`: Optional. The version of the signature to use for authenticating requests. Common versions include `v4`.
  - `addressing_style`: Optional. The style of addressing to use for the S3 endpoint. This can be `path` or `virtual`.
  - `prefix_path`: Optional. A prefix path to prepend to file names in the S3 bucket, which can help organize files within the bucket.

- `oauth`
  The OAuth configuration for signing up or signing in to RAGFlow using a third-party account.
  - `<channel>`: Custom channel ID.
    - `type`: Authentication type, options include `oauth2`, `oidc`, `github`. Default is `oauth2`, when `issuer` parameter is provided, defaults to `oidc`.
    - `icon`: Icon ID, options include `github`, `sso`, default is `sso`.
    - `display_name`: Channel name, defaults to the Title Case format of the channel ID.
    - `client_id`: Required, unique identifier assigned to the client application.
    - `client_secret`: Required, secret key for the client application, used for communication with the authentication server.
    - `authorization_url`: Base URL for obtaining user authorization.
    - `token_url`: URL for exchanging authorization code and obtaining access token.
    - `userinfo_url`: URL for obtaining user information (username, email, etc.).
    - `issuer`: Base URL of the identity provider. OIDC clients can dynamically obtain the identity provider's metadata (`authorization_url`, `token_url`, `userinfo_url`) through `issuer`.
    - `scope`: Requested permission scope, a space-separated string. For example, `openid profile email`.
    - `redirect_uri`: Required, URI to which the authorization server redirects during the authentication flow to return results. Must match the callback URI registered with the authentication server. Format: `https://your-app.com/v1/user/oauth/callback/<channel>`. For local configuration, you can directly use `http://127.0.0.1:80/v1/user/oauth/callback/<channel>`.

- `user_default_llm`
  The default LLM to use for a new RAGFlow user. It is disabled by default. To enable this feature, uncomment the corresponding lines in **service_conf.yaml.template**.
  - `factory`: The LLM supplier. Available options:
    - `"OpenAI"`
    - `"DeepSeek"`
    - `"Moonshot"`
    - `"Tongyi-Qianwen"`
    - `"VolcEngine"`
    - `"ZHIPU-AI"`
  - `api_key`: The API key for the specified LLM. You will need to apply for your model API key online.

> [!TIP]
> If you do not set the default LLM here, configure the default LLM on the **Settings** page in the RAGFlow UI.


## 📋 Setup Examples

### 🔒 HTTPS Setup

#### Prerequisites

- A registered domain name pointing to your server
- Port 80 and 443 open on your server
- Docker and Docker Compose installed

#### Getting and configuring certificates (Let's Encrypt)

If you want your instance to be available under `https`, follow these steps:

1. **Install Certbot and obtain certificates**
   ```bash
   # Ubuntu/Debian
   sudo apt update && sudo apt install certbot

   # CentOS/RHEL
   sudo yum install certbot

   # Obtain certificates (replace with your actual domain)
   sudo certbot certonly --standalone -d your-ragflow-domain.com
   ```

2. **Locate your certificates**
   Once generated, your certificates will be located at:
   - Certificate: `/etc/letsencrypt/live/your-ragflow-domain.com/fullchain.pem`
   - Private key: `/etc/letsencrypt/live/your-ragflow-domain.com/privkey.pem`

3. **Update docker-compose.yml**
   Add the certificate volumes to the `ragflow` service in your `docker-compose.yml`:
   ```yaml
   services:
     ragflow:
       # ...existing configuration...
       volumes:
         # SSL certificates
         - /etc/letsencrypt/live/your-ragflow-domain.com/fullchain.pem:/etc/nginx/ssl/fullchain.pem:ro
         - /etc/letsencrypt/live/your-ragflow-domain.com/privkey.pem:/etc/nginx/ssl/privkey.pem:ro
         # Switch to HTTPS nginx configuration
         - ./nginx/ragflow.https.conf:/etc/nginx/conf.d/ragflow.conf
         # ...other existing volumes...

   ```

4. **Update nginx configuration**
   Edit `nginx/ragflow.https.conf` and replace `my_ragflow_domain.com` with your actual domain name.

5. **Restart the services**
   ```bash
   docker-compose down
   docker-compose up -d
   ```


> [!IMPORTANT]
> - Ensure your domain's DNS A record points to your server's IP address
> - Stop any services running on ports 80/443 before obtaining certificates with `--standalone`

> [!TIP]
> For development or testing, you can use self-signed certificates, but browsers will show security warnings.

#### Alternative: Using existing certificates

If you already have SSL certificates from another provider:

1. Place your certificates in a directory accessible to Docker
2. Update the volume paths in `docker-compose.yml` to point to your certificate files
3. Ensure the certificate file contains the full certificate chain
4. Follow steps 4-5 from the Let's Encrypt guide above
