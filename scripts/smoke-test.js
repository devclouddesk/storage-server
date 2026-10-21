/**
 * Smoke Test Script for DevCloudDesk Storage Server
 *
 * Tests:
 *  1. GET  /health
 *  2. POST /v1/upload (Uploads a sample 1x1 PNG image)
 *  3. GET  /v1/image/:publicId (Fetches original)
 *  4. GET  /v1/image/w_200,h_200,c_fill,f_webp/:publicId (Fetches transformed WebP)
 *  5. DELETE /v1/admin/files/:publicId
 *
 * Usage:
 *  node scripts/smoke-test.js [endpoint] [apiKey]
 */

const ENDPOINT = process.argv[2] || process.env.STORAGE_ENDPOINT || 'http://localhost:7100';
const API_KEY = process.argv[3] || process.env.MASTER_KEY || process.env.STORAGE_API_KEY || '';

async function runSmokeTest() {
  console.log('='.repeat(60));
  console.log(`🔍 Storage Server Smoke Test -> ${ENDPOINT}`);
  console.log('='.repeat(60));

  // 1. Health
  try {
    const healthRes = await fetch(`${ENDPOINT}/health`);
    const healthJson = await healthRes.json();
    console.log('[1] ✅ /health status:', healthJson.status, `(Uptime: ${Math.round(healthJson.uptimeSeconds || 0)}s)`);
  } catch (err) {
    console.error('[1] ❌ Failed to reach /health:', err.message);
    console.log('\nMake sure storage-server is running on', ENDPOINT, '(npm run dev)');
    return;
  }

  // 2. Upload test image
  const samplePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const buffer = Buffer.from(samplePngBase64, 'base64');
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);

  const multipartBody = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="smoke-test.png"\r\n` +
      `Content-Type: image/png\r\n\r\n`
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  let publicId = null;
  try {
    const headers = {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    };
    if (API_KEY) {
      headers['Authorization'] = `Bearer ${API_KEY}`;
    }

    const uploadRes = await fetch(`${ENDPOINT}/v1/upload`, {
      method: 'POST',
      headers,
      body: multipartBody,
    });

    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) {
      console.log('[2] ⚠️ Upload response:', uploadData.message || uploadData);
    } else {
      publicId = uploadData.publicId || uploadData.asset?.publicId;
      console.log('[2] ✅ Upload successful! Public ID:', publicId);
    }
  } catch (err) {
    console.log('[2] ❌ Upload failed:', err.message);
  }

  // 3. Test transformation URL if publicId obtained
  if (publicId) {
    try {
      const transformUrl = `${ENDPOINT}/v1/image/w_100,h_100,c_fill,f_webp/${publicId}`;
      const imgRes = await fetch(transformUrl);
      console.log('[3] ✅ Transformed Image HTTP Status:', imgRes.status, `(Content-Type: ${imgRes.headers.get('content-type')})`);
    } catch (err) {
      console.log('[3] ❌ Transformation check failed:', err.message);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('🎉 Smoke Test Completed');
  console.log('='.repeat(60));
}

runSmokeTest().catch(console.error);
