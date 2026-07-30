<?php

namespace App;

use App\Models\User;

class Usage
{
    public function run(): void
    {
        $user = new User('Ada');
        echo $user->greet(2);
    }
}
