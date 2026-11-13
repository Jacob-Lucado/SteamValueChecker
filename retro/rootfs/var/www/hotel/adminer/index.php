<?php

// The hotel's database, for staff only. nginx checks Housekeeping access first (check.php),
// so Adminer signs straight in with the hotel's own database account.

namespace {
    $credentials = require __DIR__ . '/credentials.php';

    if (! isset($_GET['username'])) {
        $_POST['auth'] = ['driver' => 'server', 'server' => '127.0.0.1', 'username' => 'hotel', 'password' => '', 'db' => 'plus'];
    }

    function adminer_object()
    {
        global $credentials;

        return new class($credentials) extends \Adminer\Adminer
        {
            public function __construct(private array $credentials) {}

            public function name()
            {
                return 'Hotel database';
            }

            public function credentials()
            {
                return ['127.0.0.1', 'hotel', $this->credentials['password']];
            }

            public function database()
            {
                return 'plus';
            }

            public function login($login, $password)
            {
                return true;
            }

            // The sign-in is filled in above, not typed into a form, so there is no form token to check.
            public function verifyLoginToken()
            {
                return false;
            }
        };
    }

    require __DIR__ . '/adminer.php';
}
