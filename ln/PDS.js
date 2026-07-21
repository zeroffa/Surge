/*
 * Loon 專用 PChome 每日簽到腳本 (PDS.js)
 * 每日 0:00 ~ 0:20 隨機執行一次
 */

const KEY_COOKIE = 'pchome.signin.cookie';
const KEY_UA = 'pchome.signin.ua';
const KEY_LAST_RUN = 'pchome.signin.last_run';

function nowText() {
  return new Date().toLocaleString('zh-TW', { hour12: false });
}

function log(message) {
  console.log(`[PChome Signin][${nowText()}] ${message}`);
}

function notify(title, subtitle, body) {
  if (typeof $notification !== 'undefined') {
    $notification.post(title, subtitle || '', body || '');
  }
}

// 檢查今天是否已經執行過
function checkTodayExecuted() {
  const lastRun = $persistentStore.read(KEY_LAST_RUN);
  if (!lastRun) return false;
  
  const todayStr = new Date().toDateString();
  const lastRunDateStr = new Date(lastRun).toDateString();
  return todayStr === lastRunDateStr;
}

(async () => {
  // 1. 檢查今天是否已經跑過了
  if (checkTodayExecuted()) {
    log('今天已經執行過簽到，略過。');
    return $done();
  }

  // 2. 隨機決定要在 0~20 分中的哪一分鐘執行
  const now = new Date();
  const currentMinute = now.getMinutes();
  
  let targetMinute = $persistentStore.read('pchome.signin.target_minute');
  const targetDateKey = 'pchome.signin.target_date';
  const todayStr = now.toDateString();
  const storedDate = $persistentStore.read(targetDateKey);

  if (!targetMinute || storedDate !== todayStr) {
    targetMinute = Math.floor(Math.random() * 21); // 0 ~ 20 分鐘
    $persistentStore.write(String(targetMinute), 'pchome.signin.target_minute');
    $persistentStore.write(todayStr, targetDateKey);
    log(`今日隨機抽籤完成，目標執行時間為 0 點 ${targetMinute} 分`);
  }

  // 如果還沒到抽中的分鐘數，就先結束，等待下一次 cron 喚醒
  if (currentMinute < parseInt(targetMinute, 10)) {
    log(`目前是 0 點 ${currentMinute} 分，未達目標時間 (${targetMinute}分)，等待中...`);
    return $done();
  }

  // 3. 開始執行簽到請求
  log('達到目標時間，開始發送 PChome 簽到請求...');
  
  const cookie = $persistentStore.read(KEY_COOKIE);
  const ua = $persistentStore.read(KEY_UA);

  if (!cookie) {
    log('錯誤：找不到 Cookie，請先手動打開 PChome App 簽到頁攔截一次！');
    notify('🧧 PChome 簽到失敗', '找不到 Cookie', '請先手動打開 App 簽到頁以擷取 Cookie。');
    return $done();
  }

  const url = 'https://ecapi.pchome.com.tw/fsapi/marketing/signingift/v1/signin';
  const headers = {
    'Cookie': cookie,
    'User-Agent': ua || 'PChome/App'
  };

  const request = {
    url: url,
    headers: headers,
    timeout: 15
  };

  $httpClient.post(request, function (error, response, data) {
    if (error) {
      log(`請求失敗: ${error}`);
      notify('🧧 PChome 簽到', '網路請求失敗', error);
      return $done();
    }

    log(`回應狀態碼: ${response.status}`);
    log(`回應內容: ${data}`);

    try {
      const result = JSON.parse(data);
      // 記錄今天已經執行成功，避免重複跑
      $persistentStore.write(new Date().toISOString(), KEY_LAST_RUN);
      
      notify('🧧 PChome 簽到成功', '已完成每日簽到', data);
    } catch (e) {
      log(`解析回應 JSON 失敗: ${e}`);
      notify('🧧 PChome 簽到', '解析回應失敗', data);
    }
    
    $done();
  });
})();
