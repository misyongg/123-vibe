/**
 * 오늘의 마음날씨 — Google 시트 연동
 *
 * 배포 방법: google-apps-script/README.md 참고
 */

var SHEET_NAME = "마음날씨기록";

function getOrCreateSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      "날짜", "시간", "별칭", "몸(에너지)", "기분(0-10)",
      "마음날씨", "이모지", "저장시각(ms)"
    ]);
    sheet.getRange(1, 1, 1, 8).setFontWeight("bold").setBackground("#f3e5f5");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = getOrCreateSheet_();

    sheet.appendRow([
      data.date || "",
      data.time || "",
      data.nickname || "",
      data.energyLabel || "",
      data.mood != null ? data.mood : "",
      data.weatherTitle || "",
      data.weatherEmoji || "",
      data.ts || ""
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: "mood-weather" }))
    .setMimeType(ContentService.MimeType.JSON);
}
