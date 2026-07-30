import { Engine } from 'php-parser';
import { AstNode } from './astUtils';

const parser = new Engine({
  parser: { extractDoc: true, suppressErrors: true, php7: true },
  ast: { withPositions: true }
});

export function parsePhp(code: string, filename: string): AstNode | undefined {
  try {
    return parser.parseCode(code, filename);
  } catch {
    return undefined;
  }
}
