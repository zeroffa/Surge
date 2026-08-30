/*
 * 1min.ai 自動登入與每日獎勵
 *
 * Loon 移植版本：v20260830.02
 *
 * 參考來源：
 *   作者：7a6163
 *   原始專案：
 *   https://github.com/7a6163/Surge
 *
 * 原始腳本：
 *   Script/1min-login.js
 *
 * 原始版本：
 *   v202509051622
 *
 * Loon 相容版本：
 *   Loon 3.5.0 (975)
 *
 * 本版本調整：
 *   1. 使用 Loon 舊版 Script 語法對應的 $argument
 *   2. 支援帳號、密碼與 TOTP 金鑰
 *   3. 支援中文 Plugin 參數名稱
 *   4. 保留原始登入流程
 *   5. 保留 JWT 儲存與重新登入機制
 *   6. 保留 Team / Credit 查詢
 *   7. 保留每日獎勵檢查
 *   8. 保留 TOTP 驗證
 *   9. 不使用 Loon $httpClient 的 timeout 參數
 */

/*
 * ========================================
 * 版本
 * ========================================
 */

const SCRIPT_VERSION = 'v20260830.02';

/*
 * ========================================
 * Loon 3.5.0 $argument 參數處理
 * ========================================
 *
 * Loon 舊版 Script 的 argument 可能以：
 *
 *   email=xxx&password=xxx&totp=xxx
 *
 * 這類字串傳入。
 *
 * 本版本同時支援：
 *
 *   1. Object
 *   2. String
 *   3. JSON String
 *
 * 以增加不同 Loon 執行入口的相容性。
 */

function getArguments() {

    try {

        /*
         * 沒有參數。
         */
        if (
            typeof $argument === 'undefined' ||
            $argument === null
        ) {

            return {};
        }

        /*
         * 如果 Loon 已經直接提供 Object，
         * 直接使用。
         */
        if (
            typeof $argument === 'object'
        ) {

            return $argument;
        }

        const raw =
            String(
                $argument
            ).trim();

        if (!raw) {

            return {};
        }

        /*
         * 如果是 JSON Object 字串，
         * 先嘗試解析。
         */
        if (
            raw.charAt(0) === '{'
        ) {

            try {

                const parsed =
                    JSON.parse(
                        raw
                    );

                if (
                    parsed &&
                    typeof parsed === 'object'
                ) {

                    return parsed;
                }

            } catch (error) {

                console.log(
                    '[1min.ai] JSON 參數解析失敗，改用字串參數解析'
                );
            }
        }

        /*
         * 解析：
         *
         * email=xxx&password=xxx&totp=xxx
         */
        const result = {};

        raw
            .split('&')
            .forEach(
                item => {

                    if (!item) {
                        return;
                    }

                    const index =
                        item.indexOf('=');

                    if (
                        index < 0
                    ) {

                        return;
                    }

                    const key =
                        item
                            .slice(
                                0,
                                index
                            )
                            .trim();

                    const value =
                        item
                            .slice(
                                index + 1
                            );

                    if (!key) {
                        return;
                    }

                    try {

                        result[key] =
                            decodeURIComponent(
                                value
                            );

                    } catch (error) {

                        result[key] =
                            value;
                    }
                }
            );

        return result;

    } catch (error) {

        console.log(
            '[1min.ai] ❌ 取得參數失敗：',
            String(error)
        );

        return {};
    }
}

const args =
    getArguments();

/*
 * ========================================
 * 取得登入參數
 * ========================================
 *
 * 同時支援：
 *
 *   email
 *   帳號
 *
 *   password
 *   密碼
 *
 *   totp
 *   TOTP金鑰
 */

const email =
    args.email ||
    args.帳號 ||
    '';

const password =
    args.password ||
    args.密碼 ||
    '';

const totpValue =
    args.totp ||
    args.TOTP金鑰 ||
    '';

const totpSecret =
    String(
        totpValue || ''
    ).trim();

const validTotpSecret =
    totpSecret &&
    totpSecret.toLowerCase() !==
        'null'
        ? totpSecret
        : null;

/*
 * 顯示參數狀態。
 *
 * 絕對不輸出實際帳號、密碼或 TOTP 金鑰。
 */

console.log(
    `[1min.ai] 自動登入 ${SCRIPT_VERSION}`
);

console.log(
    '[1min.ai] 參考來源：7a6163/Surge'
);

console.log(
    `[1min.ai] 帳號參數：${
        email
            ? '已取得'
            : '未取得'
    }`
);

console.log(
    `[1min.ai] 密碼參數：${
        password
            ? '已取得'
            : '未取得'
    }`
);

console.log(
    `[1min.ai] TOTP：${
        validTotpSecret
            ? '已設定'
            : '未設定'
    }`
);

/*
 * ========================================
 * 基本參數檢查
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
        '1min 登入',
        '設定錯誤',
        '請檢查 Loon Plugin 的帳號與密碼參數'
    );

    $done();

} else {

    /*
     * ========================================
     * JWT 儲存
     * ========================================
     */

    const JWT_KEY =
        `1min_jwt_${email}`;

    const USER_DATA_KEY =
        `1min_user_${email}`;

    function saveJWT(
        token,
        userData
    ) {

        try {

            if (
                token
            ) {

                $persistentStore.write(
                    token,
                    JWT_KEY
                );
            }

            if (
                userData
            ) {

                $persistentStore.write(
                    JSON.stringify(
                        userData
                    ),
                    USER_DATA_KEY
                );
            }

            console.log(
                '[1min.ai] JWT 已儲存'
            );

        } catch (error) {

            console.log(
                '[1min.ai] ❌ 儲存 JWT 失敗：',
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

            const userData =
                $persistentStore.read(
                    USER_DATA_KEY
                );

            if (
                token &&
                userData
            ) {

                return {

                    token,

                    userData:
                        JSON.parse(
                            userData
                        )
                };
            }

        } catch (error) {

            console.log(
                '[1min.ai] ❌ 讀取 JWT 失敗：',
                String(error)
            );
        }

        return null;
    }

    function clearJWT() {

        try {

            $persistentStore.write(
                null,
                JWT_KEY
            );

            $persistentStore.write(
                null,
                USER_DATA_KEY
            );

            console.log(
                '[1min.ai] JWT 已清除'
            );

        } catch (error) {

            console.log(
                '[1min.ai] ❌ 清除 JWT 失敗：',
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
                        url,

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
                                '[1min.ai] ❌ TOTP 函式庫下載失敗：',
                                String(error)
                            );

                            reject(
                                error
                            );

                            return;
                        }

                        if (
                            !response ||
                            response.status !==
                                200
                        ) {

                            const errorMessage =
                                `TOTP 函式庫 HTTP ${
                                    response
                                        ? response.status
                                        : 'null'
                                }`;

                            console.log(
                                `[1min.ai] ❌ ${errorMessage}`
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
                                    data ||
                                    ''
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

                        } catch (
                            parseError
                        ) {

                            console.log(
                                '[1min.ai] ❌ TOTP 函式庫解析失敗：',
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
     * Login Manager
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
         * 建立 API Headers。
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
                    `Bearer ${authToken}`,

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
         * 驗證 JWT。
         */
        async validateJWT(
            token,
            userData
        ) {

            try {

                if (
                    !userData ||
                    !Array.isArray(
                        userData.teams
                    ) ||
                    !userData.teams.length
                ) {

                    return false;
                }

                const team =
                    userData.teams[0];

                const teamId =
                    team.teamId ||
                    team.team?.uuid;

                if (
                    !teamId
                ) {

                    return false;
                }

                const headers =
                    this.buildApiHeaders(
                        token
                    );

                /*
                 * 成功取得 API 回應，
                 * 即可繼續使用 JWT。
                 */
                return await new Promise(
                    resolve => {

                        const url =
                            `https://api.1min.ai/teams/${teamId}/credits`;

                        $httpClient.get(
                            {
                                url,
                                headers
                            },

                            (
                                error,
                                response,
                                data
                            ) => {

                                if (
                                    error ||
                                    !response
                                ) {

                                    resolve(
                                        false
                                    );

                                    return;
                                }

                                resolve(
                                    response.status ===
                                        200
                                );
                            }
                        );
                    }
                );

            } catch (error) {

                return false;
            }
        }

        /*
         * 登入。
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

                    /*
                     * Loon 3.5.0：
                     * 不額外傳入 timeout。
                     */
                    $httpClient.post(
                        {
                            url,

                            headers,

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
                                    '[1min.ai] ❌ 登入 API 錯誤：',
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
                                '[1min.ai] 登入 HTTP 狀態：',
                                status
                            );

                            try {

                                const result =
                                    JSON.parse(
                                        data ||
                                        '{}'
                                    );

                                if (
                                    status !==
                                        200 ||
                                    !result.user
                                ) {

                                    const message =
                                        result.message ||
                                        `HTTP ${status}`;

                                    console.log(
                                        '[1min.ai] ❌ 登入失敗：',
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

                                    return;
                                }

                                /*
                                 * 需要 TOTP。
                                 */
                                if (
                                    result.user
                                        .mfaRequired
                                ) {

                                    if (
                                        !this.totpSecret
                                    ) {

                                        const message =
                                            '帳號需要 TOTP，但未設定 TOTP 金鑰';

                                        console.log(
                                            `[1min.ai] ❌ ${message}`
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

                                        return;
                                    }

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
                                        {
                                            user:
                                                result.user,

                                            token
                                        }
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

                            } catch (
                                parseError
                            ) {

                                console.log(
                                    '[1min.ai] ❌ 回應解析失敗：',
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
         * TOTP 驗證。
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
                            url,

                            headers,

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
                                    '[1min.ai] ❌ TOTP API 錯誤：',
                                    String(error)
                                );

                                reject(
                                    error
                                );

                                return;
                            }

                            try {

                                const result =
                                    JSON.parse(
                                        data ||
                                        '{}'
                                    );

                                if (
                                    !response ||
                                    response.status !==
                                        200
                                ) {

                                    const message =
                                        result.message ||
                                        `HTTP ${
                                            response
                                                ? response.status
                                                : 'null'
                                        }`;

                                    console.log(
                                        '[1min.ai] ❌ TOTP 驗證失敗：',
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

                                    return;
                                }

                                const token =
                                    result.token ||
                                    result.user?.token;

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

                                awaitPromise(
                                    this
                                        .displayCreditInfo(
                                            {
                                                user:
                                                    result.user,

                                                token
                                            }
                                        )
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

                            } catch (
                                parseError
                            ) {

                                console.log(
                                    '[1min.ai] ❌ TOTP 回應解析失敗：',
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
         * 顯示 Credit。
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

                let targetTeam =
                    null;

                for (
                    const team of
                        user.teams
                ) {

                    const subscriptionUserId =
                        team.team
                            ?.subscription
                            ?.userId;

                    if (
                        subscriptionUserId ===
                        user.uuid
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
                    targetTeam.team?.uuid;

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
                        targetTeam.team?.credit ||
                        0
                    );

                if (
                    !teamId ||
                    !token
                ) {

                    this.showCreditNotification(
                        userName,
                        initialCredit,
                        this.calculatePercent(
                            initialCredit,
                            usedCredit
                        )
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
                    '[1min.ai] ❌ Credit 處理失敗：',
                    String(error)
                );

                $notification.post(
                    '1min.ai',
                    '登入成功',
                    'Credit 查詢失敗'
                );
            }
        }

        /*
         * 每日獎勵。
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
                    '[1min.ai] 第一次 Credit：',
                    firstCredit
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

                const bonus =
                    finalCredit -
                    initialCredit;

                const percent =
                    this.calculatePercent(
                        finalCredit,
                        usedCredit
                    );

                console.log(
                    '[1min.ai] 最終 Credit：',
                    finalCredit
                );

                console.log(
                    '[1min.ai] 今日 Credit 變化：',
                    bonus
                );

                this.showCreditNotification(
                    userName,
                    finalCredit,
                    percent,
                    bonus
                );

            } catch (error) {

                console.log(
                    '[1min.ai] ❌ 每日獎勵檢查失敗：',
                    String(error)
                );

                this.showCreditNotification(
                    userName,
                    initialCredit,
                    this.calculatePercent(
                        initialCredit,
                        usedCredit
                    )
                );
            }
        }

        /*
         * 取得 Credit。
         */
        apiGetCredits(
            teamId,
            headers
        ) {

            return new Promise(
                resolve => {

                    const url =
                        `https://api.1min.ai/teams/${teamId}/credits`;

                    $httpClient.get(
                        {
                            url,
                            headers
                        },

                        (
                            error,
                            response,
                            data
                        ) => {

                            if (
                                error ||
                                !response ||
                                response.status !==
                                    200
                            ) {

                                resolve(
                                    0
                                );

                                return;
                            }

                            try {

                                const result =
                                    JSON.parse(
                                        data ||
                                        '{}'
                                    );

                                resolve(
                                    Number(
                                        result.credit ||
                                        0
                                    )
                                );

                            } catch (error) {

                                resolve(
                                    0
                                );
                            }
                        }
                    );
                }
            );
        }

        /*
         * 檢查通知。
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
                            url,
                            headers
                        },

                        (
                            error,
                            response,
                            data
                        ) => {

                            /*
                             * 這個 API 失敗時，
                             * 不阻止後續 Credit 查詢。
                             */
                            resolve();
                        }
                    );
                }
            );
        }

        /*
         * 數字格式化。
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
         * 計算百分比。
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
         * 顯示通知。
         */
        showCreditNotification(
            userName,
            credit,
            percent,
            bonus = 0
        ) {

            let message =
                `${userName} | 點數: ${this.formatNumber(credit)} (${percent}%)`;

            if (
                Number(
                    bonus
                ) > 0
            ) {

                message +=
                    ` (+${this.formatNumber(bonus)})`;
            }

            console.log(
                '[1min.ai]',
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
     * 輔助 Promise
     * ========================================
     */

    function awaitPromise(
        promise
    ) {

        return Promise.resolve(
            promise
        );
    }

    /*
     * ========================================
     * 主程式
     * ========================================
     */

    async function main() {

        const manager =
            new LoginManager(
                email,
                password,
                validTotpSecret
            );

        /*
         * 先嘗試已儲存 JWT。
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
                await manager.validateJWT(
                    saved.token,
                    saved.userData
                );

            if (
                valid
            ) {

                console.log(
                    '[1min.ai] JWT 有效，不需要重新登入'
                );

                await manager.displayCreditInfo(
                    {
                        user:
                            saved.userData,

                        token:
                            saved.token
                    }
                );

                $done();

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

            await manager.performLogin();

        } catch (error) {

            console.log(
                '[1min.ai] ❌ 執行失敗：',
                String(
                    error &&
                    error.message
                        ? error.message
                        : error
                )
            );

        } finally {

            $done();
        }
    }

    main();
}
