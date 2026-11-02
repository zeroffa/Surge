/*
 * 1min.ai 每日簽到 — Loon 本機版
 * 版本：v20261102.01
 * 作者基準版本：v202610260224
 *
 * 備註異動說明：
 * 1. 以作者 v202610260224 原始碼為唯一基準，保留 Token 擷取、Team ID 擷取、Token 換發及每日獎勵判定流程。
 * 2. 改為 Loon 本機 JS + 本機 Cron；不使用遠端 script-path、不使用 $argument 傳遞密碼。
 * 3. 密碼採本機 PASSWORD 常數選填；留空時依作者邏輯提醒重新登入，並繼續執行每日獎勵流程。
 * 4. Loon $httpClient timeout 使用毫秒，將作者 Surge 原碼 timeout: 10（秒）轉為 10000（毫秒）。
 * 5. 保留作者原流程：先讀取 credits 觸發每日獎勵，再輪詢 topups 最多 6 次、每次間隔 5 秒，最後讀取 credits。
 */

// 選填：Token 剩不到 2 天時，以同一組密碼換發 Token；留空則提醒重新登入。
const PASSWORD = '';

const TOKEN_KEY = '1min_jwt';
const TEAM_KEY = '1min_team_id';
const RENEW_BEFORE_MS = 2 * 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;
const POLL_ATTEMPTS = 6;
const TITLE = '1min.ai 簽到';
const LOGIN_HINT = '請用經過 Loon 的瀏覽器登入 app.1min.ai 以重新取得 token';

function b64urlDecode(s) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let bits = 0, value = 0, out = '';
    for (const c of s) {
        const i = chars.indexOf(c);
        if (i < 0) continue;
        value = ((value << 6) | i) & 0xffffff;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out += String.fromCharCode((value >> bits) & 0xff);
        }
    }
    return out;
}

// 只讀取 JWT payload，不驗證簽章；與作者原始碼一致。
function jwtPayload(token) {
    try {
        const payload = JSON.parse(b64urlDecode(token.split('.')[1] || ''));
        return typeof payload.exp === 'number' && typeof payload.iat === 'number' ? payload : null;
    } catch (e) {
        return null;
    }
}

// HTTP Request：從經過 Loon 的 app.1min.ai API 請求擷取 Token 與 Team ID。
function capture() {
    const headers = $request.headers || {};
    const auth = Object.keys(headers).find((k) => k.toLowerCase() === 'x-auth-token');
    const token = auth ? String(headers[auth]).replace(/^Bearer\s*/i, '').trim() : '';
    const payload = token && jwtPayload(token);
    const team = $request.url.match(/\/teams\/([0-9a-f-]{36})\//i);

    if (team && $persistentStore.read(TEAM_KEY) !== team[1]) {
        $persistentStore.write(team[1], TEAM_KEY);
        console.log(`已記錄 team ID: ${team[1]}`);
        $notification.post(TITLE, '已取得 team ID', team[1]);
    }

    if (payload) {
        const stored = $persistentStore.read(TOKEN_KEY);
        const storedPayload = stored && jwtPayload(stored);
        // 換發後瀏覽器仍可能送出舊 Token，只接受 iat 較新的 Token。
        if (!storedPayload || payload.iat > storedPayload.iat) {
            $persistentStore.write(token, TOKEN_KEY);
            const until = new Date(payload.exp * 1000).toLocaleString('zh-TW');
            console.log(`已更新 token，有效至 ${until}`);
            $notification.post(TITLE, '已取得登入 token', `有效至 ${until}`);
        }
    }

    $done({});
}

// Cron：每日簽到。
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function api(method, path, token, body) {
    return new Promise((resolve, reject) => {
        const options = {
            url: `https://api.1min.ai${path}`,
            // Loon 的 $httpClient timeout 單位為毫秒；作者 Surge 原碼的 10 秒換算為 10000。
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': `Bearer ${token}`,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
                Accept: 'application/json, text/plain, */*',
                Origin: 'https://app.1min.ai',
                Referer: 'https://app.1min.ai/',
            },
        };
        if (body) options.body = JSON.stringify(body);

        $httpClient[method](options, (error, response, data) => {
            if (error) return reject(new Error(`${path} 連線失敗: ${error}`));
            if (response.status === 401) return reject(new Error(`token 已失效。${LOGIN_HINT}`));
            let json = {};
            try {
                json = JSON.parse(data || '{}');
            } catch (e) {}
            resolve({ status: response.status, json });
        });
    });
}

async function renew(token, password) {
    const { status, json } = await api('post', '/auth/passwords', token, {
        current_password: password,
        new_password: password,
    });
    const next = json.user && json.user.token;
    if (status !== 200 || typeof next !== 'string') {
        throw new Error(`token 換發失敗: ${json.message || `HTTP ${status}`}`);
    }
    $persistentStore.write(next, TOKEN_KEY);
    return next;
}

// null 代表讀不到，不是 0；保留作者原始碼的判定方式。
async function getCredits(teamId, token) {
    const { status, json } = await api('get', `/teams/${teamId}/credits`, token);
    return status === 200 && typeof json.credit === 'number' ? json.credit : null;
}

async function getTopups(teamId, token) {
    const { status, json } = await api('get', `/teams/${teamId}/topups?page=1&pageSize=10&orderBy=-createdAt`, token);
    return status === 200 && Array.isArray(json.topupList) ? json.topupList : null;
}

async function checkin(password) {
    let token = $persistentStore.read(TOKEN_KEY);
    const teamId = $persistentStore.read(TEAM_KEY);
    const payload = token && jwtPayload(token);

    if (!payload || !teamId) throw new Error(`尚未取得 token 或 team ID。${LOGIN_HINT}`);
    if (payload.exp * 1000 <= Date.now()) throw new Error(`token 已過期。${LOGIN_HINT}`);

    let renewed = '';
    if (payload.exp * 1000 - Date.now() < RENEW_BEFORE_MS) {
        if (password) {
            token = await renew(token, password);
            renewed = `\ntoken 已換發，有效至 ${new Date(jwtPayload(token).exp * 1000).toLocaleString('zh-TW')}`;
        } else {
            renewed = `\ntoken 將於 ${new Date(payload.exp * 1000).toLocaleString('zh-TW')} 到期。${LOGIN_HINT}`;
        }
    }

    const startedAt = Date.now();
    const unread = await api('get', '/notifications/unread', token);
    if (unread.status !== 200) throw new Error(`簽到請求失敗: HTTP ${unread.status}`);

    // 讀取點數才會觸發每日獎勵；回傳的是入帳前餘額，幾秒後才出現在點數紀錄。
    await getCredits(teamId, token);

    let readOnce = false;
    let latest = null;
    let reward = null;
    for (let i = 0; i < POLL_ATTEMPTS && reward === null; i++) {
        await sleep(POLL_INTERVAL_MS);
        const topups = await getTopups(teamId, token);
        if (!topups) continue;
        readOnce = true;
        latest = topups.find((t) => t.type === 'DAILY_FREE_CREDIT') || null;
        if (latest && Date.parse(latest.createdAt) >= startedAt) reward = latest.credit;
    }

    const credit = await getCredits(teamId, token);
    const lines = [];
    if (credit !== null) lines.push(`點數: ${credit.toLocaleString('zh-TW')}`);
    if (reward !== null) {
        lines.push(`獎勵: +${reward.toLocaleString('zh-TW')}`);
    } else if (readOnce) {
        const at = latest ? new Date(latest.createdAt).toLocaleString('zh-TW') : '今天稍早';
        lines.push(`獎勵: 今日已領取（${at}）`);
    } else {
        lines.push('獎勵: 無法讀取點數紀錄');
    }
    return lines.join('\n') + renewed;
}

if (typeof $request !== 'undefined') {
    capture();
} else {
    console.log('1min.ai 腳本版本：v20261102.01');
    checkin(PASSWORD)
        .then((message) => {
            console.log(message);
            $notification.post(TITLE, '簽到成功', message);
        })
        .catch((error) => {
            console.log(`❌ ${error.message}`);
            $notification.post(TITLE, '簽到失敗', error.message);
        })
        .finally(() => $done());
}
