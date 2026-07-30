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
  { abbreviation: 'throwex', description: 'throw exception', body: 'throw new \\\\${1:Exception}(\'${0:message}\');' }
];
