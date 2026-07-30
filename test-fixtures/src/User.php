<?php

namespace App\Models;

class User
{
    public $name;

    protected static $count = 0;

    const STATUS_ACTIVE = 1;

    public function __construct(string $name)
    {
        $this->name = $name;
    }

    public function greet(int $times = 1): string
    {
        $result = '';
        for ($i = 0; $i < $times; $i++) {
            $result .= "Hello, {$this->name}!\n";
        }
        return $result;
    }
}

function makeUser($name)
{
    return new User($name);
}
