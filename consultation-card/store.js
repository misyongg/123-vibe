// 제작 · 전문상담교사 김미선(misyongg)
const MW_STORE_KEY = "moodWeatherRecords";
const MW_NICKNAME_KEY = "moodWeatherNickname";
const MW_ENERGY_LABELS = { 4: "풀충", 3: "충전", 2: "보통", 1: "살짝방전", 0: "방전" };

function mwGetNickname() {
  try { return localStorage.getItem(MW_NICKNAME_KEY) || ""; }
  catch (e) { return ""; }
}

function mwSetNickname(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return false;
  localStorage.setItem(MW_NICKNAME_KEY, trimmed);
  return true;
}

function mwValidateNickname(name) {
  const trimmed = String(name || "").trim();
  if (trimmed.length < 2) return "별칭은 2글자 이상이에요";
  if (trimmed.length > 12) return "별칭은 12글자까지예요";
  if (!/^[\uAC00-\uD7A3a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ_.\-]+$/.test(trimmed)) {
    return "한글, 영문, 숫자만 사용할 수 있어요";
  }
  return "";
}

function mwLoadRecords() {
  try { return JSON.parse(localStorage.getItem(MW_STORE_KEY)) || []; }
  catch (e) { return []; }
}

function mwSaveRecords(list) {
  localStorage.setItem(MW_STORE_KEY, JSON.stringify(list));
}

function mwMyRecords() {
  const nick = mwGetNickname();
  if (!nick) return [];
  return mwLoadRecords().filter(r => r.nickname === nick);
}

function mwBuildRecord({ energy, mood, weather, weatherEmoji, weatherTitle }) {
  const now = new Date();
  return {
    ts: now.getTime(),
    nickname: mwGetNickname(),
    date: now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0"),
    time: String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0"),
    energy,
    energyLabel: MW_ENERGY_LABELS[energy],
    mood,
    weather,
    weatherEmoji,
    weatherTitle
  };
}

function mwSaveLocal(record) {
  const list = mwLoadRecords();
  list.push(record);
  mwSaveRecords(list);
  return record;
}

async function mwSyncToSheet(record) {
  const url = (typeof MOOD_WEATHER_CONFIG !== "undefined" && MOOD_WEATHER_CONFIG.GOOGLE_SHEETS_URL) || "";
  if (!url) return { ok: false, skipped: true, reason: "no_url" };

  try {
    await fetch(url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(record)
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function mwSaveRecord(record) {
  mwSaveLocal(record);
  const sync = await mwSyncToSheet(record);
  return { local: true, sync };
}
