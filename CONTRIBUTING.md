# Contributing to DevCloudDesk Storage Server

Thank you for considering contributing to the **DevCloudDesk Storage Server**! We welcome community contributions to improve performance, add transformation features, support new storage backends, and enhance documentation.

---

## 🛠️ Tech Stack & Architecture

- **Runtime**: Node.js 22+ (ES Modules)
- **Framework**: Fastify 5 (Ultra-low latency HTTP engine)
- **Image Pipeline**: libvips via `sharp` (High-speed multi-threaded transformations)
- **Validation & Schemas**: `zod`
- **Testing**: `vitest`
- **Packaging**: Docker (multi-arch `linux/amd64`)

---

## 🚀 Getting Started Locally

### 1. Prerequisites
- **Node.js**: v22.0.0 or higher
- **npm**: v10+
- **Docker** (optional, for containerized testing)

### 2. Setup
```bash
git clone https://github.com/devclouddesk/storage-server.git
cd storage-server
npm install
```

### 3. Running in Development Mode
```bash
# Starts server with automatic hot-reloading via tsx
npm run dev
```
By default, the server listens at `http://localhost:7100`.

### 4. Running the Test Suite
```bash
# Run all unit tests
npm run test
```

### 5. Compiling TypeScript
```bash
# Compiles to dist/
npm run build
```

---

## 🧪 Testing Guidelines
- All transformation logic must include unit tests under `test/`.
- Ensure memory leaks are prevented when handling large buffers.
- Run `npm run test` and `npm run build` before submitting any PR.

---

## 📜 Pull Request Process
1. Fork the repo and create your branch from `main`:
   `git checkout -b feature/my-new-filter`
2. Commit changes with clear, descriptive commit messages.
3. Push to your branch and open a Pull Request against `main`.
4. Ensure all CI automated tests pass.
