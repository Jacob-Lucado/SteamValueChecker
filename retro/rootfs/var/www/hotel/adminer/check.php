<?php

// nginx asks this before every database page: 204 lets staff with Housekeeping access through, 403 sends anyone else away.

use App\Models\User;
use App\Services\HousekeepingPermissionsService;
use Illuminate\Cookie\CookieValuePrefix;

require '/var/www/hotel/cms/vendor/autoload.php';
$app = require '/var/www/hotel/cms/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$allowed = false;

try {
    $cookie = $_COOKIE[config('session.cookie')] ?? null;

    if (is_string($cookie)) {
        $sessionId = CookieValuePrefix::remove(app('encrypter')->decrypt($cookie, false));
        $session = app('session')->driver();
        $session->setId($sessionId);
        $session->start();

        $user = User::find($session->get(auth()->guard('web')->getName()));
        $allowed = $user !== null && app(HousekeepingPermissionsService::class)->allows($user, 'can_access_housekeeping');
    }
} catch (Throwable) {
    $allowed = false;
}

http_response_code($allowed ? 204 : 403);
