import assert from 'node:assert/strict';
import {generateMinutes,parseDueDate,asICS,asMarkdown,googleCalendarUrl,addDays,replaceNames,renameSpeakers,topicsToText,groupTasks} from './logic.mjs';
import {normalize,verifiedOwner,buildPrompt,speakersInText,checkAccess,detailLevel} from './api/_gemini.js';
const date='2026-10-24';
assert.equal(parseDueDate('10월 27일까지 전달',date),'2026-10-27');
assert.equal(parseDueDate('다음 주 수요일까지',date),'2026-10-28');
assert.equal(parseDueDate('모레까지',date),'2026-10-26');
assert.equal(parseDueDate('11월 1일에',date),'2026-11-01');
assert.equal(parseDueDate('다음 주에',date),'');
assert.equal(addDays('2026-12-31',1),'2027-01-01');
const sample=`기존 기본형은 유지하기로 결정했습니다.\n전소연 과장님은 10월 27일까지 콘텐츠 레퍼런스 5개를 정리해서 공유해 주세요.\n이진선 차장님은 다음 주 수요일까지 초안을 검토해 주세요.\n임다해 차장님은 10월 28일까지 리플릿 방향을 정리해 전달해 주세요.\n지금 문제는 메시지가 너무 길다는 점입니다.`;
const output=generateMinutes(sample,date,'임다해,이진선,전소연');
assert.equal(output.tasks.length,3);
assert.deepEqual(output.tasks.map(x=>x.owner),['전소연','이진선','임다해']);
assert.deepEqual(output.tasks.map(x=>x.due),['2026-10-27','2026-10-28','2026-10-28']);
assert.match(output.decisions,/유지하기로/);
assert.match(output.issues,/문제/);
const task=output.tasks[0];
const url=new URL(googleCalendarUrl(task,'콘텐츠 회의'));
assert.equal(url.hostname,'calendar.google.com');
assert.equal(url.searchParams.get('dates'),'20261027/20261028');
const calendar=asICS(output.tasks,'콘텐츠 회의');
assert.equal((calendar.match(/BEGIN:VEVENT/g)||[]).length,3);
assert.match(calendar,/END:VCALENDAR\r\n$/);
const md=asMarkdown({title:'콘텐츠 회의',date,participants:'세 명',...output});
assert.match(md,/## ■ 해야 할 일/);
assert.match(md,/전소연/);
// AI 응답 검증 (api/_gemini.js)
assert.equal(verifiedOwner('김민수','이벤트 경품 리스트는 제가 이번 주 금요일까지 정리하겠습니다.'),''); // 실제 테스트에서 AI가 지어낸 담당자
assert.equal(verifiedOwner('김민수','김민수 대리님은 다음 주 화요일까지 견적을 공유해 주세요.'),'김민수');
assert.equal(verifiedOwner('전소연','소연 과장 - 레퍼런스 5개 정리 10/27까지'),'전소연'); // 이름만 부른 경우
const ai=normalize({issues:['a',' ',3],topics:null,tasks:[{title:'견적 공유',owner:'김민수',due:'2026-13-45',evidence:'김민수 님 견적 공유'},{title:'',owner:'',due:'',evidence:''}]});
assert.deepEqual(ai.issues,['a']); // 빈 문자열·숫자는 버림
assert.deepEqual(ai.topics,[]);
assert.equal(ai.tasks.length,1);
assert.equal(ai.tasks[0].due,''); // 존재하지 않는 날짜는 버림
assert.match(buildPrompt({title:'t',date:'2026-10-22',participants:'',hasAudio:false}),/2026-10-27\(화\)/); // 날짜 참고표
// 화자 이름 바꾸기 (규칙 기반 찾아 바꾸기)
assert.equal(replaceNames('화자1: 네\n화자10: 아니요',{'화자1':'김민수'}),'김민수: 네\n화자10: 아니요'); // 화자10은 건드리지 않음
assert.equal(replaceNames('김민수: A / 박지현: B',{'김민수':'박지현','박지현':'김민수'}),'박지현: A / 김민수: B'); // 맞바꾸기
assert.equal(replaceNames('참석자 1: 좋아요',{'참석자 1':'최유나'}),'최유나: 좋아요');
const renamed=renameSpeakers({transcript:'화자2: 제가 할게요',summary:'',issues:'',speakers:['화자1','화자2'],tasks:[{title:'견적 받기',owner:'화자2',evidence:'화자2: 제가 할게요'}]},{'화자2':'김민수'});
assert.equal(renamed.tasks[0].owner,'김민수');
assert.deepEqual(renamed.speakers,['화자1','김민수']);
assert.equal(verifiedOwner('화자2','화자2: 제가 견적 받아볼게요'),'화자2'); // 화자 표시로 담당자 인정
assert.equal(verifiedOwner('참석자 1','참석자 1: 제가 정리할게요'),'참석자 1');
// 구조화된 회의록 (안건별 주요 내용 / 조직별 해야 할 일)
assert.equal(topicsToText([{title:'패키지',points:['1안 확정','색상 유지']},{title:'일정',points:['11/20 런칭']}]),'1. 패키지\n- 1안 확정\n- 색상 유지\n\n2. 일정\n- 11/20 런칭');
const grouped=groupTasks([{title:'a',team:'민트'},{title:'b',team:''},{title:'c',team:'한빛'},{title:'d',team:'민트'}]);
assert.deepEqual(grouped.map(([team,list])=>[team,list.map(t=>t.title)]),[['민트',['a','d']],['한빛',['c']],['',['b']]]); // 소속 없는 일은 맨 뒤
const md2=asMarkdown({title:'t',date,participants:'',summary:'1. 안건',issues:'',tasks:[{title:'후기 전달',team:'한빛',owner:'김세린',due:'2026-10-29',details:['10개 선별'],done:false}]});
assert.match(md2,/### 한빛\n1\. 후기 전달 — 담당: 김세린, 기한: 2026-10-29\n   - 10개 선별/);
const ai2=normalize({topics:[{title:'패키지',points:['1안 확정',' ']},{title:'',points:[]}],tasks:[{title:'후기 전달',details:['10개'],team:'한빛',owner:'김세린',due:'2026-10-29',evidence:'한빛: 김세린 대리가 후기 전달'}]});
assert.deepEqual(ai2.topics,[{title:'패키지',points:['1안 확정']}]);
assert.deepEqual(ai2.tasks[0].details,['10개']);assert.equal(ai2.tasks[0].team,'한빛');
// 화자 표시가 실제 원문에 있을 때만 인정 (참석자 목록을 화자로 착각하는 오류 방지)
const sp=[{label:'화자1',name:''},{label:'박준호',name:''},{label:'참석자 1',name:'김세린'}];
assert.deepEqual(speakersInText(sp,'화자1: 안녕하세요\n참석자 1 : 네').map(x=>x.label),['화자1','참석자 1']);
assert.deepEqual(speakersInText(sp,'참석: 박준호 팀장, 김세린 대리\n1. 패키지'),[]); // 화자 표시 없는 메모
// 회의록 양식 (사용자 샘플)
assert.match(buildPrompt({title:'t',date:'2026-10-22',participants:'',hasAudio:false,template:'■ 오늘 회의 주요 내용\n1. 안건'}),/\[회의록 샘플\]\n■ 오늘 회의 주요 내용/);
assert.match(buildPrompt({title:'t',date:'2026-10-22',participants:'',hasAudio:false}),/formatted: 빈 문자열/);
assert.equal(normalize({formatted:' ■ 주요 내용 '}).formatted,'■ 주요 내용');
// 회의록 분량 (간략 / 상세)
assert.match(buildPrompt({title:'t',date:'2026-10-22',participants:'',hasAudio:false,detail:'brief'}),/논의한 내용 → 그래서 할 일/);
assert.match(buildPrompt({title:'t',date:'2026-10-22',participants:'',hasAudio:false,detail:'detailed'}),/sections: 그 업무영역 안에서 논의된 세부 주제/);
assert.match(buildPrompt({title:'t',date:'2026-10-22',participants:'',hasAudio:false}),/세부 주제/); // 지정 안 하면 상세
assert.equal(detailLevel('weird'),'detailed');assert.equal(detailLevel('brief'),'brief');
const ai3=normalize({topics:[{title:'패키지',points:[],sections:[{title:'기본안 선정',points:['1안으로 확정',' ']},{title:'',points:[]}]},{title:'일정',points:['11/20 런칭'],sections:[]}]});
assert.deepEqual(ai3.topics,[{title:'패키지',points:[],sections:[{title:'기본안 선정',points:['1안으로 확정']}]},{title:'일정',points:['11/20 런칭']}]); // 빈 섹션은 버리고, 간략형은 sections 키 없음
assert.equal(topicsToText(ai3.topics),'[패키지]\n1. 기본안 선정\n- 1안으로 확정\n\n2. 일정\n- 11/20 런칭');
assert.equal(asMarkdown({templateUsed:true,summary:'■ 내 양식 회의록',tasks:[]}),'■ 내 양식 회의록\n'); // 내 양식이면 그대로 내보냄
// 접속 코드 (서버에 ACCESS_CODE가 있을 때만 검사)
const req=code=>new Request('http://x/api/minutes',{headers:code?{'x-access-code':code}:{}});
delete process.env.ACCESS_CODE;assert.doesNotThrow(()=>checkAccess(req('')));          // 코드 미설정 → 누구나
process.env.ACCESS_CODE='1234';
assert.throws(()=>checkAccess(req('')),/접속 코드가 필요/);
assert.throws(()=>checkAccess(req('9999')),/맞지 않/);
assert.doesNotThrow(()=>checkAccess(req('1234')));
delete process.env.ACCESS_CODE;
console.log('PASS: relative dates, owner extraction, decision/task separation, calendar URLs, ICS, Markdown, AI response validation, speaker rename, structured minutes, speaker label check, user template, access code');
