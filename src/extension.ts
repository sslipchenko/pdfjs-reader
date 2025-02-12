import * as vscode from 'vscode';
import { PdfReaderProvider } from './provider';

export function activate(context: vscode.ExtensionContext) {
	PdfReaderProvider.register(context);
}

export function deactivate() {}
