/*
 * Loon - PChome Daily Signin (Adapted for Loon)
 * Flow:
 *   1. 每日 0 點觸發，隨機延遲 0~30 分鐘後開始執行。
 *   2. 讀取儲存的 Cookie 與 UA。
 *   3. 取得目前活動資訊，檢查是否額滿。
 *   4. 計算今日對應的 gift_id 並送出簽到請求。
 */

const ACTIVITY_URL = 'https://ecapi.pchome.com.tw/fsapi/marketing/signingift/v1/activity';
const SIGNIN_URL = 'https://ecapi.pchome.com.tw/fsapi/marketing/signingift/v1/signin';

const KEY_COOKIE = 'pchome.signin.cookie';
const KEY_UA = 'pchome.signin.ua';
const KEY_LAST_CAPTURE = 'pchome.signin.last_capture';
const KEY_LAST_RESULT = 'pchome.signin.last_result';
const KEY_RANDOM_LAST_RUN = 'pchome.signin.random_last_run';

const DEFAULT_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) PChome_APP_ios_4.16.5';

const ACTIVITY_STATUS_TEXT = {
  IN_PROGRESS: '活動進行中',
  BUDGETS_FULL: '簽到名額已滿',
};

function done() {
  $done();
}

function nowText() {
  return new Date().toLocaleString('zh-TW', { hour12: false });
}

function log(...args) {
  console.log(`[PChome Signin][${nowText()}] ${args.filter(v => v !== undefined && v !== null && v !== '').join(' ')}`);
}

function notify(title, subtitle, body) {
  if (typeof $notification !== 'undefined') {
    $notification.post(title, subtitle || '', body || '');
  }
}

// 相容 Loon 的 HTTP 請求包裝
function httpGet(options) {
  return new Promise((resolve, reject) => {
    $httpClient.get(options, (err, resp, data) => {
      if (err) return reject(err || new Error('HTTPClient request failed with error:(null)'));
      resolve({ resp: resp || {}, data });
    });
  });
}

function httpPost(options) {
  return new Promise((resolve, reject) => {
    $httpClient.post(options, (err, resp, data) => {
      if (err) return reject(err || new Error('HTTPClient request failed with error:(null)'));
      resolve({ resp: resp || {}, data });
    });
  });
}

function baseHeaders(cookie, ua) {
  return {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'Origin': 'https://24h.pchome.com.tw',
    'Referer': 'https://24h.pchome.com.tw/',
    'User-Agent': ua || DEFAULT_UA,
    'Accept-Language': 'zh-TW,zh-Hant;q=0.9',
    'Cookie': cookie,
  };
}

function parseJson(text, label) {
  try {
    return JSON.parse(text || '{}');
  } catch (e) {
    throw new Error(`${label} JSON 解析失敗：${String(text || '').slice(0, 200)}`);
  }
}

function httpStatus(resp) {
  return Number(resp && (resp.status || resp.statusCode)) || 0;
}

function briefJson(obj, len = 300) {
  try {
    return JSON.stringify(obj).slice(0, len);
  } catch (e) {
    return String(obj).slice(0, len);
  }
}

function statusText(obj) {
  if (!obj || typeof obj !== 'object') return '';
  return obj.status || obj.message || obj.msg || obj.code || briefJson(obj, 120);
}

function normalizeActivity(activity) {
  if (!activity || !activity.current) throw new Error('找不到 current activity');

  const current = activity.current;
  const currentStatus = current.current_activity_status || '';
  const gifts = Array.isArray(current.activity_duration) ? current.activity_duration : [];

  return {
    activity_id: current.activity_id || '',
    status: currentStatus,
    status_text: ACTIVITY_STATUS_TEXT[currentStatus] || currentStatus || '未知狀態',
    start: current.activity_star_date || current.activity_start_date || '',
    end: current.activity_end_date || '',
    gifts,
  };
}

function todayGift(activityInfo) {
  if (!activityInfo.activity_id) throw new Error('找不到 activity_id');

  if (activityInfo.status === 'BUDGETS_FULL') {
    const err = new Error('簽到名額已滿');
    err.code = 'BUDGETS_FULL';
    throw err;
  }

  if (activityInfo.status && activityInfo.status !== 'IN_PROGRESS') {
    throw new Error(`活動狀態不是 IN_PROGRESS：${activityInfo.status}`);
  }

  const startMs = Date.parse(activityInfo.start || '');
  const endMs = Date.parse(activityInfo.end || '');
  const nowMs = Date.now();

  if (!Number.isFinite(startMs)) throw new Error('活動開始時間格式異常');
  if (Number.isFinite(endMs) && nowMs > endMs) throw new Error('目前活動已結束');
  if (nowMs < startMs) throw new Error('目前活動尚未開始');

  const day = Math.floor((nowMs - startMs) / 86400000) + 1;
  const gift = activityInfo.gifts.find(x => Number(x.day) === day) || activityInfo.gifts[day - 1];

  if (!gift || !gift.gift_id) {
    throw new Error(`找不到第 ${day} 天 gift_id`);
  }

  return {
    activity_id: activityInfo.activity_id,
    gift_id: gift.gift_id,
    day,
    p_coin: gift.p_coin || '',
    start: activityInfo.start,
    end: activityInfo.end,
    activity_status: activityInfo.status,
  };
}

function writeResult(record) {
  $persistentStore.write(JSON.stringify(record), KEY_LAST_RESULT);
}

function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function readJsonStore(key) {
  try {
    const raw = $persistentStore.read(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function writeJsonStore(key, value) {
  $persistentStore.write(JSON.stringify(value), key);
}

// 檢查今日是否已經執行過，避免重複觸發
function checkTodayRan() {
  const now = new Date();
  const dateKey = localDateKey(now);
  const lastRun = readJsonStore(KEY_RANDOM_LAST_RUN);
  if (lastRun && lastRun.date === dateKey && lastRun.done) {
    log('今日已經執行過簽到，略過');
    return true;
  }
  return false;
}

(async () => {
  const startedAt = new Date();
  log('開始執行每日簽到排程');

  if (checkTodayRan()) {
    return done();
  }

  // 0 到 30 分鐘之間的隨機延遲 (毫秒)
  const randomMinutes = Math.floor(Math.random() * 30);
  const delayMs = randomMinutes * 60 * 1000;
  log(`已排定隨機延遲：${randomMinutes} 分鐘後執行`);

  // 記錄今日已排程狀態
  writeJsonStore(KEY_RANDOM_LAST_RUN, {
    date: localDateKey(startedAt),
    done: true,
    delay_minutes: randomMinutes,
    scheduled_at: startedAt.toISOString(),
  });

  // 透過 setTimeout 實現隨機等待
  await new Promise(resolve => setTimeout(resolve, delayMs));

  const cookie = $persistentStore.read(KEY_COOKIE);
  const ua = $persistentStore.read(KEY_UA) || DEFAULT_UA;
  const lastCapture = $persistentStore.read(KEY_LAST_CAPTURE) || '無紀錄';

  if (!cookie) {
    const msg = '尚未擷取 Cookie，請先開啟 PChome App 的每日簽到頁，或手動簽到一次讓 Loon 擷取 Cookie。';
    log('停止：', msg);
    notify('🧧 PChome 每日簽到失敗', '尚未擷取 Cookie', msg);
    return done();
  }

  log('已讀取 Cookie；上次擷取時間：', lastCapture);
  const headers = baseHeaders(cookie, ua);

  try {
    log('取得活動資訊：', ACTIVITY_URL);
    const activityRes = await httpGet({
      url: ACTIVITY_URL,
      headers,
      timeout: 10,
    });

    const activityHttpStatus = httpStatus(activityRes.resp);
    log('活動資訊 HTTP 狀態：', activityHttpStatus);

    if (activityHttpStatus < 200 || activityHttpStatus >= 300) {
      throw new Error(`活動資訊 HTTP ${activityHttpStatus}：${String(activityRes.data || '').slice(0, 200)}`);
    }

    const activity = parseJson(activityRes.data, '活動資訊');
    const activityInfo = normalizeActivity(activity);

    log('活動狀態：', activityInfo.status || '空', `(${activityInfo.status_text})`);

    if (activityInfo.status === 'BUDGETS_FULL') {
      const record = {
        time: new Date().toISOString(),
        activity_id: activityInfo.activity_id,
        activity_status: activityInfo.status,
        result: 'BUDGETS_FULL',
        message: '簽到名額已滿，未送出 signin 請求',
      };
      writeResult(record);
      log('簽到名額已滿，停止送出 signin 請求');
      notify('🧧 PChome 每日簽到已額滿', 'BUDGETS_FULL', `activity_id: ${activityInfo.activity_id}`);
      return done();
    }

    const gift = todayGift(activityInfo);
    log('今日簽到內容：', `第 ${gift.day} 天`, `gift_id=${gift.gift_id}`);

    const bodyObj = {
      activity_id: gift.activity_id,
      gift_id: gift.gift_id,
    };

    log('送出簽到請求：', briefJson(bodyObj));
    const signinRes = await httpPost({
      url: SIGNIN_URL,
      headers,
      body: JSON.stringify(bodyObj),
      timeout: 10,
    });

    const signinHttpStatus = httpStatus(signinRes.resp);
    const signinBody = parseJson(signinRes.data, '簽到結果');
    const result = statusText(signinBody);

    log('簽到 HTTP 狀態：', signinHttpStatus);
    log('簽到回傳：', briefJson(signinBody));

    const record = {
      time: new Date().toISOString(),
      http_status: signinHttpStatus,
      activity_id: gift.activity_id,
      activity_status: gift.activity_status,
      gift_id: gift.gift_id,
      day: gift.day,
      p_coin: gift.p_coin,
      result: signinBody,
    };
    writeResult(record);

    if (signinHttpStatus >= 200 && signinHttpStatus < 300 && String(result).toLowerCase() === 'success') {
      log('簽到成功');
      notify('🧧 PChome 每日簽到成功', `第 ${gift.day} 天${gift.p_coin ? `｜${gift.p_coin} P幣` : ''}`, `activity_id: ${gift.activity_id}`);
    } else if (String(result) === '400-004') {
      log('今日已簽到，視為完成');
      notify('🧧 PChome 今日已簽到', '400-004', `第 ${gift.day} 天｜activity_id: ${gift.activity_id}`);
    } else {
      log('簽到完成但狀態需確認：', result);
      notify('🧧 PChome 每日簽到完成但狀態需確認', `HTTP ${signinHttpStatus}｜${result}`, briefJson(signinBody));
    }
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    const code = e && e.code ? String(e.code) : '';
    log('執行失敗：', code, msg);
    writeResult({
      time: new Date().toISOString(),
      result: 'ERROR',
      code,
      message: msg,
    });
    notify('🧧 PChome 每日簽到失敗', code, msg);
  } finally {
    log('執行結束');
    done();
  }
})();
