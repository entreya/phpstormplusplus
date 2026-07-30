/**
 * PHP's built-in functions and classes have no .php source file to scan tokens
 * from (they're implemented in the engine itself), so our workspace indexer
 * can never discover them the way it discovers project/vendor classes. This is
 * a curated, bounded list of the most commonly used ones — not an exhaustive
 * stub library (PhpStorm/Intelephense ship thousands with full signatures;
 * reproducing that is its own large project) — so at least the everyday names
 * show up in completion instead of only ever suggesting project symbols.
 */
export const PHP_BUILTIN_FUNCTIONS: string[] = [
  // strings
  'strlen', 'str_replace', 'str_ireplace', 'substr', 'strpos', 'stripos', 'strrpos', 'str_contains', 'str_starts_with',
  'str_ends_with', 'str_pad', 'str_repeat', 'str_split', 'str_word_count', 'strtolower', 'strtoupper', 'ucfirst',
  'ucwords', 'lcfirst', 'trim', 'ltrim', 'rtrim', 'explode', 'implode', 'join', 'sprintf', 'printf', 'vsprintf',
  'number_format', 'wordwrap', 'nl2br', 'htmlspecialchars', 'htmlentities', 'html_entity_decode', 'strip_tags',
  'addslashes', 'stripslashes', 'preg_match', 'preg_match_all', 'preg_replace', 'preg_replace_callback', 'preg_split',
  'preg_quote', 'levenshtein', 'similar_text', 'soundex', 'metaphone', 'wordwrap', 'str_pad', 'mb_strlen',
  'mb_substr', 'mb_strtolower', 'mb_strtoupper', 'mb_str_split', 'chunk_split', 'nl2br',
  // arrays
  'array_map', 'array_filter', 'array_reduce', 'array_walk', 'array_merge', 'array_merge_recursive', 'array_combine',
  'array_keys', 'array_values', 'array_flip', 'array_search', 'array_key_exists', 'array_key_first', 'array_key_last',
  'in_array', 'array_unique', 'array_reverse', 'array_slice', 'array_splice', 'array_push', 'array_pop', 'array_shift',
  'array_unshift', 'array_fill', 'array_fill_keys', 'array_diff', 'array_diff_key', 'array_diff_assoc',
  'array_intersect', 'array_intersect_key', 'array_column', 'array_chunk', 'array_pad', 'array_product', 'array_sum',
  'array_rand', 'array_is_list', 'sort', 'rsort', 'asort', 'arsort', 'ksort', 'krsort', 'usort', 'uasort', 'uksort',
  'natsort', 'natcasesort', 'shuffle', 'compact', 'extract', 'range', 'count', 'sizeof', 'current', 'reset', 'end',
  'next', 'prev', 'key', 'each', 'list',
  // type / variable handling
  'is_array', 'is_string', 'is_int', 'is_integer', 'is_float', 'is_double', 'is_bool', 'is_null', 'is_numeric',
  'is_object', 'is_callable', 'is_iterable', 'is_countable', 'is_scalar', 'gettype', 'settype', 'intval', 'floatval',
  'strval', 'boolval', 'var_dump', 'var_export', 'print_r', 'isset', 'unset', 'empty', 'define', 'defined', 'constant',
  // math
  'abs', 'ceil', 'floor', 'round', 'sqrt', 'pow', 'min', 'max', 'rand', 'mt_rand', 'random_int', 'intdiv', 'fmod',
  'pi', 'log', 'log10', 'exp', 'is_nan', 'is_infinite',
  // json / serialization
  'json_encode', 'json_decode', 'json_last_error', 'json_last_error_msg', 'serialize', 'unserialize',
  // date/time
  'date', 'time', 'mktime', 'strtotime', 'date_create', 'date_diff', 'date_format', 'checkdate', 'microtime',
  'sleep', 'usleep',
  // filesystem / io
  'file_get_contents', 'file_put_contents', 'file_exists', 'is_file', 'is_dir', 'is_readable', 'is_writable',
  'fopen', 'fclose', 'fread', 'fwrite', 'fgets', 'feof', 'unlink', 'mkdir', 'rmdir', 'rename', 'copy', 'basename',
  'dirname', 'pathinfo', 'realpath', 'glob', 'scandir',
  // functions / callables / OOP helpers
  'call_user_func', 'call_user_func_array', 'func_get_args', 'func_num_args', 'function_exists', 'class_exists',
  'interface_exists', 'method_exists', 'property_exists', 'get_class', 'get_parent_class', 'get_object_vars',
  'get_class_methods', 'is_a', 'is_subclass_of', 'spl_autoload_register', 'iterator_to_array',
  // error / assertion
  'trigger_error', 'error_reporting', 'set_error_handler', 'set_exception_handler', 'assert',
  // misc commonly used
  'header', 'exit', 'die', 'phpversion', 'extension_loaded', 'ini_get', 'ini_set', 'getenv', 'putenv'
];

export const PHP_BUILTIN_CLASSES: string[] = [
  'stdClass', 'Closure', 'Generator', 'Fiber', 'WeakMap', 'WeakReference', 'ArrayObject', 'ArrayIterator',
  'SplStack', 'SplQueue', 'SplObjectStorage', 'SplFixedArray', 'SplDoublyLinkedList', 'SplHeap', 'SplMinHeap',
  'SplMaxHeap', 'SplPriorityQueue',
  'DateTime', 'DateTimeImmutable', 'DateInterval', 'DateTimeZone', 'DatePeriod',
  'PDO', 'PDOStatement', 'PDOException',
  'Exception', 'Error', 'TypeError', 'ValueError', 'ArgumentCountError', 'ArithmeticError', 'DivisionByZeroError',
  'RuntimeException', 'LogicException', 'InvalidArgumentException', 'OutOfRangeException', 'OutOfBoundsException',
  'LengthException', 'DomainException', 'RangeException', 'OverflowException', 'UnderflowException',
  'UnexpectedValueException', 'JsonException',
  'Iterator', 'IteratorAggregate', 'Traversable', 'Countable', 'ArrayAccess', 'Stringable', 'Serializable',
  'Throwable', 'JsonSerializable',
  'ReflectionClass', 'ReflectionMethod', 'ReflectionProperty', 'ReflectionFunction', 'ReflectionParameter',
  'ReflectionException'
];
