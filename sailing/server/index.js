const express = require('express');
const cors = require('cors');
const path = require('path');
const { config, missingKeys } = require('./config');
const notion = require('./notion');
const { generateRecords } = require('./openai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function asyncHandler(fn) {
  return (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || String(err);
      console.error('[error]', message, err.body || err);
      res.status(status).json({ ok: false, error: message, details: err.body || undefined });
    });
  };
}

app.get('/api/health', (req, res) => {
  const missing = missingKeys();
  res.json({
    ok: missing.length === 0,
    missing,
    version: '1.0.0',
    name: 'Wee센터 상담기록 자동화 시스템',
  });
});

app.get('/api/notion/test', asyncHandler(async (req, res) => {
  const result = await notion.testConnection();
  res.json(result);
}));

/** 오늘(또는 ?date=YYYY-MM-DD) 상담 예약 목록 */
app.get('/api/schedules', asyncHandler(async (req, res) => {
  const data = await notion.getSchedulesForDate(req.query.date);
  res.json({ ok: true, ...data });
}));

/** 학생 검색 */
app.get('/api/students', asyncHandler(async (req, res) => {
  const students = await notion.searchStudents(req.query.q || '');
  res.json({ ok: true, students });
}));

/**
 * 선택한 예약에 대한 컨텍스트
 * — 이전 회기, 회기번호, 본문 요약
 */
app.get('/api/sessions/:pageId/context', asyncHandler(async (req, res) => {
  const pageId = req.params.pageId;
  const current = await notion.getPageById(pageId);
  if (!current) {
    return res.status(404).json({ ok: false, error: '예약을 파싱할 수 없습니다.' });
  }

  const previous = await notion.getPreviousSessions({
    caseNo: current.caseNo,
    title: current.title,
    beforeISO: current.startISO,
    excludePageId: pageId,
  });

  const sessionNumber = await notion.estimateSessionNumber(previous);

  let previousSummary = '';
  if (previous[0]) {
    try {
      const text = await notion.getPagePlainText(previous[0].pageId);
      previousSummary = text.slice(0, 3500);
    } catch {
      previousSummary = '';
    }
  }

  res.json({
    ok: true,
    current,
    sessionNumber,
    sessionLabel: `${sessionNumber}회기`,
    previousCount: previous.length,
    previous: previous.slice(0, 5).map((s) => ({
      pageId: s.pageId,
      title: s.title,
      dateLabel: s.dateLabel,
      timeRangeLabel: s.timeRangeLabel,
      category: s.category,
      url: s.url,
    })),
    previousSummary,
  });
}));

/**
 * 미리보기: AI만 실행, 노션 업데이트 없음
 * body: { pageId, keywords, extras? }
 */
app.post('/api/preview', asyncHandler(async (req, res) => {
  const payload = await buildGenerationContext(req.body);
  const generated = await generateRecords(payload.ctx);
  res.json({
    ok: true,
    ...payload.meta,
    journal: generated.journal,
    memo: generated.memo,
    model: generated.model,
  });
}));

/**
 * 저장: AI 생성 → 기존 예약 페이지 본문 업데이트
 * body: { pageId, keywords, extras?, journal?, memo? }
 * journal/memo가 있으면 AI 재호출 없이 그대로 저장 (미리보기 수정본)
 */
app.post('/api/save', asyncHandler(async (req, res) => {
  const { pageId, journal: givenJournal, memo: givenMemo } = req.body || {};
  if (!pageId) {
    return res.status(400).json({ ok: false, error: 'pageId가 필요합니다.' });
  }

  let journal = (givenJournal || '').trim();
  let memo = (givenMemo || '').trim();
  let meta = {};

  if (!journal || !memo) {
    const payload = await buildGenerationContext(req.body);
    meta = payload.meta;
    const generated = await generateRecords(payload.ctx);
    journal = journal || generated.journal;
    memo = memo || generated.memo;
  } else {
    const payload = await buildGenerationContext(req.body);
    meta = payload.meta;
  }

  const updated = await notion.updateReservationPage(pageId, {
    journalText: journal,
    memoText: memo,
  });

  res.json({
    ok: true,
    message: '기존 예약 페이지에 상담일지·상담자 메모를 추가했습니다.',
    ...meta,
    journal,
    memo,
    notionUrl: updated.url,
    pageId: updated.pageId,
  });
}));

async function buildGenerationContext(body = {}) {
  const {
    pageId,
    keywords,
    name,
    gender,
    school,
    gradeClass,
    target,
    place,
    sessionLabel,
    sessionNumber,
    extraInfo,
    datetimeLabel,
  } = body;

  if (!pageId) {
    const err = new Error('pageId가 필요합니다.');
    err.status = 400;
    throw err;
  }
  if (!keywords || !String(keywords).trim()) {
    const err = new Error('키워드 메모를 입력해 주세요.');
    err.status = 400;
    throw err;
  }

  const current = await notion.getPageById(pageId);
  if (!current) {
    const err = new Error('예약을 파싱할 수 없습니다.');
    err.status = 404;
    throw err;
  }

  const previous = await notion.getPreviousSessions({
    caseNo: current.caseNo,
    title: current.title,
    beforeISO: current.startISO,
    excludePageId: pageId,
  });

  const estimated = sessionNumber || (await notion.estimateSessionNumber(previous));
  const label = sessionLabel || `${estimated}회기`;

  let previousSummary = '';
  if (previous[0]) {
    try {
      previousSummary = (await notion.getPagePlainText(previous[0].pageId)).slice(0, 3500);
    } catch {
      previousSummary = '';
    }
  }

  const duration = current.durationMin != null ? `${current.durationMin}분` : '';
  const autoDatetime =
    datetimeLabel ||
    (current.startLabel
      ? `${current.dateLabel} ${current.timeRangeLabel}${duration ? `, 소요시간 ${duration}` : ''}`
      : current.dateLabel);

  const ctx = {
    sessionLabel: label,
    caseNo: current.caseNo,
    name: name || current.title,
    gender: gender || '',
    school: school || '',
    gradeClass: gradeClass || '',
    target: target || '학생',
    datetimeLabel: autoDatetime,
    place: place || current.place || '',
    category: current.category,
    type: current.type,
    keywords: String(keywords).trim(),
    extraInfo: extraInfo || '',
    previousSummary,
  };

  return {
    ctx,
    meta: {
      current,
      sessionNumber: estimated,
      sessionLabel: label,
      previousCount: previous.length,
    },
  };
}

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(config.port, () => {
  const missing = missingKeys();
  console.log(`\n  Wee센터 상담기록 자동화 시스템 v1.0`);
  console.log(`  http://localhost:${config.port}`);
  if (missing.length) {
    console.log(`  ⚠ .env 미설정: ${missing.join(', ')}`);
    console.log(`  → sailing/.env.example 을 참고해 sailing/.env 를 만드세요.\n`);
  } else {
    console.log(`  ✓ API 키 로드됨\n`);
  }
});
