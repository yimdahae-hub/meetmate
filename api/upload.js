// POST /api/upload  body {size, mimeType, name} → {uploadUrl}
// Starts a Gemini Files API resumable upload with the server-side API key and hands the
// one-time session URL to the browser, which then uploads the audio directly to Google.
// (Relaying the bytes through this function doesn't work: Vercel caps requests at 4.5MB,
//  while Gemini only accepts intermediate chunks in multiples of 8MB.)
import { geminiFetch, httpError, errorResponse, checkAccess } from './_gemini.js';

const MAX_SIZE = 200 * 1024 * 1024;

export async function POST(request) {
  try {
    checkAccess(request);
    const { size, mimeType, name } = await request.json();
    if (!Number.isFinite(size) || size <= 0) throw httpError(400, '파일 크기가 올바르지 않습니다.');
    if (size > MAX_SIZE) throw httpError(413, '200MB 이하의 오디오 파일만 업로드할 수 있습니다.');
    if (!/^audio\//.test(mimeType || '')) throw httpError(400, '오디오 파일만 업로드할 수 있습니다.');
    const origin = request.headers.get('origin');
    const res = await geminiFetch('/upload/v1beta/files', {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(size),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
        // Google allows the browser's later upload (CORS) only for the origin that started the session.
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify({ file: { display_name: String(name || 'meeting-audio').slice(0, 100) } }),
    });
    const uploadUrl = res.headers.get('x-goog-upload-url');
    if (!uploadUrl) throw httpError(502, '업로드 주소를 받지 못했습니다.');
    return Response.json({ uploadUrl });
  } catch (e) {
    return errorResponse(e);
  }
}
