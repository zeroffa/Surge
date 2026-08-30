/*
 * ========================================
 * 1min.ai 自動登入
 * ========================================
 *
 * Loon 版本：3.5.0 (975)
 * 腳本版本：v20260830.06
 *
 * 參考來源：
 * 7a6163/Surge
 *
 * 原始腳本：
 * https://github.com/7a6163/Surge/blob/main/Script/1min-login.js
 *
 * 本版本修改：
 * 1. 帳號、密碼、TOTP 直接設定於本 JS
 * 2. 移除對 $argument 的依賴
 * 3. 保留登入流程
 * 4. 保留 TOTP 驗證
 * 5. 保留 JWT 本機儲存
 * 6. 保留 Credit 查詢
 * 7. 保留每日獎勵檢查
 * 8. 所有 console.log 改為單一字串
 * 9. 相容 Loon 3.5.0 (975)
 *
 * ========================================
 * 使用者設定
 * ========================================
 */

const CONFIG = {

    /*
     * 1min.ai 帳號
     */
    email: '',

    /*
     * 1min.ai 密碼
     */
    password: '',

    /*
     * TOTP 金鑰
     *
     * 不使用 TOTP：
     * null
     *
     * 使用 TOTP：
     * '你的TOTP金鑰'
     */
    totpSecret: null
};


/*
 * ========================================
 * Cron 設定
 * ========================================
 *
 * 目前不由 JS 設定 Cron。
 *
 * 請使用 Loon 本機 Script 任務設定。
 *
 * 例如每天 16:10：
 *
 * 10 16 * * *
 *
 * 這裡只保留註解，不會實際執行。
 */

// const CRON = '10 16 * * *';


/*
 * ========================================
 * 版本
 * ========================================
 */

const SCRIPT_VERSION =
    'v20260830.06';


/*
 * ========================================
 * 讀取設定
 * ========================================
 */

const email =
    String(
        CONFIG.email || ''
    ).trim();

const password =
    String(
        CONFIG.password || ''
    );

const totpSecret =
    CONFIG.totpSecret &&
    String(
        CONFIG.totpSecret
    ).trim()
        ? String(
            CONFIG.totpSecret
          ).trim()
        : null;


/*
 * ========================================
 * 啟動資訊
 * ========================================
 */

console.log(
    '[1min.ai] 自動登入 ' +
    SCRIPT_VERSION
);

console.log(
    '[1min.ai] 參考來源：7a6163/Surge'
);

console.log(
    '[1min.ai] 帳號參數：' +
    (
        email
            ? '已設定'
            : '未設定'
    )
);

console.log(
    '[1min.ai] 密碼參數：' +
    (
        password
            ? '已設定'
            : '未設定'
    )
);

console.log(
    '[1min.ai] TOTP：' +
    (
        totpSecret
            ? '已設定'
            : '未設定'
    )
);


/*
 * ========================================
 * 基本檢查
 * ========================================
 */

if (
    !email ||
    !password
) {

    console.log(
        '[1min.ai] ❌ 缺少帳號或密碼'
    );

    $notification.post(
        '1min.ai',
        '設定錯誤',
        '請在 JS 最上方填入帳號與密碼'
    );

    $done();

} else {


/*
 * ========================================
 * JWT 儲存
 * ========================================
 */

const JWT_KEY =
    '1min_jwt_' + email;

const USER_DATA_KEY =
    '1min_user_' + email;


function saveJWT(
    token,
    userData
) {

    try {

        const tokenSaved =
            $persistentStore.write(
                token,
                JWT_KEY
            );

        const userSaved =
            $persistentStore.write(
                JSON.stringify(
                    userData
                ),
                USER_DATA_KEY
            );

        console.log(
            '[1min.ai] JWT 已儲存：' +
            (
                tokenSaved &&
                userSaved
                    ? '成功'
                    : '失敗'
            )
        );

    } catch (error) {

        console.log(
            '[1min.ai] ❌ 儲存 JWT 失敗：' +
            String(error)
        );
    }
}


function loadJWT() {

    try {

        const token =
            $persistentStore.read(
                JWT_KEY
            );

        const userDataText =
            $persistentStore.read(
                USER_DATA_KEY
            );

        if (
            token &&
            userDataText
        ) {

            const userData =
                JSON.parse(
                    userDataText
                );

            console.log(
                '[1min.ai] 已讀取本機 JWT'
            );

            return {
                token,
                userData
            };
        }

    } catch (error) {

        console.log(
            '[1min.ai] ❌ 讀取 JWT 失敗：' +
            String(error)
        );
    }

    return null;
}


function clearJWT() {

    try {

        $persistentStore.remove(
            JWT_KEY
        );

        $persistentStore.remove(
            USER_DATA_KEY
        );

        console.log(
            '[1min.ai] JWT 已清除'
        );

    } catch (error) {

        console.log(
            '[1min.ai] ❌ 清除 JWT 失敗：' +
            String(error)
        );
    }
}


/*
 * ========================================
 * TOTP 函式庫
 * ========================================
 */

let OTPAuth = null;


function loadOTPAuth() {

    if (
        OTPAuth
    ) {

        return Promise.resolve(
            OTPAuth
        );
    }

    const url =
        'https://cdn.jsdelivr.net/npm/otpauth@9.4.0/dist/otpauth.umd.min.js';

    console.log(
        '[1min.ai] 載入 TOTP 函式庫'
    );

    return new Promise(
        (
            resolve,
            reject
        ) => {

            $httpClient.get(
                {
                    url: url,

                    timeout: 15000,

                    headers: {

                        'User-Agent':
                            'Mozilla/5.0',

                        'Accept':
                            '*/*'
                    }
                },

                (
                    error,
                    response,
                    data
                ) => {

                    if (
                        error
                    ) {

                        console.log(
                            '[1min.ai] ❌ TOTP 函式庫下載失敗：' +
                            String(error)
                        );

                        reject(
                            error
                        );

                        return;
                    }

                    const status =
                        response
                            ? response.status
                            : null;

                    console.log(
                        '[1min.ai] TOTP 函式庫 HTTP 狀態：' +
                        String(status)
                    );

                    if (
                        !response ||
                        status !== 200
                    ) {

                        const errorMessage =
                            'TOTP 函式庫 HTTP ' +
                            String(status);

                        console.log(
                            '[1min.ai] ❌ ' +
                            errorMessage
                        );

                        reject(
                            new Error(
                                errorMessage
                            )
                        );

                        return;
                    }

                    try {

                        eval(
                            String(
                                data || ''
                            )
                        );

                        if (
                            typeof globalThis !==
                                'undefined' &&
                            globalThis.OTPAuth
                        ) {

                            OTPAuth =
                                globalThis.OTPAuth;

                        } else if (
                            typeof global !==
                                'undefined' &&
                            global.OTPAuth
                        ) {

                            OTPAuth =
                                global.OTPAuth;

                        } else if (
                            typeof window !==
                                'undefined' &&
                            window.OTPAuth
                        ) {

                            OTPAuth =
                                window.OTPAuth;
                        }

                        if (
                            !OTPAuth
                        ) {

                            throw new Error(
                                '無法取得 OTPAuth'
                            );
                        }

                        console.log(
                            '[1min.ai] ✅ TOTP 函式庫載入成功'
                        );

                        resolve(
                            OTPAuth
                        );

                    } catch (parseError) {

                        console.log(
                            '[1min.ai] ❌ TOTP 函式庫解析失敗：' +
                            String(parseError)
                        );

                        reject(
                            parseError
                        );
                    }
                }
            );
        }
    );
}


/*
 * ========================================
 * 裝置識別
 * ========================================
 */

function randomHex(
    length
) {

    const chars =
        '0123456789abcdef';

    let result = '';

    for (
        let i = 0;
        i < length;
        i++
    ) {

        result +=
            chars[
                Math.floor(
                    Math.random() *
                    chars.length
                )
            ];
    }

    return result;
}


function generateDeviceId() {

    return (
        '$device:' +
        randomHex(16) +
        '-' +
        randomHex(15) +
        '-' +
        randomHex(8) +
        '-' +
        randomHex(6) +
        '-' +
        randomHex(16)
    );
}


const deviceId =
    generateDeviceId();


/*
 * ========================================
 * 登入管理
 * ========================================
 */

class LoginManager {

    constructor(
        email,
        password,
        totpSecret
    ) {

        this.email =
            email;

        this.password =
            password;

        this.totpSecret =
            totpSecret;
    }


    /*
     * ========================================
     * API Header
     * ========================================
     */

    buildApiHeaders(
        authToken
    ) {

        return {

            'Host':
                'api.1min.ai',

            'Content-Type':
                'application/json',

            'X-Auth-Token':
                'Bearer ' +
                authToken,

            'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',

            'Accept':
                'application/json, text/plain, */*',

            'Origin':
                'https://app.1min.ai',

            'Referer':
                'https://app.1min.ai/'
        };
    }


    /*
     * ========================================
     * 驗證 JWT
     * ========================================
     */

    async validateJWT(
        token,
        userData
    ) {

        try {

            const team =
                userData
                    ?.teams
                    ?.[0];

            if (
                !team
            ) {

                return false;
            }

            const teamId =
                team.teamId ||
                team
                    .team
                    ?.uuid;

            if (
                !teamId
            ) {

                return false;
            }

            const headers =
                this.buildApiHeaders(
                    token
                );

            const credit =
                await this.apiGetCredits(
                    teamId,
                    headers
                );

            /*
             * 只要 API 正常回應，
             * 就視為 JWT 有效。
             */

            return (
                credit !== null
            );

        } catch (error) {

            console.log(
                '[1min.ai] JWT 驗證失敗：' +
                String(error)
            );

            return false;
        }
    }


    /*
     * ========================================
     * 登入 API
     * ========================================
     */

    performLogin() {

        const url =
            'https://api.1min.ai/auth/login';

        const headers = {

            'Host':
                'api.1min.ai',

            'Content-Type':
                'application/json',

            'X-Auth-Token':
                'Bearer',

            'Mp-Identity':
                deviceId,

            'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',

            'Accept':
                'application/json, text/plain, */*',

            'Origin':
                'https://app.1min.ai',

            'Referer':
                'https://app.1min.ai/'
        };

        const body =
            JSON.stringify({

                email:
                    this.email,

                password:
                    this.password
            });

        console.log(
            '[1min.ai] 開始登入 API'
        );

        return new Promise(
            (
                resolve,
                reject
            ) => {

                $httpClient.post(
                    {
                        url:
                            url,

                        timeout:
                            30000,

                        headers:
                            headers,

                        body:
                            body
                    },

                    (
                        error,
                        response,
                        data
                    ) => {

                        if (
                            error
                        ) {

                            console.log(
                                '[1min.ai] ❌ 登入請求失敗：' +
                                String(error)
                            );

                            $notification.post(
                                '1min.ai',
                                '登入失敗',
                                String(error)
                            );

                            reject(
                                error
                            );

                            return;
                        }

                        const status =
                            response
                                ? response.status
                                : null;

                        console.log(
                            '[1min.ai] 登入 HTTP 狀態：' +
                            String(status)
                        );

                        try {

                            const result =
                                JSON.parse(
                                    data ||
                                    '{}'
                                );

                            if (
                                status === 200 &&
                                result.user
                            ) {

                                /*
                                 * 判斷是否需要 MFA。
                                 */

                                if (
                                    result.user
                                        .mfaRequired
                                ) {

                                    if (
                                        this.totpSecret
                                    ) {

                                        console.log(
                                            '[1min.ai] 帳號需要 TOTP，開始驗證'
                                        );

                                        this
                                            .performMFAVerification(
                                                result.user.token
                                            )
                                            .then(
                                                resolve
                                            )
                                            .catch(
                                                reject
                                            );

                                    } else {

                                        const message =
                                            '帳號需要 TOTP，但沒有設定 TOTP 金鑰';

                                        console.log(
                                            '[1min.ai] ❌ ' +
                                            message
                                        );

                                        $notification.post(
                                            '1min.ai',
                                            '需要 TOTP',
                                            message
                                        );

                                        reject(
                                            new Error(
                                                message
                                            )
                                        );
                                    }

                                    return;
                                }

                                const token =
                                    result.token ||
                                    result.user.token;

                                if (
                                    !token
                                ) {

                                    throw new Error(
                                        '登入成功但沒有取得 JWT'
                                    );
                                }

                                saveJWT(
                                    token,
                                    result.user
                                );

                                this
                                    .displayCreditInfo(
                                        result
                                    )
                                    .then(
                                        () =>
                                            resolve(
                                                result
                                            )
                                    )
                                    .catch(
                                        reject
                                    );

                                return;
                            }

                            const message =
                                result.message ||
                                (
                                    status === 401
                                        ? '帳號或密碼錯誤'
                                        : status === 429
                                            ? '請求過於頻繁'
                                            : 'HTTP ' +
                                              String(status)
                                );

                            console.log(
                                '[1min.ai] ❌ 登入失敗：' +
                                message
                            );

                            $notification.post(
                                '1min.ai',
                                '登入失敗',
                                message
                            );

                            reject(
                                new Error(
                                    message
                                )
                            );

                        } catch (parseError) {

                            console.log(
                                '[1min.ai] ❌ 登入回應解析失敗：' +
                                String(parseError)
                            );

                            reject(
                                parseError
                            );
                        }
                    }
                );
            }
        );
    }


    /*
     * ========================================
     * TOTP 驗證
     * ========================================
     */

    async performMFAVerification(
        tempToken
    ) {

        const OTP =
            await loadOTPAuth();

        const totp =
            new OTP.TOTP({

                secret:
                    this.totpSecret,

                digits:
                    6,

                period:
                    30,

                algorithm:
                    'SHA1'
            });

        const code =
            totp.generate();

        console.log(
            '[1min.ai] TOTP 驗證碼已產生'
        );

        const url =
            'https://api.1min.ai/auth/mfa/verify';

        const headers = {

            'Host':
                'api.1min.ai',

            'Content-Type':
                'application/json',

            'X-Auth-Token':
                'Bearer',

            'Mp-Identity':
                deviceId,

            'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',

            'Accept':
                'application/json, text/plain, */*',

            'Origin':
                'https://app.1min.ai',

            'Referer':
                'https://app.1min.ai/'
        };

        const body =
            JSON.stringify({

                code:
                    code,

                token:
                    tempToken
            });

        return new Promise(
            (
                resolve,
                reject
            ) => {

                $httpClient.post(
                    {
                        url:
                            url,

                        timeout:
                            30000,

                        headers:
                            headers,

                        body:
                            body
                    },

                    (
                        error,
                        response,
                        data
                    ) => {

                        if (
                            error
                        ) {

                            console.log(
                                '[1min.ai] ❌ TOTP 請求失敗：' +
                                String(error)
                            );

                            reject(
                                error
                            );

                            return;
                        }

                        const status =
                            response
                                ? response.status
                                : null;

                        console.log(
                            '[1min.ai] TOTP HTTP 狀態：' +
                            String(status)
                        );

                        try {

                            const result =
                                JSON.parse(
                                    data ||
                                    '{}'
                                );

                            if (
                                status === 200
                            ) {

                                const token =
                                    result.token ||
                                    result.user
                                        ?.token;

                                if (
                                    !token
                                ) {

                                    throw new Error(
                                        'TOTP 成功但沒有取得 JWT'
                                    );
                                }

                                saveJWT(
                                    token,
                                    result.user
                                );

                                await this
                                    .displayCreditInfo(
                                        result
                                    );

                                resolve(
                                    result
                                );

                                return;
                            }

                            const message =
                                result.message ||
                                'HTTP ' +
                                String(status);

                            console.log(
                                '[1min.ai] ❌ TOTP 驗證失敗：' +
                                message
                            );

                            $notification.post(
                                '1min.ai',
                                'TOTP 驗證失敗',
                                message
                            );

                            reject(
                                new Error(
                                    message
                                )
                            );

                        } catch (parseError) {

                            console.log(
                                '[1min.ai] ❌ TOTP 回應解析失敗：' +
                                String(parseError)
                            );

                            reject(
                                parseError
                            );
                        }
                    }
                );
            }
        );
    }


    /*
     * ========================================
     * Credit 資訊
     * ========================================
     */

    async displayCreditInfo(
        responseData
    ) {

        try {

            const user =
                responseData.user;

            if (
                !user ||
                !Array.isArray(
                    user.teams
                ) ||
                !user.teams.length
            ) {

                console.log(
                    '[1min.ai] ⚠️ 無法取得 Team 資訊'
                );

                $notification.post(
                    '1min.ai',
                    '登入成功',
                    '無法取得 Team 資訊'
                );

                return;
            }

            const token =
                responseData.token ||
                user.token;

            const userUuid =
                user.uuid;

            let targetTeam =
                null;

            for (
                const team of
                    user.teams
            ) {

                const subscriptionUserId =
                    team
                        .team
                        ?.subscription
                        ?.userId;

                if (
                    subscriptionUserId ===
                    userUuid
                ) {

                    targetTeam =
                        team;

                    break;
                }
            }

            if (
                !targetTeam
            ) {

                targetTeam =
                    user.teams[0];
            }

            const teamId =
                targetTeam.teamId ||
                targetTeam
                    .team
                    ?.uuid;

            const userName =
                targetTeam.userName ||
                user.email
                    ?.split('@')[0] ||
                '用戶';

            const usedCredit =
                Number(
                    targetTeam.usedCredit ||
                    0
                );

            const initialCredit =
                Number(
                    targetTeam
                        .team
                        ?.credit ||
                    0
                );

            console.log(
                '[1min.ai] Team ID：' +
                String(teamId || '無')
            );

            console.log(
                '[1min.ai] 初始 Credit：' +
                String(initialCredit)
            );

            if (
                !teamId ||
                !token
            ) {

                const percent =
                    this.calculatePercent(
                        initialCredit,
                        usedCredit
                    );

                this.showCreditNotification(
                    userName,
                    initialCredit,
                    percent
                );

                return;
            }

            await this.checkDailyBonus(
                teamId,
                token,
                userName,
                usedCredit,
                initialCredit
            );

        } catch (error) {

            console.log(
                '[1min.ai] ❌ Credit 處理失敗：' +
                String(error)
            );

            $notification.post(
                '1min.ai',
                '登入成功',
                'Credit 資訊處理失敗'
            );
        }
    }


    /*
     * ========================================
     * 每日獎勵
     * ========================================
     */

    async checkDailyBonus(
        teamId,
        token,
        userName,
        usedCredit,
        initialCredit
    ) {

        const headers =
            this.buildApiHeaders(
                token
            );

        try {

            await this.apiCheckNotifications(
                headers
            );

            const firstCredit =
                await this.apiGetCredits(
                    teamId,
                    headers
                );

            console.log(
                '[1min.ai] 第一次 Credit：' +
                String(firstCredit)
            );

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        3000
                    )
            );

            const finalCredit =
                await this.apiGetCredits(
                    teamId,
                    headers
                );

            console.log(
                '[1min.ai] 最終 Credit：' +
                String(finalCredit)
            );

            const bonus =
                finalCredit -
                initialCredit;

            console.log(
                '[1min.ai] 今日 Credit 變化：' +
                String(bonus)
            );

            const percent =
                this.calculatePercent(
                    finalCredit,
                    usedCredit
                );

            this.showCreditNotification(
                userName,
                finalCredit,
                percent,
                bonus
            );

        } catch (error) {

            console.log(
                '[1min.ai] ❌ 每日獎勵檢查失敗：' +
                String(error)
            );

            const percent =
                this.calculatePercent(
                    initialCredit,
                    usedCredit
                );

            this.showCreditNotification(
                userName,
                initialCredit,
                percent
            );
        }
    }


    /*
     * ========================================
     * Credit API
     * ========================================
     */

    apiGetCredits(
        teamId,
        headers
    ) {

        return new Promise(
            resolve => {

                const url =
                    'https://api.1min.ai/teams/' +
                    teamId +
                    '/credits';

                $httpClient.get(
                    {
                        url:
                            url,

                        timeout:
                            15000,

                        headers:
                            headers
                    },

                    (
                        error,
                        response,
                        data
                    ) => {

                        if (
                            error
                        ) {

                            console.log(
                                '[1min.ai] ❌ Credit API 錯誤：' +
                                String(error)
                            );

                            resolve(
                                null
                            );

                            return;
                        }

                        const status =
                            response
                                ? response.status
                                : null;

                        console.log(
                            '[1min.ai] Credit HTTP 狀態：' +
                            String(status)
                        );

                        if (
                            !response ||
                            status !== 200
                        ) {

                            resolve(
                                null
                            );

                            return;
                        }

                        try {

                            const result =
                                JSON.parse(
                                    data ||
                                    '{}'
                                );

                            const credit =
                                Number(
                                    result.credit ||
                                    0
                                );

                            resolve(
                                credit
                            );

                        } catch (error) {

                            console.log(
                                '[1min.ai] ❌ Credit JSON 解析失敗：' +
                                String(error)
                            );

                            resolve(
                                null
                            );
                        }
                    }
                );
            }
        );
    }


    /*
     * ========================================
     * 通知 API
     * ========================================
     */

    apiCheckNotifications(
        headers
    ) {

        return new Promise(
            resolve => {

                const url =
                    'https://api.1min.ai/notifications/unread';

                $httpClient.get(
                    {
                        url:
                            url,

                        timeout:
                            15000,

                        headers:
                            headers
                    },

                    (
                        error,
                        response,
                        data
                    ) => {

                        if (
                            error
                        ) {

                            console.log(
                                '[1min.ai] ⚠️ 通知 API 請求失敗：' +
                                String(error)
                            );

                        } else {

                            const status =
                                response
                                    ? response.status
                                    : null;

                            console.log(
                                '[1min.ai] 通知 API HTTP 狀態：' +
                                String(status)
                            );
                        }

                        /*
                         * 通知 API 失敗不影響
                         * 後續 Credit 查詢。
                         */

                        resolve();
                    }
                );
            }
        );
    }


    /*
     * ========================================
     * 數字格式化
     * ========================================
     */

    formatNumber(
        number
    ) {

        return Number(
            number || 0
        ).toLocaleString(
            'zh-TW'
        );
    }


    /*
     * ========================================
     * 百分比
     * ========================================
     */

    calculatePercent(
        remaining,
        used
    ) {

        const total =
            Number(
                remaining || 0
            ) +
            Number(
                used || 0
            );

        if (
            total <= 0
        ) {

            return '0.0';
        }

        return (
            (
                Number(
                    remaining || 0
                ) /
                total
            ) *
            100
        ).toFixed(1);
    }


    /*
     * ========================================
     * 通知
     * ========================================
     */

    showCreditNotification(
        userName,
        credit,
        percent,
        bonus = 0
    ) {

        let message =
            String(userName) +
            ' | 點數: ' +
            this.formatNumber(
                credit
            ) +
            ' (' +
            String(percent) +
            '%)';

        if (
            Number(
                bonus
            ) > 0
        ) {

            message +=
                ' (+' +
                this.formatNumber(
                    bonus
                ) +
                ')';
        }

        console.log(
            '[1min.ai] ' +
            message
        );

        $notification.post(
            '1min.ai',
            '登入成功',
            message
        );
    }
}


/*
 * ========================================
 * 主程式
 * ========================================
 */

async function main() {

    const loginManager =
        new LoginManager(
            email,
            password,
            totpSecret
        );

    /*
     * 嘗試使用已儲存 JWT。
     */

    const saved =
        loadJWT();

    if (
        saved
    ) {

        console.log(
            '[1min.ai] 發現已儲存 JWT，開始驗證'
        );

        const valid =
            await loginManager.validateJWT(
                saved.token,
                saved.userData
            );

        console.log(
            '[1min.ai] JWT 驗證結果：' +
            (
                valid
                    ? '有效'
                    : '無效'
            )
        );

        if (
            valid
        ) {

            await loginManager
                .displayCreditInfo(
                    {
                        user:
                            saved.userData,

                        token:
                            saved.token
                    }
                );

            return;
        }

        console.log(
            '[1min.ai] JWT 已失效，重新登入'
        );

        clearJWT();
    }


    /*
     * 執行登入。
     */

    try {

        await loginManager.performLogin();

    } catch (error) {

        console.log(
            '[1min.ai] ❌ 執行失敗：' +
            String(
                error &&
                error.message
                    ? error.message
                    : error
            )
        );

        $notification.post(
            '1min.ai',
            '執行失敗',
            String(
                error &&
                error.message
                    ? error.message
                    : error
            )
        );
    }
}


/*
 * ========================================
 * 開始執行
 * ========================================
 */

main();

}
