/*
 * 1min.ai 自動登入與每日獎勵
 *
 * Loon 移植版本：v20260830.01
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
 * 本版本主要針對 Loon 3.5.0 (975) 進行相容性調整。
 *
 * 調整內容：
 *   1. 保留原始 1min.ai 登入流程
 *   2. 保留帳號、密碼參數
 *   3. 保留可選 TOTP 雙因素驗證
 *   4. 保留 JWT 持久化儲存
 *   5. 保留 Team / Credit 查詢
 *   6. 保留每日獎勵檢查
 *   7. 將部分 Surge API 用法調整為 Loon API
 *   8. TOTP 函式庫載入方式調整為 Loon $httpClient
 *   9. 增加 Loon 執行日誌與錯誤處理
 *
 * 注意：
 *   本版本為 Loon 相容移植版本，
 *   原始邏輯與 API 設計以 7a6163 的版本為參考。
 */

/*
 * ================================
 * 取得參數
 * ================================
 *
 * Loon 可能傳入：
 *
 *   email=xxx&password=xxx&totp=xxx
 *
 * 也兼容物件形式。
 */

function getArguments() {
    try {
        if (
            typeof $argument === 'object' &&
            $argument !== null
        ) {
            return $argument;
        }

        const result = {};

        const raw = String(
            typeof $argument !== 'undefined'
                ? $argument
                : ''
        );

        if (!raw) {
            return result;
        }

        const text =
            raw.charAt(0) === '?'
                ? raw.slice(1)
                : raw;

        /*
         * 解析 URL 編碼參數
         */
        text.split('&').forEach(item => {
            const index = item.indexOf('=');

            if (index < 0) {
                return;
            }

            const key =
                decodeURIComponent(
                    item.slice(0, index)
                );

            const value =
                decodeURIComponent(
                    item.slice(index + 1)
                );

            result[key] = value;
        });

        return result;

    } catch (error) {
        console.log(
            '[1min.ai] 解析參數失敗：',
            String(error)
        );

        return {};
    }
}

const args =
    getArguments();

const email =
    args.email ||
    args.帳號 ||
    '';

const password =
    args.password ||
    args.密碼 ||
    '';

const totpSecretRaw =
    args.totp ||
    args.TOTP金鑰 ||
    '';

/*
 * 過濾無效 TOTP：
 *
 * 空字串
 * null
 * undefined
 * "null"
 */
const validTotpSecret =
    totpSecretRaw &&
    String(
        totpSecretRaw
    ).trim() !== '' &&
    String(
        totpSecretRaw
    ).trim().toLowerCase() !== 'null'
        ? String(
            totpSecretRaw
        ).trim()
        : null;

const SCRIPT_VERSION =
    'v20260830.01';

/*
 * ================================
 * 基本設定
 * ================================
 */

const JWT_KEY =
    `1min_jwt_${email}`;

const USER_DATA_KEY =
    `1min_user_${email}`;

const DEVICE_ID_KEY =
    `1min_device_${email}`;

/*
 * 輸出啟動訊息
 */
console.log(
    `[1min.ai] 自動登入 ${SCRIPT_VERSION}`
);

/*
 * ================================
 * 通知
 * ================================
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
 * ================================
 * 參數檢查
 * ================================
 */

if (
    !email ||
    !password
) {
    console.log(
        '[1min.ai] ❌ 缺少帳號或密碼'
    );

    notify(
        '1min 登入',
        '設定錯誤',
        '請檢查帳號與密碼參數'
    );

    $done();
}

/*
 * ================================
 * JWT 儲存管理
 * ================================
 */

function saveJWT(
    token,
    userData
) {
    try {
        $persistentStore.write(
            token,
            JWT_KEY
        );

        $persistentStore.write(
            JSON.stringify(
                userData
            ),
            USER_DATA_KEY
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

        const userDataStr =
            $persistentStore.read(
                USER_DATA_KEY
            );

        if (
            token &&
            userDataStr
        ) {

            const userData =
                JSON.parse(
                    userDataStr
                );

            return {
                token,
                userData
            };
        }

    } catch (error) {

        console.log(
            '[1min.ai] ❌ 載入 JWT 失敗：',
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

    } catch (error) {

        console.log(
            '[1min.ai] ❌ 清除 JWT 失敗：',
            String(error)
        );
    }
}

/*
 * ================================
 * 隨機裝置 ID
 * ================================
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

    /*
     * 優先使用已儲存的裝置 ID。
     *
     * 這樣每天登入不會一直產生
     * 全新的裝置識別。
     */
    try {

        const old =
            $persistentStore.read(
                DEVICE_ID_KEY
            );

        if (old) {
            return old;
        }

    } catch (error) {}

    const part1 =
        randomHex(16);

    const part2 =
        randomHex(15);

    const part3 =
        randomHex(8);

    const part4 =
        randomHex(6);

    const part5 =
        randomHex(16);

    const device =
        `$device:${part1}-${part2}-${part3}-${part4}-${part5}`;

    try {

        $persistentStore.write(
            device,
            DEVICE_ID_KEY
        );

    } catch (error) {}

    return device;
}

const deviceId =
    generateDeviceId();

/*
 * ================================
 * TOTP 動態載入
 * ================================
 *
 * 原始 Surge 版使用 fetch()。
 *
 * Loon 版改用 $httpClient.get()
 * 下載 OTPAuth 函式庫。
 */

let OTPAuth = null;

function loadOTPAuth() {

    return new Promise(
        (
            resolve,
            reject
        ) => {

            if (OTPAuth) {
                resolve(
                    OTPAuth
                );
                return;
            }

            const url =
                'https://cdn.jsdelivr.net/npm/otpauth@9.4.0/dist/otpauth.umd.min.js';

            console.log(
                '[1min.ai] 載入 TOTP 函式庫'
            );

            $httpClient.get(
                {
                    url: url,

                    headers: {
                        'User-Agent':
                            'Mozilla/5.0',

                        'Accept':
                            '*/*'
                    },

                    'auto-cookie':
                        false
                },

                (
                    error,
                    response,
                    data
                ) => {

                    if (error) {

                        console.log(
                            '[1min.ai] ❌ TOTP 函式庫下載失敗：',
                            String(
                                error
                            )
                        );

                        reject(
                            error
                        );

                        return;
                    }

                    if (
                        !response ||
                        Number(
                            response.status
                        ) !== 200
                    ) {

                        reject(
                            new Error(
                                `TOTP 函式庫 HTTP ${response ? response.status : 'null'}`
                            )
                        );

                        return;
                    }

                    try {

                        /*
                         * 執行 UMD 函式庫。
                         */
                        eval(
                            String(
                                data ||
                                ''
                            )
                        );

                        /*
                         * 嘗試從全域環境取得 OTPAuth。
                         */
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

                        /*
                         * 某些 JavaScript 執行環境
                         * eval 後可以直接取得變數。
                         */
                        if (
                            !OTPAuth &&
                            typeof window !==
                            'undefined'
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
                            '[1min.ai] ❌ TOTP 函式庫解析失敗：',
                            String(
                                parseError
                            )
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
 * ================================
 * 登入管理
 * ================================
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
     * 建立 API Headers
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
     * 驗證已儲存 JWT 是否仍然有效
     */
    async validateJWT(
        token,
        userData
    ) {

        const teams =
            userData &&
            Array.isArray(
                userData.teams
            )
                ? userData.teams
                : [];

        const firstTeam =
            teams[0];

        const teamId =
            firstTeam &&
            (
                firstTeam.teamId ||
                (
                    firstTeam.team &&
                    firstTeam.team.uuid
                )
            );

        if (!teamId) {
            return false;
        }

        try {

            const headers =
                this.buildApiHeaders(
                    token
                );

            const credit =
                await this.apiGetCredits(
                    teamId,
                    headers
                );

            return (
                Number(credit) >
                0
            );

        } catch (error) {

            console.log(
                '[1min.ai] 已儲存 JWT 無法使用'
            );

            return false;
        }
    }

    /*
     * 執行登入
     */
    async performLogin() {

        const loginUrl =
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

        return new Promise(
            (
                resolve,
                reject
            ) => {

                $httpClient.post(
                    {
                        url:
                            loginUrl,

                        headers:
                            headers,

                        body:
                            body,

                        'auto-cookie':
                            false
                    },

                    (
                        error,
                        response,
                        data
                    ) => {

                        if (error) {

                            console.log(
                                '[1min.ai] ❌ 登入請求失敗：',
                                String(
                                    error
                                )
                            );

                            notify(
                                '1min 登入',
                                '網路錯誤',
                                '請檢查網路連線'
                            );

                            reject(
                                error
                            );

                            return;
                        }

                        try {

                            const responseData =
                                JSON.parse(
                                    data ||
                                    '{}'
                                );

                            const status =
                                response
                                    ? Number(
                                        response.status
                                    )
                                    : 0;

                            console.log(
                                '[1min.ai] 登入 HTTP 狀態：',
                                status
                            );

                            /*
                             * 登入成功
                             */
                            if (
                                status ===
                                    200 &&
                                responseData.user
                            ) {

                                /*
                                 * 需要 TOTP
                                 */
                                if (
                                    responseData
                                        .user
                                        .mfaRequired
                                ) {

                                    if (
                                        this.totpSecret
                                    ) {

                                        this.performMFAVerification(
                                            responseData
                                                .user
                                                .token
                                        )
                                        .then(
                                            resolve
                                        )
                                        .catch(
                                            reject
                                        );

                                    } else {

                                        console.log(
                                            '[1min.ai] ❌ 需要 TOTP，但沒有提供金鑰'
                                        );

                                        notify(
                                            '1min 登入',
                                            '需要 TOTP',
                                            '請在 Plugin 參數中填入 TOTP 金鑰'
                                        );

                                        reject(
                                            new Error(
                                                'Missing TOTP secret'
                                            )
                                        );
                                    }

                                    return;
                                }

                                /*
                                 * 儲存 JWT
                                 */
                                const token =
                                    responseData.token ||
                                    (
                                        responseData.user &&
                                        responseData.user.token
                                    );

                                if (
                                    token
                                ) {

                                    saveJWT(
                                        token,
                                        responseData.user
                                    );
                                }

                                this.displayCreditInfo(
                                    responseData
                                )
                                .then(
                                    () =>
                                        resolve(
                                            responseData
                                        )
                                )
                                .catch(
                                    reject
                                );

                                return;
                            }

                            /*
                             * 登入失敗
                             */
                            console.log(
                                '[1min.ai] ❌ 登入失敗，HTTP：',
                                status
                            );

                            let errorMsg =
                                '登入失敗';

                            if (
                                responseData.message
                            ) {

                                errorMsg =
                                    responseData.message;

                            } else if (
                                status ===
                                401
                            ) {

                                errorMsg =
                                    '帳號或密碼錯誤';

                            } else if (
                                status ===
                                429
                            ) {

                                errorMsg =
                                    '請求過於頻繁，請稍後再試';
                            }

                            notify(
                                '1min 登入',
                                '登入失敗',
                                errorMsg
                            );

                            reject(
                                new Error(
                                    errorMsg
                                )
                            );

                        } catch (
                            parseError
                        ) {

                            console.log(
                                '[1min.ai] ❌ JSON 解析錯誤：',
                                String(
                                    parseError
                                )
                            );

                            notify(
                                '1min 登入',
                                '回應錯誤',
                                '伺服器回應格式異常'
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
     * TOTP 驗證
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

        const totpCode =
            totp.generate();

        console.log(
            '[1min.ai] 已產生 TOTP 驗證碼'
        );

        const mfaUrl =
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
                    totpCode,

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
                            mfaUrl,

                        headers:
                            headers,

                        body:
                            body,

                        'auto-cookie':
                            false
                    },

                    (
                        error,
                        response,
                        data
                    ) => {

                        if (error) {

                            console.log(
                                '[1min.ai] ❌ TOTP 驗證請求失敗：',
                                String(
                                    error
                                )
                            );

                            notify(
                                '1min 登入',
                                'TOTP 網路錯誤',
                                String(
                                    error
                                )
                            );

                            reject(
                                error
                            );

                            return;
                        }

                        try {

                            const responseData =
                                JSON.parse(
                                    data ||
                                    '{}'
                                );

                            const status =
                                response
                                    ? Number(
                                        response.status
                                    )
                                    : 0;

                            if (
                                status ===
                                200
                            ) {

                                const token =
                                    responseData.token ||
                                    (
                                        responseData.user &&
                                        responseData.user.token
                                    );

                                if (
                                    token
                                ) {

                                    saveJWT(
                                        token,
                                        responseData.user
                                    );
                                }

                                this.displayCreditInfo(
                                    responseData
                                )
                                .then(
                                    () =>
                                        resolve(
                                            responseData
                                        )
                                )
                                .catch(
                                    reject
                                );

                            } else {

                                const errorMsg =
                                    responseData.message ||
                                    `HTTP ${status}`;

                                console.log(
                                    '[1min.ai] ❌ TOTP 驗證失敗：',
                                    errorMsg
                                );

                                notify(
                                    '1min 登入',
                                    'TOTP 失敗',
                                    errorMsg
                                );

                                reject(
                                    new Error(
                                        errorMsg
                                    )
                                );
                            }

                        } catch (
                            parseError
                        ) {

                            console.log(
                                '[1min.ai] ❌ TOTP 回應解析錯誤：',
                                String(
                                    parseError
                                )
                            );

                            notify(
                                '1min 登入',
                                'TOTP 回應錯誤',
                                '無法解析驗證回應'
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
     * 顯示 Credit 資訊
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
                user.teams.length === 0
            ) {

                console.log(
                    '[1min.ai] ⚠️ 無法取得 Credit 資訊'
                );

                notify(
                    '1min 登入',
                    '登入成功',
                    '歡迎回來！'
                );

                return;
            }

            const authToken =
                responseData.token ||
                (
                    user.token
                );

            const userUuid =
                user.uuid;

            let targetTeam =
                null;

            /*
             * 優先尋找 subscription.userId
             * 與目前使用者 UUID 相同的 Team。
             */
            for (
                const team of
                    user.teams
            ) {

                const subscriptionUserId =
                    team.team &&
                    team.team.subscription &&
                    team.team.subscription.userId;

                if (
                    subscriptionUserId ===
                    userUuid
                ) {

                    targetTeam =
                        team;

                    break;
                }
            }

            /*
             * 找不到時使用第一個 Team。
             */
            if (
                !targetTeam &&
                user.teams.length > 0
            ) {

                targetTeam =
                    user.teams[0];
            }

            if (
                !targetTeam
            ) {

                console.log(
                    '[1min.ai] ❌ 無法找到任何 Team'
                );

                notify(
                    '1min 登入',
                    '登入成功',
                    '歡迎回來！'
                );

                return;
            }

            const teamInfo =
                targetTeam;

            const teamId =
                teamInfo.teamId ||
                (
                    teamInfo.team &&
                    teamInfo.team.uuid
                );

            const userName =
                teamInfo.userName ||
                (
                    user.email &&
                    user.email.split('@')[0]
                ) ||
                '用戶';

            const usedCredit =
                Number(
                    teamInfo.usedCredit ||
                    0
                );

            const initialCredit =
                Number(
                    (
                        teamInfo.team &&
                        teamInfo.team.credit
                    ) ||
                    0
                );

            if (
                !teamId ||
                !authToken
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

            /*
             * 檢查每日獎勵
             */
            await this.checkDailyBonus(
                teamId,
                authToken,
                userName,
                usedCredit,
                initialCredit
            );

        } catch (error) {

            console.log(
                '[1min.ai] ❌ 顯示 Credit 資訊時發生錯誤：',
                String(
                    error
                )
            );

            notify(
                '1min 登入',
                '登入成功',
                '歡迎回來！'
            );
        }
    }

    /*
     * 檢查每日獎勵
     */
    async checkDailyBonus(
        teamId,
        authToken,
        userName,
        usedCredit,
        initialCredit
    ) {

        const headers =
            this.buildApiHeaders(
                authToken
            );

        try {

            /*
             * 第一步：
             * 呼叫未讀通知 API，
             * 觸發每日獎勵。
             */
            await this.apiCheckNotifications(
                headers
            );

            /*
             * 第二步：
             * 取得第一次 Credit。
             */
            const firstCredit =
                await this.apiGetCredits(
                    teamId,
                    headers
                );

            const firstBonus =
                firstCredit -
                initialCredit;

            console.log(
                '[1min.ai] 第一次 Credit：',
                firstCredit,
                `變化=${firstBonus}`
            );

            /*
             * 第三步：
             * 等待三秒。
             */
            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        3000
                    )
            );

            /*
             * 第四步：
             * 再取得一次 Credit。
             */
            const finalCredit =
                await this.apiGetCredits(
                    teamId,
                    headers
                );

            const totalBonus =
                finalCredit -
                initialCredit;

            const percent =
                this.calculatePercent(
                    finalCredit,
                    usedCredit
                );

            /*
             * 顯示最終結果。
             */
            this.showCreditNotification(
                userName,
                finalCredit,
                percent,
                totalBonus
            );

        } catch (error) {

            console.log(
                '[1min.ai] ❌ 每日獎勵檢查失敗：',
                String(
                    error
                )
            );

            /*
             * 如果每日獎勵檢查失敗，
             * 至少顯示目前已知 Credit。
             */
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
     * 取得 Credit
     */
    apiGetCredits(
        teamId,
        headers
    ) {

        return new Promise(
            resolve => {

                const url =
                    `https://api.1min.ai/teams/${teamId}/credits`;

                /*
                 * 這裡的 setTimeout
                 * 是腳本自己的等待保護，
                 * 不是 $httpClient 的 timeout 參數。
                 */
                const timer =
                    setTimeout(
                        () => {
                            resolve(0);
                        },
                        10000
                    );

                $httpClient.get(
                    {
                        url:
                            url,

                        headers:
                            headers,

                        'auto-cookie':
                            false
                    },

                    (
                        error,
                        response,
                        data
                    ) => {

                        clearTimeout(
                            timer
                        );

                        if (
                            error ||
                            !response ||
                            Number(
                                response.status
                            ) !== 200
                        ) {

                            resolve(0);

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

                        } catch (
                            error
                        ) {

                            resolve(0);
                        }
                    }
                );
            }
        );
    }

    /*
     * 檢查未讀通知。
     *
     * 這個 API 用來觸發每日獎勵。
     */
    apiCheckNotifications(
        headers
    ) {

        return new Promise(
            resolve => {

                const url =
                    'https://api.1min.ai/notifications/unread';

                const timer =
                    setTimeout(
                        () => {
                            resolve();
                        },
                        10000
                    );

                $httpClient.get(
                    {
                        url:
                            url,

                        headers:
                            headers,

                        'auto-cookie':
                            false
                    },

                    (
                        error,
                        response,
                        data
                    ) => {

                        clearTimeout(
                            timer
                        );

                        /*
                         * 原始腳本不要求這個 API
                         * 一定有特定回應內容。
                         *
                         * 因此即使失敗也繼續流程。
                         */
                        resolve();
                    }
                );
            }
        );
    }

    /*
     * 數字格式化
     */
    formatNumber(
        num
    ) {

        return Number(
            num || 0
        ).toLocaleString(
            'zh-TW'
        );
    }

    /*
     * 計算 Credit 百分比
     */
    calculatePercent(
        remainingCredit,
        usedCredit
    ) {

        const remaining =
            Number(
                remainingCredit ||
                0
            );

        const used =
            Number(
                usedCredit ||
                0
            );

        const total =
            remaining +
            used;

        return total > 0
            ? (
                (
                    remaining /
                    total
                ) *
                100
            ).toFixed(1)
            : 0;
    }

    /*
     * 顯示 Credit 通知
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
            Number(bonus) > 0
        ) {

            message +=
                ` (+${this.formatNumber(bonus)})`;
        }

        notify(
            '1min 登入',
            '登入成功',
            message
        );

        console.log(
            '[1min.ai]',
            message
        );
    }
}

/*
 * ================================
 * 主程式
 * ================================
 */

async function main() {

    const loginManager =
        new LoginManager(
            email,
            password,
            validTotpSecret
        );

    /*
     * 優先使用已儲存 JWT。
     */
    const savedData =
        loadJWT();

    if (
        savedData
    ) {

        console.log(
            '[1min.ai] 發現已儲存 JWT，先驗證'
        );

        const isValid =
            await loginManager.validateJWT(
                savedData.token,
                savedData.userData
            );

        if (
            isValid
        ) {

            console.log(
                '[1min.ai] JWT 有效，不需要重新登入'
            );

            /*
             * 取得最新 Team / Credit。
             */
            const headers =
                loginManager.buildApiHeaders(
                    savedData.token
                );

            const userUuid =
                savedData.userData.uuid;

            let targetTeam =
                null;

            const teams =
                Array.isArray(
                    savedData.userData.teams
                )
                    ? savedData.userData.teams
                    : [];

            for (
                const team of
                    teams
            ) {

                const subscriptionUserId =
                    team.team &&
                    team.team.subscription &&
                    team.team.subscription.userId;

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
                !targetTeam &&
                teams.length > 0
            ) {

                targetTeam =
                    teams[0];
            }

            if (
                targetTeam
            ) {

                const teamId =
                    targetTeam.teamId ||
                    (
                        targetTeam.team &&
                        targetTeam.team.uuid
                    );

                const currentCredit =
                    await loginManager.apiGetCredits(
                        teamId,
                        headers
                    );

                if (
                    currentCredit > 0 &&
                    targetTeam.team
                ) {

                    targetTeam.team.credit =
                        currentCredit;
                }
            }

            /*
             * 建立與登入回應相同的資料格式。
             */
            const responseData = {

                user:
                    savedData.userData,

                token:
                    savedData.token
            };

            /*
             * 執行每日獎勵。
             */
            await loginManager.displayCreditInfo(
                responseData
            );

            $done();

            return;
        }

        /*
         * JWT 已失效。
         */
        console.log(
            '[1min.ai] 儲存的 JWT 已失效，清除後重新登入'
        );

        clearJWT();
    }

    /*
     * 沒有有效 JWT，
     * 執行正常登入。
     */
    try {

        await loginManager.performLogin();

    } catch (error) {

        console.log(
            '[1min.ai] ❌ 登入失敗：',
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

/*
 * 開始執行
 */
main();
