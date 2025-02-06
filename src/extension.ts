import * as vscode from 'vscode';
import { PdfReaderProvider } from './PdfReaderProvider';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(PdfReaderProvider.register(context));
}

export function deactivate() {}
