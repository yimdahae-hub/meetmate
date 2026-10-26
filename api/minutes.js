// POST /api/minutes
// body: { title, date, participants, text }            → rough notes / transcript
//    or { title, date, participants, fileName, mimeType } → audio already uploaded via /api/upload
import { buildPrompt, generateMinutesWithGemini, speakersInText, geminiFetch, httpError, errorResponse, checkAccess, MODEL } from './_gemini.js';

const MAX_TEXT = 60000;
const MAX_TEMPLATE = 8000;

async function waitUntilActive(fileName) {
  for (let i = 0; i < 40; i++) {
    const file = await (await geminiFetch(`/v1beta/${fileName}`)).json();
    if (file.state === 'ACTIVE') return file;
    if (file.state === 'FAILED') throw httpError(400, 'Gemini가 오디오 파일을 처리하지 못했습니다. 다른 형식(mp3, wav)으로 시도해 주세요.');
    await new Promise(r => setTimeout(r, 1500));
  }
  throw httpError(504, '오디오 파일 준비 시간이 너무 오래 걸립니다. 잠시 후 다시 시도해 주세요.');
}

export async function POST(request) {
  try { checkAccess(request); } catch (e) { return errorResponse(e); }
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: '잘못된 요청입니다.' }, { status: 400 }); }
  const { title = '', date = '', participants = '', text = '', fileName = '', template = '' } = body || {};
  if (String(template).length > MAX_TEMPLATE) return Response.json({ error: `회의록 샘플이 너무 깁니다 (최대 ${MAX_TEMPLATE.toLocaleString()}자).` }, { status: 413 });
  const meta = { title: String(title).slice(0, 100), date: String(date), participants: String(participants).slice(0, 200), template: String(template).trim() };

  try {
    let parts;
    if (fileName) {
      if (!/^files\/[\w-]+$/.test(fileName)) throw httpError(400, '잘못된 파일 이름입니다.');
      const file = await waitUntilActive(fileName);
      parts = [{ text: buildPrompt({ ...meta, hasAudio: true }) }, { file_data: { mime_type: file.mimeType, file_uri: file.uri } }];
      try {
        const result = await generateMinutesWithGemini(parts);
        result.speakers = speakersInText(result.speakers, result.transcript);
        return Response.json({ ...result, model: MODEL });
      } finally {
        // Don't keep meeting audio on Google's side longer than needed (it would auto-expire after 48h anyway).
        geminiFetch(`/v1beta/${fileName}`, { method: 'DELETE' }).catch(e => console.warn('file delete failed', e.message));
      }
    }
    const source = String(text).trim();
    if (!source) throw httpError(400, '회의 원문이 비어 있습니다.');
    if (source.length > MAX_TEXT) throw httpError(413, `원문이 너무 깁니다 (최대 ${MAX_TEXT.toLocaleString()}자).`);
    parts = [{ text: `${buildPrompt({ ...meta, hasAudio: false })}\n\n[회의 원문]\n${source}` }];
    const result = await generateMinutesWithGemini(parts);
    result.speakers = speakersInText(result.speakers, source);
    return Response.json({ ...result, model: MODEL });
  } catch (e) {
    return errorResponse(e);
  }
}
