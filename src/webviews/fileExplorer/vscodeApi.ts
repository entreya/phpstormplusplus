import { FromExtensionMessage, FromWebviewMessage } from './protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

export function postToExtension(message: FromWebviewMessage): void {
  vscode.postMessage(message);
}

export function onExtensionMessage(handler: (message: FromExtensionMessage) => void): () => void {
  const listener = (event: MessageEvent) => handler(event.data as FromExtensionMessage);
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
