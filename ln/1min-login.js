/*
 * 1min.ai Loon argument 測試
 *
 * 版本：v20260830.04
 * 適用：Loon 3.5.0 (975)
 *
 * 目的：
 * 確認舊版 Script 的 argument
 * 是否能正常傳入 $argument。
 */

console.log(
    '[1min.ai TEST] JS v20260830.04'
);

console.log(
    '[1min.ai TEST] typeof $argument =',
    typeof $argument
);

console.log(
    '[1min.ai TEST] $argument =',
    String($argument)
);

$notification.post(
    '1min.ai 參數測試',
    'Loon 3.5.0',
    String($argument)
);

$done();
