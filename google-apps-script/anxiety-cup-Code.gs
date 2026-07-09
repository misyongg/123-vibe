/**
 * 불안 종이컵 — Google 시트 연동
 * - 학생 쪽지 저장 (doPost, recordType: note)
 * - 상담 연동 기록 저장 (doPost, recordType: session)
 * - 쪽지 조회 (doGet, ?action=get[&nickname=별칭])
 */

var NOTE_SHEET = "불안종이컵기록";
var SESSION_SHEET = "상담연동기록";

function getOrCreateNoteSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(NOTE_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(NOTE_SHEET);
    sheet.appendRow(["저장시각", "별칭", "감정", "생각", "상황"]);
    sheet.getRange(1, 1, 1, 5).setFontWeight("bold").setBackground("#eef1ff");
    sheet.setFrozenRows(1);
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

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var type = data.recordType || "note";

    if (type === "session") {
      return saveSession_(data);
    }
    return saveNote_(data);
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function saveNote_(data) {
  var sheet = getOrCreateNoteSheet_();
  sheet.appendRow([
    data.timestamp || new Date().toLocaleString("ko-KR"),
    data.nickname || "",
    data.emotion || "",
    data.thought || "",
    data.situation || ""
  ]);
  return jsonOut_({ ok: true, saved: "note" });
}

function saveSession_(data) {
  var sheet = getOrCreateSessionSheet_();
  var nickname = data.nickname || "";
  if (!nickname && data.nicknames && data.nicknames.length) {
    nickname = data.nicknames.join(", ");
  }

  sheet.appendRow([
    data.timestamp || new Date().toLocaleString("ko-KR"),
    nickname,
    data.noteCount != null ? data.noteCount : "",
    JSON.stringify(data.canNotes || []),
    JSON.stringify(data.cantNotes || []),
    data.dbtTechnique || "",
    data.observationMemo || ""
  ]);

  return jsonOut_({ ok: true, saved: "session" });
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
    var filterNick = e.parameter.nickname || "";

    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      if (!row[0] && !row[1] && !row[2] && !row[3] && !row[4]) continue;

      var note = {
        timestamp: String(row[0] || ""),
        nickname: String(row[1] || ""),
        emotion: String(row[2] || ""),
        thought: String(row[3] || ""),
        situation: String(row[4] || "")
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
