// MeetMate MVP: browser-only, evidence-first meeting note extraction.
// This is heuristic summarization, NOT a generative language model.
export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function dateAtNoon(iso) {
  const good = /^\d{4}-\d{2}-\d{2}$/.test(iso || '');
  const d = good ? new Date(`${iso}T12:00:00`) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
export function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function addDays(iso, days) {
  const d = dateAtNoon(iso); d.setDate(d.getDate()+days); return isoLocal(d);
}
export function parseDueDate(sentence, meetingDate) {
  const s = String(sentence || '').replace(/\s+/g, ' ');
  const base = dateAtNoon(meetingDate);
  let match = s.match(/\b(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})일?\b/);
  if (match) return validISO(+match[1], +match[2], +match[3]);
  match = s.match(/(?:^|\D)(\d{1,2})월\s*(\d{1,2})일/);
  if (match) {
    let year = base.getFullYear();
    let found = validISO(year, +match[1], +match[2]);
    if (found && dateAtNoon(found) < dateAtNoon(addDays(meetingDate, -30))) {
      found = validISO(year + 1, +match[1], +match[2]);
    }
    return found;
  }
  if (/모레/.test(s)) return addDays(meetingDate, 2);
  if (/내일/.test(s)) return addDays(meetingDate, 1);
  if (/오늘|금일|당일/.test(s)) return meetingDate;
  const week = s.match(/(다음\s*주|차주|이번\s*주|금주)?\s*([월화수목금토일])요일/);
  if (week) {
    const target = WEEKDAYS.indexOf(week[2]);
    const weekMonDelta = (base.getDay() + 6) % 7;
    const monday = new Date(base); monday.setDate(base.getDate() - weekMonDelta);
    let delta = (target + 6) % 7;
    let out = new Date(monday);
    out.setDate(monday.getDate() + delta + (/다음\s*주|차주/.test(week[1] || '') ? 7 : 0));
    if (!week[1] && out < base) out.setDate(out.getDate() + 7);
    return isoLocal(out);
  }
  // '다음 주까지' is ambiguous; don't invent a day.
  return '';
}
function validISO(y, m, d) {
  const x = new Date(y, m-1, d, 12);
  return x.getFullYear()===y && x.getMonth()===m-1 && x.getDate()===d ? isoLocal(x) : '';
}
export function splitTranscript(text) {
  const cleaned = String(text||'').replace(/\r/g,'\n').replace(/[ \t]+/g,' ').trim();
  if (!cleaned) return [];
  return cleaned
    .split(/\n+|(?<=[.!?。！？])\s+|(?<=[.!?。！？])(?=[가-힣A-Za-z])/)
    .map(s=>s.replace(/^[-•\d]+[.)\s]+/,'').trim())
    .filter(s=>s.length >= 4);
}
const ACTION = /(해야|해주세요|해\s*주세요|부탁|담당|작성|정리|전달|공유|제출|검토|확인|수정|보완|업데이트|준비|제작|발송|보고|조사|완료|업로드|등록|예약|취합|반영|진행하기로|진행할|마감)/;
const DECISION = /(결정|확정|합의|하기로|진행하기로|유지|채택|정했|최종|결론)/;
const RISK = /(문제|우려|리스크|미정|어려움|부족|지연|장애|이슈|확인이\s*필요|확인\s*필요|주의)/;
const STOP = /(안녕하세요|감사합니다|들리세요|수고하셨|회의\s*시작|네\s*네)/;
const ACTION_TAIL = /(해\s*주세요|해주세요|해야\s*합니다|해야\s*해요|부탁드립니다|해주시면|하도록\s*하겠습니다)/;
const PERSON = /(?:담당\s*[:：]\s*)([가-힣]{2,4})(?:\s*(?:님|차장님|과장님|대리님|팀장님|실장님))?/;
const PERSON_TITLE = /([가-힣]{2,4})\s*(?:차장님|과장님|대리님|팀장님|실장님|부장님|매니저님)/;
function extractOwner(s, participants='') {
  let m = s.match(PERSON); if(m) return m[1].trim();
  m = s.match(PERSON_TITLE); if(m) return m[1];
  // Don't guess someone's name based on 'X는': this falsely labels '기본형은'.
  for (const part of String(participants||'').split(/[,、;\n/]+/)) {
    const name=part.trim().match(/^[가-힣]{2,4}/)?.[0];
    if (name && s.includes(name) && new RegExp(name+'\\s*(?:님)?(?:은|는|이|가|께서)').test(s)) return name;
  }
  return '';
}
function cleanTaskSentence(s, person) {
  let x = s.replace(/(?:^|\s)담당\s*[:：]\s*[가-힣]{2,4}(?:님|차장님|과장님|팀장님)?/g,'').trim();
  if(person) {
    x=x.replace(new RegExp('^'+person+'\\s*(?:차장님|과장님|대리님|팀장님|실장님|부장님|님)?(?:은|는|이|가|께서)?\\s*'),'');
  }
  x=x.replace(/^(?:그리고|또한|일단|그럼|그러면|이어서|자|네)[,\s]+/,'');
  x=x.replace(/(?:20\d{2}[-./])?\d{1,2}[-./]\d{1,2}일?까지/g,' ');
  x=x.replace(/\d{1,2}월\s*\d{1,2}일(?:까지)?/g,' ');
  x=x.replace(/(?:다음\s*주|이번\s*주|차주|금주)?\s*[월화수목금토일]요일까지/g,' ');
  x=x.replace(/\s+/g,' ').trim();
  x=x.replace(/[.。!！]+$/,'').trim();
  if (!x) return s;
  return x;
}
export function generateMinutes(text, meetingDate, participants='') {
  const segments = splitTranscript(text);
  const decisions=[], issues=[], discussions=[], tasks=[];
  const seen = new Set();
  for(const seg of segments) {
    if(STOP.test(seg) && seg.length < 28) continue;
    if(DECISION.test(seg)) decisions.push(seg);
    if(RISK.test(seg)) issues.push(seg);
    if(seg.length > 12 && !STOP.test(seg)) discussions.push(seg);
    const owner=extractOwner(seg, participants);
    const clearTaskCue=/(해야|해\s*주세요|해주세요|부탁|담당|기한|마감|까지|할게요|합시다)/.test(seg) || /제가.{0,90}하겠습니다/.test(seg);
    const decisionOnly=DECISION.test(seg) && !clearTaskCue && !owner;
    if(ACTION.test(seg) && seg.length >= 10 && (clearTaskCue || owner) && !decisionOnly && !/^(?:질문|예시)\s*[:：]/.test(seg)) {
      const title=cleanTaskSentence(seg,owner);
      const key=title.slice(0,38).replace(/\s/g,'');
      if(!seen.has(key)) {
        seen.add(key);
        tasks.push({id:makeId(),title,owner,due:parseDueDate(seg,meetingDate),done:false,evidence:seg});
      }
    }
  }
  // Pick longer, informative utterances. No facts are added to the transcript.
  const unique = arr=>[...new Set(arr)].slice(0,6);
  const sortedDiscussions=[...new Set(discussions)].sort((a,b)=>{
    const sc=x => Math.min(x.length,160)/12 + (/(논의|목적|필요|고객|기준|현재|결과|계획|중요)/.test(x)?3:0);
    return sc(b)-sc(a);
  });
  return {summary:unique(sortedDiscussions).slice(0,4).join('\n'),decisions:unique(decisions).join('\n'),issues:unique(issues).join('\n'),tasks:tasks.slice(0,30),segmentCount:segments.length};
}
export function makeId(){return (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2,9)}`);}
const escMd = (s) => String(s||'').trim() || '미정';
// Minutes text helpers: the AI returns structured topics; the editor keeps them as plain text.
// 간략: "1. 안건 / - 항목". 상세(sections 있음): "[업무영역] / 1. 세부 주제 / - 항목" (미팅 리포트의 ## [영역] → ### 1. 구조를 일반 텍스트로).
const bulletLines = points => (points || []).map(pt => `- ${pt}`).join('\n');
export function topicsToText(topics) {
  return (topics || []).map((tp, i) => {
    if (tp.sections?.length) {
      const sections = tp.sections.map((s, j) => `${j + 1}. ${s.title || '세부 주제'}\n${bulletLines(s.points)}`).join('\n');
      return `[${tp.title || '안건'}]\n${sections}`;
    }
    return `${i + 1}. ${tp.title || '안건'}\n${bulletLines(tp.points)}`;
  }).join('\n\n');
}
export function groupTasks(tasks) {
  // Keep teams in order of first appearance; tasks without a team go last under ''.
  const groups = new Map();
  for (const t of tasks) { const k = (t.team || '').trim(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  if (groups.has('') && groups.size > 1) { const rest = groups.get(''); groups.delete(''); groups.set('', rest); }
  return [...groups.entries()];
}
const taskMd = (t, i) => `${i + 1}. ${t.done ? '~~' : ''}${t.title}${t.done ? '~~ (완료)' : ''} — 담당: ${escMd(t.owner)}, 기한: ${escMd(t.due)}`
  + (t.details || []).map(d => `\n   - ${d}`).join('');
export function asMarkdown(state) {
  const s = state;
  // With a user template the AI already wrote the whole document in that format; export it as-is.
  if (s.templateUsed) return `${s.summary || ''}\n`;
  const groups = groupTasks(s.tasks);
  const taskLines = s.tasks.length
    ? groups.map(([team, items]) => (team ? `### ${team}\n` : '') + items.map(taskMd).join('\n')).join('\n\n')
    : '- 추출된 할 일이 없습니다. 직접 추가하거나 원문을 검토해 주세요.';
  return `# ${s.title || '회의록'}\n\n- 회의 날짜: ${escMd(s.date)}\n- 참석자: ${escMd(s.participants)}\n\n## ■ 주요 내용\n\n${s.summary || '(확인 후 작성)'}\n\n## ■ 해야 할 일\n\n${taskLines}\n\n## ■ 확인 필요 · 다음 회의\n\n${s.issues || '(없음)'}\n\n---\nAI가 회의 원문을 보고 쓴 초안입니다. 담당자, 기한, 결정 사항은 확인 후 확정하세요.\n`;
}
export function googleCalendarUrl(task, meetingTitle) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(task.due || '')) return '';
  const date=task.due.replace(/-/g,''); const next=addDays(task.due,1).replace(/-/g,'');
  const params = new URLSearchParams({action:'TEMPLATE',text:`[할 일] ${task.title}`,dates:`${date}/${next}`,ctz:'Asia/Seoul',details:`회의: ${meetingTitle||'회의'}\n담당: ${task.owner||'미정'}\n\n근거: ${task.evidence||'사용자 직접 입력'}\n\nMeetMate가 만든 초안입니다. 내용을 확인하고 저장하세요.`});
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
function icsEscape(s){return String(s||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');}
function foldICS(line){
  // RFC 5545: content lines should be folded at max 75 UTF-8 octets.
  const encoder=new TextEncoder(); let out='',segment='',octets=0;
  for(const character of line){
    const len=encoder.encode(character).length;
    if(octets+len>73){out+=segment+'\r\n ';segment='';octets=1;}
    segment+=character;octets+=len;
  }
  return out+segment;
}
export function asICS(tasks, meetingTitle) {
  const current=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const relevant=tasks.filter(t=>/^\d{4}-\d{2}-\d{2}$/.test(t.due));
  let lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//MeetMate//Meeting Tasks//KO','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
  for(const t of relevant){
    lines.push('BEGIN:VEVENT',`UID:${t.id}@meetmate.local`,`DTSTAMP:${current}`,`DTSTART;VALUE=DATE:${t.due.replace(/-/g,'')}`,`DTEND;VALUE=DATE:${addDays(t.due,1).replace(/-/g,'')}`,`SUMMARY:${icsEscape('[할 일] '+t.title)}`,`DESCRIPTION:${icsEscape(`회의: ${meetingTitle||'회의'}\n담당: ${t.owner||'미정'}${t.team?` (${t.team})`:''}${(t.details||[]).length?'\n세부: '+t.details.join(' / '):''}\n원문: ${t.evidence||'직접 입력'}`)}`,'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldICS).join('\r\n')+'\r\n';
}
// Speaker rename = plain find-and-replace (no AI call). All names are replaced in one pass so that
// swapping two names works, and "화자1" doesn't match inside "화자10".
export function replaceNames(text, map) {
  const keys = Object.keys(map).filter(k => k && map[k] !== undefined && map[k] !== k).sort((a, b) => b.length - a.length);
  if (!keys.length || !text) return text;
  const pattern = new RegExp(keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (/\d$/.test(k) ? '(?!\\d)' : '')).join('|'), 'g');
  return String(text).replace(pattern, m => map[m]);
}
export function renameSpeakers(state, map) {
  const r = x => replaceNames(x, map);
  return {
    ...state,
    transcript: r(state.transcript), summary: r(state.summary), issues: r(state.issues),
    tasks: state.tasks.map(t => ({ ...t, title: r(t.title), owner: r(t.owner), evidence: r(t.evidence) })),
    speakers: (state.speakers || []).map(r),
  };
}
