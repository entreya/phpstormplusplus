export interface LiveTemplate {
  abbreviation: string;
  description: string;
  /** VS Code snippet syntax: $1, $2, ${1:default}, $0 for final cursor position. */
  body: string;
}

export const DEFAULT_TEMPLATES: LiveTemplate[] = [
  { abbreviation: 'fore', description: 'foreach loop', body: 'foreach (\\$${1:items} as \\$${2:item}) {\n    $0\n}' },
  { abbreviation: 'forek', description: 'foreach with key => value', body: 'foreach (\\$${1:items} as \\$${2:key} => \\$${3:value}) {\n    $0\n}' },
  { abbreviation: 'iff', description: 'if statement', body: 'if (${1:condition}) {\n    $0\n}' },
  { abbreviation: 'ifel', description: 'if/else statement', body: 'if (${1:condition}) {\n    $2\n} else {\n    $0\n}' },
  { abbreviation: 'inv', description: 'inverted if (guard clause)', body: 'if (!${1:condition}) {\n    $0\n}' },
  { abbreviation: 'try', description: 'try/catch', body: 'try {\n    $1\n} catch (\\\\Throwable \\$${2:e}) {\n    $0\n}' },
  { abbreviation: 'func', description: 'function declaration', body: 'function ${1:name}($2)\n{\n    $0\n}' },
  { abbreviation: 'pubf', description: 'public method', body: 'public function ${1:name}($2)\n{\n    $0\n}' },
  { abbreviation: 'protf', description: 'protected method', body: 'protected function ${1:name}($2)\n{\n    $0\n}' },
  { abbreviation: 'privf', description: 'private method', body: 'private function ${1:name}($2)\n{\n    $0\n}' },
  { abbreviation: 'psvm', description: 'public static function', body: 'public static function ${1:name}($2)\n{\n    $0\n}' },
  { abbreviation: 'docb', description: 'PHPDoc block', body: '/**\n * $0\n */' },
  { abbreviation: 'switch', description: 'switch statement', body: 'switch (\\$${1:subject}) {\n    case ${2:value}:\n        $0\n        break;\n    default:\n        break;\n}' },
  { abbreviation: 'match', description: 'match expression (PHP 8)', body: 'match (\\$${1:subject}) {\n    ${2:value} => $0,\n    default => null,\n};' },
  { abbreviation: 'class', description: 'class declaration', body: 'class ${1:Name}\n{\n    $0\n}' },
  { abbreviation: 'interface', description: 'interface declaration', body: 'interface ${1:Name}\n{\n    $0\n}' },
  { abbreviation: 'test', description: 'PHPUnit test method', body: 'public function test${1:Behavior}(): void\n{\n    $0\n}' },
  { abbreviation: 'throwex', description: 'throw exception', body: 'throw new \\\\${1:Exception}(\'${0:message}\');' },
  { abbreviation: 'vecho', description: 'echo <pre>, var_dump, die', body: 'echo \'<pre>\';\nvar_dump(\\$${1:var});\ndie;' },
  { abbreviation: 'pecho', description: 'echo <pre>, print_r, die', body: 'echo \'<pre>\';\nprint_r(\\$${1:var});\ndie;' },
  { abbreviation: 'vd', description: 'var_dump a variable', body: 'var_dump(\\$${1:var});$0' },
  { abbreviation: 'pr', description: 'print_r a variable', body: 'print_r(\\$${1:var});$0' },
  { abbreviation: 'dd', description: 'dump and die (Laravel-style)', body: 'dd(\\$${1:var});$0' },
  { abbreviation: 'dump', description: 'Symfony VarDumper dump()', body: 'dump(\\$${1:var});$0' },
  { abbreviation: 'elog', description: 'error_log a variable', body: 'error_log(print_r(\\$${1:var}, true));$0' },
  { abbreviation: 'while', description: 'while loop', body: 'while (${1:condition}) {\n    $0\n}' },
  { abbreviation: 'dowhile', description: 'do/while loop', body: 'do {\n    $0\n} while (${1:condition});' },
  { abbreviation: 'forr', description: 'classic counting for loop', body: 'for (\\$${1:i} = 0; \\$${1:i} < ${2:count}; \\$${1:i}++) {\n    $0\n}' },
  { abbreviation: 'ret', description: 'return statement', body: 'return $0;' },
  { abbreviation: 'reta', description: 'return an array literal', body: 'return [$0];' },
  { abbreviation: 'req', description: 'require_once relative to this file', body: 'require_once __DIR__ . \'/${1:file}.php\';' },
  { abbreviation: 'inc', description: 'include_once relative to this file', body: 'include_once __DIR__ . \'/${1:file}.php\';' },
  { abbreviation: 'prop', description: 'typed private property declaration', body: 'private ${1:type} \\$${2:name};$0' },
  { abbreviation: 'constp', description: 'public class constant', body: 'public const ${1:NAME} = ${0:value};' },
  { abbreviation: 'amap', description: 'array_map with closure', body: 'array_map(function (\\$${1:item}) {\n    return $0;\n}, \\$${2:array});' },
  { abbreviation: 'afilter', description: 'array_filter with closure', body: 'array_filter(\\$${1:array}, function (\\$${2:item}) {\n    return $0;\n});' },
  { abbreviation: 'areduce', description: 'array_reduce with closure', body: 'array_reduce(\\$${1:array}, function (\\$carry, \\$${2:item}) {\n    return $0;\n}, ${3:0});' },
  { abbreviation: 'testex', description: 'PHPUnit expectException', body: '\\$this->expectException(${1:Exception}::class);\n$0;' },
  { abbreviation: 'jsond', description: 'json_decode into an associative array', body: '\\$${1:data} = json_decode(\\$${2:json}, true);$0' },
  {
    abbreviation: 'singleton',
    description: 'singleton class skeleton',
    body:
      'class ${1:Name}\n{\n    private static ?self \\$instance = null;\n\n    private function __construct()\n    {\n    }\n\n    public static function getInstance(): self\n    {\n        if (self::\\$instance === null) {\n            self::\\$instance = new self();\n        }\n\n        return self::\\$instance;\n    }\n\n    $0\n}'
  }
];
