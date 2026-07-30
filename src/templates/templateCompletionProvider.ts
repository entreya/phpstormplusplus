import * as vscode from 'vscode';
import { DEFAULT_TEMPLATES, LiveTemplate } from './defaultTemplates';

export class LiveTemplateCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    const config = vscode.workspace.getConfiguration('phpstormpp');
    const custom = config.get<LiveTemplate[]>('liveTemplates', []);
    const templates = [...DEFAULT_TEMPLATES, ...custom];

    const wordRange = document.getWordRangeAtPosition(position);
    const prefix = wordRange ? document.getText(wordRange) : '';

    return templates
      .filter((t) => !prefix || t.abbreviation.startsWith(prefix))
      .map((t) => {
        const item = new vscode.CompletionItem(t.abbreviation, vscode.CompletionItemKind.Snippet);
        item.detail = `Live Template: ${t.description}`;
        item.insertText = new vscode.SnippetString(t.body);
        item.range = wordRange;
        item.sortText = `0_${t.abbreviation}`;
        return item;
      });
  }
}
