import { generateMinutes, asMarkdown, googleCalendarUrl, asICS, makeId, isoLocal, renameSpeakers, topicsToText, groupTasks } from './logic.mjs';
const STORAGE_KEY = 'meetmate-v1-2026';
const $=id=>document.getElementById(id);
// detail: 회의록 분량 ('brief' 간략 | 'detailed' 상세). detailUsed: 지금 보이는 회의록이 어느 분량으로 만들어졌는지.
// sourceMode: 회의 내용을 넣는 방법 ('audio' 녹음 파일 | 'text' 글). 둘 중 하나만 화면에 보인다.
const DEFAULT = () => ({title:'', date:isoLocal(new Date()),participants:'',transcript:'',summary:'',issues:'',tasks:[],speakers:[],generated:false,engine:'',model:'',templateUsed:false,detail:'detailed',detailUsed:'',sourceMode:'audio'});
const DETAIL_LABEL={brief:'간략',detailed:'상세'};
let state=DEFAULT();
try {const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(saved && typeof saved==='object'){state={...state,...saved,tasks:Array.isArray(saved.tasks)?saved.tasks:[]};}} catch(e){console.warn('복구 실패:',e);}
let currentFile=null,audioURL=null,stream=null,recorder=null,recordParts=[],loading=false,toastTimer=null,recordTimer=null;
// m4a·webm(바로 녹음 포함)은 브라우저가 WAV로 바꿔야 하는데, 긴 파일은 메모리를 너무 써서 40분까지만 바꾼다. mp3·wav는 바로 올라가 200MB까지.
const MAX_CONVERT_MIN=40;
const mmss=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const DEFAULT_STATUS='녹음은 Gemini로 보내 받아쓰고, 끝나면 바로 지웁니다.';
const LABELS={source:'회의 원문',minutes:'회의록',tasks:'할 일 목록'};
const SAMPLE=`10/24 한빛식품 브랜드 리뉴얼 2차 미팅 (우리: 민트스튜디오 / 클라이언트: 한빛식품)
참석: 민트 - 임다해, 전소연, 이진선 / 한빛 - 박준호 팀장, 김세린 대리

1. 패키지 디자인
- 1안(미니멀) 기본형으로 확정. 2안은 선물세트용 서브 버전으로만 유지
- 전면에 원재료 사진 넣는 건 한빛 쪽에서 반대 -> 일러스트로 대체. 이유: 기존 고객이 사진 보고 가공식품 느낌 받는다는 CS 피드백 있었음
- 후면 영양성분표 글자 크기 식약처 기준(최소 10pt?) 확인 필요. 세린 대리가 규정 확인해서 알려주기로
- 색상은 브랜드 그린 유지하되 명도만 10% 올리는 걸로

2. 온라인 상세페이지
- 상단 3초 안에 핵심 메시지 보여야 함. 지금 시안은 브랜드 스토리가 먼저 나와서 너무 김
- 구조: 핵심 혜택 -> 제품 특징 3개 -> 스토리 -> 후기 순으로 재배치
- 후기는 한빛에서 실제 고객 후기 10개 선별해서 전달 (10/29까지)
- 모바일 기준으로 먼저 만들고 PC는 그다음

3. 런칭 일정
- 11월 20일 목표. 패키지 인쇄 리드타임 2주라 11/5까지 최종 디자인 확정돼야 함
- 인쇄소 견적 아직 안 받음. 소연 과장이 두 군데 받아서 다음 주 수요일까지 공유
- 런칭 이벤트는 예산 미정이라 이번엔 논의 보류

할 일 정리
- 민트: 패키지 1안 수정본 10/31까지, 상세페이지 구조 재배치 시안 11/3까지 (진선 차장)
- 한빛: 고객 후기 10개 선별 10/29, 영양성분 표기 규정 확인, 서브 브랜드 로고 원본 파일 전달 부탁드림
- 다음 미팅 11/4(화) 오후 2시, 수정 시안 리뷰`;
const clean = x => String(x??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function save(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch(e){toast('저장 공간이 부족합니다. 원문을 내려받아 보관해 주세요.');}}
function toast(text){const el=$('toast');el.textContent=text;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4100);}
function syncForm(){
 $('meetingTitle').value=state.title; $('meetingDate').value=state.date; $('participants').value=state.participants; $('transcript').value=state.transcript;
 $('charCount').textContent=`${state.transcript.length.toLocaleString('ko-KR')}자`;
 $('summaryOutput').value=state.summary; $('issuesOutput').value=state.issues;
 updateMinutesHeader();updateTaskCounts();renderTasks();renderSpeakers();
 for(const b of document.querySelectorAll('#detailSeg button')){const on=b.dataset.detail===state.detail;b.classList.toggle('on',on);b.setAttribute('aria-checked',on);}
 for(const b of document.querySelectorAll('.source-switch button')){const on=b.dataset.source===state.sourceMode;b.classList.toggle('on',on);b.setAttribute('aria-selected',on);}
 for(const p of document.querySelectorAll('[data-source-panel]'))p.hidden=p.dataset.sourcePanel!==state.sourceMode;
 const used=DETAIL_LABEL[state.detailUsed]?`${DETAIL_LABEL[state.detailUsed]} · `:'';
 $('summaryHint').textContent=state.templateUsed?`${used}내 양식 · ${template.name||'붙여넣기'} · 직접 수정 가능`:`${used}안건별 · 직접 수정 가능`;
}
function updateMinutesHeader(){
 $('minutesTitle').textContent=state.generated?(state.title||'제목 없는 회의'):'아직 회의록이 없습니다';
 const ai=state.engine==='ai';
 $('minutesMeta').textContent=state.generated?`${state.date||'날짜 미정'} · 참석자: ${state.participants||'미입력'} · ${ai?`AI 작성${state.model?` (${state.model})`:''}`:'규칙 기반 추출'}`:'회의 원문 탭에서 내용을 넣고 정리 버튼을 누르세요.';
 $('minutesBadge').textContent=state.generated?(ai?'AI 작성 · 검토 필요':'규칙 기반 · 검토 필요'):'작성 전';$('minutesBadge').classList.toggle('ready',state.generated);
 $('minutesAlert').innerHTML=state.generated&&!ai
   ?'<strong>AI 연결 실패</strong><span>원문에서 문장만 골라냈습니다. 인터넷 연결이나 API 키를 확인하고 다시 정리해 보세요.</span>'
   :'<strong>AI 초안</strong><span>담당자와 날짜가 틀릴 수 있습니다. 할 일 목록에서 한 번 확인하세요.</span>';
 $('tasksOnMinutes').textContent=state.tasks.length;
}
function updateTaskCounts(){
 $('allCount').textContent=state.tasks.length;
 $('doneCount').textContent=state.tasks.filter(t=>t.done).length;
 $('undatedCount').textContent=state.tasks.filter(t=>!t.due).length;
 $('tasksOnMinutes').textContent=state.tasks.length;
}
function activate(tab){
 if(!LABELS[tab]) return;
 document.querySelectorAll('.nav-btn').forEach(x=>x.classList.toggle('selected',x.dataset.tab===tab));
 document.querySelectorAll('.step').forEach(x=>x.classList.toggle('step-on',x.dataset.tab===tab));
 document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===`panel-${tab}`));
 $('activeBreadcrumb').textContent=LABELS[tab];
 window.scrollTo({top:0,behavior:'smooth'});
}
function renderSpeakers(){
 const list=state.speakers||[];
 $('speakerPanel').hidden=!list.length;
 $('speakerInputs').innerHTML=list.map(name=>`<label class="speaker-chip"><span>${clean(name)}</span>→<input data-old="${clean(name)}" value="${clean(name)}" maxlength="20" aria-label="${clean(name)}의 이름" /></label>`).join('');
}
function applySpeakerNames(){
 const map={};
 for(const input of $('speakerInputs').querySelectorAll('input')){const v=input.value.trim();if(v&&v!==input.dataset.old)map[input.dataset.old]=v;}
 if(!Object.keys(map).length){toast('바뀐 이름이 없어요.');return;}
 state=renameSpeakers(state,map);save();syncForm();
 toast(`화자 이름 ${Object.keys(map).length}개를 원문·회의록·할 일에 반영했어요.`);
}
function taskCard(t){
 return `<article class="task-card ${t.done?'done':''}" data-id="${clean(t.id)}">
   <div class="task-top"><input class="task-check" data-field="done" type="checkbox" ${t.done?'checked':''} aria-label="할 일 완료 체크" />
   <input class="task-title" data-field="title" value="${clean(t.title)}" aria-label="할 일 제목" maxlength="250" />
   <button class="delete-task" data-action="remove" title="할 일 삭제" aria-label="할 일 삭제">×</button></div>
   <div class="task-fields"><label>담당자 <input data-field="owner" type="text" value="${clean(t.owner)}" placeholder="미정" maxlength="30" /></label>
   <label>소속 <input data-field="team" type="text" value="${clean(t.team||'')}" placeholder="팀/조직 (선택)" maxlength="30" /></label>
   <label>마감일 <input data-field="due" type="date" value="${clean(t.due)}" /></label></div>
   <textarea class="task-details" data-field="details" rows="${Math.max(1,(t.details||[]).length)}" placeholder="세부 사항 (한 줄에 하나)" aria-label="세부 사항">${clean((t.details||[]).join('\n'))}</textarea>
   ${t.evidence?`<div class="task-evidence">원문 근거 · ${clean(t.evidence)}</div>`:`<div class="task-evidence">직접 추가한 할 일</div>`}
   <div class="task-bottom"><button data-action="calendar" class="calendar-link ${t.due?'':'disabled'}" ${t.due?'':'title="마감일을 먼저 선택해 주세요"'}>구글 캘린더에 등록 ↗</button></div>
   </article>`;
}
function renderTasks(){
 const filter=$('taskFilter').value;
 const items=state.tasks.filter(t=>filter==='all'||(filter==='done'?t.done:!t.done));
 const root=$('taskList');
 renderTaskPreview();
 if(items.length===0){root.innerHTML=`<div class="empty">${state.tasks.length?'조건에 맞는 할 일이 없습니다.':'아직 할 일이 없어요. 회의록을 정리하거나 직접 추가하세요.'}</div>`;return;}
 const groups=groupTasks(items);
 // Team headers only when the meeting had more than one side (e.g. agency / client).
 root.innerHTML=groups.map(([team,list])=>(groups.length>1?`<h4 class="task-group">${team?clean(team):'소속 미지정'} <span>${list.length}</span></h4>`:'')+list.map(taskCard).join('')).join('');
}
function renderTaskPreview(){
 const groups=groupTasks(state.tasks);
 $('taskPreview').innerHTML=state.tasks.length
   ?groups.map(([team,list])=>(team?`<h4>${clean(team)}</h4>`:'')+`<ol>${list.map(t=>`<li class="${t.done?'done':''}"><span>${clean(t.title)}</span><small>${clean(t.owner||'담당 미정')}${t.due?' · '+clean(t.due):''}</small>${(t.details||[]).length?`<ul>${t.details.map(d=>`<li>${clean(d)}</li>`).join('')}</ul>`:''}</li>`).join('')}</ol>`).join('')
   :'<p class="task-preview-empty">찾은 할 일이 없어요. 할 일 목록에서 직접 추가할 수 있어요.</p>';
}
function download(filename,text,mime='text/plain;charset=utf-8'){
 const blob=new Blob([text],{type:mime});const url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function fileSafe(s){return String(s||'회의록').trim().replace(/[\\/:*?"<>|]/g,'_').slice(0,50);}
const bullets=arr=>arr.map(x=>`• ${x}`).join('\n');
// Every API call carries the access code (if the server asks for one). On 401 we ask the user once and retry.
const ACCESS_KEY='meetmate-access';
let accessCode='';try{accessCode=localStorage.getItem(ACCESS_KEY)||'';}catch{/* ignore */}
function askAccessCode(message){
 return new Promise(resolve=>{
   const dlg=$('accessDialog');$('accessMessage').textContent=message||'이 앱은 접속 코드가 있어야 AI 기능을 쓸 수 있어요.';$('accessInput').value='';
   const done=()=>{dlg.removeEventListener('close',done);resolve(dlg.returnValue==='ok'?$('accessInput').value.trim():'');};
   dlg.addEventListener('close',done);dlg.showModal();$('accessInput').focus();
 });
}
async function apiFetch(url,init,retry=true){
 const headers={...(init.headers||{}),...(accessCode?{'x-access-code':accessCode}:{})};
 const res=await fetch(url,{...init,headers});
 if(res.status===401&&retry){
   let msg='';try{msg=(await res.json()).error;}catch{/* ignore */}
   const code=await askAccessCode(msg);
   if(!code)throw new Error('접속 코드를 입력하지 않았어요.');
   accessCode=code;try{localStorage.setItem(ACCESS_KEY,code);}catch{/* ignore */}
   return apiFetch(url,init,false);
 }
 return res;
}
async function callMinutesApi(payload){
 const res=await apiFetch('/api/minutes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:state.title,date:state.date,participants:state.participants,template:template.text,detail:state.detail,...payload})});
 let data={};try{data=await res.json();}catch{/* non-JSON (e.g. static hosting without /api) */}
 if(!res.ok)throw new Error(data.error||`서버 응답 오류 (${res.status})`);
 return data;
}
function applyAiResult(r){
 if(r.transcript)state.transcript=r.transcript;
 // With a user template the AI writes the whole document in that format; otherwise use the recommended layout.
 if(template.text&&r.formatted){state.summary=r.formatted;state.templateUsed=true;}else{state.summary=topicsToText(r.topics);state.templateUsed=false;}
 state.detailUsed=state.detail;
 state.issues=bullets(r.issues)+(r.nextMeeting?`${r.issues.length?'\n\n':''}▸ 다음 회의: ${r.nextMeeting}`:'');
 state.tasks=r.tasks.map(t=>({id:makeId(),done:false,details:[],team:'',...t}));
 // AI writes speaker labels (화자1…); swap in the names it could identify from the conversation.
 const speakers=r.speakers||[];state.speakers=speakers.map(x=>x.label);
 // "지현:" → 참석자 목록의 "박지현"처럼, 이름 일부만 적힌 화자 표시는 전체 이름으로 채운다.
 const names=state.participants.split(/[,、;\n/]+/).map(x=>x.trim().match(/^[가-힣]{2,4}/)?.[0]).filter(Boolean);
 for(const sp of speakers){if(!sp.name){const full=names.find(n=>n!==sp.label&&n.endsWith(sp.label)&&sp.label.length>=2);if(full)sp.name=full;}}
 // Two different voices can't be the same person. If the AI gave one name to several speakers, leave them unnamed for the user to fix.
 const nameCount={};for(const sp of speakers)if(sp.name)nameCount[sp.name]=(nameCount[sp.name]||0)+1;
 for(const sp of speakers)if(sp.name&&nameCount[sp.name]>1&&sp.label!==sp.name)sp.name='';
 state=renameSpeakers(state,Object.fromEntries(speakers.filter(x=>x.name).map(x=>[x.label,x.name])));
 state.generated=true;state.engine='ai';state.model=r.model||'';save();syncForm();activate('minutes');
 const unnamed=speakers.filter(x=>!x.name).length;
 toast(`AI가 회의록을 작성하고 할 일 ${r.tasks.length}개를 찾았어요.${unnamed?` 이름을 모르는 화자 ${unnamed}명은 [화자 이름]에서 채워 주세요.`:' 담당자와 기한을 확인해 주세요.'}`);
}
function applyRuleResult(reason){
 const output=generateMinutes(state.transcript,state.date,state.participants);
 state.summary=`주요 논의\n${output.summary}`+(output.decisions?`\n\n결정 사항\n${output.decisions}`:'');state.issues=output.issues;state.tasks=output.tasks;state.speakers=[];state.templateUsed=false;
 state.generated=true;state.engine='rules';state.model='';save();syncForm();activate('minutes');
 toast(`AI에 연결하지 못해 규칙으로만 정리했어요. 할 일 ${output.tasks.length}개. (${reason})`);
}
async function generate(){
 if(loading)return;
 if(!state.transcript.trim()){toast('먼저 회의 원문을 입력해 주세요.');$('transcript').focus();return;}
 if(state.generated && !window.confirm('다시 정리하면 직접 고친 회의록과 할 일이 사라집니다. 계속할까요?'))return;
 setBusy(true,'generate');
 try{applyAiResult(await callMinutesApi({text:state.transcript}));}
 catch(e){console.warn(e);applyRuleResult(e.message);}
 finally{setBusy(false);}
}
function setStatus(message,type=''){const el=$('transcribeStatus');el.textContent=message;el.classList.remove('ok','error');if(type)el.classList.add(type);}
const MAX_UPLOAD_MB=200; // 서버(api/upload.js)의 한도와 같다
function notice(title,text){$('noticeTitle').textContent=title;$('noticeText').textContent=text;$('noticeDialog').showModal();}
function setAudioFile(file){
 const mb=file.size/1024/1024;
 if(mb>MAX_UPLOAD_MB){notice('파일이 너무 큽니다',`${Math.round(mb)}MB 파일은 올릴 수 없어요 (${MAX_UPLOAD_MB}MB까지). 휴대폰이나 PC에서 mp3로 변환하면 보통 크기가 훨씬 줄어듭니다.`);return;}
 if(audioURL)URL.revokeObjectURL(audioURL);currentFile=file;audioURL=URL.createObjectURL(file);
 $('fileLabel').textContent=`선택됨 · ${file.name} (${(file.size/1024/1024).toFixed(1)}MB)`;
 $('audioPlayer').src=audioURL;$('audioPreview').hidden=false;$('transcribeBtn').disabled=false;
 setStatus('파일 준비됐어요. [AI로 회의록 만들기]를 누르세요.');
 if(file.size>60*1024*1024)toast('파일이 커서 변환에 시간이 걸릴 수 있어요.');
 // 길이를 미리 재서, 변환이 필요한 형식이 40분을 넘으면 기다리게 하지 않고 바로 알린다.
 $('audioPlayer').onloadedmetadata=()=>{
   const min=$('audioPlayer').duration/60;if(!Number.isFinite(min))return;
   if(!directMime(file)&&min>MAX_CONVERT_MIN){
     $('transcribeBtn').disabled=true;setStatus(`이 파일은 ${Math.round(min)}분이라 처리할 수 없어요.`,'error');
     notice('녹음이 너무 깁니다',`${Math.round(min)}분짜리 ${file.name.split('.').pop()} 파일은 처리할 수 없어요. m4a·webm 형식은 ${MAX_CONVERT_MIN}분까지만 됩니다. mp3로 변환해서 올리거나(mp3는 길이 제한 없이 ${MAX_UPLOAD_MB}MB까지) ${MAX_CONVERT_MIN}분 이하로 나눠 주세요.`);
   }
   else setStatus(`파일 준비됐어요 (${mmss($('audioPlayer').duration)}). [AI로 회의록 만들기]를 누르세요.`);
 };
}
function setBusy(b,what='audio'){
 loading=b;$('transcribeBtn').disabled=b||!currentFile;$('recordBtn').disabled=b;$('generateBtn').disabled=b;$('audioFile').disabled=b;$('demoBtn').disabled=b;
 $('transcribeBtn').innerHTML=b&&what==='audio'?'AI가 듣는 중…':'AI로 회의록 만들기 <span>→</span>';
 $('generateBtn').innerHTML=b&&what==='generate'?'AI가 회의록 작성 중…':'AI로 회의록 · 할 일 정리 <span>↗</span>';
}
// Formats Gemini accepts as-is. Others (m4a, webm from browser recording…) are converted to 16kHz mono WAV.
const DIRECT_TYPES={mp3:'audio/mp3',mpeg:'audio/mp3',wav:'audio/wav','x-wav':'audio/wav',aac:'audio/aac',ogg:'audio/ogg',flac:'audio/flac',aiff:'audio/aiff'};
function directMime(file){
 const sub=(file.type.split('/')[1]||'').split(';')[0]||file.name.split('.').pop().toLowerCase();
 return DIRECT_TYPES[sub]||'';
}
async function toWav16k(file){
 const ctx=new (window.AudioContext||window.webkitAudioContext)();
 try{
   const decoded=await ctx.decodeAudioData(await file.arrayBuffer());
   if(decoded.duration>40*60)throw new Error('이 형식은 40분 이내만 변환할 수 있어요. mp3로 저장하거나 나누어 올려 주세요.');
   const offline=new OfflineAudioContext(1,Math.max(1,Math.ceil(decoded.duration*16000)),16000);
   const src=offline.createBufferSource();src.buffer=decoded;src.connect(offline.destination);src.start(0);
   const pcm=(await offline.startRendering()).getChannelData(0);
   const view=new DataView(new ArrayBuffer(44+pcm.length*2));
   const text=(o,s)=>[...s].forEach((c,i)=>view.setUint8(o+i,c.charCodeAt(0)));
   text(0,'RIFF');view.setUint32(4,36+pcm.length*2,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
   view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,pcm.length*2,true);
   for(let i=0;i<pcm.length;i++)view.setInt16(44+i*2,Math.max(-1,Math.min(1,pcm[i]))*0x7fff,true);
   return new Blob([view],{type:'audio/wav'});
 }finally{await ctx.close();}
}
// 1) our server opens an upload session with the secret API key, 2) the browser sends the file straight to Google.
async function uploadAudio(blob,mimeType,name){
 const start=await apiFetch('/api/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({size:blob.size,mimeType,name})});
 const {uploadUrl,error}=await start.json().catch(()=>({error:`서버 응답 오류 (${start.status})`}));
 if(!start.ok)throw new Error(error);
 return new Promise((resolve,reject)=>{
   const xhr=new XMLHttpRequest(); // unlike fetch, XHR reports upload progress
   xhr.open('POST',uploadUrl);
   xhr.setRequestHeader('X-Goog-Upload-Command','upload, finalize');
   xhr.setRequestHeader('X-Goog-Upload-Offset','0');
   xhr.upload.onprogress=e=>{if(e.lengthComputable)setStatus(`녹음 파일 업로드 중… ${Math.round(e.loaded/e.total*100)}%`);};
   xhr.onload=()=>{
     try{const file=JSON.parse(xhr.responseText).file;if(xhr.status===200&&file?.name)return resolve(file);}catch{/* fall through */}
     reject(new Error(`업로드 실패 (${xhr.status})`));
   };
   xhr.onerror=()=>reject(new Error('업로드 중 네트워크 오류가 발생했어요.'));
   xhr.send(blob);
 });
}
async function transcribe(){
 if(!currentFile||loading)return;
 if(state.transcript.trim()&&!window.confirm('녹음으로 회의록을 만들면 현재 원문과 정리 결과가 바뀝니다. 계속할까요?'))return;
 setBusy(true);
 try{
   let blob=currentFile,mime=directMime(currentFile);
   if(!mime){setStatus('녹음을 WAV 형식으로 바꾸는 중…');blob=await toWav16k(currentFile);mime='audio/wav';}
   const file=await uploadAudio(blob,mime,currentFile.name);
   const mb=blob.size/1024/1024;
   setStatus(`AI가 녹음을 듣고 있어요. ${mb<10?'30초':'1~3분'}쯤 걸립니다. 창을 닫지 마세요.`);
   const result=await callMinutesApi({fileName:file.name});
   state.sourceMode='text'; // 받아쓴 글이 원문 칸에 들어가므로, 돌아오면 그 글이 보이게 한다.
   applyAiResult(result);
   setStatus('다 됐어요. 받아쓴 내용은 [글로 넣기]의 회의 원문에서 고칠 수 있어요.','ok');
 }catch(e){console.error(e);setStatus(`실패: ${e?.message||String(e)} 텍스트를 직접 붙여 넣어도 정리할 수 있어요.`,'error');toast('녹음을 처리하지 못했어요. 위 안내를 확인하세요.');}
 finally{setBusy(false);}
}
async function toggleRecording(){
 if(recorder&&recorder.state==='recording'){stopRecording();return;}
 if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast('이 브라우저는 녹음 기능을 지원하지 않아요. HTTPS 또는 localhost에서 확인해 주세요.');return;}
 try{
   stream=await navigator.mediaDevices.getUserMedia({audio:true});
   const type=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(x=>MediaRecorder.isTypeSupported(x))||'';
   recorder=new MediaRecorder(stream,type?{mimeType:type}:{});recordParts=[];
   recorder.ondataavailable=e=>{if(e.data.size)recordParts.push(e.data)};
   recorder.onstop=()=>{const blob=new Blob(recordParts,{type:recorder.mimeType||'audio/webm'});const ext=blob.type.includes('mp4')?'m4a':'webm';
     setAudioFile(new File([blob],`직접녹음-${Date.now()}.${ext}`,{type:blob.type}));
     stream?.getTracks().forEach(t=>t.stop());stream=null;transcribe();}; // start AI processing right away
   recorder.start();$('recordBtn').classList.add('recording');setStatus(`녹음 중입니다. 타일을 다시 누르면 끝나고 AI가 바로 회의록을 만들어요. 최대 ${MAX_CONVERT_MIN}분이며, 시간이 되면 자동으로 마칩니다.`);
   // 경과 시간 표시. 40분이 되면 자동으로 마쳐서 녹음을 잃지 않게 한다 (더 길면 변환이 안 됨).
   const started=Date.now();let warned=false;
   $('recordLabel').textContent=`녹음 중 00:00 / ${MAX_CONVERT_MIN}:00 · 누르면 종료`;
   recordTimer=setInterval(()=>{
     const sec=(Date.now()-started)/1000;
     $('recordLabel').textContent=`녹음 중 ${mmss(sec)} / ${MAX_CONVERT_MIN}:00 · 누르면 종료`;
     if(!warned&&sec>=(MAX_CONVERT_MIN-5)*60){warned=true;setStatus(`5분 뒤(${MAX_CONVERT_MIN}분) 녹음이 자동으로 끝납니다. 더 긴 회의는 휴대폰 녹음 앱으로 mp3로 저장해 올려 주세요.`);}
     if(sec>=MAX_CONVERT_MIN*60){stopRecording();toast(`${MAX_CONVERT_MIN}분이 되어 녹음을 자동으로 마쳤어요. 이어서 회의록을 만듭니다.`);}
   },1000);
 }catch(e){stream?.getTracks().forEach(t=>t.stop());stream=null;setStatus('마이크를 쓸 수 없어요. 브라우저 권한을 확인하거나 녹음 파일을 올려 주세요.','error');}
}
function stopRecording(){
 clearInterval(recordTimer);recordTimer=null;
 if(recorder&&recorder.state==='recording')recorder.stop();
 $('recordLabel').textContent='바로 녹음하기';$('recordBtn').classList.remove('recording');
}
function setSample(){
 if(state.transcript.trim()&&!window.confirm('예시 회의를 불러오면 현재 원문과 정리 결과가 바뀝니다. 계속할까요?'))return;
 state={...DEFAULT(),detail:state.detail,sourceMode:'text',title:'한빛식품 브랜드 리뉴얼 2차 미팅 (예시)',date:'2026-10-24',participants:'임다해, 전소연, 이진선, 박준호, 김세린',transcript:SAMPLE};
 save();syncForm();toast('예시 회의를 불러왔어요. [AI로 회의록 · 할 일 정리]를 눌러 보세요.');
}
function reset(){
 if(recorder?.state==='recording'){recorder.onstop=null;stopRecording();}
 if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
 if(audioURL)URL.revokeObjectURL(audioURL);
 audioURL=null;currentFile=null;$('audioFile').value='';$('fileLabel').textContent='녹음 파일 올리기';$('audioPreview').hidden=true;
 $('transcribeBtn').disabled=true;state={...DEFAULT(),detail:state.detail};save();syncForm();activate('source');setStatus(DEFAULT_STATUS);toast('전부 지웠어요.');
}
$('detailSeg').addEventListener('click',e=>{
 const b=e.target.closest('button[data-detail]');if(!b||b.dataset.detail===state.detail)return;
 state.detail=b.dataset.detail;save();syncForm();
 toast(state.detail==='detailed'?'상세 버전: 논의 흐름과 의견 근거, 결론까지. 회의에 없던 사람도 읽을 수 있게 정리해요.':'간략 버전: 안건별로 "논의 → 그래서 할 일"을 한 줄씩 정리해요.');
});
// UI events
for(const btn of document.querySelectorAll('[data-tab]'))btn.addEventListener('click',e=>{e.preventDefault();activate(btn.dataset.tab)});
for(const [id,key] of [['meetingTitle','title'],['meetingDate','date'],['participants','participants'],['transcript','transcript'],['summaryOutput','summary'],['issuesOutput','issues']]){
 $(id).addEventListener('input',e=>{
   state[key]=e.target.value;if(key==='transcript'){$('charCount').textContent=`${state.transcript.length.toLocaleString('ko-KR')}자`;/* Leave generated notes until user regenerates */}
   save();if(key==='title'||key==='date'||key==='participants')updateMinutesHeader();
 });
}
$('demoBtn').addEventListener('click',setSample);
document.querySelector('.source-switch').addEventListener('click',e=>{
 const b=e.target.closest('button[data-source]');if(!b||b.dataset.source===state.sourceMode)return;
 state.sourceMode=b.dataset.source;save();syncForm();
});
$('applySpeakers').addEventListener('click',applySpeakerNames);
$('generateBtn').addEventListener('click',generate);
$('goTasksBtn').addEventListener('click',()=>activate('tasks'));
$('goTasksBig').addEventListener('click',()=>activate('tasks'));
$('backToMinutes').addEventListener('click',()=>{save();renderTaskPreview();activate('minutes');toast('할 일을 저장했어요.');});
$('audioFile').addEventListener('change',e=>{const f=e.target.files?.[0];if(f)setAudioFile(f)});
for(const evt of ['dragenter','dragover'])$('dropZone').addEventListener(evt,e=>{e.preventDefault();$('dropZone').classList.add('dragging')});
for(const evt of ['dragleave','drop'])$('dropZone').addEventListener(evt,e=>{e.preventDefault();$('dropZone').classList.remove('dragging')});
$('dropZone').addEventListener('drop',e=>{const f=e.dataTransfer.files?.[0];if(f){if(!(f.type.startsWith('audio/')||/\.(mp3|wav|m4a|webm|ogg|flac)$/i.test(f.name))){toast('오디오 파일을 선택해 주세요.');return;}setAudioFile(f);}});
$('transcribeBtn').addEventListener('click',transcribe);
$('recordBtn').addEventListener('click',toggleRecording);
$('exportMarkdown').addEventListener('click',()=>download(`${fileSafe(state.title)}.md`,asMarkdown(state),'text/markdown;charset=utf-8'));
$('addTask').addEventListener('click',()=>{
 state.tasks.unshift({id:makeId(),title:'새 할 일',details:[],team:'',owner:'',due:'',done:false,evidence:''});save();renderTasks();updateTaskCounts();toast('할 일을 추가했어요. 제목과 담당자, 마감일을 채워 주세요.');
});
$('taskFilter').addEventListener('change',renderTasks);
$('taskList').addEventListener('input',e=>{
 const field=e.target.dataset.field;if(!field||field==='done')return;
 const card=e.target.closest('.task-card');const task=state.tasks.find(t=>t.id===card?.dataset.id);if(!task)return;
 task[field]=field==='details'?e.target.value.split('\n').map(x=>x.trim()).filter(Boolean):e.target.value;
 save();if(field==='due')updateTaskCounts();renderTaskPreview();
});
$('taskList').addEventListener('change',e=>{
 const field=e.target.dataset.field;
 const card=e.target.closest('.task-card');const task=state.tasks.find(t=>t.id===card?.dataset.id);if(!task)return;
 if(field==='done'){task.done=e.target.checked;save();updateTaskCounts();renderTasks();}
 if(field==='due'){task.due=e.target.value;save();updateTaskCounts();renderTasks();}
});
$('taskList').addEventListener('click',e=>{
 const btn=e.target.closest('button[data-action]');if(!btn)return;
 const id=btn.closest('.task-card')?.dataset.id;const task=state.tasks.find(t=>t.id===id);if(!task)return;
 if(btn.dataset.action==='remove'){state.tasks=state.tasks.filter(t=>t.id!==id);save();renderTasks();updateTaskCounts();toast('할 일을 삭제했어요.');}
 if(btn.dataset.action==='calendar'){
   if(!task.due){toast('마감일을 먼저 선택해 주세요.');return;}
   const url=googleCalendarUrl(task,state.title);window.open(url,'_blank','noopener,noreferrer');
   toast('구글 캘린더 등록 화면을 열었어요. 거기서 저장을 눌러야 등록됩니다.');
 }
});
$('exportICS').addEventListener('click',()=>{
 const dated=state.tasks.filter(t=>t.due);if(!dated.length){toast('마감일이 정해진 할 일이 없습니다.');return;}
 download(`${fileSafe(state.title)}-일정.ics`,asICS(state.tasks,state.title),'text/calendar;charset=utf-8');
 toast(`마감일 있는 할 일 ${dated.length}개를 .ics 파일로 내려받았어요.`);
});
$('exportTasks').addEventListener('click',()=>{
 const txt=`${state.title||'회의'} / 해야 할 일\n\n`+groupTasks(state.tasks).map(([team,list])=>(team?`■ ${team}\n\n`:'')+list.map((t,i)=>`${i+1}. [${t.done?'완료':'진행'}] ${t.title}\n   담당: ${t.owner||'미정'} | 마감: ${t.due||'미정'}${(t.details||[]).map(d=>`\n   - ${d}`).join('')}\n   원문: ${t.evidence||'직접 추가'}\n`).join('\n')).join('\n');
 download(`${fileSafe(state.title)}-할일.txt`,txt);
});
$('resetBtn').addEventListener('click',()=>{$('confirmDialog').showModal()});
$('confirmDialog').addEventListener('close',()=>{if($('confirmDialog').returnValue==='yes')reset();});
// ---- 회의록 양식 (사용자 샘플 or 추천 양식). state와 별도로 저장해서 '전부 지우기'에도 남는다.
const TEMPLATE_KEY='meetmate-template';
let template={name:'',text:'',decided:false};
try{const t=JSON.parse(localStorage.getItem(TEMPLATE_KEY)||'null');if(t&&typeof t==='object')template={...template,...t};}catch{/* ignore */}
function saveTemplate(){try{localStorage.setItem(TEMPLATE_KEY,JSON.stringify(template));}catch{/* ignore */}}
function renderTemplate(){$('templateName').textContent=template.text?`내 양식 · ${template.name||'붙여넣기'}`:'추천 양식';}
function openTemplateDialog(){
 $('templateText').value=template.text||'';$('templateFileLabel').textContent=template.name?`선택됨 · ${template.name}`:'파일 선택 또는 끌어다 놓기';
 $('useTemplate').disabled=!template.text;$('templateDialog').showModal();
}
function loadScript(src){return new Promise((ok,fail)=>{if(document.querySelector(`script[src="${src}"]`))return ok();const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>fail(new Error('라이브러리를 불러오지 못했어요.'));document.head.appendChild(s);});}
async function readTemplateFile(file){
 if(/\.docx$/i.test(file.name)){
   // .docx is a zip; the text lives in word/document.xml. Paragraph ends become line breaks.
   await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
   const zip=await window.JSZip.loadAsync(file);const xml=await zip.file('word/document.xml')?.async('string');
   if(!xml)throw new Error('docx 안에서 본문을 찾지 못했어요.');
   return xml.replace(/<w:tab\/>/g,'\t').replace(/<\/w:p>/g,'\n').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
 }
 if(/\.(txt|md|markdown)$/i.test(file.name)||file.type.startsWith('text/'))return file.text();
 throw new Error('txt, md, docx 파일만 읽을 수 있어요.');
}
async function setTemplateFile(file){
 try{
   let text=(await readTemplateFile(file)).replace(/\r/g,'').trim();
   if(!text)throw new Error('파일에 글자가 없어요.');
   if(text.length>8000){text=text.slice(0,8000);toast('샘플이 길어서 앞 8,000자만 사용해요.');}
   template.name=file.name;$('templateText').value=text;$('templateFileLabel').textContent=`선택됨 · ${file.name}`;$('useTemplate').disabled=false;
 }catch(e){toast(e.message);}
}
$('templateFile').addEventListener('change',e=>{const f=e.target.files?.[0];if(f)setTemplateFile(f);});
for(const evt of ['dragenter','dragover'])document.querySelector('.tpl-drop').addEventListener(evt,e=>{e.preventDefault();e.currentTarget.classList.add('dragging');});
for(const evt of ['dragleave','drop'])document.querySelector('.tpl-drop').addEventListener(evt,e=>{e.preventDefault();e.currentTarget.classList.remove('dragging');});
document.querySelector('.tpl-drop').addEventListener('drop',e=>{const f=e.dataTransfer.files?.[0];if(f)setTemplateFile(f);});
$('templateText').addEventListener('input',e=>{$('useTemplate').disabled=!e.target.value.trim();if(template.name&&e.target.value.trim()!==template.text)template.name='';});
$('useTemplate').addEventListener('click',()=>{
 const text=$('templateText').value.trim();if(!text)return;
 template={name:template.name,text:text.slice(0,8000),decided:true};saveTemplate();renderTemplate();$('templateDialog').close();
 toast('이제 회의록을 이 양식으로 써요. 다음에 정리할 때부터 적용됩니다.');
});
$('useDefaultTemplate').addEventListener('click',()=>{template={name:'',text:'',decided:true};saveTemplate();renderTemplate();$('templateDialog').close();});
$('changeTemplate').addEventListener('click',openTemplateDialog);
renderTemplate();
syncForm();
if(!template.decided)openTemplateDialog();
