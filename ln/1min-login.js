/*
 * 1min.ai Loon 參數測試
 * v20260830.03
 *
 * 用途：
 * 確認 Loon 3.5.0 (975)
 * 實際傳入 $argument 的資料型態與內容。
 */

console.log(
    '[1min.ai TEST] JS v20260830.03'
);

console.log(
    '[1min.ai TEST] typeof $argument =',
    typeof $argument
);

console.log(
    '[1min.ai TEST] $argument =',
    $argument
);

try {

    console.log(
        '[1min.ai TEST] JSON.stringify =',
        JSON.stringify($argument)
    );

} catch (error) {

    console.log(
        '[1min.ai TEST] JSON.stringify 失敗：',
        String(error)
    );
}

$notification.post(
    '1min.ai 參數測試',
    'Loon 3.5.0',
    `typeof=${typeof $argument}`
);

$done();
