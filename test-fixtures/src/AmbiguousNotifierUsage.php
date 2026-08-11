<?php

namespace App\SomeOtherNamespace;

class AmbiguousNotifierUsage
{
    public function run(): Notifier
    {
        return new Notifier();
    }
}
