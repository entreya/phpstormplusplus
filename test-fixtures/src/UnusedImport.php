<?php

namespace App;

use App\Models\User;
use App\Models\Greeter;

class UnusedImport
{
    public function run(): void
    {
        $g = new Greeter();
    }
}
