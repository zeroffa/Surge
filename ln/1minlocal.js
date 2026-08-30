/*
 * ========================================
 * 1min.ai 自動登入
 * ========================================
 *
 * Loon 版本：3.5.0 (975)
 * 腳本版本：v20260830.05
 *
 * 參考來源：
 * 7a6163/Surge
 *
 * 原始腳本：
 * https://github.com/7a6163/Surge/blob/main/Script/1min-login.js
 *
 * 本版本修改：
 * 1. 移除 $argument 參數依賴
 * 2. 帳號、密碼、TOTP 直接設定於本 JS
 * 3. 保留原始登入流程
 * 4. 保留 TOTP 驗證
 * 5. 保留 JWT 本機儲存
 * 6. 保留 Credit 查詢
 * 7. 保留每日獎勵檢查
 * 8. 相容 Loon 3.5.0
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
     * 如果帳號沒有啟用 TOTP：
     *
     * totpSecret: null
     *
     * 如果有啟用：
     *
     * totpSecret: '你的TOTP金鑰'
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
 * 請使用 Loon 本機 Script 的 Cron
 * 來啟動本 JS。
 *
 * 例如：
 *
 * 10 16 * * *
 *
 * 代表每天 16:10 執行。
 *
 * 這裡僅作為備註，不會實際啟用。
 */

// const CRON = '10 16 * * *';


/*
 * ========================================
 * 基本版本資訊
 * ========================================
 */

const SCRIPT_VERSION =
    'v20260830.05';

console.log(
    `[1min.ai] 自動登入 ${SCRIPT_VERSION}`
);

console.log(
    '[1min.ai] 參考來源：7a6163/Surge'
);


/*
 * ========================================
 * 讀取使用者設定
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
 * 參數檢查
 * ========================================
 */

console.log(
    '[1min.ai] 帳號參數：',
    email ? '已設定' : '未設定'
);

console.log(
    '[1min.ai] 密碼參數：',
    password ? '已設定' : '未設定'
);

console.log(
    '[1min.ai] TOTP：',
    totpSecret
        ? '已設定'
        : '未設定'
);


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
 * JWT 儲存管理
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

let OTPAuth;


async function loadOTPAuth() {

    if (
        OTPAuth
    ) {

        return OTPAuth;
    }

    try {

        console.log(
            '[1min.ai] 載入 TOTP 函式庫'
        );

        const response =
            await fetch(
                'https://cdn.jsdelivr.net/npm/otpauth@9.4.0/dist/otpauth.umd.min.js'
            );

        const code =
            await response.text();

        eval(code);

        OTPAuth =
            this.OTPAuth ||
            window.OTPAuth ||
            global.OTPAuth;

        if (
            !OTPAuth
        ) {

            throw new Error(
                '無法取得 OTPAuth'
            );
        }

        console.log(
            '[1min.ai] TOTP 函式庫載入成功'
        );

        return OTPAuth;

    } catch (error) {

        console.log(
            '[1min.ai] ❌ 載入 OTPAuth 失敗：',
            String(error)
        );

        throw error;
    }
}


/*
 * ========================================
 * 隨機裝置 ID
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

    return (
        '$device:' +
        part1 +
        '-' +
        part2 +
        '-' +
        part3 +
        '-' +
        part4 +
        '-' +
        part5
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
     * 建立 API Header
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
     * ========================================
     * 驗證 JWT
     * ========================================
     */

    async validateJWT(
        token,
        userData
    ) {

        const headers =
            this.buildApiHeaders(
                token
            );

        const teamId =
            userData
                ?.teams
                ?.[0]
                ?.teamId ||
            userData
                ?.teams
                ?.[0]
                ?.team
                ?.uuid;

        if (
            !teamId
        ) {

            return false;
        }

        try {

            /*
             * 使用 Credit API 驗證 JWT。
             */

            const credit =
                await this.apiGetCredits(
                    teamId,
                    headers
                );

            if (
                credit > 0
            ) {

                return true;
            }

        } catch (error) {

            console.log(
                '[1min.ai] JWT 驗證失敗'
            );
        }

        return false;
    }


    /*
     * ========================================
     * 登入
     * ========================================
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
                            loginUrl,

                        headers,

                        body,

                        timeout:
                            30000
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
                                '[1min.ai] ❌ 登入請求失敗：',
                                String(error)
                            );

                            $notification.post(
                                '1min.ai',
                                '網路錯誤',
                                String(error)
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
                                    ? response.status
                                    : null;

                            console.log(
                                '[1min.ai] 登入 HTTP 狀態：',
                                status
                            );

                            if (
                                status === 200 &&
                                responseData.user
                            ) {

                                /*
                                 * 需要 TOTP。
                                 */

                                if (
                                    responseData
                                        .user
                                        .mfaRequired
                                ) {

                                    if (
                                        this.totpSecret
                                    ) {

                                        this
                                            .performMFAVerification(
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
                                            '[1min.ai] ❌ 需要 TOTP，但未設定金鑰'
                                        );

                                        $notification.post(
                                            '1min.ai',
                                            '需要 TOTP',
                                            '請在 JS 最上方設定 TOTP 金鑰'
                                        );

                                        reject(
                                            new Error(
                                                'Missing TOTP secret'
                                            )
                                        );
                                    }

                                } else {

                                    const token =
                                        responseData.token ||
                                        responseData
                                            .user
                                            ?.token;

                                    if (
                                        token
                                    ) {

                                        saveJWT(
                                            token,
                                            responseData.user
                                        );
                                    }

                                    this
                                        .displayCreditInfo(
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
                                }

                            } else {

                                let errorMsg =
                                    '登入失敗';

                                if (
                                    responseData
                                        .message
                                ) {

                                    errorMsg =
                                        responseData
                                            .message;

                                } else if (
                                    status === 401
                                ) {

                                    errorMsg =
                                        '帳號或密碼錯誤';

                                } else if (
                                    status === 429
                                ) {

                                    errorMsg =
                                        '請求過於頻繁，請稍後再試';
                                }

                                console.log(
                                    '[1min.ai] ❌ 登入失敗：',
                                    errorMsg
                                );

                                $notification.post(
                                    '1min.ai',
                                    '登入失敗',
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
                                '[1min.ai] ❌ JSON 解析錯誤：',
                                String(parseError)
                            );

                            $notification.post(
                                '1min.ai',
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

        const totpCode =
            totp.generate();

        console.log(
            '[1min.ai] TOTP 驗證碼已產生'
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

                        headers,

                        body,

                        timeout:
                            30000
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
                                '[1min.ai] ❌ TOTP 驗證請求失敗：',
                                String(error)
                            );

                            $notification.post(
                                '1min.ai',
                                'TOTP 網路錯誤',
                                String(error)
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
                                    ? response.status
                                    : null;

                            if (
                                status === 200
                            ) {

                                const token =
                                    responseData.token ||
                                    responseData
                                        .user
                                        ?.token;

                                if (
                                    token
                                ) {

                                    saveJWT(
                                        token,
                                        responseData.user
                                    );
                                }

                                this
                                    .displayCreditInfo(
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
                                    responseData
                                        .message ||
                                    `HTTP ${status}`;

                                console.log(
                                    '[1min.ai] ❌ TOTP 驗證失敗：',
                                    errorMsg
                                );

                                $notification.post(
                                    '1min.ai',
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
                                String(parseError)
                            );

                            $notification.post(
                                '1min.ai',
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
     * ========================================
     * 顯示 Credit
     * ========================================
     */

    async displayCreditInfo(
        responseData
    ) {

        try {

            const user =
                responseData.user;

            if (
                !user?.teams ||
                user.teams.length === 0
            ) {

                console.log(
                    '[1min.ai] ⚠️ 無法取得 Credit 資訊'
                );

                $notification.post(
                    '1min.ai',
                    '登入成功',
                    '歡迎回來！'
                );

                return;
            }

            const authToken =
                responseData.token ||
                responseData
                    .user
                    ?.token;

            const userUuid =
                user.uuid;

            /*
             * 找到對應 Team。
             */

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
                    '[1min.ai] ❌ 無法找到 Team'
                );

                $notification.post(
                    '1min.ai',
                    '登入成功',
                    '無法取得 Team 資訊'
                );

                return;
            }

            const teamInfo =
                targetTeam;

            const teamId =
                teamInfo.teamId ||
                teamInfo
                    .team
                    ?.uuid;

            const userName =
                teamInfo.userName ||
                user.email
                    ?.split('@')[0] ||
                '用戶';

            const usedCredit =
                Number(
                    teamInfo.usedCredit ||
                    0
                );

            const initialCredit =
                Number(
                    teamInfo
                        .team
                        ?.credit ||
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
             * 檢查每日獎勵。
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
             * 第一次檢查通知。
             */

            await this.apiCheckNotifications(
                headers
            );

            /*
             * 取得第一次 Credit。
             */

            const firstCredit =
                await this.apiGetCredits(
                    teamId,
                    headers
                );

            console.log(
                '[1min.ai] 第一次 Credit：',
                firstCredit
            );

            /*
             * 等待 3 秒。
             */

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        3000
                    )
            );

            /*
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

            console.log(
                '[1min.ai] 最終 Credit：',
                finalCredit
            );

            console.log(
                '[1min.ai] 今日 Credit 變化：',
                totalBonus
            );

            this.showCreditNotification(
                userName,
                finalCredit,
                percent,
                totalBonus
            );

        } catch (error) {

            console.log(
                '[1min.ai] ❌ 簽到檢查失敗：',
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
                    `https://api.1min.ai/teams/${teamId}/credits`;

                $httpClient.get(
                    {
                        url,

                        headers,

                        timeout:
                            15000
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
     * ========================================
     * 未讀通知 API
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
                        url,

                        headers,

                        timeout:
                            15000
                    },

                    (
                        error,
                        response,
                        data
                    ) => {

                        /*
                         * 即使通知 API 失敗，
                         * 也不阻止後續流程。
                         */

                        if (
                            error
                        ) {

                            console.log(
                                '[1min.ai] ⚠️ 通知 API 請求失敗'
                            );

                        }

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
        num
    ) {

        return Number(
            num || 0
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
        remainingCredit,
        usedCredit
    ) {

        const total =
            Number(
                remainingCredit || 0
            ) +
            Number(
                usedCredit || 0
            );

        return (
            total > 0
                ? (
                    (
                        Number(
                            remainingCredit ||
                            0
                        ) /
                        total
                    ) *
                    100
                ).toFixed(1)
                : '0.0'
        );
    }


    /*
     * ========================================
     * 登入成功通知
     * ========================================
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
     * 先嘗試使用已儲存 JWT。
     */

    const savedData =
        loadJWT();

    if (
        savedData
    ) {

        console.log(
            '[1min.ai] 發現已儲存 JWT，開始驗證'
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
                '[1min.ai] JWT 仍然有效'
            );

            /*
             * 取得最新 Credit。
             */

            const headers =
                loginManager.buildApiHeaders(
                    savedData.token
                );

            const userUuid =
                savedData
                    .userData
                    .uuid;

            let targetTeam =
                null;

            for (
                const team of
                    savedData
                        .userData
                        .teams
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
                !targetTeam &&
                savedData
                    .userData
                    .teams
                    .length > 0
            ) {

                targetTeam =
                    savedData
                        .userData
                        .teams[0];
            }

            if (
                targetTeam
            ) {

                const teamId =
                    targetTeam.teamId ||
                    targetTeam
                        .team
                        ?.uuid;

                const currentCredit =
                    await loginManager
                        .apiGetCredits(
                            teamId,
                            headers
                        );

                if (
                    currentCredit > 0
                ) {

                    if (
                        targetTeam.team
                    ) {

                        targetTeam
                            .team
                            .credit =
                            currentCredit;
                    }
                }
            }

            /*
             * 重建登入回應資料。
             */

            const responseData = {

                user:
                    savedData.userData,

                token:
                    savedData.token
            };

            /*
             * 執行每日獎勵檢查。
             */

            await loginManager
                .displayCreditInfo(
                    responseData
                );

            $done();

            return;
        }

        console.log(
            '[1min.ai] JWT 已失效，清除後重新登入'
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
 * ========================================
 * 開始執行
 * ========================================
 */

main();

}
