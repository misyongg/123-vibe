(() => {
  const $ = (id) => document.getElementById(id);

  const state = {
    date: '',
    schedules: [],
    selected: null,
    context: null,
    listening: false,
  };

  const els = {
    dateInput: $('dateInput'),
    refreshBtn: $('refreshBtn'),
    studentSearch: $('studentSearch'),
    searchBtn: $('searchBtn'),
    statusBar: $('statusBar'),
    scheduleList: $('scheduleList'),
    searchResults: $('searchResults'),
    selectedLabel: $('selectedLabel'),
    contextChips: $('contextChips'),
    sessionLabel: $('sessionLabel'),
    target: $('target'),
    gender: $('gender'),
    school: $('school'),
    gradeClass: $('gradeClass'),
    place: $('place'),
    keywords: $('keywords'),
    extraInfo: $('extraInfo'),
    voiceBtn: $('voiceBtn'),
    previewBtn: $('previewBtn'),
    saveBtn: $('saveBtn'),
    journalPreview: $('journalPreview'),
    memoPreview: $('memoPreview'),
    saveResult: $('saveResult'),
    toast: $('toast'),
    loading: $('loading'),
    loadingText: $('loadingText'),
  };

  function todaySeoul() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  function showToast(message, isError = false) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    els.toast.classList.toggle('error', isError);
    els.toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      els.toast.classList.remove('show');
    }, 3200);
  }

  function setLoading(on, text = '처리 중…') {
    els.loading.hidden = !on;
    els.loadingText.textContent = text;
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = { ok: false, error: '응답 파싱 실패' };
    }
    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || data.message || `요청 실패 (${res.status})`);
      err.data = data;
      throw err;
    }
    return data;
  }

  function setButtonsEnabled() {
    const ok = Boolean(state.selected && els.keywords.value.trim());
    els.previewBtn.disabled = !ok;
    els.saveBtn.disabled = !ok;
  }

  function renderSchedules(list, container, emptyText) {
    container.innerHTML = '';
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = emptyText;
      container.appendChild(li);
      return;
    }

    for (const item of list) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'schedule-item' + (state.selected?.pageId === item.pageId ? ' selected' : '');
      btn.innerHTML = `
        <span class="time">${escapeHtml(item.startLabel || '—')}</span>
        <span>
          <div class="title">${escapeHtml(item.title)}</div>
          <div class="meta">${escapeHtml([item.caseNo && `사례 ${item.caseNo}`, item.category, item.timeRangeLabel].filter(Boolean).join(' · '))}</div>
        </span>
        <span class="badge">${escapeHtml(item.category || '상담')}</span>
      `;
      btn.addEventListener('click', () => selectSchedule(item));
      li.appendChild(btn);
      container.appendChild(li);
    }
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function loadSchedules() {
    const date = els.dateInput.value || todaySeoul();
    state.date = date;
    els.statusBar.textContent = '불러오는 중…';
    els.searchResults.hidden = true;
    els.scheduleList.hidden = false;

    try {
      const data = await api(`/api/schedules?date=${encodeURIComponent(date)}`);
      state.schedules = data.schedules || [];
      els.statusBar.textContent = state.schedules.length
        ? `${date} 상담 ${state.schedules.length}건`
        : `${date} 상담 예약 없음`;
      renderSchedules(state.schedules, els.scheduleList, '오늘 상담(내방/이동) 예약이 없습니다.');
    } catch (err) {
      els.statusBar.textContent = '';
      renderSchedules([], els.scheduleList, err.message);
      showToast(err.message, true);
    }
  }

  async function selectSchedule(item) {
    state.selected = item;
    els.selectedLabel.textContent = `${item.startLabel || ''} ${item.title}`.trim();
    els.place.value = item.place || '';
    els.saveResult.hidden = true;
    els.journalPreview.value = '';
    els.memoPreview.value = '';

    // 선택 UI 갱신
    renderSchedules(state.schedules, els.scheduleList, '오늘 상담 예약이 없습니다.');
    setButtonsEnabled();

    setLoading(true, '이전 회기 확인 중…');
    try {
      const ctx = await api(`/api/sessions/${item.pageId}/context`);
      state.context = ctx;
      els.sessionLabel.value = ctx.sessionLabel || '';
      renderChips(ctx);
    } catch (err) {
      state.context = null;
      els.sessionLabel.value = '1회기';
      els.contextChips.hidden = true;
      showToast(err.message, true);
    } finally {
      setLoading(false);
    }
  }

  function renderChips(ctx) {
    const chips = [];
    if (ctx.sessionLabel) chips.push(ctx.sessionLabel);
    if (ctx.current?.caseNo) chips.push(`사례 ${ctx.current.caseNo}`);
    if (ctx.current?.type) chips.push(ctx.current.type);
    if (ctx.current?.timeRangeLabel) chips.push(ctx.current.timeRangeLabel);
    if (ctx.current?.durationMin != null) chips.push(`${ctx.current.durationMin}분`);
    if (ctx.previousCount) chips.push(`이전 ${ctx.previousCount}회`);

    els.contextChips.innerHTML = chips.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join('');
    els.contextChips.hidden = chips.length === 0;
  }

  function buildPayload() {
    if (!state.selected) throw new Error('학생(예약)을 선택하세요.');
    return {
      pageId: state.selected.pageId,
      keywords: els.keywords.value.trim(),
      sessionLabel: els.sessionLabel.value.trim(),
      target: els.target.value,
      gender: els.gender.value.trim(),
      school: els.school.value.trim(),
      gradeClass: els.gradeClass.value.trim(),
      place: els.place.value.trim(),
      extraInfo: els.extraInfo.value.trim(),
    };
  }

  async function preview() {
    const payload = buildPayload();
    setLoading(true, 'AI가 상담일지·메모를 작성 중…');
    try {
      const data = await api('/api/preview', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      els.journalPreview.value = data.journal || '';
      els.memoPreview.value = data.memo || '';
      showTab('journal');
      showToast('미리보기 완료 — 수정 후 저장하세요');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    const payload = buildPayload();
    const journal = els.journalPreview.value.trim();
    const memo = els.memoPreview.value.trim();
    if (journal && memo) {
      payload.journal = journal;
      payload.memo = memo;
    }

    setLoading(true, journal && memo ? '노션 예약 페이지 업데이트 중…' : 'AI 작성 후 노션 업데이트 중…');
    try {
      const data = await api('/api/save', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      els.journalPreview.value = data.journal || els.journalPreview.value;
      els.memoPreview.value = data.memo || els.memoPreview.value;
      els.saveResult.hidden = false;
      els.saveResult.innerHTML = data.notionUrl
        ? `저장 완료 · <a href="${escapeHtml(data.notionUrl)}" target="_blank" rel="noopener">노션 예약 페이지 열기</a>`
        : '저장 완료 — 기존 예약 페이지가 업데이트되었습니다.';
      showToast('기존 예약 페이지에 반영되었습니다');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setLoading(false);
    }
  }

  async function searchStudents() {
    const q = els.studentSearch.value.trim();
    if (!q) {
      els.searchResults.hidden = true;
      els.scheduleList.hidden = false;
      return;
    }
    els.statusBar.textContent = '검색 중…';
    try {
      const data = await api(`/api/students?q=${encodeURIComponent(q)}`);
      const students = data.students || [];
      els.statusBar.textContent = `검색 결과 ${students.length}명 · 최근 예약 기준`;
      els.scheduleList.hidden = true;
      els.searchResults.hidden = false;

      // 검색 결과는 학생 단위 — 최신 pageId로 선택 가능하도록 변환
      const asItems = students.map((s) => ({
        pageId: s.latestPageId,
        title: s.title,
        caseNo: s.caseNo,
        type: s.type,
        category: s.latestCategory || '상담',
        startLabel: (s.latestDate || '').slice(0, 10),
        timeRangeLabel: '',
        place: '',
        startISO: s.latestDate,
      }));
      renderSchedules(asItems, els.searchResults, '검색 결과가 없습니다.');
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function showTab(name) {
    document.querySelectorAll('.tab').forEach((t) => {
      const active = t.dataset.tab === name;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    els.journalPreview.hidden = name !== 'journal';
    els.memoPreview.hidden = name !== 'memo';
  }

  function setupVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      els.voiceBtn.hidden = true;
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.continuous = true;
    recognition.interimResults = true;

    let baseText = '';

    recognition.onstart = () => {
      state.listening = true;
      baseText = els.keywords.value;
      els.voiceBtn.textContent = '⏹ 중지';
      els.voiceBtn.classList.add('listening');
    };

    recognition.onend = () => {
      state.listening = false;
      els.voiceBtn.textContent = '🎤 음성';
      els.voiceBtn.classList.remove('listening');
    };

    recognition.onerror = () => {
      showToast('음성 인식을 사용할 수 없습니다', true);
    };

    recognition.onresult = (event) => {
      let interim = '';
      let finalChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalChunk += t;
        else interim += t;
      }
      if (finalChunk) {
        const sep = baseText && !baseText.endsWith('\n') ? '\n' : '';
        baseText = `${baseText}${sep}${finalChunk.trim()}`;
        els.keywords.value = baseText;
      } else {
        els.keywords.value = baseText + (baseText && interim ? '\n' : '') + interim;
      }
      setButtonsEnabled();
    };

    els.voiceBtn.addEventListener('click', () => {
      if (state.listening) recognition.stop();
      else recognition.start();
    });
  }

  function bind() {
    els.dateInput.value = todaySeoul();
    els.refreshBtn.addEventListener('click', loadSchedules);
    els.dateInput.addEventListener('change', loadSchedules);
    els.searchBtn.addEventListener('click', searchStudents);
    els.studentSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchStudents();
    });
    els.keywords.addEventListener('input', setButtonsEnabled);
    els.previewBtn.addEventListener('click', preview);
    els.saveBtn.addEventListener('click', save);
    document.querySelectorAll('.tab').forEach((t) => {
      t.addEventListener('click', () => showTab(t.dataset.tab));
    });
    setupVoice();
  }

  async function boot() {
    bind();
    try {
      const health = await api('/api/health');
      if (health.missing?.length) {
        els.statusBar.textContent = `.env 설정 필요: ${health.missing.join(', ')}`;
        showToast(`설정 필요: ${health.missing.join(', ')}`, true);
      }
    } catch {
      // 서버 미기동 시에도 UI는 표시
    }
    await loadSchedules();
  }

  boot();
})();
