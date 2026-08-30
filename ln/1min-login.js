/*
 * Loon 3.5.0 參數測試
 *
 * v20260830.04
 *
 * 用途：
 * 確認舊版 Plugin [Argument]
 * 是否可以透過 ${參數} 展開後
 * 傳入 script 的 argument。
 */

console.log(
    '[1min.ai TEST] v20260830.04'
);

console.log(
    '[1min.ai TEST] typeof $argument =',
    typeof $argument
);

console.log(
    '[1min.ai TEST] $argument =',
    $argument
);

$notification.post(
    '1min.ai 參數測試',
    'Loon 3.5.0',
    String($argument)
);

$done();
