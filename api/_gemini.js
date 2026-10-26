// Shared Gemini helpers for the serverless functions.
// Files starting with "_" inside /api are not exposed as routes on Vercel.
const BASE = 'https://generativelanguage.googleapis.com';
export const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function apiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw httpError(500, '서버에 GEMINI_API_KEY가 설정되지 않았습니다.');
  return key;
}
export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
// Optional gate: when ACCESS_CODE is set on the server, every API call must carry the same code.
// It keeps strangers from spending the Gemini quota once the app is public. Not a login system.
export function checkAccess(request) {
  const required = (process.env.ACCESS_CODE || '').trim();
  if (!required) return;
  const given = (request.headers.get('x-access-code') || '').trim();
  if (given !== required) throw httpError(401, given ? '접속 코드가 맞지 않습니다.' : '접속 코드가 필요합니다.');
}
export function errorResponse(e) {
  console.error(e);
  return Response.json({ error: e?.message || String(e) }, { status: e?.status || 500 });
}
export async function geminiFetch(path, init = {}) {
  const res = await fetch(path.startsWith('http') ? path : BASE + path, {
    ...init,
    headers: { 'x-goog-api-key': apiKey(), ...(init.headers || {}) },
  });
  if (!res.ok) {
    let detail = '';
    const raw = await res.text().catch(() => '');
    try { detail = JSON.parse(raw)?.error?.message || ''; } catch { detail = raw.slice(0, 200); }
    const status = res.status === 429 ? 429 : res.status >= 500 ? 502 : 400;
    const message = res.status === 429
      ? 'Gemini 무료 사용량 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.'
      : `Gemini API 오류 (${res.status}) ${detail}`.trim();
    throw httpError(status, message);
  }
  return res;
}

// A 3-week calendar table keeps relative dates ("다음 주 수요일") from being miscomputed.
function calendarTable(isoDate) {
  const base = new Date(`${isoDate}T12:00:00Z`);
  const rows = [];
  for (let i = -1; i <= 21; i++) {
    const d = new Date(base); d.setUTCDate(base.getUTCDate() + i);
    rows.push(`${d.toISOString().slice(0, 10)}(${WEEKDAYS[d.getUTCDay()]})`);
  }
  return rows.join(', ');
}

export function buildPrompt({ title, date, participants, hasAudio, template = '' }) {
  const meetingDate = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : new Date().toISOString().slice(0, 10);
  const weekday = WEEKDAYS[new Date(`${meetingDate}T12:00:00Z`).getUTCDay()];
  return `당신은 한국어 회의록 작성 비서입니다. ${hasAudio ? '첨부된 회의 녹음' : '아래 회의 원문(녹취록 또는 러프한 메모)'}을 바탕으로 회의록과 후속 할 일을 작성하세요.

[회의 정보]
- 제목: ${title || '(미입력)'}
- 회의 날짜: ${meetingDate} (${weekday}요일)
- 참석자: ${participants || '(미입력)'}
- 날짜 참고표: ${calendarTable(meetingDate)}
- 한 주는 월요일에 시작합니다. "다음 주 X요일"은 회의 날짜가 속한 주의 다음 주(월~일)에 있는 X요일입니다.

[작성 규칙]
1. 원문에 없는 사실을 지어내지 마세요. 메모가 짧거나 문장이 끊겨 있어도 의미를 살려 자연스러운 문장으로 다듬되, 내용은 추가하지 마세요.
2. topics(주요 내용): 회의에서 다룬 안건별로 나눕니다. 실제 업무에 바로 쓰는 회의록이므로 요약하지 말고 **상세하게** 씁니다.
   - title: 안건 이름(예: "프로모션 리플릿", "카드뉴스"). 원문에 [템플릿], [가이드라인]처럼 큰 묶음이 있으면 "템플릿 · 카드뉴스"처럼 앞에 붙입니다.
   - points: 그 안건에서 나온 내용을 항목별로 씁니다. 각 항목은 한 문장 이상의 완결된 서술로, "무엇을 어떻게 하기로 했는지"와 함께 **이유, 조건, 예외, 예시, 수치**가 원문에 있으면 반드시 포함합니다. 결정·확정된 내용은 "~하기로 확정", "~으로 진행"처럼 분명히 표현합니다. 원문에서 언급된 내용을 빠뜨리지 마세요. 한 안건에 3~6개 항목이 일반적입니다.
3. tasks(해야 할 일): 누군가 실제로 해야 하는 후속 작업입니다. 상대방에게 "전달 부탁드립니다", "확인 요청"한 것도 그 상대방의 할 일입니다.
   - title: "무엇을 한다" 형태의 짧은 행동 문장(담당자 이름과 날짜는 빼고).
   - details: 그 할 일의 세부 작업이나 조건을 짧은 구절로 나열합니다(예: "유형별 기본 구조 재정리", "공란 없는 완성형 레이아웃 적용"). 없으면 빈 배열.
   - team: 할 일을 맡은 조직·팀·측(예: "시하", "세스코", "마케팅팀"). 회의에 둘 이상의 조직이나 팀이 참여했고 원문에서 누구 쪽 일인지 구분할 수 있을 때만 적습니다. 내부 회의처럼 구분이 없거나 불분명하면 빈 문자열로 둡니다. 같은 조직은 항상 같은 표기를 씁니다.
   - owner: 담당자가 분명할 때만 적습니다. 발언 속에서 이름으로 지목되면 그 이름(직함 제외, 예: "전소연")을, 화자가 "제가 할게요"처럼 직접 맡았으면 그 화자 표시(예: "화자2", "참석자 1")를 그대로 적습니다. 화자 표시도 없고 이름도 알 수 없으면 빈 문자열로 둡니다. 앞 문장에 나온 다른 사람의 이름을 짐작해서 넣지 마세요.
   - due: 기한을 YYYY-MM-DD로 씁니다. 상대 날짜는 회의 날짜와 날짜 참고표로 계산합니다. "다음 주 중", "조만간"처럼 날짜가 특정되지 않으면 빈 문자열로 둡니다.
   - evidence: 그 할 일의 근거가 되는 원문 발언을 짧게 인용합니다. 화자 표시가 있는 원문이면 "화자2: 제가 견적 받아볼게요"처럼 화자 표시를 앞에 붙입니다.
4. issues(확인 필요 사항): 아직 정해지지 않았거나, 사실 확인·추가 검토가 필요한 사항, 우려 사항입니다. 없으면 빈 배열.
5. nextMeeting: 다음 회의 일정이나 안건이 언급되었으면 한 문장으로, 없으면 빈 문자열로 둡니다.
${hasAudio
  ? '6. transcript: 녹음 내용을 한국어로 빠짐없이 받아씁니다. 목소리로 화자를 구분해 말하는 사람이 바뀔 때마다 줄을 바꾸고 "화자1: ", "화자2: "처럼 표시합니다. 이름을 알아도 transcript에는 화자 표시만 씁니다. 추임새는 생략해도 됩니다.'
  : '6. transcript: 빈 문자열로 둡니다.'}
7. speakers: ${hasAudio ? 'transcript에 쓴' : '원문에 이미 있는(예: 클로바노트의 "참석자 1", "화자 A")'} 화자 표시 목록입니다. 화자 표시가 없으면 빈 배열로 둡니다.
   - label: 화자 표시 그대로(예: "화자1").
   - name: 그 화자가 누구인지 대화 속 근거가 분명할 때만 이름을 적습니다. 예: 다른 사람이 "민수 씨는요?"라고 묻고 그 화자가 대답함, 자기소개, 참석자 목록과 일치하는 호칭. 짐작이면 빈 문자열로 둡니다.
${template
  ? `8. formatted: 아래 [회의록 샘플]은 이 팀이 평소 쓰는 회의록입니다. 샘플의 구조, 제목 체계, 번호 방식, 기호, 말투, 문장 길이를 그대로 따라서 이번 회의 내용으로 완성된 회의록 전체를 씁니다. 샘플에 적힌 내용(안건, 이름, 날짜, 수치)은 절대 가져오지 말고 형식만 따릅니다. 샘플에 있는 섹션인데 이번 회의에 해당 내용이 없으면 "(해당 없음)"이라고 씁니다. 일반 텍스트로 쓰고, 샘플에 없는 마크다운 기호는 넣지 않습니다. topics와 tasks는 formatted와 별개로 위 규칙대로 모두 채웁니다.

[회의록 샘플]
${template}
[회의록 샘플 끝]`
  : '8. formatted: 빈 문자열로 둡니다.'}`;
}

const STR = { type: 'STRING' };
const STR_LIST = { type: 'ARRAY', items: STR };
const obj = (properties) => ({ type: 'OBJECT', properties, required: Object.keys(properties), propertyOrdering: Object.keys(properties) });
export const MINUTES_SCHEMA = obj({
  transcript: STR,
  topics: { type: 'ARRAY', items: obj({ title: STR, points: STR_LIST }) },
  tasks: { type: 'ARRAY', items: obj({ title: STR, details: STR_LIST, team: STR, owner: STR, due: STR, evidence: STR }) },
  issues: STR_LIST,
  nextMeeting: STR,
  formatted: STR,
  speakers: { type: 'ARRAY', items: obj({ label: STR, name: STR }) },
});

export async function generateMinutesWithGemini(parts) {
  const res = await geminiFetch(`/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      // thinkingLevel 'low': the default deep reasoning took ~2.5 min for a short memo; this task doesn't need it.
      generationConfig: { responseMimeType: 'application/json', responseSchema: MINUTES_SCHEMA, temperature: 0.2, thinkingConfig: { thinkingLevel: process.env.GEMINI_THINKING || 'low' } },
    }),
  });
  const data = await res.json();
  const candidate = data?.candidates?.[0];
  const text = (candidate?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('');
  if (!text) {
    const reason = candidate?.finishReason || data?.promptFeedback?.blockReason || '알 수 없음';
    throw httpError(502, `Gemini가 결과를 돌려주지 않았습니다 (사유: ${reason}).`);
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    throw httpError(502, candidate?.finishReason === 'MAX_TOKENS'
      ? '회의가 너무 길어 결과가 잘렸습니다. 녹음을 나누어 처리해 주세요.'
      : 'Gemini 응답을 JSON으로 해석하지 못했습니다.');
  }
  return normalize(parsed);
}

const str = v => (typeof v === 'string' ? v.trim() : '');
const list = v => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
// The model sometimes guesses an owner (e.g. "제가 하겠습니다" → the person named in the previous sentence).
// Keep the owner only if the quoted evidence actually mentions them (full name or given name like "소연").
export function verifiedOwner(owner, evidence) {
  if (!owner || !evidence) return owner;
  const compact = evidence.replace(/\s/g, '');
  const given = owner.length >= 3 ? owner.slice(-2) : owner;
  return compact.includes(owner.replace(/\s/g, '')) || compact.includes(given) ? owner : '';
}
// Only keep speaker labels that really appear as "label:" in the text. Without this check the model
// sometimes lists the participants as speakers even when the source has no speaker labels at all.
export function speakersInText(speakers, text) {
  const src = String(text || '');
  return speakers.filter(sp => new RegExp(sp.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:：]').test(src));
}
export function normalize(raw) {
  const tasks = (Array.isArray(raw?.tasks) ? raw.tasks : [])
    .map(t => ({
      title: str(t?.title),
      details: list(t?.details),
      team: str(t?.team),
      owner: verifiedOwner(str(t?.owner), str(t?.evidence)),
      due: /^\d{4}-\d{2}-\d{2}$/.test(str(t?.due)) && !Number.isNaN(Date.parse(str(t?.due))) ? str(t.due) : '',
      evidence: str(t?.evidence),
    }))
    .filter(t => t.title);
  return {
    transcript: str(raw?.transcript),
    topics: (Array.isArray(raw?.topics) ? raw.topics : [])
      .map(tp => ({ title: str(tp?.title), points: list(tp?.points) }))
      .filter(tp => tp.title || tp.points.length),
    issues: list(raw?.issues),
    tasks,
    nextMeeting: str(raw?.nextMeeting),
    formatted: str(raw?.formatted),
    speakers: (Array.isArray(raw?.speakers) ? raw.speakers : [])
      .map(sp => ({ label: str(sp?.label), name: str(sp?.name) }))
      .filter((sp, i, arr) => sp.label && arr.findIndex(x => x.label === sp.label) === i),
  };
}
