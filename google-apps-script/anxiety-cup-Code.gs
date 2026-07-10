/**
 * 제작 · 전문상담교사 김미선(misyongg)
 * 불안 종이컵 — Google 시트 연동
 * - 학생 쪽지 저장 (doPost, recordType: note)
 * - 상담 연동 기록 저장 (doPost, recordType: session) + 쪽지 처리완료 표시
 * - 쪽지 조회 (doGet, ?action=get[&nickname=별칭]) — 미처리 쪽지만
 *
 * ⚠️ 코드 수정 후 Apps Script에서 반드시 「새 배포」하세요.
 */

var NOTE_SHEET = "불안종이컵기록";
var SESSION_SHEET = "상담연동기록";
var NOTE_HEADERS = ["저장시각", "별칭", "감정", "생각", "상황", "처리완료", "noteId"];

function norm_(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function isProcessed_(val) {
  var v = norm_(val).toUpperCase();
  return v === "Y" || v === "YES" || v === "TRUE" || v === "1";
}

function ensureNoteHeaders_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), NOTE_HEADERS.length);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var changed = false;

  for (var i = 0; i < NOTE_HEADERS.length; i++) {
    if (norm_(headers[i]) !== NOTE_HEADERS[i]) {
      headers[i] = NOTE_HEADERS[i];
      changed = true;
    }
  }

  if (changed || sheet.getLastColumn() < NOTE_HEADERS.length) {
    sheet.getRange(1, 1, 1, NOTE_HEADERS.length).setValues([headers.slice(0, NOTE_HEADERS.length)]);
    sheet.getRange(1, 1, 1, NOTE_HEADERS.length).setFontWeight("bold").setBackground("#eef1ff");
    sheet.setFrozenRows(1);
  }
}

function getOrCreateNoteSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(NOTE_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(NOTE_SHEET);
    sheet.appendRow(NOTE_HEADERS);
    sheet.getRange(1, 1, 1, NOTE_HEADERS.length).setFontWeight("bold").setBackground("#eef1ff");
    sheet.setFrozenRows(1);
  } else {
    ensureNoteHeaders_(sheet);
  }
  return sheet;
}

function getOrCreateSessionSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SESSION_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SESSION_SHEET);
    sheet.appendRow([
      "저장시각", "별칭", "쪽지수",
      "다룰수있는불안", "다룰수없는불안",
      "선택DBT", "소감메모"
    ]);
    sheet.getRange(1, 1, 1, 7).setFontWeight("bold").setBackground("#e6fffa");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function makeNoteId_() {
  return "n_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOut_({ ok: false, error: "empty body" });
    }
    var data = JSON.parse(e.postData.contents);
    var type = data.recordType || "note";

    if (type === "session") {
      return saveSession_(data);
    }
    if (type === "markProcessed") {
      var markedCount = markNotesProcessed_(data.processedNoteIds || []);
      return jsonOut_({ ok: true, saved: "markProcessed", markedProcessed: markedCount });
    }
    return saveNote_(data);
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function saveNote_(data) {
  var sheet = getOrCreateNoteSheet_();
  var noteId = makeNoteId_();
  sheet.appendRow([
    data.timestamp || new Date().toLocaleString("ko-KR"),
    norm_(data.nickname),
    norm_(data.emotion),
    norm_(data.thought),
    norm_(data.situation),
    "",
    noteId
  ]);
  return jsonOut_({ ok: true, saved: "note", noteId: noteId });
}

function saveSession_(data) {
  var sheet = getOrCreateSessionSheet_();
  var nickname = norm_(data.nickname);
  if (!nickname && data.nicknames && data.nicknames.length) {
    nickname = data.nicknames.map(norm_).join(", ");
  }

  sheet.appendRow([
    data.timestamp || new Date().toLocaleString("ko-KR"),
    nickname,
    data.noteCount != null ? data.noteCount : "",
    JSON.stringify(data.canNotes || []),
    JSON.stringify(data.cantNotes || []),
    data.dbtTechnique || "",
    norm_(data.observationMemo)
  ]);

  var marked = 0;
  if (data.processedNoteIds && data.processedNoteIds.length) {
    marked = markNotesProcessed_(data.processedNoteIds);
  }

  return jsonOut_({ ok: true, saved: "session", markedProcessed: marked });
}

function markNotesProcessed_(ids) {
  var sheet = getOrCreateNoteSheet_();
  var rows = sheet.getDataRange().getValues();
  var idSet = {};
  for (var j = 0; j < ids.length; j++) {
    idSet[String(ids[j])] = true;
  }

  var marked = 0;
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    var rowId = norm_(row[6]) || ("row_" + (i + 1));
    if (idSet[rowId] && !isProcessed_(row[5])) {
      sheet.getRange(i + 1, 6).setValue("Y");
      marked++;
    }
  }
  return marked;
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "";

  if (action === "get") {
    return getNotes_(e);
  }

  return jsonOut_({ ok: true, service: "anxiety-cup" });
}

function getNotes_(e) {
  try {
    var sheet = getOrCreateNoteSheet_();
    var rows = sheet.getDataRange().getValues();
    var notes = [];
    var filterNick = norm_(e.parameter.nickname || "");

    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      if (!row[0] && !row[1] && !row[2] && !row[3] && !row[4]) continue;
      if (isProcessed_(row[5])) continue;

      var note = {
        id: norm_(row[6]) || ("row_" + (i + 1)),
        timestamp: String(row[0] || ""),
        nickname: norm_(row[1]),
        emotion: norm_(row[2]),
        thought: norm_(row[3]),
        situation: norm_(row[4])
      };

      if (filterNick && note.nickname !== filterNick) continue;
      notes.push(note);
    }

    return jsonOut_({ ok: true, notes: notes, filter: filterNick || null });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err), notes: [] });
  }
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
