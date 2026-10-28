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

// 'brief': 안건별로 "무슨 논의 → 그래서 할 일" 한 줄씩 (참석자가 빠르게 확인하는 용도).
// 'detailed': 업무영역 → 세부 주제(sections) → 논의 흐름·의견 근거·결론까지 (회의에 없던 사람이 읽는 용도).
export const DETAIL_LEVELS = ['brief', 'detailed'];
export const detailLevel = v => (DETAIL_LEVELS.includes(v) ? v : 'detailed');

const BRIEF_TOPICS = `2. topics(주요 내용): 회의에서 다룬 안건별로 나눕니다. 회의에 참석한 사람이 "무슨 논의를 했고, 그래서 뭘 하면 되는지"를 한눈에 확인하는 간략 버전입니다. 할 일 위주로 짧게 씁니다.
   - title: 안건 이름(예: "프로모션 리플릿", "카드뉴스"). 원문에 [템플릿], [가이드라인]처럼 큰 묶음이 있으면 "템플릿 · 카드뉴스"처럼 앞에 붙입니다.
   - points: 논의 하나를 한 줄로, 반드시 "논의한 내용 → 그래서 할 일(또는 결론)" 형태로 씁니다. 모든 항목에 "→" 기호가 한 번 들어갑니다. 예: "전면 원재료 사진은 가공식품 느낌 우려 → 일러스트로 대체", "인쇄소 견적 미접수 → 소연 과장이 두 곳 견적 받아 공유", "런칭 이벤트는 예산 미정 → 보류". 결론이 없는 논의는 "→ 추후 확인"처럼 씁니다. 안건당 2~5개. 이유 설명, 배경, 의견 흐름은 쓰지 않습니다.
   - sections: 빈 배열로 둡니다.`;

const DETAILED_TOPICS = `2. topics(주요 내용): 회의에서 다룬 업무영역별로 나눕니다. 회의에 참석하지 않은 사람이 읽고 "어떤 흐름으로 어떤 논의가 있었고, 어떤 의견에 따라 무엇을 하기로 했는지"를 이해할 수 있는 상세 버전입니다. 간략 버전보다 훨씬 자세히 씁니다.
   - title: 업무영역 이름(예: "프로모션 리플릿", "카드뉴스"). 원문에 나온 업무만 쓰고, 같은 업무가 회의 중 여러 번 나오면 하나로 합칩니다.
   - points: 빈 배열로 둡니다(내용은 모두 sections에 씁니다).
   - sections: 그 업무영역 안에서 논의된 세부 주제 목록입니다. 회의에서 이야기가 나온 순서대로, 반드시 1개 이상, 보통 2~4개로 나눕니다.
     - title: 세부 주제 이름. 단순 명사("디자인")가 아니라 무엇을 논의했는지 알 수 있게 씁니다(예: "전면 이미지: 사진 대신 일러스트", "기본 구성 1P로 변경").
     - points: 그 세부 주제의 논의 흐름을 순서대로 항목별로 씁니다. 세부 주제당 2~7개. 아래 ①~④ 순서를 따르되 원문에 있는 것만 쓰고, "배경:", "결론:", "①" 같은 꼬리표는 붙이지 말고 자연스러운 보고서 문장으로 씁니다. 원문이 짧은 메모라 배경이나 의견이 없으면 그 항목은 만들지 않습니다(같은 내용을 "기존안"과 "결론"으로 두 번 쓰지 않습니다).
       ① 배경·기존안: 왜 이 이야기가 나왔는지, 기존에는 어떻게 되어 있었는지(예: "기존 시안은 브랜드 스토리가 먼저 나와 핵심 메시지가 늦게 보임").
       ② 나온 의견과 근거: 어떤 의견이 나왔고 그 이유는 무엇인지. 원문에서 누구 측(예: "한빛 측", "세린 대리") 의견인지 분명하면 함께 씁니다. 반대 의견이나 비교한 대안도 씁니다(예: "한빛 측은 원재료 사진에 반대. 기존 고객이 사진을 보고 가공식품 느낌을 받는다는 CS 피드백이 있었음").
       ③ 결론: 어떻게 정리됐는지. 합의·지시된 것은 "~로 확정", "~로 진행"(한 문장에 한 번만). 제안이나 "좋을 것 같다" 수준은 "~ 제안", "~ 검토". 기존안 변경은 "~ 제외", "~ 수정". 멈춘 것은 "~ 보류". 확정이 아닌 것을 확정처럼 쓰지 않습니다. 기본형과 예외가 같이 정해졌으면 둘 다 씁니다.
       ④ 그래서 할 일: 이 결론에 따라 누가(원문에 분명할 때만) 무엇을 하게 되는지, 조건·수치·기한이 원문에 있으면 포함합니다(예: "이에 따라 세린 대리가 식약처 규정을 확인해 공유").
       · 발언을 그대로 옮기지 말고 보고서 문장으로 바꿔 씁니다. 한 항목에 한 가지 내용만, 같은 말이 반복돼도 가장 구체적인 형태로 한 번만. 잡담, 리액션, 개인 경험은 뺍니다.
       · 회의 초반과 후반 의견이 다르면 둘 다 쓰되 후반의 최종 결론을 결론으로 삼습니다. 여러 안을 비교했으면 채택안 / 후보 / 보류안을 구분합니다.
       · 원문에 없는 배경·이유·날짜·담당자를 지어내지 않습니다. 의미가 불확실한 발언은 복원하지 말고 issues에 "확인 필요"로 넘깁니다.`;

export function buildPrompt({ title, date, participants, hasAudio, template = '', detail = 'detailed' }) {
  const meetingDate = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : new Date().toISOString().slice(0, 10);
  const weekday = WEEKDAYS[new Date(`${meetingDate}T12:00:00Z`).getUTCDay()];
  const detailed = detailLevel(detail) === 'detailed';
  return `당신은 한국어 회의록 작성 비서입니다. ${hasAudio ? '첨부된 회의 녹음' : '아래 회의 원문(녹취록 또는 러프한 메모)'}을 바탕으로 회의록과 후속 할 일을 작성하세요.

[회의 정보]
- 제목: ${title || '(미입력)'}
- 회의 날짜: ${meetingDate} (${weekday}요일)
- 참석자: ${participants || '(미입력)'}
- 날짜 참고표: ${calendarTable(meetingDate)}
- 한 주는 월요일에 시작합니다. "다음 주 X요일"은 회의 날짜가 속한 주의 다음 주(월~일)에 있는 X요일입니다.

[작성 규칙]
1. 원문에 없는 사실을 지어내지 마세요. 메모가 짧거나 문장이 끊겨 있어도 의미를 살려 자연스러운 문장으로 다듬되, 내용은 추가하지 마세요.
${detailed ? DETAILED_TOPICS : BRIEF_TOPICS}
3. tasks(해야 할 일 = 진행 예정 사항): 누군가 실제로 해야 하는 후속 작업입니다. "수정해서 넣겠습니다", "다시 테스트해볼게요", "리스트업해서 드릴게요" 같은 실행 약속을 실행 단위로 정리합니다. 상대방에게 "전달 부탁드립니다", "확인 요청"한 것(자료 전달, 내부 검토, 최종 컨펌, 수치 확인, 피드백 회신, 일정 공유)도 그 상대방의 할 일입니다.
${detailed ? `   - 빠짐없이, 묶지 않고: 회의에서 나온 후속 작업을 전부 씁니다. 서로 다른 작업을 하나의 할 일로 합치지 않습니다(예: "리플릿 수정"에 리플릿과 카드뉴스 작업을 함께 넣지 않음). 업무영역이 다르면 할 일도 다릅니다. 같은 업무영역이라도 수정 대상이 다르면(예: 표지 수정 / 내지 구조 변경 / 가격 표기 보완) 각각 별도의 할 일로 씁니다. topics의 결론에 "~하기로 함", "~ 수정", "~ 전달 요청", "~ 확인"이 있으면 그에 해당하는 할 일이 반드시 여기에 있어야 합니다. 긴 회의라면 할 일이 10~20개가 되는 것이 정상입니다.
   - title: "무엇을 어떻게 한다" 형태의 행동 문장(담당자 이름과 날짜는 빼고). 예: "프로모션 리플릿을 기본 1P 구조로 재정리", "제품별 1P 리플릿 제작 대상 리스트 전달".
   - details: 그 할 일을 실제로 할 때 챙겨야 할 수정·제작·검증 범위를 2~6개의 구절로 나열합니다(예: "타깃 직접 표기 제거", "필요성 → USP → 가격·혜택 순으로 한 면에 배치", "1P에 담기 어려운 경우에만 2P로 확장"). 원문에 나온 조건, 예외, 수치, 참고 자료를 모두 넣습니다. 원문에 세부 내용이 정말 없을 때만 빈 배열.` : `   - title: "무엇을 한다" 형태의 짧은 행동 문장(담당자 이름과 날짜는 빼고).
   - details: 그 할 일의 세부 작업이나 조건을 짧은 구절로 나열합니다(예: "유형별 기본 구조 재정리", "공란 없는 완성형 레이아웃 적용"). 없으면 빈 배열.`}
   - team: 할 일을 맡은 조직·팀·측(예: "시하", "세스코", "마케팅팀"). 회의에 둘 이상의 조직이나 팀이 참여했고 원문에서 누구 쪽 일인지 구분할 수 있을 때만 적습니다. 내부 회의처럼 구분이 없거나 불분명하면 빈 문자열로 둡니다. 같은 조직은 항상 같은 표기를 씁니다.
   - owner: 담당자가 분명할 때만 적습니다. 발언 속에서 이름으로 지목되면 그 이름(직함 제외, 예: "전소연")을, 화자가 "제가 할게요"처럼 직접 맡았으면 그 화자 표시(예: "화자2", "참석자 1")를 그대로 적습니다. 화자 표시도 없고 이름도 알 수 없으면 빈 문자열로 둡니다. 앞 문장에 나온 다른 사람의 이름을 짐작해서 넣지 마세요.
   - due: 기한을 YYYY-MM-DD로 씁니다. 상대 날짜는 회의 날짜와 날짜 참고표로 계산합니다. "다음 주 중", "조만간"처럼 날짜가 특정되지 않으면 빈 문자열로 둡니다.
   - evidence: 그 할 일의 근거가 되는 원문 발언을 짧게 인용합니다. 화자 표시가 있는 원문이면 "화자2: 제가 견적 받아볼게요"처럼 화자 표시를 앞에 붙입니다.
4. issues(확인 필요 사항): 아직 정해지지 않았거나, 사실 확인·추가 검토가 필요한 사항, 우려 사항입니다.${detailed ? ' 의미가 불확실한 발언은 지어내서 복원하지 말고 여기에 "확인 필요"로 적습니다.' : ''} 없으면 빈 배열.
5. nextMeeting: 다음 회의 일정이나 안건이 언급되었으면 한 문장으로, 없으면 빈 문자열로 둡니다.
${hasAudio
  ? '6. transcript: 녹음 내용을 한국어로 빠짐없이 받아씁니다. 목소리로 화자를 구분해 말하는 사람이 바뀔 때마다 줄을 바꾸고 "화자1: ", "화자2: "처럼 표시합니다. 이름을 알아도 transcript에는 화자 표시만 씁니다. 추임새는 생략해도 됩니다.'
  : '6. transcript: 빈 문자열로 둡니다.'}
7. speakers: ${hasAudio ? 'transcript에 쓴' : '원문에 이미 있는(예: 클로바노트의 "참석자 1", "화자 A")'} 화자 표시 목록입니다. 화자 표시가 없으면 빈 배열로 둡니다.
   - label: 화자 표시 그대로(예: "화자1").
   - name: 그 화자가 누구인지 대화 속 근거가 분명할 때만 이름을 적습니다. 예: 다른 사람이 "민수 씨는요?"라고 묻고 그 화자가 대답함, 자기소개, 참석자 목록과 일치하는 호칭. 짐작이면 빈 문자열로 둡니다.
${template
  ? `8. formatted: 아래 [회의록 샘플]은 이 팀이 평소 쓰는 회의록입니다. 샘플의 구조, 제목 체계, 번호 방식, 기호, 말투, 문장 길이를 그대로 따라서 이번 회의 내용으로 완성된 회의록 전체를 씁니다. 샘플에 적힌 내용(안건, 이름, 날짜, 수치)은 절대 가져오지 말고 형식만 따릅니다. 샘플에 있는 섹션인데 이번 회의에 해당 내용이 없으면 "(해당 없음)"이라고 씁니다. 일반 텍스트로 쓰고, 샘플에 없는 마크다운 기호는 넣지 않습니다. 내용의 분량과 상세함은 위 topics 규칙(${detailed ? '상세: 논의 흐름·의견 근거·결론·할 일까지, 불참자가 읽는 용도' : '간략: 논의 → 할 일 한 줄씩'})과 같은 수준으로 맞춥니다. topics와 tasks는 formatted와 별개로 위 규칙대로 모두 채웁니다.

[회의록 샘플]
${template}
[회의록 샘플 끝]`
  : '8. formatted: 빈 문자열로 둡니다.'}`;
}

const STR = { type: 'STRING' };
const STR_LIST = { type: 'ARRAY', items: STR };
const obj = (properties) => ({ type: 'OBJECT', properties, required: Object.keys(properties), propertyOrdering: Object.keys(properties) });
// sections: 상세 버전에서 쓰는 세부 주제(업무영역 → 세부 주제 → 항목). 간략 버전은 빈 배열로 돌아온다.
export const MINUTES_SCHEMA = obj({
  transcript: STR,
  topics: { type: 'ARRAY', items: obj({ title: STR, points: STR_LIST, sections: { type: 'ARRAY', items: obj({ title: STR, points: STR_LIST }) } }) },
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
      .map(tp => {
        const topic = { title: str(tp?.title), points: list(tp?.points) };
        // 상세 버전: 세부 주제(sections)가 있으면 함께 넘긴다. 빈 섹션은 버린다.
        const sections = (Array.isArray(tp?.sections) ? tp.sections : [])
          .map(s => ({ title: str(s?.title), points: list(s?.points) }))
          .filter(s => s.title || s.points.length);
        if (sections.length) topic.sections = sections;
        return topic;
      })
      .filter(tp => tp.title || tp.points.length || tp.sections),
    issues: list(raw?.issues),
    tasks,
    nextMeeting: str(raw?.nextMeeting),
    formatted: str(raw?.formatted),
    speakers: (Array.isArray(raw?.speakers) ? raw.speakers : [])
      .map(sp => ({ label: str(sp?.label), name: str(sp?.name) }))
      .filter((sp, i, arr) => sp.label && arr.findIndex(x => x.label === sp.label) === i),
  };
}
