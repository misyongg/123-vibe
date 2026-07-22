const OpenAI = require('openai');
const { config } = require('./config');

let client = null;

function getClient() {
  if (!client) {
    if (!config.openaiApiKey) {
      const err = new Error('OPENAI_API_KEY가 설정되지 않았습니다.');
      err.status = 500;
      throw err;
    }
    client = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return client;
}

const SYSTEM_PROMPT = `당신은 학교 Wee센터 전문상담교사를 돕는 상담기록 작성 보조 AI입니다.

반드시 지킬 규칙:
1. 사용자가 입력한 키워드·메모만 바탕으로 작성한다. 추측하지 않는다.
2. 제공되지 않은 내용은 작성하지 않는다. 빈칸으로 두거나 해당 항목을 생략한다.
3. 상담자가 실제 수행한 활동만 기록한다.
4. 키워드를 자연스러운 문장으로 정리하되, 사실을 보태지 않는다.
5. 차회상담계획, 내담자 과제, 차회 상담목표, 차회활동, 유의사항, 준비물은 정보가 있을 때만 작성한다.
6. 이전 회기 본문이 주어지면 흐름을 이어 쓰되, 이전 내용을 그대로 복사하지 않는다.
7. 출력은 반드시 JSON 한 객체만. 설명문·마크다운 코드펜스 금지.

JSON 스키마:
{
  "journal": "상담일지 전체 텍스트",
  "memo": "상담자 메모 전체 텍스트"
}

상담일지 양식(항목 순서 유지):
회기 : …
사례번호 :
이름 :
성별 :

학교명 :
학년/반 :

대상 : (학생 / 보호자 / 교사)

일시 :
(YYYY.MM.DD.(요일) HH:MM~HH:MM, 소요시간 ○○분)

장소 :

내용

1. 내담자 관찰

2. 내담자 행동

3. 상담활동

4. 차회상담계획
(필요한 경우만 작성)

5. 내담자 과제
(필요한 경우만 작성)

6. 기타사항

상담자 메모 양식:
○회기

사례번호 :
이름 :
성별 :

학교명 :
학년/반 :

일시
YYYY.MM.DD.(요일) ○교시 또는 HH:MM~HH:MM (○○분)

상담내용

상담자 의견

차회일시
○회기
YYYY.MM.DD.(요일)

차회 상담목표

차회활동

유의사항

준비물

※ 차회 정보가 없으면 해당 항목은 생략 가능`;

function buildUserPrompt(ctx) {
  const lines = [
    '[메타데이터 — 사실로 사용]',
    `회기: ${ctx.sessionLabel || ''}`,
    `사례번호: ${ctx.caseNo || ''}`,
    `이름: ${ctx.name || ''}`,
    `성별: ${ctx.gender || ''}`,
    `학교명: ${ctx.school || ''}`,
    `학년/반: ${ctx.gradeClass || ''}`,
    `대상: ${ctx.target || '학생'}`,
    `일시: ${ctx.datetimeLabel || ''}`,
    `장소: ${ctx.place || ''}`,
    `일정 구분: ${ctx.category || ''}`,
    `유형: ${ctx.type || ''}`,
    '',
    '[상담자 키워드 메모]',
    ctx.keywords || '(없음)',
  ];

  if (ctx.extraInfo) {
    lines.push('', '[추가 정보]', ctx.extraInfo);
  }
  if (ctx.previousSummary) {
    lines.push('', '[이전 회기 참고 — 흐름만 이어쓰기]', ctx.previousSummary);
  }

  lines.push(
    '',
    '위 정보를 바탕으로 journal(상담일지)과 memo(상담자 메모)를 JSON으로 작성하세요.',
    '메타데이터에 값이 비어 있으면 해당 칸은 비워 두세요. 임의로 채우지 마세요.'
  );

  return lines.join('\n');
}

/**
 * 키워드 메모 → 상담일지 + 상담자 메모
 */
async function generateRecords(ctx) {
  const openai = getClient();
  const completion = await openai.chat.completions.create({
    model: config.openaiModel,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(ctx) },
    ],
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const err = new Error('OpenAI 응답을 JSON으로 파싱하지 못했습니다.');
    err.status = 502;
    err.body = { raw };
    throw err;
  }

  const journal = String(parsed.journal || '').trim();
  const memo = String(parsed.memo || '').trim();
  if (!journal || !memo) {
    const err = new Error('OpenAI 응답에 journal 또는 memo가 비어 있습니다.');
    err.status = 502;
    err.body = { raw: parsed };
    throw err;
  }

  return {
    journal,
    memo,
    model: config.openaiModel,
    usage: completion.usage || null,
  };
}

module.exports = { generateRecords };
