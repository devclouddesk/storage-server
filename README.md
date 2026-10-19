# 📦 DevCloudDesk Storage Server Engine

[![Docker Pulls](https://img.shields.io/docker/pulls/devclouddesk/storage-server?color=blue)](https://hub.docker.com/r/devclouddesk/storage-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)

A high-performance, self-hostable, database-less media and asset storage server with **dynamic on-the-fly image transformations** powered by **Fastify** and **Sharp / libvips**.

Turn any VPS or server into a private, blazingly fast **Cloudinary / S3 alternative** with zero bandwidth fees.

---

## ⚡ Highlights

- 🚀 **On-The-Fly Image Transformations**: Resize, crop, sharpen, blur, and convert formats (WebP, AVIF, JPEG, PNG) on demand via simple query parameters.
- 📦 **100% Database-Less**: Fast filesystem metadata & JSON store — zero external database dependencies (no Postgres, MongoDB, or Redis required to run).
- 🛡️ **Built-in Security & DoS Protection**: Decompression bomb detection (`MAX_INPUT_PIXELS`), CPU abuse rate limiters, low-disk-space guards.
- 🔑 **API Key & Signed Uploads**: Generate granular API keys (`read`, `write`, `delete`, `admin`) and time-limited tamper-proof signed upload tokens for client-side uploads.
- 💻 **Standalone CLI Tool**: Manage keys, check health, and view storage stats directly via the built-in `storage-server` CLI command.
- 🔄 **Multi-Driver Storage Support**: Store assets on local NVMe/SSD, or seamlessly proxy to AWS S3 and Cloudflare R2.
- 🌐 **Cache-Control & CDN Optimization**: Proper `ETag`, `304 Not Modified`, `Cache-Control: immutable`, and `Vary: Accept` headers for instant edge delivery.

---

## 🚀 Quickstart with Docker

Run a single container on your server in 10 seconds:

```bash
docker run -d \
  --name storage-server \
  --restart unless-stopped \
  -p 7100:7100 \
  -v $(pwd)/storage-data:/data \
  -e MASTER_KEY=your_secret_admin_key \
  devclouddesk/storage-server:latest
```

The server is now live at `http://localhost:7100`!

---

## 💻 Built-in CLI Tool

Manage the storage engine directly from the command line:

```bash
# Inside Docker container:
docker exec -it storage-server storage-server keys:list
docker exec -it storage-server storage-server keys:create "My App" --role secret --rate 120
docker exec -it storage-server storage-server stats
docker exec -it storage-server storage-server health

# Or if running locally via Node:
node dist/cli.js keys:create "Production Backend"
```

---

## 🎨 Image Transformations on the Fly

Serve and transform any image simply by requesting it with query parameters:

```
GET /cdn/avatars/user-123.jpg?w=400&h=400&fit=cover&f=webp&q=80
```

### Supported Transformation Parameters:
| Param | Description | Examples |
| :--- | :--- | :--- |
| `w`, `width` | Target width in pixels | `w=800` |
| `h`, `height` | Target height in pixels | `h=600` |
| `fit`, `crop` | Crop/resize mode | `fit=cover` (default), `fit=contain`, `fit=fill`, `fit=inside`, `fit=outside` |
| `f`, `format` | Output image format | `f=webp`, `f=avif`, `f=png`, `f=jpeg`, `f=auto` |
| `q`, `quality` | Compression quality (1 - 100) | `q=85` |
| `blur` | Gaussian blur radius (1 - 100) | `blur=10` |

---

## 🔌 API Reference

### 1. File Upload (`POST /v1/upload`)
Upload any asset with multipart `multipart/form-data`:

```bash
curl -X POST "http://localhost:7100/v1/upload" \
  -H "x-api-key: YOUR_API_KEY" \
  -F "file=@./banner.png" \
  -F "folder=marketing"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "publicId": "marketing/banner_a1b2c3d4.png",
    "filename": "banner.png",
    "size": 154200,
    "mimeType": "image/png",
    "url": "/cdn/marketing/banner_a1b2c3d4.png"
  }
}
```

### 2. File Delivery (`GET /cdn/*`)
```bash
# Raw original file
curl "http://localhost:7100/cdn/marketing/banner_a1b2c3d4.png"

# On-the-fly resized WebP
curl "http://localhost:7100/cdn/marketing/banner_a1b2c3d4.png?w=600&f=webp"
```

### 3. Server Stats (`GET /v1/admin/stats`)
```bash
curl -H "x-admin-key: YOUR_MASTER_KEY" "http://localhost:7100/v1/admin/stats"
```

---

## 📦 Official Client SDKs

Integrate effortlessly into your backend applications:

- **TypeScript / Node.js**: [`@devclouddesk/storage`](https://github.com/devclouddesk/dcd-storage-sdk)
  ```bash
  npm install @devclouddesk/storage
  ```
- **Python**: [`devclouddesk-storage`](https://github.com/devclouddesk/dcd-storage-sdk)
  ```bash
  pip install devclouddesk-storage
  ```

---

## ⚙️ Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | HTTP Server listening port | `7100` |
| `HOST` | Bind host IP | `0.0.0.0` |
| `DATA_DIR` | Directory on disk to store uploads, cache & keys | `/data` |
| `MASTER_KEY` | Admin root master key for CLI & management | (auto-generated if unset) |
| `KEY_PREFIX` | Prefix for generated API keys | `sk_live_` |
| `MAX_FILE_SIZE_MB` | Maximum allowed upload size in MB | `50` |
| `CACHE_MAX_SIZE_GB` | Maximum disk cache limit for transformed images | `5` |
| `DISK_FREE_THRESHOLD_PERCENT` | Free disk percentage before uploads are guarded | `15` |

---

## 🖥️ Managed by DevCloudDesk

Want a visual web dashboard, automatic SSL certificates, multi-server clustering, and one-click VPS deployments?

Check out **[DevCloudDesk](https://devclouddesk.com)** — the all-in-one cloud management and deployment platform for modern developers.

---

## 📄 License

This project is open-source software licensed under the **[MIT License](LICENSE)**.
