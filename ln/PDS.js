/*
 * Surge / Loon - PChome 每日簽到
 *
 * 版本：v20260829.03
 *
 * 相容：
 *   - Surge
 *   - Loon 3.5.0 (975)
 *
 * 本版本修正：
 *   1. 支援 Surge 的 $cronexp
 *   2. 支援 Loon 的 $argument.cron
 *   3. 修正每日隨機分鐘判斷錯誤
 *   4. 移除 Loon 3.5.0 會造成 Request timeout 的 timeout 參數
 *
 * 執行流程：
 *   1. 依 Cron 的分鐘範圍，每日隨機選擇一個簽到分鐘。
 *   2. 只有到達當日指定分鐘才執行。
 *   3. 讀取已儲存的 PChome Cookie。
 *   4. 取得目前活動資訊。
 *   5. 如果活動名額已滿，停止簽到。
 *   6. 根據活動開始日期計算今日 gift_id。
 *   7. 發送簽到請求。
 *
 * 已知回應：
 *   BUDGETS_FULL → 簽到名額已滿
 *   success      → 簽到成功
 *   400-004      → 今日已簽到
 */

const SCRIPT_VERSION = 'v20260829.03';

const ACTIVITY_URL =
  'https://ecapi.pchome.com.tw/fsapi/marketing/signingift/v1/activity';

const SIGNIN_URL =
  'https://ecapi.pchome.com.tw/fsapi/marketing/signingift/v1/signin';

const KEY_COOKIE =
  'pchome.signin.cookie';

const KEY_UA =
  'pchome.signin.ua';

const KEY_LAST_CAPTURE =
  'pchome.signin.last_capture';

const KEY_LAST_RESULT =
  'pchome.signin.last_result';

const KEY_RANDOM_PLAN =
  'pchome.signin.random_plan';

const KEY_RANDOM_LAST_RUN =
  'pchome.signin.random_last_run';

const DEFAULT_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) PChome_APP_ios_4.16.5';

const ACTIVITY_STATUS_TEXT = {
  IN_PROGRESS: '活動進行中',
  BUDGETS_FULL: '簽到名額已滿',
};

/*
 * 結束腳本
 */
function done() {
  $done();
}

/*
 * 取得目前時間文字
 */
function nowText() {
  return new Date().toLocaleString(
    'zh-TW',
    {
      hour12: false,
    }
  );
}

/*
 * 輸出日誌
 */
function log(...args) {
  const text = args
    .filter(
      value =>
        value !== undefined &&
        value !== null &&
        value !== ''
    )
    .join(' ');

  console.log(
    `[PChome Signin][${nowText()}] ${text}`
  );
}

/*
 * 發送通知
 */
function notify(
  title,
  subtitle = '',
  body = ''
) {
  if (
    typeof $notification !==
    'undefined'
  ) {
    $notification.post(
      title,
      subtitle,
      body
    );
  }
}

/*
 * 發送 GET 請求
 *
 * 注意：
 * Loon 3.5.0 測試證實加入 timeout: 10
 * 會造成 LNHTTPClientDomain Request timeout。
 *
 * 因此這裡刻意不指定 timeout。
 */
function httpGet(options) {
  return new Promise(
    (resolve, reject) => {
      $httpClient.get(
        options,
        (
          error,
          response,
          data
        ) => {
          if (error) {
            return reject(error);
          }

          resolve({
            resp:
              response || {},
            data,
          });
        }
      );
    }
  );
}

/*
 * 發送 POST 請求
 *
 * 同樣不指定 timeout，
 * 避免 Loon 3.5.0 的 timeout 相容性問題。
 */
function httpPost(options) {
  return new Promise(
    (resolve, reject) => {
      $httpClient.post(
        options,
        (
          error,
          response,
          data
        ) => {
          if (error) {
            return reject(error);
          }

          resolve({
            resp:
              response || {},
            data,
          });
        }
      );
    }
  );
}

/*
 * 建立 PChome 請求標頭
 */
function baseHeaders(
  cookie,
  ua
) {
  return {
    Accept:
      'application/json, text/plain, */*',

    'Content-Type':
      'application/json',

    Origin:
      'https://24h.pchome.com.tw',

    Referer:
      'https://24h.pchome.com.tw/',

    'User-Agent':
      ua || DEFAULT_UA,

    'Accept-Language':
      'zh-TW,zh-Hant;q=0.9',

    Cookie:
      cookie,
  };
}

/*
 * 解析 JSON
 */
function parseJson(
  text,
  label
) {
  try {
    return JSON.parse(
      text || '{}'
    );
  } catch (error) {
    throw new Error(
      `${label} JSON 解析失敗：${String(
        text || ''
      ).slice(0, 200)}`
    );
  }
}

/*
 * 取得 HTTP 狀態碼
 */
function httpStatus(
  response
) {
  return (
    Number(
      response &&
        (
          response.status ||
          response.statusCode
        )
    ) || 0
  );
}

/*
 * 將 JSON 轉成簡短文字，
 * 避免日誌過長。
 */
function briefJson(
  object,
  length = 300
) {
  try {
    return JSON.stringify(
      object
    ).slice(0, length);
  } catch (error) {
    return String(
      object
    ).slice(0, length);
  }
}

/*
 * 取得回應中的狀態文字
 */
function statusText(object) {
  if (
    !object ||
    typeof object !== 'object'
  ) {
    return '';
  }

  return (
    object.status ||
    object.message ||
    object.msg ||
    object.code ||
    briefJson(
      object,
      120
    )
  );
}

/*
 * 整理活動資訊
 */
function normalizeActivity(
  activity
) {
  if (
    !activity ||
    !activity.current
  ) {
    throw new Error(
      '找不到 current activity'
    );
  }

  const current =
    activity.current;

  const currentStatus =
    current.current_activity_status ||
    '';

  const gifts =
    Array.isArray(
      current.activity_duration
    )
      ? current.activity_duration
      : [];

  return {
    activity_id:
      current.activity_id || '',

    status:
      currentStatus,

    status_text:
      ACTIVITY_STATUS_TEXT[
        currentStatus
      ] ||
      currentStatus ||
      '未知狀態',

    start:
      current.activity_star_date ||
      current.activity_start_date ||
      '',

    end:
      current.activity_end_date ||
      '',

    gifts,
  };
}

/*
 * 根據活動開始日期取得今日禮物
 */
function todayGift(
  activityInfo
) {
  if (
    !activityInfo.activity_id
  ) {
    throw new Error(
      '找不到 activity_id'
    );
  }

  /*
   * 名額已滿
   */
  if (
    activityInfo.status ===
    'BUDGETS_FULL'
  ) {
    const error =
      new Error(
        '簽到名額已滿'
      );

    error.code =
      'BUDGETS_FULL';

    throw error;
  }

  /*
   * 活動狀態異常
   */
  if (
    activityInfo.status &&
    activityInfo.status !==
      'IN_PROGRESS'
  ) {
    throw new Error(
      `活動狀態不是 IN_PROGRESS：${activityInfo.status}`
    );
  }

  const startMs =
    Date.parse(
      activityInfo.start || ''
    );

  const endMs =
    Date.parse(
      activityInfo.end || ''
    );

  const nowMs =
    Date.now();

  if (
    !Number.isFinite(
      startMs
    )
  ) {
    throw new Error(
      '活動開始時間格式異常'
    );
  }

  /*
   * 活動已結束
   */
  if (
    Number.isFinite(endMs) &&
    nowMs > endMs
  ) {
    throw new Error(
      '目前活動已結束'
    );
  }

  /*
   * 活動尚未開始
   */
  if (
    nowMs < startMs
  ) {
    throw new Error(
      '目前活動尚未開始'
    );
  }

  /*
   * 計算活動第幾天
   */
  const day =
    Math.floor(
      (nowMs - startMs) /
        86400000
    ) + 1;

  /*
   * 依 day 找 gift
   */
  const gift =
    activityInfo.gifts.find(
      item =>
        Number(item.day) === day
    ) ||
    activityInfo.gifts[
      day - 1
    ];

  if (
    !gift ||
    !gift.gift_id
  ) {
    throw new Error(
      `找不到第 ${day} 天 gift_id`
    );
  }

  return {
    activity_id:
      activityInfo.activity_id,

    gift_id:
      gift.gift_id,

    day,

    p_coin:
      gift.p_coin || '',

    start:
      activityInfo.start,

    end:
      activityInfo.end,

    activity_status:
      activityInfo.status,
  };
}

/*
 * 儲存最後一次簽到結果
 */
function writeResult(
  record
) {
  $persistentStore.write(
    JSON.stringify(record),
    KEY_LAST_RESULT
  );
}

/*
 * 取得 Cron 表達式
 *
 * Surge：
 *   $cronexp
 *
 * Loon：
 *   $argument.cron
 *
 * Loon Plugin：
 *   argument=[{cron}]
 */
function getCronExpression() {

  /*
   * Surge
   */
  try {
    if (
      typeof $cronexp !==
        'undefined' &&
      $cronexp
    ) {
      return String(
        $cronexp
      ).trim();
    }
  } catch (error) {}

  /*
   * Loon
   */
  try {
    if (
      typeof $argument !==
        'undefined' &&
      $argument
    ) {

      /*
       * Loon 物件形式
       */
      if (
        typeof $argument ===
          'object' &&
        $argument.cron
      ) {
        return String(
          $argument.cron
        ).trim();
      }

      /*
       * Loon 字串形式
       */
      if (
        typeof $argument ===
          'string'
      ) {
        const value =
          String(
            $argument
          ).trim();

        if (value) {
          return value;
        }
      }
    }
  } catch (error) {}

  return '';
}

/*
 * 取得目前日期 YYYY-MM-DD
 */
function localDateKey(
  date = new Date()
) {
  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(
      2,
      '0'
    );

  const day =
    String(
      date.getDate()
    ).padStart(
      2,
      '0'
    );

  return `${year}-${month}-${day}`;
}

/*
 * 解析 Cron 分鐘欄位
 *
 * 支援：
 *   1
 *   1,2,3
 *   1-5
 *   *\/5
 */
function parseMinuteField(
  field
) {
  const text =
    String(
      field || ''
    ).trim();

  /*
   * * 代表不限制分鐘
   */
  if (
    !text ||
    text === '*'
  ) {
    return null;
  }

  const minutes =
    new Set();

  function addMinute(
    value
  ) {
    const minute =
      Number(value);

    if (
      Number.isInteger(
        minute
      ) &&
      minute >= 0 &&
      minute <= 59
    ) {
      minutes.add(
        minute
      );
    }
  }

  for (
    const partRaw of
      text.split(',')
  ) {

    const part =
      partRaw.trim();

    if (!part) {
      continue;
    }

    /*
     * 單一分鐘
     */
    if (
      /^\d+$/.test(part)
    ) {
      addMinute(part);
      continue;
    }

    /*
     * 分鐘範圍，例如 1-5
     */
    const rangeMatch =
      part.match(
        /^(\d+)-(\d+)$/
      );

    if (rangeMatch) {

      const start =
        Number(
          rangeMatch[1]
        );

      const end =
        Number(
          rangeMatch[2]
        );

      if (
        Number.isInteger(
          start
        ) &&
        Number.isInteger(
          end
        ) &&
        start >= 0 &&
        end <= 59 &&
        start <= end
      ) {

        for (
          let minute = start;
          minute <= end;
          minute += 1
        ) {
          minutes.add(
            minute
          );
        }
      }

      continue;
    }

    /*
     * 步進，例如 *\/5
     */
    const stepMatch =
      part.match(
        /^\*\/(\d+)$/
      );

    if (stepMatch) {

      const step =
        Number(
          stepMatch[1]
        );

      if (
        Number.isInteger(
          step
        ) &&
        step > 0
      ) {

        for (
          let minute = 0;
          minute <= 59;
          minute += step
        ) {
          minutes.add(
            minute
          );
        }
      }
    }
  }

  return minutes.size
    ? Array.from(
        minutes
      ).sort(
        (a, b) =>
          a - b
      )
    : null;
}

/*
 * 從候選清單中隨機選擇一個值
 */
function pickRandom(
  list
) {
  return list[
    Math.floor(
      Math.random() *
        list.length
    )
  ];
}

/*
 * 讀取 JSON 儲存資料
 */
function readJsonStore(
  key
) {
  try {
    const raw =
      $persistentStore.read(
        key
      );

    return raw
      ? JSON.parse(raw)
      : null;

  } catch (error) {
    return null;
  }
}

/*
 * 寫入 JSON 儲存資料
 */
function writeJsonStore(
  key,
  value
) {
  $persistentStore.write(
    JSON.stringify(value),
    key
  );
}

/*
 * 每日隨機 Cron 判斷
 *
 * 例如：
 *
 *   1-5 8 * * *
 *
 * 每天從：
 *
 *   08:01
 *   08:02
 *   08:03
 *   08:04
 *   08:05
 *
 * 隨機選擇一個時間。
 *
 * 重要：
 *
 * 如果現在是 08:04，
 * 目標也是 08:04 → 執行。
 *
 * 如果現在是 08:05，
 * 目標是 08:04 → 不執行。
 *
 * 如果現在是 12:58，
 * 目標是 08:04 → 不執行。
 *
 * 這就是修正之前錯誤的地方。
 */
function randomCronGate() {

  const cron =
    getCronExpression();

  /*
   * 手動執行腳本時通常沒有 Cron。
   *
   * 此時直接執行，
   * 方便手動測試。
   */
  if (!cron) {

    log(
      '未取得 Cron 表達式，直接執行（手動測試）'
    );

    return true;
  }

  const fields =
    cron
      .split(/\s+/)
      .filter(Boolean);

  const minuteField =
    fields[0] || '';

  const hourField =
    fields[1] || '';

  const candidates =
    parseMinuteField(
      minuteField
    );

  /*
   * 沒有分鐘範圍，
   * 或只有單一分鐘，
   * 直接執行。
   */
  if (
    !candidates ||
    candidates.length <= 1
  ) {

    log(
      'Cron 為單一觸發時間，直接執行：',
      cron
    );

    return true;
  }

  const now =
    new Date();

  const dateKey =
    localDateKey(
      now
    );

  const currentMinute =
    now.getMinutes();

  const currentHour =
    now.getHours();

  /*
   * 檢查 Cron 小時。
   *
   * 目前 Plugin 使用：
   *
   *   1-5 8 * * *
   *
   * 因此只允許 08 點。
   */
  const hourMatches =
    hourField === '' ||
    hourField === '*'
      ? true
      : String(
          currentHour
        ) ===
        String(
          hourField
        );

  if (!hourMatches) {

    log(
      '目前不在 Cron 指定小時，略過：',
      `目前=${String(
        currentHour
      ).padStart(
        2,
        '0'
      )}:${String(
        currentMinute
      ).padStart(
        2,
        '0'
      )}`,
      `Cron=${cron}`
    );

    return false;
  }

  /*
   * 建立今日隨機計畫的識別值
   */
  const planKey =
    `${dateKey}|${minuteField}|${hourField}`;

  let plan =
    readJsonStore(
      KEY_RANDOM_PLAN
    );

  /*
   * 今天尚未建立計畫，
   * 或計畫內容已經改變，
   * 就重新抽取。
   */
  if (
    !plan ||
    plan.key !==
      planKey ||
    !candidates.includes(
      Number(
        plan.minute
      )
    )
  ) {

    plan = {
      key:
        planKey,

      date:
        dateKey,

      cron:
        cron,

      minute_field:
        minuteField,

      hour_field:
        hourField,

      minute:
        pickRandom(
          candidates
        ),

      created_at:
        now.toISOString(),
    };

    writeJsonStore(
      KEY_RANDOM_PLAN,
      plan
    );

    log(
      '建立今日隨機簽到時間：',
      `${String(
        currentHour
      ).padStart(
        2,
        '0'
      )}:${String(
        plan.minute
      ).padStart(
        2,
        '0'
      )}`,
      `候選分鐘=${candidates.join(
        ','
      )}`
    );

  } else {

    log(
      '今日隨機簽到時間：',
      `${String(
        currentHour
      ).padStart(
        2,
        '0'
      )}:${String(
        plan.minute
      ).padStart(
        2,
        '0'
      )}`
    );
  }

  const targetMinute =
    Number(
      plan.minute
    );

  /*
   * 今天已經執行過
   */
  const lastRun =
    readJsonStore(
      KEY_RANDOM_LAST_RUN
    );

  if (
    lastRun &&
    lastRun.key ===
      planKey &&
    lastRun.done
  ) {

    log(
      '今日此 Cron 視窗已執行過，略過：',
      lastRun.executed_at ||
        ''
    );

    return false;
  }

  /*
   * 尚未到達目標分鐘
   */
  if (
    currentMinute <
    targetMinute
  ) {

    log(
      '尚未到今日隨機分鐘，略過：',
      `目前=${String(
        currentHour
      ).padStart(
        2,
        '0'
      )}:${String(
        currentMinute
      ).padStart(
        2,
        '0'
      )}`,
      `目標=${String(
        currentHour
      ).padStart(
        2,
        '0'
      )}:${String(
        targetMinute
      ).padStart(
        2,
        '0'
      )}`
    );

    return false;
  }

  /*
   * 已經超過目標分鐘。
   *
   * 不允許補執行。
   *
   * 例如：
   * 目標 08:04
   * 現在 08:05
   *
   * → 略過
   *
   * 也因此不會再發生：
   *
   * 12:58
   * 目標 12:04
   * → 錯誤執行
   */
  if (
    currentMinute >
    targetMinute
  ) {

    log(
      '已超過今日隨機分鐘，略過：',
      `目前=${String(
        currentHour
      ).padStart(
        2,
        '0'
      )}:${String(
        currentMinute
      ).padStart(
        2,
        '0'
      )}`,
      `目標=${String(
        currentHour
      ).padStart(
        2,
        '0'
      )}:${String(
        targetMinute
      ).padStart(
        2,
        '0'
      )}`
    );

    return false;
  }

  /*
   * 現在分鐘等於目標分鐘，
   * 正式執行。
   */
  log(
    '到達今日隨機分鐘，開始執行：',
    `分鐘=${targetMinute}`
  );

  /*
   * 記錄今天已經執行，
   * 避免同一天重複執行。
   */
  writeJsonStore(
    KEY_RANDOM_LAST_RUN,
    {
      key:
        planKey,

      done:
        true,

      target_minute:
        targetMinute,

      executed_minute:
        currentMinute,

      executed_at:
        now.toISOString(),
    }
  );

  return true;
}

/*
 * 主程式
 */
(async () => {

  const startedAt =
    new Date();

  log(
    `開始執行每日簽到 ${SCRIPT_VERSION}`
  );

  /*
   * 檢查每日隨機時間
   */
  if (
    !randomCronGate()
  ) {
    return done();
  }

  /*
   * 讀取 Cookie
   */
  const cookie =
    $persistentStore.read(
      KEY_COOKIE
    );

  /*
   * 讀取 User-Agent
   */
  const ua =
    $persistentStore.read(
      KEY_UA
    ) ||
    DEFAULT_UA;

  /*
   * 取得 Cookie 最後擷取時間
   */
  const lastCapture =
    $persistentStore.read(
      KEY_LAST_CAPTURE
    ) ||
    '無紀錄';

  /*
   * 沒有 Cookie
   */
  if (!cookie) {

    const message =
      '尚未擷取 Cookie，請先開啟 PChome App 的每日簽到頁，或手動簽到一次讓 Loon 擷取 Cookie。';

    log(
      '停止：',
      message
    );

    notify(
      '🧧 PChome 每日簽到失敗',
      '尚未擷取 Cookie',
      message
    );

    return done();
  }

  log(
    '已讀取 Cookie；上次擷取時間：',
    lastCapture
  );

  /*
   * 建立請求標頭
   */
  const headers =
    baseHeaders(
      cookie,
      ua
    );

  try {

    /*
     * 取得目前活動
     *
     * 注意：
     * 不指定 timeout。
     */
    log(
      '取得活動資訊：',
      ACTIVITY_URL
    );

    const activityRes =
      await httpGet({
        url:
          ACTIVITY_URL,

        headers:
          headers,

        'auto-cookie':
          false,
      });

    const activityHttpStatus =
      httpStatus(
        activityRes.resp
      );

    log(
      '活動資訊 HTTP 狀態：',
      activityHttpStatus
    );

    /*
     * HTTP 狀態不是 2xx
     */
    if (
      activityHttpStatus <
        200 ||
      activityHttpStatus >=
        300
    ) {

      throw new Error(
        `活動資訊 HTTP ${activityHttpStatus}：${String(
          activityRes.data ||
            ''
        ).slice(
          0,
          200
        )}`
      );
    }

    /*
     * 解析活動 JSON
     */
    const activity =
      parseJson(
        activityRes.data,
        '活動資訊'
      );

    const activityInfo =
      normalizeActivity(
        activity
      );

    log(
      '活動狀態：',
      activityInfo.status ||
        '空',
      `(${activityInfo.status_text})`
    );

    log(
      '活動 ID：',
      activityInfo.activity_id
    );

    log(
      '活動期間：',
      `${activityInfo.start} ~ ${activityInfo.end}`
    );

    log(
      '活動獎勵天數：',
      activityInfo.gifts.length
    );

    /*
     * 名額已滿
     */
    if (
      activityInfo.status ===
      'BUDGETS_FULL'
    ) {

      const record = {
        time:
          startedAt.toISOString(),

        activity_id:
          activityInfo.activity_id,

        activity_status:
          activityInfo.status,

        result:
          'BUDGETS_FULL',

        message:
          '簽到名額已滿，未送出 signin 請求',
      };

      writeResult(
        record
      );

      log(
        '簽到名額已滿，停止送出 signin 請求'
      );

      notify(
        '🧧 PChome 每日簽到已額滿',
        'BUDGETS_FULL',
        `activity_id: ${activityInfo.activity_id}`
      );

      return done();
    }

    /*
     * 取得今日禮物
     */
    const gift =
      todayGift(
        activityInfo
      );

    log(
      '今日簽到內容：',
      `第 ${gift.day} 天`,
      `gift_id=${gift.gift_id}`,
      gift.p_coin
        ? `p_coin=${gift.p_coin}`
        : ''
    );

    /*
     * 建立簽到請求內容
     */
    const bodyObj = {
      activity_id:
        gift.activity_id,

      gift_id:
        gift.gift_id,
    };

    log(
      '送出簽到請求：',
      briefJson(
        bodyObj
      )
    );

    /*
     * 發送簽到 POST
     *
     * 注意：
     * 不指定 timeout。
     */
    const signinRes =
      await httpPost({
        url:
          SIGNIN_URL,

        headers:
          headers,

        body:
          JSON.stringify(
            bodyObj
          ),

        'auto-cookie':
          false,
      });

    const signinHttpStatus =
      httpStatus(
        signinRes.resp
      );

    const signinBody =
      parseJson(
        signinRes.data,
        '簽到結果'
      );

    const result =
      statusText(
        signinBody
      );

    log(
      '簽到 HTTP 狀態：',
      signinHttpStatus
    );

    log(
      '簽到回傳：',
      briefJson(
        signinBody
      )
    );

    /*
     * 儲存簽到結果
     */
    const record = {
      time:
        startedAt.toISOString(),

      http_status:
        signinHttpStatus,

      activity_id:
        gift.activity_id,

      activity_status:
        gift.activity_status,

      gift_id:
        gift.gift_id,

      day:
        gift.day,

      p_coin:
        gift.p_coin,

      result:
        signinBody,
    };

    writeResult(
      record
    );

    /*
     * 簽到成功
     */
    if (
      signinHttpStatus >=
        200 &&
      signinHttpStatus <
        300 &&
      String(
        result
      ).toLowerCase() ===
        'success'
    ) {

      log(
        '簽到成功'
      );

      notify(
        '🧧 PChome 每日簽到成功',
        `第 ${gift.day} 天${
          gift.p_coin
            ? `｜${gift.p_coin} P幣`
            : ''
        }`,
        `activity_id: ${gift.activity_id}`
      );

    /*
     * 今日已經簽到
     */
    } else if (
      String(result) ===
      '400-004'
    ) {

      log(
        '今日已簽到，視為完成'
      );

      notify(
        '🧧 PChome 今日已簽到',
        '400-004',
        `第 ${gift.day} 天｜activity_id: ${gift.activity_id}`
      );

    /*
     * 其他結果
     */
    } else {

      log(
        '簽到完成但狀態需確認：',
        result
      );

      notify(
        '🧧 PChome 每日簽到完成但狀態需確認',
        `HTTP ${signinHttpStatus}｜${result}`,
        briefJson(
          signinBody
        )
      );
    }

  } catch (error) {

    const message =
      String(
        error &&
        error.message
          ? error.message
          : error
      );

    const code =
      error &&
      error.code
        ? String(
            error.code
          )
        : '';

    log(
      '執行失敗：',
      code,
      message
    );

    /*
     * 儲存錯誤結果
     */
    writeResult({
      time:
        startedAt.toISOString(),

      result:
        'ERROR',

      code:
        code,

      message:
        message,
    });

    /*
     * 發送錯誤通知
     */
    notify(
      '🧧 PChome 每日簽到失敗',
      code,
      message
    );

  } finally {

    log(
      '執行結束'
    );

    done();
  }

})();
